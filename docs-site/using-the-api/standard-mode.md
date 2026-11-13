# Standard mode

Standard mode is the plain OpenAI Chat Completions format. If your app already talks to an OpenAI-compatible API, change two things and it works:

| Setting | Value |
|---|---|
| Base URL | `https://api.infernear.dev/v1` |
| API key | your `inf_...` key |

The model still runs inside NEAR AI's attested TEE. What standard mode does **not** give you is privacy from InferNear's relay: the relay can read the prompt and the reply while it passes them along. It stores neither. If that matters, use [private mode](private-mode.md).

## Examples

::: code-group

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

```sh [curl]
curl -s https://api.infernear.dev/v1/chat/completions \
  -H "Authorization: Bearer $INFERNEAR_API_KEY" \
  -H 'Content-Type: application/json' \
  -d '{"model":"Qwen/Qwen3-VL-30B-A3B-Instruct","messages":[{"role":"user","content":"Reply with the single word: ok"}],"max_tokens":64}'
```

:::

## What the relay changes in your request

Billing needs to know how long the reply may be and how many tokens were used, so the relay fills in two things when they are missing. Nothing else in the body is changed.

| Field | What the relay does |
|---|---|
| `max_tokens` | If absent, it is set from `max_completion_tokens`, or else to 4,096 |
| `stream_options.include_usage` | Turned on for streaming requests |

## What is supported

* Streaming (`"stream": true`) and non-streaming replies. Response bytes, including the stream framing, are passed through unchanged.
* Tool definitions and tool calls.
* Text input and output.

## What is refused

| Request | Result |
|---|---|
| `max_tokens` above 4,096 | `400` |
| `n` other than 1 | `400` |
| Input that is not text | `400` |
| A model id that is not in `GET /v1/models` (including aliases) | `404` |
| A body larger than 1 MiB | `413` |
| More than 4 requests in flight for one user | `429` |

## Tips

* **Give reasoning models room.** With a small `max_tokens` (such as 64), a reasoning model can spend the whole budget thinking and return no visible answer. The call is still charged for the tokens used.
* **A retry is a new call.** Client idempotency keys are not implemented, so a retried request is a new inference with its own charge.
* **Check the billing header.** `X-InferNear-Billing` tells you whether a call was `free` or charged to `credits`.

Full details of routes, headers and errors: [API reference](api-reference.md).
