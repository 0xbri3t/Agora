// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {Script, console} from "forge-std/Script.sol";
import {AgoraComplement} from "../src/aqua/AgoraComplement.sol";

/// @notice Deploys the custom SwapVM instruction that enforces the futarchy
///         no-arbitrage invariant `price(YES) + price(NO) <= 1 USDC` inside the
///         VM. Stateless and immutable, so a single deployment serves every
///         market: makers reference it from their program via `_extruction`.
contract DeployComplement is Script {
    function run() external {
        uint256 pk = vm.envUint("DEPLOYER_PK");
        vm.startBroadcast(pk);
        AgoraComplement complement = new AgoraComplement();
        vm.stopBroadcast();

        console.log("complement:", address(complement));
    }
}
