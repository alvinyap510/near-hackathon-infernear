import { parseAbi } from 'viem';

export const vaultAbi = parseAbi([
  'function totalSupply() view returns (uint256)',
  'function depositCap() view returns (uint256)',
  'function yieldToken() view returns (address)',
  'function asset() view returns (address)',
  'function balanceOf(address) view returns (uint256)',
  'function convertToAssets(uint256) view returns (uint256)',
  'function yieldCredited(address) view returns (uint256)',
  'function deposit(uint256 assets, address receiver) returns (uint256)',
  'function redeem(uint256 shares, address receiver, address owner) returns (uint256)',
]);
export const usdcAbi = parseAbi([
  'function balanceOf(address) view returns (uint256)',
  'function allowance(address,address) view returns (uint256)',
  'function approve(address,uint256) returns (bool)',
  'function transfer(address,uint256) returns (bool)',
]);

// Aave V3 ReserveData: currentLiquidityRate is a ray (1e27).
export const aavePoolAbi = parseAbi([
  'function getReserveData(address) view returns ((uint256 configuration,uint128 liquidityIndex,uint128 currentLiquidityRate,uint128 variableBorrowIndex,uint128 currentVariableBorrowRate,uint128 currentStableBorrowRate,uint40 lastUpdateTimestamp,uint16 id,address aTokenAddress,address stableDebtTokenAddress,address variableDebtTokenAddress,address interestRateStrategyAddress,uint128 accruedToTreasury,uint128 unbacked,uint128 isolationModeTotalDebt))',
]);

export const topUpAbi = parseAbi([
  'function pay(uint256 amount, address beneficiary)',
  'function minimum() view returns (uint256)',
  'function paid(address) view returns (uint256)',
  'function paidTotal() view returns (uint256)',
  'function usdc() view returns (address)',
]);
