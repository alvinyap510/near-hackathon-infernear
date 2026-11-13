# Gateway

The gateway is the part of the relay that serves the API. It authenticates API clients, sets credit aside, forwards chat requests to NEAR AI Cloud and settles each paid call on the NEAR ledger. It runs in the same Node process as the [keeper](keeper.md).

| Property | Value |
|---|---|
| Source | `relay/src/gateway/` |
| Public address | `https://api.infernear.dev` |
| Upstream | NEAR AI Cloud, on InferNear's own NEAR AI account |
| Durable state | none of its own. The ledger on NEAR is the durable record. The account registry is one JSON file |

## The life of a chat request

1. **Authenticate.** Check the key's signature and expiry before reading the body, then its key epoch against the ledger.
2. **Validate.** Model served, `max_tokens` within the cap, `n` equal to 1, text input, body within 1 MiB.
3. **Pick the mode.** Any of the SDK's encryption headers selects private mode, and then the complete set must be present. Otherwise the request is standard.
4. **Admit.** Use a free trial call if the wallet has one. Otherwise reserve credit (below). At most four requests per user are in flight.
5. **Forward.** The upstream authorization is replaced with InferNear's. In private mode the request bytes are forwarded unchanged. In both modes the response bytes, including stream framing, are passed through unchanged.
6. **Meter.** Read the usage from a copy of the response.
7. **Settle.** Charge the usage on the ledger under the inference id.

## Modes

| | Standard | Private |
|---|---|---|
| Selected by | no encryption headers | any of the SDK's v3 encryption headers |
| Body | plain OpenAI JSON | forwarded byte for byte |
| `max_tokens` | filled in when missing: from `max_completion_tokens`, else the cap. `max_completion_tokens` is then removed | must be present |
| Streaming usage | `stream_options.include_usage` is forced to `true` | the request must already ask for it |
| Incomplete header set | not applicable | `400`, never a fallback to standard |

## Reservation

For a credit-paid call, admission reserves the worst case, under a per-user lock:

```
reservation = ceil((input_bound × in_price_nano + max_tokens × out_price_nano) / 1000)   micro-USD
```

| Mode | `input_bound` |
|---|---|
| Standard | request bytes + 1,024 (one token per byte is the most a tokenizer can produce, plus the chat template) |
| Private | `ceil(request bytes / 2)` |

Available headroom is the ledger's balance minus all live reservations, using the greater of the on-chain `spent` and the gateway's own record of what it has broadcast.

## Charge

```
charge = min(ceil(usage priced at the snapshot prices), reservation)
```

* The inference id is the `Inference-Id` response header, or UUIDv5 of the body's completion id when the header is absent.
* A completed reply with missing or malformed usage is charged the full reservation, with `source: "reservation"` on the receipt.
* A partial stream that produced a completion id is charged, even if the transport fails afterwards.

## Forgiveness

A call is not charged when there is no successful completion: a non-2xx upstream result, or no usable inference or completion id. The reservation is released and the cost is InferNear's.

## Settlement

* A debit keeps its reservation until it is broadcast.
* The gateway re-reads `debited_amount` every second and resends an unconfirmed debit after a doubling delay: 2 s, 4 s, up to 10 minutes.
* After twelve unconfirmed sends (about an hour) it stops, releases the amount and records the charge as an operator loss.
* Retries reuse the same inference id, and the ledger accepts each id once, so a call cannot be charged twice.

## Free trial calls

* 5 per wallet and 300 per UTC day across wallets, both configurable. Either set to zero turns trials off.
* A trial is held at admission and consumed only by a 2xx with a usable id. Forgiveness releases it.
* Free calls skip the ledger: no reservation, no debit, no retry job.
* Counters are in memory and reset on restart.

## Limits

| Limit | Value | Result past it |
|---|---|---|
| Requests in flight per user | 4 | `429` |
| POST body | 1 MiB | `413` |
| `max_tokens` | 4,096 | `400` |
| Open routes per IP | 30 per minute | `429` |
| Operator-paid transactions (revocations, Rhea withdrawals, intents) | a shared daily count | `429 sponsored_limit` |
| Upstream deadline | a total deadline that does not reset while bytes trickle in | `504` before headers. Afterwards the partial response ends |
| Ledger storage | room for about ten more debits | `503 ledger_storage_low` for credit-paid calls |

## Keys

* A key carries the wallet's user id, its key epoch and an expiry 30 days out, authenticated by the relay.
* Each key action needs a fresh wallet proof with a single-use nonce that lives 5 minutes. There is no session token.
* Revoking bumps the user's key epoch on the ledger. Within the running process the revocation takes effect before the transaction is awaited.

See [Wallet proofs](wallet-proofs.md) for the signed message formats.

## Accounts

The registry of handles and linked wallets is one JSON file, rewritten whole and atomically on every change. Changes are applied one at a time. It holds no secrets and no balances.

For each call the gateway reads the registry and may charge any wallet in the key's account: the key's own wallet first, then the others in the order they were linked. One call is charged to one wallet. Just before reserving, it checks again that the key is still valid and the wallet is still linked.

## What it logs

Error reports carry fixed classifications and safe context. They never contain dependency messages, stack traces, request bodies or URLs with credentials. Prompts and replies are not stored.

## Restart behaviour

* In-memory jobs, nonces and free-trial counts are lost.
* Transactions already broadcast may still land. Their ids deduplicate.
* A reply delivered just before a crash, before its debit was broadcast, is InferNear's loss.
* A cold process may briefly accept a key from before a revocation, until its ledger read catches up. There is no enforced bound on that window.
