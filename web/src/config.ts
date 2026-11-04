// Only public VITE_* values reach the browser; secrets stay in the relay.
const env = import.meta.env ?? {};

export const config = {
  relayUrl: env.VITE_RELAY_URL as string | undefined,
  vaultChainId: env.VITE_BASE_CHAIN_ID as string | undefined,
  vaultAddress: env.VITE_VAULT_ADDRESS as string | undefined,
  baseRpcUrl: env.VITE_BASE_RPC_URL as string | undefined,
  nearRpcUrl: env.VITE_NEAR_RPC_URL as string | undefined,
  connectorAccount: env.VITE_NEAR_CONNECTOR_ACCOUNT as string | undefined,
};

export type LiveConfig = {
  relayUrl: string;
  vaultChainId: number;
  vaultAddress: `0x${string}`;
  baseRpcUrl: string;
  nearRpcUrl: string;
  connectorAccount: string;
};

export function liveConfig(values = config): LiveConfig | null {
  if (!values.relayUrl || !values.vaultChainId || !values.vaultAddress ||
      !values.baseRpcUrl || !values.nearRpcUrl || !values.connectorAccount) return null;
  return {
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
