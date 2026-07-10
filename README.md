# Phase — Binaural Studio

A standalone binaural beat generator and local music player built with the Web Audio API. It includes ten harmonic carrier pairs, seven brainwave-state presets, per-harmonic mixing, adjustable beat and carrier frequencies, two oscillator shapes, local key analysis, automatic carrier matching, and a responsive animated interface.

## Local music and carrier matching

Load an MP3, M4A, WAV, AAC, FLAC, or OGG file from the **Local Music** section. The file stays on the device: Phase analyses the live frequency spectrum in the browser, builds a rolling chroma profile, estimates the musical key, and glides the binaural carrier toward either the detected root or fifth.

The main play button controls both the music and binaural layer. Moving the base-carrier slider switches matching back to manual mode.

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
