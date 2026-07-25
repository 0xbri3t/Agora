// Agora futarchy copilot — deterministic analytics over live market data.
//
// Data source: The Graph subgraph (SUBGRAPH_URL) when configured, with a Mongo
// fallback so the copilot also works on a local fork before the subgraph is
// deployed. All prices are USDC 6d per 1e18 outcome token (contract convention).
//
// The three insights mirror the protocol's economics:
//  - implied probability: TWAP(YES) vs TWAP(NO) — which world the market picks
//  - dispersion: outcome tokens price the subject asset in each world (a
//    forecast, not a probability), so the copilot reads the spread between the
//    two sides and flags makers quoting them far apart — the same behaviour the
//    AgoraComplement SwapVM instruction rejects at fill time.
//  - TWAP trend: where the resolution metric is heading.

// How far a single maker's two forecasts may sit apart before the copilot
// calls it out; mirrors the bound the AgoraComplement instruction enforces.
const MAX_MAKER_DIVERGENCE_BPS = 2000; // 20%

// ---------------------------------------------------------------------------
// Data fetching
// ---------------------------------------------------------------------------

const INSIGHTS_QUERY = `
query CopilotData($proposalId: BigInt!) {
  proposals(where: { proposalId: $proposalId }) {
    id
    proposalId
    title
    status
    twapYes
    twapNo
    winner
    liveEnd
    yesMarket { id }
    noMarket { id }
    markets {
      side
      volumeUsdc
      lastPrice
      auction {
        clearingPrice
        bidCount
        totalBidAmount
        bids(orderBy: maxPrice, orderDirection: desc, first: 50) {
          bidder
          maxPrice
          amount
        }
      }
      quotes(where: { status: OPEN }, orderBy: price, orderDirection: asc, first: 50) {
        maker { id }
        price
        lotUsdc
        lotToken
      }
      fills(orderBy: timestamp, orderDirection: desc, first: 50) {
        price
        amountUsdc
        timestamp
      }
    }
    twapHistory(orderBy: timestamp, orderDirection: asc, first: 100) {
      twapYes
      twapNo
      timestamp
    }
  }
}`;

async function fetchFromSubgraph(subgraphUrl, proposalId) {
  const res = await fetch(subgraphUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: INSIGHTS_QUERY, variables: { proposalId: String(proposalId) } }),
  });
  if (!res.ok) throw new Error(`subgraph responded ${res.status}`);
  const { data, errors } = await res.json();
  if (errors) throw new Error(`subgraph errors: ${JSON.stringify(errors)}`);
  const proposal = data.proposals && data.proposals[0];
  if (!proposal) return null;

  const bySide = (side) => proposal.markets.find((m) => m.side === side) || null;
  const marketAsks = (m) => (m ? m.quotes.map((q) => ({
    maker: q.maker.id,
    price: BigInt(q.price),
    lotToken: BigInt(q.lotToken),
  })) : []);
  const marketFills = (m) => (m ? m.fills.map((f) => ({
    price: BigInt(f.price),
    amountUsdc: BigInt(f.amountUsdc),
    timestamp: Number(f.timestamp),
  })) : []);
  const yes = bySide('YES');
  const no = bySide('NO');
  const marketAuction = (m) => (m && m.auction ? {
    clearingPrice: BigInt(m.auction.clearingPrice),
    bidCount: Number(m.auction.bidCount),
    totalBidAmount: BigInt(m.auction.totalBidAmount),
    bids: m.auction.bids.map((b) => ({
      bidder: b.bidder,
      maxPrice: BigInt(b.maxPrice),
      amount: BigInt(b.amount),
    })),
  } : null);

  return {
    title: proposal.title,
    status: proposal.status,
    winner: proposal.winner || null,
    liveEnd: proposal.liveEnd ? Number(proposal.liveEnd) : null,
    twapYes: BigInt(proposal.twapYes),
    twapNo: BigInt(proposal.twapNo),
    auctionYes: marketAuction(yes),
    auctionNo: marketAuction(no),
    asksYes: marketAsks(yes),
    asksNo: marketAsks(no),
    fillsYes: marketFills(yes),
    fillsNo: marketFills(no),
    volumeUsdc: BigInt(yes ? yes.volumeUsdc : 0) + BigInt(no ? no.volumeUsdc : 0),
    twapHistory: proposal.twapHistory.map((p) => ({
      twapYes: BigInt(p.twapYes),
      twapNo: BigInt(p.twapNo),
      timestamp: Number(p.timestamp),
    })),
  };
}

