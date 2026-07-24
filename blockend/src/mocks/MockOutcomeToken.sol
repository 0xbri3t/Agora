// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

contract MockOutcomeToken is ERC20 {
    constructor(string memory name_, string memory sym_) ERC20(name_, sym_) {}
    function mint(address to, uint256 amount) external { _mint(to, amount); }
}
