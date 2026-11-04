// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {ERC4626} from "@openzeppelin/contracts/token/ERC20/extensions/ERC4626.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/// @notice Principal-only shares. Realized surplus belongs to the fixed yield recipient.
abstract contract PrincipalVault is ERC4626, ReentrancyGuard {
    uint256 internal constant SCALE = 1e36;
    address public immutable yieldRecipient;
    uint256 public immutable depositCap;
    uint256 public immutable cushion;
    uint256 public unpaid;
    uint256 public paidTotal;

    uint256 internal acc;
    uint256 public unattributed;
    mapping(address => uint256) internal creditedScaled;
    mapping(address => uint256) internal snap;

    event Skimmed(address indexed token, uint256 attributed, uint256 paid, uint256 acc);
    event PayFailed(bytes reason);
    error ZeroBacking();
    error DepositCapExceeded();

    constructor(
        IERC20 asset_,
        string memory name_,
        string memory symbol_,
        address recipient_,
        uint256 cushion_,
        uint256 cap_
    ) ERC20(name_, symbol_) ERC4626(asset_) {
        yieldRecipient = recipient_;
        cushion = cushion_;
        depositCap = cap_;
    }

    function yieldToken() public view virtual returns (address);
    function _unitsFor(uint256 assets, Math.Rounding rounding) internal view virtual returns (uint256);
    function _assetsFor(uint256 units, Math.Rounding rounding) internal view virtual returns (uint256);
    function _heldAssets() internal view virtual returns (uint256);
    function _payableYield() internal view virtual returns (uint256);
    function _invest(uint256 assets) internal virtual;
    function _divest(uint256 assets, address to) internal virtual;
    function _payYield(uint256 amount, address to) internal virtual returns (uint256 paid);

    function _principalAssets() internal view returns (uint256) {
        return _assetsFor(totalSupply(), Math.Rounding.Ceil);
    }

    function totalAssets() public view override returns (uint256) {
        return Math.min(_heldAssets(), _principalAssets());
    }

    function _convertToAssets(uint256 shares, Math.Rounding rounding) internal view override returns (uint256) {
        uint256 assets = _assetsFor(shares, rounding);
        uint256 principal = _principalAssets();
        uint256 held = _heldAssets();
        if (totalSupply() == 0 || held >= principal) return assets;
        return Math.mulDiv(assets, held, principal, rounding);
    }

    function _convertToShares(uint256 assets, Math.Rounding rounding) internal view override returns (uint256) {
        if (assets == 0) return 0;
        uint256 principal = _principalAssets();
        uint256 held = _heldAssets();
        if (totalSupply() != 0 && held < principal) {
            if (held == 0) revert ZeroBacking();
            assets = Math.mulDiv(assets, principal, held, rounding);
        }
        return _unitsFor(assets, rounding);
    }

    function maxMint(address) public view override returns (uint256) {
        if (_heldAssets() < _principalAssets()) return 0;
        return depositCap - totalSupply();
    }

    function maxDeposit(address receiver) public view override returns (uint256) {
        return _assetsFor(maxMint(receiver), Math.Rounding.Floor);
    }

    function deposit(uint256 assets, address receiver) public override nonReentrant returns (uint256) {
        (uint256 free, uint256 attributed) = _attributeYield();
        uint256 shares = super.deposit(assets, receiver);
        _payAndEmit(free, attributed, true);
        return shares;
    }

    function mint(uint256 shares, address receiver) public override nonReentrant returns (uint256) {
        (uint256 free, uint256 attributed) = _attributeYield();
        uint256 assets = super.mint(shares, receiver);
        _payAndEmit(free, attributed, true);
        return assets;
    }

    function withdraw(uint256 assets, address receiver, address owner) public override nonReentrant returns (uint256) {
        (uint256 free, uint256 attributed) = _attributeYield();
        uint256 shares = super.withdraw(assets, receiver, owner);
        _payAndEmit(free, attributed, true);
        return shares;
    }

    function redeem(uint256 shares, address receiver, address owner) public override nonReentrant returns (uint256) {
        (uint256 free, uint256 attributed) = _attributeYield();
        uint256 assets = super.redeem(shares, receiver, owner);
        _payAndEmit(free, attributed, true);
        return assets;
    }

    function transfer(address to, uint256 amount) public override(ERC20, IERC20) nonReentrant returns (bool) {
        if (amount == 0 || msg.sender == to) return super.transfer(to, amount);
        (uint256 free, uint256 attributed) = _attributeYield();
        bool success = super.transfer(to, amount);
        _payAndEmit(free, attributed, true);
        return success;
    }

    function transferFrom(address from, address to, uint256 amount)
        public
        override(ERC20, IERC20)
        nonReentrant
        returns (bool)
    {
        if (amount == 0 || from == to) return super.transferFrom(from, to, amount);
        (uint256 free, uint256 attributed) = _attributeYield();
        bool success = super.transferFrom(from, to, amount);
        _payAndEmit(free, attributed, true);
        return success;
    }

    function _deposit(address caller, address receiver, uint256 assets, uint256 shares) internal override {
        super._deposit(caller, receiver, assets, shares);
        if (totalSupply() > depositCap) revert DepositCapExceeded();
        _invest(assets);
    }

    function _withdraw(address caller, address receiver, address owner, uint256 assets, uint256 shares)
        internal
        override
    {
        if (caller != owner) _spendAllowance(owner, caller, shares);
        _burn(owner, shares);
        _divest(assets, receiver);
        emit Withdraw(caller, receiver, owner, assets, shares);
    }

    function _update(address from, address to, uint256 amount) internal override {
        if (amount != 0 && from != to) {
            if (from != address(0)) _settle(from);
            if (to != address(0)) _settle(to);
        }
        super._update(from, to, amount);
    }

    function _settle(address holder) private {
        creditedScaled[holder] += balanceOf(holder) * (acc - snap[holder]);
        snap[holder] = acc;
    }

    function yieldCredited(address holder) public view returns (uint256) {
        return (creditedScaled[holder] + balanceOf(holder) * (acc - snap[holder])) / SCALE;
    }

    /// @dev Staking modules override this to measure the separate reward token.
    function _freeYield() internal view virtual returns (uint256) {
        return _saturatingSub(_heldAssets(), _principalAssets() + cushion + unpaid);
    }

    function skim() external nonReentrant {
        (uint256 free, uint256 attributed) = _attributeYield();
        _payAndEmit(free, attributed, false);
    }

    function _attributeYield() private returns (uint256 free, uint256 attributed) {
        free = _freeYield();
        if (free != 0) {
            uint256 supply = totalSupply();
            if (supply == 0) {
                unattributed += free;
            } else {
                acc += Math.mulDiv(free, SCALE, supply);
                attributed = free;
            }
            unpaid += free;
        }
    }

    function _payAndEmit(uint256 free, uint256 attributed, bool bestEffort) private {
        uint256 paid;
        if (unpaid != 0) {
            if (bestEffort) {
                try this._pay() returns (uint256 sent) {
                    paid = sent;
                } catch (bytes memory reason) {
                    emit PayFailed(reason);
                }
            } else {
                paid = this._pay();
            }
        }
        if (free != 0 || paid != 0) emit Skimmed(yieldToken(), attributed, paid, acc);
    }

    /// @dev Only callable under an outer entry point's guard. A separate guard here would always fail.
    function _pay() external returns (uint256 paid) {
        require(msg.sender == address(this), "self only");
        uint256 amount = Math.min(unpaid, _payableYield());
        if (amount == 0) return 0;
        paid = _payYield(amount, yieldRecipient);
        assert(_heldAssets() >= _principalAssets());
        unpaid -= paid;
        paidTotal += paid;
    }

    function _saturatingSub(uint256 a, uint256 b) internal pure returns (uint256) {
        return a > b ? a - b : 0;
    }
}
