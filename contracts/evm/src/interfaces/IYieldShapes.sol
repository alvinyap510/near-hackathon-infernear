// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

interface IWstETH is IERC20 {
    function stEthPerToken() external view returns (uint256);
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
