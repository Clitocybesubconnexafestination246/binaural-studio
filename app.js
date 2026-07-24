const presets = [
  { name: "Deep Sleep", hz: 2.5, carrier: 90, levels: [0.95, .74, .48, .28, .16, .08, .04, .02, 0, 0] },
  { name: "Dream Drift", hz: 4.5, carrier: 105, levels: [.9, .62, .76, .42, .26, .16, .1, .05, .02, 0] },
  { name: "Meditation", hz: 6, carrier: 120, levels: [.78, .9, .56, .72, .38, .24, .14, .08, .04, .02] },
  { name: "Calm", hz: 8, carrier: 130, levels: [.72, .9, .64, .48, .34, .24, .16, .1, .06, .03] },
  { name: "Clear Mind", hz: 10, carrier: 140, levels: [.55, .74, .9, .62, .44, .3, .2, .12, .07, .04] },
  { name: "Deep Focus", hz: 16, carrier: 150, levels: [.38, .52, .7, .92, .8, .58, .38, .24, .14, .08] },
  { name: "Bright Alert", hz: 32, carrier: 110, levels: [.68, .8, .62, .4, .24, .13, .07, .03, .01, 0] }
];

const knobColors = ["#ff815d", "#f5a24b", "#e9c857", "#b8d967", "#68d598", "#54d5c4", "#59c0ea", "#7393f2", "#a579e8", "#dd79bb"];
const state = { preset: 3, beat: 8, carrier: 130, volume: .35, wave: "sine", levels: [...presets[3].levels], playing: false, autoMatch: true, autoLevel: true, toneScale: 1, relation: 0, crossfade: true, crossfadeSeconds: 6, impulse: true, air: true, breathing: true, spatial: true, textureIntensity: .28, impulseAmount: .5, eq: { low: 0, mid: 0, high: 0 } };
let audioContext, masterGain;
const voices = [];
const musicSources = [], musicGains = [];
let musicEqLow, musicEqMid, musicEqHigh;
let activeDeck = 0, crossfadeInProgress = false, crossfadeTimer, crossfadeToneTarget;
const spokenQueue = [];
let spokenTrackSequence = 0, spokenIndex = -1, spokenSource, spokenOutput, spokenDry, spokenWet, spokenConvolver;
let spokenSilenceTimer, spokenSilenceRemaining = 0, spokenSilenceStartedAt = 0;
let musicQueueFinished = false, spokenQueueFinished = true;
let detectedRoot = null;
let recordDestination, mediaRecorder, recordedChunks = [], recordingWritable, recordingWriteQueue = Promise.resolve(), recordingCompletion = Promise.resolve(), isRecording = false, saveRecordingOnStop = true;
const playlist = [];
let currentTrackIndex = -1, trackSequence = 0, isAnalysingSet = false;
const KEY_CONFIDENCE_THRESHOLD = .22;
const BPM_CONFIDENCE_THRESHOLD = .3;
const breathingRates = [4.5, 5, 5.5, 6, 6.5, 7, 8];
let adaptiveGain, airSource, airGain, airFilter, airPanner, impulseTimer, nextRainTime = null, rainActive = false, texturePresence = 0, textureHoldUntil = 0;

const noteNames = ["C", "C♯", "D", "E♭", "E", "F", "F♯", "G", "A♭", "A", "B♭", "B"];
const majorProfile = [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88];
const minorProfile = [6.33, 2.68, 3.52, 5.38, 2.60, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17];

const $ = (id) => document.getElementById(id);
const mixer = $("mixer");
const presetList = $("presetList");
const deckPlayers = () => [$("musicPlayer"), $("musicPlayerB")];
const activePlayer = () => deckPlayers()[activeDeck];
const standbyPlayer = () => deckPlayers()[1 - activeDeck];
const spokenPlayer = () => $("spokenPlayer");

function waveBand(hz) {
  if (hz < 4) return "DELTA";
  if (hz < 8) return "THETA";
  if (hz < 13) return "ALPHA";
  if (hz < 30) return "BETA";
  return "GAMMA";
}

function buildUI() {
  state.levels.forEach((level, index) => {
    const channel = document.createElement("div");
    channel.className = "channel";
    channel.innerHTML = `
      <div class="fader-track">
        <input class="fader" style="--knob:${knobColors[index]}" type="range" min="0" max="1" value="${level}" step="0.01" aria-label="Harmonic ${index + 1} level">
      </div>
      <span class="channel-label">${String(index + 1).padStart(2, "0")}</span>
      <span class="channel-value">${Math.round(level * 100)}</span>`;
    const input = channel.querySelector("input");
    input.addEventListener("input", () => {
      state.levels[index] = Number(input.value);
      channel.querySelector(".channel-value").textContent = Math.round(input.value * 100);
      updateVoiceGains();
      markCustom();
    });
    mixer.appendChild(channel);
  });

  presets.forEach((preset, index) => {
    const button = document.createElement("button");
    button.className = `preset${index === state.preset ? " active" : ""}`;
    button.innerHTML = `<span class="preset-index">${String(index + 1).padStart(2, "0")}</span><span class="preset-name">${preset.name}</span><span class="preset-meta">${preset.hz.toFixed(1)} HZ / ${waveBand(preset.hz)}</span>`;
    button.addEventListener("click", () => applyPreset(index));
    presetList.appendChild(button);
  });
}

function createAudio() {
  if (audioContext) return true;
  const AudioContextClass = window.AudioContext || window.webkitAudioContext;
  if (!AudioContextClass) return false;
  audioContext = new AudioContextClass();
  masterGain = audioContext.createGain();
  masterGain.gain.value = 0;
  masterGain.connect(audioContext.destination);
  recordDestination = audioContext.createMediaStreamDestination();
  masterGain.connect(recordDestination);

  adaptiveGain = audioContext.createGain();
  adaptiveGain.gain.value = 1;
  adaptiveGain.connect(audioContext.destination);
  adaptiveGain.connect(recordDestination);
  createAirBed();

  connectMusicSources();
  connectSpokenSource();

  for (let i = 0; i < 10; i++) {
    const left = audioContext.createOscillator();
    const right = audioContext.createOscillator();
    const leftGain = audioContext.createGain();
    const rightGain = audioContext.createGain();
    const leftPan = audioContext.createStereoPanner();
    const rightPan = audioContext.createStereoPanner();
    leftPan.pan.value = -1;
    rightPan.pan.value = 1;
    left.connect(leftGain).connect(leftPan).connect(masterGain);
    right.connect(rightGain).connect(rightPan).connect(masterGain);
    left.start(); right.start();
    voices.push({ left, right, leftGain, rightGain });
  }
  updateAudioParams(true);
  return true;
}

function noiseBuffer(seconds = 2) {
  const buffer = audioContext.createBuffer(1, Math.ceil(audioContext.sampleRate * seconds), audioContext.sampleRate);
  const data = buffer.getChannelData(0);
  let previous = 0;
  for (let i = 0; i < data.length; i++) {
    const white = Math.random() * 2 - 1;
    previous = previous * .16 + white * .84;
    data[i] = previous;
  }
  return buffer;
}

function impulseBuffer(duration, resonanceFrequency) {
  const buffer = audioContext.createBuffer(1, Math.ceil(audioContext.sampleRate * duration), audioContext.sampleRate);
  const data = buffer.getChannelData(0);
  const phase = Math.random() * Math.PI * 2;
  for (let i = 0; i < data.length; i++) {
    const time = i / audioContext.sampleRate;
    const crack = (Math.random() * 2 - 1) * Math.exp(-time * 230);
    const body = Math.sin(Math.PI * 2 * resonanceFrequency * time + phase) * Math.exp(-time * 82);
    const leadingEdge = i < 3 ? (Math.random() * 2 - 1) * (1 - i / 3) : 0;
    data[i] = crack * .72 + body * .34 + leadingEdge * .68;
  }
  return buffer;
}

function createAirBed() {
  airSource = audioContext.createBufferSource();
  airSource.buffer = noiseBuffer(3);
  airSource.loop = true;
  airFilter = audioContext.createBiquadFilter();
  airFilter.type = "bandpass";
  airFilter.frequency.value = 1450;
  airFilter.Q.value = .42;
  airGain = audioContext.createGain();
  airGain.gain.value = 0;
  airPanner = audioContext.createStereoPanner();
  airSource.connect(airFilter).connect(airGain).connect(airPanner).connect(adaptiveGain);
  airSource.start();
}

function connectMusicSources() {
  if (!audioContext || musicSources.length) return;
  musicEqLow = audioContext.createBiquadFilter();
  musicEqLow.type = "lowshelf";
  musicEqLow.frequency.value = 120;
  musicEqMid = audioContext.createBiquadFilter();
  musicEqMid.type = "peaking";
  musicEqMid.frequency.value = 1000;
  musicEqMid.Q.value = .8;
  musicEqHigh = audioContext.createBiquadFilter();
  musicEqHigh.type = "highshelf";
  musicEqHigh.frequency.value = 8000;
  musicEqLow.connect(musicEqMid).connect(musicEqHigh);
  musicEqHigh.connect(audioContext.destination);
  musicEqHigh.connect(recordDestination);
  updateMusicEq(true);
  deckPlayers().forEach((player, deck) => {
    const source = audioContext.createMediaElementSource(player);
    const gain = audioContext.createGain();
    gain.gain.value = deck === activeDeck ? Number($("musicVolume").value) : 0;
    source.connect(gain);
    gain.connect(musicEqLow);
    musicSources.push(source);
    musicGains.push(gain);
  });
}

function spokenReverbBuffer(seconds = 2.4, decay = 3.2) {
  const length = Math.ceil(audioContext.sampleRate * seconds);
  const buffer = audioContext.createBuffer(2, length, audioContext.sampleRate);
  for (let channel = 0; channel < buffer.numberOfChannels; channel++) {
    const data = buffer.getChannelData(channel);
    for (let sample = 0; sample < length; sample++) {
      const envelope = Math.pow(1 - sample / length, decay);
      data[sample] = (Math.random() * 2 - 1) * envelope;
    }
  }
  return buffer;
}

function connectSpokenSource() {
  if (!audioContext || spokenSource) return;
  spokenSource = audioContext.createMediaElementSource(spokenPlayer());
  spokenDry = audioContext.createGain();
  spokenWet = audioContext.createGain();
  spokenOutput = audioContext.createGain();
  spokenConvolver = audioContext.createConvolver();
  spokenConvolver.buffer = spokenReverbBuffer();
  spokenSource.connect(spokenDry).connect(spokenOutput);
  spokenSource.connect(spokenConvolver).connect(spokenWet).connect(spokenOutput);
  spokenOutput.connect(audioContext.destination);
  spokenOutput.connect(recordDestination);
  spokenOutput.gain.value = Number($("spokenVolume").value);
  updateSpokenReverb(true);
}

function updateSpokenReverb(immediate = false) {
  if (!audioContext || !spokenDry || !spokenWet) return;
  const wet = Number($("spokenReverb").value);
  const now = audioContext.currentTime;
  const smoothing = immediate ? .01 : .04;
  spokenDry.gain.setTargetAtTime(Math.cos(wet * Math.PI / 2), now, smoothing);
  spokenWet.gain.setTargetAtTime(Math.sin(wet * Math.PI / 2) * .72, now, smoothing);
}

function updateMusicEq(immediate = false) {
  if (!audioContext || !musicEqLow) return;
  [[musicEqLow, state.eq.low], [musicEqMid, state.eq.mid], [musicEqHigh, state.eq.high]].forEach(([filter, value]) => {
    filter.gain.cancelScheduledValues(audioContext.currentTime);
    filter.gain.setTargetAtTime(value, audioContext.currentTime, immediate ? .01 : .04);
  });
}

function syncEqControl(band) {
  const input = $(`eq${band[0].toUpperCase()}${band.slice(1)}`);
  const value = Number(input.value);
  state.eq[band] = value;
  input.parentElement.querySelector(".eq-dial").style.setProperty("--eq-angle", `${value / 12 * 135}deg`);
  $(`${input.id}Value`).textContent = `${value > 0 ? "+" : ""}${value.toFixed(1)} dB`;
  updateMusicEq();
}

