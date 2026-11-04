// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {Test} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {IWstETH, IPendleMarket, IPendlePT, IPendleOracle, IStakingRewards} from "../src/interfaces/IYieldShapes.sol";
import {PendlePtVault} from "../src/PendlePtVault.sol";
import {WstEthHarness, PendlePtHarness, StakingRewardsHarness} from "./mocks/ShapeHarnesses.sol";

interface IStakingRewardsLive is IStakingRewards {
    function stakingToken() external view returns (address);
    function rewardsToken() external view returns (address);
    function periodFinish() external view returns (uint256);
}

contract WstEthVaultForkTest is Test {
    IWstETH internal token;
    WstEthHarness internal vault;
    address internal treasury = makeAddr("wstETH fork treasury");
    uint256 internal constant CUSHION = 10_000;

    function setUp() public {
        string memory rpc = vm.envOr("WSTETH_FORK_RPC_URL", string(""));
        vm.skip(bytes(rpc).length == 0);
        vm.createSelectFork(rpc);
        token = IWstETH(vm.envAddress("WSTETH_ADDRESS"));
        vault = new WstEthHarness(token, treasury, CUSHION, 1e30);
        deal(address(token), address(this), 101e18 + CUSHION);
        assertTrue(token.transfer(address(vault), CUSHION));
        token.approve(address(vault), type(uint256).max);
    }

    function testForkNativeRateAndPrincipalRoundTrip() public {
        uint256 rate = token.stEthPerToken();
        uint256 shares = vault.deposit(100e18, address(this));
        assertEq(shares, Math.mulDiv(100e18, rate, 1e18));
        assertGe(vault.held(), vault.principal());
        uint256 returned = vault.redeem(shares, address(this), address(this));
        assertApproxEqAbs(returned, 100e18, 2);
        assertEq(vault.paidTotal(), 0);
        emit log_named_uint("fork block", block.number);
        emit log_named_uint("native stEthPerToken", rate);
    }

    function testForkDonatedWstEthPaysWithoutSpendingPrincipal() public {
        uint256 shares = vault.deposit(100e18, address(this));
        // Local token funding/donation exercises payout; a time warp alone does not make Lido rebase.
        assertTrue(token.transfer(address(vault), 1e18));
        vault.skim();
        assertEq(vault.paidTotal(), 1e18);
        assertApproxEqAbs(vault.yieldCredited(address(this)), 1e18, 1);
        assertGe(vault.held(), vault.principal());
        assertApproxEqAbs(vault.redeem(shares, address(this), address(this)), 100e18, 2);
    }
}

contract PendlePtVaultForkTest is Test {
    IPendleMarket internal market;
    IPendleOracle internal oracle;
    IERC20 internal token;
    PendlePtHarness internal vault;
    address internal treasury = makeAddr("PT fork treasury");
    uint256 internal constant CUSHION = 10_000;
    uint256 internal initial;

    function setUp() public {
        string memory rpc = vm.envOr("PENDLE_FORK_RPC_URL", string(""));
        vm.skip(bytes(rpc).length == 0);
        vm.createSelectFork(rpc);
        market = IPendleMarket(vm.envAddress("PENDLE_MARKET_ADDRESS"));
        oracle = IPendleOracle(vm.envAddress("PENDLE_ORACLE_ADDRESS"));
        (, address pt,) = market.readTokens();
        token = IERC20(pt);
        initial = oracle.getPtToAssetRate(address(market), 0);
        vault = new PendlePtHarness(market, oracle, initial, treasury, CUSHION, 1e30);
        deal(address(token), address(this), 100e18 + CUSHION);
        assertTrue(token.transfer(address(vault), CUSHION));
        token.approve(address(vault), type(uint256).max);
    }

    function testForkRealMarketGateAndMaturityClamp() public {
        uint256 shares = vault.deposit(100e18, address(this));
        assertEq(shares, Math.mulDiv(100e18, initial, 1e18));
        uint256 expiry = IPendlePT(address(token)).expiry();
        emit log_named_uint("fork block", block.number);
        emit log_named_uint("expiry", expiry);
        emit log_named_uint("c0 (PT to asset, wad)", initial);
        vm.warp(expiry);
        assertEq(vault.curve(), 1e18);
        vault.skim();
        assertGe(vault.held(), vault.principal());
        assertGt(vault.paidTotal(), 0);
        uint256 paid = vault.paidTotal();
        vm.warp(expiry + 30 days);
        vault.skim();
        assertEq(vault.paidTotal(), paid);
        uint256 returned = vault.redeem(shares, address(this), address(this));
        assertLe(returned, 100e18);
        assertEq(returned, shares);
        assertEq(vault.held() + returned + token.balanceOf(treasury), 100e18 + CUSHION);
    }

    function testForkRateAboveCurveRejectsAdmission() public {
        PendlePtHarness belowMarket = new PendlePtHarness(market, oracle, initial - 1, treasury, CUSHION, 1e30);
        token.approve(address(belowMarket), type(uint256).max);
        vm.expectRevert(abi.encodeWithSelector(PendlePtVault.DepositRateAboveCurve.selector, initial, initial - 1));
        belowMarket.deposit(1e18, address(this));
    }
}

contract StakingRewardsVaultForkTest is Test {
    IStakingRewardsLive internal pool;
    IERC20 internal token;
    IERC20 internal reward;
    StakingRewardsHarness internal vault;
    address internal treasury = makeAddr("staking fork treasury");
    uint256 internal constant CUSHION = 10_000;

    function setUp() public {
        string memory rpc = vm.envOr("STAKING_FORK_RPC_URL", string(""));
        vm.skip(bytes(rpc).length == 0);
        vm.createSelectFork(rpc);
        pool = IStakingRewardsLive(vm.envAddress("STAKING_POOL_ADDRESS"));
        token = IERC20(pool.stakingToken());
        reward = IERC20(pool.rewardsToken());
        assertTrue(address(token) != address(reward));
        vault = new StakingRewardsHarness(token, reward, pool, treasury, CUSHION, 1e30);
        deal(address(token), address(this), 100e18 + CUSHION);
        assertTrue(token.transfer(address(vault), CUSHION));
        token.approve(address(vault), type(uint256).max);
    }

    function testForkStakeClaimAndFullPrincipalExit() public {
        vault.deposit(100e18, address(this));
        assertEq(pool.balanceOf(address(vault)), 100e18);
        assertEq(vault.held(), 100e18 + CUSHION);
        // A finished reward programme may pay zero; principal remains withdrawable in either case.
        vm.warp(block.timestamp + 1 hours);
        uint256 earned = pool.earned(address(vault));
        vault.skim();
        assertEq(vault.paidTotal(), earned);
        assertEq(reward.balanceOf(treasury), earned);
        assertApproxEqAbs(vault.yieldCredited(address(this)), earned, 1);
        assertGe(vault.held(), vault.principal());
        assertEq(vault.redeem(100e18, address(this), address(this)), 100e18);
        assertEq(vault.held(), CUSHION);
        emit log_named_uint("fork block", block.number);
        emit log_named_uint("reward token paid", earned);
        emit log_named_uint("pool period finish", pool.periodFinish());
    }
}
