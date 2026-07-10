// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

/// @title StrategyRegistry
/// @notice Permissionless registry of copy-trading strategies. Anyone can register a
///         strategy by pointing at a `strategyWallet` whose on-chain trades will be
///         mirrored into follower vaults. `verified` is an advisory admin signal
///         surfaced in the UI; it is NOT an access gate.
contract StrategyRegistry is Ownable {
    /// @notice Profit share is hard-capped at 30% at registration time.
    uint256 public constant MAX_PROFIT_SHARE_BPS = 3000;

    struct Strategy {
        address creator; // who registered it and receives profit-share fees
        address strategyWallet; // wallet whose trades are mirrored
        uint256 profitShareBps; // fee on realized gains, <= MAX_PROFIT_SHARE_BPS
        bool verified; // advisory admin flag (manual review), not an access gate
        bool active; // creator/admin can deactivate; only creator can reactivate
    }

    uint256 public strategyCount;
    mapping(uint256 => Strategy) public strategies;

    event StrategyRegistered(
        uint256 indexed strategyId,
        address indexed creator,
        address indexed strategyWallet,
        uint256 profitShareBps
    );
    event StrategyVerifiedSet(uint256 indexed strategyId, bool verified);
    event StrategyDeactivated(uint256 indexed strategyId, address indexed by);
    event StrategyReactivated(uint256 indexed strategyId);

    constructor(address initialOwner) Ownable(initialOwner) {}

    /// @notice Register a new strategy. Permissionless.
    function registerStrategy(address strategyWallet, uint256 profitShareBps)
        external
        returns (uint256 strategyId)
    {
        require(strategyWallet != address(0), "zero strategyWallet");
        require(profitShareBps <= MAX_PROFIT_SHARE_BPS, "profitShare too high");

        strategyId = strategyCount++;
        strategies[strategyId] = Strategy({
            creator: msg.sender,
            strategyWallet: strategyWallet,
            profitShareBps: profitShareBps,
            verified: false,
            active: true
        });

        emit StrategyRegistered(strategyId, msg.sender, strategyWallet, profitShareBps);
    }

    /// @notice Admin-only advisory verification flag.
    function setVerified(uint256 strategyId, bool verified) external onlyOwner {
        require(strategyId < strategyCount, "invalid strategyId");
        strategies[strategyId].verified = verified;
        emit StrategyVerifiedSet(strategyId, verified);
    }

    /// @notice Creator OR admin may deactivate a strategy.
    function deactivateStrategy(uint256 strategyId) external {
        require(strategyId < strategyCount, "invalid strategyId");
        Strategy storage s = strategies[strategyId];
        require(msg.sender == s.creator || msg.sender == owner(), "not authorized");
        require(s.active, "already inactive");
        s.active = false;
        emit StrategyDeactivated(strategyId, msg.sender);
    }

    /// @notice Only the creator may reactivate a deactivated strategy.
    function reactivateStrategy(uint256 strategyId) external {
        require(strategyId < strategyCount, "invalid strategyId");
        Strategy storage s = strategies[strategyId];
        require(msg.sender == s.creator, "only creator");
        require(!s.active, "already active");
        s.active = true;
        emit StrategyReactivated(strategyId);
    }

    /// @notice Convenience getter returning the full struct (usable cross-contract).
    function getStrategy(uint256 strategyId) external view returns (Strategy memory) {
        require(strategyId < strategyCount, "invalid strategyId");
        return strategies[strategyId];
    }
}
