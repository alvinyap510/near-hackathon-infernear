# Privacy and trust

This page says plainly what you are trusting when you use InferNear, and what you are not.

## Who can read your prompts

<PrivacyModes />

| | Standard mode | Private mode |
|---|---|---|
| **InferNear's relay** | Can read the prompt and reply while forwarding them. Stores neither | Sees ciphertext only |
| **NEAR AI Cloud's operators** | Cannot: the model runs inside an attested TEE | Cannot: the model runs inside an attested TEE |
| **Checked by** | NEAR AI's attestation of the model's TEE | The SDK on your machine: it verifies the attestation, encrypts to the TEE's key and checks the model's signature on the reply |

If prompt privacy from InferNear matters to you, use [private mode](../using-the-api/private-mode.md).

## What is visible even in private mode

Encryption hides content, not metadata. The relay can still observe which key made the call, which model was called, the size of the request, its timing and the token counts used for billing. Complete secrecy against an active relay is not claimed.

## What InferNear's relay is trusted for

| Trusted for | Why it is limited |
|---|---|
| **Pricing yield and attributing it to depositors** | Both can be recomputed by anyone from public chain data |
| **Reporting usage in standard mode** | Charges are recorded on NEAR with a receipt for each call: the model, token counts and prices |
| **The account registry** (handles and linked wallets) | It decides which wallets a key may charge. It cannot create credits or move principal |
| **Being available** | If the relay is down, the API is down. Deposits are unaffected: the Base vaults can be redeemed directly on chain |

## What the relay cannot do

* **Spend your principal.** Vaults pay out only yield. A withdrawal needs your wallet's signature, and exits from the NEAR vault can only go to the address that owns the position.
* **Charge more than you have.** The ledger enforces that credits spent never exceed credits posted, per user.
* **Charge one call twice.** A charge is recorded once per inference ID.

## Contracts with no admin

The three Base vaults, the credit top-up contract and the NEAR credit ledger have no owner, admin, pause or upgrade path.

**The Rhea vault is the exception.** It keeps its deployment key during the hackathon so its code can be fixed and the deployment wound down afterwards. Whoever holds that key could replace the vault's code, so treat the Rhea vault as operator-controlled until the key is deleted.

## Check the deployed code yourself

The contracts on chain are built from the public repository. [Live deployments](../reference/live-deployments.md) lists the addresses and shows how to compare the deployed code with your own build.

## Risks that are not about trust in InferNear

Depositors bear the losses of the strategy they choose. See the risks on the [Vaults](../credits/vaults.md) page.
