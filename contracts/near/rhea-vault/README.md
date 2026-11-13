# Rhea USDC vault

A fixed-configuration NEAR vault for Base EVM-wallet users and native NEAR accounts. Deposits queue before becoming principal; EIP-191 withdrawals pay an EVM owner's own Intents balance; native withdrawals pay the NEAR owner directly in USDC. A permissionless serialized cycle attributes yield, funds principal exits before treasury payments, and, when the plan has no exits or returns, supplies remaining idle cash to Rhea after any treasury payment in the same run. Pending deposits are never measured as assets. The vault tracks its own cash from terminal promise results and never snapshots an FT balance during a cycle.

No owner, admin, upgrade, borrowing or busy-reset method exists. Configured USDC/Rhea/Intents/treasury accounts and the cushion, minimum and cap are immutable. Account-level full-access keys can redeploy code; the contract itself has no upgrade or migration entry point. Once those keys are deleted, code cannot be patched. Unsolicited plain FT transfers after initialization are unaccounted and stranded.

## Verified commands

Run the workspace commands in [the parent README](../README.md) first. From `contracts/near`, the following builds the **local-only** mock FT/Rhea/Intents contract and executes actual local NEAR receipts:

```sh
cargo build --offline --locked --manifest-path rhea-vault/test-contracts/mock/Cargo.toml --target-dir target/mock --target wasm32-unknown-unknown --release
cargo test --offline --locked -p infernear-rhea-vault --features sandbox-gas --test gas -- --nocapture
```

The test uses near-workspaces 0.24.0 and near-sandbox 2.14.0. Its first invocation may download the sandbox binary; subsequent invocations use that cache. To run without that download, provision the binary first or set the SDK's `NEAR_SANDBOX_BIN_PATH` to an installed binary. Cargo dependencies, including the mock's (`cargo fetch --locked --manifest-path rhea-vault/test-contracts/mock/Cargo.toml`), must already be fetched. The default 44 unit tests need no sandbox binary or RPC.

The three sandbox tests execute real local receipts with 300 Tgas per `run`, assert both measure views succeed, reconcile USDC cash and check terminal busy clearing. They cover the existing queue/refund and treasury→supply paths, plus direct NEAR deposits/withdrawals, mixed EVM/NEAR exits, unauthorized native deposit refunds, and failed native exits/returns followed by retry. The old **5 Tgas asset call fails** against the heavy fixture, reproducing the original view-budget defect.

The mock asset response includes pool shares/balances, `config`, beneficiaries and farms/rewards, modeled on a read-only mainnet response of **1,372 bytes** at block 224,200,469. Its returned bodies are **1,531–1,605 bytes**; account responses are **157–618 bytes**. The fixture also performs synthetic hash work to emulate computation absent from a simple map mock: 3 Tgas minimum for an empty account and 6 Tgas for a populated account/asset, before final serialization. **This is a stress fixture, not Rhea's implementation or a mainnet gas measurement.** Sandbox receipts burned **3.970–3.990 Tgas** for empty accounts, **7.051–7.060 Tgas** for populated accounts and **7.188–7.298 Tgas** for assets, all below their 20 Tgas allowances.

Measured sandbox total gas (all `run` calls prepaid **300 Tgas**):

| Scenario | Gas burnt | Receipts |
|---|---:|---:|
| interest + activated deposit -> treasury -> supply | 35,758,840,028,471 | 19 |
| native + EVM activation with heavy empty views | 27,943,822,910,592 | 15 |
| further interest -> withdraw -> treasury, no idle | 34,691,119,570,656 | 19 |
| mixed holders interest payment with heavy populated views | 34,600,633,044,321 | 19 |
| native withdraw request | 2,657,073,211,493 | 1 |
| mixed EVM transfer-call + native plain exit | 43,588,777,972,936 | 25 |
| treasury -> refunded supply | 36,059,802,024,672 | 19 |
| further interest -> treasury -> retry refunded cash | 34,963,148,328,591 | 19 |
| failed native payout restores principal | 35,463,663,691,523 | 20 |
| native payout retry from retained idle | 26,530,346,537,489 | 11 |
| failed native cap return retains pending cash | 26,325,216,984,468 | 12 |
| native cap return retry | 26,375,455,989,084 | 11 |
| K=10 returns + K=10 exits | 58,686,690,905,143 | 29 |
| K=10 activations -> withdraw -> failed treasury -> supply | 52,064,534,253,803 | 28 |
| K=10 returns + treasury | 45,990,833,992,809 | 25 |
| direct returns/full refunds | 49,552,439,426,923 | 27 |

