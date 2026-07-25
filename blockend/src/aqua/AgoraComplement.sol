// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {IExtruction, IStaticExtruction} from "@1inch-swap-vm/src/instructions/Extruction.sol";
import {SwapQuery, SwapRegisters} from "@1inch-swap-vm/src/libs/VM.sol";

/// @notice Custom SwapVM instruction logic for futarchy markets, invoked via the
///         `_extruction` opcode: enforces the complementary-outcome no-arbitrage
///         invariant `price(YES) + price(NO) <= 1 USDC` at VM execution time.
/// @dev The lot's own price is derived from the Aqua-preloaded virtual balances
///      (balanceIn = USDC 6d, balanceOut = outcome token 18d). The paired side's
///      price is embedded in the instruction args by the maker at program-build
///      time. Deterministic, stateless and identical for quote (static) and swap
///      paths — as required by the Extruction security contract. Immutable: no
///      storage, no owner, no external calls.
contract AgoraComplement is IExtruction, IStaticExtruction {
    /// @notice One full unit of probability in USDC 6d (YES + NO must not exceed it)
    uint256 public constant ONE_USDC = 1_000000;

    error ComplementViolation(uint256 ownPrice6d, uint256 pairedPrice6d);
    error ComplementMissingPairedPrice();
    error ComplementZeroBalances(uint256 balanceIn, uint256 balanceOut);

    /// @dev args = abi.encodePacked(uint256 pairedPrice6d) — price of the maker's
    ///      OTHER outcome lot (NO if this is YES), USDC 6d per 1e18 token.
    function extruction(
        bool, /* isStaticContext */
        uint256 nextPC,
        SwapQuery calldata, /* query */
        SwapRegisters calldata swap,
        bytes calldata args,
        bytes calldata /* takerData */
    ) external pure override(IExtruction, IStaticExtruction) returns (
        uint256 updatedNextPC,
        uint256 choppedLength,
        SwapRegisters memory updatedSwap
    ) {
        if (args.length < 32) revert ComplementMissingPairedPrice();
        uint256 pairedPrice6d = uint256(bytes32(args[0:32]));

        if (swap.balanceIn == 0 || swap.balanceOut == 0) {
            revert ComplementZeroBalances(swap.balanceIn, swap.balanceOut);
        }
        // Own price: USDC (6d) per 1e18 outcome token, from the lot's balance ratio.
        uint256 ownPrice6d = (swap.balanceIn * 1e18) / swap.balanceOut;

        if (ownPrice6d + pairedPrice6d > ONE_USDC) {
            revert ComplementViolation(ownPrice6d, pairedPrice6d);
        }

        // Pass-through: no state change, no taker-args consumption, continue at nextPC.
        return (nextPC, 0, swap);
    }
}
