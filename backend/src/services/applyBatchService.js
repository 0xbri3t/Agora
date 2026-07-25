// Minimal service to send Proposal.applyBatch for each matched fill
// Comments short in English

const { ethers } = require('ethers');
const { getProvider, getSigner } = require('../config/ethers');
const ProposalABI = require('../abi/Proposal.json').abi;

// Minimal ERC20 ABI
const ERC20_MIN_ABI = [
  'function decimals() view returns (uint8)',
  'function balanceOf(address) view returns (uint256)',
  'function allowance(address owner, address spender) view returns (uint256)'
];

function sideToKey(side) { return side === 'approve' ? 'yes' : 'no'; }

async function getDecimals(address) {
  const provider = getProvider();
  const c = new ethers.Contract(address, ERC20_MIN_ABI, provider);
  try { return Number(await c.decimals()); } catch (_) { return 18; }
}

async function getOrderBook(proposalId, side) {
  try {
    const OrderBook = require('../models/OrderBook');
    return await OrderBook.findOne({ proposalId, side }).lean();
  } catch (_) { return null; }
}

async function getTwapScaled(proposalId, side, pyusdDec) {
  try {
    const ob = await getOrderBook(proposalId, side);
    const twap = ob?.twap1h || '0';
    if (!twap || Number(twap) <= 0) return 0n;
    return ethers.parseUnits(String(twap), pyusdDec);
  } catch (_) { return 0n; }
}

async function resolveEffectivePrice({ proposalId, side, buyOrder, sellOrder, inputPrice }) {
  const p = String(inputPrice ?? '').toLowerCase();
  if (p && p !== 'market' && Number(p) > 0) return String(inputPrice);
  if (sellOrder?.price && Number(sellOrder.price) > 0) return String(sellOrder.price);
  if (buyOrder?.price && Number(buyOrder.price) > 0) return String(buyOrder.price);
  const ob = await getOrderBook(String(proposalId), side);
  if (ob?.lastPrice && Number(ob.lastPrice) > 0) return String(ob.lastPrice);
  return '0';
}

async function buildTradeOp({ proposalDoc, side, buyOrder, sellOrder, price, amount }) {
  if (!proposalDoc?.proposalAddress) throw new Error('Proposal not synced with chain');
  
  const key = sideToKey(side);
  
  // Get token addresses like frontend and orderbooks.js - first from direct fields
  let tokenAddr;
  let pyusdAddr = process.env.PYUSD_ADDRESS;
  
  if (key === 'yes') {
    tokenAddr = proposalDoc.yesToken;
  } else if (key === 'no') {
    tokenAddr = proposalDoc.noToken;
  }
  
  // Fallback to auctions structure if direct fields not available
  if (!tokenAddr && proposalDoc.auctions?.[key]?.marketToken) {
    tokenAddr = proposalDoc.auctions[key].marketToken;
  }
  
  // If still no token address, try to sync proposal (BLOCKING - last resort)
  if (!tokenAddr) {
    console.log(`[applyBatch] Token address missing for ${side}, attempting sync of ${proposalDoc.proposalAddress}`);
    try {
      const { syncProposalByAddress } = require('./chainService');
      await syncProposalByAddress(proposalDoc.proposalAddress);
      
      // Reload proposal data
      const ProposalModel = require('../models/Proposal');
      const fresh = await ProposalModel.findOne({ 
        proposalAddress: proposalDoc.proposalAddress.toLowerCase() 
      }).lean();
      
      if (fresh) {
        if (key === 'yes') {
          tokenAddr = fresh.yesToken;
        } else if (key === 'no') {
          tokenAddr = fresh.noToken;
        }
        
        // Still try auctions as fallback
        if (!tokenAddr && fresh.auctions?.[key]?.marketToken) {
          tokenAddr = fresh.auctions[key].marketToken;
        }
      }
    } catch (e) {
      console.error('[applyBatch] Error syncing proposal:', e.message);
    }
  }
  
  if (!tokenAddr) {
    throw new Error(`Market token address not available for side '${side}' on this proposal`);
  }
  
  if (!pyusdAddr) {
    throw new Error('PyUSD address not configured in environment');
  }

  const [tokenDec, pyusdDec] = await Promise.all([
    getDecimals(tokenAddr),
    getDecimals(pyusdAddr)
  ]);

  const effectivePrice = await resolveEffectivePrice({
    proposalId: String(proposalDoc.id),
    side,
    buyOrder,
    sellOrder,
    inputPrice: price
  });

  const tokenAmount = ethers.parseUnits(String(amount), tokenDec);
  const priceUnits = ethers.parseUnits(String(effectivePrice), pyusdDec);
  const scale = 10n ** BigInt(tokenDec);
  const pyUsdAmount = (priceUnits * tokenAmount) / scale;

  // TWAP scaled in pyUSD decimals
  let twapPrice = await getTwapScaled(String(proposalDoc.id), side, pyusdDec);
  if (!twapPrice || twapPrice <= 0n) twapPrice = priceUnits;

  return {
    outcomeToken: tokenAddr,
    tokenAmount,
    pyUsdAmount,
    twapPrice,
    buyer: buyOrder.userAddress,
    seller: sellOrder.userAddress
  };
}

function parseGwei(v) {
  try { return ethers.parseUnits(String(v), 9); } catch (_) { return undefined; }
}

// --- Simple in-process tx queue to prevent nonce races ---
let txQueue = Promise.resolve();
function enqueueTx(fn) { txQueue = txQueue.then(fn, fn); return txQueue; }