The treasury/supply resolver burned **2,814,061,300,401 gas** against 86 Tgas. Totals vary slightly with fixture account names/builds. Release WASM: **427,731 bytes**, SHA-256 `87f913f1ecd7dd80358d48dd97130dbc6138bd1376adc0e52042ae32e289d92c` with Rust 1.97.1, plain Cargo release (checkout paths affect panic locations). No deployment or mainnet transaction was performed for this revision.

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

All token amounts are U128 strings in USDC base units. Nonces, expiry and pagination use JSON numbers. Principal/token accounting and loss coverage are shared across both user namespaces:

- `eip155:8453:0x<40 lower-case hex>`: deposits may come from any sender (including 1Click). `request_withdraw(message, signature)` retains its exact EIP-191 message and nonce rules and **rejects native user ids**. Payouts/returned deposits use `ft_transfer_call(intents, amount, owner_address)`.
- `near:mainnet:<valid AccountId>`: named accounts and 64-hex implicit accounts are supported. Deposit with `ft_transfer_call(vault, amount, {"user":"near:mainnet:<owner>"})` from that owner; a different `sender_id` is refunded in full without allocating a record. `withdraw({"amount":"..."})` requires **exactly 1 yoctoNEAR**, derives the owner from the predecessor and takes no nonce/signature argument. It cannot access an EVM user's record. Native exits and cap/loss-rejected deposit returns use plain USDC `ft_transfer(owner, amount)` with 1 yoctoNEAR. The owner must be registered on USDC to receive it.

Both withdrawal methods use one queueing implementation: require not busy, `0 < amount <= principal`, replace an unsent request and emit `withdraw_requested {user, amount, nonce}`. Both increment the per-user nonce, and the event names the consumed nonce; for native users it is an event/request counter, not transaction authorization. A native transaction is authorized by its predecessor and 1 yoctoNEAR requirement. EVM nonces remain signature/replay checks under their separate ids.

Transfer-call results are **used** amounts. Plain FT transfer results are success/failure, so empty success consumes the full sent amount and failure consumes zero. A failed native exit therefore restores the entire principal claim, and a failed native return restores all pending cash and its queue node. All exit requests are consumed when sent/dropped; a later attempt requires another authorization. EVM partial refunds retain `floor(claim * refund / out)` restoration. Rhea withdrawals still pass `w * 1e12` internal units, and only terminal `true` adds cash.

### Gas allowances and derivation

Allowances below are prepaid **per call**, in Tgas. Mainnet burnt values are the supplied ordinary-account measurements; this revision sends no mainnet transaction.

| Call | Allowance | Basis |
|---|---:|---|
| Rhea `get_account` | 20 | Mainnet empty position 2.79 burnt; populated mainnet cost remains unmeasured. Sandbox stress receipts 3.970–7.060. |
| Rhea `get_asset` | 20 | Mainnet 5.89 burnt on the failed 5 Tgas receipt; 1.4 kB response. Sandbox stress receipts 7.188–7.298. |
| USDC `ft_transfer_call` → Rhea | 40 | Mainnet 3.12 outer + 7.23 receiver + 1.83 resolver burnt; USDC reserves **15** for its resolver. The 40 outer allowance leaves receiver margin. |
| Rhea `simple_withdraw` | 40 | Mainnet 7.56 own + 2.33 USDC transfer + 3.21 resolver burnt; Rhea reserves **10** for its resolver and forwards remaining gas to USDC. |
| USDC plain `ft_transfer` → treasury or NEAR owner | 20 | Mainnet USDC transfer 2.33 burnt, plus sandbox success/failure tests. |
| USDC `ft_transfer_call` → Intents (EVM owner) | 40 | Existing allowance retained; this revision has sandbox receiver/refund evidence, no new mainnet Intents delivery measurement. |
| Self `after_measure` | 225 | `20 + 20 + 225 = 265`, leaving 35 for root dispatch/serialization within 300. Tested with full queues/ten activations. |
| Self `after_withdraw` | 136 without exits/returns; 156 otherwise | Includes the next sends/resolver; queue branch retains capacity for one exit plus one return. |
| Self `after_send` | 86 without exits/returns; `20 + 8N` otherwise | Sole treasury resolver: 10 local + 40 supply + 20 `after_supply` + 16 receipt creation. Queue resolver uses the existing per-record budget. |
| Self `after_supply` | 20 | Existing failure/refund resolver retained; native/unit and sandbox tests. |

