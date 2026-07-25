# Futarchy-DeFi-Protocol
Futarchy-powered DeFi governance: PYUSD payments, Pyth pull oracles, and a TEE-secured private order book on Hedera.

Currently live on!: 
- [FutarFi landing page](https://www.futarfi.com)
- [Api docs](https://api.futarfi.com)

---

Developers: [Arnau Briet](@bri3t) & [Pau Gallego](@PauGallego)

Mentor: [Alex Arteaga](@alex-alra-arteaga)

---

## Introduction

FutarFi is a futarchy-driven prediction market on the Hedera EVM, where proposals become tradable YES/NO markets. Liquidity is bootstrapped via parallel Dutch auctions (2×→0) in which participants directly purchase the initial supply—no liquidity bots; continuous trading then runs on an order book inside a Trusted Execution Environment (TEE), with matching isolated from MEV and anchored on-chain. Resolution uses TWAP with Pyth as the price oracle: the winning side captures value via option-style payouts, while the losing side can claim back by redeeming their MarketTokens for underlying collateral (PYUSD) at the closing (TWAP) price, ensuring a deterministic, pro-rata unwind.

---

## Understanding Futarchy

Futarchy—coined by economist Robin Hanson—means “vote on values, bet on means.” A community first agrees on what it wants to maximize (the value: a clear, measurable objective), and then lets prediction markets determine which policy is most likely to improve that objective. Instead of counting raw votes on complex means, we price beliefs about outcomes.

Conceptually, futarchy runs two parallel “worlds” for any proposal:

- If it passes (YES-world), what does the objective look like?
- If it doesn’t (NO-world), what does the objective look like?

Whichever world the market values more—because participants expect it to lead to a better result—is the one the community adopts.

---

## Problem and Solution

### The Problem
Traditional DAO and DeFi governance frameworks rely heavily on voting mechanisms that do not always represent the most informed or economically efficient decision. Votes can be influenced by social bias, poor coordination, or lack of technical understanding, resulting in choices that don’t maximize long-term protocol value.  
Worse, voter apathy and rational irrationality mean individuals have little incentive to even learn about complex policies—the probability that any single vote changes the outcome is essentially negligible.

### The Solution
FutarFi introduces futarchy-based decision-making, where predictions, not raw votes, guide choices. Through prediction markets, participants financially back the outcome they believe will create the most value. Market prices become real-time, tamper-resistant signals of collective confidence.

- **Aligns incentives:** those who believe they have superior information risk capital to correct prices, and in doing so reveal that information to everyone.
- **Reduces rhetoric:** replaces speculative debate with prices that embed probabilities about outcomes.
- **Skin in the game:** if you’re right, you profit; if you’re wrong, you lose money—you literally put your money where your mouth is.
- **Evolutionary pressure:** poor forecasters lose capital and thus lose influence over time; skilled forecasters gain capital and influence, improving market signal quality as the system matures.

---

## Solving the Cold Start: Liquidity at Launch

A major pain point for any new protocol/market is the cold start: thin books, wide spreads, and noisy first prints caused by insufficient volume/liquidity. Early trades are easy to push around, UX suffers, and governance signals get distorted.

FutarFi addresses this with pre-market dual Dutch auctions (YES/NO). The auction price decays over a fixed window (from 2× → 0 relative to a base), letting participants purchase the initial supply before continuous trading begins. This design creates clear incentives and healthier market microstructure at t = 0:

- **Discount incentive:** early buyers can acquire MarketTokens at a lower expected cost than the open, compensating them for bootstrapping depth.
- **Information revelation:** informed participants can act on private knowledge ahead of the open, moving the clearing price toward fundamentals.
- **Cap-uncertainty “fear” dynamic:** because the Dutch auction is cap-limited and participants don’t know exactly when maxSupply will be reached, there’s a real risk of being locked out of the cheaper tranche. Traders can’t be overly greedy waiting for a deeper discount; the fear of missing the cap pulls demand forward in time, accelerating depth formation.
- **Two-sided depth:** a per-side `minSupplySold` gate ensures both YES and NO enter the open with sufficient liquidity; otherwise, funds are refunded.
- **Anchoring the open:** the aggregate auction outcome provides an indicative initial price that anchors quotes at the start of the session, tightening spreads and improving subsequent price discovery.
  
Once live, the market transitions to continuous trading on a TEE-executed order book, leveraging the auction’s depth and reference price to deliver tighter spreads, better fills, and a cleaner signal for TWAP-based settlement later on.

---

## System Flow
![System Flow](https://github.com/user-attachments/assets/22721499-0fdf-4c89-bddd-fa4eb14acbb8)

---

## Design Decisions

- **Hedera EVM:** Selected for low latency, predictable gas fees, and full Ethereum tooling compatibility (Foundry, Viem, Wagmi).
- **Pyth:** Used exclusively to fetch the **initial price** of the subject token at market creation. Continuous update models are not implemented.
- **Dutch Auction for Liquidity:** Ensures fair and balanced initial market capitalization.
- **Order Book Trading:** Allows ongoing market-driven price discovery post-auction.
- **Market Tokens as Rewards:** Winners receive OPTIONS tokens bought with the treasury; losers can claim proportional treasury.
- **TEE Integration:** The final resolution endpoint executes within a **Trusted Execution Environment (TEE)** to guarantee tamper-proof validation and privacy-preserving computation.

---

## Contracts flow
![System Flow](https://github.com/user-attachments/assets/738b7a25-923b-4f21-bfc8-13e9ac591e9f)

1. **Proposal Creation**
   - When a new proposal is created, the market deployer defines:
     - **Subject Token:** the asset or variable being evaluated.
     - **Minimum Supply:** the minimum total amount of liquidity required for the market to initialize.
     - **Maximum Cap:** the total cap of liquidity allowed in the market.
     - **Optional Call Data and Target Contract:** an optional payload and target contract to be executed if the market result validates the proposed decision.
   - The initial reference price of the subject token is fetched from **Pyth**, ensuring an objective baseline.

2. **Initial Dutch Auction (Liquidity Seeding)**
   - A short Dutch auction is conducted solely to bootstrap **initial liquidity**.
   - Participants purchase **YES** or **NO** positions at a price that decreases linearly over time.
   - This ensures balanced liquidity distribution before transitioning into open trading.

3. **Order Book Trading Phase**
   - After the liquidity phase, the market switches to an **order book** model.
   - Traders can place limit or market orders for **YES/NO tokens**.
   - This mechanism allows continuous and transparent price discovery.

4. **Resolution Phase**
   - Upon reaching the resolution date or condition, the **subject token’s** price is compared against its initial reference value.
   - The outcome determines whether the **YES** or **NO** side wins.
   - The **winning side receives OPTIONS tokens**, which are **purchased from the treasury using the treasury of the winning token and distributed to holders of the winning token**.

5. **Claim and Settlement**
   - The **winning side** is allocated OPTIONS tokens bought with the treasury and delivered to holders of the winning token.
   - The **losing side** can **claim a proportional share of the treasury**, ensuring liquidity fairness and equitable capital distribution.

---

## Main code Architecture

```text
├── Backend 
│
├── frontend (Next.js + Wagmi + Viem)
│
└── Blockend
       ├── DutchAuction.sol
       └── Proposal.sol
       ├── ProposalManager.sol
       ├── MarketToken.sol
       ├──Treasury.sol
```

### Frontend/Backend Interaction

* The **frontend** uses **Viem** for contract interaction, managing auctions, orders, and claims.
* The **backend** indexes market state, aggregates data, and relays verified results from the TEE resolution endpoint.
* The **TEE** ensures off-chain comparison logic runs securely before triggering on-chain settlements.

---

## Technical Highlights

* **Proposal Parameters:** Each market defines min supply, cap, and optional executable logic.
* **Market-Specific Tokens:** Each market mints unique YES/NO tokens tied to that instance.
* **TEE Settlement:** The final resolution logic executes in a verifiable, confidential environment.
* **Economic Security:** The system isolates risks and rewards per market, maintaining predictability.
* **EVM Compatibility:** Deployable on Hedera RPC endpoints with standard Ethereum tooling.

---

## Local Setup

```bash
# Install dependencies
npm install

# Run frontend
npm run dev

# Deploy contracts with Foundry
forge script scripts/Deploy.s.sol --rpc-url $HEDERA_RPC --broadcast
```

---

FutarFi is an experimental futarchy-driven prediction market designed to enable transparent, economically rational, and verifiable decision-making in decentralized systems.

---

## Notes & Disclaimer

* **Monorepo:** The project is organized as a monorepo containing frontend, backend/indexer, and smart contract packages for unified development and CI workflows.
* **Docker-compatible:** The development environment and deployment scripts are Docker-compatible. Use the provided `docker-compose.yml` to run the stack locally.
* **Not audited / Not production-ready:** This codebase has **not been audited** and is **not ready for production deployment**. Use only for prototyping and development purposes.
* **Event:** Built for **ETHGlobal 2025**.

Please treat this repository as a proof-of-concept. Security reviews, audits, and additional hardening are required before any real-value deployment.
