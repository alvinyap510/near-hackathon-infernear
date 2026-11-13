# InferNear docs site

The documentation at `https://docs.infernear.dev`: guides, the API reference and the specs, as Markdown pages built into a static site with [VitePress](https://vitepress.dev).

## Build and preview

Node 22.18 or newer (24.22.1 was used). From `docs-site/`:

```sh
npm ci --ignore-scripts
npm run build
npm run preview
```

`npm run build` writes the static site to `.vitepress/dist` and fails on a dead internal link. `npm run dev` serves the pages with live reload.

## Layout

| Path | What |
|---|---|
| `index.md`, `overview/` | Welcome, vision, how it works |
| `getting-started/`, `using-the-api/` | Quickstart, keys, both call modes, models, API reference |
| `credits/`, `accounts/`, `concepts/` | Credits, vaults, purchases, linked wallets, NEAR Intents, privacy and trust |
| `specs/` | Units and identifiers, the ledger, the vaults, the gateway, the keeper, wallet proofs |
| `reference/` | Live deployments, verification, known limits, FAQ |
| `.vitepress/config.ts` | Navigation, sidebar, search |
| `public/` | Logo and favicon |

The pages restate what the root README, `docs/interfaces.md` and the component READMEs say. When those change, change the page too.

## Deployment

A static deployment of `.vitepress/dist` (Vercel reads `vercel.json`).
