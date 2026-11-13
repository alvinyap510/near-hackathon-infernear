# Models and pricing

InferNear serves NEAR AI Cloud's attested TEE chat models, and only those. The live list, with current prices, is always one call away and needs no key:

```sh
curl -s https://api.infernear.dev/v1/models
```

## Models listed on 13 Nov 2026

Prices are NEAR AI Cloud's listed prices for each model, shown here per million tokens.

| Model id | Input, per 1M tokens | Output, per 1M tokens |
|---|---|---|
| `deepseek-ai/DeepSeek-V4.1-Flash-1017` | $0.30 | $1.20 |
| `deepseek-ai/DeepSeek-V4.1-Flash-1017-abliterated` | $0.30 | $1.20 |
| `Qwen/Qwen3.6-35B-A3B-FP8` | $0.17 | $1.10 |
| `Qwen/Qwen3.8-27B` | $0.04 | $1.35 |
| `Qwen/Qwen3.8-27B-abliterated` | $0.04 | $1.35 |
| `Qwen/Qwen3-VL-30B-A3B-Instruct` | $0.15 | $0.55 |
| `z-ai/glm-5.3-flash` | $0.08 | $0.50 |

The list and the prices follow NEAR AI Cloud and can change. Treat `GET /v1/models` as the source of truth, and use the exact `id` it returns: aliases are not accepted.

## Reading the price fields

Each model in the response carries two price objects:

```json
{
  "id": "z-ai/glm-5.3-flash",
  "inputCostPerToken": {"amount": 80, "scale": 9, "currency": "USD"},
  "outputCostPerToken": {"amount": 500, "scale": 9, "currency": "USD"}
}
```

`amount` at `scale: 9` is a price in nano-USD per token. Divide by 1,000 to get dollars per million tokens: `80` is $0.08 per million input tokens.

## How a call is charged

Credits are counted in **micro-USD** (one millionth of a dollar).

1. **Before the call**, the relay sets aside enough of your credit to cover the largest reply the request allows (`max_tokens`). You need that much available, even though you will usually be charged much less. At the 4,096-token cap this is roughly $0.002 to $0.006, depending on the model.
2. **After the call**, you are charged for the tokens the model reports using, at the prices in the list, rounded up to a whole micro-USD. The rest of what was set aside is released.
3. **The charge is recorded on NEAR** under the call's inference ID. See [How credits work](../credits/how-credits-work.md).

If a reply completes but reports no usage, the call is charged at the amount that was set aside. If the call fails and no reply is produced, nothing is charged.

Both [standard](standard-mode.md) and [private](private-mode.md) mode serve the same models at the same prices.
