# Quickstart

Make a real call to a private model in a few minutes. You need a wallet (an EVM wallet on Base, or Meteor Wallet on NEAR) but no funds: every wallet gets 5 free trial calls.

## 1. See the models

No key is needed for this one.

```sh
curl -s https://api.infernear.dev/v1/models
```

You get the list of models InferNear serves, each with its price per input and output token. See [Models and pricing](../using-the-api/models-and-pricing.md).

## 2. Get an API key

1. Open the console at [app.infernear.dev](https://app.infernear.dev).
2. Connect an EVM wallet (on Base) or Meteor Wallet (NEAR).
3. Open **API keys** and create a key. Your wallet signs one message. No transaction is sent and nothing is paid.
4. Copy the key. It starts with `inf_` and is shown once.

```sh
export INFERNEAR_API_KEY=inf_...
```

More detail: [API keys](api-keys.md).

## 3. Make a call

::: code-group

```sh [curl]
curl -s -D - https://api.infernear.dev/v1/chat/completions \
  -H "Authorization: Bearer $INFERNEAR_API_KEY" \
  -H 'Content-Type: application/json' \
  -d '{
    "model": "Qwen/Qwen3-VL-30B-A3B-Instruct",
    "messages": [{"role": "user", "content": "Reply with the single word: ok"}],
    "max_tokens": 64
  }'
```

```python [Python]
# pip install openai
import os
from openai import OpenAI

client = OpenAI(base_url='https://api.infernear.dev/v1', api_key=os.environ['INFERNEAR_API_KEY'])
result = client.chat.completions.create(
    model='Qwen/Qwen3-VL-30B-A3B-Instruct',
    messages=[{'role': 'user', 'content': 'Reply with the word ok.'}],
    max_tokens=64,
)
print(result.choices[0].message.content)
```

```js [JavaScript]
// npm install openai
import OpenAI from 'openai';

const client = new OpenAI({
  baseURL: 'https://api.infernear.dev/v1',
  apiKey: process.env.INFERNEAR_API_KEY,
});
const result = await client.chat.completions.create({
  model: 'Qwen/Qwen3-VL-30B-A3B-Instruct',
  messages: [{ role: 'user', content: 'Reply with the word ok.' }],
  max_tokens: 64,
});
console.log(result.choices[0].message.content);
```

:::

## What you should see

* Status `200` and an OpenAI-format chat completion.
* The response header `x-infernear-billing: free`, and `x-infernear-free-remaining` with the number of trial calls you have left.

When your free calls are used up and you have no credits, the API answers `402 insufficient_credit`. To keep going, [deposit into a vault](../credits/vaults.md) or [buy credits](../credits/buy-credits.md).

## Try it without a wallet

Prefer to see it work before connecting anything? From a clone of the repository:

```sh
cd relay && npm ci --ignore-scripts && npm run live-check
```

The script creates a throwaway key pair, signs in to the live relay, receives an API key and makes one free call. It prints each step and ends with `PASS`. It sends no transaction.

## Next

* [Standard mode](../using-the-api/standard-mode.md): what the relay can see, streaming, limits.
* [Private mode](../using-the-api/private-mode.md): encrypt the prompt to the model so the relay cannot read it.
