const express = require('express');
const router = express.Router();
const { getWalletAddress, getChainId } = require('../config/ethers');
const { syncProposalsFromManager, syncProposalsFromManagerFast, syncProposalByAddress } = require('../services/chainService');

/**
 * @swagger
 * tags:
 *   name: Chain
 *   description: EVM chain info (read-only)
 */

/**
 * @swagger
 * /api/chain/info:
 *   get:
 *     summary: Get public signer address, chain id, and ProposalManager address
 *     tags: [Chain]
 *     responses:
 *       200:
 *         description: Address, chain id, and ProposalManager
 */
router.get('/info', async (_req, res) => {
  try {
    const [address, chainId] = await Promise.all([
      getWalletAddress(),
      getChainId()
    ]);
    const proposalManagerAddress = process.env.PROPOSAL_MANAGER_ADDRESS || null;
    res.json({ address, chainId, proposalManagerAddress });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;

/**
 * @swagger
 * /api/chain/sync/proposals:
 *   post:
 *     summary: Force-sync proposals from ProposalManager into DB
 *     description: Calls the on-chain ProposalManager, then reads each Proposal contract and upserts into MongoDB.
 *     tags: [Chain]
 *     responses:
 *       200:
 *         description: Sync results per proposal
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 manager:
 *                   type: string
 *                 results:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       address:
 *                         type: string
 *                       id:
 *                         type: string
 *                       action:
 *                         type: string
 *                       error:
 *                         type: string
 */
router.post('/sync/proposals', async (_req, res) => {
  try {
    const manager = process.env.PROPOSAL_MANAGER_ADDRESS;
    if (!manager) return res.status(400).json({ error: 'PROPOSAL_MANAGER_ADDRESS not configured' });
    const results = await syncProposalsFromManagerFast({ manager });
    res.json({ manager, results });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

/**
 * @swagger
 * /api/chain/sync/proposals/fast:
 *   post:
 *     summary: Fast sync proposals from ProposalManager (direct processing like frontend)
 *     description: Uses optimized processing that mirrors frontend useGetAllProposals behavior
 *     tags: [Chain]
 *     responses:
 *       200:
 *         description: Fast sync results per proposal
 */
router.post('/sync/proposals/fast', async (_req, res) => {
  try {
    const manager = process.env.PROPOSAL_MANAGER_ADDRESS;
    if (!manager) return res.status(400).json({ error: 'PROPOSAL_MANAGER_ADDRESS not configured' });
    const results = await syncProposalsFromManagerFast({ manager });
    res.json({ manager, results, method: 'fast' });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

/**
 * @swagger
 * /api/chain/sync/proposals/legacy:
 *   post:
 *     summary: Legacy sync proposals from ProposalManager (individual contract calls)
 *     description: Uses the original method with individual contract calls
 *     tags: [Chain]
 *     responses:
 *       200:
 *         description: Legacy sync results per proposal
 */
router.post('/sync/proposals/legacy', async (_req, res) => {
  try {
    const manager = process.env.PROPOSAL_MANAGER_ADDRESS;
    if (!manager) return res.status(400).json({ error: 'PROPOSAL_MANAGER_ADDRESS not configured' });
    const results = await syncProposalsFromManager({ manager });
    res.json({ manager, results, method: 'legacy' });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

/**
 * @swagger
 * /api/chain/sync/proposal/{address}:
 *   post:
 *     summary: Force-sync a single Proposal by contract address
 *     tags: [Chain]
 *     parameters:
 *       - in: path
 *         name: address
 *         required: true
 *         schema:
 *           type: string
 *         description: Proposal contract address
 *     responses:
 *       200:
 *         description: Sync result
 */
router.post('/sync/proposal/:address', async (req, res) => {
  try {
    const { address } = req.params;
    if (!address) return res.status(400).json({ error: 'address required' });
    const result = await syncProposalByAddress(String(address).toLowerCase());
    res.json(result);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});
