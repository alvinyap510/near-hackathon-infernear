# Private mode

In private mode the prompt is encrypted **on your machine**, to a key that belongs to the model's TEE. InferNear's relay forwards bytes it cannot read, and the reply comes back encrypted to you. You use NEAR AI's official inference SDK instead of an OpenAI client; the endpoint, the API key and the prices are the same as in standard mode.

## What the SDK checks for you

* **Attestation.** Before sending anything, the SDK verifies that the model is running on genuine TEE hardware and gets the model's public key from that attestation.
* **Encryption.** Your prompt is encrypted to that key. The model id and the reply cap stay readable, so the call can be routed and billed.
* **Signed replies.** The model signs the exact request and reply bytes. `verifyResponse` checks that signature, so you know the reply came from the attested model and was not altered on the way.

## What the relay still sees

Ciphertext, plus metadata: your API key, the model id, the size of the request, timing, and the token counts used for billing. Encryption hides content, not metadata.

## Examples

::: code-group

```js [JavaScript]
// npm install @nearai/inference-sdk@0.3.0
import { InferenceClient, verifyDeploymentImageProvenance } from '@nearai/inference-sdk/node';

// NEAR's image-provenance policy for the gateway: "verified" must mean NEAR's
// own gateway images, not just genuine TEE hardware.
const build = (repository, workflow = '.github/workflows/build.yml') => ({ repository, workflow });
const GATEWAY_IMAGES = {
  'nearaidev/cloud-api': build('nearai/cloud-api'),
  'nearaidev/cvm-ingress': build('nearai/cvm-ingress', '.github/workflows/build-push.yml'),
};

const client = new InferenceClient({
  baseUrl: 'https://api.infernear.dev/v1',
  apiKey: process.env.INFERNEAR_API_KEY, // inf_...
  e2ee: true, // encrypt to the model's TEE key, here, before sending
  gatewayVerification: {
    includeSpkiFingerprint: false, // InferNear is an application proxy: the TLS peer is not the model gateway
    verifiers: {
      deployment: ({ appCompose }) =>
        verifyDeploymentImageProvenance({ appCompose, imagePolicies: GATEWAY_IMAGES }),
    },
  },
});

const completion = await client.chat.completions.create({
  model: 'Qwen/Qwen3-VL-30B-A3B-Instruct',
  messages: [{ role: 'user', content: 'Reply with the word ok.' }],
  max_tokens: 64,
});

// Check the model's signature over the exact request and reply bytes.
const receipt = await client.verifyResponse(completion.id);
console.log(`Verified ${receipt.signatureKind} reply:`, completion.choices[0].message.content);
```

```python [Python]
import asyncio, os
from nearai_inference_sdk import (
    AttestationVerifiers, GatewayVerificationOptions,
    ImageProvenancePolicy as Build, InferenceClient,
    verify_deployment_image_provenance,
)

WF = '.github/workflows/build.yml'
GATEWAY_IMAGES = {
    'nearaidev/cloud-api': Build(repository='nearai/cloud-api', workflow=WF),
    'nearaidev/cvm-ingress': Build(repository='nearai/cvm-ingress', workflow='.github/workflows/build-push.yml'),
}

async def gateway_images(d):
    await verify_deployment_image_provenance(d.app_compose, GATEWAY_IMAGES)

async def main():
    async with InferenceClient(
        os.environ['INFERNEAR_API_KEY'],  # inf_...
        base_url='https://api.infernear.dev/v1',
        e2ee=True,  # encrypt to the model's TEE key, here, before sending
        # InferNear is an application proxy, so there is no gateway TLS pin.
        gateway_verification=GatewayVerificationOptions(
            include_spki_fingerprint=False,
            verifiers=AttestationVerifiers(deployment=gateway_images)),
    ) as client:
        completion = await client.chat.completions.create(
            model='Qwen/Qwen3-VL-30B-A3B-Instruct',
            messages=[{'role': 'user', 'content': 'Reply with the word ok.'}],
            max_tokens=64,
        )
        receipt = await client.verify_response(completion.id)
        print(f'Verified {receipt.signature_kind} reply:', completion.choices[0].message.content)

asyncio.run(main())
```

:::

The Python SDK is installed from NEAR AI's repository, [nearai/inference-sdk](https://github.com/nearai/inference-sdk) (the `py` folder; Python 3.12 or newer).

## Rules for private requests

The relay cannot edit an encrypted body, so two things it fills in for standard mode must already be in your request:

| Requirement | Why |
|---|---|
| `max_tokens` must be set | The relay needs the reply cap to set credit aside |
| Streams must send `stream_options: {"include_usage": true}` | Billing reads the usage the model reports |

The request itself selects the mode: the SDK's encryption headers mean private mode. If only some of those headers arrive, the request is refused with `400`. It is never quietly downgraded to standard mode.

## What has been verified, and what has not

* **Verified live.** On 12 Nov 2026 a probe sent encrypted requests from both JavaScript and Python, plain and streaming, through the relay to a NEAR AI TEE model. The TEE signatures verified, tampered replies were rejected, and every charge matched NEAR AI's own bill after rounding up to a whole micro-USD. The probe used the SDK at commit `a0bf5fd` of nearai/inference-sdk.
* **The published samples run as written.** On 14 Nov 2026 both samples on this page were run against the live relay with a throwaway wallet's free trial call: the JavaScript one with `@nearai/inference-sdk@0.3.0` from npm, the Python one with the SDK at commit `a0bf5fd`. Each returned an encrypted reply whose `provider_tee` signature verified.
* **The model build check is off.** The SDK verifies the model's TEE hardware attestation and its signatures. NEAR's additional check that the model runs NEAR's published build currently rejects NEAR's own deployments, so the samples leave it out. The gateway build check stays on.
* **In the console, private mode is code samples only.** "Try the API" sends standard-mode calls. A private call is made from your own code, as above.
* **Not complete secrecy against an active relay.** A relay can still learn from request length, timing and token counts.

See also [Privacy and trust](../concepts/privacy-and-trust.md).
