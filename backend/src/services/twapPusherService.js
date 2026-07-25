// Computes volume-weighted TWAPs from Aqua fills and pushes them on-chain so
// Proposal.resolve() can settle the market. The attestor key signs the pushes.
// Comments simple in English
const { ethers } = require('ethers');
const Order = require('../models/Order');
const ProposalModel = require('../models/Proposal');

const PROPOSAL_ABI = [
  'function updateTwap(uint256 _twapYes, uint256 _twapNo) external',
  'function state() view returns (uint8)'
];

/// Volume-weighted average price from filled Aqua lots.
/// fills: [{ price: string (USDC 6d per 1e18 token), amount: string (token 18d) }]
/// Returns BigInt price (6d) or null when there are no fills.
function computeTwap(fills) {
  let notional = 0n; // sum(price * amount)
  let volume = 0n;   // sum(amount)
  for (const f of fills) {
    const price = BigInt(f.price || '0');
    const amount = BigInt(f.amount || '0');
    if (amount === 0n) continue;
    notional += price * amount;
    volume += amount;
  }
  if (volume === 0n) return null;
  return notional / volume;
}

/// Collect filled lots for a proposal side within the window (ms).
async function fillsForSide(proposalId, side, windowMs) {
  const since = new Date(Date.now() - windowMs);
  const orders = await Order.find({
    proposalId: String(proposalId),
    side,
    status: 'filled',
    strategyHash: { $ne: null },
    updatedAt: { $gte: since },
  }).select('price filledAmount').lean();
  return orders.map((o) => ({ price: o.price, amount: o.filledAmount }));
}

/// One pass: for each live proposal with fills, push TWAPs on-chain.
async function pushOnce({ provider, signer, windowMs = 6 * 60 * 60 * 1000 }) {
  const live = await ProposalModel.find({ state: 'live' })
    .select('id proposalAddress').lean();
  const results = [];

  for (const p of live) {
    if (!p.proposalAddress) continue;
    const [yesFills, noFills] = await Promise.all([
      fillsForSide(p.id, 'approve', windowMs),
      fillsForSide(p.id, 'reject', windowMs),
    ]);
    const twapYes = computeTwap(yesFills);
    const twapNo = computeTwap(noFills);
    if (twapYes === null && twapNo === null) continue; // nothing traded yet

    const proposal = new ethers.Contract(p.proposalAddress, PROPOSAL_ABI, signer);
    try {
      const tx = await proposal.updateTwap(twapYes ?? 0n, twapNo ?? 0n);
      const receipt = await tx.wait();
      results.push({ proposalId: p.id, twapYes, twapNo, txHash: receipt.hash });
    } catch (e) {
      console.error(`twap push failed for proposal ${p.id}:`, e.message);
      // A cached NonceManager count drifts when another sender uses the same
      // key (or a tx is dropped), and every later push then fails the same
      // way. Resync so the next interval starts from the chain's nonce.
      if (/nonce/i.test(e.message) && typeof signer.reset === 'function') {
        signer.reset();
      }
    }
  }
  return results;
}

let timer = null;

/// Periodic pusher; attestor signer comes from config/ethers (PRIVATE_KEY).
function startTwapPusher({ provider, signer, intervalMs = Number(process.env.TWAP_PUSH_MS || 60000) }) {
  if (timer) clearInterval(timer);
  timer = setInterval(() => {
    pushOnce({ provider, signer }).catch((e) => console.error('twap pusher error:', e.message));
  }, intervalMs);
  return () => { clearInterval(timer); timer = null; };
}

module.exports = { computeTwap, fillsForSide, pushOnce, startTwapPusher };
