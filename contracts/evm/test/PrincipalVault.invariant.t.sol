// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {Test, Vm} from "forge-std/Test.sol";
import {StdInvariant} from "forge-std/StdInvariant.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {MockUSDC, MockPool} from "./mocks/MockAave.sol";
import {VaultHarness} from "./mocks/VaultHarness.sol";

contract VaultHandler is Test {
    MockUSDC public token;
    MockPool public pool;
    VaultHarness public vault;
    address[3] public actors;
    uint256 public deposits;
    uint256 public withdrawals;
    uint256 public donations;
    uint256 public protocolGains;
    uint256 public protocolLosses;
    uint256 public attributed;
    uint256 public attributionCount;
    uint256[3] public lastCredit;

    constructor(MockUSDC token_, MockPool pool_, VaultHarness vault_) {
        token = token_;
        pool = pool_;
        vault = vault_;
        actors = [makeAddr("handler alice"), makeAddr("handler bob"), makeAddr("handler carol")];
        for (uint256 i; i < 3; ++i) {
            token.mint(actors[i], 1e24);
            vm.prank(actors[i]);
            token.approve(address(vault), type(uint256).max);
        }
    }

    function deposit(uint256 who, uint256 raw, bool useMint) external {
        address actor = actors[who % 3];
        uint256 capacity = vault.maxDeposit(actor);
        if (capacity < 4) return;
        uint256 amount = bound(raw, 4, capacity);
        vm.recordLogs();
        vm.prank(actor);
        if (useMint) vault.mint(amount, actor);
        else vault.deposit(amount, actor);
        deposits += amount;
        _record();
    }

    function exit(uint256 who, uint256 raw, bool useWithdraw) external {
        address actor = actors[who % 3];
        uint256 balance = vault.balanceOf(actor);
        if (balance == 0) return;
        uint256 amount = bound(raw, 1, balance);
        uint256 beforeBalance = token.balanceOf(actor);
        vm.recordLogs();
        vm.prank(actor);
        if (useWithdraw) vault.withdraw(amount, actor, actor);
        else vault.redeem(amount, actor, actor);
        withdrawals += token.balanceOf(actor) - beforeBalance;
        _record();
    }

    function move(uint256 from, uint256 to, uint256 raw, bool allowance) external {
        address sender = actors[from % 3];
        address receiver = actors[to % 3];
        uint256 amount = bound(raw, 0, vault.balanceOf(sender));
        vm.recordLogs();
        if (allowance) {
            vm.prank(sender);
            vault.approve(address(this), amount);
            vault.transferFrom(sender, receiver, amount);
        } else {
            vm.prank(sender);
            vault.transfer(receiver, amount);
        }
        _record();
    }

    function grow(uint256 raw) external {
        uint256 scaled = pool.aToken().scaledBalanceOf(address(vault));
        uint256 oldValue = Math.mulDiv(scaled, pool.index(), 1e27);
        uint256 nextIndex = pool.index() + bound(raw, 0, 1e23);
        pool.setIndex(nextIndex);
        protocolGains += Math.mulDiv(scaled, nextIndex, 1e27) - oldValue;
    }

    function loseSurplus(uint256 raw) external {
        uint256 scaled = pool.aToken().scaledBalanceOf(address(vault));
        if (scaled == 0) return;
        // Losses stay within unassigned surplus; arbitrary insolvency is tested separately.
        uint256 held = vault.held();
        uint256 floor = vault.principal() + vault.cushion();
        if (held <= floor + 2) return;
        uint256 budget = bound(raw, 0, held - floor - 2);
        uint256 decrease = Math.min(Math.mulDiv(budget, 1e27, scaled), pool.index() - 1e27);
        uint256 beforeValue = Math.mulDiv(scaled, pool.index(), 1e27);
        pool.setIndex(pool.index() - decrease);
        protocolLosses += beforeValue - Math.mulDiv(scaled, pool.index(), 1e27);
    }

    function donate(uint256 raw) external {
        uint256 amount = bound(raw, 0, 1e8);
        token.mint(address(vault), amount);
        donations += amount;
    }

    function skim(bool failPayment) external {
        vault.setFailPay(failPayment);
        vm.recordLogs();
        if (failPayment) {
            // Balance-changing calls keep attribution on payment failure.
            vm.prank(actors[0]);
            vault.transfer(actors[1], 0);
            uint256 balance = vault.balanceOf(actors[0]);
            if (balance != 0) {
                vm.prank(actors[0]);
                vault.transfer(actors[1], 1);
            }
        } else {
            vault.skim();
        }
        _record();
    }

    function rounding(bool halfUp) external {
        pool.setHalfUp(halfUp);
    }

    function _record() private {
        Vm.Log[] memory logs = vm.getRecordedLogs();
        bytes32 signature = keccak256("Skimmed(address,uint256,uint256,uint256)");
        for (uint256 i; i < logs.length; ++i) {
            if (logs[i].emitter == address(vault) && logs[i].topics[0] == signature) {
                (uint256 amount,,) = abi.decode(logs[i].data, (uint256, uint256, uint256));
                attributed += amount;
                if (amount != 0) attributionCount++;
            }
        }
        for (uint256 i; i < 3; ++i) {
            uint256 credit = vault.yieldCredited(actors[i]);
            assertGe(credit, lastCredit[i], "cumulative credits decreased");
            lastCredit[i] = credit;
        }
    }
}

