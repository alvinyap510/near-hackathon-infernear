# InferNear dashboard (`web/`)

The account dashboard for the InferNear endpoint. **Account** shows one aggregated credit balance and a picker over four vaults: Aave USDC, cbETH and Pendle PT-deJAAA on Base, and Rhea USDC on NEAR. Each vault has its own deposit/redeem in its own token and decimals, plus a loss note. **API keys**, **Try the API** and **From another chain** follow. Everything sits behind `DashboardData` (`src/data/`).

## Run and verify

Node 22.18 or newer. From this folder:

```sh
npm ci --ignore-scripts
npm run dev
npm run build
npm test
```

Vite reads public `VITE_*` variables from the repository-root `.env` (`cp ../.env.example ../.env` to start). Never put a private key or relay secret in a `VITE_*` variable: Vite ships those values to the browser.

## Live mode

**Every** value below must be set (and the chain id and slippage valid) to select `createLiveData`; otherwise the dashboard keeps the labelled in-memory mock (`isMock: true`) and shows a "Mock data" ribbon on every screen. A missing injected wallet or failed live request produces an error, not a fallback to invented balances.

| Variable | Meaning |
|---|---|
| `VITE_RELAY_URL` | Public relay base URL; its host/origin must match the relay's `RELAY_PUBLIC_URL` |
| `VITE_BASE_CHAIN_ID` | Vault chain id, as a decimal integer |
| `VITE_BASE_RPC_URL` | HTTP JSON-RPC endpoint for that chain |
| `VITE_VAULT_ADDRESS` | Aave USDC `PrincipalVault` address |
| `VITE_RATE_VAULT_ADDRESS` | cbETH `RateVault` address |
| `VITE_PENDLE_VAULT_ADDRESS` | PT-deJAAA `PendlePtVault` address |
| `VITE_PENDLE_APP_URL` | Pendle page the "Buy PT on Pendle" link opens (no zap) |
| `VITE_NEAR_RPC_URL` | HTTP NEAR JSON-RPC endpoint |
| `VITE_NEAR_CONNECTOR_ACCOUNT` | Connector (credit ledger) account id |
| `VITE_RHEA_VAULT_ACCOUNT` | Rhea USDC vault account id |
| `VITE_NEAR_USDC_ACCOUNT` | NEAR USDC fungible-token account |
| `VITE_NEAR_INTENTS_ACCOUNT` | NEAR Intents verifier account |
| `VITE_ONECLICK_API_URL` | Public 1Click API base URL |
| `VITE_ONECLICK_BASE_USDC_ASSET` | 1Click asset id for Base USDC |
| `VITE_ONECLICK_SLIPPAGE_BPS` | Quote slippage, basis points (0–10000) |

All of them are in the root `.env.example`. Each EVM vault's deposit-token address comes from its own `asset()`.

- **EVM wallet:** viem over the selected EIP-6963/EIP-1193 provider, with a switch to the configured chain when needed. Account changes are checked again before signing or sending.
- **Vault:** `balanceOf`, `convertToAssets`, `yieldCredited`, and the deposit token's balance and allowance are read at one Base block, for each of the three Base vaults. Amounts stay `bigint`. Deposit approves exactly the requested amount only when allowance is insufficient, waits for approval confirmation, then deposits and waits for confirmation. Redeem uses the connected holder as owner/receiver and waits for confirmation. Reverted approvals never proceed to deposit.
- **Rhea:** deposit shows a dry 1Click preview first. Confirming requests a funded quote and sends one Base USDC transfer to its deposit address; the dashboard then polls 1Click status and the vault's `position` until the deposit is activated on the vault's next cycle. Withdrawal takes two wallet signatures. The first is an EIP-191 withdrawal request the relay submits (`POST /rhea/withdraw`); the vault pays it out on its next cycle into the user's own NEAR Intents balance. The second is a transfer intent to a funded 1Click quote back to the user's Base address (`POST /intents/execute`).
- **NEAR:** plain `fetch` JSON-RPC `query`/`call_function`, `finality: final`, for `account(user)` and `debited_amount(inference_id)`. CAIP-10 addresses are lower case. U128 JSON strings are parsed directly as `bigint`; numeric money responses are rejected because they may already have lost precision. EVM users do not need a NEAR account; NEAR-wallet data operations are described below.
- **Keys:** each action uses a new EIP-4361 (EVM) or NEP-413 (NEAR) wallet proof. `GET /auth/nonce` supplies the nonce; the message binds to the dashboard host/origin, configured chain, issued-at and five-minute expiration. `POST /keys` and `/keys/revoke` send only `{message, signature}`. There is no session token or sign-in endpoint. A proof selected in step 1 is consumed by one action; subsequent create/revoke actions request another signature. Relay epoch/transaction/expiry fields are mapped to the UI types; API keys remain only in tab memory.

