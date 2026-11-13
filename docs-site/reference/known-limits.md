# Known limits

InferNear was built in two weeks at the NEAR HACKATHON. This page lists what is not done, what has only run in tests, and what to keep in mind. It reflects the state on **13 Nov 2026**; the repository's README carries the current list.

## Not yet exercised with real funds

* **No deposit, credit purchase or credit-paid call has happened on mainnet yet.** The contracts, the relay and the console are live. Wallet sign-in, key issue and free trial calls have run against the live relay with real model replies. The first funded round trip is still to come.
* **The console's deposit and withdrawal flows have run in automated tests.** The vault contracts have also run deposit, yield and redeem on a fork of live Base. Neither has been done with real funds yet.
* **NEAR Intents routes return live quotes but have not carried funds.** See [NEAR Intents](../concepts/near-intents.md).
* **"From another chain" shows quotes only.** Sending funds from that screen is switched off in this release.

## Privacy

* **Standard mode is not private from the relay.** The relay can read the prompt and reply in transit; it stores neither. Use private mode when that matters.
* **Encryption hides content, not metadata.** In private mode a relay can still observe request size, timing and token counts.
* **The model build check is off.** The SDK verifies the model's TEE hardware attestation and signatures. NEAR's check that the model runs NEAR's published build currently rejects NEAR's own deployments, so it is left out until that is fixed. The gateway build check stays on.
* **Private inference was verified live once, by a probe**, on 12 Nov 2026, from JavaScript and Python. Reproducing it needs your own NEAR AI key.
* **In the console, private mode is code samples only.** "Try the API" sends standard-mode calls.

## Trust

* **The relay is trusted for prices and attribution.** It cannot spend principal, but it decides how yield is priced and who earned it. Both are publicly recomputable from chain data.
* **The Rhea vault keeps its deployment key during the hackathon.** Whoever holds that key could replace the vault's code. The other contracts have no owner, admin, pause or upgrade path.
* **Accounts are a relay feature, not an on-chain one.** Handles and linked wallets are kept by the relay. If that record is lost they have to be made again; no balance is affected.

## Operations

* **Free trial counts are in the relay's memory.** A restart resets each wallet's count and the daily total.
* **Every paid call is settled by its own NEAR transaction.** That costs the operator far more than the inference itself, and the ledger as funded covers about 590 paid calls. A production version would batch them.
* **A retried request is a new call.** Client idempotency keys are not implemented.
* **Contract wallets cannot create API keys.** Key sign-in supports regular EVM accounts and Meteor Wallet on NEAR.

## Vaults

* **Depositors bear strategy losses pro-rata.** InferNear holds no reserve.
* **The Pendle PT expires on 26 Nov 2026.** After that the Pendle vault earns no more yield.
* **Withdrawals depend on the underlying protocol's liquidity**, and withdrawals from the Rhea vault wait for its next cycle.
* **A fourth yield shape, staking with claimable rewards, is built and tested but not deployed.**

## Dependencies

* **The console's NEAR wallet libraries have open advisories.** `npm audit` reports high-severity findings in packages pulled in by Meteor Wallet's SDK and the NEAR JS libraries. They are not suppressed and not patched: the only fix npm offers replaces those libraries with breaking versions.
