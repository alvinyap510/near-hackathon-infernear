# InferNear dashboard (`web/`)

The account dashboard for the InferNear endpoint: vault balances and deposit/redeem, API keys, a "Try the API" quickstart with a Verified panel and a bill check, and a "from another chain" panel.

> **Mock data.** The dashboard isn't wired to Base, NEAR or the relay yet. Every balance, key, attestation and receipt comes from an in-memory mock (`src/data/mock.ts`), and every screen shows a "Mock data" ribbon while it is in use.

## Run

Node 22.18 or newer. From this folder:

```sh
npm install
npm run dev      # serves http://localhost:5173
```

The dashboard reads `VITE_*` variables from the repository-root `.env`. To fill them from the template, run `cp ../.env.example ../.env`. Any variable left unset is shown by name in the UI, for example `$VITE_VAULT_ADDRESS`.

## Build and test

```sh
npm run build    # type-check, then production build into dist/
npm test         # unit tests for the money formatting and bill-check arithmetic
```

## Layout

| Path | What |
|---|---|
| `src/data/types.ts` | `DashboardData`: everything the UI reads or does, with shapes from `docs/interfaces.md` |
| `src/data/mock.ts` | The mock implementation (labelled in the UI) |
| `src/data/money.ts` | Integer micro-USD formatting and the signed-usage cost the bill check recomputes |
| `src/quickstart.ts` | The JavaScript and Python quickstart shown on "Try the API" |
| `src/screens/` | Connect, Account, API keys, Try the API, From another chain |
