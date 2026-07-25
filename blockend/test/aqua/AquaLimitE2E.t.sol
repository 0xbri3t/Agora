// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {Test} from "forge-std/Test.sol";
import {IAqua} from "@1inch-aqua/src/interfaces/IAqua.sol";
import {ISwapVM} from "@1inch-swap-vm/src/interfaces/ISwapVM.sol";
import {LimitSwapVMRouter} from "@1inch-swap-vm/src/routers/LimitSwapVMRouter.sol";
import {TakerTraitsLib} from "@1inch-swap-vm/src/libs/TakerTraits.sol";
import {AgoraQuoteBuilder} from "../../src/aqua/AgoraQuoteBuilder.sol";
import {MockUSDC} from "../../src/mocks/MockUSDC.sol";
import {MockOutcomeToken} from "../../src/mocks/MockOutcomeToken.sol";

/// @notice E2E on a Sepolia fork against the REAL Aqua core.
///         Agora quotes = Aqua fill-or-kill lots: shipped amounts encode price+size,
///         fills are all-or-nothing at the exact ratio, cancel = dock.
contract AquaLimitE2E is Test {
    address constant AQUA_SEPOLIA = 0x499943E74FB0cE105688beeE8Ef2ABec5D936d31;
    address constant WETH_SEPOLIA = 0xfFf9976782d46CC05630D1f6eBAb18b2324d6B14;

    IAqua aqua = IAqua(AQUA_SEPOLIA);
    LimitSwapVMRouter router;
    AgoraQuoteBuilder builder;
    MockUSDC usdc;
    MockOutcomeToken yes;

    address maker = makeAddr("maker");
    address taker = makeAddr("taker");

    // One lot: sell 10 YES for 4 USDC total (0.40 USDC/YES)
    uint256 constant LOT_YES = 10e18;
    uint256 constant LOT_USDC = 4e6;

    function setUp() public {
        vm.createSelectFork(vm.rpcUrl("sepolia"));
        router = new LimitSwapVMRouter(AQUA_SEPOLIA, WETH_SEPOLIA, address(this), "Agora SwapVM", "1.0");
        builder = new AgoraQuoteBuilder(AQUA_SEPOLIA);
        usdc = new MockUSDC();
        yes = new MockOutcomeToken("Agora YES", "tYES");

        yes.mint(maker, 100e18);
        usdc.mint(taker, 1_000e6);

        vm.startPrank(maker);
        yes.approve(AQUA_SEPOLIA, type(uint256).max);
        usdc.approve(AQUA_SEPOLIA, type(uint256).max);
        vm.stopPrank();

        // EOA taker path: router does transferFrom(taker) + AQUA.push
        vm.prank(taker);
        usdc.approve(address(router), type(uint256).max);
    }

    /// Ship one fill-or-kill lot; shipped amounts [USDC: lotUsdc, YES: lotYes] encode price+size.
    function _shipLot(uint256 lotUsdc, uint256 lotYes, uint256 salt)
        internal
        returns (ISwapVM.Order memory order, bytes32 strategyHash)
    {
        bytes memory program = builder.buildProgram(address(usdc), address(yes), bytes32(salt));
        order = builder.buildOrder(maker, program);

        address[] memory tokens = new address[](2);
        tokens[0] = address(yes); tokens[1] = address(usdc);
        uint256[] memory amounts = new uint256[](2);
        amounts[0] = lotYes; amounts[1] = lotUsdc;

        vm.prank(maker);
        strategyHash = aqua.ship(address(router), abi.encode(order), tokens, amounts);
        assertEq(strategyHash, router.hash(order), "strategyHash must equal order hash");
    }

    function _takerData() internal view returns (bytes memory) {
        return TakerTraitsLib.build(TakerTraitsLib.Args({
            taker: taker,
            isExactIn: true,
            shouldUnwrapWeth: false,
            isStrictThresholdAmount: false,
            isFirstTransferFromTaker: true,
            useTransferFromAndAquaPush: true,
            threshold: "",
            to: address(0),
            deadline: 0,
            hasPreTransferInCallback: false,
            hasPreTransferOutCallback: false,
            preTransferInHookData: "",
            postTransferInHookData: "",
            preTransferOutHookData: "",
            postTransferOutHookData: "",
            preTransferInCallbackData: "",
            preTransferOutCallbackData: "",
            instructionsArgs: "",
            signature: ""
        }));
    }

    function test_fillLotExactly_custodyAndProceeds() public {
        (ISwapVM.Order memory order,) = _shipLot(LOT_USDC, LOT_YES, 1);

        uint256 makerYesBefore = yes.balanceOf(maker);
        uint256 makerUsdcBefore = usdc.balanceOf(maker);

        // Fill the lot exactly: 4 USDC -> 10 YES
        vm.prank(taker);
        (uint256 amountIn, uint256 amountOut,) =
            router.swap(order, address(usdc), address(yes), LOT_USDC, _takerData());

        assertEq(amountIn, LOT_USDC, "amountIn must equal lot USDC");
        assertEq(amountOut, LOT_YES, "amountOut must equal lot YES");
        assertEq(yes.balanceOf(taker), LOT_YES, "taker received YES");
        // Custody story: YES pulled straight from maker wallet at fill time
        assertEq(yes.balanceOf(maker), makerYesBefore - LOT_YES, "maker YES reduced");
        // Proceeds: pushed USDC lands in maker wallet (via Aqua push)
        assertEq(usdc.balanceOf(maker), makerUsdcBefore + LOT_USDC, "maker USDC proceeds");
    }

    function test_partialFillReverts_fillOrKill() public {
        (ISwapVM.Order memory order,) = _shipLot(LOT_USDC, LOT_YES, 1);

        // 2 USDC != 4 USDC lot -> must revert (all-or-nothing)
        vm.prank(taker);
        vm.expectRevert();
        router.swap(order, address(usdc), address(yes), 2e6, _takerData());
    }

    function test_lotCannotBeFilledTwice() public {
        (ISwapVM.Order memory order,) = _shipLot(LOT_USDC, LOT_YES, 1);

        vm.prank(taker);
        router.swap(order, address(usdc), address(yes), LOT_USDC, _takerData());

        // Lot exhausted (YES virtual balance = 0) -> second fill reverts
        vm.prank(taker);
        vm.expectRevert();
        router.swap(order, address(usdc), address(yes), LOT_USDC, _takerData());
    }

    function test_ladderTwoLots_independentFills() public {
        (ISwapVM.Order memory lot1,) = _shipLot(LOT_USDC, LOT_YES, 1);
        (ISwapVM.Order memory lot2,) = _shipLot(LOT_USDC, LOT_YES, 2); // same terms, different salt

        vm.startPrank(taker);
        (, uint256 out1,) = router.swap(lot1, address(usdc), address(yes), LOT_USDC, _takerData());
        (, uint256 out2,) = router.swap(lot2, address(usdc), address(yes), LOT_USDC, _takerData());
        vm.stopPrank();

        assertEq(out1 + out2, 2 * LOT_YES, "both ladder lots filled at exact price");
    }

    /// Backend path: everything (order, ship payload, takerData) from builder view calls only.
    function test_convenienceBuildQuoteAndTakerData_endToEnd() public {
        (ISwapVM.Order memory order, bytes memory shipStrategy, bytes32 strategyHash) =
            builder.buildQuote(maker, address(usdc), address(yes), bytes32(uint256(42)));
        assertEq(strategyHash, router.hash(order), "buildQuote hash must match router.hash");

        address[] memory tokens = new address[](2);
        tokens[0] = address(yes); tokens[1] = address(usdc);
        uint256[] memory amounts = new uint256[](2);
        amounts[0] = LOT_YES; amounts[1] = LOT_USDC;

        vm.prank(maker);
        bytes32 shipped = aqua.ship(address(router), shipStrategy, tokens, amounts);
        assertEq(shipped, strategyHash, "aqua.ship hash must match buildQuote hash");

        bytes memory takerData = builder.buildTakerData(taker, true);
        vm.prank(taker);
        (uint256 amountIn, uint256 amountOut,) = router.swap(
            order, address(usdc), address(yes), LOT_USDC, takerData
        );
        assertEq(amountIn, LOT_USDC);
        assertEq(amountOut, LOT_YES);
    }

    function test_dockCancelsLot() public {
        (ISwapVM.Order memory order, bytes32 strategyHash) = _shipLot(LOT_USDC, LOT_YES, 1);

        address[] memory tokens = new address[](2);
        tokens[0] = address(yes); tokens[1] = address(usdc);
        vm.prank(maker);
        aqua.dock(address(router), strategyHash, tokens);

        vm.prank(taker);
        vm.expectRevert();
        router.swap(order, address(usdc), address(yes), LOT_USDC, _takerData());
    }
}
