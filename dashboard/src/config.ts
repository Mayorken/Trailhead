export interface DashboardConfig {
  rpcUrl: string;
  chainId: number;
  registryAddress: string;
  vaultAddress: string;
  /** Block the vault was deployed at. Event queries start here, never from genesis — public
   *  RPC providers cap eth_getLogs to a small block range (e.g. 2048 on Fuji's endpoint), so
   *  querying a long-lived chain's full history in one call fails outright. */
  vaultDeployBlock: number;
  /** Optional read-only address to show a position for before/without connecting a wallet. */
  demoAddress?: string;
}

const env = import.meta.env;

export const config: DashboardConfig = {
  rpcUrl: env.VITE_RPC_URL ?? "https://api.avax-test.network/ext/bc/C/rpc",
  chainId: Number(env.VITE_CHAIN_ID ?? "43113"),
  registryAddress: env.VITE_REGISTRY_ADDRESS ?? "",
  vaultAddress: env.VITE_VAULT_ADDRESS ?? "",
  vaultDeployBlock: Number(env.VITE_VAULT_DEPLOY_BLOCK ?? "0"),
  demoAddress: env.VITE_DEMO_ADDRESS || undefined,
};

export const isConfigured = (): boolean =>
  config.registryAddress !== "" && config.vaultAddress !== "";