function setDeckGain(deck, value, glide = .04) {
  if (!audioContext || !musicGains[deck]) return;
  const parameter = musicGains[deck].gain;
  parameter.cancelScheduledValues(audioContext.currentTime);
  parameter.setTargetAtTime(value, audioContext.currentTime, glide);
}

function trackEnergyAt(track, time) {
  if (!track?.envelope?.values?.length) return .5;
  const index = Math.min(track.envelope.values.length - 1, Math.max(0, Math.floor(time * track.envelope.pointsPerSecond)));
  return track.envelope.values[index];
}

function trackLoudnessScale(track) {
  return track?.envelope?.loudnessScale || 1;
}

function loudnessReadout(track) {
  const loudness = track?.envelope?.integratedDb;
  return Number.isFinite(loudness) ? `${loudness.toFixed(1)} DB AVG` : "LOUDNESS PENDING";
}

function textureOpportunityAt(track, time) {
  if (!track?.envelope?.values?.length) return 0;
  const values = track.envelope.values;
  const pointsPerSecond = track.envelope.pointsPerSecond;
  const centre = Math.max(0, Math.min(values.length - 1, Math.floor(time * pointsPerSecond)));
  const radius = Math.max(1, Math.ceil(pointsPerSecond * 1.6));
  let sum = 0, peak = 0, count = 0;
  for (let index = Math.max(0, centre - radius); index <= Math.min(values.length - 1, centre + radius); index++) {
    sum += values[index];
    peak = Math.max(peak, values[index]);
    count += 1;
  }
  const contextualEnergy = (sum / count) * .72 + peak * .28;
  const threshold = .44 + state.impulseAmount * .18;
  const range = .34 + state.impulseAmount * .14;
  const quietness = Math.max(0, Math.min(1, (threshold - contextualEnergy) / range));
  if (quietness <= .12 - state.impulseAmount * .06) return 0;

  // Very quiet passages always qualify. Moderately quiet passages use stable,
  // track-specific five-second windows so the texture visits rather than carpets.
  if (contextualEnergy < .1) return quietness;
  const trackSeed = Number(String(track.id || "0").replace(/\D/g, "")) || 1;
  const windowIndex = Math.floor(time / 5.25);
  const pseudoRandom = Math.sin((trackSeed * 37 + windowIndex * 101) * 12.9898) * 43758.5453;
  const windowChance = .38 + state.impulseAmount * .5;
  return pseudoRandom - Math.floor(pseudoRandom) < windowChance ? quietness : 0;
}

function breathingPlan(track = playlist[currentTrackIndex]) {
  const presetIndex = state.preset >= 0 ? state.preset : Math.max(0, Math.min(6, Math.round(state.beat / 5)));
  const targetRate = breathingRates[presetIndex];
  if (!track?.bpm || track.bpmConfidence < BPM_CONFIDENCE_THRESHOLD) return { rate: targetRate, beats: null };
  const options = [8, 12, 16, 20, 24, 28, 32];
  const beats = options.reduce((best, candidate) => Math.abs(track.bpm / candidate - targetRate) < Math.abs(track.bpm / best - targetRate) ? candidate : best, options[0]);
  return { rate: track.bpm / beats, beats };
}

function breathingScale(track, time) {
  if (!state.breathing) return 1;
  const plan = breathingPlan(track);
  const phase = track?.bpm && plan.beats
    ? ((time - (track.beatOffset || 0)) * track.bpm / 60 / plan.beats) * Math.PI * 2
    : time * plan.rate / 60 * Math.PI * 2;
  // Long, shallow inhale/exhale movement: audible as continuity, not pumping.
  return .965 + .035 * (.5 + .5 * Math.sin(phase - Math.PI / 2));
}

function updateAdaptiveStatus(track = playlist[currentTrackIndex]) {
  const ready = track?.status === "analysed";
  $("adaptiveStrip").classList.toggle("disabled", !ready);
  ["impulseButton", "airButton", "breathButton", "spatialButton"].forEach((id) => { $(id).disabled = !ready; });
  if (!ready) {
    $("impulseStatus").textContent = "WAITING FOR WAVEFORM";
    $("airStatus").textContent = "WAITING FOR AUDIO";
    $("breathStatus").textContent = "PRESET-LED";
    return;
  }
  const locked = track.bpmConfidence >= BPM_CONFIDENCE_THRESHOLD;
  $("impulseStatus").textContent = state.impulse ? "QUIET WINDOWS · ARMED" : "OFF";
  $("airStatus").textContent = state.air ? locked ? "CONTINUOUS · SUBTLE" : "CONTINUOUS · LOW CONF LIFT" : "OFF";
  const plan = breathingPlan(track);
  $("breathStatus").textContent = state.breathing ? `${plan.rate.toFixed(1)}/MIN${plan.beats ? ` · ${plan.beats} BEATS` : " · FREE"}` : "OFF";
  $("spatialStatus").textContent = state.spatial ? "ADAPTIVE WIDTH" : "CENTRED";
}

function updateAirBed(immediate = false) {
  if (!audioContext || !airGain) return;
  const track = playlist[currentTrackIndex];
  const lowConfidence = !track?.bpm || track.bpmConfidence < BPM_CONFIDENCE_THRESHOLD;
  const quietness = 1 - trackEnergyAt(track, activePlayer().currentTime);
  const crossfadeLift = crossfadeInProgress ? .6 : 0;
  const prominence = Math.max(quietness * .7, crossfadeLift);
  const loudnessScale = trackLoudnessScale(track);
  let target = 0;
  if (state.playing && state.air) {
    if (crossfadeInProgress) target = state.textureIntensity * .024;
    else target = state.textureIntensity * (.007 + prominence * .017) * (lowConfidence ? 1.28 : 1);
  }
  const matchedTarget = target * loudnessScale;
  airGain.gain.setTargetAtTime(matchedTarget, audioContext.currentTime, immediate ? .08 : 1.1);
  airPanner.pan.setTargetAtTime(state.spatial ? Math.sin(activePlayer().currentTime * .14) * .38 : 0, audioContext.currentTime, 1.4);
}

function scheduleImpulse(when, strength = 1, loudnessScale = 1) {
  if (!audioContext || !adaptiveGain || !state.impulse) return;
  const duration = .009 + Math.random() * .029;
  const resonanceFrequency = 900 + Math.pow(Math.random(), .72) * 5100;
  const source = audioContext.createBufferSource();
  source.buffer = impulseBuffer(duration, resonanceFrequency);
  const filter = audioContext.createBiquadFilter();
  filter.type = "highpass";
  filter.frequency.value = 260 + Math.pow(Math.random(), 1.7) * 1900;
  filter.Q.value = .35 + Math.random() * .45;
  const gain = audioContext.createGain();
  const panner = audioContext.createStereoPanner();
  const amountGain = .35 + state.impulseAmount * 1.65;
  const peak = state.textureIntensity * .12 * amountGain * loudnessScale * (.72 + strength * .5) * (.78 + Math.random() * .42);
  const width = state.spatial ? .48 + Math.random() * .5 : 0;
  const direction = Math.random() < .5 ? -1 : 1;
  gain.gain.setValueAtTime(Math.max(.0002, peak), when);
  gain.gain.exponentialRampToValueAtTime(.0001, when + duration);
  panner.pan.setValueAtTime(direction * width, when);
  source.connect(filter).connect(gain).connect(panner).connect(adaptiveGain);
  source.start(when);
  source.stop(when + duration + .02);
}

function scheduleTransitionTexture(startTime, duration) {
  const pocketStart = startTime + duration * .31;
  const pocketEnd = startTime + duration * .69;
  const nextTrack = playlist[currentTrackIndex + 1];
  const transitionLoudness = Math.sqrt(trackLoudnessScale(playlist[currentTrackIndex]) * trackLoudnessScale(nextTrack));
  const amountRate = .45 + state.impulseAmount * 1.55;
  let when = pocketStart;
  while (when < pocketEnd) {
    scheduleImpulse(when, .72 + Math.random() * .4, transitionLoudness);
    when += (.045 + Math.random() * .105) / amountRate;
  }
}

function scheduleAdaptiveAudio() {
  if (!audioContext || !state.playing) return;
  updateAirBed();
  const track = playlist[currentTrackIndex];
  if (!state.impulse || crossfadeInProgress || !track?.envelope) {
    rainActive = false;
    texturePresence = 0;
    textureHoldUntil = 0;
    return;
  }
  const player = activePlayer();
  const now = audioContext.currentTime;
  const horizon = now + .3;
  const opportunity = textureOpportunityAt(track, player.currentTime);
  if (opportunity > .1) textureHoldUntil = now + 2.8 + state.impulseAmount * 6;
  const heldOpportunity = now < textureHoldUntil ? Math.max(.26, opportunity) : opportunity;
  const targetPresence = heldOpportunity > .1 ? heldOpportunity : 0;
  const presenceSmoothing = targetPresence > texturePresence ? .16 : .05 - state.impulseAmount * .035;
  texturePresence += (targetPresence - texturePresence) * presenceSmoothing;
  if (texturePresence <= .025) {
    if (rainActive) $("impulseStatus").textContent = "QUIET WINDOWS · ARMED";
    rainActive = false;
    texturePresence = 0;
    nextRainTime = null;
    return;
  }
  if (!rainActive) $("impulseStatus").textContent = "QUIET WINDOW · IMPULSES";
  rainActive = true;
  if (nextRainTime == null || nextRainTime < now) nextRainTime = now + .02;
  while (nextRainTime <= horizon) {
    const futureTrackTime = player.currentTime + (nextRainTime - now);
    const futureOpportunity = textureOpportunityAt(track, futureTrackTime);
    const shapedPresence = Math.max(texturePresence, futureOpportunity * .65);
    const amountRate = .45 + state.impulseAmount * 1.55;
    const rate = (5.5 + state.textureIntensity * 9 + shapedPresence * 2) * (.5 + shapedPresence * .5) * amountRate;
    const strength = .42 + shapedPresence * .58;
    scheduleImpulse(nextRainTime, strength, trackLoudnessScale(track) * shapedPresence);
    const randomInterval = -Math.log(Math.max(.001, 1 - Math.random())) / rate;
    nextRainTime += Math.max(.026, Math.min(.22, randomInterval));
  }
}

function startAdaptiveAudio() {
  clearInterval(impulseTimer);
  nextRainTime = null;
  rainActive = false;
  texturePresence = 0;
  textureHoldUntil = 0;
  updateAirBed(true);
  impulseTimer = setInterval(scheduleAdaptiveAudio, 90);
}

function stopAdaptiveAudio() {
  clearInterval(impulseTimer);
  impulseTimer = null;
  nextRainTime = null;
  rainActive = false;
  texturePresence = 0;
  textureHoldUntil = 0;
  updateAirBed(true);
}

function harmonicFrequency(index) {
  // Musical partials are gently compressed to keep every carrier comfortable.
  return state.carrier * (1 + index * .36);
}

function updateAudioParams(immediate = false, glide = .18) {
  if (!audioContext) return;
  const now = audioContext.currentTime;
  voices.forEach((voice, i) => {
    const base = harmonicFrequency(i);
    const ramp = immediate ? 0.01 : glide;
    voice.left.type = state.wave;
    voice.right.type = state.wave;
    voice.left.frequency.cancelScheduledValues(now);
    voice.right.frequency.cancelScheduledValues(now);
    voice.left.frequency.setTargetAtTime(base - state.beat / 2, now, ramp);
    voice.right.frequency.setTargetAtTime(base + state.beat / 2, now, ramp);
  });
  updateVoiceGains();
}

function updateVoiceGains() {
  if (!audioContext) return;
  const now = audioContext.currentTime;
  const activeSum = state.levels.reduce((sum, n) => sum + n, 0) || 1;
  voices.forEach((voice, i) => {
    const gain = (state.levels[i] / Math.sqrt(activeSum)) * .32;
    voice.leftGain.gain.setTargetAtTime(gain, now, .06);
    voice.rightGain.gain.setTargetAtTime(gain, now, .06);
  });
}

function spokenItemDuration(item) {
  return item?.type === "silence" ? item.seconds : item?.duration || 0;
}