For principal queues, with `F = prepaid − used` at slot calculation, sends are bounded by `floor((F − 20 resolver − 20 local) / (40 max call + 8 per-record resolver + 8 creation/joining))`. Plain native transfers consume only 20, but slots conservatively use the 40-Tgas EVM maximum. An exit-free/return-free plan can send only one treasury payment; its bound is `floor((F − 86) / (20 plain call + 12 local/creation))`. The latter reserves the entire supply tail **before** payment. After measurement, `40 withdrawal + 156 callback = 196`, leaving 29 for planning/dispatch; without queues, `20 treasury + 86 callback = 106` fits the 136-Tgas withdrawal resolver with 30 to spare. `run` still requires 300 Tgas.

The mainnet withdrawal probe's [receipt graph](https://nearblocks.io/txns/E1tCJhLsxfxkJrXLXEkomkYySsfcAeVDRdWkgnxgsLJ5) was re-read without sending a transaction: with 300 Tgas on Rhea it gave USDC 281.553 Tgas and its own resolver 10. A 40-Tgas parent leaves approximately 21.553 for USDC on that same path (an inference, not a funded 40-Tgas test), above the observed 2.33 burnt. The sandbox FT uses near-contract-standards' **5-Tgas** resolver, unlike mainnet USDC's **15**; the supply/withdrawal/plain-transfer external allowances therefore still rely on the reported mainnet observations, not on equating mock costs to deployed protocol costs. Populated Rhea views and Intents delivery need continued mainnet observation.

The scaled accounting and gas-bounded sends below are part of architecture §14.3:

- **Rounding:** fractional holder entitlements and index dust are retained internally at scale 1e18. Exact conservation is `sum(scaled holder entitlement) + scaled unattributed = (paid_total + unpaid) * 1e18`; public integer views floor each value. Applying integer floors at every settlement while also adding whole-unit index dust can double-count yield: principal 3 with two 1-unit harvests is a regression fixture. Scaled carry prevents this; the public integer sum can be below paid plus unpaid.
- **Queues:** K=10 bounds entries scanned; the allowance/slot arithmetic above bounds sends. One return slot is reserved when both principal queues need sends, so a successful ten-entry return backlog drains in ten contended cycles. Each planned exit gets one funding attempt after the Rhea withdrawal. If its coverage-adjusted payout exceeds remaining idle, the request is removed and `exit_unfunded { user, claim, out }` is emitted; principal and its consumed nonce are unchanged. Only funded exits deferred for send capacity remain queued in order. Deferred returns retain their nodes across incoming deposits/refunds.

A cycle with any planned exit or return retains unused idle cash instead of re-supplying it, including when a send is dropped or deferred. A dropped exit does not wait for future accrual or liquidity: it is gone, principal is intact, and the owner must sign again at the next nonce. A new smaller request can use retained cash on the next cycle; a later request can use replenished Rhea liquidity or newly activated deposits.

A cycle with **no exits and no returns** resolves its treasury send first, then chains `supply()` whenever accounted idle remains; positive interest no longer prevents newly activated or previously refunded cash from earning yield. Treasury failure restores its cash without changing `paid_total`/`unpaid`, then that restored cash is also eligible for supply. Supply failure or partial/full refund follows the existing `after_supply` accounting and clears `busy`; it is retried on a later cycle, not recursively in the same run. With zero idle, the cycle finishes without a zero-value supply.

