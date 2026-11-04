// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {Test} from "forge-std/Test.sol";
import {Deploy} from "../script/Deploy.s.sol";
import {AaveUsdcVault} from "../src/AaveUsdcVault.sol";
import {MockUSDC, MockPool} from "./mocks/MockAave.sol";

contract DeployTest is Test {
    function testDeployScriptSeedsCushionBeforeFirstDeposit() public {
        MockUSDC token = new MockUSDC();
        MockPool pool = new MockPool(token);
        address donor = vm.addr(123);
        address treasury = makeAddr("treasury");
        token.mint(donor, 10_000);
        vm.setEnv("EVM_USDC", vm.toString(address(token)));
        vm.setEnv("EVM_AAVE_POOL", vm.toString(address(pool)));
        vm.setEnv("EVM_AUSDC", vm.toString(address(pool.aToken())));
        vm.setEnv("EVM_YIELD_RECIPIENT", vm.toString(treasury));
        vm.setEnv("EVM_CUSHION", "10000");
        vm.setEnv("EVM_DEPOSIT_CAP", "1000000000");
        vm.setEnv("EVM_DEPLOYER_PRIVATE_KEY", "123"); // Public fixture key, local VM only.
        Deploy deploy = new Deploy();
        AaveUsdcVault vault = deploy.run();
        assertEq(vault.totalSupply(), 0);
        assertEq(token.balanceOf(address(vault)), vault.cushion());
        assertEq(vault.totalAssets(), 0);
        assertEq(vault.yieldRecipient(), treasury);
        assertEq(vault.depositCap(), 1_000e6);
        token.mint(address(this), 100e6);
        token.approve(address(vault), 100e6);
        vault.deposit(100e6, address(this));
        assertEq(vault.paidTotal(), 0);
        assertEq(vault.yieldCredited(address(this)), 0);
    }
}
