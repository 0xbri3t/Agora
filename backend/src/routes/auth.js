const express = require('express');
const router = express.Router();
const { generateAuthMessage } = require('../middleware/walletAuth');

/**
 * @swagger
 * tags:
 *   name: Authentication
 *   description: Wallet authentication endpoints
 */

/**
 * @swagger
 * /api/auth/message:
 *   post:
 *     summary: Generate authentication message to sign
 *     tags: [Authentication]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               address:
 *                 type: string
 *                 description: Wallet address
 *             required:
 *               - address
 *     responses:
 *       200:
 *         description: Message to sign
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 message:
 *                   type: string
 *                 timestamp:
 *                   type: number
 *       400:
 *         description: Invalid address
 */
router.post('/message', (req, res) => {
  try {
    const { address } = req.body;
    
    if (!address) {
      return res.status(400).json({ error: 'Address required' });
    }

    const { message, timestamp } = generateAuthMessage(address);
    
    res.json({
      message,
      timestamp,
      instructions: 'Sign this message with your wallet to authenticate'
    });
  } catch (error) {
    console.error('Generate message error:', error);
    res.status(500).json({ error: 'Failed to generate message' });
  }
});

/**
 * @swagger
 * /api/auth/verify:
 *   post:
 *     summary: Verify wallet signature
 *     tags: [Authentication]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               address:
 *                 type: string
 *               signature:
 *                 type: string
 *               message:
 *                 type: string
 *               timestamp:
 *                 type: number
 *             required:
 *               - address
 *               - signature  
 *               - message
 *               - timestamp
 *     responses:
 *       200:
 *         description: Authentication successful
 *       401:
 *         description: Authentication failed
 */
router.post('/verify', require('../middleware/walletAuth').verifyWalletSignature, (req, res) => {
  res.json({
    success: true,
    address: req.userAddress,
    message: 'Wallet authenticated successfully'
  });
});

module.exports = router;
