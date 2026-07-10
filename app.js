const presets = [
  { name: "Deep Sleep", hz: 2.5, carrier: 110, levels: [0.95, .74, .48, .28, .16, .08, .04, .02, 0, 0] },
  { name: "Dream Drift", hz: 4.5, carrier: 140, levels: [.9, .62, .76, .42, .26, .16, .1, .05, .02, 0] },
  { name: "Meditation", hz: 6, carrier: 160, levels: [.78, .9, .56, .72, .38, .24, .14, .08, .04, .02] },
  { name: "Calm", hz: 8, carrier: 180, levels: [.72, .9, .64, .48, .34, .24, .16, .1, .06, .03] },
  { name: "Clear Mind", hz: 10, carrier: 200, levels: [.55, .74, .9, .62, .44, .3, .2, .12, .07, .04] },
  { name: "Deep Focus", hz: 16, carrier: 220, levels: [.38, .52, .7, .92, .8, .58, .38, .24, .14, .08] },
  { name: "Bright Alert", hz: 32, carrier: 260, levels: [.24, .36, .48, .64, .82, .94, .76, .55, .36, .18] }
];

const knobColors = ["#ff815d", "#f5a24b", "#e9c857", "#b8d967", "#68d598", "#54d5c4", "#59c0ea", "#7393f2", "#a579e8", "#dd79bb"];
const state = { preset: 3, beat: 8, carrier: 180, volume: .35, wave: "sine", levels: [...presets[3].levels], playing: false, autoMatch: true, relation: 0 };
let audioContext, masterGain;
const voices = [];
let musicSource, musicGain, analyser, frequencyData;
let trackUrl, analysisFrame, lastAnalysis = 0;
let rollingChroma = new Float32Array(12);
let candidateKey = "", candidateCount = 0, detectedRoot = null;

const noteNames = ["C", "C♯", "D", "E♭", "E", "F", "F♯", "G", "A♭", "A", "B♭", "B"];
const majorProfile = [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88];
const minorProfile = [6.33, 2.68, 3.52, 5.38, 2.60, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17];

const $ = (id) => document.getElementById(id);
const mixer = $("mixer");
const presetList = $("presetList");

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

  if ($("musicPlayer").src) connectMusicSource();

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

