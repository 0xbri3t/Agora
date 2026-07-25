// OrderBook rebuild service (from DB Orders)
// - Aggregates open/partial orders into bids/asks per proposal side
// - Updates OrderBook collection with basic market stats
// Comments simple in English

const Order = require('../models/Order');
const OrderBook = require('../models/OrderBook');

function sumStr(a, b) {
  try { return (BigInt(a) + BigInt(b)).toString(); } catch (_) { return String(Number(a) + Number(b)); }
}

function groupLevels(orders) {
  const map = new Map();
  for (const o of orders) {
    const key = String(o.price);
    const prev = map.get(key) || { price: key, amount: '0', orderCount: 0 };
    prev.amount = sumStr(prev.amount, o.amount);
    prev.orderCount += 1;
    map.set(key, prev);
  }
  return Array.from(map.values());
}

async function calcLastPrice(proposalId, side) {
  const last = await Order.findOne({ proposalId, side, filledAmount: { $gt: '0' } }).sort({ updatedAt: -1 });
  return last?.price || '0';
}

async function calc24hVolume(proposalId, side) {
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const list = await Order.find({ proposalId, side, updatedAt: { $gte: since }, filledAmount: { $gt: '0' } }).select('filledAmount');
  let total = BigInt(0);
  for (const r of list) {
    try { total += BigInt(r.filledAmount || '0'); } catch (_) {}
  }
  return total.toString();
}

function sortBids(levels) {
  return levels.sort((a, b) => Number(b.price) - Number(a.price));
}
function sortAsks(levels) {
  return levels.sort((a, b) => Number(a.price) - Number(b.price));
}

async function rebuildOrderBookForProposal(proposalId) {
  const sides = ['approve', 'reject'];
  for (const side of sides) {
    // bids: buy orders; asks: sell orders
    const [bidOrders, askOrders] = await Promise.all([
      Order.find({ proposalId, side, status: { $in: ['open', 'partial'] }, orderExecution: 'limit', orderType: 'buy' }).select('price amount'),
      Order.find({ proposalId, side, status: { $in: ['open', 'partial'] }, orderExecution: 'limit', orderType: 'sell' }).select('price amount')
    ]);

    const bids = sortBids(groupLevels(bidOrders));
    const asks = sortAsks(groupLevels(askOrders));

    const [lastPrice, volume24h] = await Promise.all([
      calcLastPrice(proposalId, side),
      calc24hVolume(proposalId, side)
    ]);

    await OrderBook.findOneAndUpdate(
      { proposalId, side },
      {
        $set: {
          bids, asks,
          lastPrice: lastPrice || '0',
          volume24h: volume24h || '0',
          // Keep other stats as-is unless you want to recompute here
          updatedAt: new Date()
        }
      },
      { upsert: true, new: true }
    );
  }
}

async function rebuildAllOrderBooks() {
  const Proposal = require('../models/Proposal');
  const list = await Proposal.find().select('id');
  for (const p of list) {
    await rebuildOrderBookForProposal(String(p.id));
  }
}

module.exports = {
  rebuildOrderBookForProposal,
  rebuildAllOrderBooks
};
