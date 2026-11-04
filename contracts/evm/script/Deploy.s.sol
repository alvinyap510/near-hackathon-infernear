// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {Script} from "forge-std/Script.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {AaveUsdcVault} from "../src/AaveUsdcVault.sol";
import {IAavePool, IScaledAToken} from "../src/interfaces/IAave.sol";

contract Deploy is Script {
    using SafeERC20 for IERC20;

    function run() external returns (AaveUsdcVault vault) {
        IERC20 usdc = IERC20(vm.envAddress("EVM_USDC"));
        IAavePool pool = IAavePool(vm.envAddress("EVM_AAVE_POOL"));
        IScaledAToken aToken = IScaledAToken(vm.envAddress("EVM_AUSDC"));
        address recipient = vm.envAddress("EVM_YIELD_RECIPIENT");
        uint256 cushion = vm.envUint("EVM_CUSHION");
        uint256 cap = vm.envUint("EVM_DEPOSIT_CAP");
        vm.startBroadcast(vm.envUint("EVM_DEPLOYER_PRIVATE_KEY"));
        vault = new AaveUsdcVault(usdc, pool, aToken, recipient, cushion, cap);
        // Seed the rounding budget without minting shares or user credits.
        usdc.safeTransfer(address(vault), cushion);
        vm.stopBroadcast();
    }
}
