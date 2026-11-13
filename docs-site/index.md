# Welcome to InferNear

**Private AI inference for people on every chain, paid for by the yield on their own deposits.**

InferNear is an OpenAI-format API endpoint on top of NEAR AI's private TEE models. You deposit into a vault on your own chain and keep the principal. The yield goes to InferNear and comes back to you as API credits on NEAR. You never need a NEAR account or NEAR tokens: only InferNear does.

| | |
|---|---|
| API endpoint | `https://api.infernear.dev/v1` |
| Console | [app.infernear.dev](https://app.infernear.dev) |
| Landing page | [infernear.dev](https://infernear.dev) |
| Source code | [github.com/alvinyap510/near-hackathon-infernear](https://github.com/alvinyap510/near-hackathon-infernear) |

## What you can do with it

* **Call private models with the client you already use.** Point any OpenAI client at InferNear by changing the base URL and the key.
* **Keep prompts unreadable to InferNear.** Use NEAR AI's SDK and the prompt is encrypted on your machine to an attested model; the relay only forwards ciphertext.
* **Pay with yield instead of capital.** Deposit into a vault on Base or NEAR, keep the principal, and spend the yield as credits.
* **Or just buy credits** with USDC on Base, at 1 USDC for $1 of credits.
* **Try it first.** Every wallet gets 5 free trial calls.

## Start here

| If you want to… | Read |
|---|---|
| Make a first call in a few minutes | [Quickstart](getting-started/quickstart.md) |
| Use an OpenAI client | [Standard mode](using-the-api/standard-mode.md) |
| Keep prompts private from the relay | [Private mode](using-the-api/private-mode.md) |
| See every route, header and error | [API reference](using-the-api/api-reference.md) |
| Understand where credits come from | [How credits work](credits/how-credits-work.md) |
| Deposit into a vault | [Vaults](credits/vaults.md) |
| Know exactly what is trusted | [Privacy and trust](concepts/privacy-and-trust.md) |

## Status

InferNear was built at the NEAR HACKATHON (1 to 14 Nov 2026). It is deployed on mainnet with small deposit caps. Read [Known limits](reference/known-limits.md) before you put funds in: it lists what is live, what has only run in tests, and what is switched off.
