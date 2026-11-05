// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {PrincipalVault} from "./PrincipalVault.sol";
import {IPendleMarket, IPendlePT, IPendleOracle} from "./interfaces/IYieldShapes.sol";

/// @notice Holds PT and releases its deterministic discount to par. Depositors bear any loss pro-rata. Base PT-deJAAA uses USDC-scaled18 units and pays yield in PT.
contract PendlePtVault is PrincipalVault {
    using SafeERC20 for IERC20;
    IPendleMarket internal immutable market;
    IPendleOracle internal immutable oracle;
    uint256 internal immutable initialRate;
    uint256 internal immutable start;
    uint256 internal immutable maturity;

    error InvalidCurve();
    error DepositRateAboveCurve(uint256 rate, uint256 curve);

    constructor(
        IPendleMarket market_,
        IPendleOracle oracle_,
        uint256 c0,
        address recipient,
        uint256 cushion_,
        uint256 cap
    ) PrincipalVault(_pt(market_), "InferNear PT Principal", "inPT", recipient, cushion_, cap) {
        market = market_;
        oracle = oracle_;
        initialRate = c0;
        start = block.timestamp;
        maturity = IPendlePT(asset()).expiry();
        // The curve must have a positive denominator and a future endpoint.
        if (c0 == 0 || c0 > 1e18 || maturity <= start) revert InvalidCurve();
    }

    function _pt(IPendleMarket market_) private view returns (IERC20) {
        (, address pt,) = market_.readTokens();
        return IERC20(pt);
    }

    function yieldToken() public view override returns (address) {
        return asset();
    }

    function _curve() internal view returns (uint256) {
        if (block.timestamp >= maturity) return 1e18;
        return initialRate + Math.mulDiv(1e18 - initialRate, block.timestamp - start, maturity - start);
    }

    function _unitsFor(uint256 assets, Math.Rounding rounding) internal view override returns (uint256) {
        return Math.mulDiv(assets, _curve(), 1e18, rounding);
    }

    function _assetsFor(uint256 units, Math.Rounding rounding) internal view override returns (uint256) {
        return Math.mulDiv(units, 1e18, _curve(), rounding);
    }

    function _heldAssets() internal view override returns (uint256) {
        return IERC20(asset()).balanceOf(address(this));
    }

    function _payableYield() internal view override returns (uint256) {
        return _saturatingSub(_heldAssets(), _principalAssets() + cushion);
    }

    function _invest(uint256) internal view override {
        // This hook runs only on deposit/mint, so a rejected admission never prevents an exit.
        uint256 rate = oracle.getPtToAssetRate(address(market), 0);
        uint256 curve = _curve();
        if (rate > curve) revert DepositRateAboveCurve(rate, curve);
    }

    function _divest(uint256 assets, address to) internal override {
        IERC20(asset()).safeTransfer(to, assets);
    }

    function _payYield(uint256 amount, address to) internal override returns (uint256) {
        uint256 beforeBalance = IERC20(asset()).balanceOf(to);
        IERC20(asset()).safeTransfer(to, amount);
        return IERC20(asset()).balanceOf(to) - beforeBalance;
    }
}
