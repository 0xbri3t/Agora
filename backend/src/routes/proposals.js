const express = require('express');
const router = express.Router();
const Proposal = require('../models/Proposal');
const OrderBook = require('../models/OrderBook');
const Auction = require('../models/Auction');
const { verifyWalletSignature } = require('../middleware/walletAuth');
const { notifyProposalUpdate, notifyAuctionUpdate } = require('../middleware/websocket');
const { validateProposal } = require('../middleware/validation');

// Proposals routes must NOT return raw order books

/**
 * @swagger
 * tags:
 *   name: Proposals
 *   description: Proposal management endpoints
 */

/**
 * @swagger
 * /api/proposals:
 *   get:
 *     summary: Get all proposals
 *     tags: [Proposals]
 *     responses:
 *       200:
 *         description: List of all proposals
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items:
 *                 $ref: '#/components/schemas/Proposal'
 *       500:
 *         description: Server error
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 */
router.get('/', async (req, res) => {
  try {
    const proposals = await Proposal.find().sort({ createdAt: -1 });
    res.json(proposals);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * @swagger
 * /api/proposals/{id}:
 *   get:
 *     summary: Get proposal by ID
 *     tags: [Proposals]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: Proposal ID
 *     responses:
 *       200:
 *         description: Proposal details
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Proposal'
 *       404:
 *         description: Proposal not found
 *       500:
 *         description: Server error
 */
router.get('/:id', async (req, res) => {
  try {
    const proposal = await Proposal.findOne({ id: req.params.id });
    if (!proposal) {
      return res.status(404).json({ error: 'Proposal not found' });
    }
    res.json(proposal);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * @swagger
 * /api/proposals:
 *   post:
 *     summary: Create proposal (requires wallet signature)
 *     description: Creates a new proposal. User must provide wallet signature for authentication.
 *     tags: [Proposals]
 *     security:
 *       - WalletSignature: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             allOf:
 *               - $ref: '#/components/schemas/Proposal'
 *               - type: object
 *                 required: [address, signature, message, timestamp]
 *                 properties:
 *                   address:
 *                     type: string
 *                     description: Wallet address
 *                   signature:
 *                     type: string
 *                     description: Wallet signature
 *                   message:
 *                     type: string
 *                     description: Signed message
 *                   timestamp:
 *                     type: number
 *                     description: Message timestamp
 *     responses:
 *       201:
 *         description: Proposal created successfully
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Proposal'
 *       400:
 *         description: Invalid proposal data
 *       401:
 *         description: Invalid wallet signature
 *       500:
 *         description: Server error
 */
router.post('/', verifyWalletSignature, validateProposal, async (req, res) => {
  try {
    const io = req.app.get('io');

    // Do not fabricate start/end times here. Only honor explicit values if provided.
    const proposalData = {
      ...req.body,
      creator: req.userAddress,
    };

    if (req.body.startTime != null && req.body.endTime != null) {
      proposalData.startTime = req.body.startTime;
      proposalData.endTime = req.body.endTime;
      // Compute duration if not included
      if (proposalData.duration == null) {
        proposalData.duration = Number(req.body.endTime) - Number(req.body.startTime);
      }
    }

    const proposal = new Proposal(proposalData);
    await proposal.save();

    const approveOrderBook = new OrderBook({ proposalId: proposal.id, side: 'approve', bids: [], asks: [] });
    const rejectOrderBook = new OrderBook({ proposalId: proposal.id, side: 'reject', bids: [], asks: [] });
    await Promise.all([approveOrderBook.save(), rejectOrderBook.save()]);

    if (io) {
      io.emit('new-proposal', { proposal, timestamp: new Date().toISOString() });
    }

    res.status(201).json(proposal);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

/**
 * @swagger
 * /api/proposals/{id}:
 *   put:
 *     summary: Update proposal (requires wallet signature, creator only)
 *     description: Updates a proposal. Only the proposal creator can update it.
 *     tags: [Proposals]
 *     security:
 *       - WalletSignature: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: Proposal ID
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             allOf:
 *               - $ref: '#/components/schemas/Proposal'
 *               - type: object
 *                 required: [address, signature, message, timestamp]
 *                 properties:
 *                   address:
 *                     type: string
 *                   signature:
 *                     type: string
 *                   message:
 *                     type: string
 *                   timestamp:
 *                     type: number
 *     responses:
 *       200:
 *         description: Proposal updated successfully
 *       401:
 *         description: Invalid wallet signature
 *       403:
 *         description: Only proposal creator can update
 *       404:
 *         description: Proposal not found
 */
router.put('/:id', verifyWalletSignature, async (req, res) => {
  try {
    const io = req.app.get('io');
    
    // First check if proposal exists and user is the creator
    const existingProposal = await Proposal.findOne({ id: req.params.id });
    if (!existingProposal) {
      return res.status(404).json({ error: 'Proposal not found' });
    }
    
    if (existingProposal.creator.toLowerCase() !== req.userAddress) {
      return res.status(403).json({ error: 'Only proposal creator can update this proposal' });
    }
    
    const proposal = await Proposal.findOneAndUpdate(
      { id: req.params.id },
      req.body,
      { new: true }
    );

    // Notify clients about proposal update
    if (io) {
      notifyProposalUpdate(io, proposal);
    }

    res.json(proposal);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

router.get('/:id/stats', async (req, res) => {
  try {
    const proposal = await Proposal.findOne({ id: req.params.id });
    if (!proposal) {
      return res.status(404).json({ error: 'Proposal not found' });
    }

    const orderBooks = await OrderBook.find({ proposalId: req.params.id });
    const approveBook = orderBooks.find(ob => ob.side === 'approve');
    const rejectBook = orderBooks.find(ob => ob.side === 'reject');

    const approveTotalBids = approveBook ? approveBook.bids.reduce((total, bid) => total + BigInt(bid.amount), BigInt(0)) : BigInt(0);
    const approveTotalAsks = approveBook ? approveBook.asks.reduce((total, ask) => total + BigInt(ask.amount), BigInt(0)) : BigInt(0);
    const rejectTotalBids = rejectBook ? rejectBook.bids.reduce((total, bid) => total + BigInt(bid.amount), BigInt(0)) : BigInt(0);
    const rejectTotalAsks = rejectBook ? rejectBook.asks.reduce((total, ask) => total + BigInt(ask.amount), BigInt(0)) : BigInt(0);

    const approveVolume24h = await get24hVolume(req.params.id, 'approve');
    const rejectVolume24h = await get24hVolume(req.params.id, 'reject');

    const approvePriceChange24h = await get24hPriceChange(req.params.id, 'approve');
    const rejectPriceChange24h = await get24hPriceChange(req.params.id, 'reject');

    const approveLastPrice = await getLastTradePrice(req.params.id, 'approve');
    const rejectLastPrice = await getLastTradePrice(req.params.id, 'reject');

    // Derive a safe end timestamp for activity/time remaining
    const yesEnd = Number(proposal?.auctions?.yes?.endTime || 0);
    const noEnd = Number(proposal?.auctions?.no?.endTime || 0);
    const derivedEndTs = proposal.endTime != null ? Number(proposal.endTime) : Math.max(yesEnd, noEnd, 0);
    const endMs = Number.isFinite(derivedEndTs) ? derivedEndTs * 1000 : 0;
    const nowMs = Date.now();

    res.json({
      proposal,
      statistics: {
        approve: {
          lastPrice: approveLastPrice || '0',
          volume24h: approveVolume24h || '0',
          priceChange24h: approvePriceChange24h || '0',
          totalBids: approveTotalBids.toString(),
          totalAsks: approveTotalAsks.toString(),
          spread: approveBook ? calculateSpread(approveBook.bids, approveBook.asks) : '0'
        },
        reject: {
          lastPrice: rejectLastPrice || '0',
          volume24h: rejectVolume24h || '0',
          priceChange24h: rejectPriceChange24h || '0',
          totalBids: rejectTotalBids.toString(),
          totalAsks: rejectTotalAsks.toString(),
          spread: rejectBook ? calculateSpread(rejectBook.bids, rejectBook.asks) : '0'
        },
        totalVolume24h: (BigInt(approveVolume24h || '0') + BigInt(rejectVolume24h || '0')).toString(),
        isActive: Boolean(proposal.isActive) && nowMs < endMs,
        timeRemaining: Math.max(0, endMs - nowMs)
      },
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.get('/with-market-data', async (req, res) => {
  try {
    const { limit = 20, offset = 0, sortBy = 'createdAt', order = 'desc' } = req.query;
    const proposals = await Proposal.find()
      .sort({ [sortBy]: order === 'desc' ? -1 : 1 })
      .skip(parseInt(offset))
      .limit(parseInt(limit));

    const proposalsWithMarketData = await Promise.all(
      proposals.map(async (proposal) => {
        const orderBooks = await OrderBook.find({ proposalId: proposal.id });
        const approveBook = orderBooks.find(ob => ob.side === 'approve');
        const rejectBook = orderBooks.find(ob => ob.side === 'reject');

        const approveLastPrice = await getLastTradePrice(proposal.id, 'approve');
        const rejectLastPrice = await getLastTradePrice(proposal.id, 'reject');
        const approveVolume24h = await get24hVolume(proposal.id, 'approve');
        const rejectVolume24h = await get24hVolume(proposal.id, 'reject');

        const yesEnd = Number(proposal?.auctions?.yes?.endTime || 0);
        const noEnd = Number(proposal?.auctions?.no?.endTime || 0);
        const endTs = proposal.endTime != null ? Number(proposal.endTime) : Math.max(yesEnd, noEnd, 0);

        return {
          ...proposal.toObject(),
          marketData: {
            approve: {
              lastPrice: approveLastPrice || '0',
              volume24h: approveVolume24h || '0',
              bidCount: approveBook ? approveBook.bids.length : 0,
              askCount: approveBook ? approveBook.asks.length : 0
            },
            reject: {
              lastPrice: rejectLastPrice || '0',
              volume24h: rejectVolume24h || '0',
              bidCount: rejectBook ? rejectBook.bids.length : 0,
              askCount: rejectBook ? rejectBook.asks.length : 0
            },
            totalVolume24h: (BigInt(approveVolume24h || '0') + BigInt(rejectVolume24h || '0')).toString(),
            isActive: Boolean(proposal.isActive) && Date.now() < Number(endTs) * 1000
          }
        };
      })
    );

    res.json(proposalsWithMarketData);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * @swagger
 * /api/proposals/state/{state}:
 *   get:
 *     summary: Get proposals filtered by state
 *     tags: [Proposals]
 *     parameters:
 *       - in: path
 *         name: state
 *         required: true
 *         schema:
 *           type: string
 *           enum: [auction, live, resolved, cancelled]
 *     responses:
 *       200:
 *         description: List of proposals in given state
 */
router.get('/state/:state', async (req, res) => {
  try {
    const { state } = req.params;
    if (!['auction','live','resolved','cancelled'].includes(state)) {
      return res.status(400).json({ error: 'Invalid state' });
    }
    const proposals = await Proposal.find({ state }).sort({ createdAt: -1 });
    res.json(proposals);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * @swagger
 * /api/proposals/states/counts:
 *   get:
 *     summary: Get counts of proposals per state
 *     tags: [Proposals]
 *     responses:
 *       200:
 *         description: Counts per state
 */
router.get('/states/counts', async (_req, res) => {
  try {
    const states = ['auction','live','resolved','cancelled'];
    const out = {};
    await Promise.all(states.map(async s => {
      out[s] = await Proposal.countDocuments({ state: s });
    }));
    res.json(out);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Helper functions (if not already imported)
async function getLastTradePrice(proposalId, side) {
  const Order = require('../models/Order');
  const lastOrder = await Order.findOne({
    proposalId,
    side,
    status: { $in: ['filled', 'partial'] },
    filledAmount: { $gt: '0' }
  }).sort({ updatedAt: -1 });

  return lastOrder ? lastOrder.price : null;
}

async function get24hVolume(proposalId, side) {
  const Order = require('../models/Order');
  const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000);
  
  const orders = await Order.find({
    proposalId,
    side,
    updatedAt: { $gte: yesterday },
    filledAmount: { $gt: '0' }
  });

  let totalVolume = BigInt(0);
  orders.forEach(order => {
    totalVolume += BigInt(order.filledAmount);
  });

  return totalVolume.toString();
}

async function get24hPriceChange(proposalId, side) {
  const Order = require('../models/Order');
  const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000);
  
  const oldestOrder = await Order.findOne({
    proposalId,
    side,
    updatedAt: { $gte: yesterday },
    filledAmount: { $gt: '0' }
  }).sort({ updatedAt: 1 });

  const newestOrder = await Order.findOne({
    proposalId,
    side,
    filledAmount: { $gt: '0' }
  }).sort({ updatedAt: -1 });

  if (!oldestOrder || !newestOrder) return '0';

  const oldPrice = parseFloat(oldestOrder.price);
  const newPrice = parseFloat(newestOrder.price);
  
  if (oldPrice === 0) return '0';
  
  const change = ((newPrice - oldPrice) / oldPrice) * 100;
  return change.toFixed(2);
}

function calculateSpread(bids, asks) {
  if (bids.length === 0 || asks.length === 0) return '0';
  
  const highestBid = parseFloat(bids[0].price);
  const lowestAsk = parseFloat(asks[0].price);
  
  if (lowestAsk === 0) return '0';
  
  const spread = ((lowestAsk - highestBid) / lowestAsk) * 100;
  return spread.toFixed(4);
}

/**
 * @swagger
 * /api/proposals/{id}:
 *   delete:
 *     summary: Delete proposal (requires wallet signature, creator only)
 *     description: Deletes a proposal. Only the proposal creator can delete it.
 *     tags: [Proposals]
 *     security:
 *       - WalletSignature: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: Proposal ID
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
 *         description: Proposal deleted successfully
 *       401:
 *         description: Invalid wallet signature
 *       403:
 *         description: Only proposal creator can delete
 *       404:
 *         description: Proposal not found
 */
router.delete('/:id', verifyWalletSignature, async (req, res) => {
  try {
    const io = req.app.get('io');
    
    // Check if proposal exists and user is the creator
    const existingProposal = await Proposal.findOne({ id: req.params.id });
    if (!existingProposal) {
      return res.status(404).json({ error: 'Proposal not found' });
    }
    
    if (existingProposal.creator.toLowerCase() !== req.userAddress) {
      return res.status(403).json({ error: 'Only proposal creator can delete this proposal' });
    }
    
    await Proposal.findOneAndDelete({ id: req.params.id });
    
    // Notify clients
    notifyProposalUpdate(io, { id: req.params.id, deleted: true });
    
    res.json({ message: 'Proposal deleted successfully' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * POST /api/proposals/:id/webhook/auctions
 * Public webhook. Updates YES and NO auction snapshots for a proposal.
 * Body: { yes?: AuctionSnapshot|null, no?: AuctionSnapshot|null }
 */
router.post('/:id/webhook/auctions', async (req, res) => {
  try {
    const id = req.params.id;
    let proposal = await Proposal.findOne({ id });
    if (!proposal) return res.status(404).json({ error: 'Proposal not found' });

    const allowed = [
      'auctionAddress','marketToken','pyusd','treasury','admin',
      'startTime','endTime','priceStart','minToOpen','cap',
      'currentPrice','tokensSold','maxTokenCap','minTokenCap',
      'finalized','isValid','isCanceled'
    ];

    const sanitize = (obj) => {
      if (obj === null) return null; // allow clearing
      if (typeof obj !== 'object') return undefined;
      const out = {};
      for (const k of allowed) if (obj[k] !== undefined) out[k] = obj[k];
      return out;
    };

    const updates = {};
    if ('yes' in req.body) updates['auctions.yes'] = sanitize(req.body.yes);
    if ('no' in req.body) updates['auctions.no'] = sanitize(req.body.no);

    if (Object.keys(updates).length === 0) {
      return res.status(400).json({ error: 'Nothing to update' });
    }

    // Update Proposal snapshot
    proposal = await Proposal.findOneAndUpdate(
      { id },
      { $set: updates },
      { new: true }
    );

    // Derive proposal-level start/end from auction snapshots when available
    const yesSnap = proposal?.auctions?.yes || {};
    const noSnap = proposal?.auctions?.no || {};
    const startCandidates = [Number(yesSnap.startTime), Number(noSnap.startTime)].filter(n => Number.isFinite(n) && n > 0);
    const endCandidates = [Number(yesSnap.endTime), Number(noSnap.endTime)].filter(n => Number.isFinite(n) && n > 0);
    const derivedStart = startCandidates.length ? Math.min(...startCandidates) : undefined;
    const derivedAuctionEnd = endCandidates.length ? Math.max(...endCandidates) : undefined;

    const setDerived = {};
    if (derivedStart !== undefined && (!proposal.startTime || proposal.startTime !== derivedStart)) {
      setDerived.startTime = derivedStart;
    }
    // While in auction, use auction end as proposal end fallback
    if (derivedAuctionEnd !== undefined) {
      if (!proposal.endTime || proposal.state === 'auction') {
        setDerived.endTime = derivedAuctionEnd;
      }
      // Also refresh duration if both times are known
      if (setDerived.startTime != null || proposal.startTime != null) {
        const s = setDerived.startTime != null ? setDerived.startTime : proposal.startTime;
        if (s != null && Number.isFinite(derivedAuctionEnd)) {
          setDerived.duration = Number(derivedAuctionEnd) - Number(s);
        }
      }
    }

    if (Object.keys(setDerived).length) {
      proposal = await Proposal.findOneAndUpdate(
        { id },
        { $set: setDerived },
        { new: true }
      );
    }

    // Also persist to Auction model per side and broadcast real-time updates
    const io = req.app.get('io');

    const upsertAuction = async (side, data) => {
      if (data === undefined) return;
      if (data === null) {
        // no-op for Auction documents (do not delete), just skip
        return;
      }
      const payload = {
        proposalId: String(id),
        side,
        auctionAddress: data.auctionAddress ?? undefined,
        marketToken: data.marketToken ?? undefined,
        pyusd: data.pyusd ?? undefined,
        treasury: data.treasury ?? undefined,
        admin: data.admin ?? undefined,
        startTime: data.startTime ?? undefined,
        endTime: data.endTime ?? undefined,
        priceStart: data.priceStart ?? undefined,
        minToOpen: data.minToOpen ?? undefined,
        cap: data.cap ?? undefined,
        currentPrice: data.currentPrice ?? undefined,
        tokensSold: data.tokensSold ?? undefined,
        maxTokenCap: data.maxTokenCap ?? undefined,
        minTokenCap: data.minTokenCap ?? undefined,
        finalized: typeof data.finalized === 'boolean' ? data.finalized : undefined,
        isValid: typeof data.isValid === 'boolean' ? data.isValid : undefined,
        isCanceled: typeof data.isCanceled === 'boolean' ? data.isCanceled : undefined
      };

      // Remove undefined keys to avoid overwriting with undefined
      Object.keys(payload).forEach(k => (payload[k] === undefined) && delete payload[k]);

      const auctionDoc = await Auction.findOneAndUpdate(
        { proposalId: String(id), side },
        { $set: payload, $setOnInsert: { proposalId: String(id), side } },
        { upsert: true, new: true, setDefaultsOnInsert: true }
      );

      // Broadcast auction update per side
      if (io) {
        notifyAuctionUpdate(io, {
          proposalId: String(id),
          side,
          metrics: {
            currentPrice: auctionDoc.currentPrice ?? auctionDoc.priceNow(),
            tokensSold: auctionDoc.tokensSold,
            maxTokenCap: auctionDoc.maxTokenCap ?? auctionDoc.cap,
            minTokenCap: auctionDoc.minTokenCap ?? auctionDoc.minToOpen
          },
          status: {
            finalized: auctionDoc.finalized,
            isValid: auctionDoc.isValid,
            isCanceled: auctionDoc.isCanceled
          }
        });
      }
    };

    await Promise.all([
      upsertAuction('yes', updates['auctions.yes']),
      upsertAuction('no', updates['auctions.no'])
    ]);

    // Broadcast proposal update
    if (io) notifyProposalUpdate(io, proposal);

    res.json({ id: proposal.id, auctions: proposal.auctions, timestamp: new Date().toISOString() });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
