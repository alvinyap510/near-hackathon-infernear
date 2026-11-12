# InferNear landing page (`landing/`)

The public page for [infernear.dev](https://infernear.dev): one static HTML page and its CSS, built with Vite. It makes no external requests. The fonts (Hanken Grotesk, Martian Mono) are bundled from Fontsource, and the only script is the copy buttons.

Node 22.18 or newer. From the repository root:

```sh
cd landing && npm ci --ignore-scripts && npm run build
```

`npm run build` writes the site to `dist/`. `npm run preview` serves that build locally, and `npm run dev` serves the source with live reload.

`public/og.png` is the 1200×630 social preview. It is rendered from `og.svg` with `rsvg-convert -w 1200 -h 630 og.svg -o public/og.png`.
