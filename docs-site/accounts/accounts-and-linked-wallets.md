# Accounts and linked wallets

You can use InferNear with nothing but a wallet. An **account** is optional: it gives you a handle and lets you link more than one wallet, EVM or NEAR, under one identity.

## What an account is

| Part | Meaning |
|---|---|
| **Handle** | A name you pick, 3 to 20 characters: lower-case letters, digits, `-` and `_`, starting and ending with a letter or digit. It is unique |
| **ID** | A permanent identifier created with the account. Your avatar is drawn from it, so it looks the same whichever wallet is connected |
| **Wallets** | 1 to 4 linked wallets. A wallet belongs to at most one account |

## Create one

1. Connect a wallet in the [console](https://app.infernear.dev).
2. Open the account button in the header and pick a handle.
3. Sign the message your wallet shows. No transaction is sent.

## Link another wallet

Linking takes two signatures, one from each side, so nobody can attach a wallet to your account, or attach your wallet to theirs, without both agreeing.

1. With a wallet that is already in the account, choose **Link another wallet** and sign. This creates an invitation that is valid for ten minutes and can be used once.
2. Connect the wallet you want to add (EVM or NEAR) and sign to join.

To remove a wallet, connect it and choose **Unlink this wallet**. An account always keeps at least one wallet.

## What linking changes

* **One API key covers the account.** A key can be charged to any wallet in its wallet's account: its own wallet first, then the others in the order they were linked.
* **It takes effect immediately.** The list of linked wallets is read on every call. A wallet that leaves stops being charged at once, and one that joins can be charged without creating a new key.

## What linking does not change

* **Balances stay per wallet.** The NEAR ledger keeps one credit balance for each wallet. A single call is charged to one wallet, so two wallets that each hold too little for a call are not added together.
* **Free trial calls stay per wallet.** Linking neither adds to nor takes from a wallet's own five.
* **Deposits are untouched.** Vault positions belong to the wallet that made them.

## Where accounts live

Accounts are kept by InferNear's relay, not on chain. If that record were lost, handles and links would have to be made again, but no balance would be affected: every wallet's credits are on the NEAR ledger.

The exact routes and the message each step signs are in the [API reference](../using-the-api/api-reference.md#account-routes).
