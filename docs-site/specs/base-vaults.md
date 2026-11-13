# Base vaults

The Base vaults hold principal and pay out only yield. Each is an ERC-4626 vault built on one shared base contract, `PrincipalVault`, with a small adapter for its yield source.

| Property | Value |
|---|---|
| Source | `contracts/evm/src/` |
| Base | OpenZeppelin `ERC4626` (Contracts 5.4) |
| Owner, admin, pause, upgrade | none |
| Constructor settings | all immutable |

## The three deployed kinds

| Vault | Contract | Deposit asset | Principal and share units | Yield token |
|---|---|---|---|---|
| Aave USDC | `AaveUsdcVault` | USDC, 6 decimals | USDC base units | USDC |
| cbETH | `RateVault` | cbETH, 18 decimals | ETH wei | cbETH |
| Pendle PT-deJAAA | `PendlePtVault` | PT-deJAAA, 18 decimals | USD, scaled to 18 decimals | PT |

A fourth kind, `StakingRewardsVault` (staking with claimable rewards), is built and tested but not deployed.

## Interface

Standard ERC-4626 and ERC-20 functions and events, plus:

| Member | Kind | Meaning |
|---|---|---|
| `skim()` | external | Attribute new yield to holders and pay it to `yieldRecipient`. Reverts if the payment fails |
| `unpaid()` | view | Yield attributed but not yet paid, in yield-token units |
| `paidTotal()` | view | Cumulative yield paid to `yieldRecipient` |
| `yieldCredited(address)` | view | Cumulative yield attributed to a holder, including unsettled earnings. Never decreases |
| `yieldToken()` | view | The token yield is paid in |
| `yieldRecipient()` | view | InferNear's treasury address |
| `depositCap()` | view | Maximum total shares |
| `cushion()` | view | The rounding budget kept in the vault |
| `unattributed()` | view | Cumulative yield measured while there were no shares, credited to nobody |
| `Skimmed(token, attributed, paid, acc)` | event | One per skim that attributes or pays |
| `PayFailed(reason)` | event | A best-effort payment inside a deposit, withdrawal or transfer failed. The attribution is kept |

## Accounting

* **Yield is the surplus.** Whatever the position is worth above principal, cushion and unpaid yield is yield.
* **Attribute first, pay last.** Every entry point that changes a balance attributes yield before the change and attempts the payment after it, under a reentrancy guard. A holder is credited only for yield earned while they held their shares.
* **Fractions are kept.** Per-holder entitlements are carried with a 1e36 index, so settling a holder never drops a fraction.
* **Checkable from outside.** `sum of yieldCredited + unattributed = paidTotal + unpaid`, within documented rounding.
* **The cushion.** A small donation made at deployment, which mints no shares. It absorbs the rounding of the underlying protocol.

## Losses

* `totalAssets()` excludes yield and applies coverage when the position is worth less than principal.
* While there is a deficit, new deposits and mints are disabled. Withdrawals stay open and pay each holder their covered share.
* Depositors bear strategy losses pro-rata. There is no reserve, and yield already paid is not clawed back.

## How each kind values its position

### Aave USDC

Backing is idle USDC plus `floor(scaledBalance × normalizedIncome / 1e27)`. Payments and exit maxima take the reserve's available liquidity into account.

### cbETH (`RateVault`)

Holds cbETH directly. Principal is counted in ETH: `assets × rate / 1e18`, where `rate` comes from the cbETH/ETH exchange-rate feed. The vault rejects a non-positive rate. This is the economic exchange rate, not a market price: credits are priced separately, from Chainlink's cbETH/USD feed.

### Pendle PT (`PendlePtVault`)

Uses a fixed curve that runs linearly from `c0` at deployment to 1 at expiry (26 Nov 2026, 00:00 UTC) and stays at 1 afterwards. Deposits multiply PT by the curve and redemptions divide by it, so the PT redeemed never exceeds the PT deposited. A deposit is accepted only when the spot PT rate is at or below the curve. Exits are not gated. The vault accepts and returns PT, not USDC.

## Underlying addresses on Base

| Component | Address |
|---|---|
| USDC | `0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913` |
| Aave pool | `0xA238Dd80C259a72e81d7e4664a9801593F98d1c5` |
| aUSDC | `0x4e65fE4DbA92790696d040ac24Aa414708F5c0AB` |
| cbETH | `0x2Ae3F1Ec7F1F5012CFEab0185bfc7aa3cf0DEc22` |
| cbETH/ETH exchange-rate feed | `0x868a501e68F3D1E89CfC0D22F6b22E8dabce5F04` |
| PT-deJAAA market | `0x6c23193128f7907a3570234a6f6f1c2932f1e84b` |
| PT-deJAAA | `0xbb4fa06ea64e777c037aad9db404643100584b3d` |
| Pendle oracle | `0x5542be50420E88dd7D5B4a3D488FA6ED82F6DAc2` |

The vault addresses themselves are on [Live deployments](../reference/live-deployments.md).

## Credit top-up

`CreditTopUp` sells credits for USDC. It is not a vault.

| Member | Meaning |
|---|---|
| `pay(amount, beneficiary)` | Moves `amount` USDC from the caller straight to `recipient` and adds it to `paid[beneficiary]` and `paidTotal`. Reverts below `minimum` or for the zero address |
| `paid(beneficiary)` | Cumulative USDC paid for a beneficiary. Only grows |
| `paidTotal()` | Sum of `paid` over all beneficiaries |
| `usdc()`, `recipient()`, `minimum()` | Immutable settings. The deployed minimum is 1 USDC |
| `Paid(payer, beneficiary, amount)` | Emitted by every payment |

The contract never holds tokens, and nothing can be redeemed. USDC sent to it directly, instead of through `pay`, earns no credits and cannot be recovered. The keeper posts `paid(beneficiary)` to the ledger at 1 USDC = $1.
