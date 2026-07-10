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
const state = { preset: 3, beat: 8, carrier: 180, volume: .35, wave: "sine", levels: [...presets[3].levels], playing: false };
let audioContext, masterGain;
const voices = [];

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

function harmonicFrequency(index) {
  // Musical partials are gently compressed to keep every carrier comfortable.
  return state.carrier * (1 + index * .36);
}

function updateAudioParams(immediate = false) {
  if (!audioContext) return;
  const now = audioContext.currentTime;
  voices.forEach((voice, i) => {
    const base = harmonicFrequency(i);
    const ramp = immediate ? 0.01 : .18;
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

$("playButton").addEventListener("click", togglePlay);
$("beatFrequency").addEventListener("input", (event) => {
  state.beat = Number(event.target.value); markCustom(); updateAudioParams();
});
$("carrierFrequency").addEventListener("input", (event) => {
  state.carrier = Number(event.target.value); markCustom(); updateAudioParams();
});
$("masterVolume").addEventListener("input", (event) => {
  state.volume = Number(event.target.value);
  $("volumeValue").textContent = `${Math.round(state.volume / .65 * 100)}%`;
  if (audioContext && state.playing) masterGain.gain.setTargetAtTime(state.volume, audioContext.currentTime, .06);
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
buildUI(); updateReadouts(); resizeCanvas(); drawField();
