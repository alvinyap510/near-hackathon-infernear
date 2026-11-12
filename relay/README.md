# Relay: gateway and keeper

One TypeScript/Node process. The gateway authenticates API clients, reserves credits in memory, forwards encrypted requests and raw responses, and settles receipts on the NEAR connector. The keeper handles Aave, cbETH RateVault, Pendle PT and the NEAR Rhea vault, posts finalized cumulative yield with a frozen USD rate, and bridges explicitly configured treasury tokens through 1Click. The connector remains the durable ledger.

**Verified locally with synthetic fixtures and fake HTTP/RPC servers, plus one live inference probe against NEAR AI (below). No chain transaction or bridge was executed.** The fixture data is not real ciphertext or signed usage; [fixture provenance](test/fixtures/README.md) states its limits.

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

Fill the relay sections of the repository's `.env.example` in a local `.env`. All RPC URLs, chain IDs, accounts, keys, vault addresses and 1Click asset IDs come from configuration. `RELAY_PUBLIC_URL` binds SIWE's domain and URI origin; `RELAY_WEB_ORIGIN` is the dashboard's CORS origin. `RELAY_MAX_TOKENS` sets the output cap. `RELAY_UPSTREAM_TIMEOUT_MS` sets a total upstream deadline (example: 120,000 ms), including response-body streaming. `NEAR_AI_BASE_URL` must include `/v1`. `VAULT_START_BLOCK` must include the earliest vault deployment so holder discovery includes every `Transfer`.

With the live dependencies configured, `npm start` loads `../.env`. This command has **not** been run against live services. It waits 30 seconds before listening, retries debit jobs every second, and runs the keeper every minute. The gateway's NEAR key should permit only `debit` and `bump_key_epoch`; the keeper's should permit only `post_credits`, both restricted to the connector. `NEAR_RELAY_ACCOUNT` / `NEAR_RELAY_PRIVATE_KEY` is a funded gas-only signer for the Rhea vault and Intents verifier; it needs a full-access key because a NEAR function-call key is restricted to one receiver. Never give the relay a key on a vault account. Calls sharing an account serialize signing to avoid nonce races. Pre-fund the connector for storage. Never publish private keys or `.env`.

Public routes, wallet proofs and receipt fields follow [the shared interfaces](../docs/interfaces.md). The API key's `exp` and route `expires_at` are Unix seconds. Key routes support EOA EIP-4361 signatures; contract-wallet signature verification is not implemented.

## Gateway behavior and limits

- Wallet nonces expire after five minutes and are consumed once. Each key operation requires a new signature, the configured chain/domain/URI origin, and `expirationTime`. There is no session token. Keys expire after 30 days. A failed or uncertain revoke immediately rejects earlier keys locally, but its pending epoch cannot be issued: issuance returns 503 until a finalized read or successful revoke confirms the bump. Repeated failed attempts retain the same pending target.
- `/v1/models` caches the canonical, attested `vllm` text chat models for five minutes and exposes integer nano-USD prices: text in and out (`architecture.inputModalities` / `outputModalities`) and a non-empty `supportedFeatures`, which leaves out NEAR's privacy filter and reranker. Anonymous model-detail, attestation and signature requests and both gas-paying signed routes share a 30/minute limit per socket IP. Valid API keys bypass it for reads only; signed routes always consume the bucket. Forwarded IP headers are not trusted unless `RELAY_CLIENT_IP_HEADER` names one (for example `cf-connecting-ip` behind a Cloudflare Tunnel); a request without that header falls back to its socket IP. Set it only when the relay port is reachable solely through that proxy, and only to a single-IP header the proxy overwrites (not `x-forwarded-for`, which Cloudflare appends to); otherwise clients can pick their own bucket. The nonce and anonymous-IP maps each cap at 10,000 live entries; new entries receive 503 at capacity. Expiry removes oldest expired entries in insertion order, avoiding a full-map scan per request. Live proofs and rate buckets are not evicted to admit new ones. Named risk: anonymous memory and event-loop exhaustion in the shared settlement process.
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

`EVM_VAULTS` is a JSON array of entries with an explicit `kind`. Set deployed vault addresses; these are not token addresses. `VAULT_START_BLOCK` includes the earliest deployment. Entry schemas:

