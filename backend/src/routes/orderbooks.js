const express = require('express');
const router = express.Router();
const Order = require('../models/Order');
const OrderBook = require('../models/OrderBook');
const Proposal = require('../models/Proposal');
const { verifyWalletSignature, requireWalletAddress } = require('../middleware/walletAuth');
const { 
  notifyOrderBookUpdate, 
  notifyNewOrder, 
  notifyOrderStatusChange,
  notifyOrderMatched,
  notifyMarketData,
  notifyUserOrdersUpdate
} = require('../middleware/websocket');
const PriceHistory = require('../models/PriceHistory');
const TWAP = require('../models/TWAP');
const { ethers } = require('ethers');
const { getProvider } = require('../config/ethers');
// New: chain apply-batch service
const { submitFillToChain } = require('../services/applyBatchService');


// Minimal ERC20 ABI for balance/decimals
const ERC20_MIN_ABI = [
  'function balanceOf(address) view returns (uint256)',
  'function decimals() view returns (uint8)'
];

function normalizeSide(side) { if (side === 'yes') return 'approve'; if (side === 'no') return 'reject'; return side; }
function isValidSide(side) { return ['approve', 'reject'].includes(side); }
function isValidOrderType(orderType) { return ['buy', 'sell'].includes(orderType); }
function isValidOrderExecution(orderExecution) { return ['limit', 'market'].includes(orderExecution); }
function sendError(res, status, message) { return res.status(status).json({ error: message }); }
function sideToKey(side) { return side === 'approve' ? 'yes' : 'no'; }

// Cache for proposal token addresses to avoid repeated DB lookups
const proposalTokenCache = new Map();
const CACHE_TTL = 60000; // 1 minute cache

// Helper to invalidate cache for a proposal
function invalidateProposalCache(proposalId) {
  const keysToDelete = [];
  for (const key of proposalTokenCache.keys()) {
    if (key.startsWith(`${proposalId}-`) || key === `proposal-${proposalId}`) {
      keysToDelete.push(key);
    }
  }
  keysToDelete.forEach(k => proposalTokenCache.delete(k));
  if (keysToDelete.length > 0) {
    console.log(`[CACHE] Invalidated ${keysToDelete.length} entries for proposal ${proposalId}`);
  }
}

// Clean cache periodically
setInterval(() => {
  const now = Date.now();
  for (const [key, value] of proposalTokenCache.entries()) {
    if (now - value.timestamp > CACHE_TTL) {
      proposalTokenCache.delete(key);
    }
  }
}, 30000); // Clean every 30 seconds

// Build and persist a compact order book snapshot for a proposal/side
async function updateOrderBook(proposalId, side, io) {
  try {
    // Read previous snapshot to detect top-of-book changes
    const prevDoc = await OrderBook.findOne({ proposalId, side }).lean();

    const openOrders = await Order.find({
      proposalId,
      side,
      status: { $in: ['open', 'partial'] }
    }).select('orderType price amount filledAmount').lean();

    const bidsMap = new Map(); // price -> { amount:number, orderCount:number }
    const asksMap = new Map();

    for (const o of openOrders) {
      const remaining = Math.max(0, parseFloat(o.amount || '0') - parseFloat(o.filledAmount || '0'));
      if (!(remaining > 0)) continue;
      const priceKey = String(o.price || '0');
      const map = o.orderType === 'buy' ? bidsMap : asksMap;
      const cur = map.get(priceKey) || { amount: 0, orderCount: 0 };
      cur.amount += remaining;
      cur.orderCount += 1;
      map.set(priceKey, cur);
    }

    const toArr = (map, sortDir) => {
      const arr = Array.from(map.entries()).map(([price, v]) => ({
        price,
        amount: String(+v.amount.toFixed(8)),
        orderCount: v.orderCount
      }));
      arr.sort((a, b) => sortDir * (parseFloat(a.price) - parseFloat(b.price)));
      return arr;
    };

    const bids = toArr(bidsMap, -1); // high to low
    const asks = toArr(asksMap, +1); // low to high

    // Determine new top-of-book and mid price
    const bestBidNew = bids?.[0] || null; // highest buyer
    const bestAskNew = asks?.[0] || null; // cheapest seller
    let midStr;
    if (bestBidNew && bestAskNew) {
      const bid = parseFloat(bestBidNew.price);
      const ask = parseFloat(bestAskNew.price);
      if (Number.isFinite(bid) && Number.isFinite(ask)) {
        // Mid-price = average of best bid and best ask
        midStr = ((bid + ask) / 2).toFixed(8);
      }
    }

    // Persist snapshot (and lastPrice if we computed a mid)
    const setUpdate = { bids, asks, updatedAt: new Date() };
    if (midStr) setUpdate.lastPrice = midStr;

    const doc = await OrderBook.findOneAndUpdate(
      { proposalId, side },
      { $set: setUpdate, $setOnInsert: { proposalId, side } },
      { upsert: true, new: true }
    );

    // Detect change of buyer/seller combination (top-of-book changed)
    const prevBid = prevDoc?.bids?.[0] || null;
    const prevAsk = prevDoc?.asks?.[0] || null;
    const topChanged = !!bestBidNew && !!bestAskNew && (
      !prevBid || !prevAsk || prevBid.price !== bestBidNew.price || prevAsk.price !== bestAskNew.price
    );

    if (topChanged && midStr) {
      try {
        await PriceHistory.create({
          proposalId,
          side,
          price: midStr,
          volume: '0', // snapshot, not traded volume
          timestamp: new Date()
        });
      } catch (e) {
        console.error('PriceHistory create error:', e.message);
      }
    }

    try { if (io && typeof notifyOrderBookUpdate === 'function') notifyOrderBookUpdate(io, proposalId, side, doc); } catch (_) {}
    return doc;
  } catch (e) {
    console.error('updateOrderBook error:', e.message);
    throw e;
  }
}

async function getBestSellPrice(proposalId, side) {
  try {
    const sells = await Order.find({
      proposalId,
      side,
      orderType: 'sell',
      status: { $in: ['open', 'partial'] }
    }).select('price').lean();
    if (!sells || sells.length === 0) return null;
    const min = sells.reduce((m, o) => Math.min(m, Number(o.price || 0)), Number.POSITIVE_INFINITY);
    return Number.isFinite(min) ? String(min) : null;
  } catch (_) { return null; }
}

