// Acquire LFJ testnet USDC on Fuji by swapping AVAX through the live Joe V1 pools.
//
// The Circle/Avalanche faucet USDC is a DIFFERENT token than the one in Trader Joe's Fuji
// pools, so this converts faucet AVAX straight into pool-compatible USDC. Requires only
// Fuji AVAX in the PRIVATE_KEY wallet (from https://faucet.avax.network).
//
//   AVAX_IN=1 npx hardhat run scripts/fuji-get-usdc.js --network fuji
const hre = require("hardhat");

const ROUTER = "0xd7f655E3376cE2D7A2b08fF01Eb3B1023191A901";
const WAVAX = "0xd00ae08403B9bbb9124bB305C09058E32C39A48c";
const USDC = process.env.BASE_ASSET || "0xB6076C93701D6a07266c31066B298AeC6dd65c2d";

const routerAbi = [
  "function swapExactAVAXForTokens(uint256 amountOutMin, address[] path, address to, uint256 deadline) payable returns (uint256[])",
  "function getAmountsOut(uint256 amountIn, address[] path) view returns (uint256[])",
];
const erc20Abi = ["function balanceOf(address) view returns (uint256)", "function decimals() view returns (uint8)"];

async function main() {
  const [signer] = await hre.ethers.getSigners();
  const avaxIn = hre.ethers.parseEther(process.env.AVAX_IN || "1");
  const router = new hre.ethers.Contract(ROUTER, routerAbi, signer);
  const usdc = new hre.ethers.Contract(USDC, erc20Abi, signer);

  const path = [WAVAX, USDC];
  const quote = await router.getAmountsOut(avaxIn, path);
  const expectedOut = quote[quote.length - 1];
  const minOut = (expectedOut * 97n) / 100n; // 3% slippage
  const decimals = Number(await usdc.decimals());

  console.log(`Swapping ${hre.ethers.formatEther(avaxIn)} AVAX -> USDC`);
  console.log(`Expected ~${hre.ethers.formatUnits(expectedOut, decimals)} USDC (min ${hre.ethers.formatUnits(minOut, decimals)})`);

  const before = await usdc.balanceOf(signer.address);
  const deadline = (await hre.ethers.provider.getBlock("latest")).timestamp + 600;
  const tx = await router.swapExactAVAXForTokens(minOut, path, signer.address, deadline, { value: avaxIn });
  console.log("tx:", tx.hash);
  await tx.wait();
  const after = await usdc.balanceOf(signer.address);

  console.log(`Received ${hre.ethers.formatUnits(after - before, decimals)} USDC`);
  console.log(`USDC balance: ${hre.ethers.formatUnits(after, decimals)} (${signer.address})`);
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
