# InferNear console

React/TypeScript console: public **Vaults**, **Account**, **API keys**, **Try the API**, and **From another chain**. Complete public configuration selects live wallets/RPC/relay calls; incomplete configuration selects the clearly labelled mock. Nothing here deploys or makes a funded call; the build is deployed separately (see [deploy/README.md](../deploy/README.md)).

## Install and verify

Node 24.22.1 was used. From `web/`:

```sh
npm ci --ignore-scripts
npx tsc --noEmit -p .
npm test
npm run build
```

Tests use offline providers and HTTP fixtures. They never broadcast a transaction or make a paid inference. The build emits `dist/`; `npm run dev` serves locally. No install script or browser download is needed.

## Configuration

Public Vite values are listed in the root `.env.example`. Required live settings remain the relay origin (without `/v1`), Base chain/RPC and three vault addresses, Pendle app URL, NEAR RPC/connector/Rhea/USDC/Intents accounts, and 1Click URL/Base-USDC asset/slippage settings. No operator secret belongs in the browser.

Optional settings:

- `VITE_AAVE_POOL_ADDRESS`: variable supply rate from `getReserveData(USDC).currentLiquidityRate` (ray).
- `VITE_RHEA_LEND_ACCOUNT`: variable supply rate from `get_asset(USDC).supply_apr`.
- `VITE_RHEA_CAP`: USDC base-unit cap for display. Rhea has no total-principal view, so the catalogue total stays undefined.
- `VITE_RHEA_STATUS_NOTE`: nonempty hides deposit actions and also rejects both native and EVM deposit builders with `paused`. Both builders read last-measured coverage and reject a deficit before signing or requesting a funded bridge quote. These are client policies, not a contract pause: direct on-chain calls can bypass them. This build-time Vite setting takes effect only after rebuilding/deploying the bundle. Withdrawals remain available.
- `VITE_TOPUP_ADDRESS`: optional Base credit-purchase contract; unset hides its box without a contract read.

RPCs must allow the page's origin. `RELAY_WEB_ORIGIN` must match it for CORS, SIWE and NEP-413. Rates are on-chain snapshots; no cbETH or Pendle APY is invented.

## Wallets and account

The header opens the existing WalletDialog. EVM providers are discovered by EIP-6963 (`evm:<rdns>`), with an injected fallback. The selected provider is pinned for later calls; explicit disconnect disables the injected fallback, and account/provider changes invalidate unfinished signing flows; explicit EVM connection switches to Base. Meteor Wallet, the one NEAR wallet offered, uses Wallet Selector mainnet without a modal or generated function-call key; if that code fails to load, the EVM wallets are still listed. Sessions restore on load, including redirect intent; disconnect cannot revive an older wallet. Keys remain in tab memory. A shared session revision clears issued keys, remounts cached proof/review screens and rejects stale async issuance on wallet changes, including reconnecting the same account. An already initiated wallet signing request cannot be cancelled by the page; reject it in the wallet. No subsequent transaction is initiated from its invalidated flow.

