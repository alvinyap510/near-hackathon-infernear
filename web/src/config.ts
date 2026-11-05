// Only public VITE_* values reach the browser; secrets stay in the relay.
const env = import.meta.env ?? {};

export const config = {
  relayUrl: env.VITE_RELAY_URL as string | undefined,
  vaultChainId: env.VITE_BASE_CHAIN_ID as string | undefined,
  vaultAddress: env.VITE_VAULT_ADDRESS as string | undefined,
  baseRpcUrl: env.VITE_BASE_RPC_URL as string | undefined,
  nearRpcUrl: env.VITE_NEAR_RPC_URL as string | undefined,
  connectorAccount: env.VITE_NEAR_CONNECTOR_ACCOUNT as string | undefined,
  rateVaultAddress: env.VITE_RATE_VAULT_ADDRESS as string | undefined,
  pendleVaultAddress: env.VITE_PENDLE_VAULT_ADDRESS as string | undefined,
  rheaVaultAccount: env.VITE_RHEA_VAULT_ACCOUNT as string | undefined,
  nearUsdcAccount: env.VITE_NEAR_USDC_ACCOUNT as string | undefined,
  intentsAccount: env.VITE_NEAR_INTENTS_ACCOUNT as string | undefined,
  oneClickUrl: env.VITE_ONECLICK_API_URL as string | undefined,
  baseUsdcAssetId: env.VITE_ONECLICK_BASE_USDC_ASSET as string | undefined,
  slippageBps: env.VITE_ONECLICK_SLIPPAGE_BPS as string | undefined,
  pendleAppUrl: env.VITE_PENDLE_APP_URL as string | undefined,
};

export type LiveConfig = {
  relayUrl: string;
  vaultChainId: number;
  vaultAddress: `0x${string}`;
  baseRpcUrl: string;
  nearRpcUrl: string;
  connectorAccount: string;
  rateVaultAddress: `0x${string}`;
  pendleVaultAddress: `0x${string}`;
  rheaVaultAccount: string;
  nearUsdcAccount: string;
  intentsAccount: string;
  oneClickUrl: string;
  baseUsdcAssetId: string;
  slippageBps: number;
  pendleAppUrl: string;
};

export function liveConfig(values = config): LiveConfig | null {
  if (!values.relayUrl || !values.vaultChainId || !values.vaultAddress ||
      !values.baseRpcUrl || !values.nearRpcUrl || !values.connectorAccount ||
      !values.rateVaultAddress || !values.pendleVaultAddress || !values.rheaVaultAccount ||
      !values.nearUsdcAccount || !values.intentsAccount || !values.oneClickUrl ||
      !values.baseUsdcAssetId || !values.slippageBps || !values.pendleAppUrl) return null;
  // Invalid chain/slippage settings cannot describe a usable funding route.
  if (!Number.isSafeInteger(Number(values.vaultChainId)) || Number(values.vaultChainId) <= 0 ||
      !Number.isInteger(Number(values.slippageBps)) || Number(values.slippageBps) < 0 || Number(values.slippageBps) > 10_000) return null;
  return {
    rateVaultAddress: values.rateVaultAddress as LiveConfig['rateVaultAddress'],
    pendleVaultAddress: values.pendleVaultAddress as LiveConfig['pendleVaultAddress'],
    rheaVaultAccount: values.rheaVaultAccount, nearUsdcAccount: values.nearUsdcAccount,
    intentsAccount: values.intentsAccount, oneClickUrl: values.oneClickUrl,
    baseUsdcAssetId: values.baseUsdcAssetId, slippageBps: Number(values.slippageBps), pendleAppUrl: values.pendleAppUrl,
    relayUrl: values.relayUrl,
    vaultChainId: Number(values.vaultChainId),
    vaultAddress: values.vaultAddress as LiveConfig['vaultAddress'],
    baseRpcUrl: values.baseRpcUrl,
    nearRpcUrl: values.nearRpcUrl,
    connectorAccount: values.connectorAccount,
  };
}

/** Shows a configured value, or names the variable that would set it. */
export const shown = (value: string | undefined, variable: string) => value || `$${variable}`;
export const apiBaseUrl = () => `${shown(config.relayUrl?.replace(/\/$/, ''), 'VITE_RELAY_URL')}/v1`;
export const caip10 = (address: string, chainId: string | number = shown(config.vaultChainId, 'VITE_BASE_CHAIN_ID')) =>
  `eip155:${chainId}:${address.toLowerCase()}`;
