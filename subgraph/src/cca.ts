import { BigInt } from "@graphprotocol/graph-ts";
import {
  BidExited,
  BidSubmitted,
  ClearingPriceUpdated,
  TokensClaimed,
} from "../generated/templates/CCAuction/CCAuction";
import { Auction, Bid } from "../generated/schema";
import { q96ToPrice6d } from "./helpers";

function bidKey(auctionId: string, bidId: BigInt): string {
  return auctionId + "-" + bidId.toString();
}

export function handleBidSubmitted(event: BidSubmitted): void {
  const auctionId = event.address.toHexString();
  const auction = Auction.load(auctionId);
  if (auction == null) return;

  const bid = new Bid(bidKey(auctionId, event.params.id));
  bid.auction = auctionId;
  bid.bidder = event.params.owner;
  bid.bidId = event.params.id;
  bid.maxPrice = q96ToPrice6d(event.params.priceQ96);
  bid.amount = event.params.amount;
  bid.exited = false;
  bid.claimed = false;
  bid.createdAt = event.block.timestamp;
  bid.txHash = event.transaction.hash;
  bid.save();

  auction.bidCount = auction.bidCount + 1;
  auction.totalBidAmount = auction.totalBidAmount.plus(event.params.amount);
  auction.save();
}

export function handleBidExited(event: BidExited): void {
  const bid = Bid.load(bidKey(event.address.toHexString(), event.params.bidId));
  if (bid == null) return;
  bid.exited = true;
  bid.tokensFilled = event.params.tokensFilled;
  bid.currencyRefunded = event.params.currencyRefunded;
  bid.save();
}

export function handleTokensClaimed(event: TokensClaimed): void {
  const bid = Bid.load(bidKey(event.address.toHexString(), event.params.bidId));
  if (bid == null) return;
  bid.claimed = true;
  bid.tokensFilled = event.params.tokensFilled;
  bid.save();
}

export function handleClearingPriceUpdated(event: ClearingPriceUpdated): void {
  const auction = Auction.load(event.address.toHexString());
  if (auction == null) return;
  auction.clearingPrice = q96ToPrice6d(event.params.clearingPriceQ96);
  auction.save();
}