async function fetchFromMongo(proposalId) {
  const Proposal = require('../models/Proposal');
  const Order = require('../models/Order');

  const doc = await Proposal.findOne({
    $or: [{ id: proposalId }, { proposalContractId: String(proposalId) }],
  }).lean();
  if (!doc) return null;

  const orders = await Order.find({ proposalId: String(proposalId) }).lean();
  const asks = (side) => orders
    .filter((o) => o.side === side && o.status === 'open' && o.price)
    .map((o) => ({ maker: o.userAddress, price: BigInt(o.price), lotToken: BigInt(o.amount) }))
    .sort((a, b) => (a.price < b.price ? -1 : a.price > b.price ? 1 : 0));
  const fills = (side) => orders
    .filter((o) => o.side === side)
    .flatMap((o) => (o.fills || []).map((f) => ({
      price: BigInt(f.price),
      amountUsdc: (BigInt(f.price) * BigInt(f.amount)) / 10n ** 18n,
      timestamp: f.timestamp ? Math.floor(new Date(f.timestamp).getTime() / 1000) : 0,
    })))
    .sort((a, b) => b.timestamp - a.timestamp);

  return {
    title: doc.title,
    status: doc.state ? doc.state.toUpperCase() : 'UNKNOWN',
    winner: null,
    liveEnd: doc.endTime ? Number(doc.endTime) : null,
    twapYes: 0n, // TWAPs live on-chain / in the subgraph, not in Mongo
    twapNo: 0n,
    auctionYes: null, // auction detail only exists in the subgraph
    auctionNo: null,
    asksYes: asks('approve'),
    asksNo: asks('reject'),
    fillsYes: fills('approve'),
    fillsNo: fills('reject'),
    volumeUsdc: null,
    twapHistory: [],
  };
}

/** Fetch normalized market data; prefers the subgraph, falls back to Mongo. */
async function fetchProposalData(proposalId) {
  const subgraphUrl = process.env.SUBGRAPH_URL;
  if (subgraphUrl) {
    const data = await fetchFromSubgraph(subgraphUrl, proposalId);
    if (data) return { source: 'subgraph', data };
  }
  const data = await fetchFromMongo(proposalId);
  return data ? { source: 'mongo', data } : null;
}

// ---------------------------------------------------------------------------
// Analytics (pure — unit tested)
// ---------------------------------------------------------------------------

/**
 * How the market values the YES world relative to both, in basis points.
 * These are forecasts of the subject asset, so this is a relative valuation
 * (a 6000 reading means YES is priced 1.5x the NO world), not a probability.
 */
function impliedProbability(data) {
  let yes = data.twapYes;
  let no = data.twapNo;
  let basis = 'twap';
  if (yes === 0n && no === 0n) {
    if (data.asksYes.length === 0 || data.asksNo.length === 0) return null;
    yes = data.asksYes[0].price;
    no = data.asksNo[0].price;
    basis = 'best asks';
  }
  if (yes + no === 0n) return null;
  return { bps: Number((yes * 10000n) / (yes + no)), basis };
}

/**
 * Agora prices are FORECASTS of the subject asset in each world, not
 * probabilities, so there is no YES + NO = 1 identity to arbitrage. What the
 * copilot watches instead is dispersion, because resolution compares
 * TWAP(YES) against TWAP(NO):
 * - spread: how far apart the two sides' best forecasts sit, and which world
 *   the book currently says is worth more.
 * - outliers: a maker quoting both sides far apart from each other can swing
 *   that comparison cheaply — the same behaviour the AgoraComplement VM
 *   instruction rejects at fill time when a maker arms it.
 */
