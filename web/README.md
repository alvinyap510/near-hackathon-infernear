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

- **Wallet:** viem over the injected EIP-1193 provider, with a switch to the configured chain when needed. Account changes are checked again before signing or sending.
- **Vault:** `balanceOf`, `convertToAssets`, `yieldCredited`, and the deposit token's balance and allowance are read at one Base block, for each of the three Base vaults. Amounts stay `bigint`. Deposit approves exactly the requested amount only when allowance is insufficient, waits for approval confirmation, then deposits and waits for confirmation. Redeem uses the connected holder as owner/receiver and waits for confirmation. Reverted approvals never proceed to deposit.
- **Rhea:** deposit shows a dry 1Click preview first. Confirming requests a funded quote and sends one Base USDC transfer to its deposit address; the dashboard then polls 1Click status and the vault's `position` until the deposit is activated on the vault's next cycle. Withdrawal takes two wallet signatures. The first is an EIP-191 withdrawal request the relay submits (`POST /rhea/withdraw`); the vault pays it out on its next cycle into the user's own NEAR Intents balance. The second is a transfer intent to a funded 1Click quote back to the user's Base address (`POST /intents/execute`).
- **NEAR:** plain `fetch` JSON-RPC `query`/`call_function`, `finality: final`, for `account(user)` and `debited_amount(inference_id)`. CAIP-10 addresses are lower case. U128 JSON strings are parsed directly as `bigint`; numeric money responses are rejected because they may already have lost precision. No NEAR wallet/account is required from the user.
- **Keys:** each action uses a new EIP-4361 wallet proof. `GET /auth/nonce` supplies the nonce; the message binds to the relay host/origin, configured chain, issued-at and five-minute expiration. `POST /keys` and `/keys/revoke` send only `{message, signature}`. There is no session token or sign-in endpoint. A proof selected in step 1 is consumed by one action; subsequent create/revoke actions request another signature. Relay epoch/transaction/expiry fields are mapped to the UI types; API keys remain only in tab memory.

The relay must allow the dashboard origin through its `RELAY_WEB_ORIGIN` CORS setting. Browser RPC endpoints must also permit the dashboard origin. The live mode was verified with offline providers, not a funded wallet or deployed InferNear contracts.

## Explicitly simulated features

**Try the API remains a mock in both modes** (`isRunMock: true`) pending the relay/SDK spike. Its reply, encryption/attestation/signature display and debit are simulated and labelled. A mock run never spends live credits, sends a prompt to the relay, or presents its synthetic debit as a NEAR read. The live `debitedAmount` method is ready for future real receipts. The bridge panel also remains a labelled, simulated dry-run quote with no deposit address.

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
