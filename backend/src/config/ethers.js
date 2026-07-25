try { require('dotenv').config(); } catch (_) {}
const { ethers } = require('ethers');

// Ethers provider/signer wiring using env vars.
// - RPC_WS_URL: optional WebSocket endpoint for realtime events (preferred)
// - RPC_URL: HTTP JSON-RPC endpoint (fallback)
// - PRIVATE_KEY: signer private key (for writes)
// - CHAIN_ID: optional chain id (number)

let provider;
let signer; // Optional, only if PRIVATE_KEY is set

function getProvider() {
  if (!provider) {
    const chainId = process.env.CHAIN_ID ? Number(process.env.CHAIN_ID) : undefined;
    const ws = process.env.RPC_WS_URL;
    const http = process.env.RPC_URL;

    if (ws && ws.length > 0) {
      provider = new ethers.WebSocketProvider(ws, chainId);
    } else if (http && http.length > 0) {
      provider = new ethers.JsonRpcProvider(http, chainId);
    } else {
      throw new Error('RPC_URL or RPC_WS_URL must be set');
    }
  }
  return provider;
}

function getSigner() {
  if (signer) return signer;
  const pk = process.env.PRIVATE_KEY;
  if (!pk) return null;
  const prov = getProvider();
  const base = new ethers.Wallet(pk, prov);
  // Wrap with NonceManager to avoid nonce-too-low when multiple txs are sent quickly
  try {
    signer = new ethers.NonceManager(base);
  } catch (_) {
    signer = base; // fallback
  }
  return signer;
}

async function getWalletAddress() {
  const s = getSigner();
  if (!s) return null;
  return await s.getAddress();
}

async function getChainId() {
  if (process.env.CHAIN_ID) return Number(process.env.CHAIN_ID);
  const net = await getProvider().getNetwork();
  const id = net?.chainId;
  return typeof id === 'bigint' ? Number(id) : Number(id || 0);
}

module.exports = {
  getProvider,
  getSigner,
  getWalletAddress,
  getChainId
};
