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
let musicSource, musicGain;
let detectedRoot = null;
const playlist = [];
let currentTrackIndex = -1, trackSequence = 0, isAnalysingSet = false;

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
  musicSource.connect(musicGain).connect(audioContext.destination);
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
  masterGain.gain.cancelScheduledValues(audioContext.currentTime);
  masterGain.gain.setTargetAtTime(state.playing ? state.volume : 0, audioContext.currentTime, state.playing ? .12 : .06);
  document.body.classList.toggle("playing", state.playing);
  $("playButton").setAttribute("aria-pressed", String(state.playing));
  $("playButton").setAttribute("aria-label", state.playing ? "Pause audio" : "Start audio");
  $("playStatus").textContent = state.playing && playlist.length ? `PLAYING ${currentTrackIndex + 1}/${playlist.length}` : state.playing ? "PLAYING" : "PAUSED";
  if ($("musicPlayer").src) {
    if (state.playing) {
      try { await $("musicPlayer").play(); } catch (error) { console.warn("The local track could not start", error); }
    } else {
      $("musicPlayer").pause();
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
    status.textContent = track.status === "analysed" ? `${Math.round(track.confidence * 100)}% CONF.` : track.status.toUpperCase();

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

    row.append(order, title, key, time, status, actions);
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

function resetCurrentTrackUI() {
  currentTrackIndex = -1;
  $("musicPlayer").pause();
  $("musicPlayer").removeAttribute("src");
  $("musicPlayer").load();
  $("nowIndex").textContent = "—";
  $("trackName").textContent = "No track loaded";
  $("trackMeta").textContent = "ADD LOCAL AUDIO FILES TO BUILD A SET";
  $("trackMeta").style.color = "";
  $("detectedKey").textContent = "—";
  $("keyConfidence").textContent = "WAITING FOR AUDIO";
  $("matchStatus").textContent = "LOAD A SET TO BEGIN";
  $("autoMatchButton").disabled = true;
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

async function selectTrack(index, autoplay = false) {
  const track = playlist[index];
  if (!track) return;
  currentTrackIndex = index;
  const player = $("musicPlayer");
  player.src = track.url;
  player.load();
  $("nowIndex").textContent = String(index + 1).padStart(2, "0");
  $("trackName").textContent = track.name;
  $("trackMeta").textContent = `${(track.file.size / 1048576).toFixed(1)} MB · TRACK ${index + 1} OF ${playlist.length}`;
  $("trackMeta").style.color = "";
  $("autoMatchButton").disabled = false;
  $("trackPosition").disabled = false;
  $("timeline").classList.remove("disabled");
  if (track.tonic != null) setDetectedKey(track.tonic, track.key, track.confidence);
  else {
    detectedRoot = null;
    $("detectedKey").textContent = "…";
    $("keyConfidence").textContent = track.status === "analysing" ? "BULK ANALYSIS IN PROGRESS" : "NOT YET ANALYSED";
    $("matchStatus").textContent = "ANALYSE SET BEFORE PLAYBACK";
  }
  if (audioContext) connectMusicSource();
  renderPlaylist();
  if (autoplay) {
    try { await player.play(); } catch (error) { console.warn("The next local track could not start", error); }
  }
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
  return rankKey(chroma);
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
      track.status = "analysed";
      if (playlist[currentTrackIndex]?.id === track.id) setDetectedKey(track.tonic, track.key, track.confidence);
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
  }
  $("playStatus").textContent = playlist.every((track) => track.status === "analysed") ? "SET READY" : "CHECK FILES";
}

function setDetectedKey(root, label, confidence) {
  const changed = $("detectedKey").textContent !== label;
  detectedRoot = root;
  $("detectedKey").textContent = label;
  $("keyConfidence").textContent = `${Math.round(confidence * 100)}% CONFIDENCE · PRE-ANALYSED`;
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
    status: "queued"
  }));
  event.target.value = "";
  if (currentTrackIndex < 0) selectTrack(0, false);
  renderPlaylist();
  analyseSet(false);
});

$("analyseSetButton").addEventListener("click", () => analyseSet(true));
$("clearSetButton").addEventListener("click", () => {
  if (state.playing && $("musicPlayer").src) {
    state.playing = false;
    $("musicPlayer").pause();
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

$("musicPlayer").addEventListener("loadedmetadata", () => {
  $("duration").textContent = formatTime($("musicPlayer").duration);
  $("trackPosition").max = $("musicPlayer").duration || 100;
  const current = playlist[currentTrackIndex];
  if (current && !current.duration) { current.duration = $("musicPlayer").duration; renderPlaylist(); }
});
$("musicPlayer").addEventListener("error", () => {
  $("trackMeta").textContent = "THIS AUDIO FORMAT COULD NOT BE DECODED BY THE BROWSER";
  $("trackMeta").style.color = "#ff815d";
  $("playStatus").textContent = "FILE ERROR";
  const current = playlist[currentTrackIndex];
  if (current && current.status !== "analysing") { current.status = "error"; renderPlaylist(); }
});
$("musicPlayer").addEventListener("timeupdate", () => {
  $("currentTime").textContent = formatTime($("musicPlayer").currentTime);
  if (!$("trackPosition").matches(":active")) $("trackPosition").value = $("musicPlayer").currentTime;
});
$("musicPlayer").addEventListener("ended", () => {
  if (!state.playing) return;
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
$("trackPosition").addEventListener("input", (event) => { $("musicPlayer").currentTime = Number(event.target.value); });
$("musicVolume").addEventListener("input", (event) => {
  if (musicGain && audioContext) musicGain.gain.setTargetAtTime(Number(event.target.value), audioContext.currentTime, .04);
});
$("autoMatchButton").addEventListener("click", () => {
  state.autoMatch = !state.autoMatch;
  $("autoMatchButton").classList.toggle("active", state.autoMatch);
  $("autoMatchButton").setAttribute("aria-pressed", String(state.autoMatch));
  $("matchStatus").textContent = state.autoMatch ? (detectedRoot == null ? "AWAITING ANALYSIS" : "MATCHING ANALYSED KEY") : "MANUAL CARRIER";
  if (state.autoMatch) matchCarrierToKey();
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
