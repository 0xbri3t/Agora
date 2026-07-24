// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import "forge-std/Script.sol";
import "forge-std/console.sol";
import {MockUSDC} from "../src/mocks/MockUSDC.sol";

contract MintCollateral is Script {
    function run() external {
        address to = vm.envAddress("TO");
        uint256 amount = vm.envUint("AMOUNT");
        MockUSDC token = MockUSDC(vm.envAddress("COLLATERAL_CONTRACT"));

        vm.startBroadcast();
        token.mint(to, amount);
        vm.stopBroadcast();

        console.log("COLLATERAL Contract:", address(token));
        console.log("User COLLATERAL Balance:", token.balanceOf(to));
    }
}
