// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {IMarketToken} from "../interfaces/IMarketToken.sol";
import {ITreasury} from "../interfaces/ITreasury.sol";

contract Treasury is Ownable , ITreasury {
    using SafeERC20 for IERC20;

    address public immutable pyUSD;
    address public yesAuction;
    address public noAuction;

    uint256 public potYes;
    uint256 public potNo;
    uint256 public fees6d;

    bool public refundsEnabled;

    // balance of pyUSD per user
    mapping(address => uint256) public balances;

    error NotAuction();
    error NotAuthorised();
    error RefundsNotEnabled();

    event FundedFromAuction(address indexed auction, address indexed payer, uint256 amount);
    event RefundPaid(address indexed auction, address indexed user, uint256 amount);

    modifier onlyAuctionOrOwner(){
        if (msg.sender != owner() && msg.sender != yesAuction && msg.sender != noAuction) revert NotAuction();
        _;
    }

    modifier onlyAuction() {
           _onlyAuction();
           _;
    }

    function _onlyAuction() internal view {
        if (msg.sender != yesAuction && msg.sender != noAuction) revert NotAuction();
    }


    constructor(address _pyUSD) Ownable(msg.sender) { 
        pyUSD = _pyUSD; 
    }

    function setAuctions(address _yes, address _no) external onlyOwner {
        yesAuction = _yes; 
        noAuction = _no;
    }

    function fundFromAuction(address payer, uint256 amount) external onlyAuction{
        // update pot
        if (msg.sender == yesAuction)      { potYes += amount; }
        else if (msg.sender == noAuction)  { potNo  += amount; }

        balances[payer] += amount;
        IERC20(pyUSD).safeTransferFrom( payer, address(this), amount);
        emit FundedFromAuction(msg.sender, payer, amount);
    }


     /// @notice Called by the Proposal when it decides to cancel 
    function enableRefunds() external onlyOwner {
        refundsEnabled = true;
    }

    function transferBalance(address from, address to, uint256 amount) external onlyOwner {
        uint256 fromBal = balances[from];
        if (amount > fromBal) {
            // Do not revert: move only what is available to keep accounting consistent with prior trades
            amount = fromBal;
        }
        unchecked {
            balances[from] = fromBal - amount;
            balances[to] += amount;
        }
    }

    /// @notice Called by auctions during user refund flow (after burning user tokens).
    function refundTo(address _user, address _token , uint256 _amount) external onlyAuctionOrOwner() {
        if (!refundsEnabled) revert RefundsNotEnabled();
        
        IERC20(_token).safeTransferFrom(_user, address(this), _amount); 
        IERC20(pyUSD).safeTransfer(_user, balances[_user]);
        emit RefundPaid(msg.sender, _user, _amount);

    }

}
