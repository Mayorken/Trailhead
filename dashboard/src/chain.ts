import { ethers } from "ethers";
import { config } from "./config.js";
import { registryAbi, vaultAbi, routerAbi, erc20Abi } from "./abis.js";

declare global {
  interface Window {
    ethereum?: ethers.Eip1193Provider & {
      on?: (e: string, cb: (...a: unknown[]) => void) => void;
      removeListener?: (e: string, cb: (...a: unknown[]) => void) => void;
    };
  }
}

export interface BaseMeta {
  baseAsset: string;
  router: string;
  decimals: number;
  symbol: string;
}

export interface FollowInfo {
  active: boolean;
  maxSlippageBps: bigint;
  maxPositionSizeBps: bigint;
}

export interface Strategy {
  id: bigint;
  creator: string;
  strategyWallet: string;
  profitShareBps: bigint;
  verified: boolean;
  active: boolean;
  follow?: FollowInfo;
}

export interface Holding {
  token: string;
  symbol: string;
  decimals: number;
  amount: bigint;
  costBasis: bigint;
  currentValueBase: bigint;
  pnlBase: bigint;
}

export interface Position {
  baseBalance: bigint;
  holdings: Holding[];
  /** Authoritative NAV read from the vault's own getNAV (oracle-priced), when available.
   *  Falls back to null if the deployed vault predates getNAV or the call fails — callers
   *  should fall back to baseBalance + sum(holdings.currentValueBase) in that case. */
  onChainNAV: bigint | null;
}

export interface LeaderboardEntry extends Strategy {
  pnlBase: bigint;
  winRate: number;
  skinBase: bigint;
  closedCount: number;
}

export interface ActivityItem {
  block: number;
  txHash: string;
  type: "open" | "close";
  follower: string;
  strategyId: bigint;
  token: string;
  tokenSymbol: string;
  baseAmount: bigint;
  tokenAmount: bigint;
}

export const readProvider = (): ethers.JsonRpcProvider =>
  new ethers.JsonRpcProvider(config.rpcUrl);

export function readContracts(provider: ethers.Provider) {
  return {
    registry: new ethers.Contract(config.registryAddress, registryAbi, provider),
    vault: new ethers.Contract(config.vaultAddress, vaultAbi, provider),
  };
}

export async function loadBaseMeta(provider: ethers.Provider): Promise<BaseMeta> {
  const { vault } = readContracts(provider);
  const baseAsset: string = await vault.baseAsset();
  const router: string = await vault.router();
  const erc20 = new ethers.Contract(baseAsset, erc20Abi, provider);
  const [decimals, symbol] = await Promise.all([erc20.decimals(), erc20.symbol()]);
  return { baseAsset, router, decimals: Number(decimals), symbol };
}

export async function loadStrategies(provider: ethers.Provider, user?: string): Promise<Strategy[]> {
  const { registry, vault } = readContracts(provider);
  const count: bigint = await registry.strategyCount();
  const out: Strategy[] = [];
  for (let i = 0n; i < count; i++) {
    const s = await registry.getStrategy(i);
    const strat: Strategy = {
      id: i,
      creator: s.creator,
      strategyWallet: s.strategyWallet,
      profitShareBps: s.profitShareBps,
      verified: s.verified,
      active: s.active,
    };
    if (user) {
      const f = await vault.follows(user, i);
      if (f.active) {
        strat.follow = {
          active: true,
          maxSlippageBps: f.maxSlippageBps,
          maxPositionSizeBps: f.maxPositionSizeBps,
        };
      }
    }
    out.push(strat);
  }
  return out;
}

// Public RPC providers cap eth_getLogs to a small block range (Fuji's endpoint allows 2048).
// A long-lived chain's full history can vastly exceed that in one call, and the gap between
// a fixed starting block and "latest" only grows over time — so this chunks the query into
// windows under the cap and concatenates results, rather than relying on the range staying
// small. Safely under 2048 to leave headroom for provider-side rounding.
const MAX_LOG_RANGE = 2000;

async function queryFilterChunked(
  contract: ethers.Contract,
  filter: ethers.DeferredTopicFilter,
  fromBlock: number,
  provider: ethers.Provider,
  toBlock?: number,
): Promise<ethers.EventLog[]> {
  const latest = toBlock ?? (await provider.getBlockNumber());
  const events: ethers.EventLog[] = [];
  for (let start = fromBlock; start <= latest; start += MAX_LOG_RANGE + 1) {
    const end = Math.min(start + MAX_LOG_RANGE, latest);
    const chunk = await contract.queryFilter(filter, start, end);
    events.push(...(chunk as ethers.EventLog[]));
  }
  return events;
}

