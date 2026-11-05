// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {RateVault} from "../../src/RateVault.sol";
import {PendlePtVault} from "../../src/PendlePtVault.sol";
import {StakingRewardsVault} from "../../src/StakingRewardsVault.sol";
import {IExchangeRateFeed, IPendleMarket, IPendleOracle, IStakingRewards} from "../../src/interfaces/IYieldShapes.sol";

contract RateHarness is RateVault {
    constructor(IERC20 token, IExchangeRateFeed feed, address recipient, uint256 budget, uint256 cap)
        RateVault(token, feed, recipient, budget, cap)
    {}

    function rate() external view returns (uint256) {
        return _rate();
    }

    function held() external view returns (uint256) {
        return _heldAssets();
    }

    function principal() external view returns (uint256) {
        return _principalAssets();
    }

    function units(uint256 amount, Math.Rounding rounding) external view returns (uint256) {
        return _unitsFor(amount, rounding);
    }

    function assets(uint256 amount, Math.Rounding rounding) external view returns (uint256) {
        return _assetsFor(amount, rounding);
    }
}

contract PendlePtHarness is PendlePtVault {
    constructor(
        IPendleMarket market_,
        IPendleOracle oracle_,
        uint256 c0,
        address recipient,
        uint256 budget,
        uint256 cap
    ) PendlePtVault(market_, oracle_, c0, recipient, budget, cap) {}

    function held() external view returns (uint256) {
        return _heldAssets();
    }

    function principal() external view returns (uint256) {
        return _principalAssets();
    }

    function curve() external view returns (uint256) {
        return _curve();
    }

    function units(uint256 amount, Math.Rounding rounding) external view returns (uint256) {
        return _unitsFor(amount, rounding);
    }

    function assets(uint256 amount, Math.Rounding rounding) external view returns (uint256) {
        return _assetsFor(amount, rounding);
    }
}

contract StakingRewardsHarness is StakingRewardsVault {
    constructor(IERC20 token, IERC20 reward_, IStakingRewards pool, address recipient, uint256 budget, uint256 cap)
        StakingRewardsVault(token, reward_, pool, recipient, budget, cap)
    {}

    function held() external view returns (uint256) {
        return _heldAssets();
    }

    function principal() external view returns (uint256) {
        return _principalAssets();
    }
}
