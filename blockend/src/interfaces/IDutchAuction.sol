// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {MarketToken} from "../tokens/MarketToken.sol";

interface IDutchAuction {
    // --- Actions ---
    function buyLiquidity(uint256 _payAmount) external;
    function finalize() external;
    function refundTokens() external;

    // --- Views ---
    function priceNow() external view returns (uint256);
    function ATTESTOR() external view returns (address);
    function TREASURY() external view returns (address);
    function MARKET_TOKEN() external view returns (MarketToken);
    function PYUSD() external view returns (address);
    function START_TIME() external view returns (uint256);
    function END_TIME() external view returns (uint256);
    function START_PRICE() external view returns (int64);
    function isFinalized() external view returns (bool);
    function isValid() external view returns (bool);
    function isCanceled() external view returns (bool);
    function MIN_TO_OPEN() external view returns (uint256);
}
