"""Live probe only: imported SDK must be the checkout prepared by setup-spike.sh."""
import asyncio
import json
import os
from pathlib import Path

from nearai_inference_sdk import (
    InferenceClient, GatewayVerificationOptions, ModelVerificationOptions,
    AttestationVerifiers, ModelAttestationVerifiers, ImageProvenancePolicy,
    ComposeManagerImagePolicy, verify_deployment_image_provenance,
    verify_compose_manager_deployment_image_provenance,
)


async def main():
    policies = json.loads(Path(__file__).with_name("provenance.json").read_text())
    gateway_policies = {k: ImageProvenancePolicy(**v) for k, v in policies["gateway"].items()}
    model_policies = {k: ImageProvenancePolicy(**v) for k, v in policies["model"].items()}
    compose = policies["composeManager"]

    async def gateway_policy(deployment):
        await verify_deployment_image_provenance(deployment.app_compose, gateway_policies)

    async def model_policy(deployment):
        await verify_compose_manager_deployment_image_provenance(
            deployment, model_policies,
            compose_manager_image_policy=ComposeManagerImagePolicy(
                image_repository=compose["imageRepository"], repository=compose["repository"], workflow=compose["workflow"],
            ),
        )

    async with InferenceClient(
        api_key=os.environ["SPIKE_RELAY_KEY"], base_url=os.environ["SPIKE_RELAY_URL"], e2ee=True,
        attestation_cache_time_to_live_ms=0,
        gateway_verification=GatewayVerificationOptions(include_spki_fingerprint=False, verifiers=AttestationVerifiers(deployment=gateway_policy)),
        model_verification=ModelVerificationOptions(verifiers=ModelAttestationVerifiers(deployment=model_policy)),
    ) as client:
        await client.verify(os.environ["SPIKE_MODEL"])
        for streaming in (False, True):
            params = {"model": os.environ["SPIKE_MODEL"], "messages": [{"role": "user", "content": os.environ["SPIKE_PROMPT"]}], "max_tokens": int(os.environ["SPIKE_MAX_TOKENS"])}
            if streaming:
                params.update(stream=True, stream_options={"include_usage": True})
                stream = await client.chat.completions.create(**params)
                completion_id = None
                async for chunk in stream:
                    completion_id = chunk.id
                if not completion_id:
                    raise RuntimeError("Python stream produced no completion ID")
            else:
                completion = await client.chat.completions.create(**params)
                completion_id = completion.id
            verified = await client.verify_response(completion_id)
            print(json.dumps({"language": "python", "stream": streaming, "chat_id": completion_id, "signature_kind": verified.signature_kind}), flush=True)


if __name__ == "__main__":
    asyncio.run(main())
