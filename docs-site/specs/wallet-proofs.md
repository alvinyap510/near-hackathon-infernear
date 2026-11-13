# Wallet proofs

Key routes and account routes take a **wallet proof**: a message signed by the wallet, carrying a fresh nonce. There is no login session. This page gives the exact formats.

## Common rules

* Get a nonce from `GET /auth/nonce`. It is single use and lives 5 minutes.
* The nonce is consumed by an atomic delete after verification, so two concurrent replays cannot both succeed.
* **The statement names the action.** A proof signed for one action is refused for every other. The one exception: creating and revoking keys share a statement, so a key proof is accepted by either of those two routes.
* An invalid, expired or reused proof answers `401 invalid_api_key`. Proof bodies and keys are never logged.

| Action | Statement |
|---|---|
| Create or revoke keys | `Authorize one InferNear API key action.` |
| Load your account | `Sign in to InferNear.` |
| Create an account | `Create InferNear account "<handle>".` |
| Invite a wallet | `Add a wallet to InferNear account "<handle>".` |
| Join an account | `Link this wallet to InferNear account "<handle>".` |
| Leave an account | `Unlink this wallet from InferNear account "<handle>".` |

## EVM: Sign-In with Ethereum

The body is `{ "message", "signature" }`, where `message` is an EIP-4361 message with:

| Field | Requirement |
|---|---|
| Chain ID | `8453` (Base) |
| Domain and URI | the console's origin, the page the wallet signs on |
| Nonce | the value from `GET /auth/nonce` |
| Expiration time | required |
| Statement | the statement for the action |

Signatures from regular accounts are supported. Contract-wallet signature verification is not implemented.

The resulting user id is `eip155:8453:<address, lower case>`.

## NEAR: NEP-413

The body is a `near` envelope:

```json
{"near":{"account_id":"alice.near","public_key":"ed25519:<base58 32-byte key>","signature":"<base64 64-byte signature>","message":"<canonical JSON below>","nonce":"<base64 32 bytes>","recipient":"<console host, including port>"}}
```

`message` is exactly `JSON.stringify` of these fields in this order, with no extra whitespace or fields:

```json
{"statement":"Authorize one InferNear API key action.","account_id":"alice.near","nonce":"<GET /auth/nonce value>","expires_at":1794485100}
```

| Field | Requirement |
|---|---|
| `expires_at` | Unix seconds, in the future, at most 300 seconds ahead |
| `account_id` in the message | must equal the envelope's `account_id`. This stops a proof being relabelled between accounts that share a key |
| `near.nonce` | `base64(SHA256(UTF8(relay nonce)))`, canonical padded base64 |
| `recipient` | the host of the console's origin |

The signature is ed25519 over SHA-256 of the NEP-413 Borsh payload:

```
u32_le(2147484061) || borsh_string(message) || nonce[32] || borsh_string(recipient) || callback
```

`callback` is `0x00` when the proof has no `callback_url`, and `0x01 || borsh_string(callback_url)` when it has one. A callback URL must be a console URL.

**Only a full-access key counts.** The relay reads the key with a finalized `view_access_key(account_id, public_key)` and accepts it only if the permission is `FullAccess`. A function-call key, an unknown key or a failed read is refused.

The resulting user id is `near:mainnet:<account_id>`.

## Linking needs two proofs

1. A wallet already in the account signs `Add a wallet to InferNear account "<handle>".` and receives a ticket (`ilt_…`). The ticket is signed by the relay, lives ten minutes and works once.
2. The wallet being added signs `Link this wallet to InferNear account "<handle>".` and sends it with the ticket.

When the new wallet is added, the relay checks that the inviting wallet is still in the account.

## Signed requests that are not key proofs

Two routes carry requests the relay submits to NEAR on the user's behalf, paying the gas. They need no API key.

| Route | Body | The relay checks |
|---|---|---|
| `POST /rhea/withdraw` | `{ message, signature }`: the vault's exact withdrawal message and a `0x`-prefixed hex signature | Signature, expiry, and that the vault would accept it, before sending |
| `POST /intents/execute` | `{ signed: [{ standard: "erc191", payload, signature: "secp256k1:<base58>" }] }` | Every signature, the deadline, and that the verifying contract is the configured one |

Neither route accepts a caller-chosen receiver, method, gas or deposit. The relay pays gas with no attached deposit. It cannot authorize or redirect a user's principal: the vault and the Intents verifier check the nonce and the authorization on chain.

The withdrawal message format is on the [Rhea USDC vault](rhea-vault.md#evm-owner-a-signed-request) page.
