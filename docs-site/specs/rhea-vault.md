# Rhea USDC vault

The Rhea vault is the NEAR contract [`rhea.infernear-ai.near`](https://nearblocks.io/address/rhea.infernear-ai.near). It holds USDC principal for EVM users and NEAR users, supplies it to Rhea Lend, and pays out only the interest.

| Property | Value |
|---|---|
| Source | `contracts/near/rhea-vault/src/lib.rs` |
| Units | USDC base units (6 decimals). Index and coverage are scaled by 1e18 |
| Initialized with | `new(usdc, rhea, intents, treasury, cushion, min_deposit, cap)`, once |
| Minimum deposit | 1 USDC |
| Cap | 10,000 USDC |
| Admin methods | none in the contract |

::: warning The deployment key is still on the account
The contract has no owner or admin method, and the deploy script deletes the account's keys by default. On mainnet the key was kept for the hackathon so the code can be fixed. Whoever holds it could replace the contract's code. Treat this vault as operator-controlled until the key is deleted.
:::

## Deposits

### From an EVM user, through NEAR Intents

USDC arrives by `ft_transfer_call` with a message naming the owner:

```json
{"user":"eip155:8453:0x<40 lower-case hex>"}
```

`ft_on_transfer` refunds the full amount for the wrong token, an invalid message, an amount below the minimum or insufficient storage. Otherwise it records the user, queues the amount and returns `"0"`.

### From a NEAR wallet

The user signs a native USDC `ft_transfer_call` to the vault with `msg = {"user":"near:mainnet:<account_id>"}`, 1 yoctoNEAR and 100 Tgas. The sender must be that same account, otherwise the amount is refunded. This path uses neither 1Click nor Intents.

## Withdrawals

### EVM owner: a signed request

Anyone can submit `request_withdraw(message, signature)`. The vault verifies an EIP-191 signature over this exact UTF-8 string against the stored owner:

```json
{"action":"withdraw","network":"mainnet","vault":"<vault account id>","user":"eip155:8453:0x<40 lower-case hex>","amount":"1000000","nonce":0,"expires_at":1794000000}
```

* The amount is a JSON string. Nonce and expiry are JSON numbers.
* The signature is 65 bytes, `r || s || v`, hex, with `v` of 0/1 or 27/28. Low-s is required.
* The request must use the current nonce, be unexpired, and satisfy `0 < amount ≤ principal`.
* A valid request consumes the nonce and replaces any unsent request.

The payout is a USDC `ft_transfer_call` to the Intents verifier with `msg = "0x<owner address>"`. It can only go to the address that owns the position.

### NEAR owner

`withdraw(amount)` with 1 yoctoNEAR queues a withdrawal for the calling account. The vault's next cycle pays USDC directly to that account.

## The cycle: `run()`

Anyone can call `run()`. It needs 300 Tgas and performs one serialized cycle:

1. Measure the position on Rhea Lend.
2. Attribute new yield, admit queued deposits, plan exits.
3. Withdraw from Rhea what the exits need, send, and resolve. Or, if there is nothing to pay, supply idle cash.

Rules:

* At most 10 entries are scanned from each queue per cycle. Sends are sized to fit the remaining gas.
* Exits are paid before the treasury.
* Each planned exit gets one funding attempt. If its payout exceeds what is available after the Rhea withdrawal, the request is removed with `exit_unfunded`. Principal is left unchanged and the owner signs a new request.
* A partial refund of an exit restores principal proportionally. A complete failure restores the full claim.

## Views

| Method | Returns |
|---|---|
| `position(user)` | `{ principal, yield_credited, pending_in, pending_out }` |
| `idle()` | Accounted cash, excluding pending deposits and unsolicited transfers |
| `paid_total()`, `unpaid()`, `unattributed()`, `coverage()` | Yield paid, yield pending, rounding dust, and last measured coverage (1e18 = full) |
| `nonce(user)` | The next withdrawal nonce, starting at 0 |
| `holders(from, limit)` | Accepted users, paginated |
| `busy()` | Whether a cycle is in flight |

## Events

| Event | Data |
|---|---|
| `deposit_queued`, `deposit_activated` | `{ user, amount }` |
| `withdraw_requested` | `{ user, amount, nonce }` |
| `exit_unfunded` | `{ user, claim, out }` |
| `yield_attributed` | `{ amount, attributed, unattributed, attributed_scaled, unattributed_scaled, acc }` |
| `cycle_measured` | `{ supplied, liquidity, idle, coverage }` |
| `cash_sent` | `{ kind: "return" \| "exit" \| "treasury" \| "supply", user, amount, claim }` |
| `cash_resolved` | `{ kind, user, sent, used, restored_principal }` |
| `cycle_failed` | `{ step, reason }` |

## Accounting identity

Entitlements are kept at scale 1e18, so settling a user never drops a fraction:

```
sum(user scaled entitlements) + unattributed_scaled = (paid_total + unpaid) × 1e18
```

## How its yield reaches the ledger

The keeper posts this vault's yield only when `busy()` is false and `unpaid()` is zero, at rate `1e18`, from values pinned to one finalized NEAR block. See [Keeper](keeper.md).
