# InferNear film

A 79-second motion piece about InferNear, drawn entirely in code: HTML, CSS and SVG on one page, with no video editor and no recorded footage. It covers the vision, the value proposition, how InferNear brings people on other chains to NEAR AI Cloud, and how it brings NEAR AI Cloud to them.

Every frame is a pure function of time (`render(t)` in `src/film.js`), so the page plays in a browser and also renders frame by frame to an exact MP4.

## Watch it in a browser

Node 22.18 or newer. From `video/`:

```sh
npm ci --ignore-scripts
npm run dev
```

Open `http://127.0.0.1:4180`. Space pauses, the arrow keys skip 3 seconds, Home restarts, and `?t=30` starts at 30 seconds.

## Render the MP4

Needs Google Chrome and `ffmpeg` installed. Playwright drives the installed Chrome with its sandbox on, so it downloads no browser.

```sh
npm run render
```

It writes `out/infernear-film.mp4`: 1920×1080, 60 fps, H.264, no audio. `FPS=30 npm run render` halves the render time. `STILLS=12,40 npm run render` saves those two moments as PNGs in `out/stills/` instead.

## Layout

| Path | What |
|---|---|
| `index.html` | The sixteen scenes as plain markup |
| `src/film.js` | The timeline: one update function per scene, the motion helpers (whip cuts with motion blur, word reveals, typing, panel wipes, the cursor) and the player |
| `src/film.css` | The InferNear look: the landing page's palette, Hanken Grotesk and Martian Mono |
| `render.mjs` | Steps the built page through every frame and pipes the frames to ffmpeg |

Chain and token marks come from `@web3icons/core` (MIT), as on the landing page.
