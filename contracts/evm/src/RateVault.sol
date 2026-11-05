// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {PrincipalVault} from "./PrincipalVault.sol";
import {IExchangeRateFeed} from "./interfaces/IYieldShapes.sol";

/// @notice Holds an 18-decimal LST. A fixed economic exchange-rate feed defines principal units (ETH wei for cbETH).
contract RateVault is PrincipalVault {
    using SafeERC20 for IERC20;

    IExchangeRateFeed internal immutable exchangeRateFeed;
    uint256 internal immutable feedScale;

    error InvalidRate();

    constructor(IERC20 asset_, IExchangeRateFeed feed_, address recipient, uint256 cushion_, uint256 cap)
        PrincipalVault(asset_, "InferNear ETH Principal", "inETH", recipient, cushion_, cap)
    {
        exchangeRateFeed = feed_;
        feedScale = 10 ** uint256(feed_.decimals());
    }

    function _rate() internal view returns (uint256 rate) {
        (, int256 answer,,,) = exchangeRateFeed.latestRoundData();
        if (answer <= 0) revert InvalidRate();
        rate = Math.mulDiv(uint256(answer), 1e18, feedScale);
        // A positive feed answer can truncate to zero; zero cannot be a conversion denominator.
        if (rate == 0) revert InvalidRate();
    }

    function yieldToken() public view override returns (address) {
        return asset();
    }

    function _unitsFor(uint256 assets, Math.Rounding rounding) internal view override returns (uint256) {
        return Math.mulDiv(assets, _rate(), 1e18, rounding);
    }

    function _assetsFor(uint256 units, Math.Rounding rounding) internal view override returns (uint256) {
        return Math.mulDiv(units, 1e18, _rate(), rounding);
    }

    function _heldAssets() internal view override returns (uint256) {
        return IERC20(asset()).balanceOf(address(this));
    }

    function _payableYield() internal view override returns (uint256) {
        return _saturatingSub(_heldAssets(), _principalAssets() + cushion);
    }

    // Holding the LST itself earns the changing economic conversion rate.
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
