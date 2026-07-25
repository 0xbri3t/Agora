# Agora Subgraph

Indexes the Agora futarchy protocol on Sepolia: proposal lifecycle, 1inch Aqua
lot quotes (ship/dock), on-chain fills through the SwapVM router, and
attestor-pushed TWAPs. It is the data source for the Agora copilot.

## Entities

| Entity | Keyed by | What it holds |
|---|---|---|
| `Proposal` | proposal contract address | title, status (AUCTION/LIVE/RESOLVED/CANCELLED), latest TWAPs, winner |
| `Auction` | CCA contract address | the Uniswap Continuous Clearing Auction per side: clearing price, bid count, committed capital |
| `Bid` | auction-bidId | bidder, max price, budget, tokens filled / refund once exited |
| `Market` | outcome token address | YES/NO side, volume, last price, open quote count |
| `Quote` | Aqua `strategyHash` | fill-or-kill lot: `lotUsdc`, `lotToken`, price, OPEN/FILLED/CANCELLED |
| `Fill` | txHash-logIndex | swap through the router: taker, amounts, price |
| `TwapPoint` | txHash-logIndex | TWAP history per proposal |
| `Maker` | address | quote/fill counts, volume |

Prices are USDC (6d) per 1e18 outcome token, same convention as the contracts.

## How indexing works

- `ProposalCreated` (ProposalManager) creates the `Proposal` + both `Market`s
  (outcome tokens read off the contract) and spawns a per-proposal template for
  lifecycle events (`ProposalActivated`, `TwapUpdated`, `ProposalResolved`,
  `ProposalCancelled`).
- Each proposal's two Uniswap CCAs are indexed from creation (`Auction`) and
  their bids tracked through a dynamic template (`BidSubmitted`, `BidExited`,
  `TokensClaimed`, `ClearingPriceUpdated`). This is what lets the copilot read
  the bootstrap phase: how much capital is committed per side and whether the
  demand is concentrated in a single bidder.
- Aqua `Shipped` is filtered to strategies shipped to our router. The lot's
  price/size are the ship() token/amount arrays, decoded from the transaction
  calldata (direct EOA calls; batched ships are skipped).
- Router `Swapped` is filtered to swaps touching a known outcome token. Lots are
  fill-or-kill, so the fill is linked back to its quote through a FIFO bucket of
  identical open lots.

## Develop

```bash
npm install
npm run codegen   # generate types from schema + ABIs
npm run build     # compile mappings to WASM
npx graph test    # matchstick unit tests
```

## Deploy (Subgraph Studio)

1. Create a subgraph named `agora-futarchy` at https://thegraph.com/studio/ (Sepolia).
2. `npx graph auth <deploy-key>`
3. `npm run deploy`

Start blocks are set to the Sepolia deployment blocks of the Aqua stack
(11343344) and the CCA-era ProposalManager (11348446), so a fresh sync takes minutes.

ABIs in `abis/` are extracted from `blockend/out` (forge artifacts).
