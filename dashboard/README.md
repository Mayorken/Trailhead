# Trailhead Dashboard

Minimal web UI for Trailhead. All performance and balance data is read **directly from chain**
(nothing self-reported), and every state-changing action is signed by the user's own wallet —
the dashboard never custodies funds or holds keys.

> **Status:** MVP. Defaults to the live Fuji deployment. Write actions
> (deposit/withdraw/follow) require an injected wallet on Avalanche Fuji.

## Features

- **Strategies** — lists every registered strategy from `StrategyRegistry` with its profit
  share, active state, and admin `verified` badge. Follow (with your own slippage/position
  limits) or unfollow.
- **Your vault** — withdrawable base balance, open positions valued **mark-to-market** via the
  DEX router quote (this is the read-side answer to contract `GAP #2`), cost basis, and
  unrealized P&L per position and in aggregate.
- **Deposit / withdraw** — approve + deposit or withdraw the base asset.

## Stack

Vite + React + TypeScript + ethers v6. Reads use a plain `JsonRpcProvider` (so data shows
before a wallet connects); writes use the injected `BrowserProvider` (MetaMask / Core).

## Usage

```bash
npm install
cp .env.example .env      # set VITE_REGISTRY_ADDRESS + VITE_VAULT_ADDRESS (+ RPC / chain)
npm run typecheck
npm run build
npm run dev               # http://localhost:5173
```

### Config (`VITE_` env)

| Var | Meaning |
|-----|---------|
| `VITE_RPC_URL` | Read RPC endpoint (default: Fuji public RPC) |
| `VITE_CHAIN_ID` | Target chain id (43113 Fuji / 43114 mainnet) |
| `VITE_REGISTRY_ADDRESS` | Deployed `StrategyRegistry` (defaults to `0xBc17524a677f0AB0b0a817B5890cC3A2eDA14Dac`) |
| `VITE_VAULT_ADDRESS` | Deployed `FollowerVault` (defaults to `0x992D51421E5A53c402c09B6d07a0eF7A78fe88B1`) |
| `VITE_DEMO_ADDRESS` | Optional — show this address's position read-only (demo/verification) |

## Notes / next steps

- Held tokens are discovered from `PositionOpened` events for the viewed address, then valued
  live via `router.getAmountsOut`. A token with no route shows an unvalued (0) position.
- Realized P&L history (from `PositionClosed` events) and a strategy performance chart are the
  natural next additions.
- The default contracts are deployed on Avalanche Fuji; override the address variables for
  another deployment.
