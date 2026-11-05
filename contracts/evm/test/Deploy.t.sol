// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {Test} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {Deploy} from "../script/Deploy.s.sol";
import {PrincipalVault} from "../src/PrincipalVault.sol";
import {MockUSDC, MockPool} from "./mocks/MockAave.sol";
import {
    MockShapeToken,
    MockExchangeRateFeed,
    MockPT,
    MockPendleMarket,
    MockPendleOracle
} from "./mocks/MockYieldShapes.sol";

contract DeployTest is Test {
    uint256 internal constant CUSHION = 10_000;
    address internal donor;
    address internal treasury = makeAddr("treasury");

    function setUp() public {
        donor = vm.addr(123);
        vm.setEnv("EVM_YIELD_RECIPIENT", vm.toString(treasury));
        vm.setEnv("EVM_CUSHION", vm.toString(CUSHION));
        vm.setEnv("EVM_DEPLOYER_PRIVATE_KEY", "123"); // Public fixture key, local VM only.
    }

    function _deploy(string memory kind, IERC20 token, uint256 cap) internal returns (PrincipalVault vault) {
        vm.setEnv("EVM_VAULT_KIND", kind);
        vm.setEnv("EVM_DEPOSIT_CAP", vm.toString(cap));
        Deploy deploy = new Deploy();
        vault = deploy.run();
        assertEq(vault.totalSupply(), 0);
        assertEq(vault.asset(), address(token));
        assertEq(token.balanceOf(address(vault)), vault.cushion());
        assertEq(vault.totalAssets(), 0);
        assertEq(vault.yieldRecipient(), treasury);
        assertEq(vault.depositCap(), cap);
        assertEq(vault.unattributed(), 0);
    }

    function _firstDeposit(PrincipalVault vault, IERC20 token, uint256 amount, uint256 shares) internal {
        token.approve(address(vault), amount);
        assertEq(vault.deposit(amount, address(this)), shares);
        assertEq(vault.paidTotal(), 0);
        assertEq(vault.yieldCredited(address(this)), 0);
    }

    function _deployAaveSeedsCushionBeforeFirstDeposit() internal {
        MockUSDC token = new MockUSDC();
        MockPool pool = new MockPool(token);
        token.mint(donor, CUSHION);
        token.mint(address(this), 100e6);
        vm.setEnv("EVM_USDC", vm.toString(address(token)));
        vm.setEnv("EVM_AAVE_POOL", vm.toString(address(pool)));
        vm.setEnv("EVM_AUSDC", vm.toString(address(pool.aToken())));
        PrincipalVault vault = _deploy("aave", token, 1_000e6);
        _firstDeposit(vault, token, 100e6, 100e6);
    }

    function _deployRateNormalizesFeedAndSeedsCushion() internal {
        MockShapeToken token = new MockShapeToken();
        MockExchangeRateFeed feed = new MockExchangeRateFeed(8, 120_000_000);
        token.mint(donor, CUSHION);
        token.mint(address(this), 100e18);
        vm.setEnv("RATE_ASSET_ADDRESS", vm.toString(address(token)));
        vm.setEnv("RATE_FEED_ADDRESS", vm.toString(address(feed)));
        PrincipalVault vault = _deploy("rate", token, 1_000e18);
        assertEq(vault.name(), "InferNear ETH Principal");
        _firstDeposit(vault, token, 100e18, 120e18);
    }

    function _deployPendleReadsInitialRateAndSeedsCushion() internal {
        MockPT token = new MockPT(block.timestamp + 100 days);
        MockPendleMarket market = new MockPendleMarket(address(token));
        MockPendleOracle oracle = new MockPendleOracle(0.8e18);
        token.mint(donor, CUSHION);
        token.mint(address(this), 100e18);
        vm.setEnv("PENDLE_MARKET_ADDRESS", vm.toString(address(market)));
        vm.setEnv("PENDLE_ORACLE_ADDRESS", vm.toString(address(oracle)));
        PrincipalVault vault = _deploy("pendle", token, 1_000e18);
        oracle.setRate(0.7e18);
        _firstDeposit(vault, token, 100e18, 80e18);
    }

    function _deployRejectsAnUnknownKind() internal {
        vm.setEnv("EVM_VAULT_KIND", "staking");
        Deploy deploy = new Deploy();
        vm.expectRevert(abi.encodeWithSelector(Deploy.UnknownVaultKind.selector, "staking"));
        deploy.run();
    }

    // vm.setEnv is process-wide. Keep the env-script scenarios in one sequential test;
    // forks read their immutable historical config from test/fixtures/base.json instead.
    function testDeployAllThreeBaseKindsAndRejectUnknownKind() public {
        _deployAaveSeedsCushionBeforeFirstDeposit();
        _deployRateNormalizesFeedAndSeedsCushion();
        _deployPendleReadsInitialRateAndSeedsCushion();
        _deployRejectsAnUnknownKind();
    }
}