function formatSpokenDuration(seconds) {
  if (!Number.isFinite(seconds)) return "0:00";
  if (seconds < 10 && seconds % 1) return `0:${seconds.toFixed(1).padStart(4, "0")}`;
  return formatTime(seconds);
}

function createSilenceItem(seconds) {
  const duration = Math.round(seconds * 10) / 10;
  return {
    id: `spoken-${++spokenTrackSequence}`,
    type: "silence",
    name: `${formatSpokenDuration(duration)} silence`,
    seconds: duration,
    duration
  };
}

function updateSpokenSummary() {
  const audioCount = spokenQueue.filter((item) => item.type === "audio").length;
  const silenceCount = spokenQueue.length - audioCount;
  $("spokenSummary").textContent = `${spokenQueue.length} ITEM${spokenQueue.length === 1 ? "" : "S"} · ${audioCount} AUDIO${silenceCount ? ` · ${silenceCount} SILENCE` : ""} · FOLLOWS MASTER TRANSPORT`;
  $("clearSpokenButton").disabled = spokenQueue.length === 0 || isRecording;
  $("spokenAudioFile").disabled = isRecording;
  $("addSilenceButton").disabled = isRecording;
  $("addRandomGapsButton").disabled = isRecording || audioCount < 2;
}

function renderSpokenQueue() {
  const container = $("spokenQueue");
  container.innerHTML = "";
  if (!spokenQueue.length) {
    const empty = document.createElement("div");
    empty.className = "playlist-empty";
    empty.textContent = "Audio files and timed silence will appear here.";
    container.appendChild(empty);
    updateSpokenSummary();
    return;
  }
  spokenQueue.forEach((item, index) => {
    const row = document.createElement("div");
    row.className = `spoken-queue-item${index === spokenIndex ? " current" : ""}`;
    const order = document.createElement("span");
    order.className = "track-order";
    order.textContent = String(index + 1).padStart(2, "0");
    const title = document.createElement("button");
    title.className = "track-title-button";
    title.textContent = item.name;
    title.addEventListener("click", () => selectSpokenItem(index, state.playing));
    const kind = document.createElement("span");
    kind.className = `spoken-kind${item.type === "silence" ? " silence" : ""}`;
    kind.textContent = item.type === "silence" ? "SILENCE" : "AUDIO";
    const duration = document.createElement("span");
    duration.className = "spoken-time";
    duration.textContent = item.duration ? formatSpokenDuration(spokenItemDuration(item)) : "—";
    const actions = document.createElement("div");
    actions.className = "row-actions";
    [
      { label: "Move up", glyph: "↑", disabled: index === 0, run: () => moveSpokenItem(index, -1) },
      { label: "Move down", glyph: "↓", disabled: index === spokenQueue.length - 1, run: () => moveSpokenItem(index, 1) },
      { label: "Remove", glyph: "×", disabled: isRecording, run: () => removeSpokenItem(index) }
    ].forEach((action) => {
      const button = document.createElement("button");
      button.className = "row-action";
      button.type = "button";
      button.textContent = action.glyph;
      button.title = action.label;
      button.setAttribute("aria-label", `${action.label} ${item.name}`);
      button.disabled = action.disabled || isRecording;
      button.addEventListener("click", action.run);
      actions.appendChild(button);
    });
    row.append(order, title, kind, duration, actions);
    container.appendChild(row);
  });
  updateSpokenSummary();
}

function stopSpokenSilence() {
  if (!spokenSilenceTimer) return;
  spokenSilenceRemaining = Math.max(0, spokenSilenceRemaining - (performance.now() - spokenSilenceStartedAt) / 1000);
  clearInterval(spokenSilenceTimer);
  spokenSilenceTimer = null;
}

function startSpokenSilence() {
  const item = spokenQueue[spokenIndex];
  if (!item || item.type !== "silence" || !state.playing) return;
  if (spokenSilenceRemaining <= 0) spokenSilenceRemaining = item.seconds;
  spokenSilenceStartedAt = performance.now();
  const tick = () => {
    const remaining = Math.max(0, spokenSilenceRemaining - (performance.now() - spokenSilenceStartedAt) / 1000);
    const elapsed = item.seconds - remaining;
    $("spokenCurrentTime").textContent = formatTime(elapsed);
    $("spokenPosition").value = elapsed;
    if (remaining <= 0) {
      clearInterval(spokenSilenceTimer);
      spokenSilenceTimer = null;
      spokenSilenceRemaining = 0;
      advanceSpokenQueue();
    }
  };
  tick();
  spokenSilenceTimer = setInterval(tick, 100);
}

async function selectSpokenItem(index, autoplay = false) {
  const item = spokenQueue[index];
  if (!item) return;
  stopSpokenSilence();
  const player = spokenPlayer();
  player.pause();
  spokenIndex = index;
  spokenQueueFinished = false;
  spokenSilenceRemaining = item.type === "silence" ? item.seconds : 0;
  $("spokenNowIndex").textContent = String(index + 1).padStart(2, "0");
  $("spokenDeckTitle").textContent = item.name;
  $("spokenMeta").style.color = "";
  $("spokenMeta").textContent = item.type === "silence" ? `TIMED PAUSE · ${formatSpokenDuration(item.seconds)}` : `${(item.file.size / 1048576).toFixed(1)} MB · ITEM ${index + 1} OF ${spokenQueue.length}`;
  $("spokenCurrentTime").textContent = "0:00";
  $("spokenDuration").textContent = formatSpokenDuration(spokenItemDuration(item));
  $("spokenPosition").max = spokenItemDuration(item) || 100;
  $("spokenPosition").value = 0;
  $("spokenPosition").disabled = item.type === "silence";
  $("spokenPositionWrap").classList.remove("disabled");
  if (item.type === "audio") {
    player.src = item.url;
    player.load();
    if (autoplay) {
      try { await player.play(); } catch (error) { console.warn("The spoken-word item could not start", error); }
    }
  } else {
    player.removeAttribute("src");
    player.load();
    if (autoplay) startSpokenSilence();
  }
  renderSpokenQueue();
}

async function advanceSpokenQueue() {
  const nextIndex = spokenIndex + 1;
  if (nextIndex < spokenQueue.length) {
    await selectSpokenItem(nextIndex, state.playing);
    return;
  }
  spokenQueueFinished = true;
  $("spokenMeta").textContent = "QUEUE FINISHED";
  maybeFinishCombinedPlayback();
}

function pauseSpokenDeck() {
  spokenPlayer().pause();
  stopSpokenSilence();
}

async function resumeSpokenDeck() {
  if (!spokenQueue.length || spokenQueueFinished) return;
  if (spokenIndex < 0) await selectSpokenItem(0, false);
  const item = spokenQueue[spokenIndex];
  if (item?.type === "silence") startSpokenSilence();
  else if (spokenPlayer().src) {
    try { await spokenPlayer().play(); } catch (error) { console.warn("The spoken-word item could not resume", error); }
  }
}

function maybeFinishCombinedPlayback() {
  if (!musicQueueFinished || !spokenQueueFinished) return;
  state.playing = false;
  if (audioContext) masterGain.gain.setTargetAtTime(0, audioContext.currentTime, .06);
  stopAdaptiveAudio();
  pauseSpokenDeck();
  document.body.classList.remove("playing");
  $("playButton").setAttribute("aria-pressed", "false");
  $("playButton").setAttribute("aria-label", "Start audio");
  if (isRecording) {
    stopSetRecording(true);
    $("playStatus").textContent = "SAVING RECORDING";
  } else $("playStatus").textContent = "FINISHED";
}

function moveSpokenItem(index, direction) {
  const target = index + direction;
  if (target < 0 || target >= spokenQueue.length || isRecording) return;
  const currentId = spokenQueue[spokenIndex]?.id;
  [spokenQueue[index], spokenQueue[target]] = [spokenQueue[target], spokenQueue[index]];
  spokenIndex = spokenQueue.findIndex((item) => item.id === currentId);
  renderSpokenQueue();
}

function removeSpokenItem(index) {
  if (isRecording) return;
  const removed = spokenQueue[index];
  const wasCurrent = index === spokenIndex;
  spokenQueue.splice(index, 1);
  if (removed.type === "audio") URL.revokeObjectURL(removed.url);
  if (wasCurrent) {
    if (spokenQueue.length) selectSpokenItem(Math.min(index, spokenQueue.length - 1), state.playing);
    else resetSpokenDeck();
  } else if (index < spokenIndex) spokenIndex -= 1;
  renderSpokenQueue();
}

function resetSpokenDeck() {
  stopSpokenSilence();
  spokenPlayer().pause();
  spokenPlayer().removeAttribute("src");
  spokenPlayer().load();
  spokenIndex = -1;
  spokenQueueFinished = spokenQueue.length === 0;
  spokenSilenceRemaining = 0;
  $("spokenNowIndex").textContent = "—";
  $("spokenDeckTitle").textContent = "No spoken-word item loaded";
  $("spokenMeta").textContent = "ADD AUDIO OR SILENCE TO BUILD AN INDEPENDENT QUEUE";
  $("spokenCurrentTime").textContent = "0:00";
  $("spokenDuration").textContent = "0:00";
  $("spokenPosition").value = 0;
  $("spokenPosition").disabled = true;
  $("spokenPositionWrap").classList.add("disabled");
}

async function togglePlay() {
  const starting = !state.playing;
  if (playlist.length && playlist.some((track) => track.status !== "analysed")) {
    $("playStatus").textContent = isAnalysingSet ? "ANALYSING SET" : "ANALYSE SET FIRST";
    return;
  }
  if (starting && playlist.length && (currentTrackIndex < 0 || (musicQueueFinished && spokenQueueFinished))) {
    await selectTrack(0, false);
    musicQueueFinished = false;
  }
  if (starting && !playlist.length) musicQueueFinished = true;
  if (starting && spokenQueue.length && (spokenIndex < 0 || (spokenQueueFinished && musicQueueFinished))) await selectSpokenItem(0, false);
  if (starting && !spokenQueue.length) spokenQueueFinished = true;
  if (!createAudio()) {
    $("playStatus").textContent = "AUDIO UNSUPPORTED";
    $("playButton").setAttribute("aria-label", "Web Audio is not supported in this browser");
    return;
  }
  if (audioContext.state === "suspended") await audioContext.resume();
  state.playing = !state.playing;
  if (state.playing && playlist[currentTrackIndex]) applyTrackCue(playlist[currentTrackIndex]);
  masterGain.gain.cancelScheduledValues(audioContext.currentTime);
  if (state.playing) applyDynamicToneLevel(true);
  else masterGain.gain.setTargetAtTime(0, audioContext.currentTime, .06);
  if (state.playing) startAdaptiveAudio();
  else stopAdaptiveAudio();
  if (state.playing) await resumeSpokenDeck();
  else pauseSpokenDeck();
  document.body.classList.toggle("playing", state.playing);
  $("sortKeyButton").disabled = state.playing || playlist.length < 2 || playlist.some((track) => track.status !== "analysed");
  $("playButton").setAttribute("aria-pressed", String(state.playing));
  $("playButton").setAttribute("aria-label", state.playing ? "Pause audio" : "Start audio");
  if (isRecording && mediaRecorder) {
    if (state.playing && mediaRecorder.state === "paused") mediaRecorder.resume();
    else if (!state.playing && mediaRecorder.state === "recording") mediaRecorder.pause();
  }
  $("playStatus").textContent = isRecording
    ? state.playing ? `RECORDING ${currentTrackIndex + 1}/${playlist.length}` : "RECORDING PAUSED"
    : state.playing && playlist.length ? `PLAYING ${currentTrackIndex + 1}/${playlist.length}` : state.playing ? "PLAYING" : "PAUSED";
  if (activePlayer().src && !musicQueueFinished) {
    if (state.playing) {
      try { await activePlayer().play(); } catch (error) { console.warn("The local track could not start", error); }
    } else {
      activePlayer().pause();
      standbyPlayer().pause();
      if (crossfadeInProgress) cancelCrossfade();
    }
  }
}

