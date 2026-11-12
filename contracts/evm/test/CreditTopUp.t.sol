// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {Test} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {CreditTopUp} from "../src/CreditTopUp.sol";
import {DeployTopUp} from "../script/DeployTopUp.s.sol";
import {MockUSDC} from "./mocks/MockAave.sol";

contract CreditTopUpTest is Test {
    MockUSDC internal usdc;
    CreditTopUp internal topUp;
    address internal treasury = makeAddr("treasury");
    address internal alice = makeAddr("alice");
    address internal bob = makeAddr("bob");
    uint256 internal constant MINIMUM = 1e6;

    event Paid(address indexed payer, address indexed beneficiary, uint256 amount);

    function setUp() public {
        usdc = new MockUSDC();
        topUp = new CreditTopUp(IERC20(address(usdc)), treasury, MINIMUM);
        usdc.mint(alice, 100e6);
        usdc.mint(bob, 100e6);
        vm.prank(alice);
        usdc.approve(address(topUp), type(uint256).max);
        vm.prank(bob);
        usdc.approve(address(topUp), type(uint256).max);
    }

    function test_PaymentGoesStraightToRecipientAndIsRecorded() public {
        vm.expectEmit(true, true, false, true);
        emit Paid(alice, alice, 5e6);
        vm.prank(alice);
        topUp.pay(5e6, alice);
        assertEq(usdc.balanceOf(treasury), 5e6);
        assertEq(usdc.balanceOf(address(topUp)), 0);
        assertEq(usdc.balanceOf(alice), 95e6);
        assertEq(topUp.paid(alice), 5e6);
        assertEq(topUp.paidTotal(), 5e6);
    }

    function test_PaymentsAccumulatePerBeneficiary() public {
        vm.prank(alice);
        topUp.pay(1e6, alice);
        vm.prank(alice);
        topUp.pay(2e6, alice);
        vm.prank(bob);
        topUp.pay(4e6, bob);
        assertEq(topUp.paid(alice), 3e6);
        assertEq(topUp.paid(bob), 4e6);
        assertEq(topUp.paidTotal(), 7e6);
        assertEq(usdc.balanceOf(treasury), 7e6);
    }

    function test_PayerCanBuyCreditsForAnotherAddress() public {
        vm.expectEmit(true, true, false, true);
        emit Paid(bob, alice, 3e6);
        vm.prank(bob);
        topUp.pay(3e6, alice);
        assertEq(topUp.paid(alice), 3e6);
        assertEq(topUp.paid(bob), 0);
        assertEq(usdc.balanceOf(bob), 97e6);
    }

    function test_RejectsDustAndZeroBeneficiary() public {
        vm.startPrank(alice);
        vm.expectRevert(CreditTopUp.BelowMinimum.selector);
        topUp.pay(0, alice);
        vm.expectRevert(CreditTopUp.BelowMinimum.selector);
        topUp.pay(MINIMUM - 1, alice);
        vm.expectRevert(CreditTopUp.ZeroAddress.selector);
        topUp.pay(1e6, address(0));
        vm.stopPrank();
        assertEq(topUp.paidTotal(), 0);
    }

    function test_RejectsZeroConstructorInputs() public {
        vm.expectRevert(CreditTopUp.ZeroAddress.selector);
        new CreditTopUp(IERC20(address(0)), treasury, MINIMUM);
        vm.expectRevert(CreditTopUp.ZeroAddress.selector);
        new CreditTopUp(IERC20(address(usdc)), address(0), MINIMUM);
        vm.expectRevert(CreditTopUp.BelowMinimum.selector);
        new CreditTopUp(IERC20(address(usdc)), treasury, 0);
    }

    function test_FailedTransferRecordsNothing() public {
        address broke = makeAddr("broke");
        vm.prank(broke);
        usdc.approve(address(topUp), type(uint256).max);
        vm.prank(broke);
        vm.expectRevert();
        topUp.pay(1e6, broke);
        assertEq(topUp.paid(broke), 0);
        assertEq(topUp.paidTotal(), 0);
    }

    /// Recorded credits always equal the USDC the recipient actually received, and the contract holds nothing.
    function testFuzz_RecordedEqualsReceived(uint96[8] memory amounts, bool[8] memory fromBob) public {
        uint256 expectedAlice;
        uint256 expectedBob;
        for (uint256 i = 0; i < amounts.length; i++) {
            uint256 amount = bound(uint256(amounts[i]), MINIMUM, 1_000_000e6);
            address payer = fromBob[i] ? bob : alice;
            usdc.mint(payer, amount);
            vm.prank(payer);
            topUp.pay(amount, payer);
            if (fromBob[i]) expectedBob += amount;
            else expectedAlice += amount;
        }
        assertEq(topUp.paid(alice), expectedAlice);
        assertEq(topUp.paid(bob), expectedBob);
        assertEq(topUp.paidTotal(), expectedAlice + expectedBob);
        assertEq(usdc.balanceOf(treasury), expectedAlice + expectedBob);
        assertEq(usdc.balanceOf(address(topUp)), 0);
    }

    function test_DeployScriptUsesEnvAddresses() public {
        vm.setEnv("EVM_USDC", vm.toString(address(usdc)));
        vm.setEnv("EVM_YIELD_RECIPIENT", vm.toString(treasury));
        vm.setEnv("EVM_DEPLOYER_PRIVATE_KEY", vm.toString(uint256(123)));
        vm.setEnv("EVM_TOPUP_MINIMUM", vm.toString(MINIMUM));
        CreditTopUp deployed = new DeployTopUp().run();
        assertEq(address(deployed.usdc()), address(usdc));
        assertEq(deployed.recipient(), treasury);
        assertEq(deployed.minimum(), MINIMUM);
        assertEq(deployed.paidTotal(), 0);
    }
}
