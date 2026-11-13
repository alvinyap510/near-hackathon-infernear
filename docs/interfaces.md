# Interfaces between components

The vault, the connector, the relay and the dashboard are built in parallel against this file. Change it only together with every component that uses it.

## Shared conventions

- **User id:** EVM owners use `eip155:8453:<lower-case address>`; NEAR-wallet owners use `near:mainnet:<account_id>`. EVM users do not need a NEAR account. NEAR-only sessions use native Rhea USDC and keys/credits; Base vaults require an EVM wallet.
- **Vault id:** `eip155:8453:<lower-case EVM address>` or `near:mainnet:<NEAR vault account id>`. The namespace identifies the chain of `source_block`.
- **Amounts on NEAR:** JSON strings of integers (`U128`). Credits are in **micro-USD**. USDC yield uses `rate = "1000000000000000000"`; other yield tokens use the frozen rate below. Principal and token totals remain in their token base units.
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

Initialized once with `new(keeper: AccountId, gateway: AccountId)`. There is no owner and no admin method. NEAR events use NEP-297 with `standard: "infernear"`, `version: "1.0.0"`. Each event has a one-element `data` array: `post_credits` → `{ vault, paid_cum, rate, source_block, entries: [[user, "cum"], …] }` (stored maximum `paid_cum`); `debit` → `{ user, amount_micro, receipt }`; `key_epoch` → `{ user, key_epoch }`.

| Method | Caller | Effect |
|---|---|---|
| `post_credits(vault: String, paid_cum: U128, rate: U128, source_block: u64, entries: Vec<(String, U128)>)` | keeper | Store max `paid_cum`; `delta = cum − posted_cum >= 0` in yield-token base units. Per (user, vault): `x = remainder + delta * rate`, add `x / 1e18` micro-USD and retain `x % 1e18`. Checked u128 products/sums; requires Σ posted ≤ `paid_cum`. Replays, including a different rate, add nothing. Event `post_credits` |
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

## NEAR: `RheaUsdcVault` (`near-sdk` 5.30)

Initialize once with `new(usdc: AccountId, rhea: AccountId, intents: AccountId, treasury: AccountId, cushion: U128, min_deposit: U128, cap: U128)`. All amounts are USDC base units (6 decimals), index/coverage scale is 1e18. The deployer donates the cushion **before** initialization, registers storage, then deletes all vault full-access keys. No owner, admin, upgrade or busy-timeout method. Plain FT transfers after initialization are unaccounted and stranded.

| Method | Caller | Result / effect |
|---|---|---|
| `ft_on_transfer(sender_id: AccountId, amount: U128, msg: String) → U128` | configured USDC FT | `msg = {"user":"eip155:8453:0x<40 lower-case hex>"}`. Returns the full amount for wrong token, invalid user/message, below-minimum amount or insufficient storage balance. Otherwise allocates the whole user record, queues the received amount and returns `"0"`. No promises. NEAR-wallet deposits instead use `msg.user = "near:mainnet:<account_id>"` and require `sender_id == account_id`; otherwise refund the full amount. |
| `request_withdraw(message: String, signature: String)` | anyone | Verify the exact EIP-191 JSON below against the stored owner. Hex signature is 65-byte `r || s || v`, optional `0x`, v 0/1 or 27/28, low-s required. Requires not busy, current nonce, unexpired, `0 < amount <= principal`. Consume nonce and replace any unsent request. |
| `withdraw(amount: U128)` | NEAR account; attach 1 yoctoNEAR | Queue a native withdrawal for `near:mainnet:<predecessor>`; the keeper's next `run()` pays USDC directly to that account. The dashboard attaches 100 Tgas. |
| `run()` | anyone | Serialize one measure → attribute/admit/plan → Rhea withdrawal → send/resolve, or supply cycle. Requires 300 Tgas prepaid. Scans at most 10 entries from each queue; actual sends fit the remaining gas after reserving the terminal callback. Each planned exit gets one funding attempt. If its coverage-adjusted payout exceeds idle after the Rhea withdrawal, remove the request with `exit_unfunded`, leaving principal and nonce unchanged. Only exits deferred for send capacity remain queued in order. Exits precede treasury payments. |
| `position(user: String)` | view | `{ principal: U128, yield_credited: U128, pending_in: U128, pending_out: Option<U128> }`; yield includes unsettled index entitlement. |
| `idle() → U128` | view | Accounted cash, excluding pending deposits and unsolicited FT transfers. |
| `paid_total() → U128`, `unpaid() → U128`, `unattributed() → U128`, `coverage() → U128` | views | Yield paid / pending, attribution rounding dust, and last measured coverage (1e18 = full). |
| `nonce(user: String) → u64` | view | Next withdrawal authorization nonce, initially 0. |
| `holders(from: u64, limit: u64) → Vec<String>` | view | Iterable accepted users, including zero-principal and pending users. |
| `busy() → bool` | view | A money cycle is in flight. Posting waits for false. |

