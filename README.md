# Phase — Binaural Studio

A standalone binaural beat generator and local music player built with the Web Audio API. It includes ten harmonic carrier pairs, seven brainwave-state presets, per-harmonic mixing, adjustable beat and carrier frequencies, two oscillator shapes, offline key/BPM analysis, automatic carrier matching, adaptive impulse noise, and a responsive animated interface.

## Local sets and carrier matching

Load multiple MP3, M4A, WAV, AAC, FLAC, or OGG files from the **Local Set** section. Files stay on the device. Phase decodes and analyses every track before playback, samples its complete timeline into a chroma profile, estimates the musical key, and displays a fixed per-track confidence result.

The same preflight pass estimates BPM, pulse confidence, and beat phase. Clear rhythmic material gets a rain-like field of short, randomly spaced spatial taps. BPM gently shapes their density across each bar, but individual droplets are deliberately not quantized, so the texture never becomes an accidental extra drum part. Low-confidence or rhythmically ambiguous material falls back to continuous filtered “air”. The texture favours genuine quiet space and adds a longer spatial sweep across automatic crossfades. **Texture** controls the whole layer, and impulse and spatial behaviour can be disabled independently.

**Breath modulation** adds a shallow, slow rise and fall to the binaural bed. Each state has a target breathing rate from 4.5 cycles/minute for Deep Sleep to 8 for Bright Alert. When BPM is reliable, Phase selects a whole musical phrase (8–32 beats) closest to that target, keeping the movement aligned with the track; otherwise it runs freely at the preset rate.

Tracks play in the displayed order and automatically advance. Use the arrow controls to reorder the set or remove individual files. The carrier glides to the analysed root or fifth at each transition. The main play button controls both the music and binaural layer; moving the base-carrier slider switches matching back to manual mode.

Automatic matching uses a deliberately low carrier octave of roughly 92–175 Hz. Whole-track waveform analysis also maps quiet and silent passages before playback, allowing the binaural layer to duck smoothly when it would otherwise become exposed. Low-confidence key estimates retain the last reliable carrier instead of forcing a new pitch.

The adaptive layer is intentionally a constant bed rather than a reactive gate: it uses several seconds of look-ahead context, slow bidirectional smoothing, and a 50% minimum output floor. Brief dance-music builds, stutters, and drops therefore retain the tone instead of producing rapid pumping.

Use **Sort by key** to build a harmonically adjacent running order; uncertain key results are left at the end. **Auto Xfade** overlaps two local playback decks for adjustable 2–12 second transitions. Each playlist row also has a state cue: choose a preset such as Calm or Deep Focus and it will take effect when that track begins, persisting through later tracks marked Continue until another cue changes it.

During an automatic crossfade, the binaural carrier, beat frequency, harmonic balance, and output level interpolate across the same transition window as the music. Reliable key changes therefore keep the pleasing pitch slide without an abrupt reconfiguration at the handoff. Bright Alert uses a 110 Hz carrier and a steeply reduced upper-harmonic mix to keep its 32 Hz beat usable at lower perceived pitch.

## Recording a set

After every track has been analysed, choose **Play + Rec Set**. Phase rewinds to track one and captures the exact combined Web Audio output—including local music, equal-power crossfades, state cues, carrier transitions, impulse texture, and the breathing-modulated binaural layer—in real time. The recorder pauses and resumes with the main transport, stops automatically after the final track, and saves one local file. The browser chooses the best available format: M4A/AAC where supported, otherwise WebM/Opus or Ogg/Opus. No microphone permission or upload is involved.

In browsers supporting the File System Access API, Phase asks for the destination first and streams one-second encoded chunks directly to disk throughout the set, keeping memory use essentially constant. Other browsers fall back to assembling the final download in memory. A separate FFmpeg renderer would only be necessary for faster-than-real-time export and would require a manifest/desktop companion to reproduce the browser's resolved track paths and automation.

## Run locally

No build step or dependencies are required. From this folder, start any static server:

```bash
python3 -m http.server 4173
```

Then open `http://localhost:4173` in a modern browser and use stereo headphones.

## Notes

- Browsers require a click before audio can start; use the large play button.
- Keep the output at a comfortable level.
- This is a focus and relaxation tool, not a medical treatment.