The relay must allow the dashboard origin through its `RELAY_WEB_ORIGIN` CORS setting. Browser RPC endpoints must also permit the dashboard origin. The live mode was verified with offline providers, not a funded wallet or deployed InferNear contracts.

## Explicitly simulated features

**Try the API remains a mock in both modes** (`isRunMock: true`) until the relay is deployed and the panel is wired to it (the relay/SDK probe itself passed live on 2026-11-12). Its reply, encryption/attestation/signature display and debit are simulated and labelled. A mock run never spends live credits, sends a prompt to the relay, or presents its synthetic debit as a NEAR read. The live `debitedAmount` method is ready for future real receipts. The bridge panel also remains a labelled, simulated dry-run quote with no deposit address.

Receipts use `source: 'signed_usage' | 'reservation'` and numeric token fields. Cost rounds the combined input/output nano-USD amount once to micro-USD, matching the relay. The bill check compares `min(signed cost, reservation)`; a reservation receipt is labelled **“charged at the reserved maximum: no usage returned”**. Reservation metadata belongs to the dashboard call result, not an extra field in the connector's receipt. Synthetic calls include their own simulated debit for the mock bill check.

## Tests and files

`npm test` uses fake EIP-1193, Base RPC, NEAR RPC and relay responses. It checks bigint precision, CAIP-10 casing, approval/deposit/redeem ABI arguments and confirmations, proof fields, session-free key requests, named errors, and bill-check arithmetic. It never sends a live transaction or contacts a network.

| Path | Purpose |
|---|---|
| `src/data/types.ts` | Shared UI contract |
| `src/data/live.ts` | Live wallet, vault, NEAR views and relay keys |
| `src/data/index.ts` | Config-based live/mock selection |
| `src/data/mock.ts` | Labelled demo data and deferred inference/bridge seams |
| `src/data/proof.ts` | EIP-4361 message fields |
| `src/data/money.ts` | Integer formatting and capped receipt arithmetic |
| `src/quickstart.ts` | Existing SDK quickstart; runtime wiring remains deferred |


## Phase 1: wallet/session and public catalogue logic

This phase adds data-layer capabilities. The existing screens still use the legacy EVM `connect()` API; connecting the chooser, NEAR screens and Vaults tab is phase 2. No deployment was performed. `Keys.tsx` has one type-only edit, narrowing its existing EVM proof state to `EvmWalletProof`; its behavior is unchanged.

Import the following from `src/data/index.ts` (or use the same methods on `data`). The wrappers select the configured live/mock source consistently:

```ts
type Session =
  | { kind: 'evm'; address: Address; user: string }
  | { kind: 'near'; accountId: string; user: string };
walletOptions(): Promise<WalletOption[]>;
connectWallet(id: string): Promise<Session>;
restoreSession(): Promise<Session | null>;
disconnect(): Promise<void>;
catalogue(session?: Session): Promise<CatalogueVault[]>;
```

`data.overview(session)` and `data.walletProof(session)` accept either wallet kind; legacy address calls remain supported. `data.deposit(session, assets, vaultId?)` and `redeem(session, shares, vaultId?)` accept EVM sessions and reject NEAR sessions. The EVM Rhea bridge methods likewise accept an EVM session or legacy address. `data.rheaDepositNear(nearSession, assets)` and `rheaWithdrawNear(nearSession, assets)` return `Promise<TxResult>` for direct native USDC calls. All amounts remain bigint base units.