async function sendApplyBatch(proposalAddress, ops) {
  const signer = getSigner();
  if (!signer) throw new Error('Signer not configured');
  const provider = getProvider();
  const contract = new ethers.Contract(proposalAddress, ProposalABI, signer);

  // Format ops for ABI in correct order
  const payload = ops.map(op => ({
    seller: op.seller,
    buyer: op.buyer,
    outcomeToken: op.outcomeToken,
    tokenAmount: op.tokenAmount,
    pyUsdAmount: op.pyUsdAmount,
    twapPrice: op.twapPrice
  }));

  // Gas overrides from env (EIP-1559)
  const overrides = {};
  if (process.env.MAX_FEE_PER_GAS) {
    const v = parseGwei(process.env.MAX_FEE_PER_GAS);
    if (v) overrides.maxFeePerGas = v;
  }
  if (process.env.MAX_PRIORITY_FEE_PER_GAS) {
    const v = parseGwei(process.env.MAX_PRIORITY_FEE_PER_GAS);
    if (v) overrides.maxPriorityFeePerGas = v;
  }
  if (process.env.GAS_LIMIT) {
    try { overrides.gasLimit = BigInt(process.env.GAS_LIMIT); } catch (_) {}
  }

  // Pre-check: proposal state must be Live and signer must be attestor
  try {
    const pc = new ethers.Contract(proposalAddress, ProposalABI, provider);
    const [state, attestor, signerAddr] = await Promise.all([
      pc.state().catch(() => 0),
      pc.attestor ? pc.attestor().catch(() => ethers.ZeroAddress) : ethers.ZeroAddress,
      signer.getAddress(),
    ]);
    if (attestor && attestor !== ethers.ZeroAddress && String(attestor).toLowerCase() !== String(signerAddr).toLowerCase()) {
      throw new Error('Signer is not attestor');
    }
  } catch (e) {
    throw e;
  }

  // Estimate gas if possible
  try {
    const est = await contract.applyBatch.estimateGas(payload, overrides);
    if (!overrides.gasLimit) overrides.gasLimit = est;
  } catch (_) {}

  // Send with queue + retry/bump for NONCE_EXPIRED/UNDERPRICED
  let fee = await provider.getFeeData().catch(() => ({}));
  let maxFeePerGas = overrides.maxFeePerGas || fee.maxFeePerGas || ethers.parseUnits(String(process.env.MAX_FEE_PER_GAS || '30'), 9);
  let maxPriorityFeePerGas = overrides.maxPriorityFeePerGas || fee.maxPriorityFeePerGas || ethers.parseUnits(String(process.env.MAX_PRIORITY_FEE_PER_GAS || '2'), 9);
  const maxAttempts = Number(process.env.TX_RETRY_ATTEMPTS || 4);
  const bumpBps = Number(process.env.TX_BUMP_BPS || 1500);

  async function attemptSend() {
    let nonce;
    try { nonce = await provider.getTransactionCount(await signer.getAddress(), 'pending'); } catch {}
    for (let i = 1; i <= maxAttempts; i++) {
      try {
        const tx = await contract.applyBatch(payload, { ...overrides, maxFeePerGas, maxPriorityFeePerGas, nonce });
        return { hash: tx.hash };
      } catch (e) {
        const msg = e?.message || '';
        const code = e?.code || '';
        const underpriced = code === 'REPLACEMENT_UNDERPRICED' || msg.includes('underpriced') || msg.includes('fee too low');
        const nonceExpired = code === 'NONCE_EXPIRED' || msg.includes('nonce has already been used') || msg.includes('nonce too low');
        if (!(underpriced || nonceExpired) || i === maxAttempts) throw e;
        if (nonceExpired) { try { nonce = await provider.getTransactionCount(await signer.getAddress(), 'pending'); } catch {} }
        // bump fees
        const bumpFactorN = BigInt(10000 + bumpBps);
        maxFeePerGas = (maxFeePerGas || ethers.parseUnits('30', 9)) * bumpFactorN / 10000n;
        maxPriorityFeePerGas = (maxPriorityFeePerGas || ethers.parseUnits('2', 9)) * bumpFactorN / 10000n;
        await new Promise(r => setTimeout(r, 250));
      }
    }
  }

  return enqueueTx(() => attemptSend());
}

async function submitFillToChain({ proposalId, side, buyOrder, sellOrder, price, amount }) {
  const ProposalModel = require('../models/Proposal');
  
  // proposalId can be: internal id, contract id (string), or address
  let proposalDoc;
  try {
    const pidNum = Number(proposalId);
    const clauses = [{ proposalContractId: String(proposalId) }];
    if (!Number.isNaN(pidNum)) clauses.push({ id: pidNum });
    if (/^0x[a-fA-F0-9]{40}$/.test(String(proposalId))) {
      clauses.push({ proposalAddress: String(proposalId).toLowerCase() });
    }
    proposalDoc = await ProposalModel.findOne({ $or: clauses }).lean();
  } catch (e) {
    console.error(`[applyBatch] Error finding proposal: ${e.message}`);
  }
  
  if (!proposalDoc?.proposalAddress) {
    throw new Error(`Proposal ${proposalId} not found or missing address`);
  }

  const op = await buildTradeOp({ proposalDoc, side, buyOrder, sellOrder, price, amount });
  const res = await sendApplyBatch(proposalDoc.proposalAddress, [op]);
  return res; // { hash }
}

module.exports = {
  submitFillToChain,
  buildTradeOp,
  sendApplyBatch
};
