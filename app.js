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
const state = { preset: 3, beat: 8, carrier: 130, volume: .35, wave: "sine", levels: [...presets[3].levels], playing: false, autoMatch: true, autoLevel: true, toneScale: 1, relation: 0, crossfade: true, crossfadeSeconds: 6 };
let audioContext, masterGain;
const voices = [];
const musicSources = [], musicGains = [];
let activeDeck = 0, crossfadeInProgress = false, crossfadeTimer, crossfadeToneTarget;
let detectedRoot = null;
const playlist = [];
let currentTrackIndex = -1, trackSequence = 0, isAnalysingSet = false;
const KEY_CONFIDENCE_THRESHOLD = .22;

const noteNames = ["C", "C♯", "D", "E♭", "E", "F", "F♯", "G", "A♭", "A", "B♭", "B"];
const majorProfile = [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88];
const minorProfile = [6.33, 2.68, 3.52, 5.38, 2.60, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17];

const $ = (id) => document.getElementById(id);
const mixer = $("mixer");
const presetList = $("presetList");
const deckPlayers = () => [$("musicPlayer"), $("musicPlayerB")];
const activePlayer = () => deckPlayers()[activeDeck];
const standbyPlayer = () => deckPlayers()[1 - activeDeck];

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

  connectMusicSources();

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

function connectMusicSources() {
  if (!audioContext || musicSources.length) return;
  deckPlayers().forEach((player, deck) => {
    const source = audioContext.createMediaElementSource(player);
    const gain = audioContext.createGain();
    gain.gain.value = deck === activeDeck ? Number($("musicVolume").value) : 0;
    source.connect(gain).connect(audioContext.destination);
    musicSources.push(source);
    musicGains.push(gain);
  });
}

function setDeckGain(deck, value, glide = .04) {
  if (!audioContext || !musicGains[deck]) return;
  const parameter = musicGains[deck].gain;
  parameter.cancelScheduledValues(audioContext.currentTime);
  parameter.setTargetAtTime(value, audioContext.currentTime, glide);
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

async function togglePlay() {
  if (playlist.length && playlist.some((track) => track.status !== "analysed")) {
    $("playStatus").textContent = isAnalysingSet ? "ANALYSING SET" : "ANALYSE SET FIRST";
    return;
  }
  if (playlist.length && currentTrackIndex < 0) await selectTrack(0, false);
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
  document.body.classList.toggle("playing", state.playing);
  $("sortKeyButton").disabled = state.playing || playlist.length < 2 || playlist.some((track) => track.status !== "analysed");
  $("playButton").setAttribute("aria-pressed", String(state.playing));
  $("playButton").setAttribute("aria-label", state.playing ? "Pause audio" : "Start audio");
  $("playStatus").textContent = state.playing && playlist.length ? `PLAYING ${currentTrackIndex + 1}/${playlist.length}` : state.playing ? "PLAYING" : "PAUSED";
  if (activePlayer().src) {
    if (state.playing) {
      try { await activePlayer().play(); } catch (error) { console.warn("The local track could not start", error); }
    } else {
      activePlayer().pause();
      standbyPlayer().pause();
      if (crossfadeInProgress) cancelCrossfade();
    }
  }
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
}

function syncFaders() {
  [...mixer.children].forEach((channel, i) => {
    channel.querySelector("input").value = state.levels[i];
    channel.querySelector(".channel-value").textContent = Math.round(state.levels[i] * 100);
  });
}

function updateReadouts(name = state.preset >= 0 ? presets[state.preset].name : "Custom") {
  $("beatReadout").textContent = state.beat.toFixed(1);
  $("beatValue").textContent = `${state.beat.toFixed(1)} Hz`;
  $("carrierValue").textContent = `${Math.round(state.carrier)} Hz`;
  $("waveName").textContent = waveBand(state.beat);
  $("stateName").textContent = name.toUpperCase();
}

function markCustom() {
  state.preset = -1;
  [...presetList.children].forEach((el) => el.classList.remove("active"));
  updateReadouts("Custom");
}

function formatTime(seconds) {
  if (!Number.isFinite(seconds)) return "0:00";
  const minutes = Math.floor(seconds / 60);
  return `${minutes}:${String(Math.floor(seconds % 60)).padStart(2, "0")}`;
}

function updateSetSummary() {
  const analysed = playlist.filter((track) => track.status === "analysed").length;
  $("setSummary").textContent = `${playlist.length} TRACK${playlist.length === 1 ? "" : "S"} · ${analysed} ANALYSED · ON-DEVICE`;
  $("analyseSetButton").disabled = playlist.length === 0 || isAnalysingSet;
  $("clearSetButton").disabled = playlist.length === 0 || isAnalysingSet;
  $("sortKeyButton").disabled = playlist.length < 2 || isAnalysingSet || state.playing || playlist.some((track) => track.status !== "analysed");
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
    title.disabled = track.status !== "analysed" || isAnalysingSet;
    title.addEventListener("click", () => selectTrack(index, state.playing));

    const key = document.createElement("span");
    key.className = "track-key";
    key.textContent = track.key || "—";

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
      button.disabled = action.disabled || isAnalysingSet;
      button.addEventListener("click", action.run);
      actions.appendChild(button);
    });

    row.append(order, title, key, time, status, presetCue, actions);
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
  $("trackPosition").disabled = true;
  $("timeline").classList.add("disabled");
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
  if (track.tonic == null) {
    detectedRoot = null;
    $("detectedKey").textContent = "…";
    $("keyConfidence").textContent = track.status === "analysing" ? "BULK ANALYSIS IN PROGRESS" : "NOT YET ANALYSED";
    $("matchStatus").textContent = "ANALYSE SET BEFORE PLAYBACK";
  }
  $("autoLevelStatus").textContent = track.envelope ? `READY · ${Math.round(track.envelope.quietFraction * 100)}% QUIET` : "ANALYSING WAVEFORM";
  if (state.playing && applyAudio) applyTrackCue(track);
  else if (track.tonic != null) setDetectedKey(track.tonic, track.key, track.confidence, applyAudio);
  applyDynamicToneLevel(applyAudio);
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
}

