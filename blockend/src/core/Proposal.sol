// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {IProposal} from "../interfaces/IProposal.sol";
import {ICCAFactory, ICCAuction, AuctionParameters} from "../interfaces/ICCA.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {MarketToken} from "../tokens/MarketToken.sol";
import {Treasury} from "./Treasury.sol";
import {Strings} from "@openzeppelin/contracts/utils/Strings.sol";
import "@pythnetwork/pyth-sdk-solidity/IPyth.sol";
import "@pythnetwork/pyth-sdk-solidity/PythStructs.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";



contract Proposal is Ownable, IProposal {
    using SafeERC20 for IERC20;

    State public state;


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
    address public collateral;
    ICCAuction public yesAuction;
    ICCAuction public noAuction;
    MarketToken public yesToken;
    MarketToken public noToken;

    // Uniswap Continuous Clearing Auction factory (canonical, same address on Sepolia/mainnet)
    address public ccaFactory;
    uint64 public auctionEndBlock;
    // Collateral pot per side after graduation (post protocol fee), and tokens sold per side.
    uint256 public potYes;
    uint256 public potNo;
    uint256 public soldYes;
    uint256 public soldNo;

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
    error InvalidCollateral();
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
    event TwapUpdated(uint256 twapYes, uint256 twapNo, uint256 at);
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
        address _collateral,
        uint256 _minToOpen,
        uint256 _maxCap,
        address _target,
        bytes memory _data,
        address _pythContract,
        bytes32 _priceFeedId,
        address _attestor,
        address _ccaFactory
    ) external {
        if (_initialized) revert AlreadyInitialized();
        if (_admin == address(0)) revert InvalidAdmin();
        if (_collateral == address(0)) revert InvalidCollateral();
        if (_pythContract == address(0)) revert InvalidPythAddress();
        if (_ccaFactory == address(0)) revert ZeroAddress();

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
        collateral = _collateral;
        liveDuration = _liveDuration;
        minToOpen = _minToOpen;
        maxCap = _maxCap;
        target = _target;
        data = _data;
        pyth = IPyth(_pythContract);
        priceFeedId = _priceFeedId;
        attestor = _attestor;

        treasury= new Treasury(collateral);

        // Deploy market tokens for YES and NO (temporary minter = this Proposal, updated after auctions are deployed)
        yesToken = new MarketToken(
            string.concat("Agora tYES #", Strings.toString(id)),
            string.concat("tYES-", Strings.toString(id)),
            address(this),
            address(this),
            maxCap
        );
        noToken = new MarketToken(
            string.concat("Agora tNO #", Strings.toString(id)),
            string.concat("tNO-", Strings.toString(id)),
            address(this),
            address(this),
            maxCap
        );

        int64 initialPrice = getPythPriceFeed(priceFeedId);

        // Deploy one Uniswap Continuous Clearing Auction per outcome token.
        ccaFactory = _ccaFactory;
        uint64 durationBlocks = uint64(_auctionDuration / SECONDS_PER_BLOCK);
        if (durationBlocks < MIN_AUCTION_BLOCKS) durationBlocks = MIN_AUCTION_BLOCKS;
        auctionEndBlock = uint64(block.number) + durationBlocks;

        bytes memory config = abi.encode(_buildAuctionParameters(uint64(uint256(int256(initialPrice))), durationBlocks));
        yesAuction = ICCAuction(ICCAFactory(_ccaFactory).create(address(yesToken), maxCap, config, bytes32(uint256(1))));
        noAuction = ICCAuction(ICCAFactory(_ccaFactory).create(address(noToken), maxCap, config, bytes32(uint256(2))));

        // CCA sells a fixed pre-minted supply: mint it to each auction and notify.
        yesToken.mint(address(yesAuction), maxCap);
        noToken.mint(address(noAuction), maxCap);
        yesToken.disableMinting();
        noToken.disableMinting();
        yesAuction.onTokensReceived();
        noAuction.onTokensReceived();

        // Auctions never touch the Treasury pre-graduation; funds arrive via sweepCurrency in settleAuctions.
        state = State.Auction;
    }

    /// @notice Blocks are the CCA's clock (Sepolia ~12s). Durations map seconds -> blocks.
    uint256 private constant SECONDS_PER_BLOCK = 12;
    uint64 private constant MIN_AUCTION_BLOCKS = 10;
    uint256 private constant Q96 = 2 ** 96;
    uint24 private constant MPS_TOTAL = 1e7; // CCA issuance schedule must sum to this

    /// @dev Builds the shared CCA config for both outcome auctions.
    ///      Floor = a tenth of the Pyth reference price (clearing rises with demand);
    ///      graduation = the collateral value of `minToOpen` tokens at that floor.
    function _buildAuctionParameters(uint64 initialPrice6d, uint64 durationBlocks)
        private
        view
        returns (AuctionParameters memory p)
    {
        // 6d collateral per 1e18 token -> Q96 collateral-wei per token-wei.
        // Every price (floor included) must sit on a tick boundary, so pick the
        // spacing first and snap the floor to exactly 50 ticks (2% granularity).
        uint256 rawFloorQ96 = (uint256(initialPrice6d) * Q96) / (10 * 1e18);
        if (rawFloorQ96 <= 2 ** 32) revert PythScaleOverflow(int256(rawFloorQ96));
        uint256 tickSpacing = rawFloorQ96 / 50;
        if (tickSpacing < 2) tickSpacing = 2;
        uint256 floorPriceQ96 = tickSpacing * 50;

        uint128 required = uint128((minToOpen * uint256(initialPrice6d)) / (10 * 1e18));
        if (required == 0) required = 1;

        p = AuctionParameters({
            currency: collateral,
            tokensRecipient: address(this),
            // Sweeps are recipient-gated, so this contract receives and forwards
            fundsRecipient: address(this),
            startBlock: uint64(block.number),
            endBlock: uint64(block.number) + durationBlocks,
            claimBlock: uint64(block.number) + durationBlocks,
            tickSpacing: tickSpacing,
            validationHook: address(0),
            floorPrice: floorPriceQ96,
            requiredCurrencyRaised: required,
            auctionStepsData: _buildSteps(durationBlocks)
        });
    }

    /// @dev Even per-block issuance: q = MPS/N with the remainder spread over the
    ///      first `r` blocks, so sum(mps * blockDelta) == MPS exactly.
    function _buildSteps(uint64 durationBlocks) private pure returns (bytes memory) {
        uint24 q = uint24(MPS_TOTAL / durationBlocks);
        uint40 r = uint40(MPS_TOTAL % durationBlocks);
        if (r == 0) {
            return abi.encodePacked(q, uint40(durationBlocks));
        }
        return abi.encodePacked(q + 1, r, q, uint40(durationBlocks) - r);
    }


    // Compute 10^n safely for small n
    function pow10(uint32 n) internal pure returns (uint256) {
        uint256 r = 1;
        for (uint32 i = 0; i < n; i++) r *= 10;
        return r;
    }

    // Get the initial Pyth price feed and scale to 6 decimals (COLLATERAL 6d per token)
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


    error AuctionNotOver(uint256 currentBlock, uint256 endBlock);

    /// @notice Settle both CCA auctions once they end: activate the market when
    ///         both graduated, cancel otherwise. Callable by anyone.
    /// @dev Graduated: sweep raised collateral (net of Uniswap protocol fee) into
    ///      the Treasury and pull back unsold tokens. Non-graduated: the CCAs
    ///      refund bidders directly via exitBid, the Treasury never held funds.
    function settleAuctions() external {
        if (state != State.Auction) revert BadState(State.Auction, state);
        if (block.number < auctionEndBlock) revert AuctionNotOver(block.number, auctionEndBlock);

        // CCA checkpoints lazily on bids; force the end-block checkpoint so
        // graduation/cleared amounts reflect the full issuance schedule.
        yesAuction.checkpoint();
        noAuction.checkpoint();

        if (yesAuction.isGraduated() && noAuction.isGraduated()) {
            IERC20 usdc = IERC20(collateral);

            uint256 before = usdc.balanceOf(address(this));
            yesAuction.sweepCurrency();
            potYes = usdc.balanceOf(address(this)) - before;

            before = usdc.balanceOf(address(this));
            noAuction.sweepCurrency();
            potNo = usdc.balanceOf(address(this)) - before;

            // Forward both pots to the Treasury, which pays redemptions later.
            usdc.safeTransfer(address(treasury), potYes + potNo);

            soldYes = yesAuction.totalCleared();
            soldNo = noAuction.totalCleared();

            // Unsold supply comes back here and stays locked (minting is disabled).
            yesAuction.sweepUnsoldTokens();
            noAuction.sweepUnsoldTokens();

            state = State.Live;
            auctionEndTime = block.timestamp;
            liveStart = block.timestamp;
            liveEnd = liveStart + liveDuration;
            emit ProposalActivated(id, liveStart, liveEnd);
        } else {
            state = State.Cancelled;
            yesToken.finalizeAsLoser(address(treasury));
            noToken.finalizeAsLoser(address(treasury));
            auctionEndTime = block.timestamp;
            emit ProposalCancelled(block.timestamp);
        }
    }


    /// @notice Attestor pushes volume-weighted TWAP computed from on-chain Aqua fills.
    /// @dev Trading itself settles through 1inch Aqua/SwapVM (ship/swap/dock); this
    ///      contract only needs the resulting TWAPs to resolve the market.
    function updateTwap(uint256 _twapYes, uint256 _twapNo) external onlyAttestor {
        if (state != State.Live) revert BadState(State.Live, state);
        twapPriceTokenYes = _twapYes;
        twapPriceTokenNo = _twapNo;
        emit TwapUpdated(_twapYes, _twapNo, block.timestamp);
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


    /// @notice Redeem outcome tokens for their pro-rata share of that side's
    ///         auction proceeds held by the Treasury.
    /// @dev Pot accounting: each claim pays pot * amount / sold and shrinks both,
    ///      so the last claimant drains the pot exactly.
    function claimTokens(address _tokenToClaim) external{
        if (state != State.Resolved) revert BadState(State.Resolved, state);
        if (address(treasury) == address(0)) revert NoTreasury();

        uint256 amount = MarketToken(_tokenToClaim).balanceOf(msg.sender);
        if (amount == 0) revert InvalidAmounts();

        uint256 payout;
        if (_tokenToClaim == address(yesToken)) {
            payout = (potYes * amount) / soldYes;
            potYes -= payout;
            soldYes -= amount;
        } else if (_tokenToClaim == address(noToken)) {
            payout = (potNo * amount) / soldNo;
            potNo -= payout;
            soldNo -= amount;
        } else {
            revert InvalidTokenToClaim(_tokenToClaim);
        }

        Treasury(treasury).payout(msg.sender, _tokenToClaim, amount, payout);
        emit TokenClaimed(amount, _tokenToClaim);
    }

 
}