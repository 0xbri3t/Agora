# Futarchy-DeFi-Protocol
Futarchy-powered DeFi governance on Ethereum Sepolia: YES/NO markets trade as fill-or-kill lots on 1inch Aqua/SwapVM, with Pyth pull oracles and volume-weighted TWAP resolution.

Currently live on!: 
- [FutarFi landing page](https://www.futarfi.com)
- [Api docs](https://api.futarfi.com)

---

Developers: [Arnau Briet](@bri3t) & [Pau Gallego](@PauGallego)

Mentor: [Alex Arteaga](@alex-alra-arteaga)

---

## Introduction

FutarFi is a futarchy-driven prediction market on Ethereum Sepolia, where proposals become tradable YES/NO markets. Liquidity is bootstrapped via parallel Dutch auctions (2×→0) in which participants directly purchase the initial supply—no liquidity bots; continuous trading then runs fully on-chain on **1inch Aqua**: makers ship fill-or-kill lot quotes (funds stay in their wallets), takers fill them through the SwapVM router at exact prices, and cancels are a `dock`. A custom SwapVM instruction enforces the futarchy no-arbitrage invariant `price(YES) + price(NO) ≤ 1`. Resolution uses volume-weighted TWAPs computed from the on-chain fills and pushed by an attestor: the winning side captures value, while the losing side redeems its MarketTokens for underlying collateral (USDC) pro-rata, ensuring a deterministic unwind.

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
  
Once live, the market transitions to continuous on-chain trading on 1inch Aqua, leveraging the auction’s depth and reference price to deliver tighter spreads, better fills, and a cleaner signal for TWAP-based settlement later on.

---

## System Flow
![System Flow](https://github.com/user-attachments/assets/22721499-0fdf-4c89-bddd-fa4eb14acbb8)

---

## Design Decisions

- **Ethereum Sepolia:** Home of the live 1inch Aqua deployment; full Foundry/Viem/Wagmi tooling.
- **Pyth:** Used exclusively to fetch the **initial price** of the subject token at market creation. Continuous update models are not implemented.
- **Dutch Auction for Liquidity:** Ensures fair and balanced initial market capitalization.
- **Aqua Lot Trading:** Post-auction price discovery runs on 1inch Aqua/SwapVM — self-custodial fill-or-kill lots, exact prices, on-chain settlement.
- **Market Tokens as Rewards:** Winners receive OPTIONS tokens bought with the treasury; losers can claim proportional treasury.
- **TWAP Resolution:** An attestor pushes volume-weighted TWAPs computed from the on-chain Aqua fills; `Proposal.resolve()` settles from those values.

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

3. **Aqua Trading Phase**
   - After the liquidity phase, trading moves to **1inch Aqua**: makers ship fill-or-kill lot quotes for **YES/NO tokens**, takers fill them through the SwapVM router.
   - Funds stay in maker wallets until fill time; every trade settles on-chain at an exact price.

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
* The **backend** indexes Aqua events (`Shipped`/`Swapped`/`Docked`) into the order book and pushes volume-weighted TWAPs on-chain as attestor.


---

## Technical Highlights

* **Proposal Parameters:** Each market defines min supply, cap, and optional executable logic.
* **Market-Specific Tokens:** Each market mints unique YES/NO tokens tied to that instance.
* **On-chain Settlement:** Every trade is an on-chain Aqua fill; resolution reads TWAPs computed from those fills.
* **Economic Security:** The system isolates risks and rewards per market, maintaining predictability.
* **EVM Compatibility:** Standard Ethereum tooling (Foundry, wagmi/viem, ethers).

---

## Local Setup

```bash
# One command: MongoDB + anvil (Sepolia fork with live Aqua) + contracts + backend + frontend
./dev.sh

# Stop / status / logs / fresh DB
./dev.sh stop | status | logs [svc] | reset
```

Requirements: Docker, Foundry, Node, pnpm. Set `SEPOLIA_RPC_URL` in `blockend/.env`.

---

FutarFi is an experimental futarchy-driven prediction market designed to enable transparent, economically rational, and verifiable decision-making in decentralized systems.

---

## 1inch Aqua / SwapVM Integration (ETHGlobal Lisbon 2026)

FutarFi's continuous-trading layer is being re-built on **1inch Aqua + SwapVM**: maker quotes become fill-or-kill lot strategies shipped to the live Aqua core, and fills execute on-chain through a `LimitSwapVMRouter`. Maker funds never leave their wallet (Aqua self-custody); shipped virtual balances encode each lot's exact price and size; cancel = `dock`. A **custom SwapVM instruction** (via the `_extruction` opcode) enforces the futarchy no-arbitrage invariant `price(YES) + price(NO) <= 1 USDC` at VM execution time.

### Deployed contracts (Sepolia)

| Contract | Address | Notes |
|---|---|---|
| Aqua core (1inch, official) | [`0x499943E74FB0cE105688beeE8Ef2ABec5D936d31`](https://sepolia.etherscan.io/address/0x499943E74FB0cE105688beeE8Ef2ABec5D936d31) | Not redeployed — we ship/dock/pull/push against it |
| LimitSwapVMRouter (our deployment) | [`0x4CF2713D08C5E439409b56efA4027F25EB0F6431`](https://sepolia.etherscan.io/address/0x4CF2713D08C5E439409b56efA4027F25EB0F6431) | Official SwapVM code; the canonical Sepolia router lacks limit opcodes |
| FutarFiQuoteBuilder | [`0xc651dDD1DAeC92Af51B32bA381e48Ac975a3b2D1`](https://sepolia.etherscan.io/address/0xc651dDD1DAeC92Af51B32bA381e48Ac975a3b2D1) | On-chain program/order/taker-data encoder |
| MockUSDC (demo) | [`0x34ad23A27Ae8A562928234D4415eD7225a44bB2E`](https://sepolia.etherscan.io/address/0x34ad23A27Ae8A562928234D4415eD7225a44bB2E) | 6-decimals demo collateral |

### Live demo transactions (Sepolia)

1. **Ship** lot (sell 10 YES @ 0.40 USDC — maker YES balance unchanged, Aqua custody): [`0xd54a216d…`](https://sepolia.etherscan.io/tx/0xd54a216dc514ce91081c63d2c5cdc8dc06bff776c7b80c1d30140999b3953ea6)
2. **Fill** lot exactly (taker pays 4 USDC, receives 10 YES; `Pulled`/`Pushed`/`Swapped` events): [`0x8ae074f2…`](https://sepolia.etherscan.io/tx/0x8ae074f2c3620f64bbfe8dbdbd6232079920a3c8daeb61565101b76e20850147)
3. **Ship** second lot (5 YES @ 0.55): [`0x6e967445…`](https://sepolia.etherscan.io/tx/0x6e967445b4f49c6e9a55656470a3311c0c41f3d6dd8d98914669a6f6ef2e76bc)
4. **Cancel** via `dock`: [`0xaf04e8cb…`](https://sepolia.etherscan.io/tx/0xaf04e8cbf15e487a528b472fff600a31a4223bb99a5c993a129f11c1b62e10ae)

### Where the integration lives

- `blockend/src/aqua/FutarFiQuoteBuilder.sol` — builds lot programs (`_limitSwapOnlyFull1D` + `_salt`) with 1inch's own `ProgramBuilder`; Aqua-mode orders via `MakerTraitsLib`; `buildQuote`/`buildTakerData` view encoders for the backend
- `blockend/src/aqua/FutarFiComplement.sol` — **custom SwapVM instruction** (`IExtruction`/`IStaticExtruction`) rejecting fills when `YES + NO > 1 USDC`
- `blockend/test/aqua/` — Foundry suites vs the real Sepolia Aqua core (fork): lot lifecycle E2E, complement guard, quote/swap consistency
- `backend/src/services/aquaClient.js` — ship/fill/cancel from Node (all encoding via on-chain builder, no local bit-packing)
- `backend/src/services/aquaOrderbookService.js` — indexes `Shipped`/`Swapped`/`Docked` into the existing Mongo order book
- `backend/scripts/demo/` — the demo scripts used for the transactions above

Run tests: `cd blockend && forge test --match-path "test/aqua/*"` (needs `SEPOLIA_RPC_URL`) · `cd backend && npm test`

---

## Notes & Disclaimer

* **Monorepo:** The project is organized as a monorepo containing frontend, backend/indexer, and smart contract packages for unified development and CI workflows.
* **Docker-compatible:** The development environment and deployment scripts are Docker-compatible. Use the provided `docker-compose.yml` to run the stack locally.
* **Not audited / Not production-ready:** This codebase has **not been audited** and is **not ready for production deployment**. Use only for prototyping and development purposes.
* **Event:** Built for **ETHGlobal 2025**.

Please treat this repository as a proof-of-concept. Security reviews, audits, and additional hardening are required before any real-value deployment.
