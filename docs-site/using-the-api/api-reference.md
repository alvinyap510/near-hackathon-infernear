# API reference

Base URL: `https://api.infernear.dev`

Inference routes live under `/v1` and follow the OpenAI format. Key and account routes live at the root.

## Authentication

Send your API key as a bearer token:

```
Authorization: Bearer inf_...
```

Keys are created by signing a message with your wallet. See [API keys](../getting-started/api-keys.md).

## Inference routes

| Route | Key needed | Paid by | What it does |
|---|---|---|---|
| `GET /v1/models` | no | | Lists the served TEE chat models with their prices. Cached for 5 minutes |
| `POST /v1/chat/completions` | yes | free trial first, then credits | OpenAI Chat Completions, in [standard](standard-mode.md) or [private](private-mode.md) mode |
| `GET /v1/free-calls` | yes | | Your free trial status: `{"per_user":5,"used":2,"remaining":3}` |
| `GET /v1/model/{model}` | no | | Model details, forwarded from NEAR AI unchanged |
| `GET /v1/attestation/report` | no | | TEE attestation report, forwarded from NEAR AI unchanged |
| `GET /v1/signature/{id}` | no | | The model's signature for a completion, forwarded unchanged |

### `POST /v1/chat/completions`

The body is an OpenAI chat completion request.

| Field | Rule |
|---|---|
| `model` | An exact `id` from `GET /v1/models` |
| `messages` | Text messages. Tool definitions and tool calls are allowed |
| `max_tokens` | At most 4,096. Optional in standard mode (the relay fills it in); required in private mode |
| `stream` | `true` for a streamed reply. In private mode, also send `stream_options: {"include_usage": true}` |
| `n` | Must be 1 if present |

### Response headers

| Header | Meaning |
|---|---|
| `Inference-Id` | The id of this inference. A paid call is recorded on NEAR under it |
| `X-InferNear-Billing` | `free` (a free trial call) or `credits` |
| `X-InferNear-Free-Remaining` | On free calls: trial calls left for this wallet |

Browsers can read all three (they are listed in `Access-Control-Expose-Headers`).

## Errors

Every error uses OpenAI's error shape:

```json
{"error": {"message": "Bad, expired or revoked credentials", "type": "invalid_request_error", "code": "invalid_api_key"}}
```

| Status | When |
|---|---|
| `400` | Unsupported parameters, or an incomplete set of private-mode encryption headers |
| `401` `invalid_api_key` | The key is wrong, expired or revoked |
| `402` `insufficient_credit` | No free trial calls left and not enough credit for this call |
| `404` | The model is not one InferNear serves |
| `413` | The request body is larger than 1 MiB |
| `429` | More than 4 requests in flight for one user, or too many requests from one IP on the open routes |
| `503` `ledger_storage_low` | The credit ledger is short of storage; paid calls are paused until the operator tops it up |
| `504` | The model did not start answering in time |

## Limits

| Limit | Value |
|---|---|
| Requests in flight per user | 4 |
| Request body | 1 MiB |
| Reply cap (`max_tokens`) | 4,096 |
| Open routes without a key (model details, attestation, signature, key and account routes) | 30 requests per minute per IP |
| API key lifetime | 30 days |

## Key routes

Most people create keys in the console. These are the routes it uses.

| Route | Body | Response |
|---|---|---|
| `GET /auth/nonce` | | `{ "nonce" }`: single use, valid for 5 minutes |
| `POST /keys` | a wallet proof | `{ "key": "inf_...", "key_epoch", "expires_at", "account" }` |
| `POST /keys/revoke` | a wallet proof | `{ "key_epoch", "tx_hash" }`: ends every key that wallet issued |

A **wallet proof** is one of:

* **EVM:** `{ "message", "signature" }`, where `message` is a Sign-In with Ethereum (EIP-4361) message for chain 8453 whose domain and URI are the console's origin, carrying the nonce and an expiration time.
* **NEAR:** a `near` envelope with a NEP-413 signature from a full-access key of the account.

The message's statement names the action, and a proof signed for one action is refused for any other. For both key routes the statement is `Authorize one InferNear API key action.`

The exact message formats are in [`docs/interfaces.md`](https://github.com/alvinyap510/near-hackathon-infernear/blob/main/docs/interfaces.md) in the repository, and `relay/scripts/live-check.mjs` is a complete working example.

## Account routes

These manage a handle and linked wallets. Each takes a wallet proof whose statement names the action. None sends a transaction. See [Accounts and linked wallets](../accounts/accounts-and-linked-wallets.md).

| Route | Extra body field | Statement to sign | Result |
|---|---|---|---|
| `POST /accounts/me` | | `Sign in to InferNear.` | Your account, or `null` |
| `POST /accounts` | `handle` | `Create InferNear account "<handle>".` | The new account |
| `POST /accounts/link/start` | `handle` | `Add a wallet to InferNear account "<handle>".` (signed by a wallet already in the account) | A one-use ticket, valid 10 minutes |
| `POST /accounts/link` | `ticket` | `Link this wallet to InferNear account "<handle>".` (signed by the wallet being added) | The updated account |
| `POST /accounts/unlink` | `handle` | `Unlink this wallet from InferNear account "<handle>".` (signed by the wallet leaving) | The updated account |

## Reading the ledger yourself

Balances and charges are public on NEAR. The credit ledger is the contract `connector.infernear-ai.near`, and these view methods need no key:

| View method | Arguments | Returns |
|---|---|---|
| `account` | `{"user": "eip155:8453:<address, lower case>"}` or `{"user": "near:mainnet:<account id>"}` | `credited`, `spent`, `available` (micro-USD) and `key_epoch` |
| `debited_amount` | `{"inference_id": "<Inference-Id>"}` | The amount charged for that call, or `null` |
