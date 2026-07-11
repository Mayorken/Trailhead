// Live integration run against a local hardhat node seeded by contracts/scripts/e2e-setup.js.
// Not part of `npm test` (filename isn't *.test.ts). Run manually:
//
//   E2E_FILE=/path/e2e.json node --import tsx test/e2e.integration.ts
//
// Drives the REAL watcher + follower index + executor once and asserts the follower's
// mirrored position actually opened on-chain.
import { readFileSync } from "node:fs";
import assert from "node:assert/strict";
import { ethers } from "ethers";
import type { AgentConfig } from "../src/config.js";
import { connectChain } from "../src/chain.js";
import { FollowerIndex } from "../src/followerIndex.js";
import { StrategyWatcher } from "../src/watcher.js";
import { Executor } from "../src/executor.js";
import { erc20Abi } from "../src/abis.js";

async function main(): Promise<void> {
  const file = process.env.E2E_FILE || "e2e.json";
  const fx = JSON.parse(readFileSync(file, "utf8"));

  const cfg: AgentConfig = {
    rpcUrl: fx.rpcUrl,
    agentPrivateKey: fx.agentPrivateKey,
    registryAddress: fx.registry,
    vaultAddress: fx.vault,
    strategyIds: [0n],
    pollIntervalMs: 1000,
    startBlock: fx.startBlock,
    vaultDeployBlock: 0,
    deadlineSecs: 600,
    minTradeWei: 0n,
    dryRun: false,
  };

  const chain = await connectChain(cfg);
  const followers = new FollowerIndex(chain, cfg.strategyIds, cfg.vaultDeployBlock);
  const watcher = new StrategyWatcher(chain, cfg.strategyIds);
  const executor = new Executor(chain, cfg);

  const token = new ethers.Contract(fx.token, erc20Abi, chain.provider);
  const heldBefore: bigint = await chain.vault.heldToken(fx.follower, fx.token);
  const balBefore: bigint = await chain.vault.balance(fx.follower);
  console.log(`follower before: balance=${balBefore} held=${heldBefore}`);

  await watcher.refreshStrategies();

  const head = await chain.provider.getBlockNumber();
  await followers.sync(head);
  const trades = await watcher.scan(fx.startBlock, head);
  console.log(`detected ${trades.length} strategy trade(s)`);
  assert.equal(trades.length, 1, "expected exactly one detected strategy trade");

  for (const trade of trades) {
    const set = followers.followersOf(trade.strategyId);
    console.log(`mirroring to ${set.length} follower(s)`);
    assert.equal(set.length, 1, "expected exactly one follower");
    await executor.mirror(trade, set);
  }

  const heldAfter: bigint = await chain.vault.heldToken(fx.follower, fx.token);
  const balAfter: bigint = await chain.vault.balance(fx.follower);
  console.log(`follower after:  balance=${balAfter} held=${heldAfter}`);

  // Strategy spent 20% of 1000; follower had 1000 base -> mirror 200 base into the token.
  assert.equal(balAfter, ethers.parseUnits("800", 18), "follower base balance should drop by 200");
  assert.equal(heldAfter, ethers.parseUnits("200", 18), "follower should hold 200 of the token");
  assert.equal(await token.balanceOf(fx.vault), heldAfter, "vault token balance should back the holding");

  console.log("\nE2E PASSED: agent mirrored the strategy trade into the follower vault.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
