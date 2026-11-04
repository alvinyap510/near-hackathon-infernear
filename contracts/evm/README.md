# EVM principal vaults

Foundry contracts for a principal-only ERC-4626 vault with Aave USDC, Lido wstETH, Pendle PT, and separate-reward staking adapters. The last three are **built and tested, not live**; they are not wired into the USDC-only API credit path. There is no owner, pause, upgrade, or principal-sweeping method. This component attributes yield and sends USDC to the fixed treasury; the NEAR connector and keeper provide API credits separately.

## Build and test

Prerequisites: Node.js/npm and Foundry (`forge`/`cast`; verified with Forge 1.5.1). From the monorepo root:

```sh
cd contracts/evm
PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 npm ci --ignore-scripts
forge build
forge build --offline
env -u FORK_RPC_URL -u WSTETH_FORK_RPC_URL -u PENDLE_FORK_RPC_URL -u STAKING_FORK_RPC_URL forge test --offline
forge fmt --check
```

The first install/build downloads locked dependencies and Solidity 0.8.30. Subsequent build/test commands above need no network. For an existing compiler binary, Foundry also accepts `FOUNDRY_SOLC=/path/to/solc-0.8.30`.

The default suite uses **mock tokens and protocols**: an Aave pool with configurable scaled-balance rounding, a Lido rate, a Pendle market/oracle, and a StakingRewards pool. It covers deposits, mints, transfers, exits, losses, failed payouts, deployment seeding, and 1e36 attribution. Four stateful invariants run 128 sequences of 64 calls each: principal coverage, USDC flow (including index gains/losses and protocol rounding), yield buckets, and scaled entitlements. The coverage invariant limits strategy losses to surplus; separate unit tests exercise insolvency, pro-rata exits, and total loss.

Fork tests skip when `FORK_RPC_URL` is unset or empty. To run only the read-only Base fork suite, export a Base mainnet RPC URL first:

```sh
forge test --offline --match-contract AaveUsdcVaultForkTest -vv
```

The fork tests use addresses from the pinned `@bgd-labs/aave-address-book` dependency. They test 30-day accrual followed by full redemption, 32 consecutive daily skims, deployed revisions, and mint/burn/balance rounding. They change time and balances only inside the local fork VM and send no transactions to Base.

## Accounting and limits

For Aave, shares and principal units are USDC base units (6 decimals), 1:1 when solvent. The other adapters' units and yield tokens are described below. Yield is excluded from `totalAssets()`. During a deficit, conversions apply pro-rata coverage and new deposits/mints are disabled. At zero backing, asset output is zero and converting a positive asset amount to shares reverts `ZeroBacking`; zero converts to zero. Zero-supply conversions are 1:1.

Every balance change first measures surplus above principal, the cushion, and already-attributed unpaid yield. `_update` only settles the 1e36 index, preserving fractional holder entitlements. `yieldCredited` includes unsettled earnings. Zero/self transfers skip attribution. Pre-deposit donations are treasury-owned and receive no user attribution. Index dust is less than 1 yield-token base unit per skim when total shares are below 1e36; integer views additionally truncate less than 1 base unit per holder. Configure the deposit cap well below that bound.

Payment runs in an external self-only `_pay` frame under the entry point's reentrancy guard. Deposit/exit/transfer catches payment failure and emits `PayFailed`; public `skim()` propagates it. Unpaid yield is junior to principal, and payment is capped by surplus and available reserve liquidity. A post-payment coverage assertion rolls back any payout that would consume principal. Insufficient gas in the self-call can delay payment; retry `skim()` with enough gas. An exit still depends on Aave liquidity and protocol availability.

For Aave, `heldAssets` includes idle USDC plus `floor(scaledBalance × normalizedIncome / 1e27)`. Supply floors scaled mint amounts; withdrawal ceils scaled burns on the verified deployment. Each such operation can consume up to `ceil(index / 1e27)` USDC base units of rounding budget. The 10,000-base-unit example cushion is $0.01, replenished by later yield; this is a finite budget, not a guarantee across arbitrarily many operations or protocol losses. Fork redemption checks allow `operations × cushion`; the verified 100 USDC round trip returned all 100 USDC. Strategy loss is not covered by this budget.

**Payment order:** every deposit, mint, withdrawal, redemption and transfer attributes yield before balances change and pays it only after the operation, so within one transaction principal moves before any payout. `testRedeemUsesExitLiquidityBeforePayingYield` covers 100 USDC principal, 10 USDC yield and exactly 100 USDC available: the full redeem succeeds and the 10 USDC stays unpaid until a later skim. Across transactions, a payout realized earlier still reduces the reserve liquidity available to later exits.

