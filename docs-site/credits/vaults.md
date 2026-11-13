# Vaults

A vault holds your deposit in a yield-bearing position. **You keep the principal; only the yield goes to InferNear**, and it comes back to you as [credits](how-credits-work.md).

::: warning Hackathon deployment, small caps
Read the risks below and [Known limits](../reference/known-limits.md) before you deposit, and start small.
:::

## The four vaults

| Vault | Chain | You deposit | Where the yield comes from | How yield is priced |
|---|---|---|---|---|
| **Aave USDC** | Base | USDC | Lending interest on Aave v3 (a growing balance) | 1 USDC = $1 |
| **cbETH** | Base | cbETH | Liquid staking: cbETH gains value against ETH | Chainlink cbETH/USD |
| **Pendle PT-deJAAA** | Base | PT-deJAAA (a USD principal token, expires 26 Nov 2026) | The PT rises toward its face value until expiry | Pendle 15-minute average price |
| **Rhea USDC** | NEAR | USDC from Base (carried by NEAR Intents), or native USDC from a NEAR wallet | Lending interest on Rhea Lend | 1 USDC = $1 |

Each vault has a deposit cap of about $10,000 and a small cushion, donated at deployment, that absorbs rounding. Contract addresses are on the [Live deployments](../reference/live-deployments.md) page.

## Deposit

1. Open the console at [app.infernear.dev](https://app.infernear.dev) and connect your wallet.
2. On **Vaults**, pick a vault. The Account tab opens with it selected.
3. Enter an amount and confirm. For a Base vault your wallet sends an approval, then the deposit.

The three Base vaults are standard ERC-4626 vaults, so you can also deposit and redeem by calling the contracts directly.

## Withdraw

Redeem from the Account tab. You receive your principal in the asset you deposited.

Two things can delay or reduce a withdrawal:

* **Liquidity.** Aave and Rhea Lend can be fully lent out for a time. You can withdraw whenever the underlying protocol has the liquidity to pay.
* **The Rhea vault works in cycles.** A withdrawal from it is queued and paid on the vault's next cycle. EVM users sign the request with their wallet and the relay pays the NEAR gas; the payout can only go to the address that owns the position.

## Risks

* **Depositors bear strategy losses, pro-rata.** If Aave, cbETH's exchange rate, the PT's backing (a Centrifuge AAA CLO note) or Rhea Lend lose value, the loss falls on depositors in proportion to their deposits. InferNear holds no reserve to cover it. Credits already granted are not taken back.
* **The Rhea vault is operator-controlled for now.** The three Base vaults have no owner, admin, pause or upgrade path. The Rhea vault keeps its deployment key during the hackathon so its code can be fixed, which means whoever holds that key could replace the code. Treat it as operator-controlled until the key is deleted.
* **The Pendle PT expires on 26 Nov 2026.** After that it stops gaining value, so the vault earns no more yield.
* **You need PT to use the Pendle vault.** It accepts and returns PT-deJAAA, not USDC. You acquire the PT separately.

## The fund-safety rules

These are enforced in the contracts and covered by their tests:

1. Principal is never spendable as credits.
2. Credits spent are never more than credits posted, per user.
3. Principal, unspent realized yield and unrealized yield always add up to the position's value, within documented rounding.
4. Your principal is yours to withdraw, less documented protocol exit costs and pro-rata strategy losses, and subject to the underlying protocol having the liquidity to pay at that moment.
