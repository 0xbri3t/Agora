const express = require('express');
const router = express.Router();
const { getInsights } = require('../services/copilotService');

/**
 * @swagger
 * tags:
 *   name: Copilot
 *   description: Futarchy copilot — live market reasoning over The Graph subgraph
 */

/**
 * @swagger
 * /api/copilot/{proposalId}/insights:
 *   get:
 *     summary: Implied probability, YES+NO arbitrage scan and TWAP trend for a proposal
 *     tags: [Copilot]
 *     parameters:
 *       - in: path
 *         name: proposalId
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Insight bundle with a plain-language summary
 *       404:
 *         description: Unknown proposal
 */
router.get('/:proposalId/insights', async (req, res) => {
  try {
    const insights = await getInsights(req.params.proposalId);
    if (!insights) return res.status(404).json({ error: 'proposal not found' });
    res.json(insights);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

/**
 * @swagger
 * /api/copilot/{proposalId}/ask:
 *   post:
 *     summary: Ask the copilot a free-form question grounded in live market data
 *     tags: [Copilot]
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
 *             properties:
 *               question:
 *                 type: string
 *     responses:
 *       200:
 *         description: Grounded answer (LLM when ANTHROPIC_API_KEY is set, deterministic summary otherwise)
 */
router.post('/:proposalId/ask', async (req, res) => {
  try {
    const question = (req.body && req.body.question || '').trim();
    if (!question) return res.status(400).json({ error: 'question required' });

    const insights = await getInsights(req.params.proposalId);
    if (!insights) return res.status(404).json({ error: 'proposal not found' });

    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      // No LLM configured — the deterministic reading still answers most questions.
      return res.json({ answer: insights.summary, insights, llm: false });
    }

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: process.env.COPILOT_MODEL || 'claude-sonnet-5',
        max_tokens: 600,
        system:
          'You are the Agora futarchy copilot. Answer ONLY from the market data JSON provided. ' +
          'Prices are USDC with 6 decimals per 1e18 outcome token. Be concise and concrete; ' +
          'if the data cannot answer the question, say so.',
        messages: [{
          role: 'user',
          content: `Market data:\n${JSON.stringify(insights, null, 2)}\n\nQuestion: ${question}`,
        }],
      }),
    });
    if (!response.ok) {
      const body = await response.text();
      throw new Error(`anthropic api ${response.status}: ${body.slice(0, 200)}`);
    }
    const completion = await response.json();
    const answer = completion.content
      .filter((block) => block.type === 'text')
      .map((block) => block.text)
      .join('\n');
    res.json({ answer, insights, llm: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
