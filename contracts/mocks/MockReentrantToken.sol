// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

interface IReentrantTarget {
    function withdraw(uint256 amount) external;
}

/// @notice Malicious ERC20 used to verify FollowerVault's ReentrancyGuard. When armed,
///         it re-enters the vault's `withdraw` during an outbound (vault -> user)
///         transfer. With the guard in place the whole transaction must revert.
contract MockReentrantToken is ERC20 {
    address public target;
    bool public attack;

    constructor() ERC20("Reentrant", "RE") {}

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }

    function setTarget(address t) external {
        target = t;
    }

    function setAttack(bool a) external {
        attack = a;
    }

    function _update(address from, address to, uint256 value) internal override {
        super._update(from, to, value);
        if (attack && from == target) {
            IReentrantTarget(target).withdraw(value);
        }
    }
}