function recordingFormat() {
  if (!window.MediaRecorder) return null;
  const candidates = [
    { mimeType: "audio/mp4;codecs=mp4a.40.2", extension: "m4a" },
    { mimeType: "audio/webm;codecs=opus", extension: "webm" },
    { mimeType: "audio/ogg;codecs=opus", extension: "ogg" }
  ];
  return candidates.find((candidate) => MediaRecorder.isTypeSupported?.(candidate.mimeType)) || { mimeType: "", extension: "webm" };
}

function recordingFilename(extension) {
  const timestamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-");
  return `phase-set-${timestamp}.${extension}`;
}

function downloadRecording(blob, extension) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = recordingFilename(extension);
  link.style.display = "none";
  document.body.appendChild(link);
  link.click();
  // Keep both the anchor and Blob URL alive for the lifetime of the page. Large
  // automatic downloads can still be finalising after a fixed revoke timeout,
  // leaving Chromium with a complete but unconfirmed .crdownload file.
}

function updateRecordingUI() {
  document.body.classList.toggle("recording", isRecording);
  $("recordSetButton").setAttribute("aria-pressed", String(isRecording));
  $("recordSetButton").setAttribute("aria-label", isRecording ? "Stop recording and save the set" : "Play and record the full set");
  $("recordSetButton").querySelector("span").textContent = isRecording ? "STOP + SAVE" : "PLAY + REC SET";
  $("audioFile").disabled = isRecording || isAnalysingSet;
  renderPlaylist();
  renderSpokenQueue();
}

async function startSetRecording() {
  if (!playlist.length || playlist.some((track) => track.status !== "analysed")) {
    $("playStatus").textContent = "ANALYSE SET FIRST";
    return;
  }
  const format = recordingFormat();
  if (!format) {
    $("playStatus").textContent = "RECORDING UNSUPPORTED";
    return;
  }
  if (!createAudio()) {
    $("playStatus").textContent = "AUDIO UNSUPPORTED";
    return;
  }
  const options = format.mimeType ? { mimeType: format.mimeType, audioBitsPerSecond: 256000 } : { audioBitsPerSecond: 256000 };
  try { mediaRecorder = new MediaRecorder(recordDestination.stream, options); }
  catch (error) {
    try { mediaRecorder = new MediaRecorder(recordDestination.stream); }
    catch (fallbackError) { console.warn("Recording could not start", fallbackError); $("playStatus").textContent = "RECORDING ERROR"; return; }
  }
  const actualType = mediaRecorder.mimeType || format.mimeType || "audio/webm";
  const extension = actualType.includes("mp4") ? "m4a" : actualType.includes("ogg") ? "ogg" : "webm";
  recordingWritable = null;
  recordingWriteQueue = Promise.resolve();
  if (window.showSaveFilePicker) {
    try {
      const baseType = actualType.split(";")[0];
      const handle = await window.showSaveFilePicker({
        suggestedName: recordingFilename(extension),
        types: [{ description: "Phase set recording", accept: { [baseType]: [`.${extension}`] } }]
      });
      recordingWritable = await handle.createWritable();
    } catch (error) {
      mediaRecorder = null;
      if (error.name !== "AbortError") console.warn("Could not open the destination file", error);
      return;
    }
  }

  if (state.playing) await togglePlay();
  await selectTrack(0, false);
  musicQueueFinished = false;
  if (spokenQueue.length) await selectSpokenItem(0, false);
  spokenQueueFinished = spokenQueue.length === 0;
  if (audioContext.state === "suspended") await audioContext.resume();

  recordedChunks = [];
  saveRecordingOnStop = true;
  let resolveRecordingCompletion;
  recordingCompletion = new Promise((resolve) => { resolveRecordingCompletion = resolve; });
  mediaRecorder.addEventListener("dataavailable", (event) => {
    if (!event.data?.size) return;
    if (recordingWritable) recordingWriteQueue = recordingWriteQueue.then(() => recordingWritable.write(event.data));
    else recordedChunks.push(event.data);
  });
  mediaRecorder.addEventListener("error", (event) => { console.warn("Recording error", event.error); $("playStatus").textContent = "RECORDING ERROR"; });
  mediaRecorder.addEventListener("stop", async () => {
    let saved = false;
    try {
      await recordingWriteQueue;
      if (recordingWritable) {
        if (saveRecordingOnStop) {
          await recordingWritable.close();
          saved = true;
          $("playStatus").textContent = "RECORDING SAVED";
        }
        else await recordingWritable.abort();
      } else if (saveRecordingOnStop && recordedChunks.length) {
        downloadRecording(new Blob(recordedChunks, { type: actualType }), extension);
        saved = true;
        $("playStatus").textContent = "DOWNLOAD STARTED";
      }
    } catch (error) {
      console.warn("Could not finish the recording file", error);
      $("playStatus").textContent = "SAVE ERROR";
    }
    recordedChunks = [];
    recordingWritable = null;
    recordingWriteQueue = Promise.resolve();
    mediaRecorder = null;
    resolveRecordingCompletion(saved);
  }, { once: true });

  isRecording = true;
  mediaRecorder.start(1000);
  updateRecordingUI();
  await togglePlay();
}

async function stopSetRecording(save = true) {
  if (!isRecording || !mediaRecorder) return recordingCompletion;
  saveRecordingOnStop = save;
  if (mediaRecorder.state === "paused") mediaRecorder.resume();
  if (mediaRecorder.state !== "inactive") {
    if (save && mediaRecorder.state === "recording") {
      try { mediaRecorder.requestData(); }
      catch (error) { console.warn("Could not request the final recording chunk", error); }
    }
    mediaRecorder.stop();
  }
  isRecording = false;
  updateRecordingUI();
  return recordingCompletion;
}

function applyPreset(index) {
  const preset = presets[index];
  state.preset = index;
  state.beat = preset.hz;
  state.carrier = preset.carrier;
  state.levels = [...preset.levels];
  $("beatFrequency").value = state.beat;
  $("carrierFrequency").value = state.carrier;
  syncFaders();
  updateReadouts(preset.name);
  [...presetList.children].forEach((el, i) => el.classList.toggle("active", i === index));
  updateAudioParams();
  updateAdaptiveStatus();
}

function syncFaders() {
  [...mixer.children].forEach((channel, i) => {
    channel.querySelector("input").value = state.levels[i];
    channel.querySelector(".channel-value").textContent = Math.round(state.levels[i] * 100);
  });
}

function updateReadouts(name = state.preset >= 0 ? presets[state.preset].name : "Custom") {
  $("beatReadout").textContent = state.beat.toFixed(1);
  $("collapsedBeatReadout").textContent = state.beat.toFixed(1);
  $("collapsedStateName").textContent = name.toUpperCase();
  $("beatValue").textContent = `${state.beat.toFixed(1)} Hz`;
  $("carrierValue").textContent = `${Math.round(state.carrier)} Hz`;
  $("waveName").textContent = waveBand(state.beat);
  $("stateName").textContent = name.toUpperCase();
}

function markCustom() {
  state.preset = -1;
  [...presetList.children].forEach((el) => el.classList.remove("active"));
  updateReadouts("Custom");
  updateAdaptiveStatus();
}

function formatTime(seconds) {
  if (!Number.isFinite(seconds)) return "0:00";
  const minutes = Math.floor(seconds / 60);
  return `${minutes}:${String(Math.floor(seconds % 60)).padStart(2, "0")}`;
}

function updateSetSummary() {
  const analysed = playlist.filter((track) => track.status === "analysed").length;
  $("setSummary").textContent = `${playlist.length} TRACK${playlist.length === 1 ? "" : "S"} · ${analysed} ANALYSED · ON-DEVICE`;
  $("analyseSetButton").disabled = playlist.length === 0 || isAnalysingSet || isRecording;
  $("clearSetButton").disabled = playlist.length === 0 || isAnalysingSet || isRecording;
  $("sortKeyButton").disabled = playlist.length < 2 || isAnalysingSet || state.playing || isRecording || playlist.some((track) => track.status !== "analysed");
  $("recordSetButton").disabled = !isRecording && (playlist.length === 0 || isAnalysingSet || playlist.some((track) => track.status !== "analysed"));
}

function renderPlaylist() {
  const container = $("playlist");
  container.innerHTML = "";
  if (!playlist.length) {
    const empty = document.createElement("div");
    empty.className = "playlist-empty";
    empty.textContent = "Your ordered set will appear here.";
    container.appendChild(empty);
    updateSetSummary();
    return;
  }

  playlist.forEach((track, index) => {
    const row = document.createElement("div");
    row.className = `playlist-track${index === currentTrackIndex ? " current" : ""}`;
    row.dataset.trackId = track.id;

    const order = document.createElement("span");
    order.className = "track-order";
    order.textContent = String(index + 1).padStart(2, "0");

    const title = document.createElement("button");
    title.className = "track-title-button";
    title.textContent = track.name;
    title.setAttribute("aria-label", `Play ${track.name}`);
    title.disabled = track.status !== "analysed" || isAnalysingSet || isRecording;
    title.addEventListener("click", () => selectTrack(index, state.playing));

    const key = document.createElement("span");
    key.className = "track-key";
    key.textContent = track.key || "—";

    const bpm = document.createElement("span");
    bpm.className = "track-bpm";
    bpm.textContent = track.bpm ? String(Math.round(track.bpm)) : "—";
    bpm.title = track.bpm ? `${Math.round(track.bpmConfidence * 100)}% rhythm confidence` : "Not analysed";

    const time = document.createElement("span");
    time.className = "track-time";
    time.textContent = track.duration ? formatTime(track.duration) : "—";

    const status = document.createElement("span");
    status.className = `track-status${track.status === "analysing" ? " working" : ""}${track.status === "error" ? " error" : ""}`;
    status.textContent = track.status === "analysed"
      ? `${Math.round(track.confidence * 100)}% · ${Math.round((track.envelope?.quietFraction || 0) * 100)}% QUIET`
      : track.status.toUpperCase();

    const presetCue = document.createElement("select");
    presetCue.className = `preset-cue${track.presetOverride != null ? " cued" : ""}`;
    presetCue.disabled = isRecording;
    presetCue.setAttribute("aria-label", `State cue for ${track.name}`);
    [{ label: "CONTINUE", value: "" }, ...presets.map((preset, presetIndex) => ({ label: preset.name.toUpperCase(), value: String(presetIndex) }))].forEach((optionData) => {
      const option = document.createElement("option");
      option.value = optionData.value;
      option.textContent = optionData.label;
      option.selected = track.presetOverride == null ? optionData.value === "" : optionData.value === String(track.presetOverride);
      presetCue.appendChild(option);
    });
    presetCue.addEventListener("change", () => {
      track.presetOverride = presetCue.value === "" ? null : Number(presetCue.value);
      presetCue.classList.toggle("cued", track.presetOverride != null);
      if (index === currentTrackIndex && state.playing && track.presetOverride != null) applyTrackCue(track);
    });

    const actions = document.createElement("div");
    actions.className = "row-actions";
    [
      { label: "Move up", glyph: "↑", disabled: index === 0, run: () => moveTrack(index, -1) },
      { label: "Move down", glyph: "↓", disabled: index === playlist.length - 1, run: () => moveTrack(index, 1) },
      { label: "Remove", glyph: "×", disabled: isAnalysingSet, run: () => removeTrack(index) }
    ].forEach((action) => {
      const button = document.createElement("button");
      button.className = "row-action";
      button.textContent = action.glyph;
      button.setAttribute("aria-label", `${action.label} ${track.name}`);
      button.disabled = action.disabled || isAnalysingSet || isRecording;
      button.addEventListener("click", action.run);
      actions.appendChild(button);
    });

    row.append(order, title, key, bpm, time, status, presetCue, actions);
    container.appendChild(row);
  });
  updateSetSummary();
}

function moveTrack(index, direction) {
  const target = index + direction;
  if (target < 0 || target >= playlist.length) return;
  const currentId = playlist[currentTrackIndex]?.id;
  [playlist[index], playlist[target]] = [playlist[target], playlist[index]];
  currentTrackIndex = playlist.findIndex((track) => track.id === currentId);
  if (currentTrackIndex >= 0) {
    $("nowIndex").textContent = String(currentTrackIndex + 1).padStart(2, "0");
    $("trackMeta").textContent = `${(playlist[currentTrackIndex].file.size / 1048576).toFixed(1)} MB · TRACK ${currentTrackIndex + 1} OF ${playlist.length}`;
  }
  renderPlaylist();
}

