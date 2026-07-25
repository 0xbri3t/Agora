const express = require('express');
const router = express.Router();
const Order = require('../models/Order');
const OrderBook = require('../models/OrderBook');
const Proposal = require('../models/Proposal');
const { verifyWalletSignature } = require('../middleware/walletAuth');
const {
  notifyOrderBookUpdate,
  notifyUserOrdersUpdate
} = require('../middleware/websocket');
const PriceHistory = require('../models/PriceHistory');
const TWAP = require('../models/TWAP');
const { ethers } = require('ethers');
const { getProvider, ERC20_MIN_ABI } = require('../config/ethers');

function normalizeSide(side) { if (side === 'yes') return 'approve'; if (side === 'no') return 'reject'; return side; }
function isValidSide(side) { return ['approve', 'reject'].includes(side); }
function isValidOrderType(orderType) { return ['buy', 'sell'].includes(orderType); }
function isValidOrderExecution(orderExecution) { return ['limit', 'market'].includes(orderExecution); }
function sendError(res, status, message) { return res.status(status).json({ error: message }); }
function sideToKey(side) { return side === 'approve' ? 'yes' : 'no'; }

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

    side = normalizeSide(side);
    if (!isValidSide(side)) {
      return res.status(400).json({ error: 'Invalid side. Must be approve/reject (or yes/no alias)' });
    }

    // Verify proposal exists (internal id, on-chain id, or address)
    const proposal = await Proposal.findByAnyId(proposalId);
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

module.exports = router;
// Expose the snapshot rebuild for services (e.g. Aqua event bridge)
module.exports.updateOrderBook = updateOrderBook;