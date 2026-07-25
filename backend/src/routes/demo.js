// Demo routes — fork-only helpers that drive scripted wallet activity so a
// full proposal lifecycle can be shown in about a minute. Refuses to run on
// anything but the local anvil fork.
// Comments simple in English
const express = require('express');
const router = express.Router();
const Proposal = require('../models/Proposal');
const { runAuctionDemo, runMarketDemo, getRun } = require('../services/demoService');

function forkOnly(req, res, next) {
  if (Number(process.env.CHAIN_ID) !== 31337) {
    return res.status(403).json({ error: 'demo runner is fork-only (CHAIN_ID must be 31337)' });
  }
  next();
}

async function findProposal(id) {
  return Proposal.findOne({ $or: [{ proposalContractId: String(id) }, { id: Number(id) }] });
}

router.post('/:id/auction', forkOnly, async (req, res) => {
  try {
    const doc = await findProposal(req.params.id);
    if (!doc?.proposalAddress) return res.status(404).json({ error: 'proposal not found' });
    // fire and forget — progress is polled via /status
    runAuctionDemo(doc.proposalAddress, req.params.id).catch(() => {});
    res.json({ started: true });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

router.post('/:id/market', forkOnly, async (req, res) => {
  try {
    const doc = await findProposal(req.params.id);
    if (!doc?.proposalAddress) return res.status(404).json({ error: 'proposal not found' });
    runMarketDemo(doc.proposalAddress, req.params.id).catch(() => {});
    res.json({ started: true });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

router.get('/:id/status', forkOnly, (req, res) => {
  res.json({
    auction: getRun(req.params.id, 'auction'),
    market: getRun(req.params.id, 'market'),
  });
});

module.exports = router;