async function ensureSufficientBalance({ proposal, proposalId, side, orderType, orderExecution, price, amount, userAddress }) {
  const provider = getProvider();
  const key = sideToKey(side);

  // PyUSD address always comes from environment variable
  const pyusdAddr = process.env.PYUSD_ADDRESS;
  if (!pyusdAddr) {
    throw new Error('PyUSD address not configured in environment');
  }
  
  // Try cache first for fast path
  const cacheKey = `${proposalId}-${key}`;
  const cached = proposalTokenCache.get(cacheKey);
  let tokenAddr = cached?.address;
  
  // If not in cache or cache expired, get from proposal
  if (!tokenAddr || Date.now() - cached.timestamp > CACHE_TTL) {
    if (key === 'yes') {
      tokenAddr = proposal?.yesToken;
    } else if (key === 'no') {
      tokenAddr = proposal?.noToken;
    }
    
    // Cache the result
    if (tokenAddr) {
      proposalTokenCache.set(cacheKey, { address: tokenAddr, timestamp: Date.now() });
    }
  }

  // If token address not found, try reload from DB (maybe cached data is stale)
  if (!tokenAddr) {
    try {
      const address = proposal?.proposalAddress;
      if (address && /^0x[a-fA-F0-9]{40}$/.test(String(address))) {
        console.log(`[BALANCE-CHECK] Token address not found for ${side}, reloading from DB: ${address}`);
        
        // Quick DB reload without blockchain sync (non-blocking)
        const ProposalModel = require('../models/Proposal');
        const fresh = await ProposalModel.findOne({ 
          proposalAddress: String(address).toLowerCase() 
        }).lean();
        
        // Try with fresh data from DB
        if (key === 'yes') {
          tokenAddr = fresh?.yesToken;
        } else if (key === 'no') {
          tokenAddr = fresh?.noToken;
        }
        
        // Cache the result
        if (tokenAddr) {
          proposalTokenCache.set(cacheKey, { address: tokenAddr, timestamp: Date.now() });
        }
        
        // If still not found, trigger async background sync (non-blocking)
        if (!tokenAddr) {
          console.log(`[BALANCE-CHECK] Token still not found, triggering async sync for ${address}`);
          setImmediate(async () => {
            try {
              const { syncProposalByAddress } = require('../services/chainService');
              await syncProposalByAddress(String(address));
              console.log(`[BALANCE-CHECK] Background sync completed for ${address}`);
            } catch (e) {
              console.error('[BALANCE-CHECK] Background sync error:', e.message);
            }
          });
        }
      }
    } catch (e) {
      console.error('[BALANCE-CHECK] Error reloading proposal:', e.message);
    }
  }

  if (!tokenAddr) {
    throw new Error(`Market token address not available for side '${side}' on this proposal. Try again in a moment.`);
  }

  console.log(`[BALANCE-CHECK] PyUSD: ${pyusdAddr}, Token (${side}): ${tokenAddr}`);

  const token = new ethers.Contract(tokenAddr, ERC20_MIN_ABI, provider);
  const pyusd = new ethers.Contract(pyusdAddr, ERC20_MIN_ABI, provider);

  // Fetch decimals and balance in parallel for speed
  const [tokenDec, pyusdDec, userTokenBal, userPyusdBal] = await Promise.all([
    token.decimals().catch(() => 18),
    pyusd.decimals().catch(() => 6),
    token.balanceOf(userAddress).catch(() => 0n),
    pyusd.balanceOf(userAddress).catch(() => 0n)
  ]);

  // SELL: user must have enough market tokens (amount is token qty)
  if (orderType === 'sell') {
    const requiredToken = ethers.parseUnits(String(amount), Number(tokenDec));
    if (userTokenBal < requiredToken) {
      const need = ethers.formatUnits(requiredToken, Number(tokenDec));
      const have = ethers.formatUnits(userTokenBal, Number(tokenDec));
      throw new Error(`Insufficient market token balance. Required: ${need}, Available: ${have}`);
    }
    return; // sell check done
  }

  // BUY: amount is a PyUSD budget. User must have at least this much PyUSD.
  const requiredPyusd = ethers.parseUnits(String(amount), Number(pyusdDec));
  if (userPyusdBal < requiredPyusd) {
    const need = ethers.formatUnits(requiredPyusd, Number(pyusdDec));
    const have = ethers.formatUnits(userPyusdBal, Number(pyusdDec));
    throw new Error(`Insufficient PyUSD balance. Required: ${need}, Available: ${have}`);
  }
}

/**
 * @swagger
 * tags:
 *   name: Orderbooks
 *   description: Order book and trading endpoints
 */

// ===== PUBLIC MARKET DATA ENDPOINTS =====

/**
 * @swagger
 * /api/orderbooks/{proposalId}/{side}/market-data:
 *   get:
 *     summary: Get public market data (price, volume, TWAP only)
 *     description: Returns aggregated market data without exposing individual orders
 *     tags: [Orderbooks]
 *     parameters:
 *       - in: path
 *         name: proposalId
 *         required: true
 *         schema:
 *           type: string
 *       - in: path
 *         name: side
 *         required: true
 *         schema:
 *           type: string
 *           enum: [approve, reject]
 *     responses:
 *       200:
 *         description: Public market data
 */
