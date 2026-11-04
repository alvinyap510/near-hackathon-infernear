// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {AaveUsdcVault} from "../../src/AaveUsdcVault.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IAavePool, IScaledAToken} from "../../src/interfaces/IAave.sol";

contract VaultHarness is AaveUsdcVault {
    bool public failPay;
    bool public overpay;
    constructor(IERC20 token, IAavePool pool_, IScaledAToken aToken_, address recipient, uint256 budget, uint256 cap)
        AaveUsdcVault(token, pool_, aToken_, recipient, budget, cap)
    {}

    function setFailPay(bool value) external {
        failPay = value;
    }

    function setOverpay(bool value) external {
        overpay = value;
    }

    function held() external view returns (uint256) {
        return _heldAssets();
    }

    function principal() external view returns (uint256) {
        return _principalAssets();
    }

    function unallocated() external view returns (uint256) {
        return unattributed;
    }

    function accumulator() external view returns (uint256) {
        return acc;
    }

    function entitlement(address user) external view returns (uint256) {
        return creditedScaled[user] + balanceOf(user) * (acc - snap[user]);
    }

    function settled(address user) external view returns (uint256) {
        return creditedScaled[user];
    }

    function _payYield(uint256 amount, address to) internal override returns (uint256) {
        require(!failPay, "mock pay failure");
        return super._payYield(overpay ? amount + cushion + 1 : amount, to);
    }
}
