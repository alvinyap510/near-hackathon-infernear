// Every deployment-specific value comes from the root .env (see ../.env.example).
const env = import.meta.env;

export const config = {
  relayUrl: env.VITE_RELAY_URL as string | undefined,
  vaultChainId: env.VITE_BASE_CHAIN_ID as string | undefined,
  vaultAddress: env.VITE_VAULT_ADDRESS as string | undefined,
  connectorAccount: env.VITE_NEAR_CONNECTOR_ACCOUNT as string | undefined,
};

/** Shows a configured value, or names the variable that would set it. */
export const shown = (value: string | undefined, variable: string) => value || `$${variable}`;

export const apiBaseUrl = () => `${shown(config.relayUrl, 'VITE_RELAY_URL')}/v1`;

export const caip10 = (address: string) =>
  `eip155:${shown(config.vaultChainId, 'VITE_BASE_CHAIN_ID')}:${address.toLowerCase()}`;
