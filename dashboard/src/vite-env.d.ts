/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_RPC_URL?: string;
  readonly VITE_CHAIN_ID?: string;
  readonly VITE_REGISTRY_ADDRESS?: string;
  readonly VITE_VAULT_ADDRESS?: string;
  readonly VITE_DEMO_ADDRESS?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
