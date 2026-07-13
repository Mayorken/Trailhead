// Local end-to-end fixture for the execution agent.
//
// Deploys registry + vault + mocks on a running `hardhat node`, wires up one strategy and
// one follower, then has the strategy wallet perform a real router swap (the trade the agent
// must mirror). Writes the deployed addresses + the pre-swap block to E2E_FILE so the agent
// integration run can pick them up.
//
//   Terminal 1: npx hardhat node
//   Terminal 2: E2E_FILE=/path/e2e.json npx hardhat run scripts/e2e-setup.js --network localhost
const hre = require("hardhat");
const fs = require("fs");

const e = (n) => hre.ethers.parseUnits(n.toString(), 18);

async function main() {
  const [owner, agent, strategyWallet, follower] = await hre.ethers.getSigners();

  const MockERC20 = await hre.ethers.getContractFactory("MockERC20");
  const usdc = await MockERC20.deploy("Mock USDC", "USDC", 18);
  const token = await MockERC20.deploy("Mock Token", "TKN", 18);

  const MockDexRouter = await hre.ethers.getContractFactory("MockDexRouter");
  const router = await MockDexRouter.deploy();

  const StrategyRegistry = await hre.ethers.getContractFactory("StrategyRegistry");
  const registry = await StrategyRegistry.deploy(owner.address);

  const FollowerVault = await hre.ethers.getContractFactory("FollowerVault");
  const vault = await FollowerVault.deploy(
    owner.address,
    await usdc.getAddress(),
    await registry.getAddress(),
    await router.getAddress()
  );

  const MockPriceFeed = await hre.ethers.getContractFactory("MockPriceFeed");
  const priceFeed = await MockPriceFeed.deploy(8, 100_000_000); // $1.00 at 8 decimals

  await (await vault.setExecutionAgent(agent.address)).wait();
  await (await vault.setTokenWhitelisted(await token.getAddress(), true)).wait();
  await (await vault.setPriceFeed(await token.getAddress(), await priceFeed.getAddress())).wait();

  // Strategy 0: 10% profit share, mirrored wallet = strategyWallet.
  await (await registry.connect(strategyWallet).registerStrategy(strategyWallet.address, 1000)).wait();

  // Follower deposits 1000 and follows with 3% slippage / 50% position caps.
  await (await usdc.mint(follower.address, e(1000))).wait();
  await (await usdc.connect(follower).approve(await vault.getAddress(), e(1000))).wait();
  await (await vault.connect(follower).deposit(e(1000))).wait();
  await (await vault.connect(follower).followStrategy(0, 300, 5000)).wait();

  // Fund the strategy wallet so its base-asset balance is meaningful for proportional sizing.
  await (await usdc.mint(strategyWallet.address, e(1000))).wait();

  const startBlock = await hre.ethers.provider.getBlockNumber();

  // The strategy makes its trade: swap 200 USDC -> TKN (20% of its 1000 holding).
  const deadline = (await hre.ethers.provider.getBlock("latest")).timestamp + 600;
  await (await usdc.connect(strategyWallet).approve(await router.getAddress(), e(200))).wait();
  await (
    await router
      .connect(strategyWallet)
      .swapExactTokensForTokens(e(200), 0, [await usdc.getAddress(), await token.getAddress()], strategyWallet.address, deadline)
  ).wait();

  const out = {
    rpcUrl: "http://127.0.0.1:8545",
    registry: await registry.getAddress(),
    vault: await vault.getAddress(),
    router: await router.getAddress(),
    baseAsset: await usdc.getAddress(),
    token: await token.getAddress(),
    follower: follower.address,
    strategyWallet: strategyWallet.address,
    agent: agent.address,
    // Hardhat default account #1 (agent) — well-known devnet key, safe to hardcode for local e2e.
    agentPrivateKey: "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d",
    startBlock,
  };

  const file = process.env.E2E_FILE || "e2e.json";
  fs.writeFileSync(file, JSON.stringify(out, null, 2));
  console.log("Wrote", file);
  console.log(out);
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
