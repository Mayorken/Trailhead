import { ethers } from "ethers";
import type { Chain } from "./chain.js";

export interface DetectedTrade {
  strategyId: bigint;
  strategyWallet: string;
  tokenIn: string;
  tokenOut: string;
  amountIn: bigint;
  path: string[];
  blockNumber: number;
}

interface WatchedStrategy {
  strategyId: bigint;
  wallet: string;
}

/**
 * Detects a strategy wallet's own swaps by scanning each new block's transactions for
 * calls from the strategy wallet to the DEX router and decoding `swapExactTokensForTokens`.
 * This is the block-scan approach (no external indexer); mempool monitoring can be layered
 * on later for lower latency.
 */
export class StrategyWatcher {
  private strategies: WatchedStrategy[] = [];
  private walletToStrategy = new Map<string, bigint>();

  constructor(
    private readonly chain: Chain,
    private readonly watchedStrategyIds: bigint[],
  ) {}

  /** Resolve strategy wallets from the registry. Call once at startup / when new strategies appear. */
  async refreshStrategies(): Promise<void> {
    const ids = this.watchedStrategyIds.length > 0 ? this.watchedStrategyIds : await this.allStrategyIds();
    const next: WatchedStrategy[] = [];
    this.walletToStrategy.clear();
    for (const id of ids) {
      const s = await this.chain.registry.getStrategy(id);
      if (!s.active) continue;
      const wallet = ethers.getAddress(s.strategyWallet);
      next.push({ strategyId: id, wallet });
      this.walletToStrategy.set(wallet, id);
    }
    this.strategies = next;
  }

  private async allStrategyIds(): Promise<bigint[]> {
    const count: bigint = await this.chain.registry.strategyCount();
    const ids: bigint[] = [];
    for (let i = 0n; i < count; i++) ids.push(i);
    return ids;
  }

  /** Scan blocks [fromBlock, toBlock] and return detected strategy swaps. */
  async scan(fromBlock: number, toBlock: number): Promise<DetectedTrade[]> {
    const trades: DetectedTrade[] = [];
    if (this.strategies.length === 0) return trades;
    const routerAddr = this.chain.routerAddress.toLowerCase();

    for (let n = fromBlock; n <= toBlock; n++) {
      const block = await this.chain.provider.getBlock(n, true);
      if (!block) continue;

      for (const tx of block.prefetchedTransactions) {
        if (!tx.to || tx.to.toLowerCase() !== routerAddr) continue;
        const from = ethers.getAddress(tx.from);
        const strategyId = this.walletToStrategy.get(from);
        if (strategyId === undefined) continue;

        const decoded = this.decodeSwap(tx.data);
        if (!decoded) continue;

        trades.push({
          strategyId,
          strategyWallet: from,
          tokenIn: decoded.path[0]!,
          tokenOut: decoded.path[decoded.path.length - 1]!,
          amountIn: decoded.amountIn,
          path: decoded.path,
          blockNumber: n,
        });
      }
    }
    return trades;
  }

  private decodeSwap(data: string): { amountIn: bigint; path: string[] } | null {
    try {
      const parsed = this.chain.routerInterface.parseTransaction({ data });
      if (!parsed || parsed.name !== "swapExactTokensForTokens") return null;
      const amountIn = parsed.args[0] as bigint;
      const path = (parsed.args[2] as string[]).map((a) => ethers.getAddress(a));
      if (path.length < 2) return null;
      return { amountIn, path };
    } catch {
      return null;
    }
  }
}
