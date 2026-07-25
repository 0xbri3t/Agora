import {
  ProposalActivated,
  ProposalCancelled,
  ProposalResolved,
  TwapUpdated,
} from "../generated/templates/Proposal/Proposal";
import { Proposal, TwapPoint } from "../generated/schema";

export function handleProposalActivated(event: ProposalActivated): void {
  const proposal = Proposal.load(event.address.toHexString());
  if (proposal == null) return;
  proposal.status = "LIVE";
  proposal.liveStart = event.params.liveStart;
  proposal.liveEnd = event.params.liveEnd;
  proposal.save();
}

export function handleTwapUpdated(event: TwapUpdated): void {
  const id = event.address.toHexString();
  const proposal = Proposal.load(id);
  if (proposal == null) return;

  // Older Proposal deployments went Live without emitting ProposalActivated;
  // a TWAP push can only happen while Live, so catch up here.
  if (proposal.status == "AUCTION") proposal.status = "LIVE";
  proposal.twapYes = event.params.twapYes;
  proposal.twapNo = event.params.twapNo;
  proposal.save();

  const point = new TwapPoint(
    event.transaction.hash.toHexString() + "-" + event.logIndex.toString()
  );
  point.proposal = id;
  point.twapYes = event.params.twapYes;
  point.twapNo = event.params.twapNo;
  point.timestamp = event.params.at;
  point.save();
}

export function handleProposalResolved(event: ProposalResolved): void {
  const proposal = Proposal.load(event.address.toHexString());
  if (proposal == null) return;
  proposal.status = "RESOLVED";
  proposal.resolvedAt = event.params.when;
  // resolve() compares the last pushed TWAPs — mirror that decision here.
  if (proposal.twapYes.gt(proposal.twapNo)) proposal.winner = "YES";
  else if (proposal.twapNo.gt(proposal.twapYes)) proposal.winner = "NO";
  else proposal.winner = "TIE";
  proposal.save();
}

export function handleProposalCancelled(event: ProposalCancelled): void {
  const proposal = Proposal.load(event.address.toHexString());
  if (proposal == null) return;
  proposal.status = "CANCELLED";
  proposal.save();
}
