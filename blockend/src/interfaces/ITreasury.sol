// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

interface ITreasury {
    function setAuctions(address _yes, address _no) external;
    function fundFromAuction(address payer, uint256 amount) external;
    function enableRefunds() external;
    function refundTo(address _user, address _token, uint256 _amount) external;

    // --- Views ---
    function pyUSD() external view returns (address);
    function yesAuction() external view returns (address);
    function noAuction() external view returns (address);
    function potYes() external view returns (uint256);
    function potNo() external view returns (uint256);
    function fees6d() external view returns (uint256);
    function refundsEnabled() external view returns (bool);
    function balances(address user) external view returns (uint256);

}
