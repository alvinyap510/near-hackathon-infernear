import { setTimeout as sleep } from 'node:timers/promises';
import type { Address, Hex } from 'viem';
import { nearConnector } from './adapters/near.ts';
import { evmPorts } from './adapters/evm.ts';
import { Auth } from './gateway/auth.ts';
import { Gateway } from './gateway/ledger.ts';
import { createRelayServer } from './gateway/server.ts';
import { Upstream } from './gateway/upstream.ts';
import { Keeper } from './keeper/keeper.ts';
import type { Report } from './types.ts';

const required = (key: string): string => { const value = process.env[key]; if (!value) throw new Error(`Missing ${key}`); return value; };
const integer = (key: string): number => { const value = Number(required(key)); if (!Number.isSafeInteger(value) || value < 1) throw new Error(`Invalid ${key}`); return value; };
const report: Report = (event, details) => console.log(JSON.stringify({ event, ...details }));
const publicUrl = required('RELAY_PUBLIC_URL');
const chainId = integer('BASE_CHAIN_ID');
const connector = await nearConnector({ rpc: required('NEAR_RPC_URL'), contract: required('NEAR_CONNECTOR_ACCOUNT'),
  gatewayAccount: required('NEAR_GATEWAY_ACCOUNT'), gatewayKey: required('NEAR_GATEWAY_PRIVATE_KEY'), keeperAccount: required('NEAR_KEEPER_ACCOUNT'), keeperKey: required('NEAR_KEEPER_PRIVATE_KEY') });
const gateway = new Gateway({ auth: new Auth(required('API_KEY_SECRET'), publicUrl, chainId), upstream: new Upstream(required('NEAR_AI_BASE_URL'), required('NEAR_AI_API_KEY')),
  connector, maxTokens: integer('RELAY_MAX_TOKENS'), report });
const ports = evmPorts({ rpc: required('BASE_RPC_URL'), chainId, key: required('TREASURY_EVM_PRIVATE_KEY') as Hex,
  usdc: required('EVM_USDC') as Address, addresses: required('VAULT_ADDRESSES').split(',').map(a => a.trim() as Address), fromBlock: BigInt(required('VAULT_START_BLOCK')),
  oneClickUrl: required('ONECLICK_API_URL'), oneClickToken: process.env.ONECLICK_API_TOKEN, originAsset: required('ONECLICK_ORIGIN_ASSET'), destinationAsset: required('ONECLICK_DESTINATION_ASSET'),
  recipient: required('TREASURY_NEAR_ACCOUNT'), slippageBps: integer('ONECLICK_SLIPPAGE_BPS') });
const keeper = new Keeper(ports.vaults, connector, ports.bridge, report);
// Wait longer than normal inclusion before accepting fresh reservations after restart.
report('startup_wait', { seconds: 30 });
await sleep(30_000);
const server = createRelayServer(gateway, { publicUrl, report, allowedOrigin: required('RELAY_WEB_ORIGIN') });
server.listen(integer('RELAY_PORT'), () => report('listening', { port: process.env.RELAY_PORT }));
const retries = setInterval(() => { void gateway.retryDebits(); }, 1000);
let stopped = false;
void (async () => {
  while (!stopped) {
    try { await keeper.tick(); } catch (error) { report('keeper_retry', { error: String(error) }); }
    await sleep(60_000);
  }
})();
process.once('SIGTERM', () => { stopped = true; clearInterval(retries); server.close(); });
