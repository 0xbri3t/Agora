// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {Test} from "forge-std/Test.sol";
import {Proposal} from "../../src/core/Proposal.sol";
import {ProposalManager} from "../../src/core/ProposalManager.sol";
import {MarketToken} from "../../src/tokens/MarketToken.sol";
import {ICCAuction} from "../../src/interfaces/ICCA.sol";
import {IProposal} from "../../src/interfaces/IProposal.sol";
import {MockUSDC} from "../../src/mocks/MockUSDC.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

interface IPermit2 {
    function approve(address token, address spender, uint160 amount, uint48 expiration) external;
}

/// @notice Full proposal lifecycle on a Sepolia fork against the REAL Uniswap
///         Continuous Clearing Auction factory: two CCAs bootstrap the YES/NO
///         markets, graduation activates the proposal, bidders claim tokens,
///         TWAPs resolve it and losers redeem collateral pro-rata.
contract ProposalCCATest is Test {
    // Canonical Uniswap CCA factory (same address on Sepolia and mainnet)
    address constant CCA_FACTORY = 0x000000001F26a0044BaA66024e7b6599c61963F8;
    // Canonical Permit2 — CCA pulls bid currency through it
    address constant PERMIT2 = 0x000000000022D473030F116dDEE9F6B43aC78BA3;
    // Real Pyth on Sepolia + ETH/USD feed
    address constant PYTH = 0xDd24F84d36BF92C65F92307595335bdFab5Bbd21;
    bytes32 constant ETH_USD = 0xff61491a931112ddf1bd8147cd1b641375f79f5825126d665480874634fd0ace;

    uint256 constant AUCTION_SECONDS = 1200; // -> 100 blocks
    uint256 constant LIVE_SECONDS = 3600;

    ProposalManager pm;
    Proposal proposal;
    MockUSDC usdc;
    address attestor = makeAddr("attestor");
    address alice = makeAddr("alice");
    address bob = makeAddr("bob");

    function setUp() public {
        vm.createSelectFork(vm.rpcUrl("sepolia"));
        usdc = new MockUSDC();
        Proposal impl = new Proposal();
        pm = new ProposalManager(address(usdc), address(impl), attestor, CCA_FACTORY);

        usdc.mint(alice, 10_000_000e6);
        usdc.mint(bob, 10_000_000e6);
    }

    function _createProposal() internal returns (Proposal) {
        pm.createProposal(
            "Adopt CCA?", "Uniswap CCA bootstraps the market", AUCTION_SECONDS, LIVE_SECONDS,
            "ETH", 1e18, 1000e18, address(0), "", PYTH, ETH_USD
        );
        return Proposal(pm.getProposalById(1).proposalAddress);
    }

    /// Bid enough on one CCA to clear its graduation threshold.
    function _bidToGraduate(ICCAuction auction, address bidder) internal returns (uint256 bidId) {
        uint256 maxPrice = auction.clearingPrice() * 4; // comfortably above clearing
        vm.startPrank(bidder);
        usdc.approve(PERMIT2, type(uint256).max);
        IPermit2(PERMIT2).approve(address(usdc), address(auction), type(uint160).max, type(uint48).max);
        // Budget: 4x the graduation requirement so demand clears the schedule
        bidId = auction.submitBid(maxPrice, uint128(_required(auction) * 4), bidder, "");
        vm.stopPrank();
    }

    function _required(ICCAuction) internal view returns (uint256) {
        // minToOpen tokens at the floor (a tenth of the Pyth price): mirrors
        // Proposal._buildAuctionParameters. Read it off the proposal instead of
        // hardcoding oracle values.
        return 100_000e6; // ample vs any realistic ETH price / 10 threshold for 1 token
    }

    function _endAuctions(Proposal p) internal {
        vm.roll(uint256(p.auctionEndBlock()) + 1);
    }

    function test_LifecycleGraduatedToResolvedAndClaims() public {
        proposal = _createProposal();
        ICCAuction yesA = proposal.yesAuction();
        ICCAuction noA = proposal.noAuction();

        assertEq(yesA.token(), address(proposal.yesToken()));
        assertEq(yesA.currency(), address(usdc));
        // Sweeps are recipient-gated: the Proposal receives and forwards to the Treasury
        assertEq(yesA.fundsRecipient(), address(proposal));

        uint256 yesBid = _bidToGraduate(yesA, alice);
        uint256 noBid = _bidToGraduate(noA, bob);

        _endAuctions(proposal);
        proposal.settleAuctions(); // checkpoints both CCAs, then activates
        assertEq(uint8(proposal.state()), uint8(IProposal.State.Live));
        assertGt(proposal.potYes(), 0);
        assertGt(proposal.potNo(), 0);
        assertGt(proposal.soldYes(), 0);

        // Treasury holds both pots (post protocol fee)
        assertEq(usdc.balanceOf(address(proposal.treasury())), proposal.potYes() + proposal.potNo());

        // Bidders exit (finalizes allocation, refunds unspent budget) then claim
        vm.startPrank(alice);
        yesA.exitBid(yesBid);
        yesA.claimTokens(yesBid);
        vm.stopPrank();
        vm.startPrank(bob);
        noA.exitBid(noBid);
        noA.claimTokens(noBid);
        vm.stopPrank();
        MarketToken yesToken = proposal.yesToken();
        MarketToken noToken = proposal.noToken();
        assertGt(yesToken.balanceOf(alice), 0, "alice got no YES");
        assertGt(noToken.balanceOf(bob), 0, "bob got no NO");

        // Attestor pushes TWAPs from Aqua trading; YES wins
        vm.prank(attestor);
        proposal.updateTwap(600000, 350000);

        vm.warp(proposal.liveEnd() + 1);
        proposal.resolve();
        assertEq(uint8(proposal.state()), uint8(IProposal.State.Resolved));
        assertTrue(noToken.paused(), "loser NO should pause");

        // Loser redeems pro-rata: bob returns all his NO for the whole NO pot
        uint256 bobTokens = noToken.balanceOf(bob);
        uint256 expected = (proposal.potNo() * bobTokens) / proposal.soldNo();
        uint256 balBefore = usdc.balanceOf(bob);
        vm.startPrank(bob);
        noToken.approve(address(proposal.treasury()), type(uint256).max);
        proposal.claimTokens(address(noToken));
        vm.stopPrank();
        assertEq(usdc.balanceOf(bob) - balBefore, expected, "pro-rata payout mismatch");
    }

    function test_NonGraduatedAuctionsCancelAndRefund() public {
        proposal = _createProposal();
        ICCAuction yesA = proposal.yesAuction();

        // Tiny bid: far below the graduation requirement
        vm.startPrank(alice);
        usdc.approve(PERMIT2, type(uint256).max);
        IPermit2(PERMIT2).approve(address(usdc), address(yesA), type(uint160).max, type(uint48).max);
        uint256 bidId = yesA.submitBid(yesA.clearingPrice() * 2, uint128(10e6), alice, "");
        vm.stopPrank();

        _endAuctions(proposal);
        assertFalse(yesA.isGraduated());

        proposal.settleAuctions();
        assertEq(uint8(proposal.state()), uint8(IProposal.State.Cancelled));

        // The CCA refunds the bidder directly; the Treasury never held funds
        uint256 before = usdc.balanceOf(alice);
        vm.prank(alice);
        yesA.exitBid(bidId);
        assertEq(usdc.balanceOf(alice) - before, 10e6, "full refund expected");
        assertEq(usdc.balanceOf(address(proposal.treasury())), 0);
    }

    function test_SettleRevertsBeforeAuctionEnd() public {
        proposal = _createProposal();
        vm.expectRevert();
        proposal.settleAuctions();
    }

    function test_UpdateTwap_onlyAttestor() public {
        proposal = _createProposal();
        _bidToGraduate(proposal.yesAuction(), alice);
        _bidToGraduate(proposal.noAuction(), bob);
        _endAuctions(proposal);
        proposal.settleAuctions();

        vm.expectRevert();
        proposal.updateTwap(1, 2);

        vm.prank(attestor);
        proposal.updateTwap(1, 2);
        assertEq(proposal.twapPriceTokenYes(), 1);
    }
}