```json
[
  {"kind":"aave","address":"<deployed AaveUsdcVault>"},
  {"kind":"rate","address":"<deployed RateVault>","feed":"0xd7818272B9e248357d13057AAb0B417aF31E817d","heartbeat":1200},
  {"kind":"pendle","address":"<deployed PendlePtVault>","market":"0x6c23193128f7907a3570234a6f6f1c2932f1e84b","oracle":"0x5542be50420E88dd7D5B4a3D488FA6ED82F6DAc2"}
]
```

Each EVM vault is skimmed before reading a recent finalized block. Every holder ever observed in its `Transfer` events, including exited holders, is read at that block. The pricing feed is read at **the same block**; the old USDC-only rejection is removed. Rates are micro-USD per 1e18 yield-token base units:

- Aave USDC: `1e18`.
- cbETH: the configured Chainlink **cbETH/USD market feed**, 8 decimals, `answer / 100` (integer floor). This is distinct from the vault's cbETH/ETH economic exchange-rate feed. `updatedAt` older than the configured 1,200-second heartbeat, a nonpositive answer or a failed read skips posting and reports the reason. Age is measured against the finalized block's timestamp; exactly one heartbeat is accepted.
- PT-deJAAA: `getPtToAssetRate(market, 900) / 1e12` via the configured Pendle oracle, floored; nonpositive/failed rates skip posting. Pendle supplies a 900-second TWAP, not a Chainlink timestamp/heartbeat.

`RHEA_VAULT_ACCOUNT` adds the fourth entry with `kind: rhea` and id `near:mainnet:<account>`. Its gas-paying `run()` executes first; the keeper pins `busy`, `unpaid`, `paid_total`, paginated `holders(from, limit)` and every `position(user)` to one finalized NEAR block. It posts only if not busy and unpaid is zero, at rate `1e18`.

All posts send `post_credits(vault, paid_cum, rate, source_block, entries)`: `paid_cum`/entries stay in native yield-token units, `rate` is an integer string, and `source_block` is a JSON number. The keeper sends no remainder or pre-converted credits; the connector carries per-user/vault fractions and enforces budgets/replays. Nonzero unpaid skips posting. Failed ticks report a classified error and retry next minute, without preventing other vaults or balance monitoring. Treasury conversion does not delay credits.

`ONECLICK_TOKENS` is a JSON array of `{ "token": "<Base ERC20 address>", "originAsset": "<1Click asset id>", "minimumBaseUnits": "150000" }`; the minimum is in that token's base units. Configure **USDC today**, or `[]` to hold all yield. Only configure additional tokens once 1Click supports the exact token. Unconfigured yield tokens are labelled `held_unconfigured` and receive no quote or transfer; PT remains held for manual sale. Each configured token has its own pending swap monitor. Below its minimum, 1Click gets a labelled `dry:true` quote and no transfer; an empty balance needs no quote. At/above the minimum, the validated quote receives one ERC-20 transfer. `ONECLICK_DESTINATION_ASSET` and `TREASURY_NEAR_ACCOUNT` set the NEAR-USDC treasury destination, never the connector. Verify the route minimum before live use. A restart loses pending swap monitors; broadcast swaps continue independently.

The keeper reports connector balance/storage and free NEAR balance for the relay and Rhea vault. Free balance subtracts storage stake (1e19 yoctoNEAR/byte). `NEAR_LOW_BALANCE_YOCTO` is the operator's alert threshold; low balances emit `low_near_balance` and do not add an admission gate.

## Gas-paying signed routes

Both routes accept POST JSON up to the existing **1 MiB** limit and always consume the shared 30/minute socket-IP bucket, including failed proofs and requests carrying API keys. Before any transaction, viem checks the EIP-191 signature and signed expiry. Invalid/expired proofs return OpenAI-format `400 invalid_signed_request`; oversized bodies return 413, exhausted IP buckets 429, and dependency failures 503. Both return `{ "tx_hash": "..." }` after final execution.