Stored contract, holder, totals, queue and cycle layouts are unchanged; no state migration is needed. The resolver derives plain-transfer versus transfer-call handling from the existing queued user id, rather than adding a delivery-kind field. The pre-change `test-vectors/legacy-idle-state.borsh` is a synthetic holderless state with a 1-USDC idle cushion, captured before these changes. A regression deserializes it byte-for-byte and completes a cycle with the new code.

`position` saturates its read-only scaled calculation at u128 maximum outside supported arithmetic bounds; all state-changing settlements remain checked.

The attribution event includes exact scaled split fields alongside integer floors. Callback bookkeeping and retained queue nodes reserve storage before async sends, so incoming deposits cannot consume storage needed to restore a refund. The receiver returns the full deposit when its exact new-record storage estimate cannot be funded; it allocates the whole user record at acceptance.

The holder record and holder-list entry are allocated on first accepted deposit, as required by §14.3, even if that deposit is later returned. Those records are permanent: repeated distinct 1-USDC beneficiaries can consume the vault's free storage and enlarge the keeper's paginated enumeration with zero-credit users. The receiver's storage check refunds later deposits when funding runs out. This is the accepted storage-griefing risk; moving registration to activation would introduce storage allocation inside an async callback and change the agreed acceptance rule (Flex1-3).

### Signature canonicality source

The `true` argument to `env::ecrecover` **enables rejection** of high-s signatures. The [pinned nearcore host](https://github.com/near/nearcore/blob/bc4e9e8cfb03d9e82f027883055624e18576993e/runtime/near-vm-runner/src/logic/host.rs#L1958) passes `malleability_flag != 0` to `check_signature_values`; [the crypto implementation](https://github.com/near/nearcore/blob/bc4e9e8cfb03d9e82f027883055624e18576993e/core/crypto/src/signature.rs#L941-L959) names that parameter `reject_upper` and bounds s at half the curve order when true. These are the source revisions recorded by the cached near-vm-runner/near-crypto 0.38.0 crates used by the near-sdk 5.30 tests. `flex2_2_true_malleability_flag_rejects_high_s_false_accepts_it` proves the distinction against the committed high-s twin and retains acceptance of both low-s recovery-id vectors. Passing false would weaken the specified policy.

## Deployment tooling

The vault at `rhea.infernear-ai.near` was created with this script on 12 Nov 2026, keeping its bootstrap key (`NEAR_RHEA_KEEP_KEY=true`). This revision reached it on 13 Nov 2026 as a code-only redeploy on the same account, with the stored state unchanged ([transaction](https://nearblocks.io/txns/DW2hx4izJCcMMgJ8C9h2cXaaNo2JcZAADMsnTJBu4D79)); its first cycle supplied the 1 USDC cushion to Rhea Lend ([transaction](https://nearblocks.io/txns/5K8tsb9HZNFQJDbbSj2arXd2xHjyrtxzGaK4QPTsC7oW)). The measurements above that say "this revision sends no mainnet transaction" describe the test evidence, which is unchanged.

`../scripts/deploy-rhea.mjs` reads only environment configuration listed in the NEAR section of the repository `.env.example`. It requires the configured sponsor to control the parent of a fresh vault subaccount and to hold the cushion USDC and sufficient NEAR. It creates the account, registers it on USDC/Rhea and the treasury on USDC, donates and verifies the cushion, then atomically deploys and initializes. Atomic deployment/initialization prevents someone from front-running the public initializer. It verifies idle, deletes every full-access key (the bootstrap key last), and verifies none remain. It has no recovery administrator; a script interruption before key deletion requires manual recovery with the bootstrap key.

The script refuses to proceed unless `NEAR_RHEA_WITHDRAW_VERIFIED=true`. This records the architecture's mandatory, separately authorized mainnet probe: `simple_withdraw(w * 1e12)` must resolve terminal `true` only when exactly `w` USDC base units arrived, and `false` must leave the Rhea position unchanged. No deployment, key deletion or funded round trip was performed by this revision. The earlier ordinary-account probe and existing deployment are operational evidence supplied by the owner; the new binary still requires operator redeployment and observation. No network deployment command is claimed as verified here.