The abstract hooks are `_unitsFor`/`_assetsFor` (OZ `Math.Rounding`), `_heldAssets`, `_payableYield`, `_invest`, `_divest`, `_payYield`, and `yieldToken`. `_freeYield` is virtual so a later separate-reward staking adapter can measure its reward token. All four shapes implement these hooks without changing the base vault. `_payableYield` uses that name because `payable` is a Solidity keyword.

## Deployment configuration

Set the `contracts/evm` section in the monorepo `.env.example` through your environment: `EVM_USDC`, `EVM_AAVE_POOL`, `EVM_AUSDC`, `EVM_YIELD_RECIPIENT`, `EVM_CUSHION`, `EVM_DEPOSIT_CAP`, and `EVM_DEPLOYER_PRIVATE_KEY`. All constructor values are immutable. The cap is in total shares, in USDC base units, and must be chosen by the operator.

The Aave-only `script/Deploy.s.sol` creates the vault, then donates the cushion from the deployer's USDC before any intended user deposit. The deployer must hold that USDC. The deployment unit test runs this script in the local VM and verifies zero initial shares/credits and a funded cushion. **No deployment was broadcast.**

## Verified Base integration

Observed at fork block **53,506,521**: pool revision **11** (Aave v3.7), aToken revision **5**, liquidity index **1152502951373223403646683658**. Revisions and rates can change; the fork test prints its observed block and values.

| Component | Address (reference only; constructor uses env) |
|---|---|
| Pool proxy | `0xA238Dd80C259a72e81d7e4664a9801593F98d1c5` |
| USDC | `0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913` |
| aUSDC | `0x4e65fE4DbA92790696d040ac24Aa414708F5c0AB` |

