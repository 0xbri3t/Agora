# Agora

Futarchy decision markets on Ethereum Sepolia: governance proposals become YES/NO markets whose prices *are* the decision. Liquidity bootstraps on **Uniswap Continuous Clearing Auctions**, continuous trading runs self-custodially on **1inch Aqua/SwapVM**, market data is indexed by **The Graph**, and **Pyth** anchors the subject asset's reference price.

Currently live on:
- [Agora landing page](https://www.futarfi.com)
- [API docs](https://api.futarfi.com)

---

Developers: [Arnau Briet](@bri3t)

Mentor: [Alex Arteaga](@alex-alra-arteaga)

---

## The Issue

Civilization runs on correct capital allocation. Corruption and conflicts of interest undermine it — nowhere more clearly than when the managerial class is not aligned with its stakeholders: taxpayers in a democracy, investors in a company, holders in a DAO.

Agora solves this: decisions are made by markets that put a price on their consequences, taken by people who back their view with capital.

---

## Stack

| Partner | Role in Agora |
|---|---|
| **Uniswap CCA** | Market bootstrap. Every proposal deploys two Continuous Clearing Auctions (YES/NO) through the canonical `ContinuousClearingAuctionFactory` — fair uniform-price liquidity seeding with a graduation gate and native refunds. |
| **1inch Aqua / SwapVM** | Continuous trading. Makers ship fill-or-kill lot quotes with funds staying in their wallets; takers fill through the SwapVM router at exact prices. A custom SwapVM instruction (`AgoraComplement`) enforces `price(YES) + price(NO) ≤ 1 USDC` at VM execution time. |
| **The Graph** | Data layer. A Sepolia subgraph indexes proposals, Aqua lot quotes, fills and attestor-pushed TWAPs — and feeds the Agora copilot (implied probability, arbitrage watch, TWAP trend). |
| **Pyth** | Oracle. Pull-based reference price of the subject asset at market creation (it also sets the CCA floor price); the options settlement design reads Pyth again at expiry. |

---

## Understanding Futarchy

Futarchy — coined by economist Robin Hanson — means "vote on values, bet on beliefs." A community first agrees on what it wants to maximize (a clear, measurable objective), then lets markets determine which policy is most likely to improve it. Instead of counting raw votes on complex means, we price beliefs about outcomes.

Conceptually, futarchy runs two parallel "worlds" for any proposal:

- If it passes (YES-world), what does the objective look like?
- If it doesn't (NO-world), what does the objective look like?

Whichever world the market values more is the one the community adopts.

Concretely: suppose OpenAI is voting on whether to replace its CEO. Two markets open, trading OpenAI's expected valuation if the proposal passes versus if it fails. If the pass-market prices OpenAI higher, the proposal executes.

---

## Agora vs Polymarket

Polymarket tells you what will happen. Agora decides what should happen.

On Polymarket you trade the probability of an event. The market is a spectator — the event happens with or without it.

On Agora you price the consequences of a decision: two markets price the same asset in two parallel futures — one where the proposal executes, one where it doesn't.

Whichever future the market values higher is the one that will execute. The price doesn't predict the outcome. It picks it.

And we don't just get a yes or a no — we get the decision's impact, in dollars.

---

## The Problem and the Solution

### The Problem
Traditional DAO and DeFi governance relies on voting mechanisms that do not always produce the most informed or economically efficient decision. Votes are swayed by social bias, poor coordination, or lack of technical understanding. Worse, voter apathy and rational irrationality mean individuals have little incentive to even learn about complex policies — the probability that any single vote changes the outcome is essentially negligible.

### The Solution
Agora replaces raw votes with priced beliefs:

- **Aligns incentives:** those with superior information risk capital to correct prices — and reveal that information to everyone.
- **Reduces rhetoric:** replaces speculative debate with prices that embed expectations about outcomes.
- **Skin in the game:** if you're right, you profit; if you're wrong, you lose money.
- **Evolutionary pressure:** poor forecasters lose capital and influence over time; skilled forecasters gain both, improving signal quality as the system matures.

---

## Solving the Cold Start: Liquidity at Launch

A major pain point for any new market is the cold start: thin books, wide spreads, and noisy first prints. Early trades are easy to push around, and governance signals get distorted.

Agora bootstraps each market with **Uniswap Continuous Clearing Auctions**: every proposal deploys two CCAs (YES and NO) through the canonical `ContinuousClearingAuctionFactory`. Participants bid a budget with a max price; the uniform clearing price starts at a floor (a tenth of the Pyth reference price) and rises with demand as the token supply releases block by block.

- **Fair price discovery:** everyone in a block pays the same clearing price; higher max prices get allocated first. No gas wars, no sniping.
- **Graduation gate:** each CCA carries a `requiredCurrencyRaised` threshold derived from the proposal's `minToOpen`. Both sides must graduate for the market to open — the on-chain equivalent of "enough interest to be worth trading".
- **Native refunds:** if either side fails to graduate, the proposal cancels and bidders exit their bids on the CCA for a full refund. The Treasury never touches funds pre-graduation.
- **Anchoring the open:** the final clearing prices anchor the YES/NO quotes when continuous trading starts, tightening spreads and improving subsequent price discovery.

On graduation, `settleAuctions()` sweeps both raised pots (net of the Uniswap protocol fee) into the market's Treasury — the collateral that funds resolution — and the market transitions to continuous on-chain trading on 1inch Aqua, leveraging the auction's depth and reference price for tighter spreads, better fills, and a cleaner TWAP signal.

---

## Where Your Money Goes

During trading: auction proceeds sit in each side's Treasury pot; Aqua order-book trades are wallet-to-wallet.

At resolution:

> **The winning market, whether YES or NO, receives butterfly spread options whose peak sits exactly where that market priced its token — the winning TWAP. Maximum payout if the real asset lands on the prediction. The losing market gets its money back via a pro-rata claim.**

Why it's built this way:

- **Winners are paid for calibration, not cheerleading.** The butterfly pays `max(0, W − |spot − peak|)` per contract, cash-settled against Pyth at expiry: landing on the forecast pays the most, overshooting the hype pays nothing. The reward matures *after* the decision — skin in the game that survives the vote.
- **Losers' bets are called off.** Their tokens forecast a world that never happened — a counterfactual can't be scored, so the bet is refunded pro-rata from their own pot (Hanson's "called-off bets"; the same reason MetaDAO reverts its failing market).
- **Nobody writes the options.** A butterfly's payoff is capped at its wing width, so the winning pot itself fully collateralizes every contract it mints — no counterparty, no solvency risk. (The hackathon demo mints them as mock ERC20s; the mechanism is the design above.)
- **Manipulation hits three walls:** hold the TWAP against arbitrage for the whole window, watch your inflated TWAP become your butterfly's peak — a price reality won't visit — and every dollar you overpaid went to honest counterparties.

---

## System Flow
![System Flow](https://github.com/user-attachments/assets/22721499-0fdf-4c89-bddd-fa4eb14acbb8)

---

## Design Decisions

- **Ethereum Sepolia:** home of the live 1inch Aqua deployment and the canonical Uniswap CCA factory; full Foundry/Viem/Wagmi tooling.
- **Uniswap CCA for liquidity:** fair, uniform-price bootstrap with graduation gates and native refunds — no hand-rolled auction code.
- **Aqua lot trading:** post-auction price discovery runs on 1inch Aqua/SwapVM — self-custodial fill-or-kill lots, exact prices, on-chain settlement.
- **TWAP resolution:** an attestor pushes volume-weighted TWAPs computed from on-chain Aqua fills; `Proposal` resolves by comparing TWAP(YES) vs TWAP(NO).
- **Butterfly settlement:** winners receive butterfly options peaked at their winning TWAP; losers claim pro-rata — see "Where Your Money Goes".
- **Pyth:** subject-asset reference price at creation (and the CCA floor); the options design settles against Pyth at expiry.

---

## Contracts Flow
![System Flow](https://github.com/user-attachments/assets/738b7a25-923b-4f21-bfc8-13e9ac591e9f)

1. **Proposal Creation**
   - The proposer defines the **subject token** (the asset being evaluated), **minimum supply** (`minToOpen`), **maximum cap**, and optional **target contract + calldata** to execute if the market approves.
   - The initial reference price of the subject token is fetched from **Pyth**.

2. **CCA Bootstrap (Liquidity Seeding)**
   - `initialize()` deploys two Uniswap CCAs (YES/NO) via the canonical factory, pre-mints the outcome-token supply to them and builds the auction parameters.
   - Participants bid through Permit2; `settleAuctions()` graduates both sides into a Live market — or cancels with full CCA-native refunds.

3. **Aqua Trading Phase**
   - Makers ship fill-or-kill lot quotes for YES/NO tokens; takers fill them through the SwapVM router. Funds stay in maker wallets until fill time; every trade settles on-chain at an exact price.
   - `AgoraComplement` rejects any fill that would let `YES + NO` exceed 1 USDC.

4. **Resolution**
   - The attestor pushes volume-weighted TWAPs computed from the on-chain fills.
   - `TWAP(YES) > TWAP(NO)` → the proposal executes its target calldata; otherwise the status quo stands.

5. **Claim and Settlement**
   - The **winning side** claims butterfly options peaked at its winning TWAP.
   - The **losing side** claims a pro-rata share of its own pot — its conditional bet is called off.

---

## Main Code Architecture

```text
├── backend            Node/Express + MongoDB — Aqua event indexing, TWAP attestor, copilot API
├── frontend           Next.js + Wagmi/Viem — markets UI, CCA bidding (Permit2), claims
├── subgraph           The Graph — proposals, quotes, fills, TWAPs on Sepolia
└── blockend           Foundry
       ├── core/       Proposal.sol · ProposalManager.sol · Treasury.sol
       ├── aqua/       AgoraQuoteBuilder.sol · AgoraComplement.sol
       ├── tokens/     MarketToken.sol
       └── interfaces/ ICCA.sol · …
```

### Frontend/Backend Interaction

* The **frontend** uses **Viem/Wagmi** for contract interaction — CCA bids, Aqua fills, claims.
* The **backend** indexes Aqua events (`Shipped`/`Swapped`/`Docked`) into the order book and pushes volume-weighted TWAPs on-chain as attestor.
* The **copilot** answers over live market data from the subgraph (Mongo fallback on local forks): implied probability (which world the market picks), global `YES+NO ≤ 1` arbitrage watch, and TWAP trend.

---

## The Graph Integration (ETHGlobal Lisbon 2026)

The **Agora subgraph** is the copilot's only source of chain data — no mocks, no static fixtures.

| Piece | Where |
|---|---|
| Live subgraph (Sepolia) | [`agora` on Subgraph Studio](https://thegraph.com/studio/subgraph/agora) — queries: `https://api.studio.thegraph.com/query/1756977/agora/v0.0.1` |
| Schema + mappings | `subgraph/schema.graphql`, `subgraph/src/{proposal-manager,proposal,aqua,router,cca}.ts` |
| Copilot analytics | `backend/src/services/copilotService.js` |
| Copilot API | `backend/src/routes/copilot.js` — `/api/copilot/:id/insights`, `/api/copilot/:id/ask` |
| Copilot UI | `frontend/components/copilot-panel.tsx` |

What it indexes: proposals and their lifecycle, the two Uniswap CCAs per proposal with every bid, the 1inch Aqua lot quotes and fills, and attestor TWAP pushes.

Indexed entities:

| Entity | What it holds |
|---|---|
| `Proposal` | title, status, latest TWAPs, winner |
| `Auction` | the Uniswap CCA per side: clearing price, bid count, committed capital |
| `Bid` | bidder, max price, budget, tokens filled / refund once exited |
| `Market` | YES/NO side, volume, last price, open quote count |
| `Quote` | Aqua fill-or-kill lot: size, price, OPEN/FILLED/CANCELLED |
| `Fill` | swap through the router: taker, amounts, price |
| `TwapPoint` | TWAP history per proposal |
| `Maker` | quote/fill counts, volume |

Prices follow the contract convention (USDC 6d per 1e18 outcome token).

What the agent does with it — it reasons, it does not print rows:
- **Implied probability** of the proposal passing, from TWAPs (or best asks before any TWAP exists)
- **Cross-maker arbitrage**: flags when the cheapest YES plus the cheapest NO costs under 1 USDC (a risk-free basket), and when a single maker quotes a pair summing over 1 USDC — the invariant the `AgoraComplement` VM instruction enforces locally, watched here market-wide
- **Bootstrap read** during the auction: how much capital each side has committed, which way it leans, and a warning when one bidder alone carries a side
- **TWAP trend** toward resolution

Free-form questions go through `/api/copilot/:id/ask`, answered from the same subgraph data (with Claude when `ANTHROPIC_API_KEY` is set, and a deterministic reading otherwise).

Deploy your own: `cd subgraph && npx graph auth <key> && npm run deploy`, then point `SUBGRAPH_URL` at the resulting endpoint.

---

## Uniswap CCA Integration (ETHGlobal Lisbon 2026)

Market bootstrap runs on **Uniswap's Continuous Clearing Auction** (Liquidity Launchpad stack). Each proposal creates two CCAs against the canonical factory — no forks, no redeploys:

| Piece | Where |
|---|---|
| CCA factory (Uniswap, official) | [`0x000000001F26a0044BaA66024e7b6599c61963F8`](https://sepolia.etherscan.io/address/0x000000001F26a0044BaA66024e7b6599c61963F8) |
| ProposalManager (CCA era, live) | [`0x8C069587f3626A0d31D202e93de446871Ec1EdF5`](https://sepolia.etherscan.io/address/0x8C069587f3626A0d31D202e93de446871Ec1EdF5) |
| Demo proposal #1 + its two live CCAs | [`0xffBe…08EC`](https://sepolia.etherscan.io/address/0xffBe2267865D498bCf2024Db0af87F84Ba1e08EC) — YES [`0x2fF9…fB92`](https://sepolia.etherscan.io/address/0x2fF9A42f5d94876EB1b8CbBD67011C57CdBffB92) / NO [`0xa5bA…0a8F`](https://sepolia.etherscan.io/address/0xa5bAa2c688ac648BF012CB9C7d6BE7611a650a8F) |
| Auction creation + parameters | `blockend/src/core/Proposal.sol` — `initialize()` / `_buildAuctionParameters()` / `_buildSteps()` |
| Settlement (graduate/cancel) | `blockend/src/core/Proposal.sol` — `settleAuctions()` |
| Integration interface | `blockend/src/interfaces/ICCA.sol` |
| Bidding UI (Permit2) | `frontend/hooks/use-auction-buy.ts`, `frontend/contracts/cca-abi.ts` |
| Fork tests vs the real factory | `blockend/test/cca/ProposalCCA.t.sol`, `backend/test/e2e.lifecycle.test.js` |

Developer feedback from the integration lives in [`FEEDBACK.md`](./FEEDBACK.md).

Run tests: `cd blockend && forge test --match-path "test/cca/*"` (needs `SEPOLIA_RPC_URL`).

---

## 1inch Aqua / SwapVM Integration (ETHGlobal Lisbon 2026)

Agora's continuous-trading layer runs on **1inch Aqua + SwapVM**: maker quotes become fill-or-kill lot strategies shipped to the live Aqua core, and fills execute on-chain through a `LimitSwapVMRouter`. Maker funds never leave their wallet (Aqua self-custody); shipped virtual balances encode each lot's exact price and size; cancel = `dock`. A **custom SwapVM instruction** (via the `_extruction` opcode) enforces the futarchy no-arbitrage invariant `price(YES) + price(NO) <= 1 USDC` at VM execution time.

### Deployed contracts (Sepolia)

| Contract | Address | Notes |
|---|---|---|
| Aqua core (1inch, official) | [`0x499943E74FB0cE105688beeE8Ef2ABec5D936d31`](https://sepolia.etherscan.io/address/0x499943E74FB0cE105688beeE8Ef2ABec5D936d31) | Not redeployed — we ship/dock/pull/push against it |
| LimitSwapVMRouter (our deployment) | [`0x4CF2713D08C5E439409b56efA4027F25EB0F6431`](https://sepolia.etherscan.io/address/0x4CF2713D08C5E439409b56efA4027F25EB0F6431) | Official SwapVM code; the canonical Sepolia router lacks limit opcodes |
| AgoraQuoteBuilder | [`0xc651dDD1DAeC92Af51B32bA381e48Ac975a3b2D1`](https://sepolia.etherscan.io/address/0xc651dDD1DAeC92Af51B32bA381e48Ac975a3b2D1) | On-chain program/order/taker-data encoder |
| AgoraComplement (custom SwapVM instruction) | [`0x79B26dEA7d063aA011EfC3D51deeaB79Aa26aD08`](https://sepolia.etherscan.io/address/0x79B26dEA7d063aA011EfC3D51deeaB79Aa26aD08) | Enforces `price(YES) + price(NO) <= 1 USDC` inside the VM, via the `_extruction` opcode |
| MockUSDC (demo) | [`0x34ad23A27Ae8A562928234D4415eD7225a44bB2E`](https://sepolia.etherscan.io/address/0x34ad23A27Ae8A562928234D4415eD7225a44bB2E) | 6-decimals demo collateral |
| ProposalManager | [`0x8C069587f3626A0d31D202e93de446871Ec1EdF5`](https://sepolia.etherscan.io/address/0x8C069587f3626A0d31D202e93de446871Ec1EdF5) | Agora governance stack (Pyth-priced proposals) |

### Live demo transactions (Sepolia)

1. **Ship** lot (sell 10 YES @ 0.40 USDC — maker YES balance unchanged, Aqua custody): [`0xd54a216d…`](https://sepolia.etherscan.io/tx/0xd54a216dc514ce91081c63d2c5cdc8dc06bff776c7b80c1d30140999b3953ea6)
2. **Fill** lot exactly (taker pays 4 USDC, receives 10 YES; `Pulled`/`Pushed`/`Swapped` events): [`0x8ae074f2…`](https://sepolia.etherscan.io/tx/0x8ae074f2c3620f64bbfe8dbdbd6232079920a3c8daeb61565101b76e20850147)
3. **Ship** second lot (5 YES @ 0.55): [`0x6e967445…`](https://sepolia.etherscan.io/tx/0x6e967445b4f49c6e9a55656470a3311c0c41f3d6dd8d98914669a6f6ef2e76bc)
4. **Cancel** via `dock`: [`0xaf04e8cb…`](https://sepolia.etherscan.io/tx/0xaf04e8cbf15e487a528b472fff600a31a4223bb99a5c993a129f11c1b62e10ae)

### Where the integration lives

- `blockend/src/aqua/AgoraQuoteBuilder.sol` — builds lot programs (`_limitSwapOnlyFull1D` + `_salt`) with 1inch's own `ProgramBuilder`; Aqua-mode orders via `MakerTraitsLib`; `buildQuote`/`buildTakerData` view encoders for the backend
- `blockend/src/aqua/AgoraComplement.sol` — **custom SwapVM instruction** (`IExtruction`/`IStaticExtruction`) rejecting fills when `YES + NO > 1 USDC`
- `blockend/test/aqua/` — Foundry suites vs the real Sepolia Aqua core (fork): lot lifecycle E2E, complement guard, quote/swap consistency
- `backend/src/services/aquaClient.js` — ship/fill/cancel from Node (all encoding via on-chain builder, no local bit-packing)
- `backend/src/services/aquaOrderbookService.js` — indexes `Shipped`/`Swapped`/`Docked` into the existing Mongo order book
- `backend/scripts/demo/` — the demo scripts used for the transactions above

Run tests: `cd blockend && forge test --match-path "test/aqua/*"` (needs `SEPOLIA_RPC_URL`) · `cd backend && npm test`

---

## Local Setup

```bash
# One command: MongoDB + anvil (Sepolia fork with live Aqua + CCA factory) + contracts + backend + frontend
./dev.sh

# Stop / status / logs / fresh DB
./dev.sh stop | status | logs [svc] | reset
```

Requirements: Docker, Foundry, Node, pnpm. Set `SEPOLIA_RPC_URL` in `blockend/.env`.

---

## Notes & Disclaimer

* **Monorepo:** frontend, backend/indexer, subgraph and smart-contract packages in one repo.
* **Not audited / not production-ready:** this codebase has **not been audited**. Prototyping and development purposes only.
* **Event:** built for **ETHGlobal Lisbon 2026**, starting from the pre-existing FutarFi baseline (see the initial commit).

Please treat this repository as a proof-of-concept. Security reviews, audits, and additional hardening are required before any real-value deployment.
