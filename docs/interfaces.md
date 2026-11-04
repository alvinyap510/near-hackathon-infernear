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
| `event Skimmed(address indexed token, uint256 attributed, uint256 paid, uint256 acc)` | event | one per skim that attributes or pays |
| `event PayFailed(bytes reason)` | event | a best-effort payment inside a deposit, withdrawal or transfer failed; attribution is kept |

## NEAR: connector contract (`near-sdk` 5)

Initialized once with `new(keeper: AccountId, gateway: AccountId)`. There is no owner and no admin method. NEAR events use NEP-297 with `standard: "infernear"`, `version: "1.0.0"`.

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
  inference_id: String,            // NEAR AI Inference-Id response header
  chat_id: String,                 // completion id
  model: String,                   // canonical model id
  prompt_tokens: Option<u64>,      // from TEE-signed usage; null when source = "billing"
  completion_tokens: Option<u64>,
  in_price_nano: U128,             // per token, snapshot at admission
  out_price_nano: U128,
  source: "signed_usage" | "billing"
}
```

The connector holds no funds. It pays for its own storage (each debit stores one inference id and one amount).

## Relay HTTP

Base URL: `VITE_RELAY_URL` / `RELAY_PORT`. Errors on every route use OpenAI's error JSON: `{"error": {"message", "type", "code"}}`.

### Dashboard routes (wallet session)

| Route | Auth | Body → response |
|---|---|---|
| `GET /auth/nonce` | none | → `{ nonce }` |
| `POST /auth/siwe` | none | `{ message, signature }` (EIP-4361, chain 8453) → `{ session, expires_at }`, a short-lived bearer token for that user id |
| `POST /keys` | `Bearer <session>` | → `{ key: "inf_…", key_epoch, expires_at }`. Issued under `max(key_epoch_read, key_epoch_mem)`, valid 30 days, shown once |
| `POST /keys/revoke` | `Bearer <session>` | → `{ key_epoch, tx_hash }` after calling `bump_key_epoch` |

### API routes (OpenAI format, `Bearer inf_…`)

| Route | Credits | Notes |
|---|---|---|
| `GET /v1/models` | no | NEAR AI TEE chat models only, canonical ids |
| `GET /v1/model/{model}` | no | forwarded to NEAR AI unchanged |
| `GET /v1/attestation/report` | no | forwarded unchanged |
| `GET /v1/signature/{id}` | no | forwarded unchanged |
| `POST /v1/chat/completions` | yes | E2EE v3 only, forwarded byte for byte; `Inference-Id` response header passed through |

Status codes: 400 unencrypted or unsupported parameters, 401 bad, expired or revoked key, 402 insufficient credits, 404 model not served, 429 more than 4 requests in flight for one user.

The dashboard reads balances directly: vault views over Base RPC, `account(user)` and `debited_amount(id)` over NEAR RPC.
