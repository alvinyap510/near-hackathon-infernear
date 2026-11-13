# Verify it yourself

Everything InferNear claims can be checked: against the live services, on chain, and from a clean clone of the repository.

## Against the live services (no wallet)

1. **The models.** `curl -s https://api.infernear.dev/v1/models` returns the served TEE models with their prices.
2. **The vaults.** Open [app.infernear.dev](https://app.infernear.dev): the Vaults tab reads the four vaults from Base and NEAR.
3. **The contracts.** Follow the explorer links on [Live deployments](live-deployments.md).
4. **A real model reply.** From a clone of the repository:

   ```sh
   cd relay && npm ci --ignore-scripts && npm run live-check
   ```

   A throwaway key signs in to the live relay, receives an API key and makes one free call. The script prints seven `ok` lines and ends with `PASS`. It sends no transaction and uses one of the day's shared free calls.

## From a clean clone

Prerequisites: Node 24.22.1 or newer, Foundry (Forge 1.5.1), Rust 1.97.1 with the `wasm32-unknown-unknown` target, a C/C++ toolchain and CMake. Each step needs the network once, to install dependencies. After that the tests run offline, against mocks and fixtures.

```sh
# API relay: gateway and keeper
cd relay && npm ci --ignore-scripts && npm test && npm run demo && cd ..

# Console
cd web && npm ci --ignore-scripts && npm test && npm run build && cd ..

# Base vaults and the credit top-up contract
cd contracts/evm && npm ci --ignore-scripts && forge build && forge test --offline && cd ../..

# NEAR credit ledger and Rhea vault
cd contracts/near && cargo fetch --locked && cargo test --locked --workspace && cd ../..

# Landing page
cd landing && npm ci --ignore-scripts && npm run build && cd ..
```

What each block prints when it passes:

| Block | Expected |
|---|---|
| Relay | `tests 97`, `pass 97`, `fail 0`, then the demo's last line `{"fixture":true,"status":200,"credited":"1000","spent":"13","available":"987"}` |
| Console | `tests 104`, `pass 104`, `fail 0`, then `built` |
| Base contracts | `85 tests passed, 0 failed, 3 skipped` (the three skipped tests need a Base RPC) |
| NEAR contracts | `test result: ok. 14 passed` (credit ledger) and `test result: ok. 44 passed` (Rhea vault) |
| Landing page | `built` |

The relay demo is a fixture flow: a holder receives 1,000 micro-USD of credits from a finalized vault snapshot, spends 13 through the HTTP API, and has 987 left.

## On chain

* **Your balance and charges.** The ledger's view methods are public. See [How credits work](../credits/how-credits-work.md#check-your-balance).
* **The deployed code.** Compare it with your own build. See [Live deployments](live-deployments.md#the-deployed-code-matches-the-repository).

## Where things are in the repository

| Component | Path |
|---|---|
| Base vaults and top-up contract (Solidity, Foundry) | `contracts/evm/` |
| Credit ledger and Rhea vault (Rust, near-sdk) | `contracts/near/` |
| Gateway and keeper (TypeScript, Node) | `relay/` |
| Console (Vite, React) | `web/` |
| Landing page | `landing/` |
| Interfaces between components | `docs/interfaces.md` |
| Deployment (Docker, Cloudflare Tunnel) | `deploy/` |

Each component has its own README with its full verification set.
