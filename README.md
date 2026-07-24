# Binaural Studio

A local-first browser studio for building long-form headphone sessions from
binaural tones, music, adaptive textures, and spoken-word audio.

Binaural Studio combines a ten-voice binaural synthesizer with a local music
deck, an independent spoken-word deck for audiobooks and other long-form audio,
and a real-time master recorder. It can analyse your music in the browser, tune
the generated layer to each track, move between state presets during a set, and
record the complete result as one audio file. There is no backend, account,
build step, or audio upload.

**[Launch Binaural Studio →](https://henrygabriels.github.io/binaural-studio/)**
— no installation required.

> **Use stereo headphones and start at a comfortable volume.** The state
> presets are creative sound-design tools, not medical treatments.

## What it does

| Area | Capabilities |
| --- | --- |
| **Binaural synth** | Seven state presets, ten independently mixed harmonic pairs, 1–40 Hz beat frequency, adjustable carrier, sine/triangle oscillators, and manual output control |
| **Deck 01 — music** | Local playlist, whole-track key/BPM/loudness analysis, automatic carrier matching, harmonic sorting, per-track state cues, three-band EQ, and equal-power crossfades |
| **Adaptive layers** | Slow binaural auto-levelling, impulse texture, filtered air bed, breath modulation, and spatial motion shaped by the current track |
| **Deck 02 — spoken word** | Local audiobook and spoken-word queue with its own volume, convolution reverb, seek position, ordering, and explicit timed silences |
| **Recording** | Real-time capture of the complete master mix to M4A/AAC, WebM/Opus, or Ogg/Opus, depending on browser support |

You can also use the synthesizer on its own: choose a preset, put on headphones,
and press play without loading any files.

## Run locally

The app is plain HTML, CSS, and JavaScript with no package dependencies.

```sh
git clone https://github.com/henrygabriels/binaural-studio.git
cd binaural-studio
python3 -m http.server 4173
```

Open [http://localhost:4173](http://localhost:4173) in a modern browser. A local
server is recommended instead of opening `index.html` directly.

## Build a session

1. Add music to **Deck 01 / Local Set**.
2. Select **Analyse Set** to estimate key, BPM, loudness, and quiet passages.
3. Reorder tracks manually or use **Sort by Key**. Optionally assign a state cue
   to any track and adjust the crossfade, EQ, or generated layers.
4. Add an audiobook, podcast, or other spoken-word audio to **Deck 02 / Spoken
   Word**. Insert exact pauses, or use **Random Gaps** to place a 0.5–2.5 second
   silence between adjacent audio items.
5. Press the main transport to listen, or **Play + Rec Set** to rewind both
   queues and record the session from the beginning.

Recording becomes available after every Deck 01 track has been analysed. The
main transport pauses and resumes both decks together.

## How the audio is organised

The two user-facing decks are deliberately independent:

- **Deck 01** feeds the music EQ and is the only source used for key, rhythm,
  loudness, carrier, texture, breathing, state-cue, and crossfade automation.
- **Deck 02** has its own queue, position, volume, reverb, and silence items. It
  follows the master transport but does not influence the musical analysis.
- The **binaural synth** and **adaptive layers** run on their own Web Audio
  paths.
- All four paths meet at the recorded master mix and the headphone output.

This keeps spoken-word playback intelligible and predictable without letting it
retune or reshape the music-driven layers.

## On-device music analysis

Analysis happens before playback and stays inside the browser:

- A whole-track chroma profile estimates musical key and reports a confidence
  score.
- An onset envelope estimates tempo, pulse confidence, and beat phase.
- A loudness and quiet-passage map controls slow binaural levelling and places
  adaptive texture where it is less likely to mask the track.

For a reliable key estimate, the studio selects the analysed root or fifth in a
low carrier range and glides there during transitions. Low-confidence results
leave the previous carrier in place. These are lightweight musical heuristics,
not studio-grade key or loudness measurements, so unusual or harmonically
ambiguous material may need manual adjustment.

Automatic crossfades overlap two internal music players for 2–12 seconds. The
music level, carrier, beat frequency, harmonic mix, state cue, and generated
texture transition across the same window.

## Audiobooks and other spoken-word formats

Deck 02 is designed for audiobooks and other long-form spoken audio. It accepts
common browser-decodable files including MP3, M4A/AAC, WAV, FLAC, Ogg/Opus,
WebM, and M4B. The browser must support the audio codec inside the file; a
recognised extension alone does not guarantee playback. DRM-protected audiobook
formats such as Audible AAX cannot be decoded by standard browser audio APIs.

## Recording and privacy

**Play + Rec Set** captures music, EQ, crossfades, binaural tones, adaptive
layers, spoken-word audio and reverb, and timed silences in real time. It does
not use the microphone.

When the File System Access API is available, the app asks for a destination and
streams one-second encoded chunks directly to disk. Otherwise it keeps the
encoded chunks in memory and starts a download when the set ends. Long sessions
therefore use more memory in browsers without direct-to-disk access.

Audio files, decoded samples, analysis results, and recordings remain on your
device. The app has no analytics or server-side component. Its only
third-party page resources are the UI fonts loaded from Google Fonts.

## Current limitations

- Stereo headphones are required for the intended binaural effect.
- Sessions and analysis results are not persisted across page reloads.
- Export is real-time; there is no faster-than-real-time renderer.
- Playback and recording formats depend on the codecs exposed by the browser.
- The lightweight key and BPM estimates can be uncertain on sparse, noisy, or
  harmonically ambiguous audio.

## Project structure

```text
index.html  Interface and audio elements
styles.css  Responsive layout and visual system
app.js      Web Audio graph, analysis, sequencing, and recording
```

Contributions and bug reports are welcome. The project is intentionally
dependency-free, so changes should remain usable from a simple static server.

## License

[MIT](LICENSE)
