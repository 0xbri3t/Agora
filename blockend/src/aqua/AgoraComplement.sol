// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {IExtruction, IStaticExtruction} from "@1inch-swap-vm/src/instructions/Extruction.sol";
import {SwapQuery, SwapRegisters} from "@1inch-swap-vm/src/libs/VM.sol";

/// @notice Custom SwapVM instruction for Agora's futarchy markets, invoked via
///         the `_extruction` opcode: bounds how far apart a single maker may
///         quote the two conditional outcomes of the same proposal.
/// @dev Agora prices are FORECASTS, not probabilities. An outcome token trades
///      at the expected value of the subject asset in that world (e.g. "ETH is
///      worth ~3000 USDC if this proposal passes"), so YES and NO do NOT sum to
///      one — the probability-market invariant `YES + NO <= 1` belongs to
///      Polymarket-style venues and would reject every realistic quote here.
///
///      What does need bounding is the SPREAD between a maker's own two sides.
///      Resolution compares TWAP(YES) against TWAP(NO), so a maker quoting one
///      side far away from the other can swing the decision cheaply while
///      calling both quotes "their view". Keeping the two forecasts within
///      `maxDivergenceBps` of each other forces anyone who wants to move the
///      outcome to move BOTH sides — which costs real capital, and is what
///      honest disagreement looks like anyway.
///
///      The paired side's price is embedded in the instruction args by the
///      maker at program-build time. Deterministic, stateless and identical on
///      the quote (static) and swap paths, as the Extruction security contract
///      requires. Immutable: no storage, no owner, no external calls.
contract AgoraComplement is IExtruction, IStaticExtruction {
    /// @notice Basis-point denominator
    uint256 public constant BPS = 10_000;

    error ComplementDivergence(uint256 ownPrice6d, uint256 pairedPrice6d, uint256 maxDivergenceBps);
    error ComplementMissingArgs();
    error ComplementZeroBalances(uint256 balanceIn, uint256 balanceOut);
    error ComplementInvalidBound(uint256 maxDivergenceBps);

    /// @dev args = abi.encodePacked(uint256 pairedPrice6d, uint256 maxDivergenceBps)
    ///      pairedPrice6d: the maker's forecast on the OTHER outcome (USDC 6d
    ///      per 1e18 token). maxDivergenceBps: how far the two may diverge,
    ///      measured against the lower of the two.
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
        if (args.length < 64) revert ComplementMissingArgs();
        uint256 pairedPrice6d = uint256(bytes32(args[0:32]));
        uint256 maxDivergenceBps = uint256(bytes32(args[32:64]));
        if (maxDivergenceBps == 0) revert ComplementInvalidBound(maxDivergenceBps);

        if (swap.balanceIn == 0 || swap.balanceOut == 0) {
            revert ComplementZeroBalances(swap.balanceIn, swap.balanceOut);
        }
        // Own forecast: USDC (6d) per 1e18 outcome token, from the lot's ratio.
        uint256 ownPrice6d = (swap.balanceIn * 1e18) / swap.balanceOut;

        (uint256 low, uint256 high) = ownPrice6d < pairedPrice6d
            ? (ownPrice6d, pairedPrice6d)
            : (pairedPrice6d, ownPrice6d);
        // A zero forecast on either side has no meaningful spread to bound
        if (low == 0) revert ComplementDivergence(ownPrice6d, pairedPrice6d, maxDivergenceBps);

        // (high - low) / low, in basis points
        if (((high - low) * BPS) / low > maxDivergenceBps) {
            revert ComplementDivergence(ownPrice6d, pairedPrice6d, maxDivergenceBps);
        }

        // Pass-through: no state change, no taker-args consumption, continue at nextPC.
        return (nextPC, 0, swap);
    }
}
