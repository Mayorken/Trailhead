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
  registryAddress:
    env.VITE_REGISTRY_ADDRESS || "0xBc17524a677f0AB0b0a817B5890cC3A2eDA14Dac",
  vaultAddress:
    env.VITE_VAULT_ADDRESS || "0x992D51421E5A53c402c09B6d07a0eF7A78fe88B1",
  demoAddress: env.VITE_DEMO_ADDRESS || undefined,
};

export const isConfigured = (): boolean =>
  config.registryAddress !== "" && config.vaultAddress !== "";
