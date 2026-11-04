// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {Test, Vm} from "forge-std/Test.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {PrincipalVault} from "../src/PrincipalVault.sol";
import {PendlePtVault} from "../src/PendlePtVault.sol";
import {StakingRewardsVault} from "../src/StakingRewardsVault.sol";
import {IWstETH} from "../src/interfaces/IYieldShapes.sol";
import {
    MockShapeToken,
    MockWstETH,
    MockPT,
    MockPendleMarket,
    MockPendleOracle,
    MockStakingRewards
} from "./mocks/MockYieldShapes.sol";
import {WstEthHarness, PendlePtHarness, StakingRewardsHarness} from "./mocks/ShapeHarnesses.sol";

abstract contract ShapeTestBase is Test {
    address internal alice = makeAddr("shape alice");
    address internal bob = makeAddr("shape bob");
    address internal treasury = makeAddr("shape treasury");
    uint256 internal constant CUSHION = 10_000;
    uint256 internal constant CAP = 1e30;

    function fund(MockShapeToken token, PrincipalVault vault) internal {
        token.mint(address(vault), CUSHION);
        token.mint(alice, 1e28);
        token.mint(bob, 1e28);
        vm.prank(alice);
        token.approve(address(vault), type(uint256).max);
        vm.prank(bob);
        token.approve(address(vault), type(uint256).max);
    }

    function assertPaidAfterOperation(
        Vm.Log[] memory logs,
        PrincipalVault vault,
        address rewardToken,
        bytes32 operation
    ) internal view {
        bool operated;
        bool paid;
        for (uint256 i; i < logs.length; ++i) {
            if (logs[i].emitter == address(vault) && logs[i].topics[0] == operation) {
                assertFalse(paid, "operation followed payout");
                operated = true;
            }
            if (
                logs[i].emitter == rewardToken && logs[i].topics[0] == keccak256("Transfer(address,address,uint256)")
                    && logs[i].topics[2] == bytes32(uint256(uint160(treasury)))
            ) {
                assertTrue(operated, "payout preceded operation");
                paid = true;
            }
        }
        assertTrue(operated);
        assertTrue(paid);
    }
}

