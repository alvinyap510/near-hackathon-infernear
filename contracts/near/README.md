# NEAR credit connector

Rust / `near-sdk` 5 ledger for USDC-backed inference credits. No tokens or principal enter this contract. Its NEAR account must be funded for code and ledger storage; calls attach no deposit. This component is tested locally and has not been deployed.

## Build and test

Prerequisites: Rust through rustup (verified with 1.97.1), the `wasm32-unknown-unknown` target, a native C/C++ toolchain and CMake for test dependencies, and `cargo-near` 0.22.0. Ensure rustup's `cargo` and `rustc` are first on `PATH` (rather than a separate system Rust without the WASM target).

From the repository root:

```sh
cd contracts/near
cargo fetch --locked
cargo test --offline --locked
cargo near build non-reproducible-wasm --locked
cargo test --offline --locked debit_storage_measurement -- --nocapture
cargo fmt -- --check
```

Fetching dependencies requires network access once; tests then run offline using NEAR's mocked runtime. The suite includes generated sequences across multiple users and vaults, with storage flushed and contract state reloaded between operations. It checks `sum(spent) <= sum(credited) <= sum(paid_cum)`, per-vault budgets, rejected batches, replay safety, caller authorization, key epochs, integer boundaries and event JSON. No live network tests or deployment are run.

The build emits `target/near/infernear_connector.wasm` plus its JSON ABI. `target/` is generated and ignored. The local build embeds the ABI and runs cargo-near's WASM optimization; the verified binary is **164,372 bytes** with Rust 1.97.1.

## Contract behavior

Initialize once with `new(keeper, gateway)`, using configured NEAR account IDs. The shared `.env.example` already names these as `NEAR_KEEPER_ACCOUNT`, `NEAR_GATEWAY_ACCOUNT` and `NEAR_CONNECTOR_ACCOUNT`; the contract itself has no compile-time environment variables. There is no owner or administrative method.

The public methods and `Receipt` are defined in [the component interface](../../docs/interfaces.md). The SDK also generates its standard read-only NEP-330 `contract_source_metadata` view. User and vault keys are canonical lower-case EVM CAIP-10 strings supplied by the relay. Amounts are JSON integer strings (`U128`); 1 USDC base unit equals 1 micro-USD. This version performs no conversion for other tokens.

Only the keeper can post cumulative per-user yield. The stored vault payment watermark is the maximum ever posted. A negative cumulative delta or a batch exceeding that vault's paid watermark fails before any ledger write. Repeated users within a batch are processed in order. Exact replays do not write storage or emit another event.

Only the gateway can debit or increment a user's key epoch. Every inference ID is global: once recorded, any retry of that ID succeeds without another charge, even if retry arguments differ. The original amount remains available through `debited_amount`. A fresh ID requires enough available credit. Zero-cost inferences are also recorded. Epochs start at zero and increments preserve credit balances.

Events are NEP-297 (`infernear`, `1.0.0`) with a one-element `data` array:

- `post_credits`: `{ vault, paid_cum, entries }`, using the stored maximum `paid_cum` and supplied cumulative entries.
- `debit`: `{ user, amount_micro, receipt }`, with the complete receipt. Token counts may be null for the `billing` source.
- `key_epoch`: `{ user, key_epoch }`.

Receipts are public event data, not stored ledger values. The keeper is trusted to report actual paid yield and its honest attribution; the gateway is trusted to report usage. The contract enforces cumulative posting and spending bounds; it does not verify EVM payments or model signatures.

## Storage per debit

`debit_storage_measurement` measures `env::storage_usage()` after flushing collections and serializing contract state, with an existing credited account and a fresh 36-byte inference ID. One debit adds **97 bytes**: 1-byte map prefix + 4-byte string length + 36-byte ID + 16-byte `u128` amount + 40-byte runtime record overhead. Existing account balances have fixed serialized sizes. A duplicate adds zero bytes.

At the SDK's `env::storage_byte_cost()` of `10^19` yoctoNEAR per byte, matching [NEAR's documented storage price](https://docs.near.org/protocol/storage/storage-staking), this locks **0.00097 NEAR** per such debit (0.97 NEAR per 1,000), excluding gas, code and initial account/vault records. In general the debit record adds `61 + inference_id UTF-8 bytes` bytes. Pre-fund and monitor the connector account; insufficient storage balance makes a transaction fail, and the gateway can retry the same inference ID.
