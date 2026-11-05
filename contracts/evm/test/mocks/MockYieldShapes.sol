// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {IPendleMarket, IPendleOracle, IStakingRewards} from "../../src/interfaces/IYieldShapes.sol";

contract MockShapeToken is ERC20 {
    address internal failingRecipient;
    bool internal failTransfer;
    error MockPayoutFailed();
    constructor() ERC20("Mock shape asset", "MOCK") {}

    function mint(address user, uint256 amount) external {
        _mint(user, amount);
    }

    function burn(address user, uint256 amount) external {
        _burn(user, amount);
    }

    function setPayoutFailure(address recipient, bool fail) external {
        failingRecipient = recipient;
        failTransfer = fail;
    }

    function _update(address from, address to, uint256 amount) internal override {
        if (failTransfer && to == failingRecipient) revert MockPayoutFailed();
        super._update(from, to, amount);
    }
}

contract MockExchangeRateFeed {
    uint8 public immutable decimals;
    int256 public answer;
    uint256 public updatedAt;

    constructor(uint8 decimals_, int256 answer_) {
        decimals = decimals_;
        answer = answer_;
        updatedAt = block.timestamp;
    }

    function setAnswer(int256 value) external {
        answer = value;
    }

    function setUpdatedAt(uint256 value) external {
        updatedAt = value;
    }

    function latestRoundData() external view returns (uint80, int256, uint256, uint256, uint80) {
        return (1, answer, updatedAt, updatedAt, 1);
    }
}

contract MockPT is MockShapeToken {
    uint256 public immutable expiry;

    constructor(uint256 expiry_) {
        expiry = expiry_;
    }
}

contract MockPendleMarket is IPendleMarket {
    address internal immutable pt;

    constructor(address pt_) {
        pt = pt_;
    }

    function readTokens() external view returns (address, address, address) {
        return (address(0), pt, address(0));
    }
}

contract MockPendleOracle is IPendleOracle {
    uint256 public rate;

    constructor(uint256 initial) {
        rate = initial;
    }

    function setRate(uint256 value) external {
        rate = value;
    }

    function getPtToAssetRate(address, uint32) external view returns (uint256) {
        return rate;
    }
}

/// @dev Offline fixture with fixed rewards per staked unit per second and claim failures.
contract MockStakingRewards is IStakingRewards {
    using SafeERC20 for IERC20;
    IERC20 internal immutable token;
    IERC20 internal immutable reward;
    uint256 public immutable rate;
    mapping(address => uint256) public balanceOf;
    mapping(address => uint256) internal saved;
    mapping(address => uint256) internal last;
    bool public failClaim;

    constructor(IERC20 token_, IERC20 reward_, uint256 rate_) {
        token = token_;
        reward = reward_;
        rate = rate_;
    }

    function setFailClaim(bool fail) external {
        failClaim = fail;
    }

    function grant(address user, uint256 amount) external {
        saved[user] += amount;
    }

    function earned(address user) public view returns (uint256) {
        return saved[user] + Math.mulDiv(balanceOf[user], (block.timestamp - last[user]) * rate, 1e18);
    }

    function _checkpoint(address user) private {
        saved[user] = earned(user);
        last[user] = block.timestamp;
    }

    function stake(uint256 amount) external {
        _checkpoint(msg.sender);
        balanceOf[msg.sender] += amount;
        token.safeTransferFrom(msg.sender, address(this), amount);
    }

    function withdraw(uint256 amount) external {
        _checkpoint(msg.sender);
        balanceOf[msg.sender] -= amount;
        token.safeTransfer(msg.sender, amount);
    }

    function getReward() external {
        require(!failClaim, "mock claim failure");
        _checkpoint(msg.sender);
        uint256 amount = saved[msg.sender];
        saved[msg.sender] = 0;
        reward.safeTransfer(msg.sender, amount);
    }
}
