// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

// OpenZeppelin v5
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {ERC20Permit} from "@openzeppelin/contracts/token/ERC20/extensions/ERC20Permit.sol";
import {ERC20Pausable} from "@openzeppelin/contracts/token/ERC20/extensions/ERC20Pausable.sol";
import {ERC20Capped} from "@openzeppelin/contracts/token/ERC20/extensions/ERC20Capped.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {IMarketToken} from "../interfaces/IMarketToken.sol";

/// @title MarketToken (YES/NO) 
/// @notice Outcome token per proposal. Supports Permit, Capped (supply guard), and Pausable (freeze loser).
/// @dev Owner = Proposal. A single `minter` (DutchAuction) can mint until disabled.
contract MarketToken is ERC20Permit, ERC20Pausable, ERC20Capped, Ownable, IMarketToken {
    address public minter;
    address public redeemer;      // Address allowed to receive transfers while paused

    // --- custom errors ---
    error MinterZero();
    error NotMinter();
    error RedeemerZero();

    // --- events ---
    event MinterUpdated(address indexed oldMinter, address indexed newMinter);
    event FinalizedAsLoser(address indexed by);

    /// @param _name   e.g., "FutarFi YES #123 (#number is the ID of the proposal)"
    /// @param _symbol e.g., "YES-123"
    /// @param _owner  Proposal address
    /// @param _minter DutchAuction
    /// @param _cap    Max total supply (18 decimals)
    constructor(
        string memory _name,
        string memory _symbol,
        address _owner,
        address _minter,
        uint256 _cap
    )
        ERC20(_name, _symbol)
        ERC20Permit(_name)     
        ERC20Capped(_cap)
        Ownable(_owner)
    {
        if (_minter == address(0)) revert MinterZero();
        minter = _minter;
    }

    function decimals() public pure override(ERC20, IMarketToken) returns (uint8) { return 18; }

    /// @notice Set the address allowed to mint. Only owner (Proposal) can update.
    function setMinter(address newMinter) external onlyOwner {
        if (newMinter == address(0)) revert MinterZero();
        address old = minter;
        minter = newMinter;
        emit MinterUpdated(old, newMinter);
    }

    /// @notice Disable minting forever (sets minter to address(0)).
    function disableMinting() external onlyOwner {
        minter = address(0);
        emit MinterUpdated(minter, address(0));
    }

    /// @notice Mark this token as the losing leg and set the Redeemer allowed to receive transfers.
    /// @dev While paused, only transfers *to* `redeemer` are allowed. Burns are done by the redeemer later.
    function finalizeAsLoser(address redeemer_) external onlyOwner {
        if (redeemer_ == address(0)) revert RedeemerZero();
        redeemer = redeemer_;
        _pause();
        emit FinalizedAsLoser(msg.sender);
    }



    // ========= Mint control =========

    /// @notice Mint outcome tokens; restricted to the `minter`.
    function mint(address to, uint256 amount) external {
        if (msg.sender != minter) revert NotMinter();
        _mint(to, amount);
    }

    /// @notice Burn tokens held by the Redeemer (after receiving redemptions).
    function redeemerBurn(uint256 amount) external {
        require(msg.sender == redeemer, "MarketToken:not-redeemer");
        _burn(msg.sender, amount);
    }
    
    // --- Multiple inheritance hook (OZ v5 routes all through _update) ---
    function _update(address from, address to, uint256 value)
    internal
    override(ERC20, ERC20Pausable, ERC20Capped)
    {
        if (paused()) {
            bool isRedeem = (to == redeemer && from != address(0));
            bool isRedeemerBurn = (from == redeemer && to == address(0));

            require(redeemer != address(0), "MarketToken:redeemer=0");
            require(isRedeem || isRedeemerBurn, "MarketToken:paused");

            ERC20._update(from, to, value);
            return;
        }

        // Not paused: apply the full normal chain includes Pausable, Capped
        super._update(from, to, value);
    }

}