Wallet discovery uses [EIP-6963](https://eips.ethereum.org/EIPS/eip-6963) announcements with ids `evm:<rdns>`, falling back to `evm:injected` only when no announced provider exists. The selected provider is pinned for subsequent EVM signing/sending; it is not replaced by `window.ethereum`. NEAR ids are `near:meteor-wallet` and `near:my-near-wallet`, using Wallet Selector mainnet without its modal. Connection requests no function-call access key. Call `restoreSession()` on load: it reconciles persisted selector accounts, including a redirect-style sign-in intent. A disconnect signs out the selected NEAR wallet or drops the local EVM selection. The selector and native call ports are injectable in tests.

NEAR user ids are `near:mainnet:<accountId>`. Their overview reads connector credits, the Rhea position/coverage/busy state, native USDC `ft_balance_of`, and `storage_balance_of`. Base entries remain present with `usable: false` and empty positions; there is no EVM account/balance lookup for a NEAR-only overview. For Rhea, `shares` is nominal principal and `principal` is its covered preview; withdrawals validate against the nominal on-chain principal. Registration is exposed as `position.rhea.usdcRegistered`.

Native deposit signs one USDC `ft_transfer_call` to the configured vault with `msg = JSON.stringify({ user })`. Native withdrawal signs the vault's `withdraw({ amount })`. Both attach exactly 1 yoctoNEAR and 100 Tgas, with an explicit signerId. Deposits below 1 USDC, above the wallet balance, and withdrawals above nominal principal or at/below zero fail before signing. Receipt failures are reported. The keeper performs the queued activation/payout; the user refreshes position to observe completion. This phase sends no storage-registration transaction automatically.

`walletProof(nearSession)` uses the wallet's `signMessage` with callbackUrl omitted. The exact canonical JSON is `JSON.stringify({ statement: "Authorize one InferNear API key action.", account_id: session.accountId, nonce: relayNonce, expires_at })`; field order is significant and expiry is current Unix seconds + 300. Its NEP nonce is `SHA256(UTF8(relayNonce))`, passed as 32 bytes to the wallet and base64 to the relay. The recipient is the dashboard origin's host, including port. The returned `{ near: { account_id, public_key, signature, message, nonce, recipient } }` goes unchanged to existing `createKey` or `revokeAll`. See [the relay interface](../docs/interfaces.md#near-wallet-key-proofs-nep-413). The relay verifies the signature and current finalized full-access-key permission. An EVM address argument still returns `EvmWalletProof`, preserving the phase-1 screens.

### Public catalogue and configuration

The catalogue requires no wallet or signature. It lists Aave USDC, cbETH RateVault, PT-deJAAA and Rhea USDC. Base deposited/cap values come from `totalSupply()` and `depositCap()` at one block; rate-vault totals/caps are labelled ETH principal and Pendle totals/caps USDC principal to distinguish them from deposit tokens. Connected principal/yield fields use the existing positions. Only Rhea advertises both wallet kinds.

Additional public `.env.example` settings:

| Setting | Purpose |
|---|---|
| `VITE_AAVE_POOL_ADDRESS` | Aave `getReserveData(USDC).currentLiquidityRate` (ray), shown as “Aave supply rate now, variable” |
| `VITE_RHEA_LEND_ACCOUNT` | Rhea `get_asset(USDC).supply_apr`, shown as “Rhea supply rate now, variable” |
| `VITE_RHEA_CAP` | USDC base-unit cap for display; the current vault exposes no total-principal/cap view, so `deposited` stays undefined |
| `VITE_RHEA_STATUS_NOTE` | If nonempty, publish Rhea as `paused` with this operator note during redeployment |

The Aave return layout follows its [backwards-compatible ReserveDataLegacy interface](https://github.com/aave-dao/aave-v3-origin/blob/main/src/contracts/protocol/libraries/types/DataTypes.sol). Protocol rates are omitted when the corresponding source is unconfigured; cbETH and Pendle never receive an invented APY. Rates use chain values and integer-only two-decimal percentage formatting. The status note describes catalogue availability and does not alter the contract or impose an on-chain withdrawal gate. Existing live configuration requirements remain unchanged. `VITE_NEAR_USDC_ACCOUNT` must name the native NEAR USDC configured on the vault.

The mock implements discovery/session/restore/disconnect, both proof shapes, independent NEAR credits and positions, direct queued deposits/withdrawals and catalogue rows. Wallet names and catalogue amount labels explicitly identify the mock. It never calls an actual wallet or chain.

### Dependencies and verification limits

Pinned additions: `@near-wallet-selector/core`, `meteor-wallet`, `my-near-wallet` all **10.1.4**; `@near-js/transactions` **2.5.1** for the selector's actual Action type; `buffer` **6.0.3** for its message nonce API. No modal package or optional HERE/HOT adapter was added. A compatible Meteor SDK override pins `nanoid` **5.1.16** to remove its reported generator vulnerabilities.

The pinned dependency tree still reports **17 npm audit findings (4 high, 13 low)**, including the old URL decoder in Meteor's `query-string` chain ([decoder advisory](https://github.com/advisories/GHSA-qr28-fpjm-wq7f)). These remain for dependency review; the requested selector versions were retained. The build also reports direct-eval warnings in the SDK's transitive `js-sha256`. No real-wallet signing, popup/redirect behavior, account restoration across actual wallets, or funded native transaction has been verified. Tests use fakes; those wallet checks remain phase-2/manual validation.
