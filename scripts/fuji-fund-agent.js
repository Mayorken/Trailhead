// Sends a small amount of Fuji AVAX (gas only) from the owner wallet to the execution agent
// address. The agent needs gas to submit executeMirroredTrade transactions; it should never
// hold user funds.
//
//   AGENT_ADDRESS=0x... AMOUNT=0.3 npx hardhat run scripts/fuji-fund-agent.js --network fuji
const hre = require("hardhat");

async function main() {
  const agentAddress = process.env.AGENT_ADDRESS;
  const amount = process.env.AMOUNT || "0.3";
  if (!agentAddress) throw new Error("Set AGENT_ADDRESS");

  const [signer] = await hre.ethers.getSigners();
  const tx = await signer.sendTransaction({
    to: agentAddress,
    value: hre.ethers.parseEther(amount),
  });
  const receipt = await tx.wait();
  console.log("Tx:", receipt.hash);

  const balance = await hre.ethers.provider.getBalance(agentAddress);
  console.log(`Agent (${agentAddress}) balance: ${hre.ethers.formatEther(balance)} AVAX`);
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
