// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {Test} from "forge-std/Test.sol";
import {IAqua} from "@1inch-aqua/src/interfaces/IAqua.sol";
import {ISwapVM} from "@1inch-swap-vm/src/interfaces/ISwapVM.sol";
import {LimitSwapVMRouter} from "@1inch-swap-vm/src/routers/LimitSwapVMRouter.sol";
import {FutarFiQuoteBuilder} from "../../src/aqua/FutarFiQuoteBuilder.sol";
import {FutarFiComplement} from "../../src/aqua/FutarFiComplement.sol";
import {MockUSDC} from "../../src/mocks/MockUSDC.sol";
import {MockOutcomeToken} from "../../src/mocks/MockOutcomeToken.sol";

/// @notice The custom-instruction headline: the VM itself enforces the futarchy
///         no-arbitrage invariant price(YES) + price(NO) <= 1 USDC via _extruction.
contract FutarFiComplementTest is Test {
    address constant AQUA_SEPOLIA = 0x499943E74FB0cE105688beeE8Ef2ABec5D936d31;
    address constant WETH_SEPOLIA = 0xfFf9976782d46CC05630D1f6eBAb18b2324d6B14;

    IAqua aqua = IAqua(AQUA_SEPOLIA);
    LimitSwapVMRouter router;
    FutarFiQuoteBuilder builder;
    FutarFiComplement complement;
    MockUSDC usdc;
    MockOutcomeToken yes;
    MockOutcomeToken no;

    address maker = makeAddr("maker");
    address taker = makeAddr("taker");

    uint256 constant LOT_TOKEN = 10e18;

    function setUp() public {
        vm.createSelectFork(vm.rpcUrl("sepolia"));
        router = new LimitSwapVMRouter(AQUA_SEPOLIA, WETH_SEPOLIA, address(this), "FutarFi SwapVM", "1.0");
        builder = new FutarFiQuoteBuilder(AQUA_SEPOLIA);
        complement = new FutarFiComplement();
        usdc = new MockUSDC();
        yes = new MockOutcomeToken("FutarFi YES", "tYES");
        no = new MockOutcomeToken("FutarFi NO", "tNO");

        yes.mint(maker, 100e18);
        no.mint(maker, 100e18);
        usdc.mint(taker, 1_000e6);

        vm.startPrank(maker);
        yes.approve(AQUA_SEPOLIA, type(uint256).max);
        no.approve(AQUA_SEPOLIA, type(uint256).max);
        usdc.approve(AQUA_SEPOLIA, type(uint256).max);
        vm.stopPrank();

        vm.prank(taker);
        usdc.approve(address(router), type(uint256).max);
    }

    /// Ship a lot whose program carries the complement guard.
    function _shipGuardedLot(
        MockOutcomeToken token,
        uint256 price6d,       // this lot's price (encoded via ship amounts)
        uint256 pairedPrice6d, // the paired side's price (checked by the VM)
        uint256 salt
    ) internal returns (ISwapVM.Order memory order, uint256 lotUsdc) {
        lotUsdc = (LOT_TOKEN * price6d) / 1e18;
        bytes memory program = builder.buildProgramWithComplement(
            address(usdc), address(token), address(complement), pairedPrice6d, bytes32(salt)
        );
        order = builder.buildOrder(maker, program);

        address[] memory tokens = new address[](2);
        tokens[0] = address(token); tokens[1] = address(usdc);
        uint256[] memory amounts = new uint256[](2);
        amounts[0] = LOT_TOKEN; amounts[1] = lotUsdc;

        vm.prank(maker);
        aqua.ship(address(router), abi.encode(order), tokens, amounts);
    }

    function test_coherentPair_fills() public {
        // YES at 0.60 paired with NO at 0.35 -> 0.95 <= 1.00 OK
        (ISwapVM.Order memory yesOrder, uint256 yesUsdc) = _shipGuardedLot(yes, 600000, 350000, 1);

        bytes memory takerData = builder.buildTakerData(taker, true);
        vm.prank(taker);
        (uint256 amountIn, uint256 amountOut,) =
            router.swap(yesOrder, address(usdc), address(yes), yesUsdc, takerData);
        assertEq(amountIn, yesUsdc);
        assertEq(amountOut, LOT_TOKEN);
    }

    function test_arbitragePair_revertsAtVMLevel() public {
        // YES at 0.60 paired with NO at 0.50 -> 1.10 > 1.00 -> the VM must reject the fill
        (ISwapVM.Order memory yesOrder, uint256 yesUsdc) = _shipGuardedLot(yes, 600000, 500000, 2);

        bytes memory takerData = builder.buildTakerData(taker, true);
        vm.prank(taker);
        vm.expectRevert(abi.encodeWithSelector(FutarFiComplement.ComplementViolation.selector, 600000, 500000));
        router.swap(yesOrder, address(usdc), address(yes), yesUsdc, takerData);
    }

    function test_quoteAndSwapConsistent() public {
        // Extruction contract must behave identically in static (quote) and swap paths
        (ISwapVM.Order memory yesOrder, uint256 yesUsdc) = _shipGuardedLot(yes, 600000, 350000, 3);
        bytes memory takerData = builder.buildTakerData(taker, true);

        // quote path (static context)
        (uint256 qIn, uint256 qOut,) = router.asView().quote(yesOrder, address(usdc), address(yes), yesUsdc, takerData);

        // swap path
        vm.prank(taker);
        (uint256 sIn, uint256 sOut,) = router.swap(yesOrder, address(usdc), address(yes), yesUsdc, takerData);

        assertEq(qIn, sIn, "quote/swap amountIn must match");
        assertEq(qOut, sOut, "quote/swap amountOut must match");
    }

    function test_bothSidesGuarded_noPairFillsCoherently() public {
        // Full pair: YES 0.60 / NO 0.35, each side guards against the other
        (ISwapVM.Order memory yesOrder, uint256 yesUsdc) = _shipGuardedLot(yes, 600000, 350000, 4);
        (ISwapVM.Order memory noOrder, uint256 noUsdc) = _shipGuardedLot(no, 350000, 600000, 5);

        bytes memory takerData = builder.buildTakerData(taker, true);
        vm.startPrank(taker);
        (, uint256 outYes,) = router.swap(yesOrder, address(usdc), address(yes), yesUsdc, takerData);
        (, uint256 outNo,) = router.swap(noOrder, address(usdc), address(no), noUsdc, takerData);
        vm.stopPrank();

        assertEq(outYes, LOT_TOKEN);
        assertEq(outNo, LOT_TOKEN);
    }
}
