const { expect } = require("chai");
const { ethers } = require("hardhat");

// Base and traded token both use 18 decimals in tests to keep the accounting math
// readable; the contract itself is decimals-agnostic.
const e = (n) => ethers.parseUnits(n.toString(), 18);
const PROFIT_SHARE_BPS = 1000n; // 10%

describe("FollowerVault", function () {
  let owner, agent, user, creator, stratWallet, other;
  let usdc, token, router, registry, vault;

  async function deadline() {
    const block = await ethers.provider.getBlock("latest");
    return block.timestamp + 3600;
  }

  async function mkParams(overrides = {}) {
    return {
      follower: user.address,
      strategyId: 0,
      tokenIn: await usdc.getAddress(),
      tokenOut: await token.getAddress(),
      amountIn: e(100),
      minAmountOut: e(97),
      path: [await usdc.getAddress(), await token.getAddress()],
      deadline: await deadline(),
      ...overrides,
    };
  }

  beforeEach(async function () {
    [owner, agent, user, creator, stratWallet, other] = await ethers.getSigners();

    const MockERC20 = await ethers.getContractFactory("MockERC20");
    usdc = await MockERC20.deploy("Mock USDC", "USDC", 18);
    token = await MockERC20.deploy("Mock Token", "TKN", 18);

    const MockDexRouter = await ethers.getContractFactory("MockDexRouter");
    router = await MockDexRouter.deploy();

    const StrategyRegistry = await ethers.getContractFactory("StrategyRegistry");
    registry = await StrategyRegistry.deploy(owner.address);

    const FollowerVault = await ethers.getContractFactory("FollowerVault");
    vault = await FollowerVault.deploy(
      owner.address,
      await usdc.getAddress(),
      await registry.getAddress(),
      await router.getAddress()
    );

    await vault.connect(owner).setExecutionAgent(agent.address);
    await vault.connect(owner).setTokenWhitelisted(await token.getAddress(), true);

    // Strategy 0: creator earns 10% profit share.
    await registry.connect(creator).registerStrategy(stratWallet.address, PROFIT_SHARE_BPS);

    // Fund and deposit for the user.
    await usdc.mint(user.address, e(1000));
    await usdc.connect(user).approve(await vault.getAddress(), e(1000));
    await vault.connect(user).deposit(e(1000));
  });

  describe("admin", function () {
    it("only owner sets the execution agent / router / whitelist", async function () {
      await expect(vault.connect(other).setExecutionAgent(other.address)).to.be.revertedWithCustomError(
        vault,
        "OwnableUnauthorizedAccount"
      );
      await expect(vault.connect(other).setTokenWhitelisted(await token.getAddress(), true))
        .to.be.revertedWithCustomError(vault, "OwnableUnauthorizedAccount");
    });
  });

  describe("deposit / withdraw", function () {
    it("tracks balances and totalDeposits", async function () {
      expect(await vault.balance(user.address)).to.equal(e(1000));
      expect(await vault.totalDeposits()).to.equal(e(1000));
    });

    it("allows withdrawal of the full balance", async function () {
      await expect(vault.connect(user).withdraw(e(400)))
        .to.emit(vault, "Withdrawn")
        .withArgs(user.address, e(400));
      expect(await vault.balance(user.address)).to.equal(e(600));
      expect(await usdc.balanceOf(user.address)).to.equal(e(400));
    });

    it("rejects over-withdrawal and zero amounts", async function () {
      await expect(vault.connect(user).withdraw(e(2000))).to.be.revertedWith("insufficient balance");
      await expect(vault.connect(user).withdraw(0)).to.be.revertedWith("zero amount");
    });
  });

  describe("follow / unfollow", function () {
    it("follows within the caps and stores limits", async function () {
      await expect(vault.connect(user).followStrategy(0, 300, 5000))
        .to.emit(vault, "Followed")
        .withArgs(user.address, 0, 300, 5000);
      const f = await vault.follows(user.address, 0);
      expect(f.active).to.equal(true);
      expect(f.maxSlippageBps).to.equal(300);
      expect(f.maxPositionSizeBps).to.equal(5000);
    });

    it("enforces the 5% slippage cap", async function () {
      await expect(vault.connect(user).followStrategy(0, 501, 5000)).to.be.revertedWith("slippage above cap");
      await expect(vault.connect(user).followStrategy(0, 500, 5000)).to.not.be.reverted;
    });

    it("enforces the 50% position-size cap and non-zero size", async function () {
      await expect(vault.connect(user).followStrategy(0, 300, 5001)).to.be.revertedWith("position above cap");
      await expect(vault.connect(user).followStrategy(0, 300, 0)).to.be.revertedWith("position size zero");
    });

    it("rejects following an inactive strategy", async function () {
      await registry.connect(creator).deactivateStrategy(0);
      await expect(vault.connect(user).followStrategy(0, 300, 5000)).to.be.revertedWith("strategy inactive");
    });

    it("unfollows", async function () {
      await vault.connect(user).followStrategy(0, 300, 5000);
      await expect(vault.connect(user).unfollowStrategy(0))
        .to.emit(vault, "Unfollowed")
        .withArgs(user.address, 0);
      expect((await vault.follows(user.address, 0)).active).to.equal(false);
      await expect(vault.connect(user).unfollowStrategy(0)).to.be.revertedWith("not following");
    });
  });

  describe("executeMirroredTrade — access & validation", function () {
    beforeEach(async function () {
      await vault.connect(user).followStrategy(0, 300, 5000);
    });

    it("is callable only by the execution agent", async function () {
      const p = await mkParams();
      await expect(vault.connect(other).executeMirroredTrade(p)).to.be.revertedWith("not execution agent");
      await expect(vault.connect(owner).executeMirroredTrade(p)).to.be.revertedWith("not execution agent");
    });

    it("reverts when the follower is not following", async function () {
      const p = await mkParams({ follower: other.address });
      await expect(vault.connect(agent).executeMirroredTrade(p)).to.be.revertedWith("follower not following");
    });

    it("reverts for a non-whitelisted token", async function () {
      await vault.connect(owner).setTokenWhitelisted(await token.getAddress(), false);
      const p = await mkParams();
      await expect(vault.connect(agent).executeMirroredTrade(p)).to.be.revertedWith("token not whitelisted");
    });

    it("rejects base-to-base and token-to-token trades", async function () {
      const usdcAddr = await usdc.getAddress();
      const tokenAddr = await token.getAddress();
      const baseToBase = await mkParams({ tokenOut: usdcAddr, path: [usdcAddr, usdcAddr] });
      await expect(vault.connect(agent).executeMirroredTrade(baseToBase)).to.be.revertedWith("base to base");

      const tokenToToken = await mkParams({
        tokenIn: tokenAddr,
        tokenOut: tokenAddr,
        path: [tokenAddr, tokenAddr],
      });
      await expect(vault.connect(agent).executeMirroredTrade(tokenToToken)).to.be.revertedWith(
        "must involve base asset"
      );
    });

    it("enforces the position-size cap", async function () {
      // 50% of 1000 = 500; 600 must revert.
      const p = await mkParams({ amountIn: e(600), minAmountOut: e(582) });
      await expect(vault.connect(agent).executeMirroredTrade(p)).to.be.revertedWith(
        "exceeds max position size"
      );
    });

    it("enforces the slippage floor against the router quote", async function () {
      // quote at 1:1 = 100; 3% cap => floor 97. minAmountOut 96 must revert.
      const tooLow = await mkParams({ minAmountOut: e(96) });
      await expect(vault.connect(agent).executeMirroredTrade(tooLow)).to.be.revertedWith(
        "minAmountOut below slippage floor"
      );
    });

    it("reverts if real execution slips below minAmountOut (router backstop)", async function () {
      // Follower allows 3%; router executes at 4% worse than quote.
      await router.setExecutionSlippage(400);
      const p = await mkParams({ minAmountOut: e(97) });
      await expect(vault.connect(agent).executeMirroredTrade(p)).to.be.revertedWith(
        "insufficient output amount"
      );
    });
  });

  describe("executeMirroredTrade — open & close accounting", function () {
    beforeEach(async function () {
      await vault.connect(user).followStrategy(0, 300, 5000);
    });

    it("opens a position: debits base, credits holding and cost basis", async function () {
      const p = await mkParams(); // 100 in at 1:1
      await expect(vault.connect(agent).executeMirroredTrade(p))
        .to.emit(vault, "PositionOpened")
        .withArgs(user.address, 0, await token.getAddress(), e(100), e(100));

      expect(await vault.balance(user.address)).to.equal(e(900));
      expect(await vault.totalDeposits()).to.equal(e(900));
      expect(await vault.heldToken(user.address, await token.getAddress())).to.equal(e(100));
      expect(await vault.costBasis(user.address, await token.getAddress())).to.equal(e(100));
    });

    it("closes a position at a profit and pays the creator's profit share", async function () {
      // Open 100 @ 1:1.
      await vault.connect(agent).executeMirroredTrade(await mkParams());

      // Close 100 token @ 2:1 => 200 base out. gain 100, fee 10% = 10.
      await router.setRate(2, 1);
      const tokenAddr = await token.getAddress();
      const usdcAddr = await usdc.getAddress();
      const closeP = await mkParams({
        tokenIn: tokenAddr,
        tokenOut: usdcAddr,
        amountIn: e(100),
        minAmountOut: e(194),
        path: [tokenAddr, usdcAddr],
      });

      await expect(vault.connect(agent).executeMirroredTrade(closeP))
        .to.emit(vault, "PositionClosed")
        .withArgs(user.address, 0, tokenAddr, e(100), e(200), e(10));

      // Follower gets net proceeds; creator gets the fee.
      expect(await vault.balance(user.address)).to.equal(e(900) + e(190));
      expect(await usdc.balanceOf(creator.address)).to.equal(e(10));
      expect(await vault.heldToken(user.address, tokenAddr)).to.equal(0);
      expect(await vault.costBasis(user.address, tokenAddr)).to.equal(0);
    });

    it("closes a position at a loss with no profit share", async function () {
      await vault.connect(agent).executeMirroredTrade(await mkParams());

      // Close @ 1:2 => 50 base out, below the 100 basis: no fee.
      await router.setRate(1, 2);
      const tokenAddr = await token.getAddress();
      const usdcAddr = await usdc.getAddress();
      const closeP = await mkParams({
        tokenIn: tokenAddr,
        tokenOut: usdcAddr,
        amountIn: e(100),
        minAmountOut: e(49), // floor = 50 quote * 97% = 48.5
        path: [tokenAddr, usdcAddr],
      });

      await vault.connect(agent).executeMirroredTrade(closeP);

      expect(await vault.balance(user.address)).to.equal(e(900) + e(50));
      expect(await usdc.balanceOf(creator.address)).to.equal(0);
    });

    it("handles a partial close with proportional cost basis", async function () {
      await vault.connect(agent).executeMirroredTrade(await mkParams()); // hold 100, basis 100

      // Sell half (50 token) @ 2:1 => 100 base out. Basis portion = 100 * 50/100 = 50.
      // gain 50, fee 10% = 5.
      await router.setRate(2, 1);
      const tokenAddr = await token.getAddress();
      const usdcAddr = await usdc.getAddress();
      const closeP = await mkParams({
        tokenIn: tokenAddr,
        tokenOut: usdcAddr,
        amountIn: e(50),
        minAmountOut: e(97),
        path: [tokenAddr, usdcAddr],
      });

      await vault.connect(agent).executeMirroredTrade(closeP);

      expect(await vault.heldToken(user.address, tokenAddr)).to.equal(e(50));
      expect(await vault.costBasis(user.address, tokenAddr)).to.equal(e(50));
      expect(await usdc.balanceOf(creator.address)).to.equal(e(5));
      expect(await vault.balance(user.address)).to.equal(e(900) + e(95)); // 100 out - 5 fee
    });
  });

  describe("reentrancy", function () {
    it("blocks a reentrant withdraw via a malicious base asset", async function () {
      const MockReentrantToken = await ethers.getContractFactory("MockReentrantToken");
      const evil = await MockReentrantToken.deploy();

      const StrategyRegistry = await ethers.getContractFactory("StrategyRegistry");
      const reg = await StrategyRegistry.deploy(owner.address);
      const FollowerVault = await ethers.getContractFactory("FollowerVault");
      const evilVault = await FollowerVault.deploy(
        owner.address,
        await evil.getAddress(),
        await reg.getAddress(),
        await router.getAddress()
      );

      await evil.setTarget(await evilVault.getAddress());
      await evil.mint(user.address, e(100));
      await evil.connect(user).approve(await evilVault.getAddress(), e(100));
      await evilVault.connect(user).deposit(e(100));

      await evil.setAttack(true);
      await expect(evilVault.connect(user).withdraw(e(50))).to.be.revertedWithCustomError(
        evilVault,
        "ReentrancyGuardReentrantCall"
      );
    });
  });
});
