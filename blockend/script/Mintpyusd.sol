// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.13;

import "forge-std/Script.sol";
import {PyUSD} from "../src/tokens/PyUSD.sol";

contract MintPyusdScript is Script {
    function run() external {
        address to = vm.envAddress("TO");
        uint256 amount = vm.envUint("AMOUNT");
        address pyusdAddr = vm.envAddress("PYUSD_CONTRACT");
        PyUSD pyusd = PyUSD(pyusdAddr);
        vm.startBroadcast();
        pyusd.mint(to, amount);
        uint256 balance = pyusd.balanceOf(to);
        console.log("PYUSD Contract:", pyusdAddr);
        console.log("User PYUSD Balance:", balance);
        vm.stopBroadcast();
    }
}
