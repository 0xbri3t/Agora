// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import "forge-std/Test.sol";
import {MarketToken} from "../src/tokens/MarketToken.sol";

contract MarketTokenPauseRedeemCapTest is Test {
    MarketToken token;

    address owner    = makeAddr("owner");
    address minter   = makeAddr("minter");
    address redeemer = makeAddr("redeemer");
    address alice    = makeAddr("alice");
    address bob      = makeAddr("bob");

    uint256 constant CAP = 1_000_000e18;

    function setUp() public {
        vm.label(owner, "owner");
        vm.label(minter, "minter");
        vm.label(redeemer, "redeemer");
        vm.label(alice, "alice");
        vm.label(bob, "bob");

        vm.prank(owner);
        token = new MarketToken(
            "FutarFi YES #1",
            "YES-1",
            owner,     // Ownable
            minter,    // initial minter
            CAP        // total cap 
        );

        // Initial mint (not paused)
        vm.startPrank(minter);
        token.mint(alice, 1_000e18);
        token.mint(bob,     500e18);
        vm.stopPrank();

        // Sanity pre-pause: normal transfer works
        vm.prank(alice);
        token.transfer(bob, 100e18);
        assertEq(token.balanceOf(bob), 600e18);
        assertEq(token.balanceOf(alice), 900e18);
    }

    function _pauseWithRedeemer() internal {
        vm.prank(owner);
        token.finalizeAsLoser(redeemer);
        assertTrue(token.paused(), "token should be paused");
    }

    // ---------- Pause / redemption tests ----------
    function test_Revert_NormalTransfers_WhenPaused() public {
        _pauseWithRedeemer();

        vm.prank(alice);
        vm.expectRevert(bytes("MarketToken:paused"));
        token.transfer(bob, 1e18);

        vm.prank(alice);
        token.approve(address(this), 1e18);
        vm.expectRevert(bytes("MarketToken:paused"));
        token.transferFrom(alice, bob, 1e18);
    }

    function test_Allow_Transfer_To_Redeemer_WhenPaused() public {
        _pauseWithRedeemer();

        uint256 amount = 5e18;

        vm.prank(alice);
        token.transfer(redeemer, amount);

        vm.prank(bob);
        token.approve(address(this), amount);
        token.transferFrom(bob, redeemer, amount);

        assertEq(token.balanceOf(redeemer), amount * 2);
    }

    function test_Allow_Redeemer_Burn_WhenPaused() public {
        _pauseWithRedeemer();

        vm.prank(alice);
        token.transfer(redeemer, 10e18);

        uint256 tsBefore  = token.totalSupply();
        uint256 rBefore   = token.balanceOf(redeemer);

        vm.prank(redeemer);
        token.redeemerBurn(10e18);

        assertEq(token.balanceOf(redeemer), rBefore - 10e18, "redeemer balance after burn");
        assertEq(token.totalSupply(), tsBefore - 10e18, "totalSupply reduced");
    }

    function test_Revert_Mint_WhenPaused() public {
        _pauseWithRedeemer();

        vm.prank(minter);
        vm.expectRevert(bytes("MarketToken:paused"));
        token.mint(alice, 1e18);
    }

    // ---------- Cap tests ----------
    function test_Cap_Allows_Mint_Upto_ExactCap() public {
        uint256 minted = token.totalSupply(); 
        uint256 toMint = CAP - minted;        // fill up to the cap

        vm.prank(minter);
        token.mint(alice, toMint);

        assertEq(token.totalSupply(), CAP, "totalSupply should equal CAP");
        assertEq(token.balanceOf(alice), 900e18 + toMint, "alice balance increased");
    }

    function test_Cap_Overflow_Reverts() public {
        // Bring supply up to cap
        uint256 minted = token.totalSupply();
        vm.prank(minter);
        token.mint(alice, CAP - minted);

        // Attempting to exceed cap should revert (message depends on OZ; we don't assert it)
        vm.prank(minter);
        vm.expectRevert(); // OZ ERC20Capped revert
        token.mint(alice, 1);
    }

    function test_Cap_CannotBeBypassed_ByPause() public {
        // Pause and ensure that mint reverts due to pause (not due to cap).
        _pauseWithRedeemer();

        // Even if we try to mint, the pause blocks first (cap check won't be reached).
        vm.prank(minter);
        vm.expectRevert(bytes("MarketToken:paused"));
        token.mint(alice, 1e18);
    }
}
