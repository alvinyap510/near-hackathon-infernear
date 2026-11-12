// The copy-paste quickstart shown on "Try the API". It uses NEAR AI's own SDK
// at the commit that adds E2EE v3 (nearai/inference-sdk#127, later released in v0.3.0);
// the relay rejects anything older.
export const SDK_PIN = {
  repo: 'nearai/inference-sdk',
  commit: 'a0bf5fdfde5c9179d50f7459bc36db6db326332e',
  pr: 127,
};

type Params = { baseUrl: string; model: string; maxTokens: number };

const pinComment = (c: string) =>
  `${c} NEAR AI's SDK, pinned at ${SDK_PIN.repo}@${SDK_PIN.commit.slice(0, 7)} (E2EE v3, PR #${SDK_PIN.pr}).`;

export function quickstartJs({ baseUrl, model, maxTokens }: Params): string {
  return `${pinComment('//')}
import { InferenceClient, verifyDeploymentImageProvenance } from '@nearai/inference-sdk';

// NEAR's image-provenance policy for the gateway: "verified" must mean NEAR's
// own gateway images, not just genuine TEE hardware. The SDK still checks the
// model's TEE hardware attestation; its model image check is left out because
// it currently rejects NEAR's own model deploys.
const build = (repository, workflow = '.github/workflows/build.yml') => ({ repository, workflow });
const GATEWAY_IMAGES = {
  'nearaidev/cloud-api': build('nearai/cloud-api'),
  'nearaidev/cvm-ingress': build('nearai/cvm-ingress', '.github/workflows/build-push.yml'),
};

const client = new InferenceClient({
  baseUrl: '${baseUrl}',
  apiKey: process.env.INFERNEAR_API_KEY, // inf_…
  e2ee: true, // encrypt to the model's TEE key, here, before sending
  gatewayVerification: {
    verifiers: {
      deployment: ({ appCompose }) =>
        verifyDeploymentImageProvenance({ appCompose, imagePolicies: GATEWAY_IMAGES }),
    },
  },
});

const completion = await client.chat.completions.create({
  model: '${model}',
  messages: [{ role: 'user', content: 'Reply with the word ok.' }],
  max_tokens: ${maxTokens},
});

// Check the model's signature over the exact request and reply bytes.
const receipt = await client.verifyResponse(completion.id);
console.log(\`Verified \${receipt.signatureKind} reply:\`, completion.choices[0].message.content);
`;
}

export function quickstartPython({ baseUrl, model, maxTokens }: Params): string {
  return `${pinComment('#')}
import asyncio, os
from nearai_inference_sdk import (
    AttestationVerifiers, GatewayVerificationOptions,
    ImageProvenancePolicy as Build, InferenceClient,
    verify_deployment_image_provenance,
)

# NEAR's image-provenance policy for the gateway: "verified" must mean NEAR's
# own gateway images, not just genuine TEE hardware. The SDK still checks the
# model's TEE hardware attestation; its model image check is left out because
# it currently rejects NEAR's own model deploys.
WF = '.github/workflows/build.yml'
GATEWAY_IMAGES = {
    'nearaidev/cloud-api': Build(repository='nearai/cloud-api', workflow=WF),
    'nearaidev/cvm-ingress': Build(repository='nearai/cvm-ingress', workflow='.github/workflows/build-push.yml'),
}

async def gateway_images(d):
    await verify_deployment_image_provenance(d.app_compose, GATEWAY_IMAGES)

async def main():
    async with InferenceClient(
        os.environ['INFERNEAR_API_KEY'],  # inf_…
        base_url='${baseUrl}',
        e2ee=True,  # encrypt to the model's TEE key, here, before sending
        # InferNear is an application proxy, so there is no gateway TLS pin.
        gateway_verification=GatewayVerificationOptions(
            include_spki_fingerprint=False,
            verifiers=AttestationVerifiers(deployment=gateway_images)),
    ) as client:
        completion = await client.chat.completions.create(
            model='${model}',
            messages=[{'role': 'user', 'content': 'Reply with the word ok.'}],
            max_tokens=${maxTokens},
        )
        # Check the model's signature over the exact request and reply bytes.
        receipt = await client.verify_response(completion.id)
        print(f'Verified {receipt.signature_kind} reply:', completion.choices[0].message.content)

asyncio.run(main())
`;
}