User ids: `eip155:8453:<lower-case address>` or `near:mainnet:<account_id>`. EVM key actions use SIWE; NEAR actions use [NEP-413](../docs/interfaces.md#near-wallet-key-proofs-nep-413) with the canonical message, SHA256 relay-nonce binding and finalized full-access-key check.

Choosing a catalogue vault opens Account with it selected. NEAR-only sessions see Base strategies as requiring an EVM wallet. Native Rhea deposit signs USDC `ft_transfer_call` with `msg = JSON.stringify({user})`; withdrawal signs vault `withdraw({amount})`. Both attach 1 yoctoNEAR and 100 Tgas. Amounts are validated before signing; withdrawals use nominal principal (`shares`), while `principal` is the covered preview. Registration, pending amounts and busy state are read from NEAR. The keeper settles queues; an unfunded request requires a new request and leaves principal intact. Existing loss notes remain visible. Native deposits must come directly from the owner account. Do not use an external signed Intents transfer naming the verifier itself as `near:mainnet:<verifier>`: that separate contract-level route can strand a voluntary deposit under the verifier id; this console never builds it. Balances refresh on tab entry or **Refresh balances**; pending Rhea operations poll.

## Direct credit purchase

EVM sessions with `VITE_TOPUP_ADDRESS` see **Add credits**. The client reads `usdc`, `minimum`, `paid(owner)`, `paidTotal`, wallet balance and allowance. It validates before signing, approves exactly the amount if needed, confirms approval, rechecks the selected wallet, then calls `pay(amount, self)` and confirms it. A reverted approval never proceeds to pay.

The button area and confirmation both state:

> This is a purchase, not a deposit. The USDC goes to InferNear and cannot be redeemed.

The purchase client journals public amount/hash/status and a `paid(address)` snapshot per payer/contract/chain; never API keys or proofs. It writes the intent before asking the wallet for `pay` and saves the returned hash **before** polling. With Web Locks available, a non-blocking exclusive lock coordinates same-origin tabs from the account/approval checks through saving the purchase hash; review, set-aside and receipt updates require the same lock. Without Web Locks, the fallback excludes operations within one page only: do not use multiple purchase tabs there. Delayed receipt results update only the exact record originally read, so they cannot replace a newer purchase. Pending states survive reload in localStorage when storage remains writable. A retry reconciles rather than broadcasts; a mined retry returns the original hash. Another purchase requires a fresh review acknowledging the displayed, reconciled hash. Confirmation clears before each attempt and on session changes.

The box displays the retained hash and **Check purchase status**. Missing receipts and RPC failures are uncertainty, not permission to retry. A known user rejection or reverted receipt permits a fresh review. For a hashless wallet error, first check wallet activity, reject every outstanding request, and compare **Total bought for you** with the contract's `paid(address)` on Base. Only if nothing was sent, use **No purchase was sent: start again**. That action refuses an active locked operation, any hash-bearing record, an increased on-chain total, or a legacy record without its previous total. It cannot prove an unmined, hashless transaction does not exist; this remains the user's explicit assertion.

Storage must work before `pay`. A failed hash write removes the stale entry and retries; if the hash still cannot fit, it attempts a smaller, blocked broadcast marker and retains the hash in this page's memory. A storage error may mean a purchase was sent: copy the hash before reloading, which loses the memory fallback. If storage refuses every write, persistence cannot be guaranteed. For a recorded transaction that never mines, or unreadable site data, check wallet activity and the transaction on a Base explorer; clearing this site's storage is the last resort only after establishing that no purchase can still execute. The console cannot distinguish a dropped transaction from a pending one and never automatically clears either a hashed pending record or corrupt metadata.

The same wallet-operation validity checks cover vault approval→deposit, redeem, native Rhea actions, and Rhea bridge/signature→relay flows. Disconnecting or changing providers during an approval, quote, account read or signature stops the next transaction/submission. This does not revoke an ERC-20 approval that already mined.

The box shows the owner's total bought. Credits appear after Base finality (about 20 minutes) and the keeper's NEAR post; the live client does not synthesize an immediate credit. A labelled mock purchase changes synthetic credits and wallet USDC, never principal.

## API calls

**Standard is the default.** Models/prices come from real `GET /v1/models`. Run posts plain OpenAI chat JSON with the user's key and a 4,096-token reply cap, the relay's own default. For calls billed to credits, the relay reserves credit for the whole cap before forwarding (about $0.002 to $0.006 per call at current prices, depending on the model) and charges only what the model reports using, so a call needs that much credit available. **The relay can read the prompt and reply in transit.** For credit-billed results, the panel shows the actual reply, completion id, Inference-Id, reported usage and listed-price estimate, then polls `debited_amount(id)` until the real NEAR debit appears. The on-chain amount is authoritative; a price refresh may differ from the older catalogue snapshot. Headerless responses use UUIDv5/DNS of the completion id, as the relay does. The client plain reservation matches the current relay: UTF-8 serialized request bytes **plus 1024 tokens** of chat-template allowance, then the output cap. The relay source remains authoritative for that allowance. A 402 points to depositing into a vault or adding credits. Calls are never automatically retried.

With an API key, the panel shows the relay's remaining free-call count and refreshes it on key changes and after each run; it is not persisted in browser storage, and a failed count read never blocks Run. Each wallet gets five free calls before credits, subject to the relay's shared limit of 300 free calls per day. A response marked free shows its reply, ids and reported usage with “Free trial call: paid by InferNear, not charged to your credits.” and never polls or estimates a NEAR debit; older relays without a billing header retain the credit-billed behaviour.

A completion with null/empty answer text still displays its completion/inference ids, reported usage and any applicable credit debit, with a no-visible-answer explanation. Reasoning-only output is not discarded as an error. A successful response with a known inference header also keeps its billing display if answer JSON or the body completion id is missing; no completion id is invented. Standard usage is reported, not signature-verified. The legacy receipt source `signed_usage` denotes the usage-metered path, not browser verification of plain responses. Missing usage on a credit-billed result is labelled as a reservation charge. The first quickstart uses the official `openai` package; private SDK examples are second.

**Private is code-only in live mode.** It offers the SDK quickstart with `verifyResponse`, gateway provenance policy and the explicit application-proxy TLS setting. There is no live browser Run button, fake ciphertext, fake attestation or substituted reply. npm SDK **0.3.0** was evaluated only in a temporary probe directory. Its browser entry passed a free `verify(model)` preflight under Node through the public relay. It has not been run in a real browser and no paid completion was attempted, so a verified browser completion is not claimed. Mock private calls retain the existing Verified panel with simulation labels.

## From another chain

This panel reads 1Click `/v0/tokens`, selecting six-decimal USDC entries for Ethereum (1), Arbitrum (42161), Optimism (10) and Polygon (137). USDC contracts and asset ids come from that response, not hard-coded addresses. The destination is configured/listed Base USDC at the user's own address.

Previews POST `/v0/quote` with `dry: true`. Asset/route fields, recipient/refund address, input amount and deadline are checked. A free live Ethereum→Base quote returned HTTP 201, matching route fields and no deposit address.

**Funding is disabled in this release**, clearly labelled in the panel. No non-dry quote, origin-chain switch, token transfer, funded-swap polling or Base switch-back is performed here. That multi-chain signing/confirmation/recovery path has not been validated with real wallets. The existing EVM Rhea bridge flow is separate and remains implemented. Mock quotes remain labelled.

## UI and verification limits

New screens reuse existing `card`, `vault-form`, `confirm`, `loss-note`, `seg-control`, `needs-key` and `fineprint` classes, with ChainBadge/AssetBadge. The Shell carries the public tabs, NEAR labels and switch/disconnect controls. The old Connect screen was removed.

Tests cover purchase validation, hidden state, approve→pay ordering/reverts, receipt uncertainty and persistent retries, missing-hash/storage failures, disconnect/account/provider changes during signing flows, native/EVM paused and deficit deposits, session-secret cleanup, no-visible-text billing, reservation parity, model mapping, plain chat/id/usage/402 handling, private fallback, bridge discovery/quote binding, mock conservation, and existing wallet/session/vault/key behavior. Real wallet popups, redirects, signatures, purchases, deposits, withdrawals and paid inference still require manual verification. The built console was checked in headless Chrome without a wallet (Vaults tab, wallet dialog, model list in Try the API).

Logos come from `@web3icons/react` 4.1.24. The private inference SDK is not bundled. Existing wallet dependency audit findings and transitive `js-sha256` direct-eval warnings remain documented, not suppressed.
