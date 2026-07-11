# Trailhead Execution Agent

Off-chain worker that watches registered strategy wallets for on-chain swaps and mirrors them
proportionally into each follower's vault, respecting every follower's risk limits. It calls
`FollowerVault.executeMirroredTrade` and **holds no user funds** — its only asset is AVAX for gas.

> **Status:** scaffold. Typechecks and its trade-sizing math is unit-tested. Not yet run
> against deployed contracts (contracts aren't deployed to Fuji yet).

## How it works

1. **Follower index** — replays the vault's `Followed` / `Unfollowed` events to know who
   follows each strategy (`follows` is a non-enumerable mapping on-chain).
2. **Watcher** — scans each new block's transactions for calls from a strategy wallet to the
   DEX router and decodes `swapExactTokensForTokens` to detect the strategy's own trades.
3. **Sizing** (`mirror.ts`, pure/tested) — applies the strategy's fraction of its holding
   (`amountIn / balanceBefore`) to each follower's available amount (base balance when opening
   a position, held-token balance when closing), capped at what the follower has.
4. **Executor** — quotes the router, derives `minAmountOut` from the follower's slippage limit,
   pre-flights with a static call, then submits. The vault re-enforces all risk limits, so an
   over-sized or non-compliant candidate simply reverts and is skipped.

## Usage

```bash
npm install
npm run typecheck
npm test          # pure sizing-math unit tests

cp .env.example .env   # fill in RPC, AGENT_PRIVATE_KEY, REGISTRY_ADDRESS, VAULT_ADDRESS
npm start              # DRY_RUN=true by default — logs intended trades, sends nothing
```

The agent wallet **must** already be set as the vault's `executionAgent` (owner calls
`setExecutionAgent`); startup asserts this and exits otherwise.

## Known limitations / next steps

- **Detection is block-scan only.** Mempool monitoring (lower latency) is a later addition.
- **Direct-path swaps.** The mirror reuses the strategy's swap path; multi-hop routing
  optimization is out of scope for the mini-grant milestone.
- **Sizing is proportional-to-holding.** It does not yet account for a strategy's leverage or
  multi-asset portfolio weighting — matches the vault's simplified accounting (see contract
  `GAP #1`).
- **No persistence.** The block cursor is rebuilt from `START_BLOCK` on restart; follows are
  re-indexed from chain history each start.
- **Not yet integration-tested against live contracts.** Next step is a local end-to-end run
  (hardhat node + deploy + simulated strategy swap) before Fuji.
