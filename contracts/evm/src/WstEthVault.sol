// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {PrincipalVault} from "./PrincipalVault.sol";
import {IWstETH} from "./interfaces/IYieldShapes.sol";

/// @notice Holds Ethereum wstETH; principal units are stETH. Loss-capable through Lido slashing.
contract WstEthVault is PrincipalVault {
    using SafeERC20 for IERC20;

    constructor(IWstETH wstEth, address recipient, uint256 cushion_, uint256 cap)
        PrincipalVault(wstEth, "InferNear stETH Principal", "instETH", recipient, cushion_, cap)
    {}

    function yieldToken() public view override returns (address) {
        return asset();
    }

    function _unitsFor(uint256 assets, Math.Rounding rounding) internal view override returns (uint256) {
        return Math.mulDiv(assets, IWstETH(asset()).stEthPerToken(), 1e18, rounding);
    }

    function _assetsFor(uint256 units, Math.Rounding rounding) internal view override returns (uint256) {
        return Math.mulDiv(units, 1e18, IWstETH(asset()).stEthPerToken(), rounding);
    }

    function _heldAssets() internal view override returns (uint256) {
        return IERC20(asset()).balanceOf(address(this));
    }

    function _payableYield() internal view override returns (uint256) {
        return _saturatingSub(_heldAssets(), _principalAssets() + cushion);
    }

    // Holding wstETH itself earns the changing stETH conversion rate.
    function _invest(uint256) internal pure override {}

    function _divest(uint256 assets, address to) internal override {
        IERC20(asset()).safeTransfer(to, assets);
    }

    function _payYield(uint256 amount, address to) internal override returns (uint256) {
        uint256 beforeBalance = IERC20(asset()).balanceOf(to);
        IERC20(asset()).safeTransfer(to, amount);
        return IERC20(asset()).balanceOf(to) - beforeBalance;
    }
}