async function selectTrack(index, autoplay = false) {
  const track = playlist[index];
  if (!track) return;
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

function carrierForKey(root, referenceCarrier = state.carrier) {
  const pitchClass = (root + state.relation) % 12;
  const currentMidi = 69 + 12 * Math.log2(referenceCarrier / 440);
  const candidates = [];
  for (let midi = 42; midi <= 53; midi++) {
    if (((midi % 12) + 12) % 12 === pitchClass) candidates.push(midi);
  }
  const selected = candidates.reduce((best, midi) => Math.abs(midi - currentMidi) < Math.abs(best - currentMidi) ? midi : best, candidates[0]);
  return { pitchClass, frequency: 440 * Math.pow(2, (selected - 69) / 12) };
}

function toneTargetForTrack(track) {
  const cue = track.presetOverride != null ? presets[track.presetOverride] : null;
  const target = {
    preset: cue ? track.presetOverride : state.preset,
    beat: cue ? cue.hz : state.beat,
    carrier: cue ? cue.carrier : state.carrier,
    levels: cue ? [...cue.levels] : [...state.levels],
    wave: state.wave
  };
  if (state.autoMatch && track.tonic != null && track.confidence >= KEY_CONFIDENCE_THRESHOLD) {
    target.carrier = carrierForKey(track.tonic, target.carrier).frequency;
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
  $("beatFrequency").value = state.beat;
  $("carrierFrequency").value = Math.round(state.carrier);
  syncFaders();
  updateReadouts(state.preset >= 0 ? presets[state.preset].name : "Custom");
  [...presetList.children].forEach((element, index) => element.classList.toggle("active", index === state.preset));
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
    fadeOut[step] = Math.cos(progress * Math.PI / 2) * currentVolume;
    fadeIn[step] = Math.sin(progress * Math.PI / 2) * targetVolume;
  }
  musicGains[activeDeck].gain.setValueCurveAtTime(fadeOut, now, duration);
  musicGains[nextDeck].gain.setValueCurveAtTime(fadeIn, now, duration);
  scheduleToneCrossfade(playlist[nextIndex], duration);
  $("playStatus").textContent = `CROSSFADE ${currentTrackIndex + 1}→${nextIndex + 1}`;
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
  $("playStatus").textContent = `PLAYING ${currentTrackIndex + 1}/${playlist.length}`;
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
  return { ...keyResult, envelope };
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
  return { values, toneValues, pointsPerSecond, quietFraction: quietPoints / pointCount };
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
      track.status = "analysed";
      if (playlist[currentTrackIndex]?.id === track.id) {
        setDetectedKey(track.tonic, track.key, track.confidence);
        $("autoLevelButton").disabled = false;
        $("autoLevelStatus").textContent = `READY · ${Math.round(track.envelope.quietFraction * 100)}% QUIET`;
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
    const matched = carrierForKey(root);
    $("matchStatus").textContent = `${noteNames[matched.pitchClass]} · ${matched.frequency.toFixed(1)} HZ`;
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
  return Math.max(.5, Math.min(1, maskingScale * confidenceScale));
}

function currentToneScale() {
  return toneScaleForTrack(playlist[currentTrackIndex], activePlayer().currentTime);
}

function applyDynamicToneLevel(immediate = false) {
  state.toneScale = currentToneScale();
  const percentage = Math.round(state.toneScale * 100);
  const track = playlist[currentTrackIndex];
  const reason = track?.confidence < KEY_CONFIDENCE_THRESHOLD ? "LOW CONFIDENCE BED" : state.toneScale < .72 ? "QUIET BED" : "CONSTANT BED";
  $("autoLevelStatus").textContent = state.autoLevel ? `${percentage}% · ${reason}` : "FIXED OUTPUT";
  if (audioContext && state.playing && !crossfadeInProgress) {
    masterGain.gain.setTargetAtTime(state.volume * state.toneScale, audioContext.currentTime, immediate ? .08 : .85);
  }
}

function matchCarrierToKey() {
  if (detectedRoot == null) return;
  const matched = carrierForKey(detectedRoot);
  const target = matched.frequency;
  $("matchStatus").textContent = `${noteNames[matched.pitchClass]} · ${target.toFixed(1)} HZ`;
  if (Math.abs(target - state.carrier) < .5) return;
  state.carrier = target;
  $("carrierFrequency").value = Math.round(target);
  updateReadouts();
  updateAudioParams(false, .65);
}

$("playButton").addEventListener("click", togglePlay);
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
    presetOverride: null,
    status: "queued"
  }));
  event.target.value = "";
  if (currentTrackIndex < 0) selectTrack(0, false);
  renderPlaylist();
  analyseSet(false);
});

