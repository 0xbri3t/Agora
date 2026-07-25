// Bridges Aqua/SwapVM on-chain events into the existing Mongo order-book models.
// Shipped -> open Order | Swapped -> filled (lots are fill-or-kill) | Docked -> cancelled.
// Comments simple in English
const { ethers } = require('ethers');
const Order = require('../models/Order');
const { updateOrderBook } = require('../routes/orderbooks');
const { AQUA_ABI, ROUTER_ABI } = require('./aquaClient');
const defaultCfg = require('../config/aqua');

const aquaIface = new ethers.Interface(AQUA_ABI);
const routerIface = new ethers.Interface(ROUTER_ABI);

// outcomeToken (lowercase) -> { proposalId, side } ('approve' | 'reject')
const marketRegistry = new Map();

function registerMarket(outcomeToken, { proposalId, side }) {
  marketRegistry.set(outcomeToken.toLowerCase(), { proposalId: String(proposalId), side });
}

function lookupMarket(outcomeToken) {
  return marketRegistry.get(String(outcomeToken).toLowerCase()) || null;
}

/// Decode a ship() tx input into lot terms. Returns null if not our USDC pair.
function decodeShipCalldata(txInput, usdcAddress) {
  const decoded = aquaIface.decodeFunctionData('ship', txInput);
  const tokens = decoded.tokens.map((t) => t.toLowerCase());
  const amounts = decoded.amounts.map((a) => BigInt(a));
  const usdcIdx = tokens.indexOf(usdcAddress.toLowerCase());
  if (usdcIdx === -1 || tokens.length !== 2) return null;
  const tokenIdx = 1 - usdcIdx;

  const lotUsdc = amounts[usdcIdx];
  const lotToken = amounts[tokenIdx];
  if (lotToken === 0n) return null;

  return {
    outcomeToken: decoded.tokens[tokenIdx],
    lotUsdc,
    lotToken,
    // USDC (6d) per 1e18 outcome token
    priceUsdcPerToken: (lotUsdc * 10n ** 18n) / lotToken,
  };
}

/// Shipped(maker, app, strategyHash, strategy): create an open sell Order.
/// Needs the tx calldata for amounts (the event doesn't carry them).
async function processShippedEvent(evt, { provider, cfg } = {}) {
  const c = cfg || defaultCfg;
  const [maker, app, strategyHash] = [evt.args[0], evt.args[1], evt.args[2]];
  if (app.toLowerCase() !== c.routerAddress.toLowerCase()) return null;

  const tx = await provider.getTransaction(evt.transactionHash);
  const lot = decodeShipCalldata(tx.data, c.usdcAddress);
  if (!lot) return null;

  const market = lookupMarket(lot.outcomeToken);
  if (!market) return null; // unknown market token -> ignore

  // Idempotent: the polling sweep and the live subscription can both deliver
  // the same Shipped — one order per strategyHash, ever.
  const existing = await Order.findOne({ strategyHash });
  if (existing) return existing;

  const order = await Order.create({
    proposalId: market.proposalId,
    side: market.side,
    orderType: 'sell',
    orderExecution: 'limit',
    price: lot.priceUsdcPerToken.toString(),
    amount: lot.lotToken.toString(),
    userAddress: maker,
    status: 'open',
    strategyHash,
    txHash: evt.transactionHash,
  });

  await updateOrderBook(market.proposalId, market.side);
  return order;
}

/// Swapped(orderHash, ...): lots are fill-or-kill -> mark fully filled.
async function processSwappedEvent(evt) {
  const orderHash = evt.args[0];
  const amountIn = BigInt(evt.args[5]);
  const amountOut = BigInt(evt.args[6]);

  const order = await Order.findOne({ strategyHash: orderHash });
  if (!order) return null;
  if (order.status === 'filled') return order; // subscription + sweep overlap

  order.status = 'filled';
  order.filledAmount = amountOut.toString();
  order.executedPrice = order.price;
  order.fills.push({
    price: order.price,
    amount: amountOut.toString(),
    timestamp: new Date(),
    txHash: evt.transactionHash,
    timestampExecuted: new Date(),
    isExecuted: true,
  });
  await order.save();

  // Feed the candle chart: every Aqua fill is a real trade print.
  try {
    const PriceHistory = require('../models/PriceHistory');
    await PriceHistory.create({
      proposalId: order.proposalId,
      side: order.side,
      price: order.price,
      volume: amountOut.toString(),
      timestamp: new Date(),
    });
  } catch (e) {
    console.error('PriceHistory fill write error:', e.message);
  }

  await updateOrderBook(order.proposalId, order.side);
  return order;
}

/// Docked(maker, app, strategyHash): cancel if still open.
async function processDockedEvent(evt) {
  const strategyHash = evt.args[2];
  const order = await Order.findOne({ strategyHash });
  if (!order || order.status === 'filled') return order;

  order.status = 'cancelled';
  await order.save();

  await updateOrderBook(order.proposalId, order.side);
  return order;
}

