const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("StrategyRegistry", function () {
  let registry, owner, creator, other, wallet;

  beforeEach(async function () {
    [owner, creator, other, wallet] = await ethers.getSigners();
    const StrategyRegistry = await ethers.getContractFactory("StrategyRegistry");
    registry = await StrategyRegistry.deploy(owner.address);
    await registry.waitForDeployment();
  });

  async function register(from = creator, share = 1000, w = wallet.address) {
    await registry.connect(from).registerStrategy(w, share);
  }

  describe("registration", function () {
    it("registers a strategy with incrementing ids and correct fields", async function () {
      await expect(registry.connect(creator).registerStrategy(wallet.address, 1000))
        .to.emit(registry, "StrategyRegistered")
        .withArgs(0, creator.address, wallet.address, 1000);

      expect(await registry.strategyCount()).to.equal(1);
      const s = await registry.getStrategy(0);
      expect(s.creator).to.equal(creator.address);
      expect(s.strategyWallet).to.equal(wallet.address);
      expect(s.profitShareBps).to.equal(1000);
      expect(s.verified).to.equal(false);
      expect(s.active).to.equal(true);
    });

    it("allows the maximum 30% profit share", async function () {
      await expect(registry.connect(creator).registerStrategy(wallet.address, 3000)).to.not.be.reverted;
    });

    it("rejects profit share above 30%", async function () {
      await expect(
        registry.connect(creator).registerStrategy(wallet.address, 3001)
      ).to.be.revertedWith("profitShare too high");
    });

    it("rejects a zero strategy wallet", async function () {
      await expect(
        registry.connect(creator).registerStrategy(ethers.ZeroAddress, 1000)
      ).to.be.revertedWith("zero strategyWallet");
    });
  });

  describe("verification (admin advisory)", function () {
    beforeEach(async function () {
      await register();
    });

    it("lets the owner set verified", async function () {
      await expect(registry.connect(owner).setVerified(0, true))
        .to.emit(registry, "StrategyVerifiedSet")
        .withArgs(0, true);
      expect((await registry.getStrategy(0)).verified).to.equal(true);
    });

    it("reverts for non-owner", async function () {
      await expect(registry.connect(creator).setVerified(0, true)).to.be.revertedWithCustomError(
        registry,
        "OwnableUnauthorizedAccount"
      );
    });

    it("reverts on invalid id", async function () {
      await expect(registry.connect(owner).setVerified(99, true)).to.be.revertedWith("invalid strategyId");
    });
  });

  describe("deactivation / reactivation", function () {
    beforeEach(async function () {
      await register();
    });

    it("lets the creator deactivate", async function () {
      await expect(registry.connect(creator).deactivateStrategy(0))
        .to.emit(registry, "StrategyDeactivated")
        .withArgs(0, creator.address);
      expect((await registry.getStrategy(0)).active).to.equal(false);
    });

    it("lets the admin deactivate", async function () {
      await registry.connect(owner).deactivateStrategy(0);
      expect((await registry.getStrategy(0)).active).to.equal(false);
    });

    it("rejects deactivation by an unrelated account", async function () {
      await expect(registry.connect(other).deactivateStrategy(0)).to.be.revertedWith("not authorized");
    });

    it("rejects double-deactivation", async function () {
      await registry.connect(creator).deactivateStrategy(0);
      await expect(registry.connect(creator).deactivateStrategy(0)).to.be.revertedWith("already inactive");
    });

    it("lets only the creator reactivate", async function () {
      await registry.connect(owner).deactivateStrategy(0);
      await expect(registry.connect(owner).reactivateStrategy(0)).to.be.revertedWith("only creator");
      await expect(registry.connect(creator).reactivateStrategy(0))
        .to.emit(registry, "StrategyReactivated")
        .withArgs(0);
      expect((await registry.getStrategy(0)).active).to.equal(true);
    });

    it("rejects reactivating an already-active strategy", async function () {
      await expect(registry.connect(creator).reactivateStrategy(0)).to.be.revertedWith("already active");
    });
  });
});