router.get('/:proposalId/:side/market-data', async (req, res) => {
  try {
    const { proposalId } = req.params;
    let { side } = req.params;
    side = normalizeSide(side);
    if (!isValidSide(side)) return sendError(res, 400, 'Invalid side. Must be approve or reject');

    const orderBook = await OrderBook.findOne({ proposalId, side });
    if (!orderBook) {
      return res.json({
        proposalId,
        side,
        lastPrice: '0',
        volume24h: '0',
        high24h: '0',
        low24h: '0',
        priceChange24h: '0',
        priceChangePercent24h: '0',
        twap1h: '0',
        twap4h: '0',
        twap24h: '0',
        twapLastUpdate: null,
        timestamp: new Date().toISOString()
      });
    }

    res.json({
      proposalId,
      side,
      lastPrice: orderBook.lastPrice || '0',
      volume24h: orderBook.volume24h || '0',
      high24h: orderBook.high24h || '0',
      low24h: orderBook.low24h || '0',
      priceChange24h: orderBook.priceChange24h || '0',
      priceChangePercent24h: orderBook.priceChangePercent24h || '0',
      twap1h: orderBook?.twap1h || '0',
      twap4h: orderBook?.twap4h || '0',
      twap24h: orderBook?.twap24h || '0',
      twapLastUpdate: orderBook?.twapLastUpdate || null,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    sendError(res, 500, error.message);
  }
});

/**
 * @swagger
 * /api/orderbooks/{proposalId}/{side}/twap:
 *   get:
 *     summary: Get TWAP data
 *     description: Time-weighted average price data
 *     tags: [Orderbooks]
 *     parameters:
 *       - in: path
 *         name: proposalId
 *         required: true
 *         schema:
 *           type: string
 *       - in: path
 *         name: side
 *         required: true
 *         schema:
 *           type: string
 *           enum: [approve, reject]
 *     responses:
 *       200:
 *         description: TWAP data
 */
router.get('/:proposalId/:side/twap', async (req, res) => {
  try {
    const { proposalId } = req.params;
    let { side } = req.params;
    side = normalizeSide(side);
    if (!isValidSide(side)) return sendError(res, 400, 'Invalid side. Must be approve or reject');

    const orderBook = await OrderBook.findOne({ proposalId, side });
    res.json({
      proposalId,
      side,
      twap1h: orderBook?.twap1h || '0',
      twap4h: orderBook?.twap4h || '0',
      twap24h: orderBook?.twap24h || '0',
      lastUpdate: orderBook?.twapLastUpdate || orderBook?.updatedAt,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    sendError(res, 500, error.message);
  }
});

/**
 * @swagger
 * /api/orderbooks/{proposalId}/{side}/twap/history:
 *   get:
 *     summary: Get TWAP history data
 *     description: Time-weighted average price data for a range of timestamps
 *     tags: [Orderbooks]
 *     parameters:
 *       - in: path
 *         name: proposalId
 *         required: true
 *         schema:
 *           type: string
 *       - in: path
 *         name: side
 *         required: true
 *         schema:
 *           type: string
 *           enum: [approve, reject]
 *       - in: query
 *         name: timeframe
 *         schema:
 *           type: string
 *           enum: [1m, 5m, 15m, 1h, 4h, 1d, 1w, 1M, all]
 *           default: 1h
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           default: 100
 *       - in: query
 *         name: from
 *         schema:
 *           type: string
 *           format: date-time
 *       - in: query
 *         name: to
 *         schema:
 *           type: string
 *           format: date-time
 *     responses:
 *       200:
 *         description: TWAP history data
 */
router.get('/:proposalId/:side/twap/history', async (req, res) => {
  try {
    const { proposalId } = req.params;
    let { side } = req.params;
    const { timeframe = '1m', limit = 300, from, to } = req.query;
    side = normalizeSide(side);
    if (!isValidSide(side)) return sendError(res, 400, 'Invalid side. Must be approve or reject');

    let tf = String(timeframe);
    if (tf === '24h') tf = '1d';
    if (tf === '1mo') tf = '1M';

    const allowed = ['1m', '5m', '15m', '1h', '4h', '1d', '1w', '1M', 'all'];
    if (!allowed.includes(tf)) {
      return sendError(res, 400, `Invalid timeframe. Allowed: ${allowed.join(', ')}`);
    }

    const filter = { proposalId, side, timeframe: tf };
    if (from || to) {
      filter.timestamp = {};
      if (from) filter.timestamp.$gte = new Date(isNaN(from) ? from : Number(from));
      if (to) filter.timestamp.$lte = new Date(isNaN(to) ? to : Number(to));
    }

    const items = await TWAP.find(filter)
      .sort({ timestamp: 1 })
      .limit(parseInt(limit));

    res.json({ proposalId, side, timeframe: tf, count: items.length, items });
  } catch (error) {
    sendError(res, 500, error.message);
  }
});

/**
 * @swagger
 * /api/orderbooks/{proposalId}/{side}/candles:
 *   get:
 *     summary: Get candlestick data
 *     description: Price history in candlestick format
 *     tags: [Orderbooks]
 *     parameters:
 *       - in: path
 *         name: proposalId
 *         required: true
 *         schema:
 *           type: string
 *       - in: path
 *         name: side
 *         required: true
 *         schema:
 *           type: string
 *           enum: [approve, reject]
 *       - in: query
 *         name: interval
 *         schema:
 *           type: string
 *           enum: [1m, 5m, 15m, 1h, 4h, 1d]
 *           default: 1h
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           default: 100
 *     responses:
 *       200:
 *         description: Candlestick data
 */
router.get('/:proposalId/:side/candles', async (req, res) => {
  try {
    const { proposalId } = req.params;
    let { side } = req.params;
    const { interval = '1h', limit = 100 } = req.query;
    side = normalizeSide(side);
    if (!isValidSide(side)) return sendError(res, 400, 'Invalid side. Must be approve or reject');

    const intervalMs = {
      '1m': 60 * 1000,
      '5m': 5 * 60 * 1000,
      '15m': 15 * 60 * 1000,
      '1h': 60 * 60 * 1000,
      '4h': 4 * 60 * 60 * 1000,
      '1d': 24 * 60 * 60 * 1000
    }[interval];

    if (!intervalMs) {
      return sendError(res, 400, 'Invalid interval');
    }

    const priceData = await PriceHistory.find({
      proposalId,
      side,
      timestamp: { $gte: new Date(Date.now() - parseInt(limit) * intervalMs) }
    }).sort({ timestamp: 1 });

    const candles = [];
    let currentTime = Date.now() - parseInt(limit) * intervalMs;
    for (let i = 0; i < parseInt(limit); i++) {
      const candleStart = new Date(currentTime);
      const candleEnd = new Date(currentTime + intervalMs);
      const candleData = priceData.filter(data => data.timestamp >= candleStart && data.timestamp < candleEnd);
      if (candleData.length > 0) {
        const prices = candleData.map(d => parseFloat(d.price));
        candles.push({
          timestamp: candleStart.toISOString(),
          open: prices[0],
          high: Math.max(...prices),
          low: Math.min(...prices),
          close: prices[prices.length - 1],
          volume: candleData.reduce((sum, d) => sum + parseFloat(d.volume), 0)
        });
      }
      currentTime += intervalMs;
    }

    res.json({ proposalId, side, interval, candles });
  } catch (error) {
    sendError(res, 500, error.message);
  }
});

/**
 * @swagger
 * /api/orderbooks/{proposalId}/{side}/orders:
 *   post:
 *     summary: Create order (requires wallet signature)
 *     description: |
 *       Creates a new order and returns immediately. Order matching and execution 
 *       happens asynchronously in the background. Updates are sent via WebSocket.
 *       User must provide wallet signature for authentication.
 *     tags: [Orderbooks]
 *     security:
 *       - WalletSignature: []
 *     parameters:
 *       - in: path
 *         name: proposalId
 *         required: true
 *         schema:
 *           type: string
 *       - in: path
 *         name: side
 *         required: true
 *         schema:
 *           type: string
 *           enum: [approve, reject]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [address, signature, message, timestamp, orderType, price, amount]
 *             properties:
 *               address:
 *                 type: string
 *                 description: Wallet address
 *               signature:
 *                 type: string
 *                 description: Wallet signature
 *               message:
 *                 type: string
 *                 description: Signed message
 *               timestamp:
 *                 type: number
 *                 description: Message timestamp
 *               orderType:
 *                 type: string
 *                 enum: [buy, sell]
 *               orderExecution:
 *                 type: string
 *                 enum: [limit, market]
 *                 default: limit
 *               price:
 *                 type: number
 *                 description: Required for limit orders, optional for market orders
 *               amount:
 *                 type: number
 *                 description: For buy orders (PyUSD budget), for sell orders (token quantity)
 *     responses:
 *       201:
 *         description: Order created successfully. Matching happens asynchronously.
 *       400:
 *         description: Invalid input or insufficient balance
 *       401:
 *         description: Invalid wallet signature
 *       404:
 *         description: Proposal not found
 */
router.post('/:proposalId/:side/orders', verifyWalletSignature, async (req, res) => {
  try {
    const { proposalId, side } = req.params;
    const { orderType, orderExecution = 'limit', price: reqPrice, amount } = req.body;
    const userAddress = req.userAddress; // From wallet authentication
    const io = req.app.get('io');

    // Validate inputs
    if (!proposalId) {
      return res.status(400).json({ error: 'Proposal ID is required' });
    }

    if (!userAddress) {
      return res.status(401).json({ error: 'User address not found in authentication' });
    }

    if (!['approve', 'reject'].includes(side)) {
      return res.status(400).json({ error: 'Invalid side. Must be approve or reject' });
    }

    if (!['buy', 'sell'].includes(orderType)) {
      return res.status(400).json({ error: 'Invalid orderType. Must be buy or sell' });
    }

    if (!['limit', 'market'].includes(orderExecution)) {
      return res.status(400).json({ error: 'Invalid orderExecution. Must be limit or market' });
    }

    // Verify that the proposal exists by accepting multiple identifiers (internal id, on-chain id, or address)
    let proposal;
    const proposalCacheKey = `proposal-${proposalId}`;
    
    // Try cache first
    const cachedProposal = proposalTokenCache.get(proposalCacheKey);
    if (cachedProposal && Date.now() - cachedProposal.timestamp < CACHE_TTL) {
      proposal = cachedProposal.data;
    } else {
      // Fetch from DB
      try {
        const pidNum = Number(proposalId);
        const clauses = [{ proposalContractId: String(proposalId) }];
        if (!Number.isNaN(pidNum)) clauses.push({ id: pidNum });
        if (/^0x[a-fA-F0-9]{40}$/.test(String(proposalId))) clauses.push({ proposalAddress: String(proposalId).toLowerCase() });
        proposal = await Proposal.findOne({ $or: clauses });
        
        // Cache the proposal
        if (proposal) {
          proposalTokenCache.set(proposalCacheKey, { data: proposal, timestamp: Date.now() });
        }
      } catch (_) {}
    }
    
    if (!proposal) {
      return res.status(404).json({ error: `Proposal with id ${proposalId} not found` });
    }

    // Check if proposal has required fields
    if (!proposal.id || !proposal.admin) {
      return res.status(400).json({ error: 'Proposal data is incomplete' });
    }

    // Check if proposal is active
    if (!proposal.isActive) {
      // return res.status(400).json({ error: 'Proposal is not active for trading' });
    }

    // For market orders, price is not required but for limit we validate reqPrice
    if (orderExecution === 'limit' && (!reqPrice || parseFloat(reqPrice) <= 0)) {
      return res.status(400).json({ error: 'Price required for limit orders and must be greater than 0' });
    }

    if (!amount || parseFloat(amount) <= 0) {
      return res.status(400).json({ error: 'Amount is required and must be greater than 0' });
    }

    // Balance checks
    try {
      await ensureSufficientBalance({
        proposal,
        proposalId,
        side,
        orderType,
        orderExecution,
        price: reqPrice,
        amount,
        userAddress
      });
    } catch (e) {
      return res.status(400).json({ error: e.message });
    }

    // Market execution: derive price from top-of-book on SAME side
    let computedPrice = reqPrice;
    if (orderExecution === 'market') {
      let ob = await OrderBook.findOne({ proposalId, side }).lean();
      if (!ob || ((!ob.bids || ob.bids.length === 0) && (!ob.asks || ob.asks.length === 0))) {
        try { ob = await updateOrderBook(proposalId, side, io); } catch (_) {}
      }

      const bestAsk = ob?.asks?.[0]?.price;
      const bestBid = ob?.bids?.[0]?.price;

      if (orderType === 'buy') {
        if (!bestAsk) return res.status(400).json({ error: 'No matching orders found for market execution' });
        computedPrice = String(bestAsk);
      } else {
        if (!bestBid) return res.status(400).json({ error: 'No matching orders found for market execution' });
        computedPrice = String(bestBid);
      }
    }

    const order = new Order({
      proposalId,
      side,
      orderType,
      orderExecution,
      price: computedPrice?.toString() || '0',
      amount: amount.toString(),
      userAddress,
      filledAmount: '0',
      status: 'open',
      createdAt: new Date(),
      updatedAt: new Date()
    });

    await order.save();

    if (!order || !order._id) {
      return res.status(500).json({ error: 'Failed to create order' });
    }

    // Notify user immediately via WebSocket
    try { if (io) notifyUserOrdersUpdate(io, userAddress, { reason: 'order-created', changedOrderId: order._id.toString() }); } catch (e) {}

    // Notify new order creation via WebSocket
    try {
      if (io && typeof notifyNewOrder === 'function') {
        notifyNewOrder(io, order);
      }
    } catch (notifyError) {
      console.error('Error notifying new order:', notifyError);
    }

    // IMPORTANT: Respond immediately to prevent frontend timeout
    res.status(201).json(order);

    // Execute order matching ASYNCHRONOUSLY (non-blocking)
    // This allows the response to be sent immediately while processing happens in background
    setImmediate(async () => {
      try {
        console.log(`[ASYNC-MATCH] Starting async execution for order ${order._id}`);
        
        // Update order book snapshot
        await updateOrderBook(proposalId, side, io);
        
        // Execute matching for this order
        await executeOrder(order, io);
        
        // Re-check existing opposite orders for potential matches
        const existingOrders = await Order.find({
          proposalId: order.proposalId,
          side: order.side,
          orderType: order.orderType === 'buy' ? 'sell' : 'buy',
          status: { $in: ['open', 'partial'] },
          _id: { $ne: order._id }
        }).sort({ createdAt: 1 });

        console.log(`[ASYNC-MATCH] Found ${existingOrders.length} existing orders to re-check for matching`);
        for (const existingOrder of existingOrders) {
          try { 
            await executeOrder(existingOrder, io); 
          } catch (existingExecuteError) { 
            console.error('[ASYNC-MATCH] Error executing existing order:', existingExecuteError); 
          }
        }
        console.log(`[ASYNC-MATCH] Completed async execution for order ${order._id}`);
      } catch (asyncError) {
        console.error('[ASYNC-MATCH] Error in async order execution:', asyncError);
      }
    });
  } catch (error) {
    console.error('Error creating order:', error);
    res.status(400).json({ error: error.message });
  }
});

/**
 * @swagger
 * /api/orderbooks/orders/{orderId}:
 *   delete:
 *     summary: Cancel order (requires wallet signature)
 *     description: Cancels an order. Only the order creator can cancel it.
 *     tags: [Orderbooks]
 *     security:
 *       - WalletSignature: []
 *     parameters:
 *       - in: path
 *         name: orderId
 *         required: true
 *         schema:
 *           type: string
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [address, signature, message, timestamp]
 *             properties:
 *               address:
 *                 type: string
 *               signature:
 *                 type: string
 *               message:
 *                 type: string
 *               timestamp:
 *                 type: number
 *     responses:
 *       200:
 *         description: Order cancelled successfully
 *       401:
 *         description: Invalid wallet signature
 *       403:
 *         description: Not authorized to cancel this order
 *       404:
 *         description: Order not found
 */
router.delete('/orders/:orderId', verifyWalletSignature, async (req, res) => {
  try {
    const { orderId } = req.params;
    const userAddress = req.userAddress;
    const io = req.app.get('io');

    if (!orderId) return sendError(res, 400, 'Order ID is required');
    if (!userAddress) return sendError(res, 401, 'User address not found in authentication');

    const existingOrder = await Order.findById(orderId);
    if (!existingOrder) return sendError(res, 404, 'Order not found');
    if (!existingOrder.userAddress) return sendError(res, 400, 'Order userAddress is missing');
    if (!existingOrder.proposalId || !existingOrder.side) return sendError(res, 400, 'Order data is incomplete');
    if (existingOrder.userAddress.toLowerCase() !== userAddress.toLowerCase()) return sendError(res, 403, 'Not authorized to cancel this order');
    if (existingOrder.status === 'cancelled') return sendError(res, 400, 'Order is already cancelled');
    if (existingOrder.status === 'filled') return sendError(res, 400, 'Cannot cancel a filled order');

    const order = await Order.findByIdAndUpdate(orderId, { status: 'cancelled', updatedAt: new Date() }, { new: true });
    if (!order) return sendError(res, 500, 'Failed to update order status');

    try { if (io) notifyUserOrdersUpdate(io, order.userAddress, { reason: 'order-cancelled', changedOrderId: order._id.toString() }); } catch (e) {}
    try { await updateOrderBook(order.proposalId, order.side, io); } catch (updateError) { console.error('Error updating order book after cancellation:', updateError); }
    try { if (io && typeof notifyOrderStatusChange === 'function') { notifyOrderStatusChange(io, order, 'cancelled'); } } catch (notifyError) { console.error('Error notifying order status change:', notifyError); }

    res.json(order);
  } catch (error) {
    console.error('Error cancelling order:', error);
    sendError(res, 500, error.message);
  }
});

/**
 * @swagger
 * /api/orderbooks/my-orders:
 *   post:
 *     summary: Get my orders (requires wallet signature)
 *     description: Get all orders for the authenticated user
 *     tags: [Orderbooks]
 *     security:
 *       - WalletSignature: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [address, signature, message, timestamp]
 *             properties:
 *               address:
 *                 type: string
 *               signature:
 *                 type: string
 *               message:
 *                 type: string
 *               timestamp:
 *                 type: number
 *               status:
 *                 type: string
 *                 enum: [open, filled, cancelled, partial]
 *               proposalId:
 *                 type: string
 *     responses:
 *       200:
 *         description: User orders
 *       401:
 *         description: Authentication required
 */
router.post('/my-orders', verifyWalletSignature, async (req, res) => {
  try {
    const { status, proposalId } = req.body;
    const filter = { userAddress: req.userAddress };
    
    if (status) filter.status = status;
    if (proposalId) filter.proposalId = proposalId;
    
    const orders = await Order.find(filter).sort({ createdAt: -1 });
    res.json(orders);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * @swagger
 * /api/orderbooks/my-orders/{proposalId}:
 *   post:
 *     summary: Get my orders for specific proposal (requires wallet signature)
 *     tags: [Orderbooks]
 *     security:
 *       - WalletSignature: []
 *     parameters:
 *       - in: path
 *         name: proposalId
 *         required: true
 *         schema:
 *           type: string
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [address, signature, message, timestamp]
 *             properties:
 *               address:
 *                 type: string
 *               signature:
 *                 type: string
 *               message:
 *                 type: string
 *               timestamp:
 *                 type: number
 *     responses:
 *       200:
 *         description: User orders for proposal
 */
router.post('/my-orders/:proposalId', verifyWalletSignature, async (req, res) => {
  try {
    const { proposalId } = req.params;
    const orders = await Order.find({ 
      userAddress: req.userAddress,
      proposalId 
    }).sort({ createdAt: -1 });
    
    res.json(orders);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * @swagger
 * /api/orderbooks/my-trades:
 *   post:
 *     summary: Get my trading history (requires wallet signature)
 *     tags: [Orderbooks]
 *     security:
 *       - WalletSignature: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [address, signature, message, timestamp]
 *             properties:
 *               address:
 *                 type: string
 *               signature:
 *                 type: string
 *               message:
 *                 type: string
 *               timestamp:
 *                 type: number
 *     responses:
 *       200:
 *         description: User trading history
 */
router.post('/my-trades', verifyWalletSignature, async (req, res) => {
  try {
    const trades = await Order.find({ 
      userAddress: req.userAddress,
      status: { $in: ['filled', 'partial'] }
    }).sort({ updatedAt: -1 });
    
    res.json(trades);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * @swagger
 * /api/orderbooks/{proposalId}/{side}/orders:
 *   get:
 *     summary: Get public list of open/partial orders (addresses redacted)
 *     description: Returns orders with status open or partial for the given proposal and side. User addresses are not included.
 *     tags: [Orderbooks]
 *     parameters:
 *       - in: path
 *         name: proposalId
 *         required: true
 *         schema:
 *           type: string
 *       - in: path
 *         name: side
 *         required: true
 *         schema:
 *           type: string
 *           enum: [approve, reject, yes, no]
 *     responses:
 *       200:
 *         description: List of orders
 */
router.get('/:proposalId/:side/orders', async (req, res) => {
  try {
    const { proposalId } = req.params;
    let { side } = req.params;

    // Normalize yes/no to approve/reject
    if (side === 'yes') side = 'approve';
    if (side === 'no') side = 'reject';

    if (!['approve', 'reject'].includes(side)) {
      return res.status(400).json({ error: 'Invalid side. Must be approve/reject (or yes/no alias)' });
    }

    // Verify proposal exists using on-chain contract id (string)
    const proposal = await Proposal.findOne({ proposalContractId: proposalId });
    if (!proposal) {
      return res.status(404).json({ error: `Proposal with id ${proposalId} not found` });
    }

    const raw = await Order.find({
      proposalId,
      side,
      status: { $in: ['open', 'partial'] }
    })
      .sort({ createdAt: -1 })
      .select('-userAddress -txHash -__v -_id -fills.matchedOrderId')
      .lean();

    // Sanitize nested fills and remove any subdocument _id
    const orders = raw.map(o => ({
      ...o,
      fills: Array.isArray(o.fills)
        ? o.fills.map(f => ({ price: f.price, amount: f.amount, timestamp: f.timestamp }))
        : []
    }));

    res.json({ proposalId, side, count: orders.length, orders });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * @swagger
 * /api/orderbooks/{proposalId}/{side}/top:
 *   get:
 *     summary: Get top-of-book (best bid and best ask)
 *     description: Returns the highest buyer (best bid) and cheapest seller (best ask) for quick market buy/sell interaction.
 *     tags: [Orderbooks]
 *     parameters:
 *       - in: path
 *         name: proposalId
 *         required: true
 *         schema:
 *           type: string
 *       - in: path
 *         name: side
 *         required: true
 *         schema:
 *           type: string
 *           enum: [approve, reject]
 *     responses:
 *       200:
 *         description: Top of book
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 proposalId:
 *                   type: string
 *                 side:
 *                   type: string
 *                 bestBid:
 *                   type: object
 *                   nullable: true
 *                   properties:
 *                     price:
 *                       type: string
 *                     amount:
 *                       type: string
 *                     orderCount:
 *                       type: integer
 *                 bestAsk:
 *                   type: object
 *                   nullable: true
 *                   properties:
 *                     price:
 *                       type: string
 *                     amount:
 *                       type: string
 *                     orderCount:
 *                       type: integer
 *                 timestamp:
 *                   type: string
 *                   format: date-time
 */

router.get('/:proposalId/:side/top', async (req, res) => {
  try {
    const { proposalId } = req.params;
    let { side } = req.params;
    side = normalizeSide(side);
    if (!isValidSide(side)) return sendError(res, 400, 'Invalid side. Must be approve or reject');

    let ob = await OrderBook.findOne({ proposalId, side }).lean();
    if (!ob || ((!ob.bids || ob.bids.length === 0) && (!ob.asks || ob.asks.length === 0))) {
      try { ob = await updateOrderBook(proposalId, side); } catch (_) {}
    }

    const bestBid = ob?.bids?.[0] || null; // highest buyer
    const bestAsk = ob?.asks?.[0] || null; // cheapest seller

    return res.json({
      proposalId,
      side,
      bestBid,
      bestAsk,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    return sendError(res, 500, error.message);
  }
});

// Lock map to prevent concurrent execution of the same order
const executionLocks = new Map();

// Clean up old locks periodically (in case of crashes/errors)
setInterval(() => {
  const now = Date.now();
  for (const [orderId, lockTime] of executionLocks.entries()) {
    // Remove locks older than 30 seconds
    if (typeof lockTime === 'number' && now - lockTime > 30000) {
      console.log(`[EXEC-LOCK] Cleaning up stale lock for order ${orderId}`);
      executionLocks.delete(orderId);
    }
  }
}, 60000); // Run every minute

async function executeOrder(order, io) {
  try {
    if (!order || !order.proposalId || !order.side) {
      console.error('Invalid order data for executeOrder');
      return;
    }

    const orderId = order._id.toString();
    
    // Check if this order is already being executed
    if (executionLocks.has(orderId)) {
      console.log(`[EXEC-LOCK] Order ${orderId} is already being executed, skipping...`);
      return;
    }

    // Set lock with timestamp
    executionLocks.set(orderId, Date.now());

    try {
      // Reload order from DB to get latest status
      const freshOrder = await Order.findById(order._id);
      if (!freshOrder) {
        console.log(`[EXEC] Order ${orderId} not found in DB`);
        return;
      }

      if (freshOrder.status === 'filled' || freshOrder.status === 'cancelled') {
        console.log(`[EXEC] Order ${orderId} is ${freshOrder.status}, skipping execution`);
        return;
      }

      // Use fresh order for execution
      order = freshOrder;

      console.log(`[EXEC] Executing order: ${order._id}, side: ${order.side}, type: ${order.orderType}, execution: ${order.orderExecution}, price: ${order.price}, amount: ${order.amount}`);

    const oppositeOrderType = order.orderType === 'buy' ? 'sell' : 'buy';

    // Build price filter for limit orders
    let priceFilter = {};
    if (order.orderExecution === 'limit') {
      priceFilter = order.orderType === 'buy'
        ? { $expr: { $lte: [{ $toDouble: '$price' }, parseFloat(order.price) ] } }
        : { $expr: { $gte: [{ $toDouble: '$price' }, parseFloat(order.price) ] } };
    }
    

    // Find matching orders (excluding same user to prevent self-matching)
    const matchingOrders = await Order.find({
      proposalId: order.proposalId,
      side: order.side,
      orderType: oppositeOrderType,
      status: { $in: ['open', 'partial'] },
      userAddress: { $ne: order.userAddress }, // Prevent self-matching
      ...(order.orderExecution === 'limit' ? { ...priceFilter } : {})
    }).sort({
      price: order.orderType === 'buy' ? 1 : -1, // Best price first
      createdAt: 1
    });

    // Helpers for decimal math
    const TEN18 = 10n ** 18n;
    const toUnits = (v, dec) => { try { return ethers.parseUnits(String(v ?? '0'), Number(dec)); } catch { return 0n; } };
    const fmt = (v, dec) => ethers.formatUnits(v, Number(dec));

    // Prefetch decimals for correct math using proposal info if available via ensureSufficientBalance call path
    // Fallback to 18/6
    let tokenDec = 18, pyusdDec = 6;
    try {
      // Look up by multiple identifiers (order.proposalId may be internal id string)
      let proposalDoc;
      try {
        const pidNum = Number(order.proposalId);
        const clauses = [{ proposalContractId: String(order.proposalId) }];
        if (!Number.isNaN(pidNum)) clauses.push({ id: pidNum });
        if (/^0x[a-fA-F0-9]{40}$/.test(String(order.proposalId))) clauses.push({ proposalAddress: String(order.proposalId).toLowerCase() });
        proposalDoc = await Proposal.findOne({ $or: clauses });
      } catch (_) {}
      const key = sideToKey(order.side);
      const tokenAddr = proposalDoc?.auctions?.[key]?.marketToken;
      const pyusdAddr = process.env.PYUSD_ADDRESS;
      if (tokenAddr && pyusdAddr) {
        const provider = getProvider();
        const token = new ethers.Contract(tokenAddr, ERC20_MIN_ABI, provider);
        const pyusd = new ethers.Contract(pyusdAddr, ERC20_MIN_ABI, provider);
        const [td, pd] = await Promise.all([
          token.decimals().catch(() => 18),
          pyusd.decimals().catch(() => 6)
        ]);
        tokenDec = Number(td) || 18;
        pyusdDec = Number(pd) || 6;
      }
    } catch {}

    // Track remaining in native units of the order
    let remainingBuyPyusd = 0n; // for buy orders (in PyUSD decimals)
    let remainingSellTokens = 0n; // for sell orders (in token decimals)

    if (order.orderType === 'buy') {
      const amt = toUnits(order.amount, pyusdDec);
      const filled = toUnits(order.filledAmount || '0', pyusdDec);
      remainingBuyPyusd = amt > filled ? (amt - filled) : 0n;
    } else {
      const amt = toUnits(order.amount, tokenDec);
      const filled = toUnits(order.filledAmount || '0', tokenDec);
      remainingSellTokens = amt > filled ? (amt - filled) : 0n;
    }

    let totalTokensExecuted = 0n; // always track in token units (18d)
    let totalPyusdExecuted = 0n;  // always track in PyUSD units (6d)

    for (const matchingOrder of matchingOrders) {
      // Stop if nothing left



      if (order.orderType === 'buy' && remainingBuyPyusd <= 0n) break;
      if (order.orderType === 'sell' && remainingSellTokens <= 0n) break;

      // Price per token in PyUSD decimals
      const price6 = toUnits(matchingOrder.price, pyusdDec);
      if (price6 <= 0n) continue;

      if (order.orderType === 'buy') {
        // Opposite is SELL: it has tokens available
        const moAmt = toUnits(matchingOrder.amount, tokenDec);
        const moFilled = toUnits(matchingOrder.filledAmount || '0', tokenDec);
        const moAvailTokens = moAmt > moFilled ? (moAmt - moFilled) : 0n;
        if (moAvailTokens <= 0n) continue;

        // How many tokens can buyer afford at this price?
        const affordableTokens = (remainingBuyPyusd * TEN18) / price6; // in token 18d
        const tradeTokens = affordableTokens < moAvailTokens ? affordableTokens : moAvailTokens;
        if (tradeTokens <= 0n) continue;
        const pyusdSpent = (tradeTokens * price6) / TEN18; // in pyusd decimals

        // Update matching SELL order
        const newMoFilled = moFilled + tradeTokens;
        matchingOrder.filledAmount = fmt(newMoFilled, tokenDec);
        matchingOrder.status = newMoFilled >= moAmt ? 'filled' : 'partial';
        matchingOrder.updatedAt = new Date();
        matchingOrder.fills.push({
          price: matchingOrder.price,
          amount: fmt(tradeTokens, tokenDec), // token amount
          timestamp: new Date(),
          matchedOrderId: order._id.toString()
        });
        await matchingOrder.save();
        try { if (io) notifyUserOrdersUpdate(io, matchingOrder.userAddress, { reason: 'order-updated', changedOrderId: matchingOrder._id.toString() }); } catch {}

        // Update our BUY order (in PyUSD units)
        remainingBuyPyusd = remainingBuyPyusd > pyusdSpent ? (remainingBuyPyusd - pyusdSpent) : 0n;
        totalTokensExecuted += tradeTokens;
        totalPyusdExecuted += pyusdSpent;
        if (order.orderExecution === 'market') order.price = matchingOrder.price;
        order.fills.push({
          price: matchingOrder.price,
          amount: fmt(tradeTokens, tokenDec), // token amount
          timestamp: new Date(),
          matchedOrderId: matchingOrder._id.toString()
        });

        // Store trade price + volume for charts (volume = base token amount)
        try {
          await PriceHistory.create({
            proposalId: order.proposalId,
            side: order.side,
            price: matchingOrder.price,
            volume: fmt(tradeTokens, tokenDec),
            timestamp: new Date()
          });
        } catch (e) {
          console.error('PriceHistory (trade BUY) create error:', e.message);
        }

        // Submit on-chain
        try {
          const buyOrder = order; const sellOrder = matchingOrder;
          const tx = await submitFillToChain({
            proposalId: order.proposalId,
            side: order.side,
            buyOrder,
            sellOrder,
            price: matchingOrder.price,
            amount: fmt(tradeTokens, tokenDec)
          });
          console.log(`[applyBatch] tx sent: ${tx.hash}`);
          try {
            const execTime = new Date();
            matchingOrder.txHash = tx.hash;
            const mi = (matchingOrder.fills || []).length - 1;
            if (mi >= 0) {
              matchingOrder.fills[mi].txHash = tx.hash;
              matchingOrder.fills[mi].timestampExecuted = execTime;
              matchingOrder.fills[mi].isExecuted = true;
            }
            await matchingOrder.save();
          } catch {}
          order.txHash = tx.hash;
          try {
            const oi = (order.fills || []).length - 1;
            if (oi >= 0) {
              order.fills[oi].txHash = tx.hash;
              order.fills[oi].timestampExecuted = new Date();
              order.fills[oi].isExecuted = true;
            }
          } catch {}
        } catch (e) { console.error('[applyBatch] send error:', e.message); }
      } else {
        // Our order is SELL, opposite is BUY with PyUSD budget
        const moAmt6 = toUnits(matchingOrder.amount, pyusdDec);
        const moFilled6 = toUnits(matchingOrder.filledAmount || '0', pyusdDec);
        const moBudget = moAmt6 > moFilled6 ? (moAmt6 - moFilled6) : 0n;
        if (moBudget <= 0n) continue;

        // How many tokens can buyer afford?
        const affordableTokens = (moBudget * TEN18) / price6;
        const tradeTokens = remainingSellTokens < affordableTokens ? remainingSellTokens : affordableTokens;
        if (tradeTokens <= 0n) continue;
        const pyusdSpent = (tradeTokens * price6) / TEN18; // in pyusd decimals

        // Update matching BUY order (filledAmount in PyUSD)
        const newMoFilled6 = moFilled6 + pyusdSpent;
        matchingOrder.filledAmount = fmt(newMoFilled6, pyusdDec);
        matchingOrder.status = newMoFilled6 >= moAmt6 ? 'filled' : 'partial';
        matchingOrder.updatedAt = new Date();
        matchingOrder.fills.push({
          price: matchingOrder.price,
          amount: fmt(tradeTokens, tokenDec), // token amount
          timestamp: new Date(),
          matchedOrderId: order._id.toString()
        });
        await matchingOrder.save();
        try { if (io) notifyUserOrdersUpdate(io, matchingOrder.userAddress, { reason: 'order-updated', changedOrderId: matchingOrder._id.toString() }); } catch {}

        // Update our SELL order (filledAmount in tokens)
        remainingSellTokens = remainingSellTokens > tradeTokens ? (remainingSellTokens - tradeTokens) : 0n;
        totalTokensExecuted += tradeTokens;
        totalPyusdExecuted += pyusdSpent;
        if (order.orderExecution === 'market') order.price = matchingOrder.price;
        order.fills.push({
          price: matchingOrder.price,
          amount: fmt(tradeTokens, tokenDec), // token amount
          timestamp: new Date(),
          matchedOrderId: matchingOrder._id.toString()
        });

        // Store trade price + volume for charts (volume = base token amount)
        try {
          await PriceHistory.create({
            proposalId: order.proposalId,
            side: order.side,
            price: matchingOrder.price,
            volume: fmt(tradeTokens, tokenDec),
            timestamp: new Date()
          });
        } catch (e) {
          console.error('PriceHistory (trade SELL) create error:', e.message);
        }

        // Submit on-chain
        try {
          const buyOrder = matchingOrder; const sellOrder = order;
          const tx = await submitFillToChain({
            proposalId: order.proposalId,
            side: order.side,
            buyOrder,
            sellOrder,
            price: matchingOrder.price,
            amount: fmt(tradeTokens, tokenDec)
          });
          console.log(`[applyBatch] tx sent: ${tx.hash}`);
          try {
            const execTime = new Date();
            matchingOrder.txHash = tx.hash;
            const mi = (matchingOrder.fills || []).length - 1;
            if (mi >= 0) {
              matchingOrder.fills[mi].txHash = tx.hash;
              matchingOrder.fills[mi].timestampExecuted = execTime;
              matchingOrder.fills[mi].isExecuted = true;
            }
            await matchingOrder.save();
          } catch {}
          order.txHash = tx.hash;
          try {
            const oi = (order.fills || []).length - 1;
            if (oi >= 0) {
              order.fills[oi].txHash = tx.hash;
              order.fills[oi].timestampExecuted = new Date();
              order.fills[oi].isExecuted = true;
            }
          } catch {}
        } catch (e) { console.error('[applyBatch] send error:', e.message); }
      }
    }

    // Finalize original order statuses and filledAmount in native units
    const FILL_THRESHOLD = 0.999; // 99.9%
    if (order.orderType === 'buy') {
      const amt = toUnits(order.amount, pyusdDec);
      const prevFilled = toUnits(order.filledAmount || '0', pyusdDec);
      const newFilled = prevFilled + totalPyusdExecuted;
      order.filledAmount = fmt(newFilled, pyusdDec);
      const fillRatio = amt > 0n ? Number(newFilled) / Number(amt) : 0;
      order.status = fillRatio >= FILL_THRESHOLD ? 'filled' : (newFilled > 0n ? 'partial' : order.status);
    } else {
      const amt = toUnits(order.amount, tokenDec);
      const prevFilled = toUnits(order.filledAmount || '0', tokenDec);
      const newFilled = prevFilled + totalTokensExecuted;
      order.filledAmount = fmt(newFilled, tokenDec);
      const fillRatio = amt > 0n ? Number(newFilled) / Number(amt) : 0;
      order.status = fillRatio >= FILL_THRESHOLD ? 'filled' : (newFilled > 0n ? 'partial' : order.status);
    }
    order.updatedAt = new Date();
    await order.save();

    // NEW: notify original user if anything executed or changed
    try { if (io && (totalTokensExecuted > 0n || totalPyusdExecuted > 0n)) notifyUserOrdersUpdate(io, order.userAddress, { reason: 'order-updated', changedOrderId: order._id.toString() }); } catch (e) {}

    // Notify clients if any execution happened
    if (io && typeof notifyOrderMatched === 'function' && (totalTokensExecuted > 0n)) {
      try { notifyOrderMatched(io, order); } catch (e) {}
    }

    // Refresh order book snapshot after execution
    try { await updateOrderBook(order.proposalId, order.side, io); } catch (e) { console.error('[EXEC] Error updating order book after execution:', e); }

    } finally {
      // Always release the lock
      executionLocks.delete(orderId);
    }

  } catch (error) {
    console.error('[EXEC] Error executing order:', error);
    // Ensure lock is released even on outer error
    if (order?._id) {
      executionLocks.delete(order._id.toString());
    }
  }
}

module.exports = router;