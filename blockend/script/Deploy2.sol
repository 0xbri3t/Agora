//SPDX-License-Identifier: MIT
 pragma solidity ^0.8.30;

 import "forge-std/Script.sol";
 import "forge-std/console.sol";
 import {ProposalManager} from "../src/core/ProposalManager.sol";
 import {PyUSD} from "../src/tokens/PyUSD.sol";
 import {Proposal} from "../src/core/Proposal.sol";

 contract Deploy2 is Script {
    PyUSD public pyusd;
    ProposalManager public proposalManager;
    Proposal public proposal;
    address public constant ATTESTOR = 0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266; // hardcoded for deployment

    function run() external {
        vm.startBroadcast();

        // Deploy PYUSD (6 decimals). Mint initial supply to deployer for testing
        uint256 initialSupply = 1_000_000 * 10 ** 6; // 1,000,000 PYUSD
        pyusd = new PyUSD(msg.sender, initialSupply);

        proposal = new Proposal();
 
        vm.stopBroadcast();
    }
}
