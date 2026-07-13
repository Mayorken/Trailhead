// Simulates a "strategy trade": swaps the strategy wallet's own USDC -> WAVAX directly
// through the Joe V1 router (NOT through the vault). This is exactly the kind of on-chain
// swap the execution agent watches strategy wallets for, in order to mirror it into
// followers' vaults proportionally.
//
//   USDC_AMOUNT=0.16 npx hardhat run scripts/fuji-strategy-trade.js --network fuji
const hre = require("hardhat");

const ROUTER = "0xd7f655E3376cE2D7A2b08fF01Eb3B1023191A901";
const USDC = "0xB6076C93701D6a07266c31066B298AeC6dd65c2d";
const WAVAX = "0xd00ae08403B9bbb9124bB305C09058E32C39A48c";

const routerAbi = [
  "function swapExactTokensForTokens(uint256 amountIn, uint256 amountOutMin, address[] path, address to, uint256 deadline) returns (uint256[])",
  "function getAmountsOut(uint256 amountIn, address[] path) view returns (uint256[])",
];
const erc20Abi = [
  "function approve(address spender, uint256 amount) returns (bool)",
  "function balanceOf(address) view returns (uint256)",
];

async function main() {
  const [signer] = await hre.ethers.getSigners();
  const amountIn = hre.ethers.parseUnits(process.env.USDC_AMOUNT || "0.16", 6);
  const router = new hre.ethers.Contract(ROUTER, routerAbi, signer);
  const usdc = new hre.ethers.Contract(USDC, erc20Abi, signer);

  const path = [USDC, WAVAX];
  const quote = await router.getAmountsOut(amountIn, path);
  const expectedOut = quote[quote.length - 1];
  const minOut = (expectedOut * 97n) / 100n;

  console.log(`Strategy wallet (${signer.address}) swapping ${hre.ethers.formatUnits(amountIn, 6)} USDC -> WAVAX`);
  console.log(`Expected ~${hre.ethers.formatEther(expectedOut)} WAVAX`);

  const approveTx = await usdc.approve(ROUTER, amountIn);
  await approveTx.wait();

  const deadline = (await hre.ethers.provider.getBlock("latest")).timestamp + 600;
  const tx = await router.swapExactTokensForTokens(amountIn, minOut, path, signer.address, deadline);
  const receipt = await tx.wait();

  console.log("Tx:", receipt.hash);
  console.log("Block:", receipt.blockNumber);
  console.log("This is the trade the execution agent should detect and mirror.");
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
