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
): Promise<ethers.EventLog[]> {
  const latest = await provider.getBlockNumber();
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

  return { baseBalance, holdings };
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
