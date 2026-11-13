# How it works

InferNear connects three things that normally live apart: the wallet and assets you already have on your own chain, a credit ledger on NEAR, and NEAR AI Cloud's private models.

## The problem it solves

NEAR AI Cloud runs open models inside attested TEEs, so a prompt can stay private from the operator. But it is paid for from a NEAR AI account, and most people who want private AI keep their assets and wallets on other chains. They also do not want API bills to eat their capital.

InferNear gives them one OpenAI-format endpoint, sign-in with the wallet they already have, and a way to pay with the yield on a deposit they keep.

## The flow

<HowItWorksFlow />

1. **Deposit on your chain.** You deposit into a vault and keep the principal. Only the surplus above principal, the yield, is paid to InferNear.
2. **Yield becomes credits.** A keeper reads each depositor's yield at a finalized block, prices it in USD, and posts it to the credit ledger on NEAR.
3. **Sign in and get a key.** You sign one message with your wallet to create an API key. No NEAR account is needed.
4. **Call the API.** You point an OpenAI client, or NEAR AI's SDK, at InferNear's endpoint.
5. **The gateway checks and forwards.** It checks your credits on the ledger, forwards the request to NEAR AI Cloud on InferNear's own NEAR AI account, and passes the reply back.
6. **The call is settled on NEAR.** The gateway charges the usage the model reports and records it on the ledger under the call's inference ID.

## The parts

| Part | Where it runs | What it does |
|---|---|---|
| **Vaults** | Base (three ERC-4626 vaults) and NEAR (the Rhea USDC vault) | Hold principal; pay out only yield |
| **Credit top-up** | Base | Sells credits for USDC, for people who prefer not to deposit |
| **Keeper** | InferNear's relay | Reads vaults and purchases at finalized blocks and posts credits to the ledger |
| **Credit ledger** | NEAR (`connector.infernear-ai.near`) | Records credits posted and spent per user, with a receipt for every paid call |
| **Gateway** | InferNear's relay (`api.infernear.dev`) | Authenticates API keys, checks credits, forwards calls, settles charges |
| **NEAR AI Cloud** | NEAR AI's TEEs | Runs the models and signs their replies |
| **Console** | `app.infernear.dev` | Deposits, withdrawals, API keys, a place to try the API |

## What NEAR does in InferNear

| NEAR technology | Its job here |
|---|---|
| **NEAR AI Cloud** | Every model InferNear serves is one of NEAR AI Cloud's attested TEE chat models |
| **TEE attestation and signed replies** | In private mode the SDK checks the model's hardware attestation, encrypts the prompt to that TEE and verifies the model's signature over the reply |
| **NEAR Intents (1Click)** | Carries USDC between a user's chain and NEAR. See [NEAR Intents](../concepts/near-intents.md) |
| **NEAR smart contracts** | The credit ledger and the Rhea USDC vault |
| **Rhea Lend** | The Rhea vault supplies its USDC there; the interest is the yield |
| **NEAR accounts and wallets** | A NEAR user signs in with Meteor Wallet, can deposit from their own account, and can link an EVM wallet |

Settlement is on NEAR throughout: credits are posted to the ledger by the keeper, and each paid call is charged there.

## Two ways to call

| Mode | Client | What the relay sees |
|---|---|---|
| [Standard](../using-the-api/standard-mode.md) | Any OpenAI client | The prompt and reply in transit. It stores neither |
| [Private](../using-the-api/private-mode.md) | NEAR AI's inference SDK | Ciphertext, plus request size, timing and token counts |

Both modes serve the same attested models at the same prices.

## Prior art

Paying for AI with yield is not new. NEAR AI's own Staking for Inference turns NEAR staking yield into inference credits for NEAR stakers, and BRRRAIN pools staked NEAR to give holders AI credits. InferNear differs in who it serves and how: users on other chains keep the asset they already hold, earn market yield in several shapes with no NEAR price exposure, get a per-user on-chain credit ledger, and can send prompts the relay cannot read.
