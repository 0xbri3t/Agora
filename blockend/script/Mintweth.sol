// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import "forge-std/Script.sol";
import "forge-std/console.sol";
import {IWETH} from "../src/interfaces/IWETH.sol";

contract MintWethScript is Script {
    
    address constant WETH_ADDRESS = 0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2;
    IWETH public weth;

    function run() external {
        vm.startBroadcast();

        weth = IWETH(WETH_ADDRESS);

        console.log("Wrapping 1000 ETH to WETH...");
        uint256 wrapAmount = 1000 ether;
        weth.deposit{value: wrapAmount}();
        
        console.log("Successfully wrapped", wrapAmount / 1e18, "ETH to WETH");
        console.log("WETH Balance:", weth.balanceOf(msg.sender) / 1e18, "WETH");

        vm.stopBroadcast();
    }
}
