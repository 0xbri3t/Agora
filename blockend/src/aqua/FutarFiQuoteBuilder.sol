// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {ISwapVM} from "@1inch-swap-vm/src/interfaces/ISwapVM.sol";
import {MakerTraitsLib} from "@1inch-swap-vm/src/libs/MakerTraits.sol";
import {LimitOpcodes} from "@1inch-swap-vm/src/opcodes/LimitOpcodes.sol";
import {Balances, BalancesArgsBuilder} from "@1inch-swap-vm/src/instructions/Balances.sol";
import {LimitSwap, LimitSwapArgsBuilder} from "@1inch-swap-vm/src/instructions/LimitSwap.sol";
import {Controls} from "@1inch-swap-vm/src/instructions/Controls.sol";
import {Program, ProgramBuilder} from "@1inch-swap-vm/test/utils/ProgramBuilder.sol";

/// @notice Builds FutarFi limit-quote SwapVM programs and Aqua-mode orders (swap-vm v1.0.1).
/// @dev Program: _staticBalancesXD + _limitSwap1D + _salt, encoded via 1inch's own
///      ProgramBuilder against the LimitOpcodes instruction table (no magic numbers).
///      Price is the static balance ratio -> fixed across partial fills.
contract FutarFiQuoteBuilder is LimitOpcodes {
    using ProgramBuilder for Program;

    constructor(address aqua) LimitOpcodes(aqua) {}

    /// @notice Build the SwapVM bytecode for a resting limit quote.
    /// @param usdc Quote/collateral token (6d)
    /// @param outcomeToken YES/NO market token (18d)
    /// @param balUsdc Static USDC balance — with balToken encodes the price ratio
    /// @param balToken Static outcome-token balance
    /// @param salt Uniqueness so identical quotes hash differently
    function buildProgram(
        address usdc,
        address outcomeToken,
        uint256 balUsdc,
        uint256 balToken,
        bytes32 salt
    ) public view returns (bytes memory) {
        Program memory p = ProgramBuilder.init(_opcodes());

        // StaticBalances args carry (tokens[], balances[]) sorted by token address.
        (address tokenA, address tokenB, uint256 balA, uint256 balB) = usdc < outcomeToken
            ? (usdc, outcomeToken, balUsdc, balToken)
            : (outcomeToken, usdc, balToken, balUsdc);
        address[] memory tokens = new address[](2);
        tokens[0] = tokenA;
        tokens[1] = tokenB;
        uint256[] memory balances = new uint256[](2);
        balances[0] = balA;
        balances[1] = balB;

        return bytes.concat(
            p.build(Balances._staticBalancesXD, BalancesArgsBuilder.build(tokens, balances)),
            // Maker sells outcomeToken for USDC -> maker's tokenIn = usdc, tokenOut = outcomeToken.
            p.build(LimitSwap._limitSwap1D, LimitSwapArgsBuilder.build(usdc, outcomeToken)),
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
