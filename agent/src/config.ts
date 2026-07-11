import "dotenv/config";

export interface AgentConfig {
  rpcUrl: string;
  agentPrivateKey: string;
  registryAddress: string;
  vaultAddress: string;
  /** Strategy ids this agent mirrors. */
  strategyIds: bigint[];
  pollIntervalMs: number;
  /** Block to begin scanning strategy trades from. */
  startBlock: number | "latest";
  /** Block the vault was deployed at — where follow indexing begins (follows can predate startBlock). */
  vaultDeployBlock: number;
  /** Seconds added to block time to form each swap deadline. */
  deadlineSecs: number;
  /** Ignore detected strategy trades smaller than this (in tokenIn base units). */
  minTradeWei: bigint;
  /** When true, compute and log mirrored trades but never send transactions. */
  dryRun: boolean;
}

function required(name: string): string {
  const v = process.env[name];
  if (!v || v.trim() === "") throw new Error(`Missing required env var: ${name}`);
  return v.trim();
}

function optional(name: string, fallback: string): string {
  const v = process.env[name];
  return v && v.trim() !== "" ? v.trim() : fallback;
}

export function loadConfig(): AgentConfig {
  const strategyIds = optional("STRATEGY_IDS", "")
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s !== "")
    .map((s) => BigInt(s));

  const startRaw = optional("START_BLOCK", "latest");

  return {
    rpcUrl: required("RPC_URL"),
    agentPrivateKey: required("AGENT_PRIVATE_KEY"),
    registryAddress: required("REGISTRY_ADDRESS"),
    vaultAddress: required("VAULT_ADDRESS"),
    strategyIds,
    pollIntervalMs: Number(optional("POLL_INTERVAL_MS", "4000")),
    startBlock: startRaw === "latest" ? "latest" : Number(startRaw),
    vaultDeployBlock: Number(optional("VAULT_DEPLOY_BLOCK", "0")),
    deadlineSecs: Number(optional("DEADLINE_SECS", "300")),
    minTradeWei: BigInt(optional("MIN_TRADE_WEI", "0")),
    dryRun: optional("DRY_RUN", "false").toLowerCase() === "true",
  };
}
