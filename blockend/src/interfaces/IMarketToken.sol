// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

interface IMarketToken {
    // --- Minting and control ---
    function mint(address to, uint256 amount) external;
    function setMinter(address newMinter) external;
    function disableMinting() external;
    function finalizeAsLoser(address redeemer_) external;
    function redeemerBurn(uint256 amount) external;

    // --- Views ---
    function minter() external view returns (address);
    function redeemer() external view returns (address);
    function decimals() external pure returns (uint8);

}
