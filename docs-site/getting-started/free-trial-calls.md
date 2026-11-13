# Free trial calls

Every wallet gets **5 free trial calls**, paid for by InferNear. They let you check that the API does what you need before you deposit or buy anything.

## The rules

| | |
|---|---|
| Per wallet | 5 calls |
| Across all wallets | 300 calls per day (the day turns over at midnight UTC) |
| Reply length | up to 4,096 tokens, the same cap as paid calls |
| Modes | standard and private |
| Order | free calls are used first, even if you already have credits |

A trial call is counted once the model starts a successful reply (a `2xx` response with an inference or completion id), even if the connection is cut off afterwards. A call that is refused, or fails before that point, is not counted.

## How to tell a call was free

Every chat response carries a billing header:

| Header | Meaning |
|---|---|
| `X-InferNear-Billing: free` | This call is billed as a free trial call |
| `X-InferNear-Billing: credits` | This call is billed to your credits |
| `X-InferNear-Free-Remaining: <n>` | Sent on free calls: how many you have left |

The header says how the call is billed, and it is set when the call is admitted. A response that is not a `2xx`, or one without a usable inference or completion id, is not charged. A `2xx` reply that is cut off after it has an id can still be charged. To see what was actually charged, look the call up on the ledger with `debited_amount` (see [How credits work](../credits/how-credits-work.md#check-your-balance)).

## Check how many you have left

```sh
curl -s https://api.infernear.dev/v1/free-calls \
  -H "Authorization: Bearer $INFERNEAR_API_KEY"
```

```json
{"per_user":5,"used":2,"remaining":3}
```

`remaining` also takes the shared daily limit into account, so it can be lower than `per_user - used` late in a busy day.

The console shows the same number in **Try the API**.

## When they run out

With no free calls and no credits, the API answers `402 insufficient_credit`. Get credits by [depositing into a vault](../credits/vaults.md) or [buying them with USDC](../credits/buy-credits.md).

## Good to know

* Free calls never touch the credit ledger: they are not posted as credits and are not debited on NEAR.
* Linking wallets into one account does not pool free calls. Each wallet keeps its own five.
* The counts are held in the relay's memory. If the relay restarts, the counts start again.