function harmonicDistance(from, to) {
  if (from.tonic == null || to.tonic == null || from.confidence < KEY_CONFIDENCE_THRESHOLD || to.confidence < KEY_CONFIDENCE_THRESHOLD) return 100;
  if (from.mode !== to.mode) {
    const relative = from.mode === "MAJOR" ? (from.tonic + 9) % 12 : (from.tonic + 3) % 12;
    if (relative === to.tonic) return .2;
  }
  const circle = [0, 7, 2, 9, 4, 11, 6, 1, 8, 3, 10, 5];
  const fromPosition = circle.indexOf(from.tonic), toPosition = circle.indexOf(to.tonic);
  const steps = Math.abs(fromPosition - toPosition);
  return Math.min(steps, 12 - steps) + (from.mode === to.mode ? 0 : .35);
}

function sortPlaylistByKey() {
  if (playlist.length < 2 || state.playing || isAnalysingSet) return;
  const currentId = playlist[currentTrackIndex]?.id;
  const reliable = playlist.filter((track) => track.tonic != null && track.confidence >= KEY_CONFIDENCE_THRESHOLD);
  const uncertain = playlist.filter((track) => track.tonic == null || track.confidence < KEY_CONFIDENCE_THRESHOLD);
  if (!reliable.length) return;
  const remaining = reliable.slice(1);
  const ordered = [reliable[0]];
  while (remaining.length) {
    const previous = ordered[ordered.length - 1];
    let bestIndex = 0, bestDistance = Infinity;
    remaining.forEach((track, index) => {
      const distance = harmonicDistance(previous, track);
      if (distance < bestDistance) { bestDistance = distance; bestIndex = index; }
    });
    ordered.push(remaining.splice(bestIndex, 1)[0]);
  }
  playlist.splice(0, playlist.length, ...ordered, ...uncertain);
  currentTrackIndex = playlist.findIndex((track) => track.id === currentId);
  if (currentTrackIndex >= 0) presentTrack(currentTrackIndex);
  renderPlaylist();
}

function resetCurrentTrackUI() {
  currentTrackIndex = -1;
  cancelCrossfade();
  deckPlayers().forEach((player) => {
    player.pause();
    player.removeAttribute("src");
    player.load();
  });
  $("nowIndex").textContent = "—";
  $("trackName").textContent = "No track loaded";
  $("trackMeta").textContent = "ADD LOCAL AUDIO FILES TO BUILD A SET";
  $("trackMeta").style.color = "";
  $("detectedKey").textContent = "—";
  $("keyConfidence").textContent = "WAITING FOR AUDIO";
  $("matchStatus").textContent = "LOAD A SET TO BEGIN";
  $("autoMatchButton").disabled = true;
  $("autoLevelButton").disabled = true;
  $("autoLevelStatus").textContent = "WAITING FOR WAVEFORM";
  updateAdaptiveStatus(null);
  $("trackPosition").disabled = true;
  $("timeline").classList.add("disabled");
  $("trackEq").classList.add("disabled");
  $("currentTime").textContent = "0:00";
  $("duration").textContent = "0:00";
  $("trackPosition").value = 0;
  detectedRoot = null;
}

function removeTrack(index) {
  const wasCurrent = index === currentTrackIndex;
  const removed = playlist[index];
  playlist.splice(index, 1);
  if (wasCurrent) {
    if (playlist.length) selectTrack(Math.min(index, playlist.length - 1), state.playing);
    else resetCurrentTrackUI();
  } else if (index < currentTrackIndex) {
    currentTrackIndex -= 1;
    $("nowIndex").textContent = String(currentTrackIndex + 1).padStart(2, "0");
    $("trackMeta").textContent = `${(playlist[currentTrackIndex].file.size / 1048576).toFixed(1)} MB · TRACK ${currentTrackIndex + 1} OF ${playlist.length}`;
  }
  URL.revokeObjectURL(removed.url);
  renderPlaylist();
}

function applyTrackCue(track) {
  if (track.presetOverride != null) applyPreset(track.presetOverride);
  if (track.tonic != null) setDetectedKey(track.tonic, track.key, track.confidence);
}

function presentTrack(index, applyAudio = true) {
  const track = playlist[index];
  if (!track) return;
  currentTrackIndex = index;
  $("nowIndex").textContent = String(index + 1).padStart(2, "0");
  $("trackName").textContent = track.name;
  $("trackMeta").textContent = `${(track.file.size / 1048576).toFixed(1)} MB · TRACK ${index + 1} OF ${playlist.length}`;
  $("trackMeta").style.color = "";
  $("autoMatchButton").disabled = false;
  $("autoLevelButton").disabled = !track.envelope;
  $("trackPosition").disabled = false;
  $("timeline").classList.remove("disabled");
  $("trackEq").classList.remove("disabled");
  if (track.tonic == null) {
    detectedRoot = null;
    $("detectedKey").textContent = "…";
    $("keyConfidence").textContent = track.status === "analysing" ? "BULK ANALYSIS IN PROGRESS" : "NOT YET ANALYSED";
    $("matchStatus").textContent = "ANALYSE SET BEFORE PLAYBACK";
  }
  $("autoLevelStatus").textContent = track.envelope ? `READY · ${loudnessReadout(track)} · ${Math.round(track.envelope.quietFraction * 100)}% QUIET` : "ANALYSING WAVEFORM";
  if (state.playing && applyAudio) applyTrackCue(track);
  else if (track.tonic != null) setDetectedKey(track.tonic, track.key, track.confidence, applyAudio);
  applyDynamicToneLevel(applyAudio);
  nextRainTime = null;
  rainActive = false;
  texturePresence = 0;
  textureHoldUntil = 0;
  updateAdaptiveStatus(track);
  updateAirBed(true);
  renderPlaylist();
}

function cancelCrossfade() {
  clearTimeout(crossfadeTimer);
  crossfadeInProgress = false;
  const standby = standbyPlayer();
  standby.pause();
  standby.removeAttribute("src");
  standby.load();
  setDeckGain(activeDeck, Number($("musicVolume").value), .03);
  setDeckGain(1 - activeDeck, 0, .03);
  if (crossfadeToneTarget) {
    crossfadeToneTarget = null;
    updateAudioParams(false, .25);
    masterGain.gain.cancelScheduledValues(audioContext.currentTime);
    applyDynamicToneLevel(true);
  }
  updateAirBed(true);
}

async function selectTrack(index, autoplay = false) {
  const track = playlist[index];
  if (!track) return;
  musicQueueFinished = false;
  cancelCrossfade();
  const player = activePlayer();
  player.pause();
  player.src = track.url;
  player.load();
  presentTrack(index);
  if (autoplay) {
    try { await player.play(); } catch (error) { console.warn("The next local track could not start", error); }
  }
}

function carrierForRelation(root, relation, referenceCarrier = state.carrier) {
  const pitchClass = (root + relation) % 12;
  const currentMidi = 69 + 12 * Math.log2(referenceCarrier / 440);
  const candidates = [];
  for (let midi = 42; midi <= 53; midi++) {
    if (((midi % 12) + 12) % 12 === pitchClass) candidates.push(midi);
  }
  const selected = candidates.reduce((best, midi) => Math.abs(midi - currentMidi) < Math.abs(best - currentMidi) ? midi : best, candidates[0]);
  return { pitchClass, frequency: 440 * Math.pow(2, (selected - 69) / 12) };
}

function lowestCarrierForKey(root, referenceCarrier = state.carrier) {
  const rootCarrier = carrierForRelation(root, 0, referenceCarrier);
  const fifthCarrier = carrierForRelation(root, 7, referenceCarrier);
  return rootCarrier.frequency <= fifthCarrier.frequency
    ? { ...rootCarrier, relation: 0 }
    : { ...fifthCarrier, relation: 7 };
}

function syncRelationUI() {
  document.querySelectorAll(".relation").forEach((button) => {
    button.classList.toggle("active", Number(button.dataset.relation) === state.relation);
    button.disabled = state.autoMatch;
  });
}

function applyLowestCarrierRelation(root, referenceCarrier = state.carrier) {
  const matched = lowestCarrierForKey(root, referenceCarrier);
  state.relation = matched.relation;
  syncRelationUI();
  return matched;
}

function toneTargetForTrack(track) {
  const cue = track.presetOverride != null ? presets[track.presetOverride] : null;
  const target = {
    preset: cue ? track.presetOverride : state.preset,
    beat: cue ? cue.hz : state.beat,
    carrier: cue ? cue.carrier : state.carrier,
    levels: cue ? [...cue.levels] : [...state.levels],
    wave: state.wave,
    relation: state.relation
  };
  if (state.autoMatch && track.tonic != null && track.confidence >= KEY_CONFIDENCE_THRESHOLD) {
    const matched = lowestCarrierForKey(track.tonic, target.carrier);
    target.carrier = matched.frequency;
    target.relation = matched.relation;
  }
  return target;
}

function scheduleToneCrossfade(track, duration) {
  if (!audioContext || !voices.length) return;
  const target = toneTargetForTrack(track);
  const now = audioContext.currentTime;
  const targetSum = target.levels.reduce((sum, level) => sum + level, 0) || 1;
  voices.forEach((voice, index) => {
    const base = target.carrier * (1 + index * .36);
    const leftTarget = base - target.beat / 2;
    const rightTarget = base + target.beat / 2;
    [voice.left.frequency, voice.right.frequency, voice.leftGain.gain, voice.rightGain.gain].forEach((parameter) => {
      parameter.cancelScheduledValues(now);
      parameter.setValueAtTime(parameter.value, now);
    });
    voice.left.frequency.linearRampToValueAtTime(leftTarget, now + duration);
    voice.right.frequency.linearRampToValueAtTime(rightTarget, now + duration);
    const gainTarget = (target.levels[index] / Math.sqrt(targetSum)) * .32;
    voice.leftGain.gain.linearRampToValueAtTime(gainTarget, now + duration);
    voice.rightGain.gain.linearRampToValueAtTime(gainTarget, now + duration);
  });
  const targetScale = toneScaleForTrack(track, 0);
  masterGain.gain.cancelScheduledValues(now);
  masterGain.gain.setValueAtTime(masterGain.gain.value, now);
  masterGain.gain.linearRampToValueAtTime(state.volume * targetScale, now + duration);
  crossfadeToneTarget = target;
}

function commitToneCrossfade() {
  if (!crossfadeToneTarget) return;
  state.preset = crossfadeToneTarget.preset;
  state.beat = crossfadeToneTarget.beat;
  state.carrier = crossfadeToneTarget.carrier;
  state.levels = [...crossfadeToneTarget.levels];
  state.wave = crossfadeToneTarget.wave;
  state.relation = crossfadeToneTarget.relation;
  $("beatFrequency").value = state.beat;
  $("carrierFrequency").value = Math.round(state.carrier);
  syncFaders();
  updateReadouts(state.preset >= 0 ? presets[state.preset].name : "Custom");
  [...presetList.children].forEach((element, index) => element.classList.toggle("active", index === state.preset));
  syncRelationUI();
  crossfadeToneTarget = null;
}

async function startCrossfade() {
  const nextIndex = currentTrackIndex + 1;
  if (!state.crossfade || crossfadeInProgress || nextIndex >= playlist.length || playlist[nextIndex].status !== "analysed") return;
  const nextDeck = 1 - activeDeck;
  const nextPlayer = deckPlayers()[nextDeck];
  nextPlayer.src = playlist[nextIndex].url;
  nextPlayer.currentTime = 0;
  nextPlayer.load();
  setDeckGain(nextDeck, 0, .01);
  try { await nextPlayer.play(); }
  catch (error) { console.warn("Crossfade could not start", error); return; }

  crossfadeInProgress = true;
  const now = audioContext.currentTime;
  const duration = state.crossfadeSeconds;
  const targetVolume = Number($("musicVolume").value);
  [activeDeck, nextDeck].forEach((deck) => musicGains[deck].gain.cancelScheduledValues(now));
  const curveSteps = 64;
  const fadeOut = new Float32Array(curveSteps), fadeIn = new Float32Array(curveSteps);
  const currentVolume = Math.max(0, musicGains[activeDeck].gain.value);
  for (let step = 0; step < curveSteps; step++) {
    const progress = step / (curveSteps - 1);
    const centrePocket = 1 - .52 * Math.pow(Math.sin(progress * Math.PI), 6);
    fadeOut[step] = Math.cos(progress * Math.PI / 2) * currentVolume * centrePocket;
    fadeIn[step] = Math.sin(progress * Math.PI / 2) * targetVolume * centrePocket;
  }
  musicGains[activeDeck].gain.setValueCurveAtTime(fadeOut, now, duration);
  musicGains[nextDeck].gain.setValueCurveAtTime(fadeIn, now, duration);
  scheduleToneCrossfade(playlist[nextIndex], duration);
  updateAirBed(true);
  scheduleTransitionTexture(now, duration);
  $("playStatus").textContent = `${isRecording ? "REC " : ""}CROSSFADE ${currentTrackIndex + 1}→${nextIndex + 1}`;
  crossfadeTimer = setTimeout(finishCrossfade, duration * 1000);
}