The owner signs the **exact UTF-8 string**, with integer amount as a JSON string and nonce/expiry as JSON numbers:

```json
{"action":"withdraw","network":"mainnet","vault":"<vault account id>","user":"eip155:8453:0x<40 lower-case hex>","amount":"1000000","nonce":0,"expires_at":1794000000}
```

EVM-owner principal payouts and rejected-deposit returns are USDC `ft_transfer_call` transfers to the configured Intents verifier with `msg = "0x<owner address>"`. `simple_withdraw` receives `w * 1e12` internal Rhea units; only its terminal `true` result adds `w` to accounted idle. A terminal callback consumes each outgoing record exactly once. Partial exit refunds restore `floor(claim * refunded / out)` principal; complete failure restores the full claim. Requests are consumed when sent or dropped as unfunded; a failed funding attempt and restored principal both require a new signature.

NEAR-wallet users deposit by signing native USDC `ft_transfer_call({ receiver_id: vault, amount, msg: JSON.stringify({ user: "near:mainnet:<account_id>" }) })` with 1 yoctoNEAR and 100 Tgas. Their own account must be the FT sender. Native withdrawals call `withdraw({ amount })` with the same deposit/gas; payouts use plain USDC `ft_transfer` to the account after the keeper runs. These paths use neither 1Click nor Intents. Amounts and the 1-USDC deposit minimum use native USDC's six decimals. Views are unchanged.

NEP-297 events use `standard: "infernear"`, `version: "1.0.0"`, one-element `data` arrays:

- `deposit_queued`: `{ user, amount }`.
- `deposit_activated`: `{ user, amount }`.
- `withdraw_requested`: `{ user, amount, nonce }` (consumed nonce).
- `exit_unfunded`: `{ user, claim, out }` (requested principal and coverage-adjusted payout; U128 strings). The funding attempt removed the request without burning principal; its nonce stays consumed. The owner must sign a new request, smaller or later.
- `yield_attributed`: `{ amount, attributed, unattributed, attributed_scaled, unattributed_scaled, acc }` (this interval, new index). `attributed` and `unattributed` are floors in base units; the two `_scaled` fields retain the exact 1e18-scaled split.
- `cycle_measured`: `{ supplied, liquidity, idle, coverage }`.
- `cash_sent`: `{ kind: "return" | "exit" | "treasury" | "supply", user: string | null, amount, claim }` (claim 0 except exits).
- `cash_resolved`: `{ kind, user, sent, used, restored_principal }`.
- `cycle_failed`: `{ step, reason }` (fixed classifications, no credentials).

Fractional user entitlements and index-floor dust are retained at scale 1e18 internally, so settling a user never drops a fraction. Exactly `sum(user scaled entitlements) + unattributed_scaled = (paid_total + unpaid) * 1e18`. Public `yield_credited` and `unattributed` floor those values to base units; their sum is bounded by, and can be below, paid plus unpaid. The scaled identity and gas-bounded sends are part of architecture §14.3.

The keeper posts `post_credits("near:mainnet:<vault>", paid_total, "1000000000000000000", finalized_near_block, [[user, position(user).yield_credited], …])` only when `!busy()` and `unpaid() == "0"`. Connector `source_block` and nonce/pagination arguments are JSON numbers; all U128 values are strings. Rhea callbacks are private and are not relay entry points.

## Relay HTTP

Base URL: `VITE_RELAY_URL` / `RELAY_PORT`. Errors on every route use OpenAI's error JSON: `{"error": {"message", "type", "code"}}`.

### Key routes (wallet proof)

