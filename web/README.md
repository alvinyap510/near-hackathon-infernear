# InferNear dashboard (`web/`)

The existing account dashboard, with live injected-wallet, Base vault, NEAR view and relay key routes behind `DashboardData`. Layout, styling, fonts and navigation are unchanged.

## Run and verify

Node 22.18 or newer. From this folder:

```sh
PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 npm ci --ignore-scripts
npm run dev
npm run build
npm test
```

Vite reads public `VITE_*` variables from the repository-root `.env` (`cp ../.env.example ../.env` to start). Never put a private key or relay secret in a `VITE_*` variable: Vite ships those values to the browser.

## Live mode

**All six** values below must be nonempty to select `createLiveData`; otherwise the dashboard keeps the labelled in-memory mock (`isMock: true`). A missing injected wallet or failed live request produces an error, not a fallback to invented balances.

| Variable | Meaning |
|---|---|
| `VITE_RELAY_URL` | Public relay base URL; its host/origin must match the relay's `RELAY_PUBLIC_URL` |
| `VITE_BASE_CHAIN_ID` | Vault chain id, as a decimal integer |
| `VITE_BASE_RPC_URL` | HTTP JSON-RPC endpoint for that chain |
| `VITE_VAULT_ADDRESS` | Deployed Aave USDC `PrincipalVault` address |
| `VITE_NEAR_RPC_URL` | HTTP NEAR JSON-RPC endpoint |
| `VITE_NEAR_CONNECTOR_ACCOUNT` | Deployed connector account id |

These variables already exist in the root `.env.example`; no new variable is needed. The USDC address comes from `vault.asset()`.

- **Wallet:** viem over the injected EIP-1193 provider, with a switch to the configured chain when needed. Account changes are checked again before signing or sending.
- **Vault:** `balanceOf`, `convertToAssets`, `yieldCredited`, USDC balance and allowance are read at one Base block. Amounts stay `bigint`. Deposit approves exactly the requested amount only when allowance is insufficient, waits for approval confirmation, then deposits and waits for confirmation. Redeem uses the connected holder as owner/receiver and waits for confirmation. Reverted approvals never proceed to deposit.
- **NEAR:** plain `fetch` JSON-RPC `query`/`call_function`, `finality: final`, for `account(user)` and `debited_amount(inference_id)`. CAIP-10 addresses are lower case. U128 JSON strings are parsed directly as `bigint`; numeric money responses are rejected because they may already have lost precision. No NEAR wallet/account is required from the user.
- **Keys:** each action uses a new EIP-4361 wallet proof. `GET /auth/nonce` supplies the nonce; the message binds to the relay host/origin, configured chain, issued-at and five-minute expiration. `POST /keys` and `/keys/revoke` send only `{message, signature}`. There is no session token or sign-in endpoint. A proof selected in step 1 is consumed by one action; subsequent create/revoke actions request another signature. Relay epoch/transaction/expiry fields are mapped to the UI types; API keys remain only in tab memory.

The relay must allow the dashboard origin through its `RELAY_WEB_ORIGIN` CORS setting. Browser RPC endpoints must also permit the dashboard origin. This dispatch was verified with offline providers, not a funded wallet or deployed InferNear contracts.

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