function finishCrossfade() {
  if (!crossfadeInProgress) return;
  const previousDeck = activeDeck;
  deckPlayers()[previousDeck].pause();
  deckPlayers()[previousDeck].removeAttribute("src");
  deckPlayers()[previousDeck].load();
  activeDeck = 1 - activeDeck;
  currentTrackIndex += 1;
  crossfadeInProgress = false;
  clearTimeout(crossfadeTimer);
  commitToneCrossfade();
  setDeckGain(previousDeck, 0, .01);
  setDeckGain(activeDeck, Number($("musicVolume").value), .03);
  presentTrack(currentTrackIndex, false);
  nextRainTime = null;
  updateAirBed(true);
  $("playStatus").textContent = `${isRecording ? "RECORDING" : "PLAYING"} ${currentTrackIndex + 1}/${playlist.length}`;
}

function maybeStartCrossfade() {
  if (!state.playing || !state.crossfade || crossfadeInProgress) return;
  const player = activePlayer();
  if (Number.isFinite(player.duration) && player.duration - player.currentTime <= state.crossfadeSeconds && player.duration - player.currentTime > .15) startCrossfade();
}

function profileScore(chroma, profile, tonic) {
  let dot = 0, chromaEnergy = 0, profileEnergy = 0;
  for (let i = 0; i < 12; i++) {
    const value = chroma[(i + tonic) % 12];
    dot += value * profile[i];
    chromaEnergy += value * value;
    profileEnergy += profile[i] * profile[i];
  }
  return dot / (Math.sqrt(chromaEnergy * profileEnergy) || 1);
}

function rankKey(chroma) {
  const scores = [];
  for (let tonic = 0; tonic < 12; tonic++) {
    scores.push({ tonic, mode: "MAJOR", score: profileScore(chroma, majorProfile, tonic) });
    scores.push({ tonic, mode: "MINOR", score: profileScore(chroma, minorProfile, tonic) });
  }
  scores.sort((a, b) => b.score - a.score);
  const best = scores[0], second = scores[1];
  const confidence = Math.max(0, Math.min(1, (best.score - second.score) * 7 + (best.score - .55) * 1.2));
  return { ...best, confidence, label: `${noteNames[best.tonic]} ${best.mode === "MAJOR" ? "MAJ" : "MIN"}` };
}

function fft(real, imaginary) {
  const size = real.length;
  for (let i = 1, j = 0; i < size; i++) {
    let bit = size >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      [real[i], real[j]] = [real[j], real[i]];
      [imaginary[i], imaginary[j]] = [imaginary[j], imaginary[i]];
    }
  }
  for (let length = 2; length <= size; length <<= 1) {
    const angle = -2 * Math.PI / length;
    const stepReal = Math.cos(angle), stepImaginary = Math.sin(angle);
    for (let start = 0; start < size; start += length) {
      let wReal = 1, wImaginary = 0;
      for (let offset = 0; offset < length / 2; offset++) {
        const even = start + offset, odd = even + length / 2;
        const oddReal = real[odd] * wReal - imaginary[odd] * wImaginary;
        const oddImaginary = real[odd] * wImaginary + imaginary[odd] * wReal;
        real[odd] = real[even] - oddReal;
        imaginary[odd] = imaginary[even] - oddImaginary;
        real[even] += oddReal;
        imaginary[even] += oddImaginary;
        const nextReal = wReal * stepReal - wImaginary * stepImaginary;
        wImaginary = wReal * stepImaginary + wImaginary * stepReal;
        wReal = nextReal;
      }
    }
  }
}

async function analyseRhythm(buffer, channels) {
  const envelopeRate = 100;
  const hop = Math.max(1, Math.floor(buffer.sampleRate / envelopeRate));
  const frameCount = Math.max(1, Math.floor(buffer.length / hop));
  const energy = new Float32Array(frameCount);
  const novelty = new Float32Array(frameCount);
  let running = 0;
  for (let frame = 0; frame < frameCount; frame++) {
    const start = frame * hop;
    const end = Math.min(buffer.length, start + hop);
    let sum = 0, samples = 0;
    for (let sample = start; sample < end; sample += 4) {
      let value = 0;
      channels.forEach((channel) => { value += Math.abs(channel[sample] || 0); });
      sum += value / channels.length;
      samples += 1;
    }
    energy[frame] = Math.log1p(36 * sum / Math.max(1, samples));
    running = running * .93 + energy[frame] * .07;
    novelty[frame] = Math.max(0, energy[frame] - running);
    if (frame % 5000 === 4999) await new Promise((resolve) => requestAnimationFrame(resolve));
  }

  const mean = novelty.reduce((sum, value) => sum + value, 0) / novelty.length;
  let variance = 0;
  novelty.forEach((value) => { variance += (value - mean) ** 2; });
  const deviation = Math.sqrt(variance / novelty.length) || 1;
  novelty.forEach((value, index) => { novelty[index] = Math.max(0, (value - mean * .7) / deviation); });
  // Ignore decoder/startup transients; a sustained drone must not look rhythmic.
  novelty.fill(0, 0, Math.min(novelty.length, envelopeRate * 2));
  let activeOnsets = 0;
  novelty.forEach((value) => { if (value > .35) activeOnsets += 1; });

  const minLag = Math.round(envelopeRate * 60 / 200);
  const maxLag = Math.min(frameCount - 1, Math.round(envelopeRate * 60 / 60));
  const scores = [];
  for (let lag = minLag; lag <= maxLag; lag++) {
    let correlation = 0, normA = 0, normB = 0;
    for (let i = lag; i < frameCount; i++) {
      correlation += novelty[i] * novelty[i - lag];
      normA += novelty[i] * novelty[i];
      normB += novelty[i - lag] * novelty[i - lag];
    }
    const bpm = 60 * envelopeRate / lag;
    const normalized = correlation / (Math.sqrt(normA * normB) || 1);
    const tempoPrior = .94 + .06 * Math.exp(-(((bpm - 120) / 55) ** 2));
    scores.push({ lag, bpm, score: normalized * tempoPrior });
  }
  scores.sort((a, b) => b.score - a.score);
  const best = scores[0] || { lag: envelopeRate / 2, bpm: 120, score: 0 };
  const alternatives = scores.filter((candidate) => Math.abs(candidate.lag - best.lag) > 3);
  const baseline = alternatives.reduce((sum, candidate) => sum + candidate.score, 0) / Math.max(1, alternatives.length);
  const second = alternatives[0]?.score || baseline;
  const clarity = Math.max(0, (best.score - baseline) / Math.max(.03, 1 - baseline));
  const separation = Math.max(0, (best.score - second) / Math.max(.03, best.score));
  const pulseStrength = Math.min(1, deviation * 2.8);
  const activityGate = Math.min(1, (activeOnsets / novelty.length) / .025);
  const confidence = Math.max(0, Math.min(1, (clarity * .7 + separation * .3) * pulseStrength * activityGate * 3.1));

  let bestPhase = 0, bestPhaseScore = -1;
  for (let phase = 0; phase < best.lag; phase++) {
    let score = 0;
    for (let i = phase; i < novelty.length; i += best.lag) score += novelty[i];
    if (score > bestPhaseScore) { bestPhaseScore = score; bestPhase = phase; }
  }
  return { bpm: best.bpm, confidence, beatOffset: bestPhase / envelopeRate };
}

async function analyseAudioBuffer(buffer) {
  const fftSize = 8192;
  const available = Math.max(1, buffer.length - fftSize);
  const windowCount = Math.min(36, Math.max(10, Math.floor(buffer.duration / 5)));
  const chroma = new Float64Array(12);
  const real = new Float64Array(fftSize);
  const imaginary = new Float64Array(fftSize);
  const channels = Array.from({ length: Math.min(2, buffer.numberOfChannels) }, (_, index) => buffer.getChannelData(index));

  for (let windowIndex = 0; windowIndex < windowCount; windowIndex++) {
    const start = Math.floor(available * (windowIndex + .5) / windowCount);
    real.fill(0); imaginary.fill(0);
    for (let sample = 0; sample < fftSize; sample++) {
      const sourceIndex = start + sample;
      let value = 0;
      if (sourceIndex < buffer.length) {
        channels.forEach((channel) => { value += channel[sourceIndex]; });
        value /= channels.length;
      }
      real[sample] = value * (.5 - .5 * Math.cos(2 * Math.PI * sample / (fftSize - 1)));
    }
    fft(real, imaginary);
    const minBin = Math.ceil(65 * fftSize / buffer.sampleRate);
    const maxBin = Math.min(fftSize / 2, Math.floor(1800 * fftSize / buffer.sampleRate));
    for (let bin = minBin; bin <= maxBin; bin++) {
      const frequency = bin * buffer.sampleRate / fftSize;
      const magnitude = Math.hypot(real[bin], imaginary[bin]);
      if (magnitude < .0001) continue;
      const midi = Math.round(69 + 12 * Math.log2(frequency / 440));
      const pitchClass = ((midi % 12) + 12) % 12;
      chroma[pitchClass] += magnitude / Math.pow(frequency / 220, .42);
    }
    if (windowIndex % 3 === 2) await new Promise((resolve) => requestAnimationFrame(resolve));
  }
  const keyResult = rankKey(chroma);
  const envelope = await analyseLoudnessEnvelope(buffer, channels);
  const rhythm = await analyseRhythm(buffer, channels);
  return { ...keyResult, envelope, rhythm };
}