contract WstEthVaultTest is ShapeTestBase {
    MockWstETH internal token;
    WstEthHarness internal vault;

    function setUp() public {
        token = new MockWstETH();
        token.setRate(1.2e18);
        vault = new WstEthHarness(IWstETH(address(token)), treasury, CUSHION, CAP);
        fund(token, vault);
    }

    function depositAlice(uint256 amount) internal returns (uint256 shares) {
        vm.prank(alice);
        return vault.deposit(amount, alice);
    }

    function testStEthUnitsAndRounding() public {
        token.setRate(1.5e18);
        assertEq(vault.units(1, Math.Rounding.Floor), 1);
        assertEq(vault.units(1, Math.Rounding.Ceil), 2);
        assertEq(vault.assets(1, Math.Rounding.Floor), 0);
        assertEq(vault.assets(1, Math.Rounding.Ceil), 1);
        assertEq(depositAlice(2e18), 3e18);
        assertEq(vault.yieldToken(), address(token));
        assertEq(vault.totalAssets(), 2e18);
        assertEq(vault.paidTotal(), 0);
        assertGe(vault.held(), vault.principal());
    }

    function testMintAndWithdrawRoundUpAtNativeRate() public {
        token.setRate(1.5e18);
        vm.prank(alice);
        assertEq(vault.mint(10, alice), 7);
        vm.prank(alice);
        assertEq(vault.withdraw(1, alice, alice), 2);
        assertEq(vault.balanceOf(alice), 8);
        assertEq(vault.paidTotal(), 0);
        assertGe(vault.held(), vault.principal());
    }

    function testAppreciationCreditsWstEthWithoutHolderMovement() public {
        depositAlice(100e18);
        token.setRate(1.5e18);
        vault.skim();
        assertApproxEqAbs(vault.yieldCredited(alice), 20e18, 1);
        assertEq(vault.paidTotal(), 20e18);
        assertEq(token.balanceOf(treasury), 20e18);
        assertEq(vault.principal(), 80e18);
        assertGe(vault.held(), vault.principal());
    }

    function testAttributeBeforeNewDepositAndPayAfterDeposit() public {
        depositAlice(100e18);
        token.setRate(1.5e18);
        vm.recordLogs();
        vm.prank(bob);
        assertEq(vault.deposit(100e18, bob), 150e18);
        assertPaidAfterOperation(
            vm.getRecordedLogs(), vault, address(token), keccak256("Deposit(address,address,uint256,uint256)")
        );
        assertApproxEqAbs(vault.yieldCredited(alice), 20e18, 1);
        assertEq(vault.yieldCredited(bob), 0);
        assertGe(vault.held(), vault.principal());
    }

    function testAttributeBeforeTransferAndPayAfterTransfer() public {
        depositAlice(100e18);
        token.setRate(1.5e18);
        vm.recordLogs();
        vm.prank(alice);
        assertTrue(vault.transfer(bob, 30e18));
        assertPaidAfterOperation(
            vm.getRecordedLogs(), vault, address(token), keccak256("Transfer(address,address,uint256)")
        );
        assertApproxEqAbs(vault.yieldCredited(alice), 20e18, 1);
        assertEq(vault.yieldCredited(bob), 0);
        assertGe(vault.held(), vault.principal());
    }

    function testPayoutFailureCannotBlockPrincipalRedeem() public {
        uint256 shares = depositAlice(100e18);
        token.setRate(1.5e18);
        token.setPayoutFailure(treasury, true);
        vm.expectEmit(false, false, false, true);
        emit PrincipalVault.PayFailed(abi.encodeWithSelector(MockShapeToken.MockPayoutFailed.selector));
        vm.prank(alice);
        assertEq(vault.redeem(shares, alice, alice), 80e18);
        assertEq(vault.unpaid(), 20e18);
        assertApproxEqAbs(vault.yieldCredited(alice), 20e18, 1);
        assertEq(vault.paidTotal(), 0);
        token.setPayoutFailure(treasury, false);
        vault.skim();
        assertEq(vault.unpaid(), 0);
        assertEq(vault.paidTotal(), 20e18);
    }

    function testSlashingUsesCoverageAndDisablesAdmission() public {
        uint256 shares = depositAlice(100e18);
        token.setRate(1e18);
        assertLt(vault.held(), vault.principal());
        assertEq(vault.maxDeposit(bob), 0);
        assertEq(vault.maxMint(bob), 0);
        uint256 preview = vault.previewRedeem(shares);
        vm.prank(alice);
        assertEq(vault.redeem(shares, alice, alice), preview);
        assertEq(preview, 100e18 + CUSHION);
        assertEq(vault.paidTotal(), 0);
    }

    function testFuzzConservationAndNoPrincipalPayment(uint96 rawAmount, uint64 rawRate, uint64 growth) public {
        uint256 amount = bound(rawAmount, 10_000, 1e24);
        uint256 initial = bound(rawRate, 1e18, 3e18);
        token.setRate(initial);
        uint256 shares = depositAlice(amount);
        assertGe(vault.held(), vault.principal());
        token.setRate(initial + bound(growth, 0, 2e18));
        vault.skim();
        assertGe(vault.held(), vault.principal());
        vm.prank(alice);
        uint256 received = vault.redeem(shares, alice, alice);
        assertLe(received, amount);
        assertGe(vault.held(), vault.principal());
        assertEq(CUSHION + amount, vault.held() + received + token.balanceOf(treasury));
        assertLe(vault.yieldCredited(alice), vault.paidTotal() + vault.unpaid());
    }
}

