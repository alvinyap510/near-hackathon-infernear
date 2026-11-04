// The dashboard's view of the system. Shapes follow docs/interfaces.md; amounts
// are bigint base units (USDC wei = micro-USD in v1), never floats.

export type Address = `0x${string}`;

/** CAIP-10 id of the vault-share owner, address lower-cased. */
export type UserId = string;

/** PrincipalVault views on the vault chain, for one holder. */
export type VaultPosition = {
  /** `convertToAssets(balanceOf(user))`: what a full redeem returns now. */
  principal: bigint;
  shares: bigint;
  /** `yieldCredited(user)`: cumulative yield attributed to the holder. */
  yieldCredited: bigint;
  /** The holder's USDC wallet balance, for deposit. */
  walletUsdc: bigint;
  /** USDC approved for this vault. */
  allowance: bigint;
};

/** Connector `account(user)` on NEAR, in micro-USD. */
export type CreditAccount = {
  credited: bigint;
  spent: bigint;
  available: bigint;
  keyEpoch: number;
};

export type Overview = {
  user: UserId;
  vault: VaultPosition;
  credits: CreditAccount;
};

export type TxResult = { txHash: string };

/** Single-use EIP-4361 proof, consumed by one key action; never a session. */
export type WalletProof = { message: string; signature: `0x${string}` };

export type IssuedKey = { key: string; keyEpoch: number; expiresAt: string };
export type Revoked = { keyEpoch: number; txHash: string };

export type Model = {
  /** Canonical NEAR AI model id. */
  id: string;
  name: string;
  inPriceNano: bigint;
  outPriceNano: bigint;
};

/** Connector `Receipt`, as emitted with each debit. */
export type Receipt = {
  inferenceId: string;
  chatId: string;
  model: string;
  promptTokens: number;
  completionTokens: number;
  inPriceNano: bigint;
  outPriceNano: bigint;
  source: 'signed_usage' | 'reservation';
};

/** The fields of the SDK's `client.verify(model)` result the Verified panel shows. */
export type Attestation = {
  model: string;
  /** Fresh 32-byte nonce, hex; the attestation cache is off. */
  nonce: string;
  tcbStatus: string;
  gpuEvidence: string;
  deploymentProvenance: 'verified' | 'not_checked';
  /** Quote-bound model key that the prompt is encrypted to. */
  modelSigningKey: string;
  verifiedAt: number;
};

/** The SDK's `client.verifyResponse(id)` result. */
export type ReplyVerification = {
  signatureKind: 'provider_tee' | 'gateway';
  signer: string;
};

/** The quickstart's call, made from the browser with the user's key. */
export type RunRequest = { key: string; model: Model; prompt: string; maxTokens: number };

export type RunEvent =
  | { kind: 'attested'; attestation: Attestation }
  | { kind: 'encrypted'; ciphertext: string }
  | { kind: 'text'; delta: string };

export type RunResult = {
  text: string;
  completionId: string;
  attestation: Attestation;
  reply: ReplyVerification;
  receipt: Receipt;
  /** Worst-case micro-USD reserved at admission, using that call's price snapshot. */
  reservation: bigint;
  /** Present only for the explicitly simulated run; never presented as a NEAR read. */
  simulatedDebit?: bigint;
};

export type Chain = { id: string; name: string };

/** A 1Click quote that delivers USDC to the user's own vault-chain address. */
export type BridgeQuote = {
  fromChain: string;
  amountIn: bigint;
  amountOut: bigint;
  recipient: Address;
  etaSeconds: number;
  /** `dry: true` quotes carry no deposit address. */
  dry: boolean;
  isMock: boolean;
};

/** Everything the UI reads or does. A wired implementation replaces the mock. */
export interface DashboardData {
  readonly isMock: boolean;
  readonly isRunMock: boolean;
  connect(): Promise<Address>;
  overview(address: Address): Promise<Overview>;
  deposit(address: Address, assets: bigint): Promise<TxResult>;
  redeem(address: Address, shares: bigint): Promise<TxResult>;
  walletProof(address: Address): Promise<WalletProof>;
  createKey(proof: WalletProof): Promise<IssuedKey>;
  revokeAll(proof: WalletProof): Promise<Revoked>;
  models(): Promise<Model[]>;
  run(request: RunRequest, onEvent: (event: RunEvent) => void): Promise<RunResult>;
  /** Connector `debited_amount(inference_id)`, or null. */
  debitedAmount(inferenceId: string): Promise<bigint | null>;
  bridgeChains(): Promise<Chain[]>;
  bridgeQuote(fromChain: string, amount: bigint, recipient: Address): Promise<BridgeQuote>;
}