function detectArbitrage(data) {
  const result = { spread: null, violations: [] };

  if (data.asksYes.length > 0 && data.asksNo.length > 0) {
    const yesPrice = data.asksYes[0].price;
    const noPrice = data.asksNo[0].price;
    const low = yesPrice < noPrice ? yesPrice : noPrice;
    const high = yesPrice < noPrice ? noPrice : yesPrice;
    result.spread = {
      askYes: yesPrice.toString(),
      askNo: noPrice.toString(),
      gapUsdc6d: (high - low).toString(),
      gapBps: low === 0n ? null : Number(((high - low) * 10000n) / low),
      leading: yesPrice > noPrice ? 'YES' : yesPrice < noPrice ? 'NO' : 'TIED',
    };
  }

  const minBy = (asks) => {
    const map = new Map();
    for (const a of asks) {
      const prev = map.get(a.maker);
      if (prev === undefined || a.price < prev) map.set(a.maker, a.price);
    }
    return map;
  };
  const yesByMaker = minBy(data.asksYes);
  const noByMaker = minBy(data.asksNo);
  for (const [maker, yesPrice] of yesByMaker) {
    const noPrice = noByMaker.get(maker);
    if (noPrice === undefined) continue;
    const low = yesPrice < noPrice ? yesPrice : noPrice;
    const high = yesPrice < noPrice ? noPrice : yesPrice;
    if (low === 0n) continue;
    const gapBps = Number(((high - low) * 10000n) / low);
    if (gapBps > MAX_MAKER_DIVERGENCE_BPS) {
      result.violations.push({
        maker,
        askYes: yesPrice.toString(),
        askNo: noPrice.toString(),
        gapBps,
      });
    }
  }
  return result;
}

/**
 * Read the bootstrap phase: which side the Uniswap CCAs are pricing higher,
 * how committed the bidders are, and whether demand is concentrated.
 * Returns null once trading has taken over (or with no auction data).
 */
function auctionSignal(data) {
  const yes = data.auctionYes;
  const no = data.auctionNo;
  if (!yes || !no) return null;
  if (yes.bidCount === 0 && no.bidCount === 0) return null;

  const total = yes.totalBidAmount + no.totalBidAmount;
  // Share of committed capital backing YES, in basis points
  const yesShareBps = total === 0n ? null : Number((yes.totalBidAmount * 10000n) / total);

  // Concentration: how much of a side's capital sits in its single largest bid
  const topShare = (side) => {
    if (side.bids.length === 0 || side.totalBidAmount === 0n) return null;
    const top = side.bids.reduce((max, b) => (b.amount > max ? b.amount : max), 0n);
    return Number((top * 10000n) / side.totalBidAmount);
  };

  return {
    clearingYes: yes.clearingPrice.toString(),
    clearingNo: no.clearingPrice.toString(),
    bidsYes: yes.bidCount,
    bidsNo: no.bidCount,
    committedUsdc: total.toString(),
    yesShareBps,
    concentrationYesBps: topShare(yes),
    concentrationNoBps: topShare(no),
    leaning: yesShareBps === null ? null : yesShareBps > 5500 ? 'YES' : yesShareBps < 4500 ? 'NO' : 'BALANCED',
  };
}

/** Direction of the YES-vs-NO TWAP spread over the recorded history. */
function twapTrend(data) {
  const history = data.twapHistory;
  if (history.length < 2) return null;
  const spread = (p) => p.twapYes - p.twapNo; // positive -> YES ahead
  const first = spread(history[0]);
  const last = spread(history[history.length - 1]);
  const delta = last - first;
  return {
    direction: delta > 0n ? 'toward YES' : delta < 0n ? 'toward NO' : 'flat',
    leading: last > 0n ? 'YES' : last < 0n ? 'NO' : 'TIED',
    spreadNow: last.toString(),
    spreadDelta: delta.toString(),
    points: history.length,
  };
}

const fmtUsdc = (v) => (Number(BigInt(v)) / 1e6).toFixed(2);

