// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {IAavePool, IScaledAToken} from "../../src/interfaces/IAave.sol";

contract MockUSDC is ERC20 {
    constructor() ERC20("Mock USDC", "USDC") {}

    function decimals() public pure override returns (uint8) {
        return 6;
    }

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }

    function burn(address from, uint256 amount) external {
        _burn(from, amount);
    }
}

/// @dev Offline fixture: configurable ray rounding, not a full Aave implementation.
contract MockAToken is IScaledAToken {
    mapping(address => uint256) public scaledBalanceOf;
    MockUSDC public immutable underlying;
    MockPool public immutable pool;

    constructor(MockUSDC token) {
        underlying = token;
        pool = MockPool(msg.sender);
    }

    function balanceOf(address user) external view returns (uint256) {
        uint256 product = scaledBalanceOf[user] * pool.index();
        return (product + (pool.halfUp() ? 5e26 : 0)) / 1e27;
    }

    function mintScaled(address user, uint256 amount) external {
        require(msg.sender == address(pool));
        scaledBalanceOf[user] += amount;
    }

    function burnScaled(address user, uint256 amount, address to, uint256 assets) external {
        require(msg.sender == address(pool));
        scaledBalanceOf[user] -= amount;
        underlying.transfer(to, assets);
    }
}

contract MockPool is IAavePool {
    MockUSDC public immutable usdc;
    MockAToken public immutable aToken;
    uint256 public index = 1e27;
    bool public halfUp;
    uint256 public roundingLoss;
    uint256 public roundingGain;

    constructor(MockUSDC token) {
        usdc = token;
        aToken = new MockAToken(token);
    }

    function setHalfUp(bool value) external {
        halfUp = value;
    }

    function setIndex(uint256 value) external {
        index = value;
    }

    function getReserveNormalizedIncome(address) external view returns (uint256) {
        return index;
    }

    function position(address user) public view returns (uint256) {
        return Math.mulDiv(aToken.scaledBalanceOf(user), index, 1e27);
    }

    function supply(address, uint256 amount, address onBehalfOf, uint16) external {
        uint256 beforeValue = position(onBehalfOf);
        usdc.transferFrom(msg.sender, address(aToken), amount);
        uint256 scaled = halfUp ? (amount * 1e27 + index / 2) / index : Math.mulDiv(amount, 1e27, index);
        require(scaled != 0, "invalid scaled amount");
        aToken.mintScaled(onBehalfOf, scaled);
        uint256 valueIn = position(onBehalfOf) - beforeValue;
        _rounding(amount, valueIn);
    }

    function withdraw(address, uint256 amount, address to) external returns (uint256) {
        uint256 beforeValue = position(msg.sender);
        uint256 scaled =
            halfUp ? (amount * 1e27 + index / 2) / index : Math.mulDiv(amount, 1e27, index, Math.Rounding.Ceil);
        aToken.burnScaled(msg.sender, scaled, to, amount);
        uint256 valueOut = beforeValue - position(msg.sender);
        _rounding(valueOut, amount);
        return amount;
    }

    function _rounding(uint256 expected, uint256 actual) private {
        if (expected > actual) roundingLoss += expected - actual;
        else roundingGain += actual - expected;
    }
}
