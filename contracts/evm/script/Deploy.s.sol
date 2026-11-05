// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {Script} from "forge-std/Script.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {PrincipalVault} from "../src/PrincipalVault.sol";
import {AaveUsdcVault} from "../src/AaveUsdcVault.sol";
import {RateVault} from "../src/RateVault.sol";
import {PendlePtVault} from "../src/PendlePtVault.sol";
import {IAavePool, IScaledAToken} from "../src/interfaces/IAave.sol";
import {IExchangeRateFeed, IPendleMarket, IPendleOracle} from "../src/interfaces/IYieldShapes.sol";

contract Deploy is Script {
    using SafeERC20 for IERC20;
    error UnknownVaultKind(string kind);

    function run() external returns (PrincipalVault vault) {
        string memory kind = vm.envString("EVM_VAULT_KIND");
        bytes32 selected = keccak256(bytes(kind));
        bool aave = selected == keccak256("aave");
        bool rate = selected == keccak256("rate");
        bool pendle = selected == keccak256("pendle");
        if (!aave && !rate && !pendle) revert UnknownVaultKind(kind);
        address recipient = vm.envAddress("EVM_YIELD_RECIPIENT");
        uint256 cushion = vm.envUint("EVM_CUSHION");
        uint256 cap = vm.envUint("EVM_DEPOSIT_CAP");
        vm.startBroadcast(vm.envUint("EVM_DEPLOYER_PRIVATE_KEY"));
        if (aave) {
            vault = new AaveUsdcVault(
                IERC20(vm.envAddress("EVM_USDC")),
                IAavePool(vm.envAddress("EVM_AAVE_POOL")),
                IScaledAToken(vm.envAddress("EVM_AUSDC")),
                recipient,
                cushion,
                cap
            );
        } else if (rate) {
            vault = new RateVault(
                IERC20(vm.envAddress("RATE_ASSET_ADDRESS")),
                IExchangeRateFeed(vm.envAddress("RATE_FEED_ADDRESS")),
                recipient,
                cushion,
                cap
            );
        } else {
            IPendleMarket market = IPendleMarket(vm.envAddress("PENDLE_MARKET_ADDRESS"));
            IPendleOracle oracle = IPendleOracle(vm.envAddress("PENDLE_ORACLE_ADDRESS"));
            uint256 c0 = oracle.getPtToAssetRate(address(market), 0);
            vault = new PendlePtVault(market, oracle, c0, recipient, cushion, cap);
        }
        // Direct donation seeds the asset's rounding budget without minting shares or user credits.
        IERC20(vault.asset()).safeTransfer(address(vault), cushion);
        vm.stopBroadcast();
    }
}
