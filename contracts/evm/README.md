# EVM principal vault (phase 1)

Foundry contracts for a principal-only ERC-4626 vault and an Aave v3 USDC adapter on Base. There is no owner, pause, upgrade, or principal-sweeping method. This component attributes yield and sends USDC to the fixed treasury; the NEAR connector and keeper provide API credits separately.

## Build and test

Prerequisites: Node.js/npm and Foundry (`forge`/`cast`; verified with Forge 1.5.1). From the monorepo root:

```sh
cd contracts/evm
PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 npm ci --ignore-scripts
forge build
forge build --offline
env -u FORK_RPC_URL forge test --offline
forge fmt --check
```

The first install/build downloads locked dependencies and Solidity 0.8.30. Subsequent build/test commands above need no network. For an existing compiler binary, Foundry also accepts `FOUNDRY_SOLC=/path/to/solc-0.8.30`.

The default suite uses **mock USDC, a mock Aave pool, and a configurable scaled aToken/index and rounding policy**. It covers deposits, mints, transfers, exits, losses, failed payouts, deployment seeding, and 1e36 attribution. Four stateful invariants run 128 sequences of 64 calls each: principal coverage, USDC flow (including index gains/losses and protocol rounding), yield buckets, and scaled entitlements. The coverage invariant limits strategy losses to surplus; separate unit tests exercise insolvency, pro-rata exits, and total loss.

Fork tests skip when `FORK_RPC_URL` is unset or empty. To run only the read-only Base fork suite, export a Base mainnet RPC URL first:

```sh
forge test --offline --match-contract AaveUsdcVaultForkTest -vv
```

The fork tests use addresses from the pinned `@bgd-labs/aave-address-book` dependency. They test 30-day accrual followed by full redemption, 32 consecutive daily skims, deployed revisions, and mint/burn/balance rounding. They change time and balances only inside the local fork VM and send no transactions to Base.

## Accounting and limits

Shares and principal units are USDC base units (6 decimals), 1:1 when solvent. Yield is excluded from `totalAssets()`. During a deficit, conversions apply pro-rata coverage and new deposits/mints are disabled. At zero backing, asset output is zero and converting a positive asset amount to shares reverts `ZeroBacking`; zero converts to zero. Zero-supply conversions are 1:1.

Every balance change first measures surplus above principal, the cushion, and already-attributed unpaid yield. `_update` only settles the 1e36 index, preserving fractional holder entitlements. `yieldCredited` includes unsettled earnings. Zero/self transfers skip attribution. Pre-deposit donations are treasury-owned and receive no user attribution. Index dust is less than 1 USDC base unit per skim when total shares are below 1e36; integer views additionally truncate less than 1 base unit per holder. Configure the deposit cap well below that bound.

Payment runs in an external self-only `_pay` frame under the entry point's reentrancy guard. Deposit/exit/transfer catches payment failure and emits `PayFailed`; public `skim()` propagates it. Unpaid yield is junior to principal, and payment is capped by surplus and available reserve liquidity. A post-payment coverage assertion rolls back any payout that would consume principal. Insufficient gas in the self-call can delay payment; retry `skim()` with enough gas. An exit still depends on Aave liquidity and protocol availability.

`heldAssets` includes idle USDC plus `floor(scaledBalance × normalizedIncome / 1e27)`. Supply floors scaled mint amounts; withdrawal ceils scaled burns on the verified deployment. Each such operation can consume up to `ceil(index / 1e27)` USDC base units of rounding budget. The 10,000-base-unit example cushion is $0.01, replenished by later yield; this is a finite budget, not a guarantee across arbitrarily many operations or protocol losses. Fork redemption checks allow `operations × cushion`; the verified 100 USDC round trip returned all 100 USDC. Strategy loss is not covered by this budget.

**Known liquidity ordering limitation:** a skim-first exit can revert even when idle plus reserve liquidity initially covers its principal: the preceding yield payment can consume some of that liquidity. The transaction rolls back completely, preserving balances. `testSkimFirstPaymentCanConsumeExitLiquidity` reproduces this with 100 USDC principal, 10 USDC yield, and exactly 100 USDC available. Resolving it requires reserving exit liquidity or changing payment order; the current implementation follows the specified skim-first order.

The abstract hooks are `_unitsFor`/`_assetsFor` (OZ `Math.Rounding`), `_heldAssets`, `_payableYield`, `_invest`, `_divest`, `_payYield`, and `yieldToken`. `_freeYield` is virtual so a later separate-reward staking adapter can measure its reward token. Only Aave/USDC is implemented here. `_payableYield` uses that name because `payable` is a Solidity keyword.

## Deployment configuration

Set the `contracts/evm` section in the monorepo `.env.example` through your environment: `EVM_USDC`, `EVM_AAVE_POOL`, `EVM_AUSDC`, `EVM_YIELD_RECIPIENT`, `EVM_CUSHION`, `EVM_DEPOSIT_CAP`, and `EVM_DEPLOYER_PRIVATE_KEY`. All constructor values are immutable. The cap is in total shares, in USDC base units, and must be chosen by the operator.

`script/Deploy.s.sol` creates the vault, then donates the cushion from the deployer's USDC before any intended user deposit. The deployer must hold that USDC. The deployment unit test runs this script in the local VM and verifies zero initial shares/credits and a funded cushion. **No deployment was broadcast.**

## Verified Base integration

Observed at fork block **53,506,521**: pool revision **11** (Aave v3.7), aToken revision **5**, liquidity index **1152502951373223403646683658**. Revisions and rates can change; the fork test prints its observed block and values.

| Component | Address (reference only; constructor uses env) |
|---|---|
| Pool proxy | `0xA238Dd80C259a72e81d7e4664a9801593F98d1c5` |
| USDC | `0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913` |
| aUSDC | `0x4e65fE4DbA92790696d040ac24Aa414708F5c0AB` |

[Aave's address book](https://github.com/aave-dao/aave-address-book/blob/main/src/AaveV3Base.sol) supplies the proxy and asset addresses. The pinned npm snapshot's implementation address is older than the observed proxy implementation; the adapter calls the proxy. [Aave's v3.7 changelog](https://github.com/aave-dao/aave-v3-origin/blob/v3.7.0/docs/3.7/Aave-v3.7-changelog.md) identifies revision 11. [TokenMath](https://github.com/aave-dao/aave-v3-origin/blob/v3.7.0/src/contracts/protocol/libraries/helpers/TokenMath.sol) specifies floor mint/balance and ceil burn; the fork tests verify these against the deployment. The `aave-v3-origin` npm dependency supplies address-book Solidity types only, not a local pool implementation.
