export interface DashboardConfig {
  rpcUrl: string;
  chainId: number;
  registryAddress: string;
  vaultAddress: string;
  /** Optional read-only address to show a position for before/without connecting a wallet. */
  demoAddress?: string;
}

const env = import.meta.env;

export const config: DashboardConfig = {
  rpcUrl: env.VITE_RPC_URL ?? "https://api.avax-test.network/ext/bc/C/rpc",
  chainId: Number(env.VITE_CHAIN_ID ?? "43113"),
  registryAddress: env.VITE_REGISTRY_ADDRESS ?? "",
  vaultAddress: env.VITE_VAULT_ADDRESS ?? "",
  demoAddress: env.VITE_DEMO_ADDRESS || undefined,
};

export const isConfigured = (): boolean =>
  config.registryAddress !== "" && config.vaultAddress !== "";
