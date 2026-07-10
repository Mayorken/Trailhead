# Trailhead

Non-custodial, on-chain AI copy-trading agent for Avalanche. Users deposit into a vault,
follow a vetted trading strategy, and have trades mirrored automatically — every trade, fee,
and performance number verifiable on-chain. Built for the Avalanche Team1 Mini-Grants program.

> **Status:** contracts compile and pass a full unit-test suite on the Hardhat network.
> **Not audited. Do not deploy to mainnet with real funds.**

## Contracts

### `StrategyRegistry.sol`
Permissionless registry of strategies. Anyone registers a strategy pointing at a
`strategyWallet` whose trades are mirrored, plus a `profitShareBps` (hard-capped at 30%).
The admin (`onlyOwner`) can flip an advisory `verified` flag (surfaced in the UI — **not** an
access gate). The creator or admin can deactivate a strategy; only the creator can reactivate.

### `FollowerVault.sol`
Single base-asset vault (intended: USDC). Non-custodial: users `deposit`/`withdraw` freely and
the execution agent has **no withdrawal rights** — only a permissioned `executeMirroredTrade`.

- `followStrategy(strategyId, maxSlippageBps, maxPositionSizeBps)` — user-set risk limits,
  hard-capped at **5% slippage** / **50% position size** at the contract level.
- `executeMirroredTrade(TradeParams)` — callable only by `executionAgent`. Opens a position
  (base → whitelisted token) or closes one (token → base), enforcing the follower's own
  slippage/position limits and swapping via an `IDexRouter` (Trader Joe-style). Realized gains
  on close pay a profit-share fee to the strategy creator; principal and swap output stay in
  the vault.
- `tokenWhitelisted` restricts which tokens the vault can hold.

## Layout

```
contracts/
  StrategyRegistry.sol
  FollowerVault.sol
  mocks/            # test-only: MockERC20, MockDexRouter, MockReentrantToken
scripts/deploy.js
test/
  StrategyRegistry.test.js
  FollowerVault.test.js
hardhat.config.js   # Fuji (43113) + Avalanche mainnet (43114)
```

## Usage

```bash
npm install
npx hardhat compile
npx hardhat test          # 34 passing

# Dry-run deploy on the in-process network (auto-deploys mocks):
npx hardhat run scripts/deploy.js

# Live deploy (set .env from .env.example first):
npm run deploy:fuji
```

Deploy env (live networks): `PRIVATE_KEY`, `BASE_ASSET` (USDC), `DEX_ROUTER` (Trader Joe),
optional `EXECUTION_AGENT`. When `BASE_ASSET`/`DEX_ROUTER` are unset the script deploys mocks
so a dry run works out of the box.

## Test coverage

Deposit/withdraw, strategy registration/verification/deactivation/reactivation, follow/unfollow,
risk-limit enforcement (slippage cap, position-size cap), execution-agent-only access control,
whitelist enforcement, open/close accounting, profit-share payout math (profit, loss, partial
close with proportional cost basis), the slippage backstop, and a ReentrancyGuard verification.

## Known gaps / TODOs

These are **carried forward from the design and still open** — several are simplified for the
grant milestone and need a design pass before real funds:

1. **Profit-share accounting is simplified.** Close uses a per-position proportional cost-basis
   model, not full FIFO realized-PnL netted across multiple positions/strategies.
2. **Non-base holdings aren't marked to market.** While a position is open, `heldToken` records
   it but the follower's withdrawable `balance` does not reflect its current value (`GAP #2`).
3. **No price oracle.** The on-chain slippage check is a backstop against the router's own quote;
   the off-chain agent is expected to do real slippage-aware quoting.
4. **No security audit.** Do not deploy to mainnet with real funds before one.
5. **Execution agent (off-chain service) not built yet** — watches strategy wallets, computes
   proportional per-follower trades, and calls `executeMirroredTrade`. Holds no user funds.
6. **Dashboard not built yet** — on-chain-sourced strategy performance and follower P&L.

## Non-negotiables

Non-custodial is a core product claim: no change may give the execution agent or owner
withdrawal rights over user principal. Scope stays tight for the mini-grant — one DEX
(Trader Joe), one base asset (USDC), a handful of pilot strategies.
