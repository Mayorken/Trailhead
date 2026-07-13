// Re-calls followStrategy with new risk limits (overwrites the existing follow for that
// strategy -- the contract just stores the latest values, no need to unfollow first).
//
//   VAULT_ADDRESS=0x... STRATEGY_ID=0 SLIPPAGE_BPS=300 POSITION_BPS=5000 \
//     npx hardhat run scripts/fuji-refollow.js --network fuji
const hre = require("hardhat");

async function main() {
  const vaultAddress = process.env.VAULT_ADDRESS;
  const strategyId = process.env.STRATEGY_ID || "0";
  const slippageBps = process.env.SLIPPAGE_BPS || "300";
  const positionBps = process.env.POSITION_BPS || "5000";
  if (!vaultAddress) throw new Error("Set VAULT_ADDRESS");

  const [signer] = await hre.ethers.getSigners();
  const vault = await hre.ethers.getContractAt("FollowerVault", vaultAddress, signer);

  const tx = await vault.followStrategy(strategyId, slippageBps, positionBps);
  const receipt = await tx.wait();
  console.log("Tx:", receipt.hash);

  const follow = await vault.follows(signer.address, strategyId);
  console.log("Now following:", { active: follow.active, maxSlippageBps: follow.maxSlippageBps.toString(), maxPositionSizeBps: follow.maxPositionSizeBps.toString() });
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
