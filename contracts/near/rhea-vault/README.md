# Rhea USDC vault

A keyless, fixed-configuration NEAR vault for Base EVM-wallet users. Deposits queue before becoming principal; EIP-191 withdrawals pay the owner's own Intents balance. A permissionless serialized cycle attributes yield, funds principal exits before treasury payments, and, when the plan has no exits or returns, supplies remaining idle cash to Rhea after any treasury payment in the same run. Pending deposits are never measured as assets. The vault tracks its own cash from terminal promise results and never snapshots an FT balance during a cycle.

No owner, admin, upgrade, borrowing or busy-reset method exists. Configured USDC/Rhea/Intents/treasury accounts and the cushion, minimum and cap are immutable. Full-access keys must be deleted after deployment. Unsolicited plain FT transfers after initialization are unaccounted and stranded. A code bug that strands `busy` cannot be patched on a keyless account; this risk requires review before using real funds.

## Verified commands

Run the workspace commands in [the parent README](../README.md) first. From `contracts/near`, the following builds the **local-only** mock FT/Rhea/Intents contract and executes actual local NEAR receipts:

```sh
cargo build --offline --locked --manifest-path rhea-vault/test-contracts/mock/Cargo.toml --target-dir target/mock --target wasm32-unknown-unknown --release
cargo test --offline --locked -p infernear-rhea-vault --features sandbox-gas --test gas -- --nocapture
```

The test uses near-workspaces 0.24.0 and near-sandbox 2.14.0. Its first invocation may download the sandbox binary; subsequent invocations use that cache. To run without that download, provision the binary first or set the SDK's `NEAR_SANDBOX_BIN_PATH` to an installed binary. Cargo dependencies, including the mock's (`cargo fetch --locked --manifest-path rhea-vault/test-contracts/mock/Cargo.toml`), must already be fetched. The default 37 unit tests need no sandbox binary or RPC.

The two sandbox tests check actual local receipts, gas, cash reconciliation and terminal busy clearing. The queue test retains ten returns plus ten exits with limited Rhea liquidity (one paid, nine dropped), ten returns plus a treasury payment, and three direct full refunds. The supply regression starts with existing supplied principal, activates a new deposit alongside fresh interest, and checks the actual treasury token balance, Rhea supplied balance and zero remaining idle. It repeats interest, refunds a supply and retries that cash after another harvest. Its longest branch activates ten deposits, withdraws from Rhea, handles a deliberately failed treasury transfer and supplies the restored cash. The failure is confined to the mock FT receipt; the final supply resolver succeeds and clears busy.

Measured total gas (all runs prepaid **300 Tgas**):

| Scenario | Gas burnt | Receipts |
|---|---:|---:|
| Ten returns + ten exits | 46,411,424,557,973 | 29 |
| Ten returns + treasury | 33,808,318,493,133 | 25 |
| Three direct full refunds | 37,281,357,480,992 | 27 |
| Fresh interest + activated deposit → payment → supply | 23,677,251,350,027 | 19 |
| Further interest → withdrawal → payment, zero idle | 22,609,122,805,236 | 19 |
| Payment → refunded supply | 23,973,640,182,132 | 19 |
| Further interest → payment → retry refunded cash | 22,881,536,612,979 | 19 |
| Ten activations → withdrawal → failed payment → supply | 39,843,960,901,693 | 28 |

The last treasury/supply resolver burned **2,808,090,445,994 gas** against its 106 Tgas allocation. The three-record refund resolver burned 3,473,892,676,930 gas against 44 Tgas. Totals vary slightly between builds. These mocks do not establish live USDC/Rhea gas costs or withdrawal semantics. Release WASM: **422,270 bytes**, SHA-256 `32c6c2585de38719970ebdf15c991d122abb0e9a25be0a5c339c50bfc76da179` with the documented Rust 1.97.1 plain Cargo release build (checkout paths affect panic locations).

The unit model independently tracks mock USDC cash, Rhea supply, Intents deliveries and treasury receipts, and executes callbacks with the gas recorded in their scheduled receipts. It covers every receiver rejection, storage allocation, cap and loss handling, replacement/replay/domain/signature checks, v27/v28 known vectors, partial/full refunds, duplicate callbacks, failed views/withdrawal/supply/sends, zero exits, decimal conversion, concurrency with incoming deposits, cash conservation and scaled yield conservation. Generated wallet identities are public synthetic fixtures; never fund them.

To regenerate committed vectors using the deployment tools' pinned viem dependency, these commands were verified from `contracts/near`:

```sh
cd scripts
npm ci --offline --ignore-scripts
node ../rhea-vault/scripts/generate-vectors.cjs .
node --check deploy-rhea.mjs
```

A fresh clone needs an initial online `npm ci` to populate its package cache. No browser is used.

## Interface and accounting

[interfaces.md](../../../docs/interfaces.md) defines the exact public methods, signed message, views and events. All token amounts are U128 strings in USDC base units; nonce, expiry and pagination use JSON numbers. Rhea withdrawals pass `w * 1e12` internal units; only a terminal `true` adds `w` cash. Exit transfer-call results are **used** amounts. Requests are consumed when sent or dropped as unfunded; a full refund restores the claim, a partial refund restores `floor(claim * refunded / out)`, and the user signs again.

The scaled accounting and gas-bounded sends below are part of architecture §14.3:

