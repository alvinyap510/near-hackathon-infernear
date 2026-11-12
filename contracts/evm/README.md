# Base principal vaults

The live deployment set is **Aave USDC**, **RateVault with cbETH**, and **Pendle PT-deJAAA**, all on **Base**. This component implements and tests those vaults and prepares their deployments. **No deployment was broadcast in this change; no deployed InferNear address is claimed here.** StakingRewards remains built and offline-tested, outside the live deployment set. The Ethereum-L1-only wstETH implementation and fork fixtures have been removed.

The vaults have no owner, admin, upgrade, pause or principal-sweeping method. Users retain their covered principal claim; only surplus is paid to the immutable yield recipient. Vault counters remain in the yield token's base units. The keeper and connector handle priced credit posting separately.

## Verified build and tests

Prerequisites: Node.js/npm and Foundry (verified with Forge 1.5.1). From the monorepo root:

```sh
cd contracts/evm
npm ci --ignore-scripts
forge build
forge fmt --check
env -u FORK_RPC_URL -u RATE_FORK_RPC_URL -u PENDLE_FORK_RPC_URL forge test --offline
```

Installation and the first compiler download need network access; subsequent offline tests use local mocks. The env-driven deployment scenarios run sequentially in one test because `vm.setEnv` is process-wide. Forks read the fixed public addresses/block from `test/fixtures/base.json`, so deployment fixtures cannot overwrite them. The suite covers rounding, caps, attribution before ownership changes, payment after operations, payout failures, pro-rata coverage under loss, and deployment/cushion seeding. Four stateful accounting invariants run 128 sequences of 64 calls: principal coverage in the surplus-loss domain, per-token flow, yield buckets and scaled entitlements. Deficit/zero-backing paths have separate unit tests. New rate tests cover 8/18/20-decimal feeds, rising/falling rates, invalid answers and the deliberate absence of a freshness gate.

The new Base fork suites skip unless their RPC envs are set. The following verified command uses **pinned Base block 53,524,164** for both cbETH and PT-deJAAA:

```sh
env RATE_FORK_RPC_URL=https://mainnet.base.org \
  PENDLE_FORK_RPC_URL=https://mainnet.base.org \
  forge test --offline --match-path test/YieldShapes.fork.t.sol -vv
```

Fork tests fund balances only inside the local VM. cbETH tests read the real exchange-rate feed, deposit, skim and measure tokens received on full redemption to a separate receiver. A locally funded donation exercises nonzero payout; time warp alone does not advance the historical feed. Pendle tests cover the actual gate, mid-curve skim, maturity clamp and measured redemption. No transaction is sent to Base.

## Base addresses and units

Production constructors and the deployment script use env inputs. Aave fork fixtures use the pinned address-book dependency; the new Base forks read the public address/block fixture in `test/fixtures/base.json`.

| Vault | Deposit asset | Principal/share units | Yield/cushion units |
|---|---|---|---|
| AaveUsdcVault | USDC, 6 decimals | USDC base units | USDC base units |
| RateVault | cbETH, 18 decimals | ETH wei | cbETH wei |
| PendlePtVault | PT-deJAAA, 18 decimals | USDC-scaled18 | PT wei |

| Component | Base address |
|---|---|
| USDC | `0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913` |
| Aave pool | `0xA238Dd80C259a72e81d7e4664a9801593F98d1c5` |
| aUSDC | `0x4e65fE4DbA92790696d040ac24Aa414708F5c0AB` |
| cbETH | `0x2Ae3F1Ec7F1F5012CFEab0185bfc7aa3cf0DEc22` |
| cbETH/ETH economic exchange-rate feed | `0x868a501e68F3D1E89CfC0D22F6b22E8dabce5F04` |
| PT-deJAAA market | `0x6c23193128f7907a3570234a6f6f1c2932f1e84b` |
| PT-deJAAA | `0xbb4fa06ea64e777c037aad9db404643100584b3d` |
| Pendle PY-LP oracle | `0x5542be50420E88dd7D5B4a3D488FA6ED82F6DAc2` |

**Aave:** conservative backing is idle USDC plus `floor(scaledBalance × normalizedIncome / 1e27)`. Yield is surplus above principal, cushion and unpaid yield. Payments and exit maxima account for available reserve liquidity. The adapter assumes that valuation remains conservative after protocol upgrades; re-check it against the deployed pool/aToken revisions. The fork prints those revisions and verifies mint/burn/balance rounding. Aave operations can consume up to `ceil(index / 1e27)` base units of rounding budget each. The example 10,000-USDC-base-unit cushion is $0.01, a finite budget refilled by later yield.

**RateVault:** constructor-fixed asset and `IExchangeRateFeed` address. `_rate()` reads `latestRoundData`, rejects `answer <= 0`, and normalizes the constructor-read feed decimals to 1e18 with `Math.mulDiv`. A positive answer that rounds to zero is also rejected because inverse conversion needs a nonzero denominator. cbETH principal units are `assets × rate / 1e18` ETH wei; inverse conversion returns cbETH. The token is held directly. This is an **economic exchange-rate** feed, not the cbETH/USD market-price feed used for credits. There is deliberately **no freshness gate**: timestamps/round age are not admission conditions, per the deployment policy. Delayed updates shift attribution timing; the offline suite explicitly accepts an old timestamp. At the pinned block the normalized rate was `1143299420807401681`.

