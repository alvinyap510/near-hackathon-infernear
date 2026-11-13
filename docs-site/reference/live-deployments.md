# Live deployments

Everything below is on mainnet.

## Services

| Piece | Where |
|---|---|
| API endpoint | `https://api.infernear.dev/v1` |
| Console | [app.infernear.dev](https://app.infernear.dev) |
| Landing page | [infernear.dev](https://infernear.dev) |

## Contracts on NEAR

| Contract | Account |
|---|---|
| Credit ledger | [`connector.infernear-ai.near`](https://nearblocks.io/address/connector.infernear-ai.near) |
| Rhea USDC vault | [`rhea.infernear-ai.near`](https://nearblocks.io/address/rhea.infernear-ai.near) |

## Contracts on Base

| Contract | Address |
|---|---|
| Aave USDC vault | [`0x19110449a361855d30090BC26112E9a5c3793198`](https://basescan.org/address/0x19110449a361855d30090BC26112E9a5c3793198) |
| cbETH vault | [`0x20B3852c32FFCBfD6a713045e7eA411683446f40`](https://basescan.org/address/0x20B3852c32FFCBfD6a713045e7eA411683446f40) |
| Pendle PT-deJAAA vault | [`0x5801707F6AF54f33Ab3E1910c09D79B81D4Be92c`](https://basescan.org/address/0x5801707F6AF54f33Ab3E1910c09D79B81D4Be92c) |
| Credit top-up | [`0xa62E3f3328e33DeB233C655df4f379c1bE7b03c6`](https://basescan.org/address/0xa62E3f3328e33DeB233C655df4f379c1bE7b03c6) |

## Deposit caps

Each vault has a cap of about $10,000:

| Vault | Cap |
|---|---|
| Aave USDC | 10,000 USDC |
| Rhea USDC | 10,000 USDC |
| cbETH | 5 ETH of principal |
| Pendle PT-deJAAA | 10,000 USD of PT principal |

## The deployed code matches the repository

You can check that what runs on chain was built from the [public repository](https://github.com/alvinyap510/near-hackathon-infernear).

### NEAR

Build both contracts and hash them:

```sh
cd contracts/near && cargo build --locked --target wasm32-unknown-unknown --release --workspace
shasum -a 256 target/wasm32-unknown-unknown/release/infernear_connector.wasm \
  target/wasm32-unknown-unknown/release/infernear_rhea_vault.wasm
```

| Contract | sha256 of the build | `code_hash` on chain (the same 32 bytes in base58) |
|---|---|---|
| `connector.infernear-ai.near` | `00405ebcf2c94c06ce4672a9bc4bc8eac8adae652fbd424c4d5e0649baf6fb65` | `1yvttLvjVnHFuuDgWrQNZYNbvsCtSctYKDwv5dRajye` |
| `rhea.infernear-ai.near` | `87f913f1ecd7dd80358d48dd97130dbc6138bd1376adc0e52042ae32e289d92c` | `A9nKrBReW24CktqUiFPnG4YHBmHgAzaQbh8ezpyxQiKD` |

The on-chain value is the `code_hash` field of a `view_account` query on any NEAR RPC. These hashes were produced with Rust 1.97.1 on macOS (checked 13 Nov 2026). Another toolchain can produce different bytes.

### Base

```sh
cd contracts/evm && forge build
```

Then compare each contract's deployed runtime bytecode (`cast code <address>`) with `deployedBytecode` in `out/<Contract>.sol/<Contract>.json`. They are equal apart from the constructor's immutable values.
