# InferNear

Private, verifiable AI inference for people on every chain, paid for by the yield on their own deposits.

InferNear is an OpenAI-format API endpoint on top of NEAR AI's private TEE models. You deposit into an ERC-4626 vault on your own chain and keep the principal; the yield goes to InferNear and comes back to you as API credits. Prompts are encrypted on your machine to an attested NEAR AI model, so InferNear can't read them.

> **Status: in development for the NEAR HACKATHON (1–14 Nov 2026).** Nothing in this README is claimed to work yet. Each section is filled in only once the feature runs from a clean clone with the commands shown.

## Repository layout

| Path | What |
|---|---|
| `contracts/evm/` | ERC-4626 principal vault and its yield-shape adapters (Foundry) |
| `contracts/near/` | NEAR connector contract: the credit ledger (Rust, near-sdk) |
| `relay/` | The API endpoint (gateway) and the keeper (TypeScript) |
| `web/` | The dashboard (Vite + React) |
| `docs/` | Interfaces between the components |
