// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {IProposal} from "../interfaces/IProposal.sol";
import {IDutchAuction} from "../interfaces/IDutchAuction.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {MarketToken} from "../tokens/MarketToken.sol";
import {Treasury} from "./Treasury.sol";
import {DutchAuction} from "./DutchAuction.sol";
import {Strings} from "@openzeppelin/contracts/utils/Strings.sol";
import {Treasury} from "./Treasury.sol";
import "@pythnetwork/pyth-sdk-solidity/IPyth.sol";
import "@pythnetwork/pyth-sdk-solidity/PythStructs.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";



contract Proposal is Ownable, IProposal {
    using SafeERC20 for IERC20;

    State public state;

    Trade public trade;

    // core identifiers / metadata
    uint256 public id;
    address public admin;
    string  public title;
    string  public description;
    uint256 public auctionStartTime;
    uint256 public auctionEndTime;
    uint256 public liveStart;
    uint256 public liveEnd;
    uint256 public liveDuration;
    string  public subjectToken;
    uint256 public minToOpen;
    uint256 public maxCap;

    // auctions / tokens / implementations
    address public pyUSD;
    DutchAuction public yesAuction;
    DutchAuction public noAuction;
    MarketToken public yesToken;
    MarketToken public noToken;

    address public target;
    bytes public data;

    Treasury public treasury;

    // Pyth Oracle
    IPyth pyth;
    address public pythAddr;
    bytes32 public priceFeedId;

    address public attestor;
    uint256 public twapPriceTokenYes;
    uint256 public twapPriceTokenNo;

    bool private _initialized;

    error NotAttestor();
    error NotAuction();
    error AlreadyInitialized();
    error InvalidAdmin();
    error InvalidPyUSD();
    error InvalidPythAddress();
    error InvalidMinMax(uint256 minToOpen, uint256 maxCap);
    error InvalidAuctionDuration(uint256 auctionDuration);
    error InvalidLiveDuration(uint256 liveDuration);
    error PriceNotPositive(int64 price);
    error PythScaleOverflow(int256 scaled);
    error BadState(Proposal.State expected, Proposal.State current);
    error ZeroAddress();
    error InvalidOutcomeToken(address outcomeToken);
    error InvalidAmounts();
    error LivePeriodNotEnded(uint256 nowTs, uint256 liveEnd);
    error NoTarget();
    error NoData();
    error TargetCallFailed();
    error NoTreasury();
    error InvalidTokenToClaim(address token);

    event ProposalActivated(uint256 indexed id, uint256 liveStart, uint256 liveEnd);
    event ProposalResolved(uint256 indexed id, uint256 when);
    event ProposalCancelled(uint256 when);
    event ProposalLive(uint256 liveEnd);
    event BatchApplied(uint256 ops);
    event TokenClaimed(uint256 amout, address token);

    modifier onlyAttestor() {
        if (msg.sender != attestor) revert NotAttestor();
        _;
    }

    modifier onlyAuction(){
        if (msg.sender != address(yesAuction) && msg.sender != address(noAuction)) revert NotAuction();
        _;
    }

    constructor() Ownable(msg.sender) {}

    function initialize(
        uint256 _id,
        address _admin, // creator/admin of the proposal
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
    ) external {
        if (_initialized) revert AlreadyInitialized();
        if (_admin == address(0)) revert InvalidAdmin();
        if (_pyUSD == address(0)) revert InvalidPyUSD();
        if (_pythContract == address(0)) revert InvalidPythAddress();

        if (_minToOpen > _maxCap) revert InvalidMinMax(_minToOpen, _maxCap);
        if (!(_auctionDuration > 0 && _auctionDuration <= 7 days)) revert InvalidAuctionDuration(_auctionDuration);
        if (!(_liveDuration > 0 && _liveDuration <= 30 days)) revert InvalidLiveDuration(_liveDuration);

        _initialized = true;

        id = _id;
        admin = _admin;
        title = _title;
        description = _description;
        auctionStartTime  = block.timestamp;
        auctionEndTime    = block.timestamp + _auctionDuration;

        subjectToken = _subjectToken;
        pyUSD = _pyUSD;
        liveDuration = _liveDuration;
        minToOpen = _minToOpen;
        maxCap = _maxCap;
        target = _target;
        data = _data;
        pyth = IPyth(_pythContract);
        priceFeedId = _priceFeedId;
        attestor = _attestor;

        treasury= new Treasury(pyUSD);

        // Deploy market tokens for YES and NO (temporary minter = this Proposal, updated after auctions are deployed)
        yesToken = new MarketToken(
            string.concat("FutarFi tYES #", Strings.toString(id)),
            string.concat("tYES-", Strings.toString(id)),
            address(this),
            address(this),
            maxCap
        );
        noToken = new MarketToken(
            string.concat("FutarFi tNO #", Strings.toString(id)),
            string.concat("tNO-", Strings.toString(id)),
            address(this),
            address(this),
            maxCap
        );

        int64 initialPrice = getPythPriceFeed(priceFeedId);

        // Deploy Dutch auctions for YES and NO (require token addresses in constructor)
        yesAuction = new DutchAuction(
            pyUSD,
            address(yesToken),
            address(treasury),
            _auctionDuration,
            initialPrice, // pyth: initial token price
            minToOpen,
            attestor
        );

        noAuction = new DutchAuction(
            pyUSD,
            address(noToken),
            address(treasury),
            _auctionDuration,
            initialPrice,   // pyth: initial token price
            minToOpen,
            attestor
        );

        // Update minters on tokens to point at the newly created auctions
        yesToken.setMinter(address(yesAuction));
        noToken.setMinter(address(noAuction));

        // Set auction addresses in Treasury
        Treasury(treasury).setAuctions(address(yesAuction), address(noAuction));
        state = State.Auction;
    }


    // Compute 10^n safely for small n
    function pow10(uint32 n) internal pure returns (uint256) {
        uint256 r = 1;
        for (uint32 i = 0; i < n; i++) r *= 10;
        return r;
    }

    // Get the initial Pyth price feed and scale to 6 decimals (PYUSD 6d per token)
    function getPythPriceFeed(bytes32 _priceFeedId) private view returns (int64) {
        PythStructs.Price memory price = pyth.getPriceUnsafe(_priceFeedId);
        if (price.price <= 0) revert PriceNotPositive(price.price);
        int32 expo = price.expo; // usually negative
        int256 raw = int256(price.price);
        int256 scaled;
        if (expo < -6) {
            uint32 diff = uint32(uint32(-6 - expo)); // divide by 10^(|expo+6|)
            uint256 d = pow10(diff);
            scaled = raw / int256(d);
        } else {
            uint32 diff = uint32(uint32(expo + 6)); // multiply by 10^(expo+6)
            uint256 m = pow10(diff);
            scaled = raw * int256(m);
        }
        // Compare in signed space to avoid invalid casts
        if (!(scaled > 0 && scaled <= int256(type(int64).max))) revert PythScaleOverflow(scaled);
        return int64(scaled);
    }


    // Settle the auctions and handles cancellation or activation
    function settleAuctions() external onlyAuction(){
        if (state != State.Auction) revert BadState(State.Auction, state);

        bool yesAuctionCanceled = yesAuction.isCanceled();
        bool noAuctionCanceled  = noAuction.isCanceled();

        if (yesAuctionCanceled || noAuctionCanceled) {
            // If either auction is canceled, cancel both markets and enable refunds in Treasury
            state = State.Cancelled;

            yesToken.finalizeAsLoser(address(treasury));
            noToken.finalizeAsLoser(address(treasury));

            Treasury(treasury).enableRefunds();

            auctionEndTime = block.timestamp;
            emit ProposalCancelled(block.timestamp);
            return;
        }

        bool yesAuctionValid = yesAuction.isValid();
        bool noAuctionValid  = noAuction.isValid();
        if (yesAuctionValid && noAuctionValid) {
            // If both auctions are ready, activate proposal
            state = State.Live;
            auctionEndTime = block.timestamp;
            liveStart = block.timestamp;
            liveEnd = liveStart + liveDuration;
        }

    }


    /// @notice Apply a batch of trades. Requires allowances set by both sides.
    function applyBatch(Trade[] calldata ops) external onlyAttestor {
        if (state != State.Live) revert BadState(State.Live, state);
        for (uint256 i = 0; i < ops.length; ++i) {
            Trade calldata t = ops[i];
            if (t.seller == address(0) || t.buyer == address(0)) revert ZeroAddress();
            if (t.outcomeToken != address(yesToken) && t.outcomeToken != address(noToken)) revert InvalidOutcomeToken(t.outcomeToken);
            if (t.tokenAmount == 0) revert InvalidAmounts();


            // Transfer PyUSD from buyer to seller
            IERC20(pyUSD).safeTransferFrom(t.buyer, t.seller, t.pyUsdAmount);

            // Transfer outcome token from seller to buyer (must have allowance on outcome token)
            IERC20(t.outcomeToken).safeTransferFrom(t.seller, t.buyer, t.tokenAmount);

            Treasury(treasury).transferBalance(t.seller, t.buyer, t.pyUsdAmount);

            // update TWAP prices
            if (t.outcomeToken == address(yesToken)) {
                // Update TWAP price for YES token if its different
                twapPriceTokenYes = twapPriceTokenYes == t.twapPrice ? twapPriceTokenYes : t.twapPrice;
            } else {
                // Update TWAP price for NO token if its different
                twapPriceTokenNo = twapPriceTokenNo == t.twapPrice ? twapPriceTokenNo : t.twapPrice;
            }

            emit BatchApplied(ops.length);
        }
    }


    function resolve() public {
        if (state != State.Live) revert BadState(State.Live, state);
        if (block.timestamp < liveEnd) revert LivePeriodNotEnded(block.timestamp, liveEnd);
        _resolve();
    }


    // ---- Resolve only after Live ends ----
    function _resolve() private {
        state = State.Resolved;

        // compare TWAP prices to determine outcome
        if (twapPriceTokenYes > twapPriceTokenNo) {
            // YES wins
            // yesToken.finalizeAsWinner(address(treasury));
            noToken.finalizeAsLoser(address(treasury));
            Treasury(treasury).enableRefunds();
            state = State.Resolved;

            // Execute target calldata if provided
            if (target != address(0) && data.length > 0) {
                _executeTargetCalldata();
            }
        } else if (twapPriceTokenNo > twapPriceTokenYes) {
            // NO wins
            // noToken.finalizeAsWinner(address(treasury));
            yesToken.finalizeAsLoser(address(treasury));
            Treasury(treasury).enableRefunds();
            state = State.Resolved;
        } else {
            // Tie - both lose
            state = State.Resolved;
            yesToken.finalizeAsLoser(address(treasury));
            noToken.finalizeAsLoser(address(treasury));
            Treasury(treasury).enableRefunds();
        }

        emit ProposalResolved(id, block.timestamp);
    }


    function _executeTargetCalldata() private {
        if (state != State.Resolved) revert BadState(State.Resolved, state);
        if (target == address(0)) revert NoTarget();
        if (data.length == 0) revert NoData();

        (bool success, ) = target.call(data);
        if (!success) revert TargetCallFailed();
    }


    function claimTokens(address _tokenToClaim) external{
        if (state != State.Resolved) revert BadState(State.Resolved, state);
        if (address(treasury) == address(0)) revert NoTreasury();
        if (_tokenToClaim != address(MarketToken(yesToken)) && _tokenToClaim != address(MarketToken(noToken))) revert InvalidTokenToClaim(_tokenToClaim);

        uint256 amount = MarketToken(_tokenToClaim).balanceOf(msg.sender);
        Treasury(treasury).refundTo(msg.sender, _tokenToClaim, amount);
        emit TokenClaimed(amount, _tokenToClaim);
    }

 
}