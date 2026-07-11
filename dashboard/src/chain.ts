import { ethers } from "ethers";
import { config } from "./config.js";
import { registryAbi, vaultAbi, routerAbi, erc20Abi } from "./abis.js";

declare global {
  interface Window {
    ethereum?: ethers.Eip1193Provider & { on?: (e: string, cb: (...a: unknown[]) => void) => void };
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

export async function loadPosition(
  provider: ethers.Provider,
  meta: BaseMeta,
  user: string,
): Promise<Position> {
  const { vault } = readContracts(provider);
  const baseBalance: bigint = await vault.balance(user);

  // Discover which tokens this user has ever opened a position in.
  const opened = await vault.queryFilter(vault.filters.PositionOpened(user), 0, "latest");
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
}

export async function connectWallet(): Promise<Wallet> {
  if (!window.ethereum) throw new Error("No injected wallet found. Install MetaMask or Core.");
  const provider = new ethers.BrowserProvider(window.ethereum);
  await provider.send("eth_requestAccounts", []);
  await ensureChain();
  const signer = await provider.getSigner();
  const address = await signer.getAddress();
  return { provider, signer, address };
}

async function ensureChain(): Promise<void> {
  if (!window.ethereum) return;
  const hexId = "0x" + config.chainId.toString(16);
  try {
    await window.ethereum.request({ method: "wallet_switchEthereumChain", params: [{ chainId: hexId }] });
  } catch {
    // Chain not added — leave it to the user; reads still work via the RPC provider.
  }
}

export function writeVault(signer: ethers.Signer): ethers.Contract {
  return new ethers.Contract(config.vaultAddress, vaultAbi, signer);
}

export function erc20With(address: string, runner: ethers.ContractRunner): ethers.Contract {
  return new ethers.Contract(address, erc20Abi, runner);
}