- **Rounding:** fractional holder entitlements and index dust are retained internally at scale 1e18. Exact conservation is `sum(scaled holder entitlement) + scaled unattributed = (paid_total + unpaid) * 1e18`; public integer views floor each value. Applying integer floors at every settlement while also adding whole-unit index dust can double-count yield: principal 3 with two 1-unit harvests is a regression fixture. Scaled carry prevents this; the public integer sum can be below paid plus unpaid.
- **Gas:** `run` still requires 300 Tgas and scans K=10 entries per queue. With exits or returns, actual sends are bounded by remaining gas, reserving 20 Tgas plus 8 Tgas per sent record for resolution, 20 Tgas for local work and 8 Tgas per send for receipt creation/joining; each FT call receives 40 Tgas. Both slot calculation and resolver scheduling include the same per-record budget. One return slot is reserved when both principal queues need sends: a ten-entry return backlog drains in ten contended cycles if those transfers succeed. Each of the first K planned exits gets one funding attempt after the Rhea withdrawal. If its coverage-adjusted payout exceeds the remaining idle cash, the request is removed and `exit_unfunded { user, claim, out }` is emitted; principal and the already-consumed nonce are unchanged. The owner signs a new request, smaller or later. Only funded exits deferred for send capacity remain queued in order. Deferred returns retain their queue nodes, including across incoming deposits and refunds. Scheduling all twenty FT transfer-calls at that allocation exceeds NEAR's transaction limit. This is a concrete stuck-busy risk, not a rate or monetary limit.

A cycle with any planned exit or return retains unused idle cash instead of re-supplying it, including when a send is dropped or deferred. A dropped exit does not wait for future accrual or liquidity: it is gone, principal is intact, and the owner must sign again at the next nonce. A new smaller request can use retained cash on the next cycle; a later request can use replenished Rhea liquidity or newly activated deposits.

A cycle with **no exits and no returns** resolves its treasury send first, then chains `supply()` whenever accounted idle remains; positive interest no longer prevents newly activated or previously refunded cash from earning yield. Treasury failure restores its cash without changing `paid_total`/`unpaid`, then that restored cash is also eligible for supply. Supply failure or partial/full refund follows the existing `after_supply` accounting and clears `busy`; it is retried on a later cycle, not recursively in the same run. With zero idle, the cycle finishes without a zero-value supply.

The gas budget reserves the supply tail before scheduling treasury: its sole-record `after_send` gets 106 Tgas (10 local plus 60 for the supply call, 20 for `after_supply`, and 16 for receipt creation), with 12 Tgas reserved for remaining local send work/receipt creation. `after_measure` gets 255 Tgas; `after_withdraw` gets 168 for this branch and retains 160 for exit/return plans. The supply call and resolver keep their existing 60/20 allocations. This addresses the concrete stuck-busy risk from scheduling an unbudgeted callback chain. Stored contract, holder, totals, queue and cycle layouts are unchanged; no state migration is needed.

`position` saturates its read-only scaled calculation at u128 maximum outside supported arithmetic bounds; all state-changing settlements remain checked.

The attribution event includes exact scaled split fields alongside integer floors. Callback bookkeeping and retained queue nodes reserve storage before async sends, so incoming deposits cannot consume storage needed to restore a refund. The receiver returns the full deposit when its exact new-record storage estimate cannot be funded; it allocates the whole user record at acceptance.

The holder record and holder-list entry are allocated on first accepted deposit, as required by §14.3, even if that deposit is later returned. Those records are permanent: repeated distinct 1-USDC beneficiaries can consume the vault's free storage and enlarge the keeper's paginated enumeration with zero-credit users. The receiver's storage check refunds later deposits when funding runs out. This is the accepted storage-griefing risk; moving registration to activation would introduce storage allocation inside an async callback and change the agreed acceptance rule (Flex1-3).

### Signature canonicality source

The `true` argument to `env::ecrecover` **enables rejection** of high-s signatures. The [pinned nearcore host](https://github.com/near/nearcore/blob/bc4e9e8cfb03d9e82f027883055624e18576993e/runtime/near-vm-runner/src/logic/host.rs#L1958) passes `malleability_flag != 0` to `check_signature_values`; [the crypto implementation](https://github.com/near/nearcore/blob/bc4e9e8cfb03d9e82f027883055624e18576993e/core/crypto/src/signature.rs#L941-L959) names that parameter `reject_upper` and bounds s at half the curve order when true. These are the source revisions recorded by the cached near-vm-runner/near-crypto 0.38.0 crates used by the near-sdk 5.30 tests. `flex2_2_true_malleability_flag_rejects_high_s_false_accepts_it` proves the distinction against the committed high-s twin and retains acceptance of both low-s recovery-id vectors. Passing false would weaken the specified policy.

## Deployment script (not executed)

`../scripts/deploy-rhea.mjs` reads only environment configuration listed in the NEAR section of the repository `.env.example`. It requires the configured sponsor to control the parent of a fresh vault subaccount and to hold the cushion USDC and sufficient NEAR. It creates the account, registers it on USDC/Rhea and the treasury on USDC, donates and verifies the cushion, then atomically deploys and initializes. Atomic deployment/initialization prevents someone from front-running the public initializer. It verifies idle, deletes every full-access key (the bootstrap key last), and verifies none remain. It has no recovery administrator; a script interruption before key deletion requires manual recovery with the bootstrap key.

The script refuses to proceed unless `NEAR_RHEA_WITHDRAW_VERIFIED=true`. This records the architecture's mandatory, separately authorized mainnet probe: `simple_withdraw(w * 1e12)` must resolve terminal `true` only when exactly `w` USDC base units arrived, and `false` must leave the Rhea position unchanged. That probe, deployment, key deletion and a funded round trip **have not been run**. Syntax and action constructors were verified locally; no network deployment command is claimed as verified.
