//SPDX-License-Identifier: MIT
 pragma solidity ^0.8.30;

 import "forge-std/Script.sol";
 import "forge-std/console.sol";
 import {ProposalManager} from "../src/core/ProposalManager.sol";
 import {MockUSDC} from "../src/mocks/MockUSDC.sol";
 import {Proposal} from "../src/core/Proposal.sol";

 contract DeployScript is Script {
    MockUSDC public collateral;
    ProposalManager public proposalManager;
    Proposal public proposal;
    address public constant ATTESTOR = 0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266; // hardcoded for deployment
    // Uniswap CCA factory (Sepolia fork / Sepolia)
    address public constant CCA_FACTORY = 0x000000001F26a0044BaA66024e7b6599c61963F8;

    function run() external {
        vm.startBroadcast();

        // Deploy COLLATERAL (6 decimals). Mint initial supply to deployer for testing
        uint256 initialSupply = 1_000_000 * 10 ** 6; // 1,000,000 COLLATERAL
        collateral = new MockUSDC();
        collateral.mint(msg.sender, initialSupply);

        proposal = new Proposal();
        // Deploy ProposalManager with COLLATERAL address
        proposalManager = new ProposalManager(address(collateral), address(proposal), ATTESTOR, CCA_FACTORY);

        // Basic checks
        require(proposalManager.COLLATERAL() == address(collateral), "PM: wrong COLLATERAL");
        require(proposalManager.owner() == msg.sender, "PM: wrong owner");

        console.log("\n=== Deployment Summary ===");
        console.log("COLLATERAL:", address(collateral));
        console.log("ProposalManager:", address(proposalManager));
        console.log("Owner:", proposalManager.owner());
        console.log("nextId:", proposalManager.nextId());

        vm.stopBroadcast();
    }
}