[Aave's address book](https://github.com/aave-dao/aave-address-book/blob/main/src/AaveV3Base.sol) supplies the proxy and asset addresses. The pinned npm snapshot's implementation address is older than the observed proxy implementation; the adapter calls the proxy. [Aave's v3.7 changelog](https://github.com/aave-dao/aave-v3-origin/blob/v3.7.0/docs/3.7/Aave-v3.7-changelog.md) identifies revision 11. [TokenMath](https://github.com/aave-dao/aave-v3-origin/blob/v3.7.0/src/contracts/protocol/libraries/helpers/TokenMath.sol) specifies floor mint/balance and ceil burn; the fork tests verify these against the deployment. The `aave-v3-origin` npm dependency supplies address-book Solidity types only, not a local pool implementation.


## wstETH — uncapped appreciation (not live)

`WstEthVault` holds Ethereum wstETH directly. Units/shares are **stETH wei**, computed with the token's native `stEthPerToken()`; redemption divides those units by the current rate. OZ `Math.Rounding` passes through both conversions. Yield is the wstETH balance above rounded-up principal, cushion, and unpaid yield, and is paid in **wstETH wei**. The cushion is wstETH wei; the cap is stETH wei. There is no wrapping, unwrapping, or external investment call.

**Loss-capable:** Lido slashing can reduce the rate. Unit tests cover a falling rate, pro-rata coverage and blocked new admissions. This module is not a no-loss USDC strategy and has not been enabled for live credit posting.

Verified unit command:

```sh
forge test --offline --match-contract WstEthVaultTest
```

For the optional Ethereum fork, export `WSTETH_FORK_RPC_URL` and `WSTETH_ADDRESS` first, then run:

```sh
forge test --offline --match-contract WstEthVaultForkTest -vv
```

The verified token is `0x7f39C581F595B53c5cb19bD0b3f8dA6c935E2Ca0`. At block 26,342,308, `stEthPerToken()` was `1248420541703429835`. Fork tests check native conversion/round-trip rounding and a locally funded token donation/payout. **A time warp alone does not create a Lido oracle rebase**; appreciation and slashing changes use an explicitly mocked rate in offline tests. [Lido's wstETH interface](https://docs.lido.fi/contracts/wsteth/) and [integration guide](https://docs.lido.fi/guides/lido-tokens-integration-guide/) describe the native rate.

## Pendle PT — capped appreciation (not live; A-004 required)

`PendlePtVault` derives its PT asset and expiry from the configured market. The fixed deployment curve is `c(t) = c0 + (1 − c0) × elapsed / duration`, rounded down and clamped to 1 at/after expiry. Units are the market's underlying-asset units; assets and yield are **PT units**. Deposits multiply PT by `c(t)`; redemptions divide units by it, so with a nondecreasing curve, redeemed PT cannot exceed deposited PT. The cushion is PT units and the cap is underlying units. The tested market uses 18 decimals for both PT and USDS.

The admission check reads `getPtToAssetRate(market, 0)` and requires it to be at most `c(t)`. It runs in `_invest` on deposit/mint, after the transfer/mint but within the same transaction: rejection rolls back both. The gate does not run on exits. Previews show the deterministic curve, while admission also depends on the live rate. There is no TWAP, live valuation oracle, swap, SY redemption, or activation switch. `c0` must be positive and at most 1e18; expiry must be in the future so the curve is defined.

**Loss-capable through the PT's SY/underlying backing. Live enablement requires Alvin's unresolved A-004 loss decision and explicit promotion.** Nominal PT accounting does not insure its underlying redemption value. A non-USDC conversion/credit path is outside this build.

Verified unit command:

```sh
forge test --offline --match-contract PendlePtVaultTest
```

For the optional fork, export `PENDLE_FORK_RPC_URL`, `PENDLE_MARKET_ADDRESS`, and `PENDLE_ORACLE_ADDRESS` first, then run:

```sh
forge test --offline --match-contract PendlePtVaultForkTest -vv
```

Verified candidate on Ethereum, from Pendle's [active market API](https://api-v2.pendle.finance/core/v1/1/markets/active) and native contract reads:

| Item | Observed value |
|---|---|
| PT-sUSDS market | `0x9c560ebaf78e596cbcc27411d633a74d628dd7dc` |
| PT | `0xdC169AbE56461A2E0c034Da431Ac2a3ebf596094` |
| Underlying denomination | USDS, 18 decimals (`SY.assetInfo()`) |
| Expiry | 2026-11-26 00:00 UTC (`1795651200`) |
| Candidate `c0` at block 26,342,308 | `996578757712811395` (about 0.99658) |
| Implied annual yield | About 6.03%; market `lastLnImpliedRate` observed as `58560539266897047`, so `exp(lnRate / 1e18) − 1` |
| Pendle PY/LP oracle | `0x5542be50420E88dd7D5B4a3D488FA6ED82F6DAc2` |

Re-read the rate at any future deployment. [Pendle's deployment registry](https://github.com/pendle-finance/pendle-core-v2-public/blob/main/deployments/1-core.json) identifies the oracle; its [oracle documentation](https://docs.pendle.finance/pendle-v2-dev/Contracts/Oracle/PYLpOracle) specifies raw-unit, 1e18-scaled rates. Duration 0 is a manipulable spot observation, used here only for the specified admission gate, never for principal valuation. The fork tests run against real PT/market/oracle contracts; maturity is advanced only in the local fork VM.

## StakingRewards — separate claimable rewards (not live)

`StakingRewardsVault` supports `stake`, `withdraw`, `balanceOf`, `earned` and `getReward`. Principal units are staking-token base units, 1:1. Backing is staked plus idle principal tokens. The constructor rejects `rewardToken == asset`; earned rewards and directly donated reward tokens are measured separately, with `free = max(earned + idleReward − unpaid, 0)`. Principal-token donations are never counted as rewards. Credits/unpaid/paid are **reward-token units**, irrespective of the staking token's decimals. Only reward tokens are claimed/sent to the treasury.

An underfunded or reverting reward claim is handled by the base's `PayFailed` frame; principal exits complete first and unpaid rewards wait. Offline tests cover claim failure and reward-transfer failure, including rollback of the claim. The pool must preserve fixed-token principal: an adapter cannot remove the selected pool's own principal-loss mechanics.

Verified unit command:

```sh
forge test --offline --match-contract StakingRewardsVaultTest
```

A suitable fixed-token-principal StakingRewards-style pool **does exist** on Ethereum: Sky's USDS→SPK pool, `0x173e314C7635B45322cd8Cb14f44b312e079F3af`. Native reads confirmed USDS staking asset `0xdC035D45d973E3EC169d2276DDab16f1e407384F`, SPK reward `0xc20059e0317DE91738d13af027DfC4a50781b066`, and unpaused staking. The [Sky chainlog](https://chainlog.sky.money/api/mainnet/active.json) lists it as `REWARDS_USDS_SPK`. Its [StakingRewards source](https://github.com/sky-ecosystem/endgame-toolkit/blob/master/src/synthetix/StakingRewards.sol) has no principal slashing/exit fee and prevents admin recovery of the staking token; withdrawals are not subject to its stake pause. This is a fixed-token accounting property, not insurance against token or contract failure.

For the optional fork, export `STAKING_FORK_RPC_URL` and `STAKING_POOL_ADDRESS` first, then run:

```sh
forge test --offline --match-contract StakingRewardsVaultForkTest -vv
```

At block 26,342,308 the fork staked 100 USDS, advanced one hour locally, paid `23571828277981200` SPK base units, and redeemed all 100 USDS. Future reward rates/programmes can change or finish; the test permits zero earned rewards but always checks principal withdrawal. No reward-funding transaction, deployment, or mainnet write was broadcast.
