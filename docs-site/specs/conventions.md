# Conventions and units

The specs in this section describe the interfaces between InferNear's components as they are deployed. The source of truth is the code and [`docs/interfaces.md`](https://github.com/alvinyap510/near-hackathon-infernear/blob/main/docs/interfaces.md) in the repository.

## Components

| Component | Runs on | Built with | Path in the repository |
|---|---|---|---|
| Base vaults and credit top-up | Base mainnet (chain 8453) | Solidity, Foundry, OpenZeppelin | `contracts/evm/` |
| Credit ledger (connector) | NEAR mainnet | Rust, near-sdk | `contracts/near/` |
| Rhea USDC vault | NEAR mainnet | Rust, near-sdk | `contracts/near/rhea-vault/` |
| Relay: gateway and keeper | One Node process behind `api.infernear.dev` | TypeScript, viem, near-api-js | `relay/` |
| Console | `app.infernear.dev` | React, Vite | `web/` |

## Identifiers

| Thing | Format | Example |
|---|---|---|
| EVM user | `eip155:8453:<address, lower case>` | `eip155:8453:0xdf26ee9d5428ca51a7f9fa26c88bad8367423654` |
| NEAR user | `near:mainnet:<account id>` | `near:mainnet:alice.near` |
| Base vault | `eip155:8453:<vault address, lower case>` | |
| NEAR vault | `near:mainnet:<vault account id>` | `near:mainnet:rhea.infernear-ai.near` |
| API key | `inf_…` | |
| Account | `acc_<32 hex>` | |

The namespace of a vault id names the chain its `source_block` refers to. An EVM user does not need a NEAR account.

## Amounts

| Quantity | Unit | Notes |
|---|---|---|
| Credits | micro-USD | 1,000,000 micro-USD = $1 |
| Model prices | nano-USD per token | NEAR AI quotes `amount` at `scale: 9` |
| Principal and yield | the token's own base units | USDC has 6 decimals, cbETH and the PT have 18 |
| Rate | micro-USD per 1e18 yield-token base units | USDC uses `1000000000000000000`, so 1 USDC base unit = 1 micro-USD |

On NEAR, integer amounts travel as JSON strings (`U128`). Block numbers, nonces and pagination arguments are JSON numbers.

## Pricing a call

```
cost in micro-USD = ceil(tokens × nano-USD per token / 1000)
```

The gateway takes a snapshot of the model's input and output prices when it admits a call, and the charge uses that snapshot.

## Finality

Credits are derived only from finalized chain state.

* Base vaults and the top-up contract are read at a recent **finalized** Base block. Finality on Base trails the head by about 20 minutes.
* The Rhea vault is read at a **finalized** NEAR block.
* The price feed for a vault is read at the same block as the vault.

## Events on NEAR

Both NEAR contracts emit NEP-297 events with `standard: "infernear"` and `version: "1.0.0"`. Each event carries a one-element `data` array.
