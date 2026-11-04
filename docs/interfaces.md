# Interfaces between components

The vault, the connector, the relay and the dashboard are built in parallel against this file. Change it only together with every component that uses it.

## Shared conventions

- **User id:** the CAIP-10 id of the vault-share owner, with the address in lower case: `eip155:8453:0xabc…`. Users never need a NEAR account.
- **Vault id:** the CAIP-10 id of the vault contract, same format.
- **Amounts on NEAR:** JSON strings of integers (`U128`). Credits are in **micro-USD**. v1 has USDC vaults only, so 1 USDC base unit (6 decimals) = 1 micro-USD.
- **Prices:** NEAR AI quotes cost per token in nano-USD (`amount` at `scale: 9`). Cost in micro-USD = `ceil(tokens × nano_per_token / 1000)`.

## EVM: `PrincipalVault` (Base, Solidity, extends OpenZeppelin `ERC4626`)

Standard ERC-4626 and ERC-20 functions and events, plus:

| Member | Kind | Meaning |
|---|---|---|
| `skim()` | external | attribute new yield to holders and pay it to `yieldRecipient`; reverts if the payment fails |
| `unpaid() → uint256` | view | yield attributed but not yet paid, in `yieldToken` units |
| `paidTotal() → uint256` | view | cumulative yield paid to `yieldRecipient` |
| `yieldCredited(address) → uint256` | view | cumulative yield attributed to a holder, including unsettled earnings; monotonic |
| `yieldToken() → address` | view | the token yield is paid in (USDC for the Aave vault) |
| `yieldRecipient() → address` | view | InferNear treasury |
| `depositCap() → uint256` | view | maximum total shares |
| `cushion() → uint256` | view | rounding budget kept in the vault |
| `unattributed() → uint256` | view | cumulative yield measured at zero supply (credited to nobody), so `Σattributed + unattributed = paidTotal + unpaid` is checkable |
| `event Skimmed(address indexed token, uint256 attributed, uint256 paid, uint256 acc)` | event | one per skim that attributes or pays |
| `event PayFailed(bytes reason)` | event | a best-effort payment inside a deposit, withdrawal or transfer failed; attribution is kept |

## NEAR: connector contract (`near-sdk` 5)

Initialized once with `new(keeper: AccountId, gateway: AccountId)`. There is no owner and no admin method. NEAR events use NEP-297 with `standard: "infernear"`, `version: "1.0.0"`. Each event has a one-element `data` array: `post_credits` → `{ vault, paid_cum, entries: [[user, "cum"], …] }` (stored maximum `paid_cum`); `debit` → `{ user, amount_micro, receipt }`; `key_epoch` → `{ user, key_epoch }`.

| Method | Caller | Effect |
|---|---|---|
| `post_credits(vault: String, paid_cum: U128, entries: Vec<(String, U128)>)` | keeper | `paid_cum` stored as the max; each `(user, yield_credited_cum)` adds `cum − posted_cum` (must be ≥ 0) to `credited`; requires Σ posted ≤ `paid_cum` for the vault; replays change nothing. Event `post_credits` |
| `debit(user: String, amount_micro: U128, receipt: Receipt)` | gateway | idempotent by `receipt.inference_id` (a repeat is a no-op success); otherwise requires `spent + amount ≤ credited`; stores the amount under the inference id. Event `debit` with the receipt |
| `bump_key_epoch(user: String) → u32` | gateway | increments the user's `key_epoch`, invalidating every API key issued under an earlier epoch. Event `key_epoch` |
| `account(user: String) → { credited: U128, spent: U128, available: U128, key_epoch: u32 }` | view | one read for the gateway's checks |
| `debited_amount(inference_id: String) → Option<U128>` | view | the amount charged for an inference, or null |
| `vault(vault: String) → { paid_cum: U128, posted_total: U128 }` | view | per-vault posting state |

```
Receipt {
  inference_id: String,            // Inference-Id response header; if absent on a 2xx, UUIDv5 of the body's completion id (NEAR's mapping)
  chat_id: String,                 // completion id
  model: String,                   // canonical model id
  prompt_tokens: u64,              // TEE-signed usage; for "reservation", input_bound
  completion_tokens: u64,          // TEE-signed usage; for "reservation", max_tokens
  in_price_nano: U128,             // per token, snapshot at admission
  out_price_nano: U128,
  source: "signed_usage" | "reservation"   // reservation = completed response without usage, charged at the reserved maximum
}
```

The connector holds no funds. It pays for its own storage (each debit stores one inference id and one amount).

## Relay HTTP

Base URL: `VITE_RELAY_URL` / `RELAY_PORT`. Errors on every route use OpenAI's error JSON: `{"error": {"message", "type", "code"}}`.

### Key routes (wallet proof)

`POST /keys` and `POST /keys/revoke` each take `{ message, signature }`: an EIP-4361 message (chain 8453, `domain` and `uri` = this API's host, the nonce below, a required `expirationTime`) and its signature. The nonce is consumed. There is no session token.

| Route | Auth | Body → response |
|---|---|---|
| `GET /auth/nonce` | none | → `{ nonce }`, single-use, 5-minute TTL |
| `POST /keys` | wallet proof | → `{ key: "inf_…", key_epoch, expires_at }`. Issued under `max(key_epoch_read, key_epoch_mem)`, valid 30 days, shown once |
| `POST /keys/revoke` | wallet proof | → `{ key_epoch, tx_hash }` after calling `bump_key_epoch` |

### API routes (OpenAI format)

| Route | Auth | Credits | Notes |
|---|---|---|---|
| `GET /v1/models` | none | no | NEAR AI TEE chat models only, canonical ids, cached 5 minutes |
| `GET /v1/model/{model}` | none | no | forwarded to NEAR AI unchanged |
| `GET /v1/attestation/report` | none | no | forwarded unchanged |
| `GET /v1/signature/{id}` | none | no | forwarded unchanged |
| `POST /v1/chat/completions` | `Bearer inf_…` | yes | E2EE v3 only, forwarded byte for byte; streams need `stream_options.include_usage: true`; `Inference-Id` response header passed through |

The three forwarded read routes allow 30 requests per minute per IP; requests carrying a valid API key skip that limit.

Status codes: 400 unencrypted or unsupported parameters, 401 bad, expired or revoked key, 402 insufficient credits, 404 model not served, 429 more than 4 requests in flight for one user, or the per-IP limit on read routes.

The dashboard reads balances directly: vault views over Base RPC, `account(user)` and `debited_amount(id)` over NEAR RPC.
