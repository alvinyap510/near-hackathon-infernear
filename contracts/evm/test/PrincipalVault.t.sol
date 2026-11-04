// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {Test} from "forge-std/Test.sol";
import {PrincipalVault} from "../src/PrincipalVault.sol";
import {MockUSDC, MockPool} from "./mocks/MockAave.sol";
import {VaultHarness} from "./mocks/VaultHarness.sol";

contract PrincipalVaultTest is Test {
    MockUSDC internal token;
    MockPool internal pool;
    VaultHarness internal vault;
    address internal alice = makeAddr("alice");
    address internal bob = makeAddr("bob");
    address internal treasury = makeAddr("treasury");
    uint256 internal constant CUSHION = 10_000;
    uint256 internal constant CAP = 1_000_000e6;

    function setUp() public {
        token = new MockUSDC();
        pool = new MockPool(token);
        vault = new VaultHarness(token, pool, pool.aToken(), treasury, CUSHION, CAP);
        token.mint(address(vault), CUSHION);
        token.mint(address(pool.aToken()), 1e18); // Fixture reserve liquidity, not vault backing.
        token.mint(alice, CAP * 2);
        token.mint(bob, CAP * 2);
        vm.prank(alice);
        token.approve(address(vault), type(uint256).max);
        vm.prank(bob);
        token.approve(address(vault), type(uint256).max);
    }

    function deposit(address user, uint256 amount) internal {
        vm.prank(user);
        vault.deposit(amount, user);
    }

    function grow(uint256 ray) internal {
        pool.setIndex(ray);
    }

    function testZeroYieldDepositPaysNothing() public {
        deposit(alice, 100e6);
        assertEq(vault.paidTotal(), 0);
        assertEq(vault.unpaid(), 0);
        assertEq(vault.yieldCredited(alice), 0);
        assertEq(vault.totalAssets(), 100e6);
        assertEq(vault.convertToShares(100e6), 100e6);
    }

    function testYieldViewIncludesUnsettledEarnings() public {
        deposit(alice, 100e6);
        grow(1.1e27);
        vault.skim();
        assertEq(vault.settled(alice), 0);
        assertEq(vault.yieldCredited(alice), 10e6);
        assertEq(token.balanceOf(treasury), 10e6);
        assertEq(vault.unpaid(), 0);
    }

    function testTransferAttributesToPreviousOwners() public {
        deposit(alice, 100e6);
        grow(1.1e27);
        vm.prank(alice);
        vault.transfer(bob, 50e6);
        grow(1.2e27);
        uint256 nextYield = vault.held() - vault.principal() - CUSHION;
        vault.skim();
        assertEq(vault.yieldCredited(alice), 10e6 + nextYield / 2);
        assertEq(vault.yieldCredited(bob), nextYield / 2);
    }

    function testZeroAndSelfTransfersSkipSkimAndSettlement() public {
        deposit(alice, 100e6);
        grow(1.1e27);
        vm.startPrank(alice);
        vault.transfer(bob, 0);
        vault.transfer(alice, 50e6);
        vault.approve(bob, type(uint256).max);
        vm.stopPrank();
        vm.startPrank(bob);
        vault.transferFrom(alice, bob, 0);
        vault.transferFrom(alice, alice, 50e6);
        vm.stopPrank();
        assertEq(vault.accumulator(), 0);
        assertEq(vault.settled(alice), 0);
        assertEq(vault.paidTotal(), 0);
        assertEq(vault.balanceOf(alice), 100e6);
    }

    function testDonationBeforeFirstDepositIsUnattributed() public {
        token.mint(address(vault), 10e6);
        deposit(alice, 100e6);
        assertEq(vault.unallocated(), 10e6);
        assertEq(vault.paidTotal(), 10e6);
        assertEq(vault.yieldCredited(alice), 0);
    }

    function testEmptyThenRedepositDoesNotInheritYield() public {
        deposit(alice, 100e6);
        grow(1.1e27);
        vm.prank(alice);
        vault.redeem(100e6, alice, alice);
        uint256 earned = vault.yieldCredited(alice);
        assertEq(vault.totalSupply(), 0);
        token.mint(address(vault), 1e6);
        deposit(bob, 100e6);
        assertEq(vault.yieldCredited(bob), 0);
        assertEq(vault.yieldCredited(alice), earned);
        assertGe(vault.unallocated(), 1e6 - 2);
    }

    function testCapBoundaryAndOversizedDeposit() public {
        assertEq(vault.maxMint(alice), CAP);
        vm.expectRevert();
        vm.prank(alice);
        vault.deposit(CAP + 1, alice);
        deposit(alice, CAP - 1);
        assertEq(vault.maxDeposit(bob), 1);
        vm.prank(bob);
        vault.mint(1, bob);
        assertEq(vault.maxDeposit(alice), 0);
        vm.expectRevert();
        vm.prank(bob);
        vault.mint(1, bob);
    }

    function testZeroSupplyAndZeroBackingConversions() public {
        assertEq(vault.convertToShares(7), 7);
        assertEq(vault.convertToAssets(7), 7);
        assertEq(vault.totalAssets(), 0);
        deposit(alice, 100e6);
        pool.setIndex(0);
        token.burn(address(vault), CUSHION);
        assertEq(vault.convertToAssets(100e6), 0);
        assertEq(vault.previewRedeem(100e6), 0);
        assertEq(vault.previewMint(100e6), 0);
        assertEq(vault.maxDeposit(alice), 0);
        assertEq(vault.maxMint(alice), 0);
        assertEq(vault.maxWithdraw(alice), 0);
        assertEq(vault.convertToShares(0), 0);
        vm.expectRevert(PrincipalVault.ZeroBacking.selector);
        vault.convertToShares(1);
        vm.prank(alice);
        vault.redeem(100e6, alice, alice);
        assertEq(vault.totalSupply(), 0);
    }

    function testDeficitUsesProRataCoverageAndBlocksAdmission() public {
        deposit(alice, 100e6);
        deposit(bob, 100e6);
        grow(0.8e27);
        uint256 half = vault.held() / 2;
        assertEq(vault.previewRedeem(100e6), half);
        assertEq(vault.previewWithdraw(half), 100e6);
        assertEq(vault.convertToShares(half), 100e6);
        assertEq(vault.totalAssets(), vault.held());
        assertEq(vault.maxDeposit(alice), 0);
        vm.prank(alice);
        assertEq(vault.redeem(100e6, alice, alice), half);
        assertApproxEqAbs(vault.previewRedeem(100e6), half, 1);
        assertEq(vault.paidTotal(), 0);
    }

    function testPayFailureEmitsAndExitSucceeds() public {
        deposit(alice, 100e6);
        grow(1.1e27);
        vault.setFailPay(true);
        vm.expectEmit(false, false, false, true);
        emit PrincipalVault.PayFailed(abi.encodeWithSignature("Error(string)", "mock pay failure"));
        vm.prank(alice);
        assertEq(vault.redeem(100e6, alice, alice), 100e6);
        assertEq(vault.yieldCredited(alice), 10e6);
        assertEq(vault.unpaid(), 10e6);
        assertEq(vault.paidTotal(), 0);
        vault.setFailPay(false);
        vault.skim();
        assertLe(vault.unpaid(), 2); // Withdrawal rounding can consume part of the cushion.
        assertGe(vault.held(), vault.principal());
    }

    function testPublicSkimRevertsWholeAttributionOnPayFailure() public {
        deposit(alice, 100e6);
        grow(1.1e27);
        vault.setFailPay(true);
        vm.expectRevert("mock pay failure");
        vault.skim();
        assertEq(vault.yieldCredited(alice), 0);
        assertEq(vault.unpaid(), 0);
    }

    function testPaymentCannotConsumePrincipal() public {
        deposit(alice, 100e6);
        grow(1.1e27);
        vault.setOverpay(true);
        vm.prank(alice);
        vault.transfer(bob, 1);
        assertEq(vault.paidTotal(), 0);
        assertEq(token.balanceOf(treasury), 0);
        assertEq(vault.unpaid(), 10e6);
        assertGe(vault.held(), vault.principal());
    }

    function testPayIsSelfOnly() public {
        vm.expectRevert("self only");
        vault._pay();
    }

    function testLiquidityCapsPayoutAndPrincipalHasPriority() public {
        deposit(alice, 100e6);
        grow(1.1e27);
        token.burn(address(pool.aToken()), token.balanceOf(address(pool.aToken())) - 1e6);
        vault.skim();
        assertEq(vault.paidTotal(), 1e6 + CUSHION);
        assertEq(vault.unpaid(), 9e6 - CUSHION);
        assertGe(vault.held(), vault.principal());
        token.mint(address(pool.aToken()), 200e6);
        vm.prank(alice);
        vault.redeem(100e6, alice, alice);
        assertGe(vault.held(), vault.principal());
    }

    /// @dev Known spec limitation: skim-first payment consumes liquidity needed for the pending exit.
    function testSkimFirstPaymentCanConsumeExitLiquidity() public {
        deposit(alice, 100e6);
        grow(1.1e27);
        token.burn(address(pool.aToken()), token.balanceOf(address(pool.aToken())) - (100e6 - CUSHION));
        // Principal could be released before the payout: idle + reserve liquidity = 100 USDC.
        assertEq(token.balanceOf(address(vault)) + token.balanceOf(address(pool.aToken())), 100e6);
        vm.expectRevert(
            abi.encodeWithSignature(
                "ERC20InsufficientBalance(address,uint256,uint256)", address(pool.aToken()), 90e6, 100e6
            )
        );
        vm.prank(alice);
        vault.redeem(100e6, alice, alice);
        // The whole transaction rolls back. No principal or yield is lost, but this full exit is blocked.
        assertEq(vault.balanceOf(alice), 100e6);
        assertEq(vault.paidTotal(), 0);
        assertEq(token.balanceOf(treasury), 0);
        vault.setFailPay(true);
        vm.prank(alice);
        assertEq(vault.redeem(100e6, alice, alice), 100e6);
    }

    function testLossAfterFailedPaymentKeepsUnpaidJunior() public {
        deposit(alice, 100e6);
        grow(1.1e27);
        vault.setFailPay(true);
        vm.prank(alice);
        vault.transfer(bob, 1);
        grow(0.9e27);
        vault.setFailPay(false);
        vault.skim();
        assertEq(vault.paidTotal(), 0);
        assertEq(vault.unpaid(), 10e6);
        assertEq(vault.yieldCredited(alice), 10e6);
        uint256 remaining = vault.balanceOf(alice);
        vm.prank(alice);
        vault.redeem(remaining, alice, alice);
    }

    function testFuzzRoundingAndRepeatedSkims(uint96 seed, bool halfUp) public {
        uint256 amount = bound(uint256(seed), 3, CAP);
        pool.setHalfUp(halfUp);
        grow(1.123456789123456789123456789e27);
        deposit(alice, amount);
        for (uint256 i; i < 20; ++i) {
            grow(pool.index() + 1.23456789e22);
            vault.skim();
            assertGe(vault.held(), vault.principal());
        }
        vm.prank(alice);
        uint256 received = vault.redeem(amount, alice, alice);
        assertEq(received, amount);
    }

    function testForcedSettlementsPreserveScaledEntitlement() public {
        deposit(alice, 7);
        deposit(bob, 11);
        token.mint(address(vault), 1);
        vault.skim();
        uint256 aliceEntitlement = vault.entitlement(alice);
        for (uint256 i; i < 20; ++i) {
            vm.prank(bob);
            vault.transfer(alice, 1);
            vm.prank(alice);
            vault.transfer(bob, 1);
        }
        assertEq(vault.entitlement(alice), aliceEntitlement);
        assertEq(vault.entitlement(alice) + vault.entitlement(bob), vault.accumulator() * 18);
        assertLe(vault.entitlement(alice) + vault.entitlement(bob), 1e36);
    }
}
