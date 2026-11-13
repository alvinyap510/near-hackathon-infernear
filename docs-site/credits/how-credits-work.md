# How credits work

A credit is one micro-USD (a millionth of a dollar) of API usage, recorded for your wallet on a NEAR smart contract. Credits can only be spent on API calls. They are not a token: they cannot be withdrawn, traded or transferred.

## Where credits come from

| Source | What happens | Rate |
|---|---|---|
| **Vault yield** | You deposit into a [vault](vaults.md) and keep the principal. The yield is paid to InferNear and posted to you as credits | The yield's USD value when it is posted |
| **A direct purchase** | You [buy credits](buy-credits.md) with USDC on Base | 1 USDC = $1 of credits |

Before either, each wallet has [5 free trial calls](../getting-started/free-trial-calls.md). Free calls are used first and never touch the ledger.

## The ledger

The ledger is the contract [`connector.infernear-ai.near`](https://nearblocks.io/address/connector.infernear-ai.near). For each user it keeps two running totals:

* **credited**: everything posted for you so far
* **spent**: everything your calls have been charged

Your available balance is `credited − spent`. The contract enforces **spent ≤ credited** for every user, so a call can never be charged against credits that do not exist. The contract has no owner, no admin and no keys, and it holds no funds.

<CreditsFlow />

Your user id is `eip155:8453:<your address, lower case>` for an EVM wallet or `near:mainnet:<your account id>` for a NEAR wallet.

## How yield becomes credits

1. A **keeper** (part of InferNear's relay) reads each vault at a finalized block and works out how much yield belongs to each depositor.
2. It prices that yield in USD: USDC at $1, cbETH from Chainlink's cbETH/USD feed, the Pendle PT from Pendle's 15-minute average price.
3. It posts the result to the ledger. Only this keeper can post, and for each vault the ledger checks that the yield posted for users never adds up to more than the yield total the keeper reports for that vault.

Yield is collected once it is worth collecting, so small positions can wait a while before their first credits appear. Purchases through the top-up contract are posted about 20 minutes after they are made, once Base has finalized the block.

## How a call spends credits

1. The relay checks your available balance on the ledger and sets aside enough for the largest reply the request allows.
2. The model answers and reports how many tokens it used.
3. The relay charges that usage at the listed price and records it on the ledger under the call's **inference ID**, with a receipt: the model, the token counts and the prices used.

Each inference ID can be charged only once. Sending the same charge again does nothing.

## Check your balance

* **In the console:** the Account tab shows your credits, and each paid call in "Try the API" shows its charge on NEAR.
* **On chain:** call the ledger's view method `account` with `{"user": "<your user id>"}`. It returns `credited`, `spent` and `available`. To look up one call, use `debited_amount` with `{"inference_id": "<the Inference-Id header>"}`.

## What InferNear can and cannot do with credits

* It **cannot** spend your principal as credits. Credits come only from what the keeper posts: yield a vault has paid out, and USDC paid to the top-up contract.
* It **does** decide how yield is priced and which depositor earned it. Both can be recomputed by anyone from public chain data. See [Privacy and trust](../concepts/privacy-and-trust.md).
