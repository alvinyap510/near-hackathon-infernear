// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

/// @title CreditTopUp
/// @notice Buys InferNear API credits with USDC. This is a purchase, not a deposit: the USDC goes
/// straight to the recipient and cannot be redeemed. The contract holds no funds and has no owner,
/// admin, pause or upgrade path. It only keeps the cumulative USDC paid for each beneficiary, which
/// the keeper posts to the NEAR credit ledger at 1 USDC = 1 USD of credits. USDC sent to this contract
/// directly, instead of through `pay`, earns no credits and cannot be recovered.
contract CreditTopUp {
    using SafeERC20 for IERC20;

    IERC20 public immutable usdc;
    address public immutable recipient;
    /// @notice Smallest payment accepted. Each new beneficiary costs the operator ledger storage on NEAR,
    /// so a record must not be creatable for dust.
    uint256 public immutable minimum;

    /// @notice Cumulative USDC base units paid for each beneficiary. Only ever grows.
    mapping(address beneficiary => uint256) public paid;
    /// @notice Sum of `paid` over all beneficiaries.
    uint256 public paidTotal;

    event Paid(address indexed payer, address indexed beneficiary, uint256 amount);

    error ZeroAddress();
    error BelowMinimum();

    constructor(IERC20 usdc_, address recipient_, uint256 minimum_) {
        if (address(usdc_) == address(0) || recipient_ == address(0)) revert ZeroAddress();
        if (minimum_ == 0) revert BelowMinimum();
        usdc = usdc_;
        recipient = recipient_;
        minimum = minimum_;
    }

    /// @notice Pay `amount` USDC from the caller to the recipient and record it as credits for `beneficiary`.
    function pay(uint256 amount, address beneficiary) external {
        if (amount < minimum) revert BelowMinimum();
        if (beneficiary == address(0)) revert ZeroAddress();
        // Record before the external call; the token moves payer -> recipient and never rests here.
        paid[beneficiary] += amount;
        paidTotal += amount;
        emit Paid(msg.sender, beneficiary, amount);
        usdc.safeTransferFrom(msg.sender, recipient, amount);
    }
}
