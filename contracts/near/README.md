# NEAR contracts

Rust / `near-sdk` 5.30 workspace containing the inference credit connector and the [Rhea USDC vault](rhea-vault/README.md). Both are tested locally. Neither deployment nor a funded mainnet probe was run for this revision.

## Verified build and tests

Prerequisites: rustup Rust 1.97.1, `wasm32-unknown-unknown`, a native C/C++ toolchain and CMake. Put rustup's tools first on `PATH` if another Rust installation lacks the WASM target. From this directory:

```sh
cargo fetch --locked
cargo fetch --locked --manifest-path rhea-vault/test-contracts/mock/Cargo.toml
cargo test --locked --workspace
cargo build --locked --target wasm32-unknown-unknown --release --workspace
cargo build --offline --locked --manifest-path rhea-vault/test-contracts/mock/Cargo.toml --target-dir target/mock --target wasm32-unknown-unknown --release
cargo test --offline --locked -p infernear-rhea-vault --features sandbox-gas --test gas -- --nocapture
cargo clippy --offline --workspace --all-targets --features sandbox-gas -- -D warnings
cargo fmt --all -- --check
cargo test --offline --locked -p infernear-connector debit_storage_measurement -- --nocapture
```

The two fetches require network once; the second fetches the local mock contract, which has its own manifest. The 14 connector tests and 31 vault tests then run offline against NEAR's mocked runtime, including generated conservation sequences. The same verification block also runs the sandbox gas test; its first run may download near-sandbox 2.14.0. The default workspace test alone excludes that feature-gated test. Local mock prerequisites are detailed in the vault README. Release outputs are `target/wasm32-unknown-unknown/release/infernear_connector.wasm` (**352,481 bytes**) and `infernear_rhea_vault.wasm` (**422,267 bytes**) with this toolchain; sizes vary by a few hundred bytes with the checkout path, which is embedded in panic locations. These are plain Cargo release builds, without cargo-near's additional optimization.

## Connector

Initialize once with `new(keeper, gateway)`. There is no owner or administrative method. The connector holds no funds or principal; its account pays for code and ledger storage. Runtime constructor accounts come from `.env.example`; there are no compiled deployment addresses.

The exact methods, JSON types, Receipt and NEP-297 events are in [interfaces.md](../../docs/interfaces.md). Credits use micro-USD; cumulative yield totals remain in each vault's yield-token units. Vault identifiers support `eip155:8453:` and `near:mainnet:` namespaces. The keeper posts:

`post_credits(vault, paid_cum, rate, source_block, entries)`

For each user/vault, the new cumulative delta is converted once at that post's frozen rate: `x = remainder + delta * rate`, credit `x / 1e18`, carry `x % 1e18`. Every product and sum is checked. USDC uses `rate = 1e18`. Historical totals are never repriced, and a replay with another rate adds nothing. `source_block` names the finalized block on the vault's chain; both fields appear in the event. The contract trusts the keeper's rate and attribution, and enforces `sum(posted token units) <= paid_cum`. The spending invariant is `spent <= credited = sum_vault floor(sum_posts(delta * rate) / 1e18)`.

The vault payment watermark is the largest posted value. Negative deltas, over-budget batches and overflows fail before ledger writes; repeated entries are processed in order. Exact replays write nothing and emit nothing. Only the gateway can debit or bump key epochs. Inference IDs are globally idempotent, including zero-cost charges; a retry never charges twice. Receipts are event data, not stored balances.

This revision changes the posting map's serialized value as well as its call signature. **Redeploy the connector; do not load an old deployment's state with this binary.** There is no migration or upgrade method.

## Storage per debit

The storage test flushes collections and serializes state. A fresh 36-byte inference ID adds **97 bytes**; replay adds zero. The SDK storage price is `10^19` yoctoNEAR per byte, so this locks **0.00097 NEAR** per such debit, excluding gas, code and initial records. General size: `61 + inference_id UTF-8 bytes`. Pre-fund the connector account; insufficient storage makes the transaction fail, and the gateway can retry the same ID.
