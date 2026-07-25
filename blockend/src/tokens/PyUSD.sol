// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {ERC20Burnable} from "@openzeppelin/contracts/token/ERC20/extensions/ERC20Burnable.sol";
import "@openzeppelin/contracts/token/ERC20/extensions/ERC20Permit.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {IPyUSD} from "../interfaces/IPyUSD.sol";

contract PyUSD is ERC20Burnable, ERC20Permit, Ownable, IPyUSD {
    string constant TOKEN_NAME = "PayPal USD";
    string constant TOKEN_SYMBOL = "PYUSD";

    constructor(address initialOwner, uint256 initialSupply)
        ERC20(TOKEN_NAME, TOKEN_SYMBOL)
        ERC20Permit(TOKEN_SYMBOL)
        Ownable(initialOwner)
    {
        if (initialSupply > 0) _mint(initialOwner, initialSupply);
    }

    function decimals() public pure override returns (uint8) { return 6; }
    function mint(address to, uint256 amount) external onlyOwner { _mint(to, amount); }

    //This function allows any user to mint up to 20,000 PYUSD for free for testing purposes
    function mintPublic(  ) external {
        uint userBalance = this.balanceOf(msg.sender);
        uint quantityToMint = 20000000000 - userBalance;
        _mint(msg.sender, quantityToMint);
    }

}
