// Agora futarchy copilot — deterministic analytics over live market data.
//
// Data source: The Graph subgraph (SUBGRAPH_URL) when configured, with a Mongo
// fallback so the copilot also works on a local fork before the subgraph is
// deployed. All prices are USDC 6d per 1e18 outcome token (contract convention).
//
// The three insights mirror the protocol's economics:
//  - implied probability: TWAP(YES) vs TWAP(NO) — which world the market picks
//  - arbitrage: price(YES) + price(NO) must be <= 1 USDC. The AgoraComplement
//    SwapVM instruction enforces it per maker; the copilot watches it globally
//    across makers (buy-both < 1 and per-maker violations).
//  - TWAP trend: where the resolution metric is heading.

const ONE_USDC = 1_000_000n;

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

  return {
    title: proposal.title,
    status: proposal.status,
    winner: proposal.winner || null,
    liveEnd: proposal.liveEnd ? Number(proposal.liveEnd) : null,
    twapYes: BigInt(proposal.twapYes),
    twapNo: BigInt(proposal.twapNo),
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

/** Probability (basis points) that the proposal passes, from TWAPs or best asks. */
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
 * The invariant is price(YES) + price(NO) <= 1 USDC.
 * - buyBoth: cheapest YES + cheapest NO under 1 USDC across ALL makers means a
 *   risk-free basket (one of the two always redeems for 1).
 * - violations: a single maker quoting a pair that sums over 1 USDC is selling
 *   an overpriced book — exactly what the AgoraComplement instruction blocks
 *   at the VM level when armed.
 */
function detectArbitrage(data) {
  const result = { buyBoth: null, violations: [] };

  if (data.asksYes.length > 0 && data.asksNo.length > 0) {
    const sum = data.asksYes[0].price + data.asksNo[0].price;
    if (sum < ONE_USDC) {
      result.buyBoth = {
        askYes: data.asksYes[0].price.toString(),
        askNo: data.asksNo[0].price.toString(),
        edgeUsdc6d: (ONE_USDC - sum).toString(),
      };
    }
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
    if (noPrice !== undefined && yesPrice + noPrice > ONE_USDC) {
      result.violations.push({
        maker,
        askYes: yesPrice.toString(),
        askNo: noPrice.toString(),
        excessUsdc6d: (yesPrice + noPrice - ONE_USDC).toString(),
      });
    }
  }
  return result;
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
function summarize(data, probability, arbitrage, trend) {
  const lines = [];

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

  if (arbitrage.buyBoth) {
    lines.push(
      `Arbitrage: buying the cheapest YES (${fmtUsdc(arbitrage.buyBoth.askYes)} USDC) plus ` +
      `the cheapest NO (${fmtUsdc(arbitrage.buyBoth.askNo)} USDC) costs under 1 USDC — a ` +
      `risk-free ${fmtUsdc(arbitrage.buyBoth.edgeUsdc6d)} USDC edge per basket, since one side always redeems.`
    );
  }
  for (const v of arbitrage.violations) {
    lines.push(
      `Maker ${v.maker.slice(0, 10)}… quotes YES+NO at ${fmtUsdc(v.askYes)}+${fmtUsdc(v.askNo)} ` +
      `> 1 USDC (overpriced by ${fmtUsdc(v.excessUsdc6d)}) — the AgoraComplement VM instruction ` +
      `rejects exactly this when armed.`
    );
  }
  if (!arbitrage.buyBoth && arbitrage.violations.length === 0) {
    lines.push('No YES+NO pricing inconsistencies across makers right now.');
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
    summary: summarize(data, probability, arbitrage, trend),
  };
}

module.exports = {
  getInsights,
  fetchProposalData,
  // exported for unit tests
  impliedProbability,
  detectArbitrage,
  twapTrend,
  summarize,
};
