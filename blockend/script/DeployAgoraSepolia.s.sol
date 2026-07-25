// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {Script, console} from "forge-std/Script.sol";
import {ProposalManager} from "../src/core/ProposalManager.sol";
import {Proposal} from "../src/core/Proposal.sol";

/// @notice Deploys the Agora governance stack to Sepolia, wired to the
///         already-deployed Aqua-era pieces: MockUSDC collateral and Pyth.
contract DeployAgoraSepolia is Script {
    // Aqua-era collateral (already live on Sepolia, see deployments/sepolia-aqua.json)
    address constant COLLATERAL = 0x34ad23A27Ae8A562928234D4415eD7225a44bB2E;
    // Uniswap Continuous Clearing Auction factory (canonical, same address across chains)
    address constant CCA_FACTORY = 0x000000001F26a0044BaA66024e7b6599c61963F8;

    function run() external {
        uint256 pk = vm.envUint("DEPLOYER_PK");
        address attestor = vm.addr(pk); // deployer acts as attestor (TWAP pusher)

        vm.startBroadcast(pk);
        Proposal proposalImpl = new Proposal();
        ProposalManager pm = new ProposalManager(COLLATERAL, address(proposalImpl), attestor, CCA_FACTORY);
        vm.stopBroadcast();

        console.log("proposalManager:", address(pm));
        console.log("proposalImpl:  ", address(proposalImpl));
        console.log("attestor:      ", attestor);
    }
}
