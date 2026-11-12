# InferNear landing page (`landing/`)

The public page for [infernear.dev](https://infernear.dev): one static HTML page, its CSS and a small script, built with Vite. It makes no external requests at runtime; everything below is bundled.

- **Fonts:** Hanken Grotesk and Martian Mono, from Fontsource.
- **Logos:** chain, token and protocol marks from [`@web3icons/core`](https://www.npmjs.com/package/@web3icons/core) (MIT); Rhea's logo in `src/assets/rhea-logo.svg` comes from Rhea's own site.
- **Hero:** a three.js scene (`src/hero3d.js`), loaded as its own chunk only when WebGL is available and motion is allowed; otherwise a static mark is shown.
- **Slides:** on desktop, one wheel gesture or key press moves one section. Touch devices, small screens and reduced motion keep normal scrolling.

Node 22.18 or newer. From the repository root:

```sh
cd landing && npm ci --ignore-scripts && npm run build
```

`npm run build` writes the site to `dist/`. `npm run preview` serves that build locally, and `npm run dev` serves the source with live reload.

`public/og.png` is the 1200×630 social preview. It is rendered from `og.svg` with `rsvg-convert -w 1200 -h 630 og.svg -o public/og.png`.
