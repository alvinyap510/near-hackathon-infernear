# Relay: gateway and keeper

One TypeScript/Node process. The gateway authenticates API clients, reserves credits in memory, forwards encrypted requests and raw responses, and settles receipts on the NEAR connector. The keeper skims USDC vaults, posts finalized cumulative credits, and moves the treasury's USDC through 1Click. The connector remains the durable ledger.

**Verified locally with synthetic fixtures and fake HTTP/RPC servers. No live inference, chain transaction or bridge was executed.** The fixture data is not real ciphertext or signed usage; [fixture provenance](test/fixtures/README.md) states its limits.

## Install and verify

Requires Node **24.22.1+** and npm. From the repository root:

```sh
cd relay
npm ci --ignore-scripts
npm test
npm run demo
```

`npm test` type-checks the service, tests and probe, then runs Node's test runner. Tests use only loopback servers and fakes; no `.env`, credentials or external network are needed. After the dependency cache has been populated, `npm ci --offline --ignore-scripts` also works. No install script or browser download is needed.

`npm run demo` is a fixture-only smoke flow: a passive holder receives 1,000 micro-USD from a fake finalized vault snapshot, spends 13 through the HTTP API, and has 987 remaining. The quote below the bridge minimum is explicitly labelled as a fixture. No principal or real assets are involved.

## Service configuration

Fill the relay sections of the repository's `.env.example` in a local `.env`. The keeper also reuses `EVM_USDC` from the deployment section. All RPC URLs, chain IDs, accounts, keys, vault addresses and 1Click asset IDs come from configuration. `RELAY_PUBLIC_URL` binds SIWE's domain and URI origin; `RELAY_WEB_ORIGIN` is the dashboard's CORS origin. `RELAY_MAX_TOKENS` sets the output cap. `RELAY_UPSTREAM_TIMEOUT_MS` sets a total upstream deadline (example: 120,000 ms), including response-body streaming. `NEAR_AI_BASE_URL` must include `/v1`. `VAULT_START_BLOCK` must include the earliest vault deployment so holder discovery includes every `Transfer`.

With the live dependencies configured, `npm start` loads `../.env`. This command has **not** been run against live services. It waits 30 seconds before listening, retries debit jobs every second, and runs the keeper every minute. The gateway's NEAR key should permit only `debit` and `bump_key_epoch`; the keeper's should permit only `post_credits`. Pre-fund the connector for storage. Never publish private keys or `.env`.

Public routes, wallet proofs and receipt fields follow [the shared interfaces](../docs/interfaces.md). The API key's `exp` and route `expires_at` are Unix seconds. Key routes support EOA EIP-4361 signatures; contract-wallet signature verification is not implemented.

## Gateway behavior and limits

- Wallet nonces expire after five minutes and are consumed once. Each key operation requires a new signature, the configured chain/domain/URI origin, and `expirationTime`. There is no session token. Keys expire after 30 days. A failed or uncertain revoke immediately rejects earlier keys locally, but its pending epoch cannot be issued: issuance returns 503 until a finalized read or successful revoke confirms the bump. Repeated failed attempts retain the same pending target.
- `/v1/models` caches the canonical, attested `vllm` text chat models for five minutes and exposes integer nano-USD prices: text in and out (`architecture.inputModalities` / `outputModalities`) and a non-empty `supportedFeatures`, which leaves out NEAR's privacy filter and reranker. Anonymous model-detail, attestation and signature requests share a 30/minute limit per socket IP. Valid keys bypass it. Forwarded IP headers are not trusted; deploy with client socket IPs preserved. The nonce and anonymous-IP maps each cap at 10,000 live entries; new entries receive 503 at capacity. Expiry removes oldest expired entries in insertion order, avoiding a full-map scan per request. Live proofs and rate buckets are not evicted to admit new ones. Named risk: anonymous memory and event-loop exhaustion in the shared settlement process.
- All POST bodies have one **1 MiB (1,048,576 bytes)** envelope limit. Declared lengths and bytes actually read, including chunked uploads, enforce it and return OpenAI-format 413 errors. Chat bearer MAC/expiry checks run before buffering; epoch and headroom checks still use the admission account read. Named risk: unauthenticated uploads exhausting memory and losing pending settlements.
- Chat requires the SDK's v3 encryption/signing/key headers, all-fields encryption and no-aliasing flags. It rejects missing/oversized `max_tokens`, `max_completion_tokens`, `n != 1`, non-text input envelopes, unknown/alias models, and streams lacking `include_usage`. Encrypted tool definitions and calls are allowed.
- Request bytes and response bytes, including SSE framing, are forwarded unchanged. Upstream authorization is replaced, `Accept-Encoding: identity` is sent, and metering reads a separate copy. Admission validates the effective forwarded E2EE headers, so a `Connection` nomination cannot remove an encryption header after validation. A disconnected client does not cancel the upstream drain. CORS allows E2EE headers and exposes `Inference-Id`.
- Under a per-user mutex, admission reserves `ceil((ceil(body_bytes/2) * in_price_nano + max_tokens * out_price_nano)/1000)`. Four requests may be in flight. Headroom subtracts all reservations and the greater of the on-chain read and local spent floor. The floor remembers higher observed spend and counts each broadcast inference ID once.
- A successful completion uses the `Inference-Id` header or UUIDv5 of its body completion ID under the DNS namespace; correlation with NEAR's live billing remains a day-1 probe item. Usage charges `min(ceil(usage * snapshot_price), reservation)`. Missing/malformed usage, including non-object JSON metadata, charges the full reservation when a completion ID exists, with numeric reservation inputs and `source: reservation`. A metering error still runs settlement. The relay reads usage; clients verify the associated response signatures.
- A debit retains its reservation until broadcasting, then counts its capped amount in the spent floor. RPC, gas and storage failures retry the same inference ID until a finalized `debited_amount` confirms it. An insufficient-credit rejection is reported as InferNear's loss. Retries never add the amount to the floor again.
- Forgiveness requires no successful completion: no usable header or body ID, or a non-2xx upstream result. It releases the reservation and reports InferNear's loss. A partial stream with an observed completion ID is charged even if its transport later fails.
- The total upstream deadline applies to catalog, read and chat calls. It does not reset when bytes trickle in. Before response headers it returns 504; afterward it terminates the partial response. An observed completion ID still settles from usage or the reservation, while no completion follows forgiveness. Named risk: a stalled upstream retaining reservations and all four active slots indefinitely.

