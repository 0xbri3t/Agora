import { Address, BigInt } from "@graphprotocol/graph-ts";
import { ProposalCreated } from "../generated/ProposalManager/ProposalManager";
import { Proposal as ProposalContract } from "../generated/ProposalManager/Proposal";
import { CCAuction as CCAuctionContract } from "../generated/ProposalManager/CCAuction";
import { CCAuction as CCAuctionTemplate, Proposal as ProposalTemplate } from "../generated/templates";
import { Auction, Market, Proposal } from "../generated/schema";
import { q96ToPrice6d } from "./helpers";

export function handleProposalCreated(event: ProposalCreated): void {
  const address = event.params.proposal;
  const id = address.toHexString();

  const proposal = new Proposal(id);
  proposal.proposalId = event.params.id;
  proposal.address = address;
  proposal.admin = event.params.admin;
  proposal.title = event.params.title;
  proposal.status = "AUCTION";
  proposal.createdAt = event.block.timestamp;
  proposal.createdAtBlock = event.block.number;
  proposal.twapYes = BigInt.zero();
  proposal.twapNo = BigInt.zero();

  // Outcome tokens are minted during initialize, so they exist by the time
  // ProposalCreated fires — read them (and the description) off the contract.
  const contract = ProposalContract.bind(address);
  const description = contract.try_description();
  proposal.description = description.reverted ? "" : description.value;

  const yesToken = contract.try_yesToken();
  const noToken = contract.try_noToken();
  if (!yesToken.reverted) {
    const market = new Market(yesToken.value.toHexString());
    market.proposal = id;
    market.side = "YES";
    market.token = yesToken.value;
    market.volumeUsdc = BigInt.zero();
    market.fillCount = 0;
    market.openQuoteCount = 0;
    market.save();
    proposal.yesMarket = market.id;

    const auction = contract.try_yesAuction();
    if (!auction.reverted) market.auction = createAuction(auction.value, id, market.id, "YES");
    market.save();
  }
  if (!noToken.reverted) {
    const market = new Market(noToken.value.toHexString());
    market.proposal = id;
    market.side = "NO";
    market.token = noToken.value;
    market.volumeUsdc = BigInt.zero();
    market.fillCount = 0;
    market.openQuoteCount = 0;
    market.save();
    proposal.noMarket = market.id;

    const auction = contract.try_noAuction();
    if (!auction.reverted) market.auction = createAuction(auction.value, id, market.id, "NO");
    market.save();
  }

  proposal.save();

  // Track this proposal's lifecycle events (activation, TWAPs, resolution).
  ProposalTemplate.create(address);
}

/** Index a proposal's Uniswap CCA and start tracking its bids. */
function createAuction(address: Address, proposalId: string, marketId: string, side: string): string {
  const id = address.toHexString();
  const auction = new Auction(id);
  auction.proposal = proposalId;
  auction.market = marketId;
  auction.side = side;
  auction.bidCount = 0;
  auction.totalBidAmount = BigInt.zero();

  const clearing = CCAuctionContract.bind(address).try_clearingPrice();
  auction.clearingPrice = clearing.reverted ? BigInt.zero() : q96ToPrice6d(clearing.value);
  auction.save();

  CCAuctionTemplate.create(address);
  return id;
}
