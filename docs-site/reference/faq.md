# FAQ

## Do I need a NEAR account or NEAR tokens?

No. An EVM wallet on Base is enough to sign in, create API keys, deposit, withdraw and buy credits. Only InferNear holds NEAR and NEAR AI accounts. If you do have a NEAR account, you can sign in with Meteor Wallet instead.

## Can I use the OpenAI client I already have?

Yes. Set the base URL to `https://api.infernear.dev/v1` and use your `inf_...` key. See [Standard mode](../using-the-api/standard-mode.md).

## Can InferNear read my prompts?

In standard mode the relay can read the prompt and reply while forwarding them; it stores neither. In private mode it cannot: the prompt is encrypted on your machine to the model's TEE. See [Privacy and trust](../concepts/privacy-and-trust.md).

## Which models can I call?

NEAR AI Cloud's attested TEE chat models. `GET /v1/models` lists them with prices. There are no OpenAI or Anthropic models. See [Models and pricing](../using-the-api/models-and-pricing.md).

## What happens to my deposit?

It stays yours. A vault puts it into a yield-bearing position and pays only the yield to InferNear. You withdraw the principal from the console, subject to the underlying protocol having the liquidity to pay. Strategy losses, if any, fall on depositors. See [Vaults](../credits/vaults.md).

## How long until my credits show up?

* **A purchase:** about 20 minutes, once Base has finalized the payment.
* **Vault yield:** when enough has built up to be worth collecting. A small deposit can wait a while for its first credits.

## What happens when I run out of credits?

The API answers `402 insufficient_credit`. Nothing else changes: your deposit keeps earning, and calls work again as soon as new credits are posted.

## Can I get a refund on credits I bought?

No. A purchase through the top-up contract is not redeemable. If you want your money back later, deposit into a vault instead: the principal stays yours.

## Why did my call return an empty answer?

Most often a reasoning model used the whole `max_tokens` budget on thinking. Raise `max_tokens` (the cap is 4,096).

## Why did I get `429`?

Either more than 4 of your requests were in flight at once, or an IP sent more than 30 requests in a minute to the routes that need no key.

## Can I use one API key with two wallets?

Yes. Create an [account](../accounts/accounts-and-linked-wallets.md), link the second wallet, and a key from either wallet can be charged to both.

## Is this production software?

It is a hackathon build running on mainnet with small caps. [Known limits](known-limits.md) lists exactly what is and is not done.
