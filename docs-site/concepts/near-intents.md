# NEAR Intents

NEAR AI Cloud's private models are paid for on NEAR, but most people's assets and wallets are somewhere else. InferNear is designed around **NEAR Intents (the 1Click API)** as the rail between the two, so a user on another chain can fund private inference without holding a NEAR account, a NEAR key or NEAR tokens.

::: info What is live today is narrower than the design
The console fetches real quotes from NEAR Intents. The routes that carry funds are built and tested, but have not carried funds on mainnet yet. The three Base vaults and the credit top-up do not need Intents at all.
:::

## What Intents carries

<IntentsRoutes />

| # | Route | How | Status |
|---|---|---|---|
| 1 | USDC from another chain to your own Base address | A 1Click quote, then one transfer on the origin chain | The console shows real quotes for USDC from Ethereum, Arbitrum, Optimism or Polygon. Sending is switched off in this release |
| 2 | Base USDC into the Rhea USDC vault on NEAR | 1Click delivers USDC to the vault with a note naming your EVM address, so the vault records the principal under that address | Built and tested on fixtures. The live route returns quotes. No funded deposit yet |
| 3 | Your principal from NEAR back to your own Base address | You sign a withdrawal with your EVM wallet. The vault pays out through NEAR Intents to that same address. The relay submits the transactions, so you pay no NEAR gas | Built and tested on fixtures. Not yet run with funds |
| 4 | InferNear's collected yield from Base to its treasury on NEAR | The keeper asks 1Click for a quote and sends the yield once it is worth bridging | Built and tested. Switched off in this deployment |

## What that gives a user

* **No NEAR account anywhere.** An EVM signature is the only thing a Base user ever produces: for deposits, for withdrawals from the NEAR vault, and for API keys.
* **Principal comes home.** Exits from the NEAR vault can only be paid to the EVM address that owns the position. The relay cannot redirect them.
* **One credit balance.** Yield from every vault, on Base or on NEAR, lands on the same NEAR ledger.

## See a live quote

This asks NEAR Intents for a dry-run quote of 2 USDC from Base into the Rhea vault. It needs no key and sends nothing. The address is InferNear's public yield recipient, standing in for a user's.

```sh
curl -s https://1click.chaindefuser.com/v0/quote -H 'content-type: application/json' -d '{
  "dry": true, "swapType": "EXACT_INPUT", "slippageTolerance": 100,
  "originAsset": "nep141:base-0x833589fcd6edb6e08f4c7c32d4f71b54bda02913.omft.near",
  "destinationAsset": "nep141:17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1",
  "depositType": "ORIGIN_CHAIN", "recipientType": "DESTINATION_CHAIN", "refundType": "ORIGIN_CHAIN",
  "amount": "2000000", "recipient": "rhea.infernear-ai.near",
  "refundTo": "0xdf26ee9d5428ca51a7f9fa26c88bad8367423654",
  "customRecipientMsg": "{\"user\":\"eip155:8453:0xdf26ee9d5428ca51a7f9fa26c88bad8367423654\"}",
  "deadline": "2026-12-31T00:00:00.000Z"
}'
```

On 12 Nov 2026 it quoted about 1.9997 USDC delivered in about 35 seconds. It is a call to an outside service, so it can be unavailable.