- `/rhea/withdraw`: `{ "message": "<exact signed JSON string>", "signature": "0x<65-byte r||s||v>" }`. The signed JSON uses the [Rhea interface](../docs/interfaces.md): action `withdraw`, network `mainnet`, configured vault, lower-case CAIP-10 owner, amount string, numeric nonce and Unix-second `expires_at`. The relay calls that configured vault's `request_withdraw(message, signature)` unchanged. The vault checks nonce, principal and busy state.
- `/intents/execute`: `{ "signed": [{ "standard": "erc191", "payload": "<exact signed JSON string>", "signature": "secp256k1:<base58 r||s||v>" }] }`, matching the verifier's [native ERC-191 encoding](https://docs.near-intents.org/integration/verifier-contract/signing-intents#erc-191). Recovery id is 0/1. The 65-byte signature encoding is bounded to 89 base58 characters before decoding; this prevents oversized radix conversions from monopolizing the settlement process. Payload `signer_id` is the EVM address, `verifying_contract` must equal `NEAR_INTENTS_ACCOUNT`, and `deadline` is a required unexpired ISO timestamp. All signatures are checked before submitting one `execute_intents({signed})`. The verifier remains authoritative for nonce, key authorization and intent execution.

Unsigned transaction targets, deposits and other body fields are discarded. The relay account pays gas with zero attached deposit; it does not authorize or redirect a user's principal. Tests sign synthetic messages locally and inspect fake-RPC transactions; no mainnet request or bridge was executed.

Review regressions are labelled by finding ID in `test/review.test.ts` (CR1-1–7, Flex1-1–3, Flex2-1–2), `test/adapters.test.ts` (Flex2-3 configured minimum), and `test/gateway.test.ts` (Flex1-4 DNS reference vector). These are offline tests, not evidence that the live SDK probe passed.

## Live SDK probe — passed on 2026-11-12

The probe uses a fake connector and temporary local API key, plus **real paid NEAR AI inference**. It never connects to EVM or NEAR RPC. Requires Git, a native build toolchain and Python 3.12+. Install the official SDK outside this repository at the exact reviewed commit:

```sh
bash scripts/setup-spike.sh /tmp/infernear-spike-sdk
```

Set `SPIKE_SDK_DIR` to that directory and fill `NEAR_AI_BASE_URL`, `NEAR_AI_API_KEY`, `BASE_CHAIN_ID`, `SPIKE_MODEL` (a canonical TEE model), `SPIKE_PROMPT` (a public test sentence), `SPIKE_MAX_TOKENS` and `SPIKE_USER_ID` (a synthetic CAIP-10 user) in `../.env`. Then:

```sh
npm run spike
```

**Result (2026-11-12, model `z-ai/glm-5.3-flash`):** the probe completed in both JS and Python, for JSON and streaming calls: v3 encryption through this relay, `provider_tee` response signatures, a debit for every completion, and all five relay charges equal to NEAR's own billed cost. Both reply-key tampering requests were rejected, and an attacker key could not decrypt the reply. Reproducing it needs your own NEAR AI key and spends a few cents at most. The SDK pin is `a0bf5fdfde5c9179d50f7459bc36db6db326332e`; both languages install from that checkout (Python 3.12 or newer).

The application-proxy client disables SPKI binding, keeps TEE attestation verification on for the gateway and the model, applies the [gateway build provenance policy](scripts/provenance.json) (`cloud-api`, `cvm-ingress`), and verifies every complete SDK response. Policies identify NEAR's published source/workflow identities; they do not prove the full runtime configuration.

**Model build provenance is not checked.** NEAR's compose-manager provenance verifier (the same at the SDK's latest main) checks only the services named in a model machine's newest deploy action. On 2026-11-12 the newest action on every attested chat model's machine restarted only a helper container, so the verifier rejected every model even though NEAR's published compose file still runs `nearaidev/vllm-proxy-rs`. Model TEE hardware attestation, signing-key binding and response signatures remain checked; we will re-enable the build check once NEAR's verifier or deployments pass it again.

The script checks JS and Python JSON/streaming calls, v3 headers, anonymous bootstrap, model/gateway signature kinds, stream usage, headerless-stream body-ID settlement, reply-key replay rejection, and whether injected responses decrypt under an attacker key. It cross-checks visible billing costs against usage/prices; zero costs may need a later check for billing propagation. Whether anonymous reads are unbilled still requires checking the operator's account; the billing API does not enumerate those reads. Results contain metadata and byte hashes in ignored `spike-output/results.json`, not API keys or prompt/response bodies.

Encrypted streaming returned usable usage, so streaming stays enabled. V3 does not prevent an active relay from learning via length, timing and token-count oracles; complete confidentiality against an active relay is not claimed. A plaintext mode is not provided.