/** Compose the numbers into the copilot's plain-language reading. */
function summarize(data, probability, arbitrage, trend, auction) {
  const lines = [];

  if (data.status === 'AUCTION' && auction) {
    lines.push(
      `Bootstrap phase: ${auction.bidsYes + auction.bidsNo} bids across both Uniswap auctions have ` +
      `committed ${fmtUsdc(auction.committedUsdc)} USDC` +
      (auction.leaning && auction.leaning !== 'BALANCED'
        ? `, leaning ${auction.leaning} (${(auction.yesShareBps / 100).toFixed(0)}% of capital).`
        : ', split roughly evenly between YES and NO.')
    );
    const concentrated = Math.max(auction.concentrationYesBps || 0, auction.concentrationNoBps || 0);
    if (concentrated > 8000) {
      lines.push(
        `Watch out: one bid alone accounts for ${(concentrated / 100).toFixed(0)}% of a side's capital, ` +
        `so the signal rests on a single participant.`
      );
    }
  }

  if (probability) {
    lines.push(
      `The market prices "${data.title}" at a ${(probability.bps / 100).toFixed(1)}% ` +
      `chance of passing (from ${probability.basis}).`
    );
  } else {
    lines.push(`Not enough market data yet to price "${data.title}".`);
  }

  if (trend) {
    lines.push(
      trend.leading === 'TIED'
        ? 'The TWAP race is currently tied.'
        : `${trend.leading} is leading on TWAP and the spread is moving ${trend.direction} ` +
          `(${trend.points} attestations).`
    );
  }

  if (arbitrage.spread && arbitrage.spread.leading !== 'TIED') {
    lines.push(
      `The book forecasts ${fmtUsdc(arbitrage.spread.askYes)} USDC per token if it passes versus ` +
      `${fmtUsdc(arbitrage.spread.askNo)} if it does not — ${arbitrage.spread.leading} ahead by ` +
      `${fmtUsdc(arbitrage.spread.gapUsdc6d)} USDC` +
      (arbitrage.spread.gapBps === null ? '.' : ` (${(arbitrage.spread.gapBps / 100).toFixed(1)}%).`)
    );
  }
  for (const v of arbitrage.violations) {
    lines.push(
      `Maker ${v.maker.slice(0, 10)}… quotes the two worlds ${(v.gapBps / 100).toFixed(0)}% apart ` +
      `(${fmtUsdc(v.askYes)} vs ${fmtUsdc(v.askNo)} USDC) — wide enough to swing the TWAP comparison ` +
      `cheaply, and exactly what the AgoraComplement VM instruction rejects when armed.`
    );
  }
  if (arbitrage.violations.length === 0 && arbitrage.spread) {
    lines.push('No maker is quoting the two worlds far apart right now.');
  }

  if (data.status === 'RESOLVED' && data.winner) {
    lines.push(`This proposal is resolved: ${data.winner} won.`);
  }

  return lines.join(' ');
}

/** Full insight bundle for a proposal, or null if unknown. */
async function getInsights(proposalId) {
  const fetched = await fetchProposalData(proposalId);
  if (!fetched) return null;
  const { source, data } = fetched;

  const probability = impliedProbability(data);
  const arbitrage = detectArbitrage(data);
  const trend = twapTrend(data);
  const auction = auctionSignal(data);

  return {
    source,
    proposal: {
      title: data.title,
      status: data.status,
      winner: data.winner,
      liveEnd: data.liveEnd,
      twapYes: data.twapYes.toString(),
      twapNo: data.twapNo.toString(),
      volumeUsdc: data.volumeUsdc === null ? null : data.volumeUsdc.toString(),
      openAsksYes: data.asksYes.length,
      openAsksNo: data.asksNo.length,
      bestAskYes: data.asksYes.length ? data.asksYes[0].price.toString() : null,
      bestAskNo: data.asksNo.length ? data.asksNo[0].price.toString() : null,
    },
    impliedProbability: probability,
    arbitrage,
    trend,
    auction,
    summary: summarize(data, probability, arbitrage, trend, auction),
  };
}

module.exports = {
  getInsights,
  fetchProposalData,
  // exported for unit tests
  impliedProbability,
  detectArbitrage,
  twapTrend,
  auctionSignal,
  summarize,
};
