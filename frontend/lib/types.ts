import type { Address } from "viem"

export type ProposalPhase = "auction" | "market" | "failed"
export type ProposalStatus = "Auction" | "MarketLive" | "Resolved" | "Canceled"
export type MarketOption = "YES" | "NO"
export type TradeAction = "BUY" | "SELL"
export type OrderType = "market" | "limit"
export type OrderStatus = "pending" | "filled" | "cancelled"


export interface Proposal {
  id: string;
  admin: string;
  title: string;
  description: string;
  state: 'Auction' | 'Live' | 'Resolved' | 'Cancelled';

  // Auction / live times (timestamps in seconds)
  auctionStartTime: number;
  auctionEndTime: number;
  liveStart: number;
  liveEnd: number;
  liveDuration: number;

  // Token / treasury / auctions
  subjectToken: string;
  // pyUSD: `0x${string}`;
  minToOpen: string; // uint256 kept as string to avoid precision loss in JS
  maxCap: string;    // uint256 kept as string
  yesAuction: `0x${string}`;
  noAuction: `0x${string}`;
  yesToken: `0x${string}`;
  noToken: `0x${string}`;
  treasury: `0x${string}`;

  // Execution target and calldata
  target: `0x${string}`;
  data: string; // raw bytes (hex string)

  // Contract address (proposal instance)
  proposalAddress: `0x${string}`

  auctionData?: AuctionData
  marketData?: MarketData
}

export interface AuctionData {
  yesCurrentPrice: number
  noCurrentPrice: number
  yesTotalBids: bigint
  noTotalBids: bigint
  minimumRequired: bigint
  auctionEndTime: bigint
  priceHistory: AuctionPricePoint[]
  yesRemainingMintable: bigint
  noRemainingMintable: bigint
}

export interface AuctionPricePoint {
  timestamp: number
  yesPrice: number
  noPrice: number
}

export interface MarketData {
  yesOrderBook: OrderBookEntry[]
  noOrderBook: OrderBookEntry[]
  twapHistory: TWAPPoint[]
  // volumeDistribution: VolumePoint[]
}

export interface OrderBookEntry {
  price: number
  amount: number
  total: number
  side: "buy" | "sell"
  // Optional fill metadata for UI shading
  filled?: number
  remaining?: number
  fillPct?: number // 0..1
}

export interface TWAPPoint {
  timestamp: number
  yesTWAP: number
  noTWAP: number
}

export interface VolumePoint {
  price: number
  buyVolume: number
  sellVolume: number
}

export interface UserOrder {
  id: string
  market: MarketOption
  type: OrderType
  side: TradeAction
  price: number
  amount: number
  filled: number
  status: OrderStatus
  timestamp: number
}

export interface UserBalance {
  yesTokens: bigint
  noTokens: bigint
  collateral: bigint
}
