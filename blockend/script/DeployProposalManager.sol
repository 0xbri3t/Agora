// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import "forge-std/Script.sol";
import "forge-std/console.sol";
import {ProposalManager} from "../src/core/ProposalManager.sol";

contract DeployProposalManager is Script {
    function run(
        address pyusd,
        address proposalImpl,
        address attestor,
        address newOwner
    ) external {
        vm.startBroadcast();

        ProposalManager pm = new ProposalManager(pyusd, proposalImpl, attestor);
        console.log("ProposalManager deployed at:", address(pm));
        console.log("Owner:", pm.owner());

        if (newOwner != address(0) && newOwner != pm.owner()) {
            pm.transferOwnership(newOwner);
            console.log("Ownership transferred to:", newOwner);
        }

        vm.stopBroadcast();
    }
}
