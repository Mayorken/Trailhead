// Human-readable ABIs — only the fragments the agent needs. Kept inline so the worker
// is decoupled from the Hardhat build output.

export const registryAbi = [
  "function strategyCount() view returns (uint256)",
  "function getStrategy(uint256) view returns ((address creator,address strategyWallet,uint256 profitShareBps,bool verified,bool active))",
] as const;

export const vaultAbi = [
  "function baseAsset() view returns (address)",
  "function router() view returns (address)",
  "function executionAgent() view returns (address)",
  "function balance(address) view returns (uint256)",
  "function heldToken(address,address) view returns (uint256)",
  "function tokenWhitelisted(address) view returns (bool)",
  "function follows(address,uint256) view returns (bool active, uint256 maxSlippageBps, uint256 maxPositionSizeBps)",
  "function executeMirroredTrade((address follower,uint256 strategyId,address tokenIn,address tokenOut,uint256 amountIn,uint256 minAmountOut,address[] path,uint256 deadline) p) returns (uint256)",
  "event Followed(address indexed user, uint256 indexed strategyId, uint256 maxSlippageBps, uint256 maxPositionSizeBps)",
  "event Unfollowed(address indexed user, uint256 indexed strategyId)",
] as const;

// UniswapV2 / Trader Joe router surface. `swapExactTokensForTokens` is also used to
// decode a strategy wallet's own trades from block calldata.
export const routerAbi = [
  "function getAmountsOut(uint256 amountIn, address[] path) view returns (uint256[])",
  "function swapExactTokensForTokens(uint256 amountIn, uint256 amountOutMin, address[] path, address to, uint256 deadline) returns (uint256[])",
] as const;

export const erc20Abi = [
  "function balanceOf(address) view returns (uint256)",
  "function decimals() view returns (uint8)",
  "function symbol() view returns (string)",
] as const;