contract PendlePtVaultTest is ShapeTestBase {
    MockPT internal token;
    MockPendleMarket internal market;
    MockPendleOracle internal oracle;
    PendlePtHarness internal vault;
    uint256 internal start;

    function setUp() public {
        start = block.timestamp;
        token = new MockPT(start + 100 days);
        market = new MockPendleMarket(address(token));
        oracle = new MockPendleOracle(0.8e18);
        vault = new PendlePtHarness(market, oracle, 0.8e18, treasury, CUSHION, CAP);
        fund(token, vault);
    }

    function depositAlice(uint256 amount) internal returns (uint256 shares) {
        vm.prank(alice);
        return vault.deposit(amount, alice);
    }

    function testLinearCurveConversionsAndRounding() public {
        assertEq(vault.curve(), 0.8e18);
        assertEq(vault.units(1, Math.Rounding.Floor), 0);
        assertEq(vault.units(1, Math.Rounding.Ceil), 1);
        assertEq(vault.assets(1, Math.Rounding.Floor), 1);
        assertEq(vault.assets(1, Math.Rounding.Ceil), 2);
        assertEq(depositAlice(100e18), 80e18);
        vm.warp(start + 50 days);
        assertEq(vault.curve(), 0.9e18);
        assertEq(vault.previewRedeem(80e18), uint256(80e18) * 10 / 9);
        assertGe(vault.held(), vault.principal());
    }

    function testMintAndWithdrawRoundUpOnCurve() public {
        vm.prank(alice);
        assertEq(vault.mint(3, alice), 4);
        vm.prank(alice);
        assertEq(vault.withdraw(1, alice, alice), 1);
        assertEq(vault.balanceOf(alice), 2);
        assertEq(vault.paidTotal(), 0);
        assertGe(vault.held(), vault.principal());
    }

    function testCurveClampsAndStopsYieldAfterExpiry() public {
        uint256 shares = depositAlice(100e18);
        vm.warp(start + 100 days);
        assertEq(vault.curve(), 1e18);
        vault.skim();
        assertEq(vault.paidTotal(), 20e18);
        vm.warp(start + 1000 days);
        assertEq(vault.curve(), 1e18);
        vault.skim();
        assertEq(vault.paidTotal(), 20e18);
        vm.prank(alice);
        assertEq(vault.redeem(shares, alice, alice), 80e18);
    }

    function testGateBoundaryAndLowerMarketRate() public {
        depositAlice(10e18);
        oracle.setRate(0.7e18);
        vm.prank(bob);
        vault.mint(8e18, bob);
        assertEq(vault.balanceOf(bob), 8e18);
        assertGe(vault.balanceOf(bob), 10e18 * oracle.rate() / 1e18);
        assertGe(vault.held(), vault.principal());
    }

    function testGateRejectsDepositAndMintWithoutMovingAssets() public {
        oracle.setRate(0.8e18 + 1);
        uint256 beforeBalance = token.balanceOf(alice);
        bytes memory reason = abi.encodeWithSelector(PendlePtVault.DepositRateAboveCurve.selector, 0.8e18 + 1, 0.8e18);
        vm.expectRevert(reason);
        vm.prank(alice);
        vault.deposit(100e18, alice);
        vm.expectRevert(reason);
        vm.prank(alice);
        vault.mint(80e18, alice);
        assertEq(vault.totalSupply(), 0);
        assertEq(token.balanceOf(alice), beforeBalance);
        assertEq(vault.held(), CUSHION);
    }

    function testGateDoesNotBlockExits() public {
        uint256 shares = depositAlice(100e18);
        vm.warp(start + 50 days);
        oracle.setRate(1.1e18);
        vm.prank(alice);
        assertLe(vault.redeem(shares, alice, alice), 100e18);
        assertEq(vault.totalSupply(), 0);
    }

    function testRejectsInvalidCurveParameters() public {
        vm.expectRevert(PendlePtVault.InvalidCurve.selector);
        new PendlePtHarness(market, oracle, 0, treasury, CUSHION, CAP);
        vm.expectRevert(PendlePtVault.InvalidCurve.selector);
        new PendlePtHarness(market, oracle, 1e18 + 1, treasury, CUSHION, CAP);
        vm.warp(start + 100 days);
        vm.expectRevert(PendlePtVault.InvalidCurve.selector);
        new PendlePtHarness(market, oracle, 0.8e18, treasury, CUSHION, CAP);
    }

    function testAttributeBeforeNewDepositAndPayAfterDeposit() public {
        depositAlice(100e18);
        vm.warp(start + 50 days);
        uint256 expected = vault.held() - vault.principal() - CUSHION;
        vm.recordLogs();
        vm.prank(bob);
        assertEq(vault.deposit(100e18, bob), 90e18);
        assertPaidAfterOperation(
            vm.getRecordedLogs(), vault, address(token), keccak256("Deposit(address,address,uint256,uint256)")
        );
        assertEq(vault.yieldCredited(alice), expected);
        assertEq(vault.yieldCredited(bob), 0);
        assertGe(vault.held(), vault.principal());
    }

    function testPayFailureEmittedAfterPrincipalRedeem() public {
        uint256 shares = depositAlice(100e18);
        vm.warp(start + 50 days);
        uint256 expected = vault.held() - vault.principal() - CUSHION;
        token.setPayoutFailure(treasury, true);
        vm.expectEmit(false, false, false, true);
        emit PrincipalVault.PayFailed(abi.encodeWithSelector(MockShapeToken.MockPayoutFailed.selector));
        vm.prank(alice);
        assertEq(vault.redeem(shares, alice, alice), uint256(80e18) * 10 / 9);
        assertEq(vault.unpaid(), expected);
        assertEq(vault.yieldCredited(alice), expected);
        uint256 remainingYield = vault.held() - CUSHION;
        token.setPayoutFailure(treasury, false);
        vault.skim();
        assertEq(vault.unpaid(), 0);
        // The floor redeem leaves one PT base unit more than the rounded-up principal estimate.
        assertEq(vault.paidTotal(), remainingYield);
        assertApproxEqAbs(remainingYield, expected, 1);
    }

    function testFuzzMaturityConservationAndReturnBound(uint96 rawAmount, uint32 elapsed) public {
        uint256 amount = bound(rawAmount, 10_000, 1e24);
        uint256 shares = depositAlice(amount);
        vm.warp(start + bound(elapsed, 0, 200 days));
        assertLe(vault.curve(), 1e18);
        assertGe(vault.held(), vault.principal());
        vault.skim();
        assertGe(vault.held(), vault.principal());
        vm.prank(alice);
        uint256 received = vault.redeem(shares, alice, alice);
        assertLe(received, amount);
        assertEq(CUSHION + amount, vault.held() + received + token.balanceOf(treasury));
        assertLe(vault.yieldCredited(alice), vault.paidTotal() + vault.unpaid());
    }
}

