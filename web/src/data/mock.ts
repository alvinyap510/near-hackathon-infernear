// MOCK DATA. Simulates the vault, the connector and the relay in memory so the
// UI can be built before they are wired. Every screen shows a mock indicator
// while this module is in use. The mock keeps the real invariants: spending
// touches credits only, never principal, and never exceeds what is available.
import { caip10 } from '../config.ts';
import { DataError } from './errors.ts';
import { signedUsageCost } from './money.ts';
import type {
  Address,
  Attestation,
  DashboardData,
  Model,
  Overview,
  Receipt,
  RunEvent,
} from './types.ts';

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const hex = (bytes: number) =>
  Array.from(crypto.getRandomValues(new Uint8Array(bytes)), (b) =>
    b.toString(16).padStart(2, '0'),
  ).join('');

const base64url = (text: string) =>
  btoa(text).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

const MOCK_ADDRESS: Address = '0x7a3fe91b0c25d4e8a6b13f07d2c9e58b4a1dc41e';

const MODELS: Model[] = [
  { id: 'z-ai/glm-5.3-flash', name: 'GLM-5.3 Flash', inPriceNano: 300n, outPriceNano: 1200n },
];

const MOCK_REPLY =
  'This is a mock reply. Once the dashboard is wired, the model’s answer appears here, ' +
  'decrypted in your browser with a key that never left it.';

export function createMockData(): DashboardData {
  const state = {
    walletUsdc: 2_450_000_000n,
    shares: 1_000_000_000n,
    yieldCredited: 4_213_870n,
    credited: 4_020_000n,
    spent: 342_118n,
    keyEpoch: 2,
    debited: new Map<string, bigint>(),
  };

  const overview = (address: Address): Overview => ({
    user: caip10(address),
    vault: {
      principal: state.shares, // shares are principal units, 1:1 with USDC at full coverage
      shares: state.shares,
      yieldCredited: state.yieldCredited,
      walletUsdc: state.walletUsdc,
    },
    credits: {
      credited: state.credited,
      spent: state.spent,
      available: state.credited - state.spent,
      keyEpoch: state.keyEpoch,
    },
  });

  return {
    isMock: true,

    async connect() {
      await sleep(500);
      return MOCK_ADDRESS;
    },

    async overview(address) {
      await sleep(250);
      return overview(address);
    },

    async deposit(_address, assets) {
      if (assets <= 0n) throw new DataError('amount', 'Enter an amount above zero.');
      if (assets > state.walletUsdc) throw new DataError('balance', 'That is more USDC than the wallet holds.');
      await sleep(900);
      state.walletUsdc -= assets;
      state.shares += assets;
      return { txHash: `0x${hex(32)}` };
    },

    async redeem(_address, shares) {
      if (shares <= 0n) throw new DataError('amount', 'Enter an amount above zero.');
      if (shares > state.shares) throw new DataError('balance', 'That is more than your principal.');
      await sleep(900);
      state.shares -= shares;
      state.walletUsdc += shares;
      return { txHash: `0x${hex(32)}` };
    },

    async siweChallenge(address) {
      await sleep(200);
      const { host, origin } = window.location;
      return {
        message: [
          `${host} wants you to sign in with your Ethereum account:`,
          address,
          '',
          'Sign in to InferNear to manage your API keys.',
          '',
          `URI: ${origin}`,
          'Version: 1',
          `Chain ID: ${caip10(address).split(':')[1]}`,
          `Nonce: ${hex(8)}`,
          `Issued At: ${new Date().toISOString()}`,
        ].join('\n'),
      };
    },

    async signIn() {
      await sleep(700);
      return { session: hex(24), expiresAt: new Date(Date.now() + 3_600_000).toISOString() };
    },

    async createKey() {
      await sleep(600);
      const exp = Math.floor(Date.now() / 1000) + 30 * 86_400;
      const payload = base64url(JSON.stringify({ user: caip10(MOCK_ADDRESS), epoch: state.keyEpoch, exp }));
      return {
        key: `inf_${payload}.${hex(32)}`,
        keyEpoch: state.keyEpoch,
        expiresAt: new Date(exp * 1000).toISOString(),
      };
    },

    async revokeAll() {
      await sleep(1100);
      state.keyEpoch += 1;
      return { keyEpoch: state.keyEpoch, txHash: hex(32) };
    },

    async models() {
      return MODELS;
    },

    async run({ key, model, prompt, maxTokens }, onEvent: (event: RunEvent) => void) {
      if (!key.startsWith('inf_')) throw new DataError('key', 'Create an API key first.');
      const inputBound = BigInt(Math.ceil(new TextEncoder().encode(prompt).length * 2));
      const reservation =
        (BigInt(maxTokens) * model.outPriceNano + inputBound * model.inPriceNano + 999n) / 1000n;
      if (state.credited - state.spent < reservation)
        throw new DataError('credits', 'Not enough credits for this request (402).');

      await sleep(700);
      const attestation: Attestation = {
        model: model.id,
        nonce: hex(32),
        tcbStatus: 'UpToDate',
        gpuEvidence: 'verified',
        deploymentProvenance: 'verified',
        modelSigningKey: hex(32),
        verifiedAt: Date.now(),
      };
      onEvent({ kind: 'attested', attestation });

      await sleep(500);
      onEvent({ kind: 'encrypted', ciphertext: hex(32 + 24 + prompt.length + 16) });

      await sleep(600);
      for (const word of MOCK_REPLY.split(/(?<= )/)) {
        await sleep(35);
        onEvent({ kind: 'text', delta: word });
      }

      const receipt: Receipt = {
        inferenceId: crypto.randomUUID(),
        chatId: `chatcmpl-${hex(12)}`,
        model: model.id,
        promptTokens: 9 + Math.ceil(prompt.length / 4),
        completionTokens: Math.ceil(MOCK_REPLY.length / 4),
        inPriceNano: model.inPriceNano,
        outPriceNano: model.outPriceNano,
        source: 'signed_usage',
      };
      const cost = signedUsageCost(receipt) ?? reservation;
      const charged = cost < reservation ? cost : reservation;
      state.spent += charged;
      state.debited.set(receipt.inferenceId, charged);

      return {
        text: MOCK_REPLY,
        completionId: receipt.chatId,
        attestation,
        reply: { signatureKind: 'provider_tee', signer: `0x${hex(20)}` },
        receipt,
      };
    },

    async debitedAmount(inferenceId) {
      await sleep(400);
      return state.debited.get(inferenceId) ?? null;
    },

    async bridgeChains() {
      return [
        { id: 'arb', name: 'Arbitrum' },
        { id: 'eth', name: 'Ethereum' },
        { id: 'sol', name: 'Solana' },
        { id: 'near', name: 'NEAR' },
      ];
    },

    async bridgeQuote(fromChain, amount, recipient) {
      if (amount <= 0n) throw new DataError('amount', 'Enter an amount above zero.');
      await sleep(800);
      const fee = amount / 1000n + 20_000n;
      return {
        fromChain,
        amountIn: amount,
        amountOut: amount > fee ? amount - fee : 0n,
        recipient,
        etaSeconds: 45,
        dry: true,
      };
    },
  };
}
