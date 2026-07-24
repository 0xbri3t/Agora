// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import "forge-std/Test.sol";
import {MockPyth} from "@pythnetwork/pyth-sdk-solidity/MockPyth.sol";
import "../src/core/Proposal.sol";
import "../src/core/DutchAuction.sol";
import "../src/interfaces/IProposal.sol";
import "lib/openzeppelin-contracts/contracts/token/ERC20/ERC20.sol";
import {ProposalManager} from "../src/core/ProposalManager.sol";
import {TargetContractMock} from "./mocks/TargetContractMock.sol";
import "@pythnetwork/pyth-sdk-solidity/PythStructs.sol";

/// @notice Simple mock ERC20 used as COLLATERAL collateral in tests
contract MockERC20 is ERC20 {
    constructor() ERC20("MockUSD", "MUSD") {
        _mint(msg.sender, 50_000_000e18);
    }
}



contract ProposalBasicTest is Test {
    ProposalManager public pm;
    MockERC20 public collateral;
    TargetContractMock public target;
    Proposal public proposal;
    address public attestor;
    address public alice;
    address public buyer;

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
        target = new TargetContractMock();
        attestor = makeAddr("attestor");
        proposal = new Proposal();
        pm = new ProposalManager(address(collateral), address(proposal), attestor);
        alice = makeAddr("alice");
        buyer = makeAddr("buyer");
    }

    // test the refund token when auction is canceled
    function test_Refund_afterAuctionCancelled() public {

        pm.createProposal(
            "T",
            "D",
            10,            // auctionDuration
            100,           // liveDuration
            "Subject Token",     // subjectToken
            999e18,              // minToOpen
            1000e18,        // maxCap
            address(0),     // target
            "",            // data
            PYTH_CONTRACT,     // pythAddr
            PYTH_ID      // pythId
        );

        ProposalManager.ProposalInfo memory info;
        info = pm.getProposalById(1);
        proposal = Proposal(info.proposalAddress);

        DutchAuction yes = proposal.yesAuction();
        MarketToken yesToken = proposal.yesToken();
        Treasury treasuryInstance = proposal.treasury();
        address treasury = address(treasuryInstance);

        // Give buyer some collateral and approve treasury to pull collateral when buying
        collateral.transfer(buyer, 1_000e18);
        vm.prank(buyer);
        collateral.approve(treasury, type(uint256).max);

        // Buyer buys a small amount (half a token) so it does NOT meet minToOpen
        uint256 payAmount = 500_000; // yields 0.5e18 tokens at price 1_000_000
        vm.prank(buyer);
        yes.buyLiquidity(payAmount);

        uint256 userTokens = yesToken.balanceOf(buyer);
        assertTrue(userTokens > 0 && userTokens < 1e18, "buyer has amount of tokens");

        // Warp to after auction end and finalize as admin -> this will mark the auction canceled
        uint256 end = yes.END_TIME();
        vm.warp(end + 1);

        // Now tell the Proposal to settle auctions (should detect canceled auction and enable refunds)
        // proposal.settleAuctions();
        vm.prank(attestor);
        yes.finalize();

        // Proposal should be Cancelled
        assertEq(uint8(proposal.state()), uint8(IProposal.State.Cancelled), "Proposal not cancelled");

        // Tokens should be finalized as loser (paused)
        assertTrue(yesToken.paused(), "yes token paused");
        assertTrue(Treasury(treasury).refundsEnabled(), "refunds enabled in treasury");

        // Buyer approves Treasury to pull their outcome tokens for refund
        vm.prank(buyer);
        yesToken.approve(treasury, userTokens);

        uint256 beforePy = collateral.balanceOf(buyer);
        uint256 beforeYesTokens = yesToken.balanceOf(treasury);
        uint256 beforePyTokens = collateral.balanceOf(treasury);

        // Buyer calls auction.refundTokens() which will cause Treasury to refund COLLATERAL
        vm.prank(buyer);
        yes.refundTokens();

        // After refund, buyer should have no outcome tokens and should have received collateral refund
        assertEq(yesToken.balanceOf(buyer), 0, "buyer has zero yes tokens after refund");
        assertTrue(collateral.balanceOf(buyer) > beforePy, "buyer received collateral refund");
        assertEq(yesToken.balanceOf(treasury), beforeYesTokens + userTokens, "treasury received yes tokens");
        assertLt(collateral.balanceOf(treasury), beforePyTokens, "treasury collateral balance increased");
    }


    function test_ExecuteCalldataToTarget() public {

        // calldata to toggle target flag to true
        bytes memory data = abi.encodeWithSelector(TargetContractMock.setTrue.selector);

        // Create a proposal with tiny caps so both auctions can hit cap quickly
        pm.createProposal(
            "Title",
            "Description",
            10,              // auctionDuration
            20,              // liveDuration
            "Subject Token",
            1e18,            // minToOpen (1 token)
            100e18,            // maxCap (1 token)
            address(target), // target
            data,            // data
            PYTH_CONTRACT,   // pythAddr (mock)
            PYTH_ID    // pythId (unused by mock)
        );

        ProposalManager.ProposalInfo memory info;
        info = pm.getProposalById(1);
        proposal = Proposal(info.proposalAddress);

        DutchAuction yes = proposal.yesAuction();
        DutchAuction no = proposal.noAuction();
        MarketToken yesToken = proposal.yesToken();
        MarketToken noToken = proposal.noToken();
        Treasury treasuryInstance = proposal.treasury();
        address treasury = address(treasuryInstance);
        // Fund two buyers for the auctions and approve Treasury
        address buyerYes = makeAddr("buyerYes");
        address buyerNo = makeAddr("buyerNo");
        collateral.transfer(buyerYes,10_000_000e18 ); // enough for auction + later trades
        collateral.transfer(buyerNo, 10_000_000e18);
        vm.prank(buyerYes);
        collateral.approve(treasury, type(uint256).max);
        vm.prank(buyerNo);
        collateral.approve(treasury, type(uint256).max);

        vm.prank(buyerYes);
        yes.buyLiquidity(2e18);  // buy to cap
        vm.prank(buyerNo);
        no.buyLiquidity(2e18);   // buy to cap

        uint256 endTime = yes.END_TIME();
        vm.warp(endTime + 1);

        // vm.prank(attestor);
        // yes.finalize();
        // vm.prank(attestor);
        // no.finalize();
        assertEq(uint8(proposal.state()), uint8(IProposal.State.Live), "Proposal not in Live state");

        // After both auctions, proposal live times are set
        assertGt(proposal.liveStart(), 0, "liveStart not set");
        assertGt(proposal.liveEnd(), 0, "liveEnd not set");


        // Prepare secondary market batch to set TWAPs and trigger resolve
        address takerYes = makeAddr("takerYes");
        address takerNo = makeAddr("takerNo");
        collateral.transfer(takerYes, 10_000);
        collateral.transfer(takerNo, 10_000);

        // Approvals for Proposal to move funds in applyBatch
        vm.prank(buyerYes);
        yesToken.approve(address(proposal), type(uint256).max); // sell 0.2 YES
        vm.prank(takerYes);
        collateral.approve(address(proposal), 10_000);
        vm.prank(buyerNo);
        noToken.approve(address(proposal), type(uint256).max);  // sell 0.2 NO
        vm.prank(takerNo);
        collateral.approve(address(proposal), 10_000);

        // Force Proposal owner to be attestor so _executeTargetCalldata (onlyOwner) passes
        // vm.store(address(proposal), bytes32(uint256(0)), bytes32(uint256(uint160(attestor))));

        // Move to after live end and set state to Live (enum: 0=Auction,1=Live,2=Resolved,3=Cancelled)
        uint256 le = proposal.liveEnd();
        vm.warp(le + 1);

        // Build trades with higher TWAP for YES so YES wins
        IProposal.Trade[] memory ops = new IProposal.Trade[](2);
        ops[0] = IProposal.Trade({
            seller: buyerYes,
            buyer: takerYes,
            outcomeToken: address(yesToken),
            tokenAmount: yesToken.balanceOf(buyerYes),
            collateralAmount: 5_000,
            twapPrice: 200
        });
        ops[1] = IProposal.Trade({
            seller: buyerNo,
            buyer: takerNo,
            outcomeToken: address(noToken),
            tokenAmount: noToken.balanceOf(buyerNo),
            collateralAmount: 4_000,
            twapPrice: 100
        });

        // Apply the batch as attestor; should resolve and execute target calldata
        vm.prank(attestor);
        proposal.applyBatch(ops);


        vm.warp(proposal.liveEnd() + 1);
        proposal.resolve();

        // Expect proposal resolved and target flag toggled to false
        assertEq(uint8(proposal.state()), uint8(IProposal.State.Resolved), "proposal not resolved");
        assertEq(target.flag(), true, "target flag should be true after execution");

        // NO should be loser and paused
        assertTrue(noToken.paused(), "NO token should be paused as loser");
        assertFalse(yesToken.paused(), "YES token should not be paused as winner");

        // test users with noToken can claim
        uint256 balanceTakerNoTokenNoBefore = noToken.balanceOf(takerNo);
        uint256 balanceTreasuryTokenNoBefore = noToken.balanceOf(treasury);

        uint256 balanceTakerNoPyUsdBefore = collateral.balanceOf(takerNo);
        uint256 balanceTreasuryNoPyUsdBefore = collateral.balanceOf(treasury);
        assertEq(Treasury(treasury).refundsEnabled(), true);

        vm.startPrank(takerNo);
        noToken.approve(treasury, type(uint256).max);
        proposal.claimTokens(address(noToken));
        vm.stopPrank();

        assertEq(noToken.balanceOf(takerNo), 0, "after claiming, takerNo should have 0 noTokens");
        assertGt(collateral.balanceOf(takerNo), balanceTakerNoPyUsdBefore, "after claiming, takerNo should have more collateral");
        assertEq(noToken.balanceOf(treasury), balanceTreasuryTokenNoBefore + balanceTakerNoTokenNoBefore, "after claiming, treasury should have more noTokens");
        assertLt(collateral.balanceOf(treasury), balanceTreasuryNoPyUsdBefore, "after claiming, treasury should have less collateral");
    }
}