/// Load live proposals' markets from Mongo (survives restarts).
async function loadMarketsFromDb() {
  const Proposal = require('../models/Proposal');
  const live = await Proposal.find({ state: 'live' }).select('id yesToken noToken').lean();
  for (const p of live) {
    if (p.yesToken) registerMarket(p.yesToken, { proposalId: String(p.id), side: 'approve' });
    if (p.noToken) registerMarket(p.noToken, { proposalId: String(p.id), side: 'reject' });
  }
  return live.length;
}

/// Subscribe to live events (used at server startup).
function startAquaListener({ provider, cfg } = {}) {
  loadMarketsFromDb()
    .then((n) => n && console.log(`Aqua markets loaded from DB: ${n} live proposals`))
    .catch((e) => console.error('loadMarketsFromDb error:', e.message));
  const c = cfg || defaultCfg;
  const aqua = new ethers.Contract(c.aquaAddress, AQUA_ABI, provider);
  const router = new ethers.Contract(c.routerAddress, ROUTER_ABI, provider);

  aqua.on('Shipped', (...args) => {
    const evt = args[args.length - 1].log ?? args[args.length - 1];
    processShippedEvent({ args, transactionHash: evt.transactionHash }, { provider, cfg: c })
      .catch((e) => console.error('aqua Shipped handler error:', e.message));
  });
  router.on('Swapped', (...args) => {
    const evt = args[args.length - 1].log ?? args[args.length - 1];
    processSwappedEvent({ args, transactionHash: evt.transactionHash })
      .catch((e) => console.error('aqua Swapped handler error:', e.message));
  });
  aqua.on('Docked', (...args) => {
    const evt = args[args.length - 1].log ?? args[args.length - 1];
    processDockedEvent({ args, transactionHash: evt.transactionHash })
      .catch((e) => console.error('aqua Docked handler error:', e.message));
  });

  // Polling fallback over plain HTTP: the shared WebSocket provider can be
  // silently degraded after hot restarts, and then subscription events never
  // arrive. This sweep catches anything the subscriptions missed.
  const httpUrl = process.env.RPC_URL;
  if (httpUrl) {
    const http = new ethers.JsonRpcProvider(httpUrl);
    const aquaRo = new ethers.Contract(c.aquaAddress, AQUA_ABI, http);
    const routerRo = new ethers.Contract(c.routerAddress, ROUTER_ABI, http);
    const seen = new Set();
    const pendingSwaps = []; // fills whose order hasn't been indexed yet
    let fromBlock = null;
    const sweep = async () => {
      try {
        const tip = await http.getBlockNumber();
        if (fromBlock === null) fromBlock = Math.max(0, tip - 1200);
        if (tip < fromBlock) return;
        const range = { fromBlock, toBlock: tip };
        const [shipped, swapped, docked] = await Promise.all([
          aquaRo.queryFilter('Shipped', range.fromBlock, range.toBlock),
          routerRo.queryFilter('Swapped', range.fromBlock, range.toBlock),
          aquaRo.queryFilter('Docked', range.fromBlock, range.toBlock),
        ]);
        for (const l of shipped) {
          const key = `${l.transactionHash}:${l.index}`;
          if (seen.has(key)) continue; seen.add(key);
          await processShippedEvent({ args: l.args, transactionHash: l.transactionHash }, { provider: http, cfg: c }).catch(() => {});
        }
        // Fills retry until their order exists — a Shipped can be indexed a
        // sweep later than its Swapped, and the range cursor moves on.
        for (const l of swapped) {
          const key = `${l.transactionHash}:${l.index}`;
          if (!seen.has(key)) pendingSwaps.push({ key, args: l.args, transactionHash: l.transactionHash });
          seen.add(key);
        }
        for (let i = pendingSwaps.length - 1; i >= 0; i--) {
          const p = pendingSwaps[i];
          const matched = await processSwappedEvent({ args: p.args, transactionHash: p.transactionHash }).catch(() => null);
          if (matched) pendingSwaps.splice(i, 1);
        }
        for (const l of docked) {
          const key = `${l.transactionHash}:${l.index}`;
          if (seen.has(key)) continue; seen.add(key);
          await processDockedEvent({ args: l.args, transactionHash: l.transactionHash }).catch(() => {});
        }
        fromBlock = tip + 1;
        if (seen.size > 5000) seen.clear();
      } catch (_) { /* transient RPC hiccup — next sweep retries */ }
    };
    const timer = setInterval(sweep, 5000);
    sweep();
    return () => { clearInterval(timer); aqua.removeAllListeners(); router.removeAllListeners(); };
  }

  return () => { aqua.removeAllListeners(); router.removeAllListeners(); };
}

module.exports = {
  registerMarket,
  lookupMarket,
  decodeShipCalldata,
  processShippedEvent,
  processSwappedEvent,
  processDockedEvent,
  loadMarketsFromDb,
  startAquaListener,
};
