// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {IERC20} from "openzeppelin-contracts/contracts/token/ERC20/IERC20.sol";
import {DutchAuction} from "../core/DutchAuction.sol";
import {MarketToken} from "../tokens/MarketToken.sol";
import {Treasury} from "../core/Treasury.sol";

interface IProposal {
    enum State { Auction, Live, Resolved, Cancelled }

    struct Trade {
        address seller;
        address buyer;
        address outcomeToken;    // address of outcome token being traded (tYes or tNo)
        uint256 tokenAmount;     // amount of outcome tokens to be traded
        uint256 pyUsdAmount;     // total cost in PyUSD for the amount of outcome tokens 
        uint256 twapPrice;       // time-weighted average price of the outcome token
    }

    function initialize(
        uint256 _id,
        address _admin,
        string memory _title,
        string memory _description,
        uint256 _auctionDuration,
        uint256 _liveDuration,
        string memory _subjectToken,
        address _pyUSD,
        uint256 _minToOpen,
        uint256 _maxCap,
        address _target,
        bytes memory _data,
        address _pythContract,
        bytes32 _priceFeedId,
        address _attestor
    ) external;

    function settleAuctions() external;
    function applyBatch(Trade[] calldata) external;

    // -------- Views --------
    function state() external view returns (State);
    function id() external view returns (uint256);
    function title() external view returns (string memory);
    function description() external view returns (string memory);
    function admin() external view returns (address);
    function auctionStartTime() external view returns (uint256);
    function auctionEndTime() external view returns (uint256);
    function liveStart() external view returns (uint256);
    function liveEnd() external view returns (uint256);
    function liveDuration() external view returns (uint256);
    function subjectToken() external view returns (string memory);
    function pyUSD() external view returns (address);
    function minToOpen() external view returns (uint256);
    function maxCap() external view returns (uint256);
    function yesAuction() external view returns (DutchAuction);
    function noAuction() external view returns (DutchAuction);
    function yesToken() external view returns (MarketToken);
    function noToken() external view returns (MarketToken);
    function target() external view returns (address);
    function data() external view returns (bytes memory);
    function treasury() external view returns (Treasury);
    function twapPriceTokenYes() external view returns (uint256);
    function twapPriceTokenNo() external view returns (uint256);

}
