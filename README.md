# Phase — Binaural Studio

A standalone binaural beat generator and local music player built with the Web Audio API. It includes ten harmonic carrier pairs, seven brainwave-state presets, per-harmonic mixing, adjustable beat and carrier frequencies, two oscillator shapes, local key analysis, automatic carrier matching, and a responsive animated interface.

## Local sets and carrier matching

Load multiple MP3, M4A, WAV, AAC, FLAC, or OGG files from the **Local Set** section. Files stay on the device. Phase decodes and analyses every track before playback, samples its complete timeline into a chroma profile, estimates the musical key, and displays a fixed per-track confidence result.

Tracks play in the displayed order and automatically advance. Use the arrow controls to reorder the set or remove individual files. The carrier glides to the analysed root or fifth at each transition. The main play button controls both the music and binaural layer; moving the base-carrier slider switches matching back to manual mode.

Automatic matching uses a deliberately low carrier octave of roughly 92–175 Hz. Whole-track waveform analysis also maps quiet and silent passages before playback, allowing the binaural layer to duck smoothly when it would otherwise become exposed. Low-confidence key estimates retain the last reliable carrier instead of forcing a new pitch.

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