Gateway, keeper, debit-retry and startup error reports contain fixed error classifications and safe context, never dependency messages, stacks, request bodies or credential-bearing URLs.

Restart loses in-memory jobs and nonces. Broadcast transactions may still land; their IDs deduplicate. A completion delivered immediately before a crash, before debit broadcast, is InferNear's loss. A cold process may temporarily accept or issue an old-epoch key until its account read catches up; **there is no enforced bound** on that revocation window. Within a process, revocation takes effect before awaiting its transaction. Admitted requests finish normally. Client retries create new upstream inferences and incur new charges; client idempotency keys are not implemented.

## Keeper behavior

Each vault is skimmed before reading a recent finalized block. Every holder ever observed in its `Transfer` events, including exited holders, is read at that same block. The yield token must match configured USDC. A nonzero `unpaid()` skips posting. Otherwise the keeper posts `paidTotal()` and every holder's cumulative `yieldCredited()`. The connector enforces budgets and replay safety. A revert or RPC error is reported and retried on the next tick; another vault, bridging and storage monitoring can still run.

Only the treasury's USDC balance is bridged. Below configured `ONECLICK_MIN_BASE_UNITS` (example: 150,000 USDC base units), 1Click receives a labelled `dry:true` quote request and no transfer occurs; an empty treasury is reported without a quote. Verify the protocol minimum before live use. At or above the minimum, the quoted deposit receives one ERC-20 transfer. A pending transfer/swap is monitored before another bridge begins. The destination is a plain NEAR treasury account, never the connector. A restart loses the pending swap monitor; the already broadcast transfer continues independently. Gas is paid from the treasury's native-chain balance. The keeper logs connector balance and storage usage each tick.

Review regressions are labelled by finding ID in `test/review.test.ts` (CR1-1–7, Flex1-1–3, Flex2-1–2), `test/adapters.test.ts` (Flex2-3 configured minimum), and `test/gateway.test.ts` (Flex1-4 DNS reference vector). These are offline tests, not evidence that the live SDK probe passed.

## Live SDK spike — prepared, not run

The probe uses a fake connector and temporary local API key, plus **real paid NEAR AI inference**. It never connects to EVM or NEAR RPC. Requires Git, a native build toolchain and Python 3.12+. Install the official SDK outside this repository at the exact reviewed commit:

```sh
bash scripts/setup-spike.sh /tmp/infernear-spike-sdk
```

Set `SPIKE_SDK_DIR` to that directory and fill `NEAR_AI_BASE_URL`, `NEAR_AI_API_KEY`, `BASE_CHAIN_ID`, `SPIKE_MODEL` (a canonical TEE model), `SPIKE_PROMPT` (a public test sentence), `SPIKE_MAX_TOKENS` and `SPIKE_USER_ID` (a synthetic CAIP-10 user) in `../.env`. Then:

```sh
npm run spike
```

Setup and live commands above remain **unrun**. Their shell/Python syntax and TypeScript types were checked. The SDK pin is `a0bf5fdfde5c9179d50f7459bc36db6db326332e`; both languages install from that checkout. The application-proxy client disables SPKI binding, keeps attestation verification on, applies the [configured build provenance policies](scripts/provenance.json) to the gateway and every model report, and verifies every complete SDK response. Policies identify NEAR's published source/workflow identities; they do not prove the full runtime configuration.

The script checks JS and Python JSON/streaming calls, v3 headers, anonymous bootstrap, model/gateway signature kinds, stream usage, headerless-stream body-ID settlement, reply-key replay rejection, and whether injected responses decrypt under an attacker key. It cross-checks visible billing costs against usage/prices; zero costs may need a later check for billing propagation. Whether anonymous reads are unbilled still requires checking the operator's account; the billing API does not enumerate those reads. Results contain metadata and byte hashes in ignored `spike-output/results.json`, not API keys or prompt/response bodies.

Do not claim live v3 or streaming support until this probe passes. If encrypted streaming has no usable usage, the agreed v1 decision is to disable streaming and document it. V3 does not prevent an active relay from learning via length, timing and token-count oracles; complete confidentiality against an active relay is not claimed. A plaintext mode is not provided.
