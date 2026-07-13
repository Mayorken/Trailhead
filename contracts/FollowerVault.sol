// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {StrategyRegistry} from "./StrategyRegistry.sol";
import {AggregatorV3Interface} from "./interfaces/AggregatorV3Interface.sol";

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
///         full FIFO realized-PnL across strategies, and does not net gains/losses across
///         a follower's whole portfolio. Both are real product/fairness decisions (should
///         a loss on one token offset a gain on another before profit-share is taken?)
///         that need their own design pass, not a unilateral engineering call.
///      2a. RESOLVED (view-only): `getNAV` marks open positions to market using Chainlink
///         feeds, for display/read purposes.
///      2b. NOT resolved: `balance` and `withdraw()` still don't reflect NAV — `getNAV` is
///         a read-only lens, not a change to what's actually withdrawable.
///      2c. NOT resolved: `_openPosition`'s position-size cap is checked against cash
///         `balance` only, not NAV, and is re-derived from a shrinking balance on each
///         sequential open — cumulative opened exposure across several same-cap opens can
///         exceed the stated single-position cap even though each individual call passes.
///         Fixing this needs either an agent-supplied token list per trade (new trust
///         surface) or on-chain enumerable per-follower holdings (unbounded storage
///         growth) — deferred pending that choice.
///      3. RESOLVED for opens (hard-required fresh oracle price via Chainlink, checked
///         against the router's own quote — the stricter of the two floors wins). For
///         closes the oracle is best-effort only: a missing/stale feed never blocks an
///         exit, since the only way `heldToken` converts back to withdrawable `balance`
///         is an agent-executed close, and blocking that would strand follower funds.
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

    /// @notice Base asset is assumed pegged to $1 — no price feed is used for it.
    uint8 public immutable baseAssetDecimals;

    struct FeedConfig {
        AggregatorV3Interface feed;
        uint8 feedDecimals;
        uint8 tokenDecimals; // cached at setPriceFeed time to avoid a per-trade external call
    }

    /// @notice Non-base token => its configured Chainlink price feed (address(0) = unset).
    mapping(address => FeedConfig) public priceFeeds;
    /// @notice Max age (seconds) a price feed's `updatedAt` may be before it's treated as stale.
    ///         Owner-adjustable: Fuji feeds can go stale far longer than mainnet during low
    ///         activity, so this needs to be tunable without a redeploy.
    uint256 public maxOracleStalenessSecs = 24 hours;
    /// @notice Extra slippage tolerance (bps), added on top of a follower's own maxSlippageBps,
    ///         used only for the oracle-derived floor. Without this, honest trades on thin
    ///         testnet liquidity would spuriously fail the oracle check even with zero
    ///         manipulation involved, since pool and oracle prices routinely differ by a few
    ///         percent on low-liquidity pools.
    uint256 public oracleToleranceExtraBps = 200;

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
    event PriceFeedSet(address indexed token, address indexed feed, uint8 feedDecimals, uint8 tokenDecimals);
    event MaxOracleStalenessSet(uint256 secs);
    event OracleToleranceExtraBpsSet(uint256 bps);
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
        baseAssetDecimals = IERC20Metadata(address(_baseAsset)).decimals();
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

    /// @notice Configure (or clear, with feed = address(0)) the price feed for a non-base
    ///         token. Caches feed/token decimals so trades don't pay for extra external calls.
    function setPriceFeed(address token, address feed) external onlyOwner {
        require(token != address(0), "zero token");
        if (feed == address(0)) {
            delete priceFeeds[token];
            emit PriceFeedSet(token, address(0), 0, 0);
            return;
        }
        uint8 feedDecimals = AggregatorV3Interface(feed).decimals();
        uint8 tokenDecimals = IERC20Metadata(token).decimals();
        priceFeeds[token] = FeedConfig({
            feed: AggregatorV3Interface(feed),
            feedDecimals: feedDecimals,
            tokenDecimals: tokenDecimals
        });
        emit PriceFeedSet(token, feed, feedDecimals, tokenDecimals);
    }

    function setMaxOracleStaleness(uint256 secs) external onlyOwner {
        require(secs > 0, "zero staleness");
        maxOracleStalenessSecs = secs;
        emit MaxOracleStalenessSet(secs);
    }

    function setOracleToleranceExtraBps(uint256 bps) external onlyOwner {
        require(bps <= BPS_DENOMINATOR, "bps too high");
        oracleToleranceExtraBps = bps;
        emit OracleToleranceExtraBpsSet(bps);
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
        uint256 routerFloor = (expectedOut * (BPS_DENOMINATOR - f.maxSlippageBps)) / BPS_DENOMINATOR;

        // Oracle sanity-check: an independent floor derived from Chainlink, so a manipulated
        // pool can't also manipulate the check meant to protect against it. Wider tolerance
        // than the router floor, since honest thin-liquidity pools routinely diverge a few
        // percent from the oracle with zero manipulation involved.
        (uint256 oracleOut, bool oracleOk) = _oracleExpectedOut(nonBase, p.amountIn, opening);
        uint256 minAcceptable = routerFloor;
        if (oracleOk) {
            uint256 oracleTolBps = Math.min(f.maxSlippageBps + oracleToleranceExtraBps, BPS_DENOMINATOR);
            uint256 oracleFloor = (oracleOut * (BPS_DENOMINATOR - oracleTolBps)) / BPS_DENOMINATOR;
            if (oracleFloor > minAcceptable) minAcceptable = oracleFloor;
        } else if (opening) {
            // Opening new exposure without a usable oracle price is not allowed. Closing
            // never hits this branch requirement — a missing/stale feed must never strand a
            // follower's funds, since executeMirroredTrade is the only way heldToken
            // converts back to withdrawable balance.
            revert("oracle price unavailable");
        }
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

    // ---------------------------------------------------------------------
    // Oracle pricing (shared by the trade-time sanity check and getNAV)
    // ---------------------------------------------------------------------

    /// @notice Price `amountIn` of `token` in base-asset terms via Chainlink, in whichever
    ///         direction `opening` indicates (true: base -> token being priced as an output
    ///         amount of token; false: token -> base). Returns `ok = false` — never reverts —
    ///         when no feed is configured, the feed reports a non-positive price, or the
    ///         price is stale, so callers can decide whether that's fatal.
    /// @dev Base asset is assumed pegged to $1; `token`'s feed is expected to report USD per
    ///      whole unit of `token`, scaled by 10^feedDecimals (standard Chainlink convention).
    function _oracleExpectedOut(address token, uint256 amountIn, bool opening)
        internal
        view
        returns (uint256 out, bool ok)
    {
        FeedConfig memory cfg = priceFeeds[token];
        if (address(cfg.feed) == address(0)) return (0, false);

        (, int256 price, , uint256 updatedAt, ) = cfg.feed.latestRoundData();
        if (price <= 0) return (0, false);
        if (block.timestamp > updatedAt && block.timestamp - updatedAt > maxOracleStalenessSecs) {
            return (0, false);
        }

        uint256 priceUint = uint256(price);
        if (opening) {
            // base -> token: out = amountIn * 10^(feedDec+tokenDec) / (10^baseDec * price)
            // mulDiv handles the (amountIn * 10^(feedDec+tokenDec)) product at full 512-bit
            // precision; the denominator (10^baseDec * price) is bounded and safe to
            // pre-multiply directly (price is a realistic USD feed value, not user input).
            out = Math.mulDiv(
                amountIn,
                10 ** (uint256(cfg.feedDecimals) + uint256(cfg.tokenDecimals)),
                (10 ** uint256(baseAssetDecimals)) * priceUint
            );
        } else {
            // token -> base: out = amountIn * price * 10^baseDec / 10^(tokenDec+feedDec)
            // Pre-multiply the two bounded, non-user-controlled factors (price * 10^baseDec)
            // first -- this cannot realistically overflow -- so mulDiv only needs to handle
            // the (amountIn * priceScaled) product at full precision, not a raw a*b that
            // could overflow before mulDiv gets a chance to protect it.
            uint256 priceScaled = priceUint * (10 ** uint256(baseAssetDecimals));
            out = Math.mulDiv(amountIn, priceScaled, 10 ** (uint256(cfg.tokenDecimals) + uint256(cfg.feedDecimals)));
        }
        ok = true;
    }

    // ---------------------------------------------------------------------
    // Views
    // ---------------------------------------------------------------------

    /// @notice Read-only net asset value: withdrawable balance plus the oracle-priced value
    ///         of open positions in the supplied tokens. Caller supplies the token list (the
    ///         same way the dashboard already discovers a follower's held tokens, via
    ///         PositionOpened events) rather than the vault maintaining its own enumerable
    ///         set. A token with no configured feed, or a stale one, is silently skipped
    ///         rather than reverting the whole call — this is a display path, not
    ///         solvency-critical. See GAP 2b/2c: this does NOT change what withdraw() pays
    ///         out or what the position-size cap is checked against.
    function getNAV(address follower, address[] calldata tokens) external view returns (uint256 nav) {
        nav = balance[follower];
        for (uint256 i = 0; i < tokens.length; i++) {
            uint256 held = heldToken[follower][tokens[i]];
            if (held == 0) continue;
            (uint256 value, bool ok) = _oracleExpectedOut(tokens[i], held, false);
            if (ok) nav += value;
        }
    }
}
