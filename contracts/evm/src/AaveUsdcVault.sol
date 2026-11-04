// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {PrincipalVault} from "./PrincipalVault.sol";
import {IAavePool, IScaledAToken} from "./interfaces/IAave.sol";

contract AaveUsdcVault is PrincipalVault {
    using SafeERC20 for IERC20;
    IAavePool internal immutable pool;
    IScaledAToken internal immutable aToken;

    constructor(IERC20 usdc, IAavePool pool_, IScaledAToken aToken_, address recipient, uint256 cushion_, uint256 cap)
        PrincipalVault(usdc, "InferNear USDC Principal", "inUSDC", recipient, cushion_, cap)
    {
        pool = pool_;
        aToken = aToken_;
        usdc.forceApprove(address(pool_), type(uint256).max);
    }

    function yieldToken() public view override returns (address) {
        return asset();
    }

    function _unitsFor(uint256 assets, Math.Rounding) internal pure override returns (uint256) {
        return assets;
    }

    function _assetsFor(uint256 units, Math.Rounding) internal pure override returns (uint256) {
        return units;
    }

    function _heldAssets() internal view override returns (uint256) {
        // Explicit floor also stays conservative on older pools whose balanceOf uses half-up rounding.
        return IERC20(asset()).balanceOf(address(this))
            + Math.mulDiv(aToken.scaledBalanceOf(address(this)), pool.getReserveNormalizedIncome(asset()), 1e27);
    }

    function _payableYield() internal view override returns (uint256) {
        uint256 surplus = _saturatingSub(_heldAssets(), _principalAssets() + cushion);
        uint256 liquidity = IERC20(asset()).balanceOf(address(aToken)) + IERC20(asset()).balanceOf(address(this));
        return Math.min(surplus, liquidity);
    }

    function _invest(uint256 assets) internal override {
        if (assets != 0) pool.supply(asset(), assets, address(this), 0);
    }

    function _divest(uint256 assets, address to) internal override {
        IERC20 token = IERC20(asset());
        uint256 idle = Math.min(assets, token.balanceOf(address(this)));
        if (idle != 0) token.safeTransfer(to, idle);
        if (assets > idle) pool.withdraw(asset(), assets - idle, to);
    }

    function _payYield(uint256 amount, address to) internal virtual override returns (uint256) {
        uint256 beforeBalance = IERC20(asset()).balanceOf(to);
        _divest(amount, to);
        return IERC20(asset()).balanceOf(to) - beforeBalance;
    }
}
