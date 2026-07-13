const hre = require("hardhat");

// Deploys StrategyRegistry + FollowerVault.
//
// Required env for a live network (Fuji/mainnet):
//   BASE_ASSET       - ERC20 base asset (e.g. USDC on the target chain)
//   DEX_ROUTER       - Trader Joe router address
//   EXECUTION_AGENT  - hot-wallet address allowed to call executeMirroredTrade (optional)
//   WHITELIST_TOKENS - comma-separated tokens the vault may swap into
//   PRICE_FEEDS      - comma-separated token:feed pairs (Chainlink AggregatorV3Interface).
//                      A token can't actually be opened into until it has both a whitelist
//                      entry AND a price feed -- opens hard-require a fresh oracle price.
//
// On the in-process `hardhat` network these are not set, so the script deploys mocks
// (MockERC20 base asset + MockDexRouter) so a dry run works out of the box.
async function main() {
  const [deployer] = await hre.ethers.getSigners();
  const owner = deployer.address;
  console.log("Deployer / owner:", owner);

  let baseAsset = process.env.BASE_ASSET;
  let router = process.env.DEX_ROUTER;

  if (!baseAsset || !router) {
    console.log("BASE_ASSET / DEX_ROUTER not set — deploying mocks for a dry run.");
    const MockERC20 = await hre.ethers.getContractFactory("MockERC20");
    const usdc = await MockERC20.deploy("Mock USDC", "USDC", 6);
    await usdc.waitForDeployment();
    baseAsset = await usdc.getAddress();
    console.log("MockERC20 (base asset):", baseAsset);

    const MockDexRouter = await hre.ethers.getContractFactory("MockDexRouter");
    const mockRouter = await MockDexRouter.deploy();
    await mockRouter.waitForDeployment();
    router = await mockRouter.getAddress();
    console.log("MockDexRouter:", router);
  }

  const StrategyRegistry = await hre.ethers.getContractFactory("StrategyRegistry");
  const registry = await StrategyRegistry.deploy(owner);
  await registry.waitForDeployment();
  const registryAddr = await registry.getAddress();
  console.log("StrategyRegistry:", registryAddr);

  const FollowerVault = await hre.ethers.getContractFactory("FollowerVault");
  const vault = await FollowerVault.deploy(owner, baseAsset, registryAddr, router);
  await vault.waitForDeployment();
  const vaultAddr = await vault.getAddress();
  console.log("FollowerVault:", vaultAddr);

  if (process.env.EXECUTION_AGENT) {
    const tx = await vault.setExecutionAgent(process.env.EXECUTION_AGENT);
    await tx.wait();
    console.log("Execution agent set to:", process.env.EXECUTION_AGENT);
  }

  // Whitelist the tokens the vault may swap into (comma-separated addresses).
  const whitelist = (process.env.WHITELIST_TOKENS || "")
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s !== "");
  for (const token of whitelist) {
    const tx = await vault.setTokenWhitelisted(token, true);
    await tx.wait();
    console.log("Whitelisted token:", token);
  }

  // Wire price feeds (comma-separated "token:feed" pairs). Without one, a whitelisted
  // token can still be closed out of but never newly opened into (see FollowerVault's
  // oracle sanity-check).
  const priceFeedPairs = (process.env.PRICE_FEEDS || "")
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s !== "");
  const priceFeeds = {};
  for (const pair of priceFeedPairs) {
    const [token, feed] = pair.split(":").map((s) => s.trim());
    if (!token || !feed) throw new Error(`Malformed PRICE_FEEDS entry: "${pair}" (expected token:feed)`);
    const tx = await vault.setPriceFeed(token, feed);
    await tx.wait();
    console.log("Price feed set:", token, "->", feed);
    priceFeeds[token] = feed;
  }

  const unfedWhitelisted = whitelist.filter((t) => !priceFeeds[t]);
  if (unfedWhitelisted.length > 0) {
    console.log(
      "\nWarning: whitelisted without a price feed (closable but not openable until setPriceFeed is called):",
      unfedWhitelisted
    );
  }

  console.log("\nDeployment complete.");
  console.log(
    JSON.stringify(
      { registry: registryAddr, vault: vaultAddr, baseAsset, router, whitelisted: whitelist, priceFeeds },
      null,
      2
    )
  );
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
