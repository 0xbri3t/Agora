// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import "forge-std/Test.sol";
import {MockPyth} from "@pythnetwork/pyth-sdk-solidity/MockPyth.sol";
import "../src/core/ProposalManager.sol";
import "@openzeppelin/contracts/token/ERC20/ERC20.sol";


/// @notice Simple mock ERC20 used as COLLATERAL collateral in tests
contract MockERC20 is ERC20 {
    constructor() ERC20("MockUSD", "MUSD") {
        _mint(msg.sender, 1_000_000e18);
    }
}

contract ProposalManagerBasicTest is Test {
    ProposalManager public pm;
    MockERC20 public collateral;
    Proposal public proposalImpl;

    address public bob = makeAddr("bob");
    address public alice = makeAddr("alice");
    address public attestor = makeAddr("attestor");

    address PYTH_CONTRACT; // MockPyth deployed in setUp
    bytes32 constant PYTH_ID = 0xff61491a931112ddf1bd8147cd1b641375f79f5825126d665480874634fd0ace;

    function setUp() public {
        // Deploy MockPyth with a live ETH/USD-style price so Proposal.initialize works locally
        MockPyth mockPyth = new MockPyth(60, 1);
        bytes[] memory updates = new bytes[](1);
        updates[0] = mockPyth.createPriceFeedUpdateData(
            0xff61491a931112ddf1bd8147cd1b641375f79f5825126d665480874634fd0ace,
            3000_00000000, 10_0000000, -8, 3000_00000000, 10_0000000, uint64(block.timestamp), uint64(block.timestamp)
        );
        mockPyth.updatePriceFeeds{value: mockPyth.getUpdateFee(updates)}(updates);
        PYTH_CONTRACT = address(mockPyth);

        collateral = new MockERC20();
        proposalImpl = new Proposal();
        vm.label(address(collateral), "collateral");
        pm = new ProposalManager(address(collateral), address(proposalImpl), attestor);
        vm.label(address(pm), "ProposalManager");
    }

    /// @notice Creates a proposal and asserts it is indexed and discoverable
    function test_CreateProposal_Indexes() public {
        vm.prank(bob);
        uint256 id = pm.createProposal(
            "Title",
            "Description",
            100,            // auctionDuration
            200,            // liveDuration
            "Subject Token",     // subjectToken
            1,              // minToOpen
            1000e18,        // maxCap
            address(0),     // target
            "",            // data
            PYTH_CONTRACT,     // pythAddr
            PYTH_ID      // pythId
        );

        assertEq(id, 1);
        assertEq(pm.nextId(), 1);


        ProposalManager.ProposalInfo memory info = pm.getProposalById(1);

        ProposalManager.ProposalInfo[] memory proposalsByAdmin = pm.getProposalsByAdmin(bob);
        assertEq(proposalsByAdmin.length, 1);
        assertEq(proposalsByAdmin[0].id, 1);

        ProposalManager.ProposalInfo[] memory all = pm.getAllProposals();
        assertEq(all.length, 1);

       

        vm.prank(alice);
        uint256 id2 = pm.createProposal(
            "Title",
            "Description",
            100,            
            200,            
            "Subject Token",     
            1,              
            1000e18,        
            address(0),     
            "",            
            PYTH_CONTRACT,    
            PYTH_ID     
        );

        assertEq(id2, 2);
        assertEq(pm.nextId(), 2);

        ProposalManager.ProposalInfo memory proposalInfoAlice = pm.getProposalById(2);
        assertTrue(proposalInfoAlice.id != 0);

        all = pm.getAllProposals();
        assertEq(all.length, 2);

        ProposalManager.ProposalInfo[] memory byAlice = pm.getProposalsByAdmin(alice);
        assertEq(byAlice.length, 1);
        assertEq(byAlice[0].id, 2);
    }


    function test_DeleteProposal_ByAdminOrOwner() public {
        vm.prank(bob);
        uint256 id = pm.createProposal(
            "Title",
            "Description",
            100,            // auctionDuration
            200,            // liveDuration
            "Subject Token",     // subjectToken
            1,              // minToOpen
            1000e18,        // maxCap
            address(0),     // target
            "",            // data
            PYTH_CONTRACT,     // pythAddr
            PYTH_ID      // pythId
        );

        ProposalManager.ProposalInfo memory info = pm.getProposalById(id);
        assertEq(info.id, id);
        assertTrue(info.admin == bob);

        // Attempt delete by non-admin/non-owner should fail
        vm.prank(alice);
        vm.expectRevert("PM:not-authorized");
        pm.deleteProposal(info.proposalAddress);

        // Delete by admin should succeed
        vm.prank(bob);
        pm.deleteProposal(info.proposalAddress);
        vm.expectRevert("PM:unknown-id");
        ProposalManager.ProposalInfo memory fetched = pm.getProposalById(id);

        // Re-create proposal
        vm.prank(bob);
        id = pm.createProposal(
            "Title",
            "Description",
            100,            
            200,            
            "Subject Token",     
            1,              
            1000e18,        
            address(0),     
            "",            
            PYTH_CONTRACT,    
            PYTH_ID     
        );

        ProposalManager.ProposalInfo memory info2 = pm.getProposalById(id);
        assertEq(info2.id, id);
        assertTrue(info2.admin == bob);


        // Delete by owner should succeed
        vm.prank(pm.owner());
        pm.deleteProposal(info2.proposalAddress);
        vm.expectRevert("PM:unknown-id");
        fetched = pm.getProposalById(id);
       
    }
}
