# Vision

**Private, reliable AI inference for people on every chain.**

## Where we start

Private AI already exists. NEAR AI Cloud runs open models inside attested TEEs, so a prompt can stay private even from the operator of the machine. But two things keep most people away from it.

1. **It lives on NEAR.** It is paid for from a NEAR AI account, and most people who want private AI keep their wallets and their assets on other chains.
2. **API bills eat capital.** Paying for inference means spending down what you hold.

## What InferNear is

InferNear is a layer on top of NEAR AI, in the way OpenRouter is a layer on top of model providers: one endpoint, one key, and the provider's account is somebody else's problem.

It is **not** a stake-to-inference product. Staking NEAR for AI credits already exists and serves people who are already on NEAR. InferNear is for everybody else. It combines the NEAR stack (NEAR AI Cloud, TEE attestation, NEAR Intents and NEAR smart contracts) to bring private inference to people who never touch NEAR at all.

## The ideas it is built on

### You stay where you are

Your chain, your wallet. You sign in with the wallet you already have and you never need a NEAR account, a NEAR key or NEAR tokens. Only InferNear holds NEAR and NEAR AI accounts, and it relays your requests through its own.

### Keep the principal, let the yield pay

You deposit into a vault on your own chain and the principal stays yours. InferNear works out the yield your deposit earns and gives you credits to match. The capital is never spent.

The vaults are built around four shapes of yield, so that the asset you already hold can be the one that pays:

| Yield shape | Example |
|---|---|
| A growing balance | Lending USDC on Aave |
| Appreciation with a cap | A Pendle principal token rising to face value |
| Appreciation with no cap | A liquid staking token such as cbETH |
| Staking with claimable rewards | Built and tested, not yet deployed |

### Proof, not promises

A layer in the middle is only worth using if it cannot cheat. InferNear is designed so that you can check instead of trust:

* **Your prompts.** In private mode the prompt is encrypted on your machine to a model whose TEE attestation your own code verifies. The relay forwards bytes it cannot read, and the model signs its reply.
* **Your money.** The Base vaults have no owner or admin and pay out only yield. Only you can withdraw your principal. The one exception during the hackathon, the Rhea vault's deployment key, is spelled out in [Privacy and trust](../concepts/privacy-and-trust.md).
* **Your credits.** Every credit posted and every call charged is recorded on a public ledger on NEAR, per user, with a receipt.

### One endpoint, the format you already use

The product is an API for developers, not a chat app. It speaks the OpenAI Chat Completions format, so existing clients work by changing the base URL and the key. The console is where you manage deposits and keys.

### Private models only

Every model InferNear serves runs in one of NEAR AI Cloud's attested TEEs. There are no closed, non-attested models behind the endpoint.

## Where it is today

* An OpenAI-format endpoint serving NEAR AI's attested TEE chat models, in standard and private mode.
* Three vaults on Base (Aave USDC, cbETH, Pendle PT) and one on NEAR (Rhea USDC), plus direct credit purchases with USDC.
* A credit ledger on NEAR with no keys and no admin.
* Sign-in with an EVM wallet or a NEAR wallet, and accounts that link the two.

It was built in two weeks at the NEAR HACKATHON and runs on mainnet with small caps. [Known limits](../reference/known-limits.md) says exactly what is and is not done.

## Where it goes

These are directions, not commitments.

* **More chains.** The design does not depend on Base. A new chain needs a vault for one of the four yield shapes and a way to read it at a finalized block. The landing page names the chains we want to reach next: Ethereum, BNB Chain, Arbitrum and Robinhood Chain, then Solana and Sui.
* **NEAR Intents carrying funds, not only quotes.** The routes that bring USDC from other chains, move it into the NEAR vault and take principal home are built and tested. They still have to carry real funds. See [NEAR Intents](../concepts/near-intents.md).
* **The fourth yield shape.** A vault for staking with claimable rewards is built and tested but not deployed.
* **Cheaper settlement.** Today every paid call is its own NEAR transaction. A production version would batch them.