async function analyseLoudnessEnvelope(buffer, channels) {
  const pointsPerSecond = Math.max(.5, Math.min(4, 12000 / Math.max(1, buffer.duration)));
  const pointCount = Math.max(1, Math.ceil(buffer.duration * pointsPerSecond));
  const samplesPerPoint = buffer.sampleRate / pointsPerSecond;
  const stride = Math.max(1, Math.floor(buffer.sampleRate / 1200));
  const decibels = new Float32Array(pointCount);

  for (let point = 0; point < pointCount; point++) {
    const start = Math.floor(point * samplesPerPoint);
    const end = Math.min(buffer.length, Math.floor((point + 1) * samplesPerPoint));
    let energy = 0, samples = 0;
    for (let sample = start; sample < end; sample += stride) {
      let sampleEnergy = 0;
      channels.forEach((channel) => {
        const value = channel[sample] || 0;
        sampleEnergy += value * value;
      });
      energy += sampleEnergy / channels.length;
      samples += 1;
    }
    const rms = Math.sqrt(energy / Math.max(1, samples));
    decibels[point] = 20 * Math.log10(Math.max(rms, 1e-6));
    if (point % 240 === 239) await new Promise((resolve) => requestAnimationFrame(resolve));
  }

  const sorted = Array.from(decibels).sort((a, b) => a - b);
  const percentile = (value) => sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * value))];
  const low = Math.max(-54, percentile(.12));
  const high = Math.max(low + 8, percentile(.82));
  let loudnessEnergy = 0, audiblePoints = 0;
  decibels.forEach((decibelsAtPoint) => {
    if (decibelsAtPoint <= -58) return;
    loudnessEnergy += Math.pow(10, decibelsAtPoint / 10);
    audiblePoints += 1;
  });
  const integratedDb = 10 * Math.log10(Math.max(1e-8, loudnessEnergy / Math.max(1, audiblePoints)));
  // About -14 dBFS RMS is neutral. Preserve modern masters while allowing a
  // quieter, dynamic master to lower generated layers by as much as ~6 dB.
  const loudnessScale = Math.max(.5, Math.min(1.08, Math.pow(10, (integratedDb + 14) / 20)));
  const values = new Float32Array(pointCount);
  let quietPoints = 0;
  for (let point = 0; point < pointCount; point++) {
    if (decibels[point] < -58) values[point] = 0;
    else values[point] = Math.max(0, Math.min(1, (decibels[point] - low) / (high - low)));
    if (values[point] < .16) quietPoints += 1;
  }

  // Build a slow, look-ahead bed: brief gaps and stutters inherit nearby energy,
  // while sustained silence only lowers the tone to a constant-presence floor.
  const radius = Math.max(1, Math.ceil(pointsPerSecond * 2.5));
  const desired = new Float32Array(pointCount);
  for (let point = 0; point < pointCount; point++) {
    let peak = 0, sum = 0, count = 0;
    for (let nearby = Math.max(0, point - radius); nearby <= Math.min(pointCount - 1, point + radius); nearby++) {
      peak = Math.max(peak, values[nearby]);
      sum += values[nearby];
      count += 1;
    }
    const contextualEnergy = peak * .68 + (sum / count) * .32;
    desired[point] = .62 + .38 * Math.pow(contextualEnergy, .65);
  }
  const forward = new Float32Array(pointCount), backward = new Float32Array(pointCount);
  const smoothing = 1 - Math.exp(-1 / Math.max(1, pointsPerSecond * 2.2));
  forward[0] = desired[0];
  for (let point = 1; point < pointCount; point++) forward[point] = forward[point - 1] + smoothing * (desired[point] - forward[point - 1]);
  backward[pointCount - 1] = desired[pointCount - 1];
  for (let point = pointCount - 2; point >= 0; point--) backward[point] = backward[point + 1] + smoothing * (desired[point] - backward[point + 1]);
  const toneValues = new Float32Array(pointCount);
  for (let point = 0; point < pointCount; point++) toneValues[point] = (forward[point] + backward[point]) / 2;
  return { values, toneValues, pointsPerSecond, quietFraction: quietPoints / pointCount, integratedDb, loudnessScale };
}

async function analyseSet(force = false) {
  if (isAnalysingSet || !playlist.length) return;
  if (!createAudio()) {
    $("playStatus").textContent = "AUDIO UNSUPPORTED";
    return;
  }
  if (audioContext.state === "suspended") await audioContext.resume();
  isAnalysingSet = true;
  $("audioFile").disabled = true;
  const targets = playlist.filter((track) => force || track.status !== "analysed");
  $("analyseSetButton").textContent = "ANALYSING 0/" + targets.length;
  renderPlaylist();

  for (let index = 0; index < targets.length; index++) {
    const track = targets[index];
    track.status = "analysing";
    $("analyseSetButton").textContent = `ANALYSING ${index + 1}/${targets.length}`;
    if (playlist[currentTrackIndex]?.id === track.id) {
      $("detectedKey").textContent = "…";
      $("keyConfidence").textContent = `WHOLE-TRACK ANALYSIS · ${index + 1}/${targets.length}`;
    }
    renderPlaylist();
    try {
      const fileData = await track.file.arrayBuffer();
      const decoded = await audioContext.decodeAudioData(fileData);
      const result = await analyseAudioBuffer(decoded);
      track.duration = decoded.duration;
      track.key = result.label;
      track.tonic = result.tonic;
      track.mode = result.mode;
      track.confidence = result.confidence;
      track.envelope = result.envelope;
      track.bpm = result.rhythm.bpm;
      track.bpmConfidence = result.rhythm.confidence;
      track.beatOffset = result.rhythm.beatOffset;
      track.status = "analysed";
      if (playlist[currentTrackIndex]?.id === track.id) {
        setDetectedKey(track.tonic, track.key, track.confidence);
        $("autoLevelButton").disabled = false;
        $("autoLevelStatus").textContent = `READY · ${loudnessReadout(track)} · ${Math.round(track.envelope.quietFraction * 100)}% QUIET`;
        updateAdaptiveStatus(track);
      }
    } catch (error) {
      track.status = "error";
      track.error = "Could not decode";
      console.warn(`Could not analyse ${track.name}`, error);
    }
    renderPlaylist();
  }

  isAnalysingSet = false;
  $("audioFile").disabled = false;
  $("analyseSetButton").textContent = "ANALYSE SET";
  renderPlaylist();
  if (currentTrackIndex >= 0 && playlist[currentTrackIndex]?.status === "analysed") {
    const current = playlist[currentTrackIndex];
    setDetectedKey(current.tonic, current.key, current.confidence);
    $("duration").textContent = formatTime(current.duration);
    applyDynamicToneLevel(true);
  }
  $("playStatus").textContent = playlist.every((track) => track.status === "analysed") ? "SET READY" : "CHECK FILES";
}

function setDetectedKey(root, label, confidence, applyMatch = true) {
  const changed = $("detectedKey").textContent !== label;
  $("detectedKey").textContent = label;
  const reliable = confidence >= KEY_CONFIDENCE_THRESHOLD;
  detectedRoot = reliable ? root : null;
  $("keyConfidence").textContent = `${Math.round(confidence * 100)}% CONFIDENCE · ${reliable ? "KEY LOCKED" : "LOW · CARRIER HELD"}`;
  if (changed) {
    const display = document.querySelector(".key-display");
    display.classList.remove("key-change");
    requestAnimationFrame(() => display.classList.add("key-change"));
  }
  if (state.autoMatch && reliable && applyMatch) matchCarrierToKey();
  else if (state.autoMatch && reliable) {
    const matched = applyLowestCarrierRelation(root);
    $("matchStatus").textContent = `${matched.relation === 0 ? "ROOT" : "FIFTH"} · ${noteNames[matched.pitchClass]} · ${matched.frequency.toFixed(1)} HZ`;
  }
  else if (state.autoMatch) $("matchStatus").textContent = `HELD AT ${state.carrier.toFixed(1)} HZ`;
}

function toneScaleForTrack(track, time) {
  if (!state.autoLevel || !track?.envelope?.toneValues?.length) return 1;
  const envelopeIndex = Math.min(track.envelope.toneValues.length - 1, Math.floor(time * track.envelope.pointsPerSecond));
  const maskingScale = track.envelope.toneValues[envelopeIndex];
  const confidenceScale = track.confidence < KEY_CONFIDENCE_THRESHOLD
    ? .82 + .18 * (track.confidence / KEY_CONFIDENCE_THRESHOLD)
    : 1;
  return Math.max(.28, Math.min(1.08, maskingScale * confidenceScale * trackLoudnessScale(track)));
}

function currentToneScale() {
  const track = playlist[currentTrackIndex];
  return toneScaleForTrack(track, activePlayer().currentTime) * breathingScale(track, activePlayer().currentTime);
}

function applyDynamicToneLevel(immediate = false) {
  state.toneScale = currentToneScale();
  const percentage = Math.round(state.toneScale * 100);
  const track = playlist[currentTrackIndex];
  const reason = track?.confidence < KEY_CONFIDENCE_THRESHOLD ? "LOW CONFIDENCE BED" : trackLoudnessScale(track) < .78 ? "QUIET MASTER" : state.toneScale < .72 ? "QUIET BED" : "CONSTANT BED";
  $("autoLevelStatus").textContent = state.autoLevel ? `${percentage}% · ${reason} · ${loudnessReadout(track)}` : "FIXED OUTPUT";
  if (audioContext && state.playing && !crossfadeInProgress) {
    masterGain.gain.setTargetAtTime(state.volume * state.toneScale, audioContext.currentTime, immediate ? .08 : .85);
  }
}

function matchCarrierToKey() {
  if (detectedRoot == null) return;
  const matched = applyLowestCarrierRelation(detectedRoot);
  const target = matched.frequency;
  $("matchStatus").textContent = `${matched.relation === 0 ? "ROOT" : "FIFTH"} · ${noteNames[matched.pitchClass]} · ${target.toFixed(1)} HZ`;
  if (Math.abs(target - state.carrier) < .5) return;
  state.carrier = target;
  $("carrierFrequency").value = Math.round(target);
  updateReadouts();
  updateAudioParams(false, .65);
}

$("playButton").addEventListener("click", togglePlay);
$("studioToggle").addEventListener("click", () => {
  const collapsed = $("studio").classList.toggle("collapsed");
  $("studioToggle").setAttribute("aria-expanded", String(!collapsed));
  $("studioToggle").querySelector("b").textContent = collapsed ? "MANUAL TONE CONTROLS" : "HIDE MANUAL CONTROLS";
});
$("beatFrequency").addEventListener("input", (event) => {
  state.beat = Number(event.target.value); markCustom(); updateAudioParams();
});
$("carrierFrequency").addEventListener("input", (event) => {
  state.carrier = Number(event.target.value);
  if (state.autoMatch) {
    state.autoMatch = false;
    $("autoMatchButton").classList.remove("active");
    $("autoMatchButton").setAttribute("aria-pressed", "false");
    $("matchStatus").textContent = "MANUAL CARRIER";
  }
  markCustom(); updateAudioParams();
});
$("masterVolume").addEventListener("input", (event) => {
  state.volume = Number(event.target.value);
  $("volumeValue").textContent = `${Math.round(state.volume * 100)}%`;
  if (audioContext && state.playing) applyDynamicToneLevel(true);
});

$("audioFile").addEventListener("change", (event) => {
  const files = [...(event.target.files || [])];
  if (!files.length) return;
  files.forEach((file) => playlist.push({
    id: `track-${++trackSequence}`,
    file,
    url: URL.createObjectURL(file),
    name: file.name.replace(/\.[^.]+$/, ""),
    duration: 0,
    key: "",
    tonic: null,
    confidence: 0,
    bpm: 0,
    bpmConfidence: 0,
    beatOffset: 0,
    presetOverride: null,
    status: "queued"
  }));
  musicQueueFinished = false;
  event.target.value = "";
  if (currentTrackIndex < 0) selectTrack(0, false);
  renderPlaylist();
  analyseSet(false);
});

$("spokenAudioFile").addEventListener("change", (event) => {
  const files = [...(event.target.files || [])];
  if (!files.length) return;
  files.forEach((file) => spokenQueue.push({
    id: `spoken-${++spokenTrackSequence}`,
    type: "audio",
    file,
    url: URL.createObjectURL(file),
    name: file.name.replace(/\.[^.]+$/, ""),
    duration: 0
  }));
  spokenQueueFinished = false;
  event.target.value = "";
  if (spokenIndex < 0) selectSpokenItem(0, state.playing);
  renderSpokenQueue();
});

$("addSilenceButton").addEventListener("click", () => {
  const seconds = Math.min(3600, Math.max(1, Math.round(Number($("silenceDuration").value) || 30)));
  $("silenceDuration").value = seconds;
  spokenQueue.push(createSilenceItem(seconds));
  spokenQueueFinished = false;
  if (spokenIndex < 0) selectSpokenItem(0, state.playing);
  renderSpokenQueue();
});

$("addRandomGapsButton").addEventListener("click", () => {
  if (isRecording) return;
  const currentId = spokenQueue[spokenIndex]?.id;
  const wasFinished = spokenQueueFinished;
  const expandedQueue = [];
  let inserted = 0;
  spokenQueue.forEach((item, index) => {
    expandedQueue.push(item);
    if (item.type !== "audio") return;
    const nextAudioIndex = spokenQueue.findIndex((candidate, candidateIndex) => candidateIndex > index && candidate.type === "audio");
    if (nextAudioIndex < 0) return;
    const alreadyHasPause = spokenQueue.slice(index + 1, nextAudioIndex).some((candidate) => candidate.type === "silence");
    if (alreadyHasPause) return;
    const seconds = Math.round((.5 + Math.random() * 2) * 10) / 10;
    expandedQueue.push(createSilenceItem(seconds));
    inserted += 1;
  });
  if (!inserted) return;
  spokenQueue.splice(0, spokenQueue.length, ...expandedQueue);
  spokenIndex = spokenQueue.findIndex((item) => item.id === currentId);
  spokenQueueFinished = wasFinished;
  const currentItem = spokenQueue[spokenIndex];
  if (currentItem?.type === "audio") {
    $("spokenMeta").textContent = `${(currentItem.file.size / 1048576).toFixed(1)} MB · ITEM ${spokenIndex + 1} OF ${spokenQueue.length}`;
  }
  renderSpokenQueue();
});

