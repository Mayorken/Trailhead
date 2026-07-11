# Deploying Trailhead to Fuji (Trader Joe / LFJ V1)

Target: Avalanche **Fuji** testnet (chainId `43113`), base asset **USDC**, DEX **Joe V1 router**.
Verified live: the V1 `USDC/WAVAX`, `USDC/USDT`, and `USDT/WAVAX` pools hold liquidity, so real
swaps work with no liquidity-seeding on your part.

## Confirmed Fuji addresses (LFJ docs, on-chain checked)

| Contract | Address |
|---|---|
| Joe V1 Router (JoeRouter02) | `0xd7f655E3376cE2D7A2b08fF01Eb3B1023191A901` |
| Joe V1 Factory | `0xF5c7d9733e5f53abCC1695820c4818C59B457C2C` |
| USDC (6 decimals, base asset) | `0xB6076C93701D6a07266c31066B298AeC6dd65c2d` |
| USDT | `0xAb231A5744C8E6c45481754928cCfFFFD4aa0732` |
| WAVAX (whitelisted swap target) | `0xd00ae08403B9bbb9124bB305C09058E32C39A48c` |

## What you provide (I can't handle keys or funds)

1. **Deployer wallet** — a private key with Fuji AVAX for gas. Faucet: https://faucet.avax.network
2. **Agent hot wallet** — a *separate* private key (its address becomes `executionAgent`). Fund it
   with a little Fuji AVAX for gas. It never holds user funds.
3. *(optional)* **Snowtrace API key** for source verification.

These go into `.env` (git-ignored). I never see them.

## Steps

### 1. Configure
```bash
cp .env.example .env
# .env is pre-filled with the Fuji USDC/router/WAVAX addresses above. Add:
#   PRIVATE_KEY=<deployer key>
#   EXECUTION_AGENT=<agent hot-wallet ADDRESS>
#   SNOWTRACE_API_KEY=<optional>
```

### 2. Get pool-compatible USDC (for testing the vault later)
The Circle/Avalanche faucet USDC is a *different* token than the one in Joe's pools, so acquire
USDC by swapping faucet AVAX through the live pool:
```bash
AVAX_IN=1 npx hardhat run scripts/fuji-get-usdc.js --network fuji
```
(Needed only to *use* the vault — deposit/follow/trade. Deployment itself just needs AVAX gas.)

### 3. Deploy
```bash
npm run deploy:fuji
```
This deploys `StrategyRegistry` + `FollowerVault` pointed at the real router, sets the execution
agent, and whitelists WAVAX (`WHITELIST_TOKENS` in `.env`). Note the printed `registry` and
`vault` addresses.

### 4. Point the agent and dashboard at the deployment
```bash
# agent/.env
RPC_URL=https://api.avax-test.network/ext/bc/C/rpc
AGENT_PRIVATE_KEY=<agent hot-wallet key>
REGISTRY_ADDRESS=<from step 3>
VAULT_ADDRESS=<from step 3>
VAULT_DEPLOY_BLOCK=<deploy block>
DRY_RUN=true          # start dry; flip to false once you trust it

# dashboard/.env
VITE_RPC_URL=https://api.avax-test.network/ext/bc/C/rpc
VITE_CHAIN_ID=43113
VITE_REGISTRY_ADDRESS=<from step 3>
VITE_VAULT_ADDRESS=<from step 3>
```

### 5. (optional) Verify source on Snowtrace
```bash
npx hardhat verify --network fuji <registry> <ownerAddress>
npx hardhat verify --network fuji <vault> <owner> <usdc> <registry> <router>
```

## Live end-to-end (once deployed)

1. Register a strategy pointing at a wallet you control (via the dashboard or a script).
2. Deposit USDC and follow it from a second wallet (the follower).
3. From the strategy wallet, make a real `USDC -> WAVAX` swap on the Joe V1 router.
4. Run the agent (`DRY_RUN=false`) — it detects the swap and mirrors it into the follower vault.
5. Watch the position and P&L update on the dashboard.

## What I do vs. what you do

- **I prepare/run:** all config, scripts, the deploy command, wiring agent/dashboard env, Snowtrace
  verification, and driving the on-chain reads.
- **You do:** create/fund the two wallets and paste their keys into `.env` (I won't enter private
  keys), and approve any wallet prompts. Nothing here moves mainnet funds — Fuji is testnet-only.
