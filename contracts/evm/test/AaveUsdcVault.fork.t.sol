// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {Test} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {AaveV3Base, AaveV3BaseAssets} from "aave-address-book/AaveV3Base.sol";
import {IAavePool, IScaledAToken} from "../src/interfaces/IAave.sol";
import {VaultHarness} from "./mocks/VaultHarness.sol";

interface IRevisions {
    function POOL_REVISION() external view returns (uint256);
    function ATOKEN_REVISION() external view returns (uint256);
}

contract AaveUsdcVaultForkTest is Test {
    IERC20 internal token;
    IAavePool internal pool;
    IScaledAToken internal aToken;
    VaultHarness internal vault;
    address internal treasury = makeAddr("fork treasury");
    uint256 internal constant CUSHION = 10_000;
    uint256 internal constant PRINCIPAL = 100e6;

    function setUp() public {
        string memory rpc = vm.envOr("FORK_RPC_URL", string(""));
        vm.skip(bytes(rpc).length == 0);
        vm.createSelectFork(rpc);
        token = IERC20(AaveV3BaseAssets.USDC_UNDERLYING);
        pool = IAavePool(address(AaveV3Base.POOL));
        aToken = IScaledAToken(AaveV3BaseAssets.USDC_A_TOKEN);
        vault = new VaultHarness(token, pool, aToken, treasury, CUSHION, 1_000e6);
        deal(address(token), address(this), PRINCIPAL + CUSHION);
        assertTrue(token.transfer(address(vault), CUSHION));
        token.approve(address(vault), type(uint256).max);
    }

    function testForkDepositAccrueSkimFullRedeem() public {
        vault.deposit(PRINCIPAL, address(this));
        vm.warp(block.timestamp + 30 days);
        vault.skim();
        assertGt(vault.paidTotal(), 0);
        assertEq(vault.paidTotal(), token.balanceOf(treasury));
        assertGe(vault.held(), vault.principal());
        uint256 received = vault.redeem(PRINCIPAL, address(this), address(this));
        assertGe(received, PRINCIPAL - 3 * CUSHION);
        assertEq(vault.totalSupply(), 0);
        emit log_named_uint("redeemed USDC base units", received);
    }

    function testForkConsecutiveSkimsAtRealIndices() public {
        vault.deposit(PRINCIPAL, address(this));
        uint256 previousCredit;
        for (uint256 i; i < 32; ++i) {
            vm.warp(block.timestamp + 1 days);
            vault.skim();
            assertGe(vault.held(), vault.principal());
            assertGe(vault.yieldCredited(address(this)), previousCredit);
            previousCredit = vault.yieldCredited(address(this));
        }
        assertGt(vault.paidTotal(), 0);
        assertEq(vault.paidTotal(), token.balanceOf(treasury));
        uint256 received = vault.redeem(PRINCIPAL, address(this), address(this));
        assertGe(received, PRINCIPAL - 34 * CUSHION);
        emit log_named_uint("consecutive skims", 32);
    }

    function testForkVerifyDeployedVersionAndRounding() public {
        emit log_named_uint("fork block", block.number);
        emit log_named_uint("pool revision", IRevisions(address(pool)).POOL_REVISION());
        emit log_named_uint("aToken revision", IRevisions(address(aToken)).ATOKEN_REVISION());
        uint256 index = pool.getReserveNormalizedIncome(address(token));
        uint256 scaledBefore = aToken.scaledBalanceOf(address(vault));
        vault.deposit(PRINCIPAL, address(this));
        uint256 scaled = aToken.scaledBalanceOf(address(vault));
        assertEq(scaled - scaledBefore, Math.mulDiv(PRINCIPAL, 1e27, index));
        assertEq(IERC20(address(aToken)).balanceOf(address(vault)), Math.mulDiv(scaled, index, 1e27));
        // With no yield yet, withdraw changes only the scaled position and the idle cushion.
        uint256 amount = 13e6;
        vault.withdraw(amount, address(this), address(this));
        uint256 burned = scaled - aToken.scaledBalanceOf(address(vault));
        assertEq(burned, Math.mulDiv(amount - CUSHION, 1e27, index, Math.Rounding.Ceil));
        assertGe(vault.held(), vault.principal());
        emit log_named_uint("liquidity index (ray)", index);
    }
}
