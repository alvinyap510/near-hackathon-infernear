# InferNear film

An 84-second motion piece about InferNear, made entirely in code: HTML, CSS, SVG and a three.js layer for the 3D mark, with an original score synthesised by the Web Audio API. There is no video editor, no recorded footage and no sample library. It covers the vision, the value proposition, how InferNear brings people on other chains to NEAR AI Cloud (through NEAR Intents, with no NEAR account), and how it brings NEAR AI Cloud and its NEAR TEEs to them.

Every frame and every sample is a pure function of time. The picture runs on the music's clock (120 BPM), so cuts land on the beat, and `render.mjs` steps the page frame by frame into an exact MP4.

## Watch it in a browser

Node 22.18 or newer. From `video/`:

```sh
npm ci --ignore-scripts
npm run dev
```

Open `http://127.0.0.1:4180` and press **Play with sound** (the score is synthesised on the first press, which takes a few seconds). Space pauses, the arrow keys skip 2 seconds, Home restarts, and `?t=30` opens at 30 seconds.

## Render the MP4

Needs Google Chrome and `ffmpeg` installed. Playwright drives the installed Chrome with its sandbox on, so it downloads no browser.

```sh
npm run render
```

It writes `out/infernear-film.mp4`: 1920×1080, 60 fps, H.264, with AAC sound normalised to -14 LUFS. `FPS=30 npm run render` halves the render time, `STILLS=12,40 npm run render` saves those two moments as PNGs in `out/stills/`, and `AUDIO_ONLY=1 npm run render` writes only `out/soundtrack.wav`.

## Layout

| Path | What |
|---|---|
| `index.html` | The scenes as plain markup, and the HUD |
| `src/film.js` | The timeline: one update function per scene, the motion helpers (masked type, bracket frames, punch-in cuts, shutters, counters, typing) and the player |
| `src/gl.js` | The 3D layer: the mark's extruded brackets, the mint core and its particle streams, drawn from a state rather than a clock |
| `src/audio.js` | The score and its sound effects, synthesised in an `OfflineAudioContext` and written as WAV |
| `src/film.css` | The InferNear look: the landing page's palette, Hanken Grotesk and Martian Mono |
| `render.mjs` | Steps the built page through every frame, pipes the frames to ffmpeg and muxes the soundtrack |

Chain and token marks come from `@web3icons/core` (MIT), as on the landing page. The dry-run quote shown for NEAR Intents (2 USDC on Base to 1.999763 USDC on NEAR, about 35 seconds) is a real 1Click quote from 14 Nov 2026.
