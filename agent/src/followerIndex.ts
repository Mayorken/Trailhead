import { ethers } from "ethers";
import type { Chain } from "./chain.js";

// Public RPC providers cap eth_getLogs to a small block range (Fuji's endpoint allows 2048).
// The gap between the last-scanned block and the current head grows with every tick, so a
// single unchunked query eventually exceeds the cap on any long-lived chain — this splits
// the range into windows under the cap and concatenates results. Safely under 2048 to leave
// headroom for provider-side rounding.
const MAX_LOG_RANGE = 2000;

async function queryFilterChunked(
  contract: ethers.Contract,
  filter: ethers.DeferredTopicFilter,
  fromBlock: number,
  toBlock: number,
): Promise<ethers.EventLog[]> {
  const events: ethers.EventLog[] = [];
  for (let start = fromBlock; start <= toBlock; start += MAX_LOG_RANGE + 1) {
    const end = Math.min(start + MAX_LOG_RANGE, toBlock);
    const chunk = await contract.queryFilter(filter, start, end);
    events.push(...(chunk as ethers.EventLog[]));
  }
  return events;
}

/**
 * Maintains the set of followers per strategy by replaying the vault's Followed /
 * Unfollowed events. `follows` is a nested mapping on-chain and not enumerable, so the
 * agent reconstructs the membership off-chain. Follow limits are read live from the
 * contract at execution time, so we only track membership here.
 */
export class FollowerIndex {
  private readonly byStrategy = new Map<string, Set<string>>();
  private lastScannedBlock: number;

  constructor(
    private readonly chain: Chain,
    private readonly watchedStrategies: bigint[],
    fromBlock: number,
  ) {
    this.lastScannedBlock = fromBlock - 1;
  }

  private set(strategyId: bigint): Set<string> {
    const key = strategyId.toString();
    let s = this.byStrategy.get(key);
    if (!s) {
      s = new Set<string>();
      this.byStrategy.set(key, s);
    }
    return s;
  }

  private isWatched(strategyId: bigint): boolean {
    return this.watchedStrategies.length === 0 || this.watchedStrategies.some((id) => id === strategyId);
  }

  followersOf(strategyId: bigint): string[] {
    return [...this.set(strategyId)];
  }

  /** Scan new blocks for follow/unfollow events up to `toBlock` (inclusive). */
  async sync(toBlock: number): Promise<void> {
    if (toBlock <= this.lastScannedBlock) return;
    const from = this.lastScannedBlock + 1;

    const followed = await queryFilterChunked(this.chain.vault, this.chain.vault.filters.Followed(), from, toBlock);
    const unfollowed = await queryFilterChunked(this.chain.vault, this.chain.vault.filters.Unfollowed(), from, toBlock);

    const events = [...followed, ...unfollowed].sort(
      (a, b) => a.blockNumber - b.blockNumber || a.index - b.index,
    );

    for (const ev of events) {
      const log = ev as ethers.EventLog;
      if (!("args" in log) || !log.args) continue;
      const user = log.args[0] as string;
      const strategyId = log.args[1] as bigint;
      if (!this.isWatched(strategyId)) continue;

      if (log.eventName === "Followed") this.set(strategyId).add(ethers.getAddress(user));
      else this.set(strategyId).delete(ethers.getAddress(user));
    }

    this.lastScannedBlock = toBlock;
  }
}