`POST /keys` and `POST /keys/revoke` accept either the NEP-413 envelope below or `{ message, signature }`: an EIP-4361 message (chain 8453, `domain` and `uri` = the dashboard's origin (`RELAY_WEB_ORIGIN`), the site the wallet signs on, the nonce below, a required `expirationTime`) and its signature. The nonce is consumed. There is no session token.

| Route | Auth | Body → response |
|---|---|---|
| `GET /auth/nonce` | none | → `{ nonce }`, single-use, 5-minute TTL |
| `POST /keys` | wallet proof | → `{ key: "inf_…", key_epoch, expires_at }`. Issued under `max(key_epoch_read, key_epoch_mem)`, valid 30 days, shown once |
| `POST /keys/revoke` | wallet proof | → `{ key_epoch, tx_hash }` after calling `bump_key_epoch` |

### Signed NEAR transaction routes

| Route | Auth | Body → response |
|---|---|---|
| `POST /rhea/withdraw` | EIP-191 wallet proof | `{ message, signature }` using the exact vault withdrawal message above and a `0x`-prefixed hex signature → `{ tx_hash }` |
| `POST /intents/execute` | ERC-191 signed Intents payload | `{ signed: [{ standard: "erc191", payload: "<exact JSON string>", signature: "secp256k1:<base58 65-byte r-s-v>" }, …] }` → `{ tx_hash }` |

These routes require no API key or inference credits. The relay checks signature, expiry and configured verifying contract before paying NEAR gas; the on-chain vault/verifier checks nonce and authorization. They share the anonymous per-IP bucket (30 requests/minute), including requests carrying an API key. Intents signatures use recovery id 0/1; the payload contains the verifier's `signer_id`, `verifying_contract`, `deadline`, `nonce` and `intents` fields. The vault route preserves the signed message bytes. Neither route accepts caller-selected NEAR receiver, method, gas or deposit fields.

### NEAR-wallet key proofs (NEP-413)

The same `POST /keys` and `POST /keys/revoke` routes also accept:

```json
{"near":{"account_id":"alice.near","public_key":"ed25519:<base58 32-byte key>","signature":"<base64 64-byte signature>","message":"<canonical JSON below>","nonce":"<base64 32 bytes>","recipient":"<dashboard host, including port>"}}
```

`message` is exactly `JSON.stringify` of these fields in this order, with no additional whitespace or fields:

```json
{"statement":"Authorize one InferNear API key action.","account_id":"alice.near","nonce":"<GET /auth/nonce value>","expires_at":1794485100}
```

`expires_at` is a Unix-seconds integer strictly in the future and at most 300 seconds ahead. The account in the signed message must equal the envelope account (including implicit 64-hex accounts); this prevents relabelling a proof between accounts sharing a key. `near.nonce = base64(SHA256(UTF8(relay_nonce)))`. Both base64 fields must use canonical padded encoding. `recipient` equals `new URL(RELAY_WEB_ORIGIN).host`, exactly as the SIWE domain check.

Verify ed25519 over SHA256 of the NEP-413 Borsh payload: `u32_le(2147484061) || borsh_string(message) || nonce[32] || borsh_string(recipient) || callback`, where `callback` is `0x00` when the proof has no `callback_url` and `0x01 || borsh_string(callback_url)` when it has one (redirect wallets such as MyNearWallet sign the page URL; it must be a dashboard URL). Only a key returned as `FullAccess` by a finalized `view_access_key(account_id, public_key)` is accepted. A function-call key, unknown key, RPC failure, invalid proof or expired/reused nonce yields `401 invalid_api_key`; proof bodies, keys and RPC URLs are never logged. The existing body/IP limits still apply. The same five-minute nonce map is consumed by an atomic delete after verification and the key read; concurrent SIWE/NEAR replays cannot both succeed.

Success uses `near:mainnet:<account_id>` in the existing API-key payload and connector ledger. Responses and key epoch/expiry rules are unchanged. Revocation shares the daily operator-paid transaction count with EVM revocations and the other sponsored routes.

### Accounts: handle, UID and linked wallets

An account is identified by its **UID** and **handle**, not by a wallet. The registry lives in the relay (`RELAY_DATA_DIR`, one JSON file); it is not on chain, and the credit ledger is unchanged: balances stay per wallet id on the connector. Without `RELAY_DATA_DIR` every route below answers `404 accounts_disabled`.

```json
{"uid":"acc_<32 hex>","handle":"alice","wallets":["eip155:8453:0x…","near:mainnet:bob.near"],"avatar_seed":"acc_<32 hex>","created_at":1794500000}
```

`uid` is generated at creation and never changes; `avatar_seed` equals it. `handle` matches `^[a-z0-9][a-z0-9_-]{1,18}[a-z0-9]$`, is unique, and a short reserved list is refused. An account holds 1 to 4 wallets, in the order they were added; a wallet belongs to at most one account.

Every route takes the same wallet proof as `POST /keys` (EIP-4361 `{ message, signature }` or the NEP-413 `near` envelope), with a fresh nonce. **The proof's statement names the action**, as the EIP-4361 statement or the `statement` field of the NEAR canonical JSON, and a proof signed for one action is refused for every other. `/keys` and `/keys/revoke` require `Authorize one InferNear API key action.`

| Route | Body besides the proof | Statement | Result |
|---|---|---|---|
| `POST /accounts/me` | | `Sign in to InferNear.` | `200 { "account": Account \| null }` |
| `POST /accounts` | `handle` | `Create InferNear account "<handle>".` | `201 { "account" }`; `400 invalid_handle`; `409 handle_taken`; `409 account_exists` with the caller's `account`; `503 accounts_full` |
| `POST /accounts/link/start` | `handle` | `Add a wallet to InferNear account "<handle>".`, signed by a wallet already in it | `200 { "ticket": "ilt_…", "expires_at" }`; `404 no_account`; `409 too_many_wallets` |
| `POST /accounts/link` | `ticket` | `Link this wallet to InferNear account "<handle>".`, signed by the wallet being added | `200 { "account" }`; `401 invalid_ticket`; `409 wallet_linked`; `409 too_many_wallets` |
| `POST /accounts/unlink` | `handle` | `Unlink this wallet from InferNear account "<handle>".`, signed by the wallet leaving | `200 { "account" }`; `404 no_account`; `409 last_wallet` |

Linking therefore needs two signatures: the ticket carries the consent of a wallet already in the account (relay-signed, ten minutes, one use), and the new wallet signs its own proof. All account routes share the 30/minute per-IP bucket and send no transaction.

`POST /keys` adds `"account": Account | null` to its response, and a key issued to a linked wallet records the account's UID. Such a key can be charged to **any wallet currently linked to that account**: its own wallet first, then the others in order. One call is charged to exactly one wallet (the ledger takes one debit per inference), so two wallets that each hold too little are not added together. The registry is read at every call: a wallet that has left the account stops being charged at once. Free trial calls are counted per account for a linked wallet, and what the wallet had used before joining moves in with it. Revoking from a wallet ends the keys that wallet issued.

### API routes (OpenAI format)

| Route | Auth | Credits | Notes |
|---|---|---|---|
| `GET /v1/free-calls` | `Bearer inf_…` | no | In-memory trial status; same key/epoch authentication as other authenticated reads |
| `GET /v1/models` | none | no | NEAR AI TEE chat models only, canonical ids, cached 5 minutes |
| `GET /v1/model/{model}` | none | no | forwarded to NEAR AI unchanged |
| `GET /v1/attestation/report` | none | no | forwarded unchanged |
| `GET /v1/signature/{id}` | none | no | forwarded unchanged |
| `POST /v1/chat/completions` | `Bearer inf_…` | free trial first, otherwise credits | Standard mode: plain OpenAI request, readable by the relay in transit; `max_tokens` and stream usage are filled in. Private mode: E2EE v3 headers, forwarded byte for byte; needs `max_tokens`, and `stream_options.include_usage: true` on streams. An incomplete E2EE header set is refused. `Inference-Id` response header passed through |

### Free trial billing

With `RELAY_FREE_CALLS_PER_USER=5` and `RELAY_FREE_CALLS_PER_DAY=300`, authenticated EVM and NEAR wallets receive five operator-funded trial calls per process lifetime, subject to 300 calls per UTC day across all wallets. Both settings default to 0; either zero disables trials. The normal model/token/body and four-in-flight validations still apply in both modes. Free calls precede credit use and never create or post credits, debit NEAR or reserve credit.

`GET /v1/free-calls` takes `Authorization: Bearer inf_…` and returns:

```json
{"per_user":5,"used":2,"remaining":3}
```

`used` counts consumed trials for that wallet. `remaining = min(per_user - used - wallet_holds, daily_limit - today_used - all_holds)`, floored at zero. Disabled response: `{"per_user":0,"used":0,"remaining":0}`. It uses the existing key/epoch authentication and error shape, with no inference, debit or other transaction. Trial records share the existing 10,000-entry in-memory capacity; no consumed record or live hold is evicted, and capacity exhaustion falls through to credit admission for new wallets.

A trial is held at admission and consumed only for a 2xx with a usable inference/completion id, exactly the existing chargeable-completion rule. Forgiveness releases the hold. Midnight UTC resets daily consumed usage, preserves wallet counts and live holds, and late completions consume the new day's budget. All counters are process memory and reset on restart, so the cap is not durable across restarts/replicas.

JSON and SSE chat responses in both modes carry **`X-InferNear-Billing: free`** or **`X-InferNear-Billing: credits`**. Free responses additionally carry **`X-InferNear-Free-Remaining: <n>`**, a quota snapshot after holding this call, capped by the day's unheld/unconsumed allowance. All three names `Inference-Id, X-InferNear-Billing, X-InferNear-Free-Remaining` are in `Access-Control-Expose-Headers`. Upstream response bodies/SSE bytes are unchanged. Without a trial, insufficient credit still returns `402 insufficient_credit`.

The three forwarded read routes allow 30 requests per minute per IP; requests carrying a valid API key skip that limit.

Status codes: 400 incomplete encryption headers or unsupported parameters, 401 bad, expired or revoked key, 402 insufficient credits, 404 model not served, 429 more than 4 requests in flight for one user, or the per-IP limit on read routes.

The dashboard reads balances directly: vault views over Base RPC, `account(user)` and `debited_amount(id)` over NEAR RPC.