$("analyseSetButton").addEventListener("click", () => analyseSet(true));
$("sortKeyButton").addEventListener("click", sortPlaylistByKey);
$("clearSetButton").addEventListener("click", () => {
  if (state.playing && activePlayer().src) {
    state.playing = false;
    deckPlayers().forEach((player) => player.pause());
    if (audioContext) masterGain.gain.setTargetAtTime(0, audioContext.currentTime, .06);
    document.body.classList.remove("playing");
    $("playButton").setAttribute("aria-pressed", "false");
    $("playButton").setAttribute("aria-label", "Start audio");
  }
  playlist.forEach((track) => URL.revokeObjectURL(track.url));
  playlist.length = 0;
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
    state.playing = false;
    if (audioContext) masterGain.gain.setTargetAtTime(0, audioContext.currentTime, .06);
    document.body.classList.remove("playing");
    $("playButton").setAttribute("aria-pressed", "false");
    $("playButton").setAttribute("aria-label", "Start audio");
    $("playStatus").textContent = "FINISHED";
  });
});
$("trackPosition").addEventListener("input", (event) => {
  if (crossfadeInProgress) cancelCrossfade();
  activePlayer().currentTime = Number(event.target.value);
});
$("musicVolume").addEventListener("input", (event) => {
  if (!crossfadeInProgress) setDeckGain(activeDeck, Number(event.target.value), .04);
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
$("autoMatchButton").addEventListener("click", () => {
  state.autoMatch = !state.autoMatch;
  $("autoMatchButton").classList.toggle("active", state.autoMatch);
  $("autoMatchButton").setAttribute("aria-pressed", String(state.autoMatch));
  $("matchStatus").textContent = state.autoMatch ? (detectedRoot == null ? "AWAITING ANALYSIS" : "MATCHING ANALYSED KEY") : "MANUAL CARRIER";
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
window.addEventListener("beforeunload", () => playlist.forEach((track) => URL.revokeObjectURL(track.url)));

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
buildUI(); renderPlaylist(); updateReadouts(); resizeCanvas(); drawField();
