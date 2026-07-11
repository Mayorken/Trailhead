// Local-only helper: fund an external wallet on the hardhat node so it can test the UI.
// Sends gas (ETH) and mints mock base-asset tokens to USER_ADDR.
//
//   E2E_FILE=/path/e2e.json USER_ADDR=0x... npx hardhat run scripts/local-fund.js --network localhost
const hre = require("hardhat");
const fs = require("fs");

async function main() {
  const file = process.env.E2E_FILE || "e2e.json";
  const fx = JSON.parse(fs.readFileSync(file, "utf8"));
  const user = process.env.USER_ADDR;
  if (!user) throw new Error("Set USER_ADDR to the wallet address to fund");

  const [funder] = await hre.ethers.getSigners();
  await (await funder.sendTransaction({ to: user, value: hre.ethers.parseEther("10") })).wait();

  const usdc = await hre.ethers.getContractAt("MockERC20", fx.baseAsset);
  await (await usdc.mint(user, hre.ethers.parseUnits("1000", 18))).wait();

  const eth = await hre.ethers.provider.getBalance(user);
  const bal = await usdc.balanceOf(user);
  console.log(`funded ${user}: ${hre.ethers.formatEther(eth)} ETH, ${hre.ethers.formatUnits(bal, 18)} USDC`);
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
