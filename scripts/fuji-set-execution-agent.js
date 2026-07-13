// Sets the executionAgent on the live Fuji FollowerVault. Owner-only call; uses the
// deployer key already in .env. Only needs the agent's ADDRESS, never its private key.
//
//   VAULT_ADDRESS=0x... AGENT_ADDRESS=0x... npx hardhat run scripts/fuji-set-execution-agent.js --network fuji
const hre = require("hardhat");

async function main() {
  const vaultAddress = process.env.VAULT_ADDRESS;
  const agentAddress = process.env.AGENT_ADDRESS;
  if (!vaultAddress) throw new Error("Set VAULT_ADDRESS");
  if (!agentAddress) throw new Error("Set AGENT_ADDRESS");

  const [signer] = await hre.ethers.getSigners();
  const vault = await hre.ethers.getContractAt("FollowerVault", vaultAddress, signer);

  const tx = await vault.setExecutionAgent(agentAddress);
  const receipt = await tx.wait();
  console.log("Tx:", receipt.hash);

  const onChain = await vault.executionAgent();
  console.log("executionAgent is now:", onChain);
  console.log("Match:", onChain.toLowerCase() === agentAddress.toLowerCase());
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
