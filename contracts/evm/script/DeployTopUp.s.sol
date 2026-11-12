// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {Script} from "forge-std/Script.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {CreditTopUp} from "../src/CreditTopUp.sol";

/// Deploys the credit top-up contract. It moves no tokens: the only cost is gas.
contract DeployTopUp is Script {
    function run() external returns (CreditTopUp topUp) {
        vm.startBroadcast(vm.envUint("EVM_DEPLOYER_PRIVATE_KEY"));
        topUp = new CreditTopUp(IERC20(vm.envAddress("EVM_USDC")), vm.envAddress("EVM_YIELD_RECIPIENT"));
        vm.stopBroadcast();
    }
}
