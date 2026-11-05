// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

interface IExchangeRateFeed {
    function decimals() external view returns (uint8);
    function latestRoundData() external view returns (uint80, int256, uint256, uint256, uint80);
}

interface IPendleMarket {
    function readTokens() external view returns (address sy, address pt, address yt);
}

interface IPendlePT {
    function expiry() external view returns (uint256);
}

interface IPendleOracle {
    function getPtToAssetRate(address market, uint32 duration) external view returns (uint256);
}

interface IStakingRewards {
    function balanceOf(address user) external view returns (uint256);
    function earned(address user) external view returns (uint256);
    function stake(uint256 amount) external;
    function withdraw(uint256 amount) external;
    function getReward() external;
}