contract StakingRewardsVaultTest is ShapeTestBase {
    MockShapeToken internal token;
    MockShapeToken internal reward;
    MockStakingRewards internal pool;
    StakingRewardsHarness internal vault;

    function setUp() public {
        token = new MockShapeToken();
        reward = new MockShapeToken();
        pool = new MockStakingRewards(token, reward, 1e15);
        vault = new StakingRewardsHarness(token, reward, pool, treasury, CUSHION, CAP);
        fund(token, vault);
        reward.mint(address(pool), 1e30);
    }

    function depositAlice(uint256 amount) internal {
        vm.prank(alice);
        vault.deposit(amount, alice);
    }

    function testRejectsRewardEqualToPrincipal() public {
        vm.expectRevert(StakingRewardsVault.RewardIsPrincipal.selector);
        new StakingRewardsHarness(token, token, pool, treasury, CUSHION, CAP);
    }

    function testUnitsBackingAndRewardTokenAreSeparate() public {
        depositAlice(100e18);
        assertEq(vault.convertToShares(7), 7);
        assertEq(vault.convertToAssets(7), 7);
        assertEq(vault.previewMint(7), 7);
        assertEq(vault.previewWithdraw(7), 7);
        assertEq(vault.yieldToken(), address(reward));
        assertEq(pool.balanceOf(address(vault)), 100e18);
        assertEq(vault.held(), 100e18 + CUSHION);
        assertEq(vault.principal(), 100e18);
        assertEq(vault.paidTotal(), 0);
    }

    function testClaimableAndDirectRewardsAreBothAttributed() public {
        depositAlice(100e18);
        vm.warp(block.timestamp + 10);
        reward.mint(address(vault), 2e18);
        uint256 principalBefore = vault.held();
        assertEq(pool.earned(address(vault)), 1e18);
        vault.skim();
        assertEq(vault.yieldCredited(alice), 3e18);
        assertEq(vault.paidTotal(), 3e18);
        assertEq(reward.balanceOf(treasury), 3e18);
        assertEq(vault.held(), principalBefore);
        vault.skim();
        assertEq(vault.paidTotal(), 3e18);
    }

    function testDonatedPrincipalIsNeverReward() public {
        depositAlice(100e18);
        token.mint(address(vault), 50e18);
        vault.skim();
        assertEq(vault.paidTotal(), 0);
        assertEq(reward.balanceOf(treasury), 0);
        assertEq(token.balanceOf(treasury), 0);
        assertGe(vault.held(), vault.principal());
    }

    function testPreDepositRewardDonationIsUnattributed() public {
        reward.mint(address(vault), 2e18);
        depositAlice(100e18);
        assertEq(vault.yieldCredited(alice), 0);
        assertEq(vault.paidTotal(), 2e18);
        assertEq(reward.balanceOf(treasury), 2e18);
    }

    function testAttributeBeforeNewDepositAndPayAfterStaking() public {
        depositAlice(100e18);
        vm.warp(block.timestamp + 10);
        vm.recordLogs();
        vm.prank(bob);
        vault.deposit(100e18, bob);
        assertPaidAfterOperation(
            vm.getRecordedLogs(), vault, address(reward), keccak256("Deposit(address,address,uint256,uint256)")
        );
        assertEq(vault.yieldCredited(alice), 1e18);
        assertEq(vault.yieldCredited(bob), 0);
        assertEq(pool.balanceOf(address(vault)), 200e18);
        assertGe(vault.held(), vault.principal());
    }

    function testPayAfterWithdrawalKeepsPrincipalSeparate() public {
        depositAlice(100e18);
        vm.warp(block.timestamp + 10);
        vm.recordLogs();
        vm.prank(alice);
        assertEq(vault.redeem(100e18, alice, alice), 100e18);
        assertPaidAfterOperation(
            vm.getRecordedLogs(), vault, address(reward), keccak256("Withdraw(address,address,address,uint256,uint256)")
        );
        assertEq(vault.held(), CUSHION);
        assertEq(vault.paidTotal(), 1e18);
        assertEq(vault.yieldCredited(alice), 1e18);
    }

    function testClaimFailureDoesNotBlockPrincipalExit() public {
        depositAlice(100e18);
        vm.warp(block.timestamp + 10);
        pool.setFailClaim(true);
        vm.expectEmit(false, false, false, true);
        emit PrincipalVault.PayFailed(abi.encodeWithSignature("Error(string)", "mock claim failure"));
        vm.prank(alice);
        assertEq(vault.redeem(100e18, alice, alice), 100e18);
        assertEq(vault.unpaid(), 1e18);
        assertEq(pool.earned(address(vault)), 1e18);
        assertEq(vault.yieldCredited(alice), 1e18);
        assertEq(vault.held(), CUSHION);
        pool.setFailClaim(false);
        vault.skim();
        assertEq(vault.unpaid(), 0);
        assertEq(vault.paidTotal(), 1e18);
    }

    function testRewardTransferFailureRollsBackClaimOnly() public {
        depositAlice(100e18);
        vm.warp(block.timestamp + 10);
        reward.setPayoutFailure(treasury, true);
        vm.expectEmit(false, false, false, true);
        emit PrincipalVault.PayFailed(abi.encodeWithSelector(MockShapeToken.MockPayoutFailed.selector));
        vm.prank(alice);
        assertTrue(vault.transfer(bob, 50e18));
        assertEq(vault.balanceOf(bob), 50e18);
        assertEq(vault.unpaid(), 1e18);
        assertEq(pool.earned(address(vault)), 1e18);
        assertEq(reward.balanceOf(address(vault)), 0);
        assertEq(vault.paidTotal(), 0);
        assertGe(vault.held(), vault.principal());
    }

    function testFuzzPerTokenConservation(uint96 rawAmount, uint32 elapsed, uint64 donation) public {
        uint256 amount = bound(rawAmount, 10_000, 1e24);
        depositAlice(amount);
        vm.warp(block.timestamp + bound(elapsed, 0, 100 days));
        uint256 accrued = pool.earned(address(vault));
        reward.mint(address(vault), donation);
        vault.skim();
        assertGe(vault.held(), vault.principal());
        assertEq(accrued + donation, vault.paidTotal() + vault.unpaid());
        vm.prank(alice);
        uint256 received = vault.redeem(amount, alice, alice);
        assertEq(received, amount);
        assertEq(CUSHION + amount, vault.held() + received);
        assertEq(
            accrued + donation,
            reward.balanceOf(treasury) + reward.balanceOf(address(vault)) + pool.earned(address(vault))
        );
        assertGe(vault.held(), vault.principal());
    }
}
