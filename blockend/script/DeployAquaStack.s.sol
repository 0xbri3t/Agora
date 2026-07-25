// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {Script, console} from "forge-std/Script.sol";
import {LimitSwapVMRouter} from "@1inch-swap-vm/src/routers/LimitSwapVMRouter.sol";
import {AgoraQuoteBuilder} from "../src/aqua/AgoraQuoteBuilder.sol";
import {MockUSDC} from "../src/mocks/MockUSDC.sol";

/// @notice Deploys the Agora Aqua stack to Sepolia:
///         our own LimitSwapVMRouter (the canonical Sepolia SwapVM router is
///         AquaSwapVMRouter, which lacks the LimitSwap opcodes), the quote
///         builder, and a demo MockUSDC. Aqua core itself is 1inch's live
///         deployment and is NOT redeployed.
contract DeployAquaStack is Script {
    address constant AQUA_SEPOLIA = 0x499943E74FB0cE105688beeE8Ef2ABec5D936d31;
    address constant WETH_SEPOLIA = 0xfFf9976782d46CC05630D1f6eBAb18b2324d6B14;

    function run() external {
        uint256 pk = vm.envUint("DEPLOYER_PK");
        vm.startBroadcast(pk);

        LimitSwapVMRouter router = new LimitSwapVMRouter(
            AQUA_SEPOLIA, WETH_SEPOLIA, vm.addr(pk), "Agora SwapVM", "1.0"
        );
        AgoraQuoteBuilder builder = new AgoraQuoteBuilder(AQUA_SEPOLIA);
        MockUSDC usdc = new MockUSDC();

        vm.stopBroadcast();

        console.log("router: ", address(router));
        console.log("builder:", address(builder));
        console.log("usdc:   ", address(usdc));
    }
}