contract PrincipalVaultInvariantTest is StdInvariant, Test {
    MockUSDC internal token;
    MockPool internal pool;
    VaultHarness internal vault;
    VaultHandler internal handler;
    address internal treasury = makeAddr("treasury");
    uint256 internal constant CUSHION = 10_000;

    function setUp() public {
        token = new MockUSDC();
        pool = new MockPool(token);
        vault = new VaultHarness(token, pool, pool.aToken(), treasury, CUSHION, 1_000_000e6);
        token.mint(address(vault), CUSHION);
        token.mint(address(pool.aToken()), 1e24);
        handler = new VaultHandler(token, pool, vault);
        bytes4[] memory selectors = new bytes4[](8);
        selectors[0] = handler.deposit.selector;
        selectors[1] = handler.exit.selector;
        selectors[2] = handler.move.selector;
        selectors[3] = handler.grow.selector;
        selectors[4] = handler.donate.selector;
        selectors[5] = handler.skim.selector;
        selectors[6] = handler.rounding.selector;
        selectors[7] = handler.loseSurplus.selector;
        targetSelector(FuzzSelector({addr: address(handler), selectors: selectors}));
        targetContract(address(handler));
    }

    function invariantPrincipalCovered() public view {
        assertGe(vault.held(), vault.principal());
        assertLe(vault.totalSupply(), vault.depositCap());
    }

    function invariantPerTokenFlow() public view {
        uint256 incoming =
            CUSHION + handler.deposits() + handler.donations() + handler.protocolGains() + pool.roundingGain();
        uint256 outgoing =
            handler.withdrawals() + token.balanceOf(treasury) + pool.roundingLoss() + handler.protocolLosses();
        assertEq(incoming - outgoing, vault.held(), "USDC flow does not reconcile");
        assertEq(token.balanceOf(treasury), vault.paidTotal(), "payment not measured");
    }

    function invariantYieldBuckets() public view {
        assertEq(handler.attributed() + vault.unattributed(), vault.paidTotal() + vault.unpaid());
    }

    function invariantScaledEntitlements() public view {
        uint256 scaled;
        uint256 integerViews;
        for (uint256 i; i < 3; ++i) {
            address actor = handler.actors(i);
            scaled += vault.entitlement(actor);
            integerViews += vault.yieldCredited(actor);
        }
        uint256 budget = handler.attributed() * 1e36;
        assertLe(scaled, budget);
        if (handler.attributionCount() == 0) assertEq(scaled, 0);
        else assertLt(budget - scaled, handler.attributionCount() * 1e36, "index dust >= 1 wei per skim");
        assertLt(scaled - integerViews * 1e36, 3e36, "holder view dust >= 1 wei each");
    }
}
