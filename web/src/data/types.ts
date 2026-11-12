// The dashboard's view of the system. Shapes follow docs/interfaces.md; amounts
// are bigint token base units; only connector credits are micro-USD, never floats.

export type Address = `0x${string}`;
export type Session = { kind: 'evm'; address: Address; user: string } | { kind: 'near'; accountId: string; user: string };
export type SessionInput = Address | Session;
export type WalletOption = { id: string; kind: 'evm' | 'near'; name: string; icon?: string; available: boolean; installUrl?: string };
export type CatalogueVault = {
  id: string; kind: VaultKind; name: string; chainName: 'Base' | 'NEAR'; assetSymbol: string;
  yieldShape: string; strategy: string; lossNote: string; wallets: ('evm' | 'near')[];
  deposited?: string; cap?: string; rateNow?: string; yourPrincipal?: string; yourYield?: string;
  status: 'open' | 'paused'; statusNote?: string;
};

/** CAIP-10 id of the vault-share owner, address lower-cased. */
export type UserId = string;

export type VaultKind = 'aave' | 'rate' | 'pendle' | 'rhea';

/** What a depositor risks in each vault, shown in live and mock mode alike. */
export const LOSS_NOTES: Record<VaultKind, string> = {
  aave: 'Depositors bear Aave strategy losses pro-rata. Paid credits are not clawed back.',
  rate: 'Depositors bear losses pro-rata, including slashing and exchange-rate declines.',
  pendle: 'Depositors bear deJAAA/Centrifuge AAA-CLO backing losses pro-rata; PT quantity is not guaranteed USD value.',
  rhea: 'Depositors bear Rhea strategy losses pro-rata. Withdrawals queue and depend on available liquidity.',
};
export type Token = { address: string; symbol: string; decimals: 6 | 18 };
export type VaultId = string;
/** EVM principal is convertToAssets(shares), in deposit-asset base units, never dollars.
 * Rhea shares denote the nominal USDC principal claim; principal applies coverage.
 * For Rhea, walletBalance is Base USDC available to bridge and allowance is zero. */
export type VaultPosition = {
  principal: bigint;
  shares: bigint;
  /** Cumulative native yield-token units; priced credits are a separate connector read. */
  yieldCredited: bigint;
  walletBalance: bigint;
  allowance: bigint;
  rhea?: { pendingIn: bigint; pendingOut: bigint | null; coverage: bigint; busy: boolean; intentsBalance: bigint; usdcRegistered?: boolean };
};
export type VaultAccount = {
  id: VaultId;
  kind: VaultKind;
  name: string;
  chain: Chain;
  asset: Token;
  yieldToken: Token;
  unitsLabel: string;
  lossNote: string;
  /** Pendle app link to acquire PT separately; no zap. */
  buyUrl?: string;
  usable?: boolean;
  position: VaultPosition;
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
  vaults: VaultAccount[];
  /** Aave compatibility alias for the existing screen; new UI uses vaults. */
  vault: VaultPosition & { walletUsdc: bigint };
  credits: CreditAccount;
};

export type PurchaseState = { amount: string; paid?: string; hash?: `0x${string}`; status: 'submitting' | 'pending' | 'confirmed' | 'reverted' };
export type TopUpAccount = { minimum: bigint; paid: bigint; paidTotal: bigint; walletBalance: bigint; allowance: bigint; token: Address };
export const PURCHASE_NOTICE = "This is a purchase, not a deposit. The USDC goes to InferNear and cannot be redeemed.";

export type TxResult = { txHash: string };

/** Single-use EIP-4361 proof, consumed by one key action; never a session. */
export type EvmWalletProof = { message: string; signature: `0x${string}` };
export type NearWalletProof = { near: { account_id: string; public_key: string; signature: string; message: string; nonce: string; recipient: string } };
export type WalletProof = EvmWalletProof | NearWalletProof;

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
export type RunRequest = { key: string; model: Model; prompt: string; maxTokens: number; mode?: 'standard' | 'private' };

export type RunEvent =
  | { kind: 'attested'; attestation: Attestation }
  | { kind: 'encrypted'; ciphertext: string }
  | { kind: 'text'; delta: string };

