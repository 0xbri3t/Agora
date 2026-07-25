// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

/// @notice Minimal interface to Uniswap's Continuous Clearing Auction (CCA).
/// @dev Mirrors Uniswap/continuous-clearing-auction v2.x. We integrate against
///      the canonical factory (same address on mainnet + Sepolia:
///      0x000000001F26a0044BaA66024e7b6599c61963F8) instead of vendoring the
///      implementation. Prices are currency-per-token in Q96 fixed point.
struct AuctionParameters {
    address currency; // token to raise funds in; address(0) = ETH
    address tokensRecipient; // receives unsold tokens after the auction
    address fundsRecipient; // receives raised funds on sweepCurrency()
    uint64 startBlock;
    uint64 endBlock;
    uint64 claimBlock; // first block where winners can claim tokens
    uint256 tickSpacing; // Q96 price granularity
    address validationHook; // optional bid-validation hook
    uint256 floorPrice; // Q96 starting floor price
    uint128 requiredCurrencyRaised; // graduation threshold
    bytes auctionStepsData; // packed (uint24 mps | uint40 blockDelta)* — sum(mps*delta) == 1e7
}

interface ICCAFactory {
    /// @notice Deploys a CCA selling `amount` of `token`, configured by abi.encode(AuctionParameters).
    function create(address token, uint256 amount, bytes calldata configData, bytes32 salt)
        external
        returns (address auction);
}

interface ICCAuction {
    // --- bidding ---
    function submitBid(uint256 maxPriceQ96, uint128 amount, address owner, bytes calldata hookData)
        external
        payable
        returns (uint256 bidId);

    function submitBid(
        uint256 maxPriceQ96,
        uint128 amount,
        address owner,
        uint256 prevTickPriceQ96,
        bytes calldata hookData
    ) external payable returns (uint256 bidId);

    // --- lifecycle ---
    /// @notice Must be called after the token supply is transferred to the auction.
    function onTokensReceived() external;
    /// @dev Returns the Checkpoint struct on-chain; we only need the side effect.
    function checkpoint() external;
    function exitBid(uint256 bidId) external;
    function exitPartiallyFilledBid(uint256 bidId, uint64 lastFullyFilledCheckpointBlock, uint64 outbidBlock) external;
    function claimTokens(uint256 bidId) external;
    function claimTokensBatch(address owner, uint256[] calldata bidIds) external;
    /// @notice Sends raised funds (minus protocol fee) to fundsRecipient. Graduated auctions only.
    function sweepCurrency() external;
    /// @notice Returns unsold tokens to tokensRecipient. Callable by tokensRecipient after end.
    function sweepUnsoldTokens() external;

    // --- views ---
    function clearingPrice() external view returns (uint256);
    function isGraduated() external view returns (bool);
    function currencyRaised() external view returns (uint256);
    function totalCleared() external view returns (uint256);
    function remainingSupply() external view returns (uint256);
    function currency() external view returns (address);
    function token() external view returns (address);
    function totalSupply() external view returns (uint128);
    function startBlock() external view returns (uint64);
    function endBlock() external view returns (uint64);
    function claimBlock() external view returns (uint64);
    function fundsRecipient() external view returns (address);
    function tokensRecipient() external view returns (address);
}