$("clearSpokenButton").addEventListener("click", () => {
  spokenQueue.forEach((item) => { if (item.type === "audio") URL.revokeObjectURL(item.url); });
  spokenQueue.length = 0;
  resetSpokenDeck();
  renderSpokenQueue();
  maybeFinishCombinedPlayback();
});

$("spokenVolume").addEventListener("input", (event) => {
  const value = Number(event.target.value);
  $("spokenVolumeValue").textContent = `${Math.round(value * 100)}%`;
  if (audioContext && spokenOutput) spokenOutput.gain.setTargetAtTime(value, audioContext.currentTime, .04);
});

$("spokenReverb").addEventListener("input", (event) => {
  $("spokenReverbValue").textContent = `${Math.round(Number(event.target.value) * 100)}%`;
  updateSpokenReverb();
});

$("spokenPosition").addEventListener("input", (event) => {
  if (spokenQueue[spokenIndex]?.type === "audio") spokenPlayer().currentTime = Number(event.target.value);
});

$("analyseSetButton").addEventListener("click", () => analyseSet(true));
$("sortKeyButton").addEventListener("click", sortPlaylistByKey);
$("clearSetButton").addEventListener("click", () => {
  if (isRecording) stopSetRecording(false);
  if (state.playing && activePlayer().src) {
    state.playing = false;
    deckPlayers().forEach((player) => player.pause());
    pauseSpokenDeck();
    if (audioContext) masterGain.gain.setTargetAtTime(0, audioContext.currentTime, .06);
    stopAdaptiveAudio();
    document.body.classList.remove("playing");
    $("playButton").setAttribute("aria-pressed", "false");
    $("playButton").setAttribute("aria-label", "Start audio");
  }
  playlist.forEach((track) => URL.revokeObjectURL(track.url));
  playlist.length = 0;
  musicQueueFinished = true;
  resetCurrentTrackUI();
  renderPlaylist();
  $("playStatus").textContent = "READY";
});

deckPlayers().forEach((player) => {
  player.addEventListener("loadedmetadata", () => {
    if (player !== activePlayer()) return;
    $("duration").textContent = formatTime(player.duration);
    $("trackPosition").max = player.duration || 100;
    const current = playlist[currentTrackIndex];
    if (current && !current.duration) { current.duration = player.duration; renderPlaylist(); }
  });
  player.addEventListener("error", () => {
    if (player !== activePlayer()) return;
    $("trackMeta").textContent = "THIS AUDIO FORMAT COULD NOT BE DECODED BY THE BROWSER";
    $("trackMeta").style.color = "#ff815d";
    $("playStatus").textContent = "FILE ERROR";
    const current = playlist[currentTrackIndex];
    if (current && current.status !== "analysing") { current.status = "error"; renderPlaylist(); }
  });
  player.addEventListener("timeupdate", () => {
    if (player !== activePlayer()) return;
    $("currentTime").textContent = formatTime(player.currentTime);
    if (!$("trackPosition").matches(":active")) $("trackPosition").value = player.currentTime;
    applyDynamicToneLevel();
    maybeStartCrossfade();
  });
  player.addEventListener("ended", () => {
    if (player !== activePlayer() || !state.playing) return;
    if (crossfadeInProgress) { finishCrossfade(); return; }
    const nextIndex = currentTrackIndex + 1;
    if (nextIndex < playlist.length && playlist[nextIndex].status === "analysed") {
      selectTrack(nextIndex, true);
      $("playStatus").textContent = `PLAYING ${nextIndex + 1}/${playlist.length}`;
      return;
    }
    musicQueueFinished = true;
    if (audioContext) masterGain.gain.setTargetAtTime(0, audioContext.currentTime, .06);
    stopAdaptiveAudio();
    if (!spokenQueueFinished) $("playStatus").textContent = `${isRecording ? "RECORDING" : "PLAYING"} DECK 02`;
    maybeFinishCombinedPlayback();
  });
});

spokenPlayer().addEventListener("loadedmetadata", () => {
  const item = spokenQueue[spokenIndex];
  if (!item || item.type !== "audio") return;
  item.duration = spokenPlayer().duration || 0;
  $("spokenDuration").textContent = formatTime(item.duration);
  $("spokenPosition").max = item.duration || 100;
  renderSpokenQueue();
});
spokenPlayer().addEventListener("timeupdate", () => {
  const item = spokenQueue[spokenIndex];
  if (!item || item.type !== "audio") return;
  $("spokenCurrentTime").textContent = formatTime(spokenPlayer().currentTime);
  if (!$("spokenPosition").matches(":active")) $("spokenPosition").value = spokenPlayer().currentTime;
});
spokenPlayer().addEventListener("ended", advanceSpokenQueue);
spokenPlayer().addEventListener("error", () => {
  const item = spokenQueue[spokenIndex];
  if (!item || item.type !== "audio" || !spokenPlayer().getAttribute("src")) return;
  $("spokenMeta").textContent = "THIS AUDIOBOOK CODEC COULD NOT BE DECODED BY THE BROWSER";
  $("spokenMeta").style.color = "#ff815d";
});
$("trackPosition").addEventListener("input", (event) => {
  if (crossfadeInProgress) cancelCrossfade();
  activePlayer().currentTime = Number(event.target.value);
});
$("musicVolume").addEventListener("input", (event) => {
  if (!crossfadeInProgress) setDeckGain(activeDeck, Number(event.target.value), .04);
});
[["eqLow", "low"], ["eqMid", "mid"], ["eqHigh", "high"]].forEach(([id, band]) => {
  const input = $(id);
  input.addEventListener("input", () => syncEqControl(band));
  input.addEventListener("dblclick", () => {
    input.value = 0;
    syncEqControl(band);
  });
});
$("crossfadeButton").addEventListener("click", () => {
  state.crossfade = !state.crossfade;
  $("crossfadeButton").classList.toggle("active", state.crossfade);
  $("crossfadeButton").setAttribute("aria-pressed", String(state.crossfade));
  if (!state.crossfade && crossfadeInProgress) cancelCrossfade();
});
$("crossfadeSeconds").addEventListener("input", (event) => {
  state.crossfadeSeconds = Number(event.target.value);
  $("crossfadeValue").textContent = `${state.crossfadeSeconds}s`;
});
function bindAdaptiveToggle(id, key) {
  $(id).addEventListener("click", () => {
    state[key] = !state[key];
    $(id).classList.toggle("active", state[key]);
    $(id).setAttribute("aria-pressed", String(state[key]));
    updateAdaptiveStatus();
    updateAirBed(true);
    if (key === "impulse") {
      nextRainTime = null;
      texturePresence = 0;
      textureHoldUntil = 0;
    }
    if (key === "breathing") applyDynamicToneLevel(true);
  });
}
bindAdaptiveToggle("impulseButton", "impulse");
bindAdaptiveToggle("airButton", "air");
bindAdaptiveToggle("breathButton", "breathing");
bindAdaptiveToggle("spatialButton", "spatial");
$("textureIntensity").addEventListener("input", (event) => {
  state.textureIntensity = Number(event.target.value);
  $("textureValue").textContent = `${Math.round(state.textureIntensity * 100)}%`;
  updateAirBed(true);
});
$("impulseAmount").addEventListener("input", (event) => {
  state.impulseAmount = Number(event.target.value);
  $("impulseAmountValue").textContent = `${Math.round(state.impulseAmount * 100)}%`;
  // Let a newly increased amount discover the current window immediately.
  nextRainTime = null;
});
$("recordSetButton").addEventListener("click", async () => {
  if (isRecording) {
    if (state.playing) await togglePlay();
    $("playStatus").textContent = "SAVING RECORDING";
    await stopSetRecording(true);
  } else await startSetRecording();
});
$("autoMatchButton").addEventListener("click", () => {
  state.autoMatch = !state.autoMatch;
  $("autoMatchButton").classList.toggle("active", state.autoMatch);
  $("autoMatchButton").setAttribute("aria-pressed", String(state.autoMatch));
  $("matchStatus").textContent = state.autoMatch ? (detectedRoot == null ? "AWAITING ANALYSIS" : "MATCHING ANALYSED KEY") : "MANUAL CARRIER";
  syncRelationUI();
  if (state.autoMatch) matchCarrierToKey();
});
$("autoLevelButton").addEventListener("click", () => {
  state.autoLevel = !state.autoLevel;
  $("autoLevelButton").classList.toggle("active", state.autoLevel);
  $("autoLevelButton").setAttribute("aria-pressed", String(state.autoLevel));
  applyDynamicToneLevel(true);
});
document.querySelectorAll(".relation").forEach((button) => button.addEventListener("click", () => {
  state.relation = Number(button.dataset.relation);
  document.querySelectorAll(".relation").forEach((el) => el.classList.toggle("active", el === button));
  if (state.autoMatch) matchCarrierToKey();
}));
window.addEventListener("beforeunload", () => {
  playlist.forEach((track) => URL.revokeObjectURL(track.url));
  spokenQueue.forEach((item) => { if (item.type === "audio") URL.revokeObjectURL(item.url); });
});

document.querySelectorAll(".tone").forEach((button) => button.addEventListener("click", () => {
  state.wave = button.dataset.wave;
  document.querySelectorAll(".tone").forEach((el) => el.classList.toggle("active", el === button));
  updateAudioParams();
}));

$("shuffleButton").addEventListener("click", () => {
  state.levels = state.levels.map((value, i) => Math.min(1, Math.max(.02, value + (Math.random() - .5) * (i < 3 ? .28 : .18))));
  syncFaders(); markCustom(); updateVoiceGains();
});
$("resetButton").addEventListener("click", () => applyPreset(state.preset >= 0 ? state.preset : 3));
$("infoButton").addEventListener("click", () => $("infoDialog").showModal());
$("closeDialog").addEventListener("click", () => $("infoDialog").close());
$("infoDialog").addEventListener("click", (event) => { if (event.target === $("infoDialog")) $("infoDialog").close(); });

// Animated interference field — restrained while idle, more alive during playback.
const canvas = $("field");
const ctx = canvas.getContext("2d");
let time = 0;
function resizeCanvas() {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  canvas.width = innerWidth * dpr; canvas.height = innerHeight * dpr;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}
function drawField() {
  const w = innerWidth, h = innerHeight;
  ctx.fillStyle = "#090907"; ctx.fillRect(0, 0, w, h);
  const glow = ctx.createRadialGradient(w * .69, h * .35, 0, w * .69, h * .35, w * .58);
  glow.addColorStop(0, "rgba(116,67,23,.34)"); glow.addColorStop(.45, "rgba(45,37,20,.14)"); glow.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = glow; ctx.fillRect(0, 0, w, h);
  const spacing = Math.max(22, Math.min(42, w / 36));
  ctx.lineWidth = 1;
  for (let x = -spacing * 2; x < w + spacing * 2; x += spacing) {
    ctx.beginPath();
    for (let y = -20; y <= h + 20; y += 10) {
      const energy = state.playing ? 1 : .32;
      const offset = Math.sin(y * .011 + time + x * .004) * 9 * energy + Math.sin(y * .004 - time * .55) * 14;
      const px = x + offset;
      if (y === -20) ctx.moveTo(px, y); else ctx.lineTo(px, y);
    }
    const proximity = 1 - Math.min(1, Math.abs(x - w * .65) / (w * .7));
    ctx.strokeStyle = `rgba(239,158,71,${.055 + proximity * .09})`;
    ctx.stroke();
  }
  time += state.playing ? .012 + state.beat * .00035 : .0025;
  requestAnimationFrame(drawField);
}

window.addEventListener("resize", resizeCanvas);
buildUI(); renderPlaylist(); renderSpokenQueue(); updateReadouts(); updateAdaptiveStatus(null); resizeCanvas(); drawField();
