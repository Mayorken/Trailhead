// Human-readable ABI fragments used by the dashboard.

export const registryAbi = [
  "function strategyCount() view returns (uint256)",
  "function getStrategy(uint256) view returns ((address creator,address strategyWallet,uint256 profitShareBps,bool verified,bool active))",
] as const;

export const vaultAbi = [
  "function baseAsset() view returns (address)",
  "function router() view returns (address)",
  "function balance(address) view returns (uint256)",
  "function heldToken(address,address) view returns (uint256)",
  "function costBasis(address,address) view returns (uint256)",
  "function follows(address,uint256) view returns (bool active, uint256 maxSlippageBps, uint256 maxPositionSizeBps)",
  "function deposit(uint256 amount)",
  "function withdraw(uint256 amount)",
  "function followStrategy(uint256 strategyId, uint256 maxSlippageBps, uint256 maxPositionSizeBps)",
  "function unfollowStrategy(uint256 strategyId)",
  "function getNAV(address follower, address[] tokens) view returns (uint256)",
  "event PositionOpened(address indexed follower, uint256 indexed strategyId, address indexed token, uint256 baseSpent, uint256 tokenReceived)",
  "event PositionClosed(address indexed follower, uint256 indexed strategyId, address indexed token, uint256 tokenSold, uint256 baseReceived, uint256 profitShareFee)",
] as const;

export const routerAbi = [
  "function getAmountsOut(uint256 amountIn, address[] path) view returns (uint256[])",
] as const;

export const erc20Abi = [
  "function balanceOf(address) view returns (uint256)",
  "function decimals() view returns (uint8)",
  "function symbol() view returns (string)",
  "function allowance(address owner, address spender) view returns (uint256)",
  "function approve(address spender, uint256 amount) returns (bool)",
] as const;
