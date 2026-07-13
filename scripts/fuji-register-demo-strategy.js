// Registers one demo strategy on the live Fuji StrategyRegistry so the deployed dashboard
// has something to display instead of an empty list. Uses the deployer's own address as the
// strategyWallet (no trading activity implied — purely so the UI has a real, on-chain row).
//
//   REGISTRY_ADDRESS=0x... npx hardhat run scripts/fuji-register-demo-strategy.js --network fuji
const hre = require("hardhat");

async function main() {
  const registryAddress = process.env.REGISTRY_ADDRESS || process.env.npm_config_registry;
  if (!registryAddress) throw new Error("Set REGISTRY_ADDRESS");

  const [signer] = await hre.ethers.getSigners();
  const registry = await hre.ethers.getContractAt("StrategyRegistry", registryAddress, signer);

  const profitShareBps = 1000; // 10%
  const tx = await registry.registerStrategy(signer.address, profitShareBps);
  const receipt = await tx.wait();

  const count = await registry.strategyCount();
  const strategyId = count - 1n;
  const strategy = await registry.getStrategy(strategyId);

  console.log("Registered strategy id:", strategyId.toString());
  console.log("Tx:", receipt.hash);
  console.log(strategy);
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
