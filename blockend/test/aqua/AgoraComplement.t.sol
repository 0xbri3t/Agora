// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {Test} from "forge-std/Test.sol";
import {IAqua} from "@1inch-aqua/src/interfaces/IAqua.sol";
import {ISwapVM} from "@1inch-swap-vm/src/interfaces/ISwapVM.sol";
import {LimitSwapVMRouter} from "@1inch-swap-vm/src/routers/LimitSwapVMRouter.sol";
import {AgoraQuoteBuilder} from "../../src/aqua/AgoraQuoteBuilder.sol";
import {AgoraComplement} from "../../src/aqua/AgoraComplement.sol";
import {MockUSDC} from "../../src/mocks/MockUSDC.sol";
import {MockOutcomeToken} from "../../src/mocks/MockOutcomeToken.sol";

/// @notice The custom-instruction headline: the VM itself enforces the futarchy
///         no-arbitrage invariant price(YES) + price(NO) <= 1 USDC via _extruction.
contract AgoraComplementTest is Test {
    address constant AQUA_SEPOLIA = 0x499943E74FB0cE105688beeE8Ef2ABec5D936d31;
    address constant WETH_SEPOLIA = 0xfFf9976782d46CC05630D1f6eBAb18b2324d6B14;

    IAqua aqua = IAqua(AQUA_SEPOLIA);
    LimitSwapVMRouter router;
    AgoraQuoteBuilder builder;
    AgoraComplement complement;
    MockUSDC usdc;
    MockOutcomeToken yes;
    MockOutcomeToken no;

    address maker = makeAddr("maker");
    address taker = makeAddr("taker");

    uint256 constant LOT_TOKEN = 10e18;

    function setUp() public {
        vm.createSelectFork(vm.rpcUrl("sepolia"));
        router = new LimitSwapVMRouter(AQUA_SEPOLIA, WETH_SEPOLIA, address(this), "Agora SwapVM", "1.0");
        builder = new AgoraQuoteBuilder(AQUA_SEPOLIA);
        complement = new AgoraComplement();
        usdc = new MockUSDC();
        yes = new MockOutcomeToken("Agora YES", "tYES");
        no = new MockOutcomeToken("Agora NO", "tNO");

        yes.mint(maker, 100e18);
        no.mint(maker, 100e18);
        usdc.mint(taker, 1_000_000e6);

        vm.startPrank(maker);
        yes.approve(AQUA_SEPOLIA, type(uint256).max);
        no.approve(AQUA_SEPOLIA, type(uint256).max);
        usdc.approve(AQUA_SEPOLIA, type(uint256).max);
        vm.stopPrank();

        vm.prank(taker);
        usdc.approve(address(router), type(uint256).max);
    }

    /// Forecast prices: what the subject asset is worth in each world.
    /// ~3000 USDC per token, i.e. 3000e6 in 6-decimal terms.
    uint256 constant REFERENCE = 3000e6;      // the proposal's Pyth reference
    uint256 constant FORECAST_YES = 3000e6;
    uint256 constant FORECAST_NO = 2800e6;
    uint256 constant FORECAST_BULL = 90_000e6; // 30x — a radical but real view
    uint256 constant FAT_FINGER = 1;           // 0.000001 USDC — a typo, not a view
    uint256 constant MAX_RATIO = 100;

    /// Ship a lot whose program carries the complement guard.
    function _shipGuardedLot(
        MockOutcomeToken token,
        uint256 price6d,   // this lot's forecast (encoded via ship amounts)
        uint256 refPrice, // the market reference the VM sanity-checks against
        uint256 salt
    ) internal returns (ISwapVM.Order memory order, uint256 lotUsdc) {
        lotUsdc = (LOT_TOKEN * price6d) / 1e18;
        bytes memory program = builder.buildProgramWithComplement(
            address(usdc), address(token), address(complement),
            refPrice, MAX_RATIO, bytes32(salt)
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
        // A plain forecast at the reference price fills normally
        (ISwapVM.Order memory yesOrder, uint256 yesUsdc) = _shipGuardedLot(yes, FORECAST_YES, REFERENCE, 1);

        bytes memory takerData = builder.buildTakerData(taker, true);
        vm.prank(taker);
        (uint256 amountIn, uint256 amountOut,) =
            router.swap(yesOrder, address(usdc), address(yes), yesUsdc, takerData);
        assertEq(amountIn, yesUsdc);
        assertEq(amountOut, LOT_TOKEN);
    }

    function test_fatFingerLot_revertsAtVMLevel() public {
        // A dust price 3 billion times below the reference is a typo, and it
        // would drag the settling TWAP with it.
        (ISwapVM.Order memory yesOrder, uint256 yesUsdc) = _shipGuardedLot(yes, FAT_FINGER, REFERENCE, 2);

        bytes memory takerData = builder.buildTakerData(taker, true);
        vm.prank(taker);
        vm.expectRevert(abi.encodeWithSelector(
            AgoraComplement.ComplementPriceOutOfBand.selector, FAT_FINGER, REFERENCE, MAX_RATIO
        ));
        router.swap(yesOrder, address(usdc), address(yes), yesUsdc, takerData);
    }

    function test_radicalButRealForecast_isAllowed() public {
        // 30x the reference: a proposal that reprices the asset hard. The gap
        // IS the signal, so the guard must stay out of the way.
        (ISwapVM.Order memory yesOrder, uint256 yesUsdc) = _shipGuardedLot(yes, FORECAST_BULL, REFERENCE, 9);
        bytes memory takerData = builder.buildTakerData(taker, true);
        vm.prank(taker);
        (uint256 amountIn,,) = router.swap(yesOrder, address(usdc), address(yes), yesUsdc, takerData);
        assertEq(amountIn, yesUsdc, "a 30x conviction forecast must still fill");
    }

    function test_bothSidesFarApart_bothFill() public {
        // The two worlds priced 30x apart: legitimate disagreement, not an
        // error. Both lots fill — the earlier YES+NO<=1 rule rejected this.
        (ISwapVM.Order memory bullOrder, uint256 bullUsdc) = _shipGuardedLot(yes, FORECAST_BULL, REFERENCE, 10);
        (ISwapVM.Order memory bearOrder, uint256 bearUsdc) = _shipGuardedLot(no, FORECAST_NO, REFERENCE, 11);

        bytes memory takerData = builder.buildTakerData(taker, true);
        vm.startPrank(taker);
        router.swap(bullOrder, address(usdc), address(yes), bullUsdc, takerData);
        router.swap(bearOrder, address(usdc), address(no), bearUsdc, takerData);
        vm.stopPrank();
        assertEq(yes.balanceOf(taker), LOT_TOKEN);
        assertEq(no.balanceOf(taker), LOT_TOKEN);
    }

    function test_quoteAndSwapConsistent() public {
        // Extruction contract must behave identically in static (quote) and swap paths
        (ISwapVM.Order memory yesOrder, uint256 yesUsdc) = _shipGuardedLot(yes, FORECAST_YES, REFERENCE, 3);
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
        // Full pair, both sanity-checked against the same market reference
        (ISwapVM.Order memory yesOrder, uint256 yesUsdc) = _shipGuardedLot(yes, FORECAST_YES, REFERENCE, 4);
        (ISwapVM.Order memory noOrder, uint256 noUsdc) = _shipGuardedLot(no, FORECAST_NO, REFERENCE, 5);

        bytes memory takerData = builder.buildTakerData(taker, true);
        vm.startPrank(taker);
        (, uint256 outYes,) = router.swap(yesOrder, address(usdc), address(yes), yesUsdc, takerData);
        (, uint256 outNo,) = router.swap(noOrder, address(usdc), address(no), noUsdc, takerData);
        vm.stopPrank();

        assertEq(outYes, LOT_TOKEN);
        assertEq(outNo, LOT_TOKEN);
    }
}
