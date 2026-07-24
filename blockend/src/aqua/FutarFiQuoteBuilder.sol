// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {ISwapVM} from "@1inch-swap-vm/src/interfaces/ISwapVM.sol";
import {MakerTraitsLib} from "@1inch-swap-vm/src/libs/MakerTraits.sol";
import {LimitOpcodes} from "@1inch-swap-vm/src/opcodes/LimitOpcodes.sol";
import {LimitSwap, LimitSwapArgsBuilder} from "@1inch-swap-vm/src/instructions/LimitSwap.sol";
import {Controls} from "@1inch-swap-vm/src/instructions/Controls.sol";
import {Program, ProgramBuilder} from "@1inch-swap-vm/test/utils/ProgramBuilder.sol";

/// @notice Builds FutarFi fill-or-kill lot quotes as Aqua-mode SwapVM orders (swap-vm v1.0.1).
/// @dev In Aqua mode the VM preloads ctx balances from the strategy's SHIPPED virtual
///      balances, so the shipped amounts [lotUsdc, lotToken] ARE the price and size.
///      _limitSwapOnlyFull1D makes each lot all-or-nothing -> the price is exact by
///      construction (no partial-fill drift). Partial-fill UX = ship a ladder of lots.
///      Program: _limitSwapOnlyFull1D + _salt, encoded via 1inch's own ProgramBuilder
///      against the LimitOpcodes instruction table (no magic numbers).
contract FutarFiQuoteBuilder is LimitOpcodes {
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
}
