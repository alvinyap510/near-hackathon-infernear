# Credit ledger

The credit ledger is the NEAR contract [`connector.infernear-ai.near`](https://nearblocks.io/address/connector.infernear-ai.near). It records, per user, the credits posted and the credits spent, and keeps a receipt for every paid call.

| Property | Value |
|---|---|
| Source | `contracts/near/src/lib.rs` |
| Initialized with | `new(keeper: AccountId, gateway: AccountId)`, once |
| Owner or admin | none |
| Access keys on the account | none |
| Funds held | none. It pays for its own storage |

## Roles

| Role | Account | May call |
|---|---|---|
| Keeper | `keeper.infernear-ai.near` | `post_credits` |
| Gateway | `gateway.infernear-ai.near` | `debit`, `bump_key_epoch` |
| Anyone | | the view methods |

Both roles use function-call keys restricted to this contract and to those methods.

## Methods

### `post_credits`

```
post_credits(vault: String, paid_cum: U128, rate: U128, source_block: u64, entries: Vec<(String, U128)>)
```

Called by the keeper. Each entry is `(user, cum)`: the cumulative yield attributed to that user in the vault, in yield-token base units.

1. Store the larger of the stored and the given `paid_cum` for the vault.
2. For each `(user, vault)`: `delta = cum − posted_cum`, which must not be negative.
3. `x = remainder + delta × rate`. Add `x / 1e18` micro-USD to the user's credits and keep `x % 1e18` as the new remainder.
4. Add `delta` to the vault's `posted_total`, and require `posted_total ≤ paid_cum`. Both are in the yield token's own units, not in micro-USD.

All products and sums are checked `u128` arithmetic. A replay adds nothing, even with a different rate, because `delta` is zero. Emits `post_credits`.

### `debit`

```
debit(user: String, amount_micro: U128, receipt: Receipt)
```

Called by the gateway.

* **Idempotent** by `receipt.inference_id`. Repeating a debit is a successful no-op.
* Otherwise requires `spent + amount ≤ credited`, then stores the amount under the inference ID.

Emits `debit` with the receipt.

### `bump_key_epoch`

```
bump_key_epoch(user: String) → u32
```

Called by the gateway when a user revokes their keys. It increments the user's `key_epoch`, which invalidates every API key issued under an earlier epoch. Emits `key_epoch`.

### Views

| Method | Returns |
|---|---|
| `account(user: String)` | `{ credited: U128, spent: U128, available: U128, key_epoch: u32 }` |
| `debited_amount(inference_id: String)` | `Option<U128>`: the amount charged for that inference, or null |
| `vault(vault: String)` | `{ paid_cum: U128, posted_total: U128 }` |

## Receipt

```
Receipt {
  inference_id: String,        // the Inference-Id response header. If absent on a 2xx,
                               // UUIDv5 of the completion id
  chat_id: String,             // completion id
  model: String,               // canonical model id
  prompt_tokens: u64,          // reported usage. For "reservation", the input bound
  completion_tokens: u64,      // reported usage. For "reservation", max_tokens
  in_price_nano: U128,         // per token, snapshot at admission
  out_price_nano: U128,
  source: "signed_usage" | "reservation"
}
```

`source: "reservation"` marks a completed reply that reported no usage. It is charged at the reserved maximum.

## Events

| Event | Data |
|---|---|
| `post_credits` | `{ vault, paid_cum, rate, source_block, entries: [[user, "cum"], …] }` |
| `debit` | `{ user, amount_micro, receipt }` |
| `key_epoch` | `{ user, key_epoch }` |

## Invariants

* `spent ≤ credited`, per user, always.
* For each vault, `posted_total ≤ paid_cum`: the yield posted for users, in the yield token's own units, never exceeds the yield total reported for the vault.
* One debit per inference ID.
* Fractions of a micro-USD are never dropped: the per-user, per-vault remainder is carried at scale 1e18.

## Storage

Each debit stores one inference ID and one amount, permanently. The contract pays for that storage from its own balance, so the operator has to keep it funded. When the free balance cannot cover about ten more debits, the gateway refuses credit-paid calls with `503 ledger_storage_low`.
