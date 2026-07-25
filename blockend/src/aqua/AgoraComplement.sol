// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {IExtruction, IStaticExtruction} from "@1inch-swap-vm/src/instructions/Extruction.sol";
import {SwapQuery, SwapRegisters} from "@1inch-swap-vm/src/libs/VM.sol";

/// @notice Custom SwapVM instruction guarding Agora's futarchy lots, invoked
///         through the `_extruction` opcode: it rejects fills whose implied
///         forecast is not a real quote at all.
/// @dev Agora prices are FORECASTS, not probabilities. An outcome token trades
///      at what the subject asset is worth in that world ("ETH is ~3000 USDC if
///      this passes"), so YES and NO never sum to one, and the gap between them
///      is the market's signal — a proposal that burns half the supply *should*
///      price the two worlds far apart. This instruction therefore says nothing
///      about the YES/NO relationship: forecasts are the market's business, and
///      manipulation is answered by the TWAP window, arbitrage, and the
///      butterfly payout that only pays if reality reaches the manipulated
///      price.
///
///      What it does reject is a lot that cannot be a genuine forecast:
///        - a zero-balance lot (no price can be derived from it), and
///        - a price absurdly far from the market's own reference, outside
///          [reference / maxRatio, reference * maxRatio].
///      The band is deliberately huge (a hundred-fold by default) so it never
///      argues with a trader's conviction; it only catches fat-finger lots and
///      dust quotes that would otherwise poison the TWAP that settles the
///      market.
///
///      Deterministic and stateless: the reference price is passed in the
///      instruction args, fixed by the maker when the lot is shipped, so the
///      quote (static) and swap paths always agree — as the Extruction
///      security contract requires. Immutable: no storage, no owner, no
///      external calls.
contract AgoraComplement is IExtruction, IStaticExtruction {
    /// @notice Default width of the sanity band, as a multiplier either way
    uint256 public constant DEFAULT_MAX_RATIO = 100;

    error ComplementMissingArgs();
    error ComplementZeroBalances(uint256 balanceIn, uint256 balanceOut);
    error ComplementInvalidReference(uint256 referencePrice6d, uint256 maxRatio);
    error ComplementPriceOutOfBand(uint256 price6d, uint256 referencePrice6d, uint256 maxRatio);

    /// @dev args = abi.encodePacked(uint256 referencePrice6d, uint256 maxRatio)
    ///      referencePrice6d: the market's reference for the subject asset
    ///      (USDC 6d per 1e18 token) — the Pyth price the proposal opened with.
    ///      maxRatio: how many times above or below that reference a lot may
    ///      price before it stops being a plausible forecast.
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
        uint256 referencePrice6d = uint256(bytes32(args[0:32]));
        uint256 maxRatio = uint256(bytes32(args[32:64]));
        if (referencePrice6d == 0 || maxRatio == 0) {
            revert ComplementInvalidReference(referencePrice6d, maxRatio);
        }

        if (swap.balanceIn == 0 || swap.balanceOut == 0) {
            revert ComplementZeroBalances(swap.balanceIn, swap.balanceOut);
        }
        // This lot's forecast: USDC (6d) per 1e18 outcome token.
        uint256 price6d = (swap.balanceIn * 1e18) / swap.balanceOut;
        if (price6d == 0) revert ComplementZeroBalances(swap.balanceIn, swap.balanceOut);

        // Outside [reference / maxRatio, reference * maxRatio] the lot is a
        // typo or dust, not a view on the outcome.
        if (price6d > referencePrice6d * maxRatio || price6d * maxRatio < referencePrice6d) {
            revert ComplementPriceOutOfBand(price6d, referencePrice6d, maxRatio);
        }

        // Pass-through: no state change, no taker-args consumption, continue at nextPC.
        return (nextPC, 0, swap);
    }
}
