# Buy credits

If you would rather not deposit, you can buy credits with USDC on Base at **1 USDC = $1 of credits**.

::: danger This is a purchase, not a deposit
The USDC goes to InferNear and cannot be redeemed.
:::

## In the console

1. Open [app.infernear.dev](https://app.infernear.dev) and connect an EVM wallet on Base.
2. On the **Account** tab, find **Add credits**.
3. Enter an amount (the minimum is 1 USDC) and confirm. Your wallet approves exactly that amount, then pays.
4. The credits appear about 20 minutes later, once Base has finalized the payment and the keeper has posted it to the NEAR ledger.

The box shows the total you have bought and the transaction hash of your purchase.

## How it works

Purchases go through the `CreditTopUp` contract on Base:

| | |
|---|---|
| Address | [`0xa62E3f3328e33DeB233C655df4f379c1bE7b03c6`](https://basescan.org/address/0xa62E3f3328e33DeB233C655df4f379c1bE7b03c6) |
| Minimum | 1 USDC |
| Call | `pay(amount, beneficiary)`, after approving the contract for `amount` of USDC |

The contract holds no funds: the USDC passes straight through to InferNear. It has no owner, admin, pause or upgrade path. It keeps a running total paid for each beneficiary, and the keeper credits each beneficiary from those totals once they are final.

`beneficiary` is the address that receives the credits. The console always uses your connected address.

## If a purchase seems stuck

A slow or missing confirmation does not mean the payment failed. Do not pay again until you have checked:

1. In the console, use **Check purchase status** in the Add credits box.
2. Look up the transaction hash on [BaseScan](https://basescan.org).
3. Compare **Total bought for you** in the console with the contract's `paid(<your address>)` on Base.

Credits always follow the on-chain total, so a purchase that was mined will be credited.
