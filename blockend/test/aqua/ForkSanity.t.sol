// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {Test} from "forge-std/Test.sol";
import {IAqua} from "@1inch-aqua/src/interfaces/IAqua.sol";

contract ForkSanity is Test {
    address constant AQUA_SEPOLIA = 0x499943E74FB0cE105688beeE8Ef2ABec5D936d31;

    function test_aquaIsDeployedOnSepolia() public {
        vm.createSelectFork(vm.rpcUrl("sepolia"));
        assertGt(AQUA_SEPOLIA.code.length, 0, "Aqua core missing on Sepolia fork");
    }
}
