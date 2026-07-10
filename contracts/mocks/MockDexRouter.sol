// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {MockERC20} from "./MockERC20.sol";

/// @notice Test-only UniswapV2-style router. Quote is `amountIn * rateNum / rateDen`
///         applied across the whole path. On execution, an optional `executionSlippageBps`
///         is applied to simulate real output falling below the quote. Input tokens are
///         pulled via transferFrom; output tokens are minted to `to`.
contract MockDexRouter {
    uint256 public rateNumerator = 1;
    uint256 public rateDenominator = 1;
    uint256 public executionSlippageBps = 0;

    function setRate(uint256 num, uint256 den) external {
        require(den > 0, "den=0");
        rateNumerator = num;
        rateDenominator = den;
    }

    function setExecutionSlippage(uint256 bps) external {
        require(bps <= 10_000, "bps>100%");
        executionSlippageBps = bps;
    }

    function _quote(uint256 amountIn) internal view returns (uint256) {
        return (amountIn * rateNumerator) / rateDenominator;
    }

    function getAmountsOut(uint256 amountIn, address[] calldata path)
        external
        view
        returns (uint256[] memory amounts)
    {
        require(path.length >= 2, "bad path");
        amounts = new uint256[](path.length);
        amounts[0] = amountIn;
        uint256 out = _quote(amountIn);
        for (uint256 i = 1; i < path.length; i++) {
            amounts[i] = out;
        }
    }

    function swapExactTokensForTokens(
        uint256 amountIn,
        uint256 amountOutMin,
        address[] calldata path,
        address to,
        uint256 deadline
    ) external returns (uint256[] memory amounts) {
        require(deadline >= block.timestamp, "expired");
        require(path.length >= 2, "bad path");

        IERC20(path[0]).transferFrom(msg.sender, address(this), amountIn);

        uint256 out = _quote(amountIn);
        out = (out * (10_000 - executionSlippageBps)) / 10_000;
        require(out >= amountOutMin, "insufficient output amount");

        MockERC20(path[path.length - 1]).mint(to, out);

        amounts = new uint256[](path.length);
        amounts[0] = amountIn;
        for (uint256 i = 1; i < path.length; i++) {
            amounts[i] = out;
        }
    }
}