function connectMusicSource() {
  if (!audioContext || musicSource) return;
  musicSource = audioContext.createMediaElementSource($("musicPlayer"));
  musicGain = audioContext.createGain();
  musicGain.gain.value = Number($("musicVolume").value);
  analyser = audioContext.createAnalyser();
  analyser.fftSize = 8192;
  analyser.smoothingTimeConstant = .82;
  frequencyData = new Float32Array(analyser.frequencyBinCount);
  musicSource.connect(musicGain).connect(audioContext.destination);
  musicSource.connect(analyser);
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
  if (!createAudio()) {
    $("playStatus").textContent = "AUDIO UNSUPPORTED";
    $("playButton").setAttribute("aria-label", "Web Audio is not supported in this browser");
    return;
  }
  if (audioContext.state === "suspended") await audioContext.resume();
  state.playing = !state.playing;
  masterGain.gain.cancelScheduledValues(audioContext.currentTime);
  masterGain.gain.setTargetAtTime(state.playing ? state.volume : 0, audioContext.currentTime, state.playing ? .12 : .06);
  document.body.classList.toggle("playing", state.playing);
  $("playButton").setAttribute("aria-pressed", String(state.playing));
  $("playButton").setAttribute("aria-label", state.playing ? "Pause audio" : "Start audio");
  $("playStatus").textContent = state.playing ? "PLAYING" : "PAUSED";
  if ($("musicPlayer").src) {
    if (state.playing) {
      try { await $("musicPlayer").play(); } catch (error) { console.warn("The local track could not start", error); }
      startAnalysis();
    } else {
      $("musicPlayer").pause();
      cancelAnimationFrame(analysisFrame);
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

function analyseKey() {
  if (!analyser || $("musicPlayer").paused) return;
  analyser.getFloatFrequencyData(frequencyData);
  const sampleRate = audioContext.sampleRate;
  const fftSize = analyser.fftSize;
  const instant = new Float32Array(12);

  for (let bin = 1; bin < frequencyData.length; bin++) {
    const frequency = bin * sampleRate / fftSize;
    if (frequency < 65 || frequency > 1800) continue;
    const db = frequencyData[bin];
    if (!Number.isFinite(db) || db < -82) continue;
    const midi = Math.round(69 + 12 * Math.log2(frequency / 440));
    const pitchClass = ((midi % 12) + 12) % 12;
    const magnitude = Math.pow(10, db / 20);
    // Weight lower fundamentals while retaining enough upper harmonics for small speakers.
    instant[pitchClass] += magnitude / Math.pow(frequency / 220, .35);
  }

  for (let i = 0; i < 12; i++) rollingChroma[i] = rollingChroma[i] * .92 + instant[i] * .08;

  const scores = [];
  for (let tonic = 0; tonic < 12; tonic++) {
    scores.push({ tonic, mode: "MAJOR", score: profileScore(rollingChroma, majorProfile, tonic) });
    scores.push({ tonic, mode: "MINOR", score: profileScore(rollingChroma, minorProfile, tonic) });
  }
  scores.sort((a, b) => b.score - a.score);
  const best = scores[0], second = scores[1];
  const confidence = Math.max(0, Math.min(1, (best.score - second.score) * 7 + (best.score - .55) * 1.2));
  const label = `${noteNames[best.tonic]} ${best.mode === "MAJOR" ? "MAJ" : "MIN"}`;

  if (label === candidateKey) candidateCount += 1;
  else { candidateKey = label; candidateCount = 1; }

  $("keyConfidence").textContent = `${Math.round(confidence * 100)}% CONFIDENCE · LISTENING`;
  if (candidateCount >= 3 && best.score > .58 && confidence > .08) setDetectedKey(best.tonic, label, confidence);
}

function setDetectedKey(root, label, confidence) {
  const changed = $("detectedKey").textContent !== label;
  detectedRoot = root;
  $("detectedKey").textContent = label;
  $("keyConfidence").textContent = `${Math.round(confidence * 100)}% CONFIDENCE · STABLE`;
  if (changed) {
    const display = document.querySelector(".key-display");
    display.classList.remove("key-change");
    requestAnimationFrame(() => display.classList.add("key-change"));
  }
  if (state.autoMatch) matchCarrierToKey();
}

function matchCarrierToKey() {
  if (detectedRoot == null) return;
  const pitchClass = (detectedRoot + state.relation) % 12;
  const currentMidi = 69 + 12 * Math.log2(state.carrier / 440);
  const candidates = [];
  // E3–F4 keeps matching in the low, clearly perceived binaural range.
  for (let midi = 52; midi <= 65; midi++) {
    if (((midi % 12) + 12) % 12 === pitchClass) candidates.push(midi);
  }
  const selected = candidates.reduce((best, midi) => Math.abs(midi - currentMidi) < Math.abs(best - currentMidi) ? midi : best, candidates[0]);
  const target = 440 * Math.pow(2, (selected - 69) / 12);
  $("matchStatus").textContent = `${noteNames[pitchClass]} · ${target.toFixed(1)} HZ`;
  if (Math.abs(target - state.carrier) < .5) return;
  state.carrier = target;
  $("carrierFrequency").value = Math.round(target);
  updateReadouts();
  updateAudioParams(false, .65);
}

function startAnalysis() {
  cancelAnimationFrame(analysisFrame);
  const loop = (timestamp) => {
    if (timestamp - lastAnalysis > 600) { analyseKey(); lastAnalysis = timestamp; }
    if (!$("musicPlayer").paused) analysisFrame = requestAnimationFrame(loop);
  };
  analysisFrame = requestAnimationFrame(loop);
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
  if (audioContext && state.playing) masterGain.gain.setTargetAtTime(state.volume, audioContext.currentTime, .06);
});

$("audioFile").addEventListener("change", (event) => {
  const file = event.target.files?.[0];
  if (!file) return;
  if (trackUrl) URL.revokeObjectURL(trackUrl);
  trackUrl = URL.createObjectURL(file);
  $("musicPlayer").src = trackUrl;
  $("musicPlayer").load();
  $("trackName").textContent = file.name.replace(/\.[^.]+$/, "");
  $("trackMeta").textContent = `${(file.size / 1048576).toFixed(1)} MB · LOCAL FILE · READY`;
  $("trackMeta").style.color = "";
  $("autoMatchButton").disabled = false;
  $("trackPosition").disabled = false;
  $("timeline").classList.remove("disabled");
  $("matchStatus").textContent = "READY · PRESS PLAY";
  $("detectedKey").textContent = "…";
  $("keyConfidence").textContent = "WAITING FOR PLAYBACK";
  rollingChroma.fill(0); detectedRoot = null; candidateKey = ""; candidateCount = 0;
  if (audioContext) connectMusicSource();
});

$("musicPlayer").addEventListener("loadedmetadata", () => {
  $("duration").textContent = formatTime($("musicPlayer").duration);
  $("trackPosition").max = $("musicPlayer").duration || 100;
});
$("musicPlayer").addEventListener("error", () => {
  $("trackMeta").textContent = "THIS AUDIO FORMAT COULD NOT BE DECODED BY THE BROWSER";
  $("trackMeta").style.color = "#ff815d";
  $("playStatus").textContent = "FILE ERROR";
});
$("musicPlayer").addEventListener("timeupdate", () => {
  $("currentTime").textContent = formatTime($("musicPlayer").currentTime);
  if (!$("trackPosition").matches(":active")) $("trackPosition").value = $("musicPlayer").currentTime;
});
$("musicPlayer").addEventListener("ended", () => {
  if (!state.playing) return;
  state.playing = false;
  if (audioContext) masterGain.gain.setTargetAtTime(0, audioContext.currentTime, .06);
  document.body.classList.remove("playing");
  $("playButton").setAttribute("aria-pressed", "false");
  $("playButton").setAttribute("aria-label", "Start audio");
  $("playStatus").textContent = "FINISHED";
  cancelAnimationFrame(analysisFrame);
});
$("trackPosition").addEventListener("input", (event) => { $("musicPlayer").currentTime = Number(event.target.value); });
$("musicVolume").addEventListener("input", (event) => {
  if (musicGain && audioContext) musicGain.gain.setTargetAtTime(Number(event.target.value), audioContext.currentTime, .04);
});
$("autoMatchButton").addEventListener("click", () => {
  state.autoMatch = !state.autoMatch;
  $("autoMatchButton").classList.toggle("active", state.autoMatch);
  $("autoMatchButton").setAttribute("aria-pressed", String(state.autoMatch));
  $("matchStatus").textContent = state.autoMatch ? (detectedRoot == null ? "LISTENING FOR KEY" : "MATCHING DETECTED KEY") : "MANUAL CARRIER";
  if (state.autoMatch) matchCarrierToKey();
});
document.querySelectorAll(".relation").forEach((button) => button.addEventListener("click", () => {
  state.relation = Number(button.dataset.relation);
  document.querySelectorAll(".relation").forEach((el) => el.classList.toggle("active", el === button));
  if (state.autoMatch) matchCarrierToKey();
}));
window.addEventListener("beforeunload", () => { if (trackUrl) URL.revokeObjectURL(trackUrl); });

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
buildUI(); updateReadouts(); resizeCanvas(); drawField();
