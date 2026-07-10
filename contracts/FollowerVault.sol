// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {StrategyRegistry} from "./StrategyRegistry.sol";

/// @notice Minimal Trader Joe / UniswapV2-style router surface used by the vault.
interface IDexRouter {
    function swapExactTokensForTokens(
        uint256 amountIn,
        uint256 amountOutMin,
        address[] calldata path,
        address to,
        uint256 deadline
    ) external returns (uint256[] memory amounts);

    function getAmountsOut(uint256 amountIn, address[] calldata path)
        external
        view
        returns (uint256[] memory amounts);
}

/// @title FollowerVault
/// @notice Non-custodial vault for a single base asset (intended: USDC). Users
///         deposit/withdraw freely. A permissioned off-chain execution agent may ONLY
///         call `executeMirroredTrade` to swap within the vault, respecting each
///         follower's self-set risk limits. The agent and owner have NO withdrawal
///         rights over user principal.
///
/// @dev KNOWN GAPS (see project brief):
///      1. Profit-share accounting uses a simplified per-position cost-basis model, not
///         full FIFO realized-PnL across strategies. Needs a design pass before mainnet.
///      2. Non-base holdings (`heldToken`) are tracked but NOT marked to market: while a
///         position is open, the follower's withdrawable `balance` does not reflect it.
///      3. No price oracle. The on-chain slippage check is a backstop against the
///         router's own quote; the off-chain agent does the real slippage-aware quoting.
contract FollowerVault is Ownable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    uint256 public constant BPS_DENOMINATOR = 10_000;
    /// @notice Contract-level hard caps on user-selectable risk limits.
    uint256 public constant MAX_SLIPPAGE_BPS = 500; // 5%
    uint256 public constant MAX_POSITION_SIZE_BPS = 5000; // 50%

    IERC20 public immutable baseAsset;
    StrategyRegistry public immutable registry;
    IDexRouter public router;
    address public executionAgent;

    struct Follow {
        bool active;
        uint256 maxSlippageBps;
        uint256 maxPositionSizeBps;
    }

    /// @notice Parameters for a single mirrored trade, computed off-chain per follower.
    struct TradeParams {
        address follower;
        uint256 strategyId;
        address tokenIn;
        address tokenOut;
        uint256 amountIn;
        uint256 minAmountOut;
        address[] path;
        uint256 deadline;
    }

    /// @notice Withdrawable base-asset balance per user.
    mapping(address => uint256) public balance;
    /// @notice Sum of all `balance` entries (base asset owed to users, excluding open positions).
    uint256 public totalDeposits;
    /// @notice Tokens the vault is allowed to swap into.
    mapping(address => bool) public tokenWhitelisted;
    /// @notice follower => strategyId => follow config.
    mapping(address => mapping(uint256 => Follow)) public follows;
    /// @notice follower => token => held amount (open position; not marked to market).
    mapping(address => mapping(address => uint256)) public heldToken;
    /// @notice follower => token => cost basis in base asset for the held position.
    mapping(address => mapping(address => uint256)) public costBasis;

    event ExecutionAgentSet(address indexed agent);
    event RouterSet(address indexed router);
    event TokenWhitelisted(address indexed token, bool whitelisted);
    event Deposited(address indexed user, uint256 amount);
    event Withdrawn(address indexed user, uint256 amount);
    event Followed(address indexed user, uint256 indexed strategyId, uint256 maxSlippageBps, uint256 maxPositionSizeBps);
    event Unfollowed(address indexed user, uint256 indexed strategyId);
    event PositionOpened(
        address indexed follower,
        uint256 indexed strategyId,
        address indexed token,
        uint256 baseSpent,
        uint256 tokenReceived
    );
    event PositionClosed(
        address indexed follower,
        uint256 indexed strategyId,
        address indexed token,
        uint256 tokenSold,
        uint256 baseReceived,
        uint256 profitShareFee
    );

    modifier onlyAgent() {
        require(msg.sender == executionAgent, "not execution agent");
        _;
    }

    constructor(
        address initialOwner,
        IERC20 _baseAsset,
        StrategyRegistry _registry,
        IDexRouter _router
    ) Ownable(initialOwner) {
        require(address(_baseAsset) != address(0), "zero baseAsset");
        require(address(_registry) != address(0), "zero registry");
        require(address(_router) != address(0), "zero router");
        baseAsset = _baseAsset;
        registry = _registry;
        router = _router;
    }

    // ---------------------------------------------------------------------
    // Admin
    // ---------------------------------------------------------------------

    function setExecutionAgent(address agent) external onlyOwner {
        executionAgent = agent;
        emit ExecutionAgentSet(agent);
    }

    function setRouter(IDexRouter _router) external onlyOwner {
        require(address(_router) != address(0), "zero router");
        router = _router;
        emit RouterSet(address(_router));
    }

    function setTokenWhitelisted(address token, bool ok) external onlyOwner {
        require(token != address(0), "zero token");
        tokenWhitelisted[token] = ok;
        emit TokenWhitelisted(token, ok);
    }

    // ---------------------------------------------------------------------
    // User deposits / withdrawals (non-custodial: only the user moves principal out)
    // ---------------------------------------------------------------------

    function deposit(uint256 amount) external nonReentrant {
        require(amount > 0, "zero amount");
        balance[msg.sender] += amount;
        totalDeposits += amount;
        baseAsset.safeTransferFrom(msg.sender, address(this), amount);
        emit Deposited(msg.sender, amount);
    }

    function withdraw(uint256 amount) external nonReentrant {
        require(amount > 0, "zero amount");
        require(balance[msg.sender] >= amount, "insufficient balance");
        balance[msg.sender] -= amount;
        totalDeposits -= amount;
        baseAsset.safeTransfer(msg.sender, amount);
        emit Withdrawn(msg.sender, amount);
    }

    // ---------------------------------------------------------------------
    // Follow / unfollow
    // ---------------------------------------------------------------------

    function followStrategy(
        uint256 strategyId,
        uint256 maxSlippageBps,
        uint256 maxPositionSizeBps
    ) external {
        require(maxSlippageBps <= MAX_SLIPPAGE_BPS, "slippage above cap");
        require(maxPositionSizeBps > 0, "position size zero");
        require(maxPositionSizeBps <= MAX_POSITION_SIZE_BPS, "position above cap");

        StrategyRegistry.Strategy memory s = registry.getStrategy(strategyId);
        require(s.active, "strategy inactive");

        follows[msg.sender][strategyId] = Follow({
            active: true,
            maxSlippageBps: maxSlippageBps,
            maxPositionSizeBps: maxPositionSizeBps
        });
        emit Followed(msg.sender, strategyId, maxSlippageBps, maxPositionSizeBps);
    }

    function unfollowStrategy(uint256 strategyId) external {
        require(follows[msg.sender][strategyId].active, "not following");
        delete follows[msg.sender][strategyId];
        emit Unfollowed(msg.sender, strategyId);
    }

    // ---------------------------------------------------------------------
    // Mirrored trade execution (agent-only)
    // ---------------------------------------------------------------------

    /// @notice Execute a single mirrored trade for one follower. Either opens a position
    ///         (base asset -> whitelisted token) or closes one (token -> base asset).
    /// @dev Enforces the follower's own slippage and position-size limits. Never sends
    ///      base-asset principal to the agent or owner; profit-share fees go to the
    ///      strategy creator, and swap output stays in the vault.
    function executeMirroredTrade(TradeParams calldata p)
        external
        onlyAgent
        nonReentrant
        returns (uint256 amountOut)
    {
        Follow memory f = follows[p.follower][p.strategyId];
        require(f.active, "follower not following");
        require(p.amountIn > 0, "zero amountIn");
        require(p.path.length >= 2, "bad path");
        require(p.path[0] == p.tokenIn, "path[0] != tokenIn");
        require(p.path[p.path.length - 1] == p.tokenOut, "path[last] != tokenOut");

        bool opening = p.tokenIn == address(baseAsset);
        bool closing = p.tokenOut == address(baseAsset);
        require(opening || closing, "must involve base asset");
        require(!(opening && closing), "base to base");

        // The non-base leg must be a whitelisted token.
        address nonBase = opening ? p.tokenOut : p.tokenIn;
        require(tokenWhitelisted[nonBase], "token not whitelisted");

        // Slippage backstop: minAmountOut must not permit more slippage than the
        // follower allows, measured against the router's own quote.
        uint256[] memory quote = router.getAmountsOut(p.amountIn, p.path);
        uint256 expectedOut = quote[quote.length - 1];
        uint256 minAcceptable = (expectedOut * (BPS_DENOMINATOR - f.maxSlippageBps)) / BPS_DENOMINATOR;
        require(p.minAmountOut >= minAcceptable, "minAmountOut below slippage floor");

        if (opening) {
            amountOut = _openPosition(p, f, nonBase);
        } else {
            amountOut = _closePosition(p);
        }
    }

    function _openPosition(TradeParams calldata p, Follow memory f, address token)
        internal
        returns (uint256 amountOut)
    {
        // Position-size cap is measured against the follower's current base balance.
        uint256 maxSize = (balance[p.follower] * f.maxPositionSizeBps) / BPS_DENOMINATOR;
        require(p.amountIn <= maxSize, "exceeds max position size");
        require(balance[p.follower] >= p.amountIn, "insufficient balance");

        // Effects before interaction: base leaves the withdrawable pool into a position.
        balance[p.follower] -= p.amountIn;
        totalDeposits -= p.amountIn;

        amountOut = _swap(p);

        heldToken[p.follower][token] += amountOut;
        costBasis[p.follower][token] += p.amountIn;

        emit PositionOpened(p.follower, p.strategyId, token, p.amountIn, amountOut);
    }

    function _closePosition(TradeParams calldata p) internal returns (uint256 amountOut) {
        uint256 held = heldToken[p.follower][p.tokenIn];
        require(held >= p.amountIn, "insufficient holding");

        // Proportional cost basis for the portion being sold (simplified; see GAP #1).
        uint256 basisPortion = (costBasis[p.follower][p.tokenIn] * p.amountIn) / held;

        // Effects before interaction.
        heldToken[p.follower][p.tokenIn] = held - p.amountIn;
        costBasis[p.follower][p.tokenIn] -= basisPortion;

        amountOut = _swap(p);

        uint256 fee = 0;
        if (amountOut > basisPortion) {
            uint256 gain = amountOut - basisPortion;
            StrategyRegistry.Strategy memory s = registry.getStrategy(p.strategyId);
            fee = (gain * s.profitShareBps) / BPS_DENOMINATOR;
            if (fee > 0) {
                baseAsset.safeTransfer(s.creator, fee);
            }
        }

        uint256 net = amountOut - fee;
        balance[p.follower] += net;
        totalDeposits += net;

        emit PositionClosed(p.follower, p.strategyId, p.tokenIn, p.amountIn, amountOut, fee);
    }

    function _swap(TradeParams calldata p) internal returns (uint256) {
        IERC20(p.tokenIn).forceApprove(address(router), p.amountIn);
        uint256[] memory amounts = router.swapExactTokensForTokens(
            p.amountIn,
            p.minAmountOut,
            p.path,
            address(this),
            p.deadline
        );
        return amounts[amounts.length - 1];
    }
}