**Pendle:** contract math and gate are retained. The fixed curve runs linearly from `c0` at deployment to 1 at expiry, clamped thereafter. Deposits multiply PT by the curve; redemptions divide principal units by it, so redeemed PT is bounded by deposited PT. Deposit/mint requires the spot `getPtToAssetRate(market, 0)` to be at most the curve; a rejected `_invest` rolls back transfers/mints. Exits do not run the gate. The deploy script reads that spot rate for `c0`; it does not add a manual override. At the pinned block, `c0` was `997201215082272248`. Expiry is **2026-11-26 00:00 UTC** (`1795651200`). Users acquire PT separately; the vault accepts and returns PT, not USDC. The SY/issuer redemption path and its settlement constraints remain external to this vault.

## Accounting, losses and payout gas

**Depositors bear strategy losses pro-rata.** There is no reserve/compensation and already paid yield/credits are not clawed back. This includes Aave losses, falling LST exchange rates and PT's Centrifuge/SY/CLO backing risk. Nominal PT quantity accounting does not insure the underlying's redemption value.

`totalAssets()` excludes yield and applies coverage under a deficit. New deposits/mints are disabled under a deficit. Zero-backing shares can still redeem for zero assets; converting positive assets into shares then reverts `ZeroBacking`. Maxima respect the covered claim and liquidity where external positions are involved. They do not bypass protocol/token restrictions.

Every balance-changing entry point attributes yield first and attempts payment last under its reentrancy guard. Per-holder fractional entitlements are retained with the 1e36 index; `yieldCredited` includes unsettled earnings. Zero/self transfers skip attribution. `unattributed()` exposes cumulative yield measured at zero supply, making `sum(attributed) + unattributed = paidTotal + unpaid` externally checkable. Index dust is below one yield-token base unit per skim when total shares are below 1e36; integer holder views additionally truncate below one base unit each.

With enough gas, a reverting payout emits `PayFailed`, retains unpaid attribution and leaves the operation intact. An entry point must carry enough gas for its payout attempt: a starved self-call can leave insufficient gas for the outer frame to return, reverting the whole transaction. Retry with more gas; the keeper's public `skim()` is the deferred payment path and propagates payment failure. The coverage `assert` remains; Solidity 0.8 reports `Panic(0x01)` without inherently consuming the frame's remaining gas.

## Credit top-up

`src/CreditTopUp.sol` sells credits for USDC. `pay(amount, beneficiary)` moves the caller's USDC straight to the immutable recipient and adds `amount` to `paid[beneficiary]` and `paidTotal`; it emits `Paid(payer, beneficiary, amount)`. **It is a purchase, not a deposit: nothing can be redeemed**, the contract never holds tokens, and it has no owner, admin, pause or upgrade path. The keeper posts `paid(beneficiary)` to the NEAR ledger at 1 USDC = 1 USD of credits. Eight tests cover exact delivery to the recipient, accumulation, paying for another address, rejected zero inputs, a failed transfer recording nothing, and a fuzzed check that recorded credits equal the USDC the recipient received.

`script/DeployTopUp.s.sol:DeployTopUp.run()` reads `EVM_USDC`, `EVM_YIELD_RECIPIENT` and `EVM_DEPLOYER_PRIVATE_KEY`. It moves no tokens.

## One deployment script, three kinds

`script/Deploy.s.sol:Deploy.run()` reads **`EVM_VAULT_KIND=aave|rate|pendle`**. Common env inputs are `EVM_YIELD_RECIPIENT`, `EVM_CUSHION`, `EVM_DEPOSIT_CAP`, `EVM_DEPLOYER_PRIVATE_KEY`. The cap is in principal/share units from the table; the cushion is in deposit-asset base units. The operator chooses the cap and must fund the deployer with the cushion asset.

- `aave`: `EVM_USDC`, `EVM_AAVE_POOL`, `EVM_AUSDC`.
- `rate`: `RATE_ASSET_ADDRESS`, `RATE_FEED_ADDRESS`.
- `pendle`: `PENDLE_MARKET_ADDRESS`, `PENDLE_ORACLE_ADDRESS`; PT/expiry come from the market and `c0` is read from the oracle.

The script deploys one selected vault, then donates its cushion before any intended user deposit; that donation mints no shares. Unknown kinds are rejected. All constructor settings are immutable. Deployment, initial zero shares/credits, first deposits and feed/curve selection are verified entirely in the local VM:

```sh
forge test --offline --match-contract DeployTest
```

The operator performs any broadcast; the script has not been run with a broadcast flag. `StakingRewardsVault` retains its separate-token constructor check, principal backing and offline tests, with no branch in this Base deployment script.
