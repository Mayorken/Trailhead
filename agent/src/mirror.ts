// Pure trade-sizing math. No chain access here so it can be unit-tested directly.

export const BPS_DENOMINATOR = 10_000n;

/**
 * Size a follower's mirrored trade proportionally to the strategy's own trade.
 *
 * The strategy spent `strategyAmountIn` of a token it held `strategyBalanceBefore` of,
 * i.e. it committed a fraction `strategyAmountIn / strategyBalanceBefore` of that holding.
 * We apply the same fraction to the follower's available amount of the same token
 * (base balance when opening, held-token balance when closing), then cap at what the
 * follower actually has. The vault re-checks its own risk limits on top of this.
 *
 * All integer (wei) math; returns 0 when inputs make a trade impossible.
 */
export function sizeMirroredTrade(
  strategyAmountIn: bigint,
  strategyBalanceBefore: bigint,
  followerAvailable: bigint,
): bigint {
  if (strategyAmountIn <= 0n || strategyBalanceBefore <= 0n || followerAvailable <= 0n) {
    return 0n;
  }
  // Clamp the strategy fraction to at most 100% (it can't spend more than it holds).
  const cappedIn = strategyAmountIn > strategyBalanceBefore ? strategyBalanceBefore : strategyAmountIn;
  const followerAmountIn = (followerAvailable * cappedIn) / strategyBalanceBefore;
  return followerAmountIn > followerAvailable ? followerAvailable : followerAmountIn;
}

/**
 * Floor output the agent will accept, derived from the router quote and the follower's
 * own slippage tolerance. Must be >= the vault's on-chain slippage backstop for the tx
 * to pass, so we use the same formula the contract uses.
 */
export function computeMinAmountOut(expectedOut: bigint, maxSlippageBps: bigint): bigint {
  if (expectedOut <= 0n) return 0n;
  return (expectedOut * (BPS_DENOMINATOR - maxSlippageBps)) / BPS_DENOMINATOR;
}
