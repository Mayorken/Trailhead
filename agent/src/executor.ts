import { ethers } from "ethers";
import type { Chain } from "./chain.js";
import type { AgentConfig } from "./config.js";
import type { DetectedTrade } from "./watcher.js";
import { sizeMirroredTrade, computeMinAmountOut } from "./mirror.js";

interface TradeParams {
  follower: string;
  strategyId: bigint;
  tokenIn: string;
  tokenOut: string;
  amountIn: bigint;
  minAmountOut: bigint;
  path: string[];
  deadline: bigint;
}

export class Executor {
  constructor(
    private readonly chain: Chain,
    private readonly cfg: AgentConfig,
  ) {}

  /** Mirror one detected strategy trade across all followers of that strategy. */
  async mirror(trade: DetectedTrade, followers: string[]): Promise<void> {
    const base = this.chain.baseAsset.toLowerCase();
    const opening = trade.tokenIn.toLowerCase() === base;
    const closing = trade.tokenOut.toLowerCase() === base;

    if (!opening && !closing) {
      console.log(`  skip: strategy trade does not involve the base asset (${trade.tokenIn} -> ${trade.tokenOut})`);
      return;
    }
    if (opening && closing) return;

    // The token whose balance the strategy drew from, valued just before its trade.
    const sourceToken = trade.tokenIn;
    const strategyBalanceBefore: bigint = await this.chain
      .erc20(sourceToken)
      .balanceOf(trade.strategyWallet, { blockTag: Math.max(0, trade.blockNumber - 1) });

    const deadline = BigInt((await this.currentTimestamp()) + this.cfg.deadlineSecs);

    for (const follower of followers) {
      try {
        await this.mirrorForFollower(trade, follower, opening, strategyBalanceBefore, deadline);
      } catch (err) {
        console.log(`  follower ${follower}: skipped (${(err as Error).message})`);
      }
    }
  }

  private async mirrorForFollower(
    trade: DetectedTrade,
    follower: string,
    opening: boolean,
    strategyBalanceBefore: bigint,
    deadline: bigint,
  ): Promise<void> {
    const follow = await this.chain.vault.follows(follower, trade.strategyId);
    if (!follow.active) return; // unfollowed since indexing; nothing to do

    const available: bigint = opening
      ? await this.chain.vault.balance(follower)
      : await this.chain.vault.heldToken(follower, trade.tokenIn);

    const amountIn = sizeMirroredTrade(trade.amountIn, strategyBalanceBefore, available);
    if (amountIn <= 0n) return;

    const amounts: bigint[] = await this.chain.router.getAmountsOut(amountIn, trade.path);
    const expectedOut = amounts[amounts.length - 1] ?? 0n;
    const minAmountOut = computeMinAmountOut(expectedOut, follow.maxSlippageBps as bigint);

    const params: TradeParams = {
      follower,
      strategyId: trade.strategyId,
      tokenIn: trade.tokenIn,
      tokenOut: trade.tokenOut,
      amountIn,
      minAmountOut,
      path: trade.path,
      deadline,
    };

    if (this.cfg.dryRun) {
      console.log(
        `  [dry-run] ${follower}: ${opening ? "OPEN" : "CLOSE"} amountIn=${amountIn} minOut=${minAmountOut}`,
      );
      return;
    }

    // Pre-flight against a node call so expected reverts (vault limits) don't cost gas.
    await this.chain.vault.executeMirroredTrade.staticCall(params);
    const tx = await this.chain.vault.executeMirroredTrade(params);
    const receipt = await tx.wait();
    console.log(
      `  ${follower}: ${opening ? "OPEN" : "CLOSE"} amountIn=${amountIn} tx=${receipt?.hash} block=${receipt?.blockNumber}`,
    );
  }

  private async currentTimestamp(): Promise<number> {
    const block = await this.chain.provider.getBlock("latest");
    return block?.timestamp ?? Math.floor(Date.now() / 1000);
  }
}
