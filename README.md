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
| **1inch Aqua / SwapVM** | Continuous trading. Makers ship fill-or-kill lot quotes with funds staying in their wallets; takers fill through the SwapVM router at exact prices. A custom SwapVM instruction (`AgoraComplement`) rejects lots that cannot be genuine forecasts — dust and fat-finger prices — at VM execution time. |
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