export type RunResult = {
  text: string;
  completionId: string;
  mode?: 'standard' | 'private';
  attestation?: Attestation;
  reply?: ReplyVerification;
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
  minAmountOut?: bigint;
  deadline?: string;
  originToken?: Address;
  sendDisabledReason?: string;
};

export type RheaDirection = 'deposit' | 'withdraw';
/** Read-only preview is always dry and has no funding address. Amounts are USDC-6dp. */
export type RheaQuote = {
  direction: RheaDirection;
  amountIn: bigint;
  amountOut: bigint;
  minAmountOut: bigint;
  etaSeconds: number;
  deadline: string;
  dry: boolean;
  isMock: boolean;
  depositAddress?: string;
};
export type RheaTransfer = TxResult & { quote: RheaQuote };
export type RheaSwapStatus = { status: string; terminal: boolean; isMock: boolean };

/** Everything the UI reads or does. A wired implementation replaces the mock. */
export interface DashboardData {
  readonly isMock: boolean;
  readonly isRunMock: boolean;
  subscribeWallet(listener: () => void): () => void;
  topUpPurchase(session: SessionInput): Promise<PurchaseState | null>;
  reviewTopUp(session: SessionInput, settledHash?: `0x${string}`): Promise<void>;
  /** Clears a purchase record that has no transaction hash, after the user states nothing was sent. */
  setAsideUnsentTopUp(session: SessionInput): Promise<void>;
  topUpAccount(session: SessionInput): Promise<TopUpAccount | null>;
  topUp(session: SessionInput, assets: bigint): Promise<TxResult>;
  connect(): Promise<Address>;
  walletOptions(): Promise<WalletOption[]>;
  connectWallet(id: string): Promise<Session>;
  restoreSession(): Promise<Session | null>;
  disconnect(): Promise<void>;
  catalogue(session?: Session): Promise<CatalogueVault[]>;
  rheaDepositNear(session: Extract<Session, { kind: 'near' }>, assets: bigint): Promise<TxResult>;
  rheaWithdrawNear(session: Extract<Session, { kind: 'near' }>, assets: bigint): Promise<TxResult>;
  /** Four vaults plus one aggregate connector credit account. Legacy vault aliases Aave only. */
  overview(session: SessionInput): Promise<Overview>;
  /** EVM only. Omitting vaultId selects Aave for the current screen. Assets/shares are native units. */
  deposit(session: SessionInput, assets: bigint, vaultId?: VaultId): Promise<TxResult>;
  redeem(session: SessionInput, shares: bigint, vaultId?: VaultId): Promise<TxResult>;
  /** Always dry. direction withdraw previews Intents USDC -> the user's Base wallet. */
  rheaQuote(session: SessionInput, assets: bigint, direction: RheaDirection): Promise<RheaQuote>;
  /** Call only after user confirmation: create non-dry quote and transfer Base USDC once. */
  rheaDeposit(session: SessionInput, assets: bigint): Promise<RheaTransfer>;
  /** First withdrawal signature: nominal USDC claim, from the vault to the user's Intents balance.
   * Refresh overview to observe pendingOut/busy and actual intentsBalance before the second step. */
  rheaWithdraw(session: SessionInput, claim: bigint): Promise<TxResult>;
  /** Second, separately confirmed signature: quote actual Intents USDC and fund it with a transfer intent. */
  rheaExit(session: SessionInput, assets: bigint): Promise<RheaTransfer>;
  /** One status read; poll until terminal. SUCCESS for deposits still needs vault activation (pendingIn). */
  rheaStatus(depositAddress: string): Promise<RheaSwapStatus>;
  walletProof(address: Address): Promise<EvmWalletProof>;
  walletProof(session: Session): Promise<WalletProof>;
  createKey(proof: WalletProof): Promise<IssuedKey>;
  revokeAll(proof: WalletProof): Promise<Revoked>;
  models(): Promise<Model[]>;
  run(request: RunRequest, onEvent: (event: RunEvent) => void): Promise<RunResult>;
  /** Connector `debited_amount(inference_id)`, or null. */
  debitedAmount(inferenceId: string): Promise<bigint | null>;
  bridgeChains(): Promise<Chain[]>;
  bridgeQuote(fromChain: string, amount: bigint, recipient: Address): Promise<BridgeQuote>;
}
