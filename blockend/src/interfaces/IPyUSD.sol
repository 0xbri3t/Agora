// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/// @notice Minimal PyUSD interface 
interface IPyUSD is IERC20 {
    function mintPublic() external;
}
