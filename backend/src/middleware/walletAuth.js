const { ethers } = require('ethers');

/**
 * Verify wallet signature middleware
 * Requires: address, signature, message, timestamp
 */
const verifyWalletSignature = async (req, res, next) => {
  try {
    const { address, signature, message, timestamp } = req.body;

    // Check required fields
    if (!address || !signature || !message || !timestamp) {
      return res.status(401).json({ 
        error: 'Wallet authentication required',
        required: ['address', 'signature', 'message', 'timestamp']
      });
    }

    // Configurable TTL (default 1 hour)
    const AUTH_TTL_MS = Number(process.env.AUTH_MESSAGE_TTL_MS || process.env.WALLET_AUTH_TTL_MS || 60 * 60 * 1000);

    // Check timestamp not too old
    const currentTime = Date.now();
    const messageTime = parseInt(timestamp);

    if (currentTime - messageTime > AUTH_TTL_MS) {
      return res.status(401).json({ 
        error: 'Message timestamp too old. Please sign a new message.',
        ttlMs: AUTH_TTL_MS
      });
    }

    // Verify message format
    const expectedMessage = `FutarFi Authentication\nAddress: ${address}\nTimestamp: ${timestamp}`;
    
    if (message !== expectedMessage) {
      return res.status(401).json({ 
        error: 'Invalid message format',
        expected: expectedMessage
      });
    }

    try {
      // Verify signature
      const recoveredAddress = ethers.verifyMessage(message, signature);
      
      if (recoveredAddress.toLowerCase() !== address.toLowerCase()) {
        return res.status(401).json({ 
          error: 'Invalid signature. Recovered address does not match provided address.'
        });
      }

      // Add verified address to request for next middleware
      req.userAddress = address.toLowerCase();
      next();

    } catch (signatureError) {
      return res.status(401).json({ 
        error: 'Invalid signature format or verification failed.'
      });
    }

  } catch (error) {
    console.error('Wallet verification error:', error);
    return res.status(500).json({ 
      error: 'Internal server error during wallet verification.'
    });
  }
};

// Require wallet address middleware (no signature verification)
const requireWalletAddress = (req, res, next) => {
  const address = req.query.address || req.body.address || req.headers['x-wallet-address'];
  
  if (!address) {
    return res.status(401).json({ 
      error: 'Wallet address required',
      hint: 'Include address in query params, body, or x-wallet-address header'
    });
  }

  // Validate Ethereum address format
  if (!ethers.isAddress(address)) {
    return res.status(400).json({ 
      error: 'Invalid wallet address format'
    });
  }

  req.userAddress = address.toLowerCase();
  next();
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
  verifyWalletSignature,
  requireWalletAddress,
  generateAuthMessage
};
