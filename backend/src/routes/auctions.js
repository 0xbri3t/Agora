const express = require('express');
const router = express.Router();
const Auction = require('../models/Auction');
const Proposal = require('../models/Proposal');
const rateLimit = require('../middleware/rateLimit');

// GET-only. Data is periodically synced from chain into DB by a separate job.
router.use(rateLimit);

// Compute extra fields for responses
function serializeAuction(aDoc) {
  const a = aDoc.toObject ? aDoc.toObject() : aDoc;
  const nowSec = Math.floor(Date.now() / 1000);
  const priceNow = aDoc.priceNow ? aDoc.priceNow() : '0';
  return {
    ...a,
    computed: {
      priceNow,
      isLive: aDoc.isLive ? aDoc.isLive() : (nowSec >= a.startTime && nowSec <= a.endTime && !a.finalized),
      secondsToEnd: Math.max(0, a.endTime - nowSec)
    }
  };
}

/**
 * GET /api/auctions/:proposalId/:side
 * Public read-only auction data for a proposal side.
 */
router.get('/:proposalId/:side', async (req, res) => {
  try {
    const { proposalId, side } = req.params;
    if (!['yes', 'no'].includes(side)) return res.status(400).json({ error: 'Invalid side' });

    const [auction, proposal] = await Promise.all([
      Auction.findOne({ proposalId: String(proposalId), side }),
      Proposal.findOne({ id: proposalId })
    ]);

    if (!auction) return res.status(404).json({ error: 'Auction not found' });

    res.json({
      proposalId: String(proposalId),
      side,
      auction: serializeAuction(auction),
      proposalAuctions: proposal && proposal.auctions ? proposal.auctions : null,
      timestamp: new Date().toISOString()
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
