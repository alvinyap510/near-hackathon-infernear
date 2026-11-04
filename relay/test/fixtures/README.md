# Offline fixtures

These synthetic fixtures were written for InferNear's local fake upstream. They are not live NEAR AI responses, encrypted prompts, signed usage or attestation evidence. Their JSON shapes follow NEAR AI's public API and the pinned SDK's v3 headers. The fake upstream replays these exact bytes, with deliberately split SSE chunks, to check forwarding and metering without a key or network.

The live spike records byte hashes and metadata separately after a key is supplied; it never silently upgrades these fixtures into live evidence.
