const { ethers } = require('ethers');

/**
 * Core signed-message verification shared by HTTP middleware and WebSocket auth.
 * Returns { ok: true, address } or { ok: false, error }.
 */
const verifySignedMessage = ({ address, signature, message, timestamp, ttlMs }) => {
  if (!address || !signature || !message || !timestamp) {
    return { ok: false, error: 'Missing auth fields' };
  }

  if (Date.now() - parseInt(timestamp) > ttlMs) {
    return { ok: false, error: 'Message timestamp too old. Please sign a new message.' };
  }

  const expectedMessage = `FutarFi Authentication\nAddress: ${address}\nTimestamp: ${timestamp}`;
  if (message !== expectedMessage) {
    return { ok: false, error: 'Invalid message format', expected: expectedMessage };
  }

  try {
    const recoveredAddress = ethers.verifyMessage(message, signature);
    if (recoveredAddress.toLowerCase() !== address.toLowerCase()) {
      return { ok: false, error: 'Invalid signature. Recovered address does not match provided address.' };
    }
  } catch (_) {
    return { ok: false, error: 'Invalid signature format or verification failed.' };
  }

  return { ok: true, address: address.toLowerCase() };
};

/**
 * Verify wallet signature middleware
 * Requires: address, signature, message, timestamp
 */
const verifyWalletSignature = async (req, res, next) => {
  try {
    const { address, signature, message, timestamp } = req.body;

    if (!address || !signature || !message || !timestamp) {
      return res.status(401).json({
        error: 'Wallet authentication required',
        required: ['address', 'signature', 'message', 'timestamp']
      });
    }

    // Configurable TTL (default 1 hour)
    const AUTH_TTL_MS = Number(process.env.AUTH_MESSAGE_TTL_MS || process.env.WALLET_AUTH_TTL_MS || 60 * 60 * 1000);

    const result = verifySignedMessage({ address, signature, message, timestamp, ttlMs: AUTH_TTL_MS });
    if (!result.ok) {
      const payload = { error: result.error };
      if (result.error.includes('timestamp')) payload.ttlMs = AUTH_TTL_MS;
      if (result.expected) payload.expected = result.expected;
      return res.status(401).json(payload);
    }

    // Add verified address to request for next middleware
    req.userAddress = result.address;
    next();
  } catch (error) {
    console.error('Wallet verification error:', error);
    return res.status(500).json({
      error: 'Internal server error during wallet verification.'
    });
  }
};

/**
 * Generate message to sign
 */
const generateAuthMessage = (address) => {
  const timestamp = Date.now();
  const message = `FutarFi Authentication\nAddress: ${address}\nTimestamp: ${timestamp}`;
  return { message, timestamp };
};

module.exports = {
  verifySignedMessage,
  verifyWalletSignature,
  generateAuthMessage
};
