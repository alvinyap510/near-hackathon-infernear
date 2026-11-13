# API keys

An InferNear API key is a string that starts with `inf_`. You send it as a bearer token, exactly as with any OpenAI-format API:

```
Authorization: Bearer inf_...
```

## Create a key in the console

1. Open [app.infernear.dev](https://app.infernear.dev) and connect a wallet.
2. Open **API keys** and create a key.
3. Your wallet asks you to sign one message. Signing is free: no transaction is sent.
4. Copy the key. It is shown once and the console keeps it only in the open tab.

## Which wallets work

| Wallet | How it proves who you are | Your user id |
|---|---|---|
| An EVM wallet on Base (a regular account, not a contract wallet) | Sign-In with Ethereum (EIP-4361) | `eip155:8453:<your address, lower case>` |
| Meteor Wallet on NEAR | A signed message (NEP-413) from a full-access key | `near:mainnet:<your account id>` |

The user id is the identity your credits and API usage are recorded under. An EVM user never needs a NEAR account.

## What a key is tied to

* **One wallet.** A key names the wallet that signed for it. Calls made with the key are charged to that wallet's free trial calls and credits. If the wallet is in an [account with linked wallets](../accounts/accounts-and-linked-wallets.md), the key can also be charged to the other wallets in that account.
* **30 days.** A key expires 30 days after it is issued. Create a new one the same way.

## Revoke keys

In **API keys**, choose revoke and sign again. Revoking ends **every key that wallet has issued**. It is recorded on NEAR, and the relay pays the gas.

Each key action needs a fresh signature. There is no login session to steal: the relay keeps no session token.

## Keep it safe

Treat the key like a password. Anyone holding it can spend your free calls and credits until it expires or you revoke it. It cannot move your deposits: vault withdrawals need a signature from your wallet.

## Issue keys from code

The console is the easy path. If you want to issue keys from your own code, the relay's routes are `GET /auth/nonce`, `POST /keys` and `POST /keys/revoke`; see the [API reference](../using-the-api/api-reference.md#key-routes). A complete working example is `relay/scripts/live-check.mjs` in the repository.
