// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {ISwapVM} from "@1inch-swap-vm/src/interfaces/ISwapVM.sol";
import {MakerTraitsLib} from "@1inch-swap-vm/src/libs/MakerTraits.sol";
import {TakerTraitsLib} from "@1inch-swap-vm/src/libs/TakerTraits.sol";
import {LimitOpcodes} from "@1inch-swap-vm/src/opcodes/LimitOpcodes.sol";
import {LimitSwap, LimitSwapArgsBuilder} from "@1inch-swap-vm/src/instructions/LimitSwap.sol";
import {Controls} from "@1inch-swap-vm/src/instructions/Controls.sol";
import {Extruction} from "@1inch-swap-vm/src/instructions/Extruction.sol";
import {Program, ProgramBuilder} from "@1inch-swap-vm/test/utils/ProgramBuilder.sol";

/// @notice Builds Agora fill-or-kill lot quotes as Aqua-mode SwapVM orders (swap-vm v1.0.1).
/// @dev In Aqua mode the VM preloads ctx balances from the strategy's SHIPPED virtual
///      balances, so the shipped amounts [lotUsdc, lotToken] ARE the price and size.
///      _limitSwapOnlyFull1D makes each lot all-or-nothing -> the price is exact by
///      construction (no partial-fill drift). Partial-fill UX = ship a ladder of lots.
///      Program: _limitSwapOnlyFull1D + _salt, encoded via 1inch's own ProgramBuilder
///      against the LimitOpcodes instruction table (no magic numbers).
contract AgoraQuoteBuilder is LimitOpcodes {
    using ProgramBuilder for Program;

    constructor(address aqua) LimitOpcodes(aqua) {}

    /// @notice Build the SwapVM bytecode for one fill-or-kill lot quote.
    /// @dev Price/size live in the ship() amounts, not in the program.
    /// @param usdc Quote/collateral token (6d)
    /// @param outcomeToken YES/NO market token (18d)
    /// @param salt Uniqueness so identical lots hash differently (ladder lots differ by salt)
    function buildProgram(
        address usdc,
        address outcomeToken,
        bytes32 salt
    ) public view returns (bytes memory) {
        Program memory p = ProgramBuilder.init(_opcodes());

        return bytes.concat(
            // Maker sells outcomeToken for USDC -> maker's tokenIn = usdc, tokenOut = outcomeToken.
            p.build(LimitSwap._limitSwapOnlyFull1D, LimitSwapArgsBuilder.build(usdc, outcomeToken)),
            p.build(Controls._salt, abi.encodePacked(salt))
        );
    }

    /// @notice Wrap a program into an Aqua-mode order (no signature; ship() authorizes).
    function buildOrder(
        address maker,
        bytes memory program
    ) public pure returns (ISwapVM.Order memory) {
        return MakerTraitsLib.build(MakerTraitsLib.Args({
            maker: maker,
            shouldUnwrapWeth: false,
            useAquaInsteadOfSignature: true,
            allowZeroAmountIn: false,
            receiver: address(0),
            hasPreTransferInHook: false,
            hasPostTransferInHook: false,
            hasPreTransferOutHook: false,
            hasPostTransferOutHook: false,
            preTransferInTarget: address(0),
            preTransferInData: "",
            postTransferInTarget: address(0),
            postTransferInData: "",
            preTransferOutTarget: address(0),
            preTransferOutData: "",
            postTransferOutTarget: address(0),
            postTransferOutData: "",
            program: program
        }));
    }

    /// @notice Like buildProgram, but prepends the AgoraComplement extruction:
    ///         the VM itself rejects fills when ownPrice + pairedPrice > 1 USDC.
    /// @param complement Deployed AgoraComplement (immutable, stateless)
    /// @param pairedPrice6d Price of the maker's OTHER outcome lot (USDC 6d per 1e18 token)
    function buildProgramWithComplement(
        address usdc,
        address outcomeToken,
        address complement,
        uint256 pairedPrice6d,
        bytes32 salt
    ) public view returns (bytes memory) {
        Program memory p = ProgramBuilder.init(_opcodes());

        return bytes.concat(
            // _extruction args = [target:20B][extructionArgs...] — ours: [pairedPrice:32B]
            p.build(Extruction._extruction, abi.encodePacked(complement, pairedPrice6d)),
            p.build(LimitSwap._limitSwapOnlyFull1D, LimitSwapArgsBuilder.build(usdc, outcomeToken)),
            p.build(Controls._salt, abi.encodePacked(salt))
        );
    }

    /// @notice One-call convenience for the backend (eth_call): program + order + ship payload + hash.
    /// @return order The Aqua-mode order struct (pass to router.swap)
    /// @return shipStrategy abi.encode(order) — the `strategy` param for aqua.ship()
    /// @return strategyHash keccak256(abi.encode(order)) — Aqua-mode order hash (== aqua strategyHash)
    function buildQuote(
        address maker,
        address usdc,
        address outcomeToken,
        bytes32 salt
    ) external view returns (ISwapVM.Order memory order, bytes memory shipStrategy, bytes32 strategyHash) {
        order = buildOrder(maker, buildProgram(usdc, outcomeToken, salt));
        shipStrategy = abi.encode(order);
        strategyHash = keccak256(shipStrategy);
    }

    /// @notice Taker-side data for router.swap(): EOA path, router pulls tokenIn via
    ///         transferFrom + Aqua push. Taker must approve tokenIn to the router.
    function buildTakerData(address taker, bool isExactIn) external pure returns (bytes memory) {
        return TakerTraitsLib.build(TakerTraitsLib.Args({
            taker: taker,
            isExactIn: isExactIn,
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
}
