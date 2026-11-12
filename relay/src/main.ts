import { setTimeout as sleep } from 'node:timers/promises';
import type { Hex } from 'viem';
import { nearConnector } from './adapters/near.ts';
import { evmPorts, type EvmVaultConfig, type BridgeToken } from './adapters/evm.ts';
import { Auth } from './gateway/auth.ts';
import { Gateway } from './gateway/ledger.ts';
import { createRelayServer } from './gateway/server.ts';
import { SignedRequests } from './gateway/signed.ts';
import { Upstream } from './gateway/upstream.ts';
import { Keeper } from './keeper/keeper.ts';
import { reportError, type Report } from './types.ts';

const required = (key: string): string => { const value = process.env[key]; if (!value) throw new Error(`Missing ${key}`); return value; };
const integer = (key: string): number => { const value = Number(required(key)); if (!Number.isSafeInteger(value) || value < 1) throw new Error(`Invalid ${key}`); return value; };
const report: Report = (event, details) => console.log(JSON.stringify({ event, ...details }));
async function main() {
  const publicUrl = required('RELAY_PUBLIC_URL');
  const chainId = integer('BASE_CHAIN_ID');
  const rheaVault = required('RHEA_VAULT_ACCOUNT'), intents = required('NEAR_INTENTS_ACCOUNT');
  // A vault transaction is sent only once the yield it realizes is worth at least this many micro-USD.
  const minYieldMicro = BigInt(integer('KEEPER_MIN_YIELD_MICRO_USD'));
  const connector = await nearConnector({ rpc: required('NEAR_RPC_URL'), contract: required('NEAR_CONNECTOR_ACCOUNT'),
    gatewayAccount: required('NEAR_GATEWAY_ACCOUNT'), gatewayKey: required('NEAR_GATEWAY_PRIVATE_KEY'), keeperAccount: required('NEAR_KEEPER_ACCOUNT'), keeperKey: required('NEAR_KEEPER_PRIVATE_KEY'), relayAccount: required('NEAR_RELAY_ACCOUNT'), relayKey: required('NEAR_RELAY_PRIVATE_KEY'), rheaVault, intents,
    rheaLend: required('NEAR_RHEA_ACCOUNT'), usdc: required('NEAR_USDC_ACCOUNT'), rheaCushion: BigInt(required('NEAR_RHEA_CUSHION')), minYieldMicro });
  const gateway = new Gateway({ auth: new Auth(required('API_KEY_SECRET'), publicUrl, chainId), upstream: new Upstream(required('NEAR_AI_BASE_URL'), required('NEAR_AI_API_KEY'), Date.now, integer('RELAY_UPSTREAM_TIMEOUT_MS')),
    connector, maxTokens: integer('RELAY_MAX_TOKENS'), report });
  const ports = evmPorts({ rpc: required('BASE_RPC_URL'), chainId, key: required('TREASURY_EVM_PRIVATE_KEY') as Hex,
    vaults: JSON.parse(required('EVM_VAULTS')) as EvmVaultConfig[], fromBlock: BigInt(required('VAULT_START_BLOCK')),
    oneClickUrl: required('ONECLICK_API_URL'), oneClickToken: process.env.ONECLICK_API_TOKEN, bridgeTokens: JSON.parse(required('ONECLICK_TOKENS')) as BridgeToken[], destinationAsset: required('ONECLICK_DESTINATION_ASSET'),
    recipient: required('TREASURY_NEAR_ACCOUNT'), slippageBps: integer('ONECLICK_SLIPPAGE_BPS'), minYieldMicro });
  const keeper = new Keeper([...ports.vaults, connector.rhea], connector, ports.bridge, report, { balances: () => connector.balances(), minimum: BigInt(required('NEAR_LOW_BALANCE_YOCTO')) });
  // Wait longer than normal inclusion before accepting fresh reservations after restart.
  report('startup_wait', { seconds: 30 });
  await sleep(30_000);
  const server = createRelayServer(gateway, { publicUrl, report, allowedOrigin: required('RELAY_WEB_ORIGIN'), signedRequests: new SignedRequests(connector, { vault: rheaVault, intents, chainId }), clientIpHeader: process.env.RELAY_CLIENT_IP_HEADER || undefined, sponsoredPerDay: integer('RELAY_SPONSORED_TX_PER_DAY') });
  server.listen(integer('RELAY_PORT'), () => report('listening', { port: process.env.RELAY_PORT }));
  const retries = setInterval(() => { void gateway.retryDebits(); }, 1000);
  let stopped = false;
  void (async () => {
    while (!stopped) {
      try { await keeper.tick(); } catch (error) { reportError(report, 'keeper_retry', error); }
      await sleep(60_000);
    }
  })();
  process.once('SIGTERM', () => { stopped = true; clearInterval(retries); server.close(); });
}
void main().catch(error => { reportError(report, 'startup_error', error); process.exitCode = 1; });
