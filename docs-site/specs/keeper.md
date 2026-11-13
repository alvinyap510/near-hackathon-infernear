# Keeper

The keeper turns yield and purchases into credits. It reads each vault and the top-up contract at a finalized block, prices what it finds, and posts cumulative totals to the [credit ledger](credit-ledger.md). It runs in the same Node process as the [gateway](gateway.md).

| Property | Value |
|---|---|
| Source | `relay/src/adapters/`, `relay/src/keeper/` |
| Signs as | `keeper.infernear-ai.near`, with a key that may only call `post_credits` |
| Holds user funds | never |

## Reads are free, transactions are for work

Every minute the keeper reads every source. For each source it can do two things in a round: post credits, and make one vault operation (a `skim()` or a Rhea `run()`). It sends a transaction only when one of these holds:

| Source | A transaction is sent when |
|---|---|
| A Base vault | `skim()`, simulated at the latest block, would pay out yield worth at least the configured threshold |
| The Rhea vault | It has queued deposits or exits, attributed yield awaiting payout, cash it has not supplied, or unrealized yield of the threshold amount |
| Any source | Its finalized cumulative entries differ from what the ledger already holds |

If the same work is still there after a transaction, including a failed one, the keeper waits 1, 2, 4 minutes and so on, up to 6 hours, before sending again. A growing amount does not count as new work. A skim simulation that reverts sends nothing and does not hold back posting.

The threshold should be at or above the cost of one skim plus one post, so collecting yield never costs more than it earns.

## Reading a Base vault

1. Pick a recent **finalized** Base block.
2. Find every holder ever seen in the vault's `Transfer` events, including holders who have left.
3. Read `yieldCredited(holder)` for each, and the vault's `paidTotal()` and `unpaid()`, at that block.
4. Read the price source at the **same** block.

If `unpaid()` is not zero, nothing is posted for that vault in this round.

## Rates

A rate is micro-USD per 1e18 yield-token base units.

| Source | Rate | Skipped when |
|---|---|---|
| Aave USDC | `1e18` | |
| cbETH | Chainlink cbETH/USD (8 decimals), `answer / 100`, floored | The feed is older than its heartbeat, the answer is not positive, or the read fails |
| Pendle PT-deJAAA | `getPtToAssetRate(market, 900) / 1e12` from the Pendle oracle, floored: a 900-second TWAP | The rate is not positive or the read fails |
| Rhea USDC | `1e18` | The vault is busy or has unpaid yield |
| Credit top-up | `1e18` | |

The cbETH/USD market feed used here is separate from the cbETH/ETH exchange-rate feed the vault uses for its own accounting.

## Posting

Every post is this call, sent in batches of 100 entries per transaction when a vault has many holders:

```
post_credits(vault, paid_cum, rate, source_block, entries)
```

* `paid_cum` and the entries stay in the yield token's own units. The keeper sends no pre-converted credits and no remainders: the ledger does the conversion and carries the fractions.
* `rate` is an integer string and `source_block` a JSON number.
* A failed read is reported and retried the next minute. A failed transaction follows the delay above. Neither blocks other vaults.

## The credit top-up

A `topup` entry is the [credit top-up contract](base-vaults.md#credit-top-up), not a vault. Its beneficiaries come from its `Paid` events, and their credits from `paid(beneficiary)` at the same finalized block, posted at `1e18` under `paidTotal()`. Nothing is ever unpaid, and the keeper never sends it a transaction.

## The Rhea vault

The keeper pins `busy`, `unpaid`, `paid_total`, the paginated `holders` and every `position(user)` to one finalized NEAR block. It sends the gas-paying `run()` only for the work listed above.

## Treasury bridging (switched off)

The keeper can send collected yield from Base to InferNear's treasury on NEAR through NEAR Intents (1Click): above a configured minimum it asks for a quote and makes one ERC-20 transfer to the quote's deposit address. Tokens without a configured route are held. This is built and tested, and switched off in the live deployment. Treasury conversion never delays credits.

## Monitoring

The keeper reports the ledger's balance and storage, and the free NEAR balance of the relay and the Rhea vault. A low balance raises an alert. It does not add an admission gate.

## Trust

The keeper decides how yield is priced and which holder earned it. It cannot move principal, and every input it uses is public chain data at a named finalized block, so its posts can be recomputed by anyone.
