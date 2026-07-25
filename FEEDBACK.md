# Uniswap Stack Feedback — Agora (ETHGlobal Lisbon 2026)

## What we built

Agora is a futarchy protocol: every governance proposal spawns a YES and a NO
market, traders price both, and the stronger TWAP decides. Each market needs
initial liquidity and a fair starting price — exactly the problem the
**Continuous Clearing Auction** solves.

We replaced our hand-rolled Dutch-auction bootstrap with **two CCAs per
proposal** (one per outcome token), created through the canonical
`ContinuousClearingAuctionFactory` on Sepolia
(`0x000000001F26a0044BaA66024e7b6599c61963F8`):

- `blockend/src/core/Proposal.sol` — `initialize()` deploys both CCAs via
  `factory.create`, pre-mints the outcome-token supply to them and builds the
  `AuctionParameters` (floor snapped to the tick grid, per-block issuance
  schedule, graduation threshold derived from the proposal's `minToOpen`).
- `settleAuctions()` — after the end block it checkpoints both CCAs; if **both
  graduated** the raised USDC is swept into the market's Treasury and the
  proposal goes Live (trading then happens on 1inch Aqua); otherwise the
  proposal cancels and bidders exit their bids for full refunds directly on the
  CCAs.
- `blockend/src/interfaces/ICCA.sol` — minimal integration interface.
- Frontend (`frontend/hooks/use-auction-buy.ts`) — bids through **Permit2**,
  clearing-price display, bid exit + token claims.
- Fork tests against the real Sepolia factory:
  `blockend/test/cca/ProposalCCA.t.sol` and the backend E2E
  (`backend/test/e2e.lifecycle.test.js`) drive the full lifecycle
  proposal → CCA bids → graduation → Aqua trading → TWAP resolution → pro-rata
  redemption.

The graduation mechanism (`requiredCurrencyRaised`) mapped 1:1 onto our
"minimum interest to open a market" rule, and non-graduated refunds replaced an
entire hand-written cancellation/refund path — we deleted more code than we
added (`DutchAuction.sol` is gone, ~900 lines removed).

## What went well

- **Graduation semantics**: `requiredCurrencyRaised` + full refunds for
  non-graduated auctions is exactly the right primitive for conditional
  markets. Our cancel path collapsed into "let the CCA refund everyone".
- **Canonical addresses on testnet**: same factory address on Sepolia and
  mainnet made the integration and fork testing frictionless.
- **The issuance schedule** (`auctionStepsData`) is compact and easy to build
  on-chain once understood.

## Friction we hit (ordered by impact)

1. **The docs list a controller/factory reality gap** *(ENS-adjacent but same
   pattern to watch)* — more relevantly for CCA: the docs describe the system
   well but the constraints that actually bite are only in the code:
   - `floorPrice` must be an exact multiple of `tickSpacing`
     (`TickPriceNotAtBoundary`). Nothing in the overview mentions it; we found
     it by decoding a custom error selector against the repo.
   - `sweepCurrency()` / `sweepUnsoldTokens()` are **recipient-gated**
     (`msg.sender` must be the recipient). Reasonable, but undocumented — our
     Treasury-as-fundsRecipient design failed until we routed sweeps through
     the Proposal contract.
   - `claimTokens` requires the bid to be **exited first** (`BidNotExited`).
     The claim/exit split makes sense once understood, but a state diagram of
     bid lifecycle (submitted → outbid/filled/partial → exited → claimed)
     would have saved an hour.
2. **Permit2-only currency pulls.** `submitBid` uses
   `SafeTransferLib.permit2TransferFrom` unconditionally. A plain-approve
   fallback (or a loud docs callout) would help integrators; every frontend
   needs the double-approval dance and most testnet tooling breaks on it
   first try.
3. **Lazy checkpoints surprise view callers.** `isGraduated()` /
   `currencyRaised()` read the *latest checkpoint*, which can be stale until
   someone bids or calls `checkpoint()`. After the end block, an integrator
   settling programmatically must call `checkpoint()` first — we'd suggest
   making the views checkpoint-aware or documenting the pattern prominently.
4. **Blocks, not timestamps.** Fine on L1, but worth a note for local-dev
   (anvil mines on demand — auctions never end unless you mine). A
   `--block-time` hint in the integration docs would help.
5. **Q96 prices everywhere.** Expected for Uniswap devs, but a
   `currency-per-token-wei` worked example (with decimals mismatch like
   USDC-6 / token-18) in the docs would prevent unit bugs.

## What we'd love next

- A `viem`/TS helper package for bid lifecycle (price conversion, tick
  snapping, bid discovery from logs, exit-vs-partial-exit selection). We wrote
  all of this by hand (`frontend/contracts/cca-abi.ts`).
- An official Sepolia subgraph for CCA events.

Team: Arnau Briet — built during ETHGlobal Lisbon 2026 on a pre-existing
project (Continuity track). Integration is open source in this repo.
