// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {MarketToken} from "../tokens/MarketToken.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {IDutchAuction} from "../interfaces/IDutchAuction.sol";
import {ITreasury} from "../interfaces/ITreasury.sol";
import {IProposal} from "../interfaces/IProposal.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";

/// @notice Buyer supplies PYUSD and receives YES/NO tokens at the linear price at that moment.
/// @dev Collects PYUSD into Treasury and mints tokens to the buyer (mint-on-buy).
contract DutchAuction is ReentrancyGuard, Ownable, IDutchAuction {
    using SafeERC20 for IERC20;


    address       public immutable PYUSD;      
    MarketToken   public immutable MARKET_TOKEN;    // YES/NO token, in constructor we decide which one this auction is for
    address       public immutable TREASURY;
    address public immutable ATTESTOR;

    uint256 public immutable START_TIME;           
    uint256 public immutable END_TIME;             
    int64 public immutable START_PRICE;       // starting price (PYUSD 6d per 1 token)
    int8 public constant END_PRICE = 0;
    uint256 public immutable MIN_TO_OPEN;        // marketToken sold threshold to open market    

    bool public isFinalized;
    bool public isValid;
    bool public isCanceled;

    // ---------------- Errors ----------------
    error NotLive();
    error NotReadyToFinalize();
    error AlreadyFinalized();
    error AmountZero();
    error PriceZero();
    error ZeroAddress();
    error InvalidToken();
    error OverCap();

    // ---------------- Events ----------------
    event LiquidityAdded(
        address indexed buyer,
        address indexed tokenToBuy,
        uint256 payAmount,
        uint256 unitPrice,
        uint256 tokensOut
    );
    event AuctionisFinalized();
    event AuctionisValid();
    event AuctionisCanceled();

    constructor(
        address _pyUSD,
        address _marketToken,
        address _treasury,
        uint256 _duration,
        int64 _startPrice,
        uint256 _minToOpen,
        address _attestor
    ) Ownable(msg.sender) {
        require(_startPrice >= 0, "bad prices"); 
        PYUSD    = _pyUSD;
        MARKET_TOKEN  = MarketToken(_marketToken);
        TREASURY  = _treasury;
        START_TIME    = block.timestamp;
        END_TIME      = block.timestamp + _duration;
        START_PRICE   = _startPrice * 2;
        MIN_TO_OPEN    = _minToOpen;
        ATTESTOR = _attestor;
    }

    modifier onlyAttestor() {
        _onlyAttestor();
        _;
    }

    function _onlyAttestor() internal view {
        require(msg.sender == ATTESTOR, "Not attestor");
    }

    // ---------------- Helpers ----------------

    function _isLive() internal view returns (bool) {
        return block.timestamp >= START_TIME && block.timestamp <= END_TIME && !isFinalized;
    }


    /// @notice Current price (PYUSD, 6 decimals) per 1 token
    function priceNow() public view returns (uint256) {
        uint256 ts = block.timestamp;
        if (ts <= START_TIME) return uint256(uint64(START_PRICE));
        if (ts >= END_TIME)   return uint256(uint8(END_PRICE));
        uint256 dt   = END_TIME - START_TIME;
        uint256 gone = ts - START_TIME;
        // perform unsigned arithmetic after casting the signed immutables
        uint256 start = uint256(uint64(START_PRICE));
        uint256 end = uint256(uint8(END_PRICE));
        uint256 diff = start - end;
        uint256 price = start - (diff * gone) / dt;
        return price;
    }


    /// @notice Buyer specifies how much PYUSD to spend and receives tokens at the current price.
    /// @param _payAmount  PYUSD to spend (6 decimals)
    function buyLiquidity(
        uint256 _payAmount
    ) external nonReentrant {
        if (!_isLive()) revert NotLive();
        if (msg.sender == address(0)) revert ZeroAddress();
        if (_payAmount == 0) revert AmountZero();

        uint256 actualPrice = priceNow();
        if (actualPrice == 0) revert PriceZero();

        // tokens = payAmount / price per token
        uint256 price = actualPrice;
        uint256 tokensOut = (_payAmount * 1e18) / price;

        uint256 tokensRemain = MARKET_TOKEN.cap() - MARKET_TOKEN.totalSupply();
        tokensOut = Math.min(tokensOut, tokensRemain);

        // adjust payAmount if hitting cap
        if (tokensOut == tokensRemain)_payAmount = (tokensOut * price) / 1e18;

        // approval must be given beforehand
        ITreasury(TREASURY).fundFromAuction(msg.sender, _payAmount);
        MARKET_TOKEN.mint(msg.sender, tokensOut);
        emit LiquidityAdded(msg.sender, address(MARKET_TOKEN), _payAmount, actualPrice, tokensOut);

        if (MARKET_TOKEN.totalSupply() >= MARKET_TOKEN.cap()){
            isValid = true;
            isFinalized = true;
            emit AuctionisValid();
            _finalize();
        } 

    }


    function finalize() external onlyAttestor() {
        if (isFinalized) revert AlreadyFinalized();
        if (block.timestamp >= END_TIME) {
            if (MARKET_TOKEN.totalSupply() >= MIN_TO_OPEN) {
                isValid = true;
                isFinalized = true;
                emit AuctionisValid();
                _finalize();
            } else {
                isCanceled = true;
                isFinalized = true;
                emit AuctionisCanceled();
                _finalize();
            }
        } else {
            if (MARKET_TOKEN.totalSupply() >= MARKET_TOKEN.cap() * 99 / 100) {
                isValid = true;
                isFinalized = true;
                emit AuctionisValid();
                _finalize();
            } else revert NotReadyToFinalize();
        }
    }


    function refundTokens() external {
        // approval must be given beforehand
        ITreasury(TREASURY).refundTo(msg.sender, address(MARKET_TOKEN), MARKET_TOKEN.balanceOf(msg.sender));
    }

    /// @notice Close the auction. 
    function _finalize() private {
        IProposal(owner()).settleAuctions();
        // emit AuctionisFinalized();
    }
}