export async function loadPosition(
  provider: ethers.Provider,
  meta: BaseMeta,
  user: string,
): Promise<Position> {
  const { vault } = readContracts(provider);
  const baseBalance: bigint = await vault.balance(user);

  // Discover which tokens this user has ever opened a position in.
  const opened = await queryFilterChunked(
    vault,
    vault.filters.PositionOpened(user),
    config.vaultDeployBlock,
    provider,
  );
  const tokens = new Set<string>();
  for (const ev of opened) {
    const log = ev as ethers.EventLog;
    if (log.args) tokens.add(ethers.getAddress(log.args[2] as string));
  }

  const router = new ethers.Contract(meta.router, routerAbi, provider);
  const holdings: Holding[] = [];

  for (const token of tokens) {
    const amount: bigint = await vault.heldToken(user, token);
    if (amount <= 0n) continue;
    const costBasis: bigint = await vault.costBasis(user, token);
    const erc20 = new ethers.Contract(token, erc20Abi, provider);
    const [decimals, symbol] = await Promise.all([erc20.decimals(), erc20.symbol()]);

    let currentValueBase = 0n;
    try {
      const amounts: bigint[] = await router.getAmountsOut(amount, [token, meta.baseAsset]);
      currentValueBase = amounts[amounts.length - 1] ?? 0n;
    } catch {
      currentValueBase = 0n; // no route / no liquidity — leave unvalued
    }

    holdings.push({
      token,
      symbol,
      decimals: Number(decimals),
      amount,
      costBasis,
      currentValueBase,
      pnlBase: currentValueBase - costBasis,
    });
  }

  // Prefer the vault's own getNAV (oracle-priced, same math the contract enforces) over the
  // client-side router-quote sum above for the headline total. Older deployments (pre-oracle)
  // won't have this function — fall back to the client computation rather than fail the page.
  let onChainNAV: bigint | null = null;
  try {
    onChainNAV = await vault.getNAV(user, [...tokens]);
  } catch {
    onChainNAV = null;
  }

  return { baseBalance, holdings, onChainNAV };
}

// ---- leaderboard ----

export async function loadLeaderboard(
  provider: ethers.Provider,
  meta: BaseMeta,
  strategies: Strategy[],
): Promise<LeaderboardEntry[]> {
  const { vault } = readContracts(provider);
  const baseErc20 = new ethers.Contract(meta.baseAsset, erc20Abi, provider);
  const from = config.vaultDeployBlock;

  const entries = await Promise.all(
    strategies.map(async (s): Promise<LeaderboardEntry> => {
      const [opens, closes, skinRaw] = await Promise.all([
        queryFilterChunked(vault, vault.filters.PositionOpened(null, s.id), from, provider),
        queryFilterChunked(vault, vault.filters.PositionClosed(null, s.id), from, provider),
        baseErc20.balanceOf(s.strategyWallet) as Promise<bigint>,
      ]);

      let totalSpent = 0n;
      for (const ev of opens) {
        totalSpent += ev.args[3] as bigint; // baseSpent
      }

      // Win = contract charged a profitShareFee > 0, meaning it detected a gain on this close.
      let totalReturned = 0n;
      let wins = 0;
      for (const ev of closes) {
        const baseReceived = ev.args[4] as bigint;
        const fee = ev.args[5] as bigint;
        totalReturned += baseReceived - fee;
        if (fee > 0n) wins++;
      }

      return {
        ...s,
        pnlBase: totalReturned - totalSpent,
        winRate: closes.length === 0 ? 0 : Math.round((wins / closes.length) * 100),
        skinBase: skinRaw,
        closedCount: closes.length,
      };
    }),
  );

  return entries.sort((a, b) => (b.pnlBase > a.pnlBase ? 1 : b.pnlBase < a.pnlBase ? -1 : 0));
}

// ---- activity feed ----

export async function loadActivity(
  provider: ethers.Provider,
  fromBlock: number,
  toBlock: number,
  symbolCache: Map<string, string>,
  meta: BaseMeta,
): Promise<ActivityItem[]> {
  const { vault } = readContracts(provider);

  const resolveSymbol = async (token: string): Promise<string> => {
    const key = token.toLowerCase();
    if (symbolCache.has(key)) return symbolCache.get(key)!;
    try {
      const erc20 = new ethers.Contract(token, erc20Abi, provider);
      const sym: string = await erc20.symbol();
      symbolCache.set(key, sym);
      return sym;
    } catch {
      symbolCache.set(key, "???");
      return "???";
    }
  };
  // Always cache base asset symbol so it's available for closes
  if (!symbolCache.has(meta.baseAsset.toLowerCase())) {
    const erc20 = new ethers.Contract(meta.baseAsset, erc20Abi, provider);
    const sym: string = await erc20.symbol();
    symbolCache.set(meta.baseAsset.toLowerCase(), sym);
  }

  const [opens, closes] = await Promise.all([
    queryFilterChunked(vault, vault.filters.PositionOpened(), fromBlock, provider, toBlock),
    queryFilterChunked(vault, vault.filters.PositionClosed(), fromBlock, provider, toBlock),
  ]);

  const items: ActivityItem[] = [];

  for (const ev of opens) {
    const token = ethers.getAddress(ev.args[2] as string);
    const sym = await resolveSymbol(token);
    items.push({
      block: ev.blockNumber,
      txHash: ev.transactionHash,
      type: "open",
      follower: ethers.getAddress(ev.args[0] as string),
      strategyId: ev.args[1] as bigint,
      token,
      tokenSymbol: sym,
      baseAmount: ev.args[3] as bigint, // baseSpent
      tokenAmount: ev.args[4] as bigint, // tokenReceived
    });
  }

  for (const ev of closes) {
    const token = ethers.getAddress(ev.args[2] as string);
    const sym = await resolveSymbol(token);
    const baseReceived = ev.args[4] as bigint;
    const fee = ev.args[5] as bigint;
    items.push({
      block: ev.blockNumber,
      txHash: ev.transactionHash,
      type: "close",
      follower: ethers.getAddress(ev.args[0] as string),
      strategyId: ev.args[1] as bigint,
      token,
      tokenSymbol: sym,
      baseAmount: baseReceived - fee, // net to follower
      tokenAmount: ev.args[3] as bigint, // tokenSold
    });
  }

  return items.sort((a, b) => b.block - a.block);
}

// ---- wallet (write path) ----

export interface Wallet {
  provider: ethers.BrowserProvider;
  signer: ethers.Signer;
  address: string;
  chainId: number;
}

export async function connectWallet(): Promise<Wallet> {
  if (!window.ethereum) throw new Error("No injected wallet found. Install MetaMask or Core.");
  const provider = new ethers.BrowserProvider(window.ethereum);
  await provider.send("eth_requestAccounts", []);
  await switchToConfiguredChain();
  const signer = await provider.getSigner();
  const address = await signer.getAddress();
  const net = await provider.getNetwork();
  return { provider, signer, address, chainId: Number(net.chainId) };
}

interface AddChainParams {
  chainId: string;
  chainName: string;
  nativeCurrency: { name: string; symbol: string; decimals: number };
  rpcUrls: string[];
  blockExplorerUrls: string[];
}

// Params for the two networks this project targets. wallet_switchEthereumChain fails with
// code 4902 ("unrecognized chain") if the wallet has never seen the chain before — we only
// know how to fall back to wallet_addEthereumChain for chains we can describe here.
function addChainParams(chainId: number, rpcUrl: string): AddChainParams | null {
  const hexId = "0x" + chainId.toString(16);
  const nativeCurrency = { name: "Avalanche", symbol: "AVAX", decimals: 18 };
  if (chainId === 43113) {
    return {
      chainId: hexId,
      chainName: "Avalanche Fuji Testnet",
      nativeCurrency,
      rpcUrls: [rpcUrl],
      blockExplorerUrls: ["https://testnet.snowtrace.io"],
    };
  }
  if (chainId === 43114) {
    return {
      chainId: hexId,
      chainName: "Avalanche C-Chain",
      nativeCurrency,
      rpcUrls: [rpcUrl],
      blockExplorerUrls: ["https://snowtrace.io"],
    };
  }
  return null;
}

/**
 * Ask the wallet to switch to the configured chain. If the wallet has never seen this chain
 * (error 4902), fall back to wallet_addEthereumChain — adding a chain also switches to it, so
 * no separate switch call is needed after. Safe to call; swallows user rejection so reads can
 * still proceed via the RPC provider even if the wallet stays on the wrong network.
 */
export async function switchToConfiguredChain(): Promise<void> {
  if (!window.ethereum) return;
  const hexId = "0x" + config.chainId.toString(16);
  try {
    await window.ethereum.request({ method: "wallet_switchEthereumChain", params: [{ chainId: hexId }] });
    return;
  } catch (err) {
    const code = (err as { code?: number } | null)?.code;
    if (code !== 4902) return; // user rejected, or an error we can't recover from — give up quietly
  }

  const params = addChainParams(config.chainId, config.rpcUrl);
  if (!params) return;
  try {
    await window.ethereum.request({ method: "wallet_addEthereumChain", params: [params] });
  } catch {
    // User rejected the add — the wrongNetwork banner will still surface this.
  }
}

export function writeVault(signer: ethers.Signer): ethers.Contract {
  return new ethers.Contract(config.vaultAddress, vaultAbi, signer);
}

export function erc20With(address: string, runner: ethers.ContractRunner): ethers.Contract {
  return new ethers.Contract(address, erc20Abi, runner);
}
