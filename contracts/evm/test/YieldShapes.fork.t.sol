// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {Test} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {IExchangeRateFeed, IPendleMarket, IPendlePT, IPendleOracle} from "../src/interfaces/IYieldShapes.sol";
import {PendlePtVault} from "../src/PendlePtVault.sol";
import {RateHarness, PendlePtHarness} from "./mocks/ShapeHarnesses.sol";

contract RateVaultForkTest is Test {
    IERC20 internal token;
    IExchangeRateFeed internal feed;
    RateHarness internal vault;
    address internal treasury = makeAddr("rate fork treasury");
    uint256 internal constant CUSHION = 10_000;

    function setUp() public {
        string memory rpc = vm.envOr("RATE_FORK_RPC_URL", string(""));
        vm.skip(bytes(rpc).length == 0);
        string memory fixture = vm.readFile("test/fixtures/base.json");
        vm.createSelectFork(rpc, vm.parseJsonUint(fixture, ".blockNumber"));
        token = IERC20(vm.parseJsonAddress(fixture, ".rateAsset"));
        feed = IExchangeRateFeed(vm.parseJsonAddress(fixture, ".rateFeed"));
        vault = new RateHarness(token, feed, treasury, CUSHION, 1e30);
        deal(address(token), address(this), 101e18 + CUSHION);
        assertTrue(token.transfer(address(vault), CUSHION));
        token.approve(address(vault), type(uint256).max);
    }

    function testForkBaseCbEthRateSkimAndPrincipalRoundTrip() public {
        (, int256 answer,,,) = feed.latestRoundData();
        uint256 normalized = Math.mulDiv(uint256(answer), 1e18, 10 ** uint256(feed.decimals()));
        assertEq(vault.rate(), normalized);
        uint256 shares = vault.deposit(100e18, address(this));
        assertEq(shares, Math.mulDiv(100e18, normalized, 1e18));
        vault.skim();
        assertEq(vault.paidTotal(), 0);
        assertGe(vault.held(), vault.principal());
        address receiver = makeAddr("principal receiver");
        uint256 beforeBalance = token.balanceOf(receiver);
        uint256 returned = vault.redeem(shares, receiver, address(this));
        uint256 received = token.balanceOf(receiver) - beforeBalance;
        assertEq(received, returned);
        assertApproxEqAbs(received, 100e18, 2);
        emit log_named_uint("Base fork block", block.number);
        emit log_named_uint("exchange rate (wad)", normalized);
    }

    function testForkBaseCbEthDonationPaysWithoutSpendingPrincipal() public {
        uint256 shares = vault.deposit(100e18, address(this));
        // The historical feed does not update through time warp. This surplus is a local funded donation.
        assertTrue(token.transfer(address(vault), 1e18));
        vault.skim();
        assertEq(vault.paidTotal(), 1e18);
        assertApproxEqAbs(vault.yieldCredited(address(this)), 1e18, 1);
        assertGe(vault.held(), vault.principal());
        address receiver = makeAddr("principal receiver");
        uint256 beforeBalance = token.balanceOf(receiver);
        uint256 returned = vault.redeem(shares, receiver, address(this));
        uint256 received = token.balanceOf(receiver) - beforeBalance;
        assertEq(received, returned);
        assertApproxEqAbs(received, 100e18, 2);
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
        string memory fixture = vm.readFile("test/fixtures/base.json");
        vm.createSelectFork(rpc, vm.parseJsonUint(fixture, ".blockNumber"));
        market = IPendleMarket(vm.parseJsonAddress(fixture, ".pendleMarket"));
        oracle = IPendleOracle(vm.parseJsonAddress(fixture, ".pendleOracle"));
        (, address pt,) = market.readTokens();
        token = IERC20(pt);
        initial = oracle.getPtToAssetRate(address(market), 0);
        vault = new PendlePtHarness(market, oracle, initial, treasury, CUSHION, 1e30);
        deal(address(token), address(this), 100e18 + CUSHION);
        assertTrue(token.transfer(address(vault), CUSHION));
        token.approve(address(vault), type(uint256).max);
    }

    function testForkBaseDeJaaaCurveSkimAndMaturityRedeem() public {
        uint256 started = block.timestamp;
        uint256 shares = vault.deposit(100e18, address(this));
        assertEq(shares, Math.mulDiv(100e18, initial, 1e18));
        uint256 expiry = IPendlePT(address(token)).expiry();
        emit log_named_uint("Base fork block", block.number);
        emit log_named_uint("expiry", expiry);
        emit log_named_uint("c0 (PT to asset, wad)", initial);
        vm.warp(started + (expiry - started) / 2);
        assertEq(vault.curve(), initial + Math.mulDiv(1e18 - initial, (expiry - started) / 2, expiry - started));
        vault.skim();
        assertGt(vault.paidTotal(), 0);
        assertGe(vault.held(), vault.principal());
        vm.warp(expiry);
        assertEq(vault.curve(), 1e18);
        vault.skim();
        assertGe(vault.held(), vault.principal());
        uint256 paid = vault.paidTotal();
        vm.warp(expiry + 30 days);
        vault.skim();
        assertEq(vault.paidTotal(), paid);
        address receiver = makeAddr("principal receiver");
        uint256 beforeBalance = token.balanceOf(receiver);
        uint256 returned = vault.redeem(shares, receiver, address(this));
        uint256 received = token.balanceOf(receiver) - beforeBalance;
        assertEq(received, returned);
        assertLe(received, 100e18);
        assertEq(received, shares);
        assertEq(vault.held() + received + token.balanceOf(treasury), 100e18 + CUSHION);
    }

    function testForkBaseDeJaaaRateAboveCurveRejectsAdmission() public {
        PendlePtHarness belowMarket = new PendlePtHarness(market, oracle, initial - 1, treasury, CUSHION, 1e30);
        token.approve(address(belowMarket), type(uint256).max);
        vm.expectRevert(abi.encodeWithSelector(PendlePtVault.DepositRateAboveCurve.selector, initial, initial - 1));
        belowMarket.deposit(1e18, address(this));
    }
}
