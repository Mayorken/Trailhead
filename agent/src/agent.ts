import type { AgentConfig } from "./config.js";
import { connectChain } from "./chain.js";
import { FollowerIndex } from "./followerIndex.js";
import { StrategyWatcher } from "./watcher.js";
import { Executor } from "./executor.js";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Main loop: on each tick, advance to the latest block, sync the follower index, scan new
 * blocks for strategy trades, and mirror each one across its followers. Stateless across
 * restarts except for the last-scanned cursor, which is rebuilt from `startBlock`.
 */
export async function runAgent(cfg: AgentConfig, signal?: AbortSignal): Promise<void> {
  const chain = await connectChain(cfg);
  console.log(`Agent wallet:      ${chain.wallet.address}`);
  console.log(`Vault:             ${cfg.vaultAddress}`);
  console.log(`Base asset:        ${chain.baseAsset}`);
  console.log(`Router:            ${chain.routerAddress}`);
  console.log(`Dry run:           ${cfg.dryRun}`);

  const latest = await chain.provider.getBlockNumber();
  const startBlock = cfg.startBlock === "latest" ? latest : cfg.startBlock;
  console.log(`Starting at block: ${startBlock}\n`);

  // Follows can predate startBlock, so index them from the vault's deployment block.
  const followers = new FollowerIndex(chain, cfg.strategyIds, cfg.vaultDeployBlock);
  const watcher = new StrategyWatcher(chain, cfg.strategyIds);
  const executor = new Executor(chain, cfg);

  await watcher.refreshStrategies();

  let nextBlock = startBlock;

  while (!signal?.aborted) {
    try {
      const head = await chain.provider.getBlockNumber();
      if (head >= nextBlock) {
        await followers.sync(head);
        await watcher.refreshStrategies();

        const trades = await watcher.scan(nextBlock, head);
        for (const trade of trades) {
          const set = followers.followersOf(trade.strategyId);
          console.log(
            `strategy ${trade.strategyId} traded ${trade.amountIn} ${trade.tokenIn} -> ${trade.tokenOut} ` +
              `@ block ${trade.blockNumber} (${set.length} follower(s))`,
          );
          if (set.length > 0) await executor.mirror(trade, set);
        }
        nextBlock = head + 1;
      }
    } catch (err) {
      console.error(`tick error: ${(err as Error).message}`);
    }
    await sleep(cfg.pollIntervalMs);
  }
}
