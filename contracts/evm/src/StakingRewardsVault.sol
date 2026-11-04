// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {PrincipalVault} from "./PrincipalVault.sol";
import {IStakingRewards} from "./interfaces/IYieldShapes.sol";

/// @notice Principal stays in the staking asset; only the distinct reward token is paid as yield.
contract StakingRewardsVault is PrincipalVault {
    using SafeERC20 for IERC20;
    IStakingRewards internal immutable staking;
    IERC20 internal immutable reward;
    error RewardIsPrincipal();

    constructor(
        IERC20 asset_,
        IERC20 reward_,
        IStakingRewards staking_,
        address recipient,
        uint256 cushion_,
        uint256 cap
    ) PrincipalVault(asset_, "InferNear Staked Principal", "inSTAKE", recipient, cushion_, cap) {
        if (address(reward_) == address(asset_)) revert RewardIsPrincipal();
        staking = staking_;
        reward = reward_;
        asset_.forceApprove(address(staking_), type(uint256).max);
    }

    function yieldToken() public view override returns (address) {
        return address(reward);
    }

    function _unitsFor(uint256 assets, Math.Rounding) internal pure override returns (uint256) {
        return assets;
    }

    function _assetsFor(uint256 units, Math.Rounding) internal pure override returns (uint256) {
        return units;
    }

    function _heldAssets() internal view override returns (uint256) {
        return staking.balanceOf(address(this)) + IERC20(asset()).balanceOf(address(this));
    }

    function _freeYield() internal view override returns (uint256) {
        return _saturatingSub(staking.earned(address(this)) + reward.balanceOf(address(this)), unpaid);
    }

    function _payableYield() internal view override returns (uint256) {
        return staking.earned(address(this)) + reward.balanceOf(address(this));
    }

    function _invest(uint256 assets) internal override {
        if (assets != 0) staking.stake(assets);
    }

    function _divest(uint256 assets, address to) internal override {
        IERC20 token = IERC20(asset());
        uint256 idle = token.balanceOf(address(this));
        if (assets > idle) staking.withdraw(assets - idle);
        token.safeTransfer(to, assets);
    }

    function _payYield(uint256 amount, address to) internal override returns (uint256) {
        if (reward.balanceOf(address(this)) < amount) staking.getReward();
        uint256 beforeBalance = reward.balanceOf(to);
        reward.safeTransfer(to, amount);
        return reward.balanceOf(to) - beforeBalance;
    }
}
