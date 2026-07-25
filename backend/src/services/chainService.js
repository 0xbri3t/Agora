// Simple chain service using ethers v6
// - Read helpers (contract view calls)
// - Write helper (internal only) with retry/fee-bump
// - Batch execute for future filled orders array
// - A monitor skeleton to watch filled orders and execute on-chain internally
// Comments kept simple in English

const { ethers } = require('ethers');
const { getProvider, getSigner } = require('../config/ethers');

// Load ABIs from JSON files (kept minimal)
const PM_ABI = require('../abi/ProposalManager.json').abi;
const PROPOSAL_ABI = require('../abi/Proposal.json').abi;
const AUCTION_ABI = require('../abi/DutchAuction.json').abi;
const TOKEN_MIN_ABI = require('../abi/MarketToken.json').abi;

function getContract(address, abi, withSigner = false) {
  const provider = getProvider();
  const runner = withSigner ? (getSigner() || provider) : provider;
  return new ethers.Contract(address, abi, runner);
}

// Minimal iface for ProposalCreated event
const PM_EVENT_ABI = [
  {
    type: 'event',
    name: 'ProposalCreated',
    inputs: [
      { indexed: true, name: 'id', type: 'uint256' },
      { indexed: true, name: 'admin', type: 'address' },
      { indexed: false, name: 'proposal', type: 'address' },
      { indexed: false, name: 'title', type: 'string' }
    ]
  }
];
const PM_EVENT_IFACE = new ethers.Interface(PM_EVENT_ABI);
const PM_EVENT_SIGNATURE = 'ProposalCreated(uint256,address,address,string)';
const PM_EVENT_TOPIC = ethers.id(PM_EVENT_SIGNATURE);

async function callView({ address, abi, method, args = [] }) {
  if (!address || !abi || !method) throw new Error('Missing contract call params');
  const contract = getContract(address, abi, false);
  return await contract[method](...args);
}

// Helper: wait for receipt with timeout and polling
async function waitForReceiptWithTimeout(provider, txHash, { timeoutMs = Number(process.env.TX_WAIT_TIMEOUT_MS || 60000), pollMs = 1500 } = {}) {
  const start = Date.now();
  while (true) {
    const rcpt = await provider.getTransactionReceipt(txHash).catch(() => null);
    if (rcpt) return rcpt;
    if (Date.now() - start > timeoutMs) return null; // timeout
    await new Promise(r => setTimeout(r, pollMs));
  }
}

// --- Simple in-process tx queue to prevent nonce races ---
let txQueue = Promise.resolve();
function enqueueTx(fn) {
  txQueue = txQueue.then(fn, fn);
  return txQueue;
}

// --- Enhanced sendTx with EIP-1559 bumping and explicit pending/replaceable nonce ---
async function sendTxInner({ address, abi, method, args = [], overrides = {} }) {
  const signer = getSigner();
  if (!signer) throw new Error('No signer configured');
  const contract = getContract(address, abi, true);
  const provider = getProvider();

  // Base fee data
  let fee = await provider.getFeeData().catch(() => ({ }));
  let maxFeePerGas = overrides.maxFeePerGas || fee.maxFeePerGas || ethers.parseUnits(String(process.env.MAX_FEE_PER_GAS || '30'), 9);
  let maxPriorityFeePerGas = overrides.maxPriorityFeePerGas || fee.maxPriorityFeePerGas || ethers.parseUnits(String(process.env.MAX_PRIORITY_FEE_PER_GAS || '2'), 9);

  // Estimate gas
  let gasLimit;
  try {
    gasLimit = await contract[method].estimateGas(...args, { ...overrides, maxFeePerGas, maxPriorityFeePerGas });
  } catch (_) { /* ignore */ }

  // Choose a nonce that can replace oldest pending if any
  const from = await signer.getAddress();
  let nonce = overrides.nonce;
  if (nonce === undefined) {
    try {
      const [latest, pending] = await Promise.all([
        provider.getTransactionCount(from, 'latest'),
        provider.getTransactionCount(from, 'pending'),
      ]);
      nonce = pending > latest ? latest : pending; // replace oldest pending when exists
    } catch {
      try { nonce = await provider.getTransactionCount(from, 'pending'); } catch { /* ignore */ }
    }
  }

  const maxAttempts = Number(process.env.TX_RETRY_ATTEMPTS || 4);
  const bumpBps = Number(process.env.TX_BUMP_BPS || 2000); // 20%

  let lastErr;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const tx = await contract[method](...args, {
        ...overrides,
        gasLimit,
        maxFeePerGas,
        maxPriorityFeePerGas,
        nonce,
      });
      // Wait with timeout; if timed out, try to replace
      const rcpt = await waitForReceiptWithTimeout(provider, tx.hash);
      if (rcpt) return { hash: tx.hash, receipt: rcpt };
      // timeout: bump fees and try replacement using same nonce
      const bumpFactorN = BigInt(10000 + bumpBps);
      maxFeePerGas = (maxFeePerGas || ethers.parseUnits('30', 9)) * bumpFactorN / 10000n;
      maxPriorityFeePerGas = (maxPriorityFeePerGas || ethers.parseUnits('2', 9)) * bumpFactorN / 10000n;
      continue;
    } catch (e) {
      const msg = e?.message || '';
      const code = e?.code || '';
      // If the tx was replaced and mined, surface it as success
      if (code === 'TRANSACTION_REPLACED' && e?.replacement && e?.receipt) {
        return { hash: e.replacement.hash, receipt: e.receipt };
      }
      const underpriced = code === 'REPLACEMENT_UNDERPRICED' || msg.includes('replacement transaction underpriced') || msg.includes('fee too low');
      const nonceExpired = code === 'NONCE_EXPIRED' || msg.includes('nonce has already been used') || msg.includes('nonce too low');
      if (!(underpriced || nonceExpired) || attempt === maxAttempts) {
        lastErr = e;
        break;
      }
      // Refresh to oldest pending nonce for replacement when nonce-related
      if (nonceExpired) {
        try {
          const [latest, pending] = await Promise.all([
            provider.getTransactionCount(from, 'latest'),
            provider.getTransactionCount(from, 'pending'),
          ]);
          nonce = pending > latest ? latest : pending;
        } catch { /* ignore */ }
      }
      // Bump fees and retry
      try {
        const bumpFactor = (10000 + bumpBps) / 10000;
        maxFeePerGas = (maxFeePerGas ? maxFeePerGas : ethers.parseUnits('30', 9)) * BigInt(Math.floor(bumpFactor * 10000)) / 10000n;
        maxPriorityFeePerGas = (maxPriorityFeePerGas ? maxPriorityFeePerGas : ethers.parseUnits('2', 9)) * BigInt(Math.floor(bumpFactor * 10000)) / 10000n;
      } catch { /* ignore */ }
      await new Promise(r => setTimeout(r, 300));
      continue;
    }
  }
  // If we exit loop without returning
  throw lastErr || new Error('sendTx failed');
}

async function sendTx(params) {
  return enqueueTx(() => sendTxInner(params));
}

// Simple poll registry
const polls = new Map();

function startPoll(name, fn, intervalMs) {
  stopPoll(name);
  const timer = setInterval(async () => {
    try { await fn(); } catch (e) { console.error(`[poll:${name}]`, e.message); }
  }, intervalMs);
  polls.set(name, timer);
}

function stopPoll(name) {
  const t = polls.get(name);
  if (t) clearInterval(t);
  polls.delete(name);
}

function stopAllPolls() {
  for (const [name, t] of polls) clearInterval(t);
  polls.clear();
}

// Batch executor for filled book orders (future use)
// Accepts an array of { address, abi, method, args }
// Executes sequentially to avoid nonce collisions
async function executeBatch(calls, { continueOnError = true } = {}) {
  if (!Array.isArray(calls) || calls.length === 0) return [];
  const out = [];
  for (const c of calls) {
    try {
      const res = await sendTx(c);
      out.push({ ok: true, hash: res.hash });
    } catch (e) {
      out.push({ ok: false, error: e.message });
      if (!continueOnError) break;
    }
  }
  return out;
}

// Monitor skeleton: check DB for orders with status 'filled-pending' and send on-chain in batch
async function monitorFilledOrders(buildCallFromOrder) {
  // buildCallFromOrder(order) -> { address, abi, method, args }
  const Order = require('../models/Order');
  const pending = await Order.find({ status: 'filled-pending' }).sort({ createdAt: 1 }).limit(50);
  if (!pending.length) return 0;

  const calls = [];
  for (const ord of pending) {
    try {
      const call = await buildCallFromOrder(ord);
      if (call) calls.push(call);
    } catch (e) {
      console.error('monitorFilledOrders buildCall error:', e.message);
    }
  }

  const results = await executeBatch(calls);

  // Update orders with tx hashes or errors
  for (let i = 0; i < pending.length; i++) {
    try {
      const r = results[i];
      if (!r) continue;
      if (r.ok) {
        await Order.findByIdAndUpdate(pending[i]._id, { txHash: r.hash, status: 'filled-sent' });
      } else {
        await Order.findByIdAndUpdate(pending[i]._id, { status: 'filled-error' });
      }
      } catch (e) {
      console.error('monitorFilledOrders post-update error:', e.message);
    }
  }

  return results.length;
}

// Fetch proposal data from chain and sync with DB
// Input: { address, abi }
// Output: { action: 'created'|'updated'|'unchanged'|'skipped', proposal?, reason? }
async function syncProposalFromChain({ address, abi }) {
  if (!address || !abi) throw new Error('address and abi are required');
  const Proposal = require('../models/Proposal');
  const contract = getContract(address, abi, false);

  const tryRead = async (names, args = []) => {
    for (const n of names) {
      const fn = contract[n];
      if (typeof fn === 'function') {
        try { return await fn(...args); } catch (_) {}
      }
    }
    return undefined;
  };

  const raw = {
    id: await tryRead(['id', 'proposalId', 'getId']),
    admin: await tryRead(['admin', 'getAdmin', 'owner']),
    title: await tryRead(['title', 'name', 'getTitle']),
    description: await tryRead(['description', 'getDescription']),
    startTime: await tryRead(['startTime', 'getStartTime', 'auctionStartTime']),
    endTime: await tryRead(['endTime', 'getEndTime', 'liveEnd', 'auctionEndTime']),
    duration: await tryRead(['duration', 'getDuration', 'liveDuration']),
    // subjectToken is the new name; keep old aliases just in case
    subjectToken: await tryRead(['subjectToken', 'getSubjectToken', 'collateralToken', 'getCollateralToken']),
    // maxSupply on older code; on-chain exposed as maxCap in new ABI
    maxSupply: await tryRead(['maxSupply', 'cap', 'getMaxSupply', 'maxCap']),
    target: await tryRead(['target', 'getTarget']),
    data: await tryRead(['data', 'getData']),
    marketAddress: await tryRead(['market', 'marketAddress', 'getMarket']),
    proposalExecuted: await tryRead(['proposalExecuted', 'executed', 'isExecuted', 'getExecuted']),
    proposalEnded: await tryRead(['proposalEnded', 'ended', 'isEnded', 'getEnded'])
  };

  const asNum = (v) => {
    if (v === undefined || v === null) return undefined;
    if (typeof v === 'bigint') return Number(v);
    const n = Number(v);
    return Number.isFinite(n) ? n : undefined;
  };
  const asStr = (v) => {
    if (v === undefined || v === null) return undefined;
    return typeof v === 'bigint' ? v.toString() : String(v);
  };
  const asAddr = (v) => {
    const s = asStr(v);
    return s ? s.toLowerCase() : undefined;
  };
  const asBool = (v) => Boolean(v);

  const onchain = {
    // Store contract address
    proposalAddress: address.toLowerCase(),
    // Store on-chain proposal id as string
    proposalContractId: raw.id !== undefined ? asStr(raw.id) : undefined,
    admin: asAddr(raw.admin),
    title: raw.title !== undefined ? asStr(raw.title) : undefined,
    description: raw.description !== undefined ? asStr(raw.description) : undefined,
    startTime: asNum(raw.startTime),
    endTime: asNum(raw.endTime),
    duration: asNum(raw.duration),
    subjectToken: asAddr(raw.subjectToken),
    maxSupply: raw.maxSupply !== undefined ? asStr(raw.maxSupply) : undefined,
    target: asAddr(raw.target),
    data: raw.data !== undefined ? asStr(raw.data) : undefined,
    marketAddress: raw.marketAddress !== undefined ? asAddr(raw.marketAddress) : undefined,
    proposalExecuted: raw.proposalExecuted !== undefined ? asBool(raw.proposalExecuted) : undefined,
    proposalEnded: raw.proposalEnded !== undefined ? asBool(raw.proposalEnded) : undefined
  };

  if (!onchain.duration && onchain.startTime !== undefined && onchain.endTime !== undefined) {
    onchain.duration = onchain.endTime - onchain.startTime;
  }

  // Find existing by address, or by on-chain id, else by internal id (not provided here)
  let existing = await Proposal.findOne({ $or: [
    { proposalAddress: onchain.proposalAddress },
    onchain.proposalContractId ? { proposalContractId: onchain.proposalContractId } : null
  ].filter(Boolean) });

  if (!existing) {
    // Require minimum fields to create
    const required = ['admin', 'startTime', 'endTime', 'duration', 'subjectToken', 'maxSupply', 'target'];
    const missing = required.filter(k => onchain[k] === undefined);
    if (missing.length) {
      return { action: 'skipped', reason: `missing fields: ${missing.join(', ')}` };
    }
    const created = new Proposal(onchain);
    await created.save(); // pre-save sets internal id
    return { action: 'created', proposal: created };
  }

  // Update changed fields
  const updatableKeys = Object.keys(onchain).filter(k => onchain[k] !== undefined);
  const toSet = {};
  for (const k of updatableKeys) {
    const newVal = onchain[k];
    const oldVal = existing[k];
    const isAddrField = ['admin','subjectToken','target','marketAddress','proposalAddress'].includes(k);
    const eq = isAddrField ? (String(oldVal || '').toLowerCase() === String(newVal || '').toLowerCase()) : (String(oldVal ?? '') === String(newVal ?? ''));
    if (!eq) toSet[k] = newVal;
  }

  if (Object.keys(toSet).length === 0) {
    return { action: 'unchanged', proposal: existing };
  }

  const updated = await Proposal.findByIdAndUpdate(existing._id, { $set: toSet }, { new: true });
  return { action: 'updated', proposal: updated };
}

// Process proposal data directly from getAllProposals response (like frontend)
function processProposalFromManager(proposalData) {
  // State mapping like frontend but with lowercase values for DB
  const stateMap = ['auction', 'live', 'resolved', 'cancelled'];
  
  try {
    const processed = {
      proposalContractId: proposalData.id ? proposalData.id.toString() : undefined,
      proposalAddress: toAddr(proposalData.proposalAddress || proposalData.address),
      admin: toAddr(proposalData.admin),
      title: proposalData.title || `Proposal #${proposalData.id}`,
      description: proposalData.description || 'Synced from manager',
      state: stateMap[Number(proposalData.state)] || 'auction',
      startTime: Number(proposalData.auctionStartTime || proposalData.startTime || 0),
      endTime: Number(proposalData.liveEnd || proposalData.endTime || 0),
      duration: Number(proposalData.liveDuration || proposalData.duration || 0),
      subjectToken: toAddr(proposalData.subjectToken),
      maxSupply: (proposalData.maxCap || proposalData.cap || proposalData.maxSupply || 0).toString(),
      target: toAddr(proposalData.target || '0x0000000000000000000000000000000000000000'),
      data: proposalData.data || '0x',
      marketAddress: toAddr(proposalData.marketAddress),
      
      // Auction data
      yesAuction: toAddr(proposalData.yesAuction),
      noAuction: toAddr(proposalData.noAuction),
      yesToken: toAddr(proposalData.yesToken),
      noToken: toAddr(proposalData.noToken),
      treasury: toAddr(proposalData.treasury),
      minToOpen: (proposalData.minToOpen || 0).toString()
    };

    // Calculate endTime if not provided
    if (!processed.endTime && processed.startTime && processed.duration) {
      processed.endTime = processed.startTime + processed.duration;
    }

    // Build auctions object
    const auctions = {};
    if (processed.yesAuction || processed.yesToken) {
      auctions.yes = {
        auctionAddress: processed.yesAuction,
        marketToken: processed.yesToken || '0x0000000000000000000000000000000000000000',
        treasury: processed.treasury,
        admin: processed.admin,
        startTime: processed.startTime,
        endTime: Number(proposalData.auctionEndTime || processed.startTime + 3600), // default 1h auction
        minToOpen: processed.minToOpen,
        cap: processed.maxSupply,
        priceStart: '0',
        currentPrice: '0',
        tokensSold: '0',
        finalized: false,
        isValid: true,
        isCanceled: false
      };
    }
    
    if (processed.noAuction || processed.noToken) {
      auctions.no = {
        auctionAddress: processed.noAuction,
        marketToken: processed.noToken || '0x0000000000000000000000000000000000000000',
        treasury: processed.treasury,
        admin: processed.admin,
        startTime: processed.startTime,
        endTime: Number(proposalData.auctionEndTime || processed.startTime + 3600), // default 1h auction
        minToOpen: processed.minToOpen,
        cap: processed.maxSupply,
        priceStart: '0',
        currentPrice: '0',
        tokensSold: '0',
        finalized: false,
        isValid: true,
        isCanceled: false
      };
    }

    if (Object.keys(auctions).length > 0) {
      processed.auctions = auctions;
    }

    return processed;
  } catch (e) {
    console.error('processProposalFromManager error:', e.message, proposalData);
    throw e;
  }
}

// ===== Minimal ABIs for manager/proposal/auction/token =====
// Load directly from JSON files instead of hardcoding here
const ABI_MANAGER = PM_ABI;
const ABI_PROPOSAL = PROPOSAL_ABI;
const ABI_AUCTION = AUCTION_ABI;
const ABI_TOKEN_MIN = TOKEN_MIN_ABI;

const toStr = (v) => (typeof v === 'bigint' ? v.toString() : String(v));
const toNum = (v) => (typeof v === 'bigint' ? Number(v) : Number(v));
const toAddr = (v) => {
  if (!v && v !== 0) return v;
  const s = String(v).toLowerCase();
  if (s.startsWith('0x')) return s;
  // add 0x prefix for plain hex addresses/bytes32
  if (/^[0-9a-f]{40}$/i.test(s) || /^[0-9a-f]{64}$/i.test(s)) return `0x${s}`;
  return s;
};

async function readProposalSnapshot(proposalAddr) {
  const c = getContract(proposalAddr, PROPOSAL_ABI, false);

  // Resilient read helper: try multiple aliases and swallow CALL_EXCEPTION
  const tryCall = async (names) => {
    for (const n of names) {
      const fn = c[n];
      if (typeof fn === 'function') {
        try { return await fn(); } catch (_) { /* ignore and try next */ }
      }
    }
    return undefined;
  };

  // Read fields with aliases for older/newer ABIs; each call is self-contained to avoid Promise.all failing
  const [
    id,
    admin,
    st,
    aStart,
    aEnd,
    lStart,
    lEnd,
    lDur,
    subjectToken,
    minToOpen,
    maxCap,
    yesAuction,
    noAuction,
    yesToken,
    noToken,
    treasury
  ] = await Promise.all([
    tryCall(['id', 'proposalId', 'getId']),
    tryCall(['admin', 'getAdmin', 'owner']),
    tryCall(['state', 'getState']),
    tryCall(['auctionStartTime', 'getAuctionStartTime', 'startTime']),
    tryCall(['auctionEndTime', 'getAuctionEndTime']),
    tryCall(['liveStart', 'getLiveStart']),
    tryCall(['liveEnd', 'getLiveEnd']),
    tryCall(['liveDuration', 'getLiveDuration', 'duration']),
    tryCall(['subjectToken', 'getSubjectToken', 'collateralToken', 'getCollateralToken']),
    tryCall(['minToOpen', 'MIN_TO_OPEN', 'getMinToOpen']),
    tryCall(['maxCap', 'MAX_CAP', 'cap', 'getMaxCap']),
    tryCall(['yesAuction', 'YES_AUCTION']),
    tryCall(['noAuction', 'NO_AUCTION']),
    (async () => { try { return await c.yesToken(); } catch { return '0x0000000000000000000000000000000000000000'; } })(),
    (async () => { try { return await c.noToken(); } catch { return '0x0000000000000000000000000000000000000000'; } })(),
    tryCall(['treasury', 'TREASURY'])
  ]);

  // Optional metadata (older deployments may not have these; ignore errors)
  let metaTitle;
  let metaDescription;
  try { metaTitle = await c.title(); } catch (_) { metaTitle = undefined; }
  try { metaDescription = await c.description(); } catch (_) { metaDescription = undefined; }

  const startTime = toNum(aStart);
  const endTime = toNum(lEnd) > 0 ? toNum(lEnd) : (toNum(aEnd) + toNum(lDur));
  const duration = endTime && startTime ? (endTime - startTime) : toNum(lDur);
  const stateEnum = ['auction','live','resolved','cancelled'][toNum(st)] ?? 'auction';

  // YES/NO auction snapshots (resilient)
  let yes = null;
  let no = null;
  try {
    if (yesAuction && String(yesAuction).toLowerCase() !== '0x0000000000000000000000000000000000000000') {
      yes = await readAuctionSnapshot(yesAuction);
    }
  } catch (_) { yes = null; }
  try {
    if (noAuction && String(noAuction).toLowerCase() !== '0x0000000000000000000000000000000000000000') {
      no = await readAuctionSnapshot(noAuction);
    }
  } catch (_) { no = null; }

  // Tokens: tokensSold = totalSupply; currentPrice is already priceNow in readAuctionSnapshot
  try {
    if (yes && yes.marketToken && yes.marketToken !== '0x0000000000000000000000000000000000000000') {
      const yesTokenC = getContract(yes.marketToken, TOKEN_MIN_ABI, false);
      const yesSupply = await yesTokenC.totalSupply().catch(() => 0n);
      yes.tokensSold = toStr(yesSupply);
    }
  } catch (_) {}
  try {
    if (no && no.marketToken && no.marketToken !== '0x0000000000000000000000000000000000000000') {
      const noTokenC  = getContract(no.marketToken, TOKEN_MIN_ABI, false);
      const noSupply = await noTokenC.totalSupply().catch(() => 0n);
      no.tokensSold = toStr(noSupply);
    }
  } catch (_) {}

  // Fallback minimal auctions to ensure tokens are populated
  const yesAuctionAddr = toAddr(yesAuction);
  const noAuctionAddr = toAddr(noAuction);
  const yesTokenAddr = toAddr(yesToken);
  const noTokenAddr = toAddr(noToken);

  if (!yes && (yesAuctionAddr || yesTokenAddr)) {
    yes = {
      auctionAddress: yesAuctionAddr || null,
      marketToken: yesTokenAddr || '0x0000000000000000000000000000000000000000',
      pyusd: process.env.PYUSD_ADDRESS,
      treasury: toAddr(treasury),
      admin: toAddr(admin),
      startTime: startTime,
      endTime: toNum(aEnd),
      priceStart: '0',
      minToOpen: toStr(minToOpen),
      cap: toStr(maxCap),
      currentPrice: '0',
      tokensSold: '0',
      finalized: false,
      isValid: true,
      isCanceled: false
    };
  }

  if (!no && (noAuctionAddr || noTokenAddr)) {
    no = {
      auctionAddress: noAuctionAddr || null,
      marketToken: noTokenAddr || '0x0000000000000000000000000000000000000000',
      pyusd: process.env.PYUSD_ADDRESS,
      treasury: toAddr(treasury),
      admin: toAddr(admin),
      startTime: startTime,
      endTime: toNum(aEnd),
      priceStart: '0',
      minToOpen: toStr(minToOpen),
      cap: toStr(maxCap),
      currentPrice: '0',
      tokensSold: '0',
      finalized: false,
      isValid: true,
      isCanceled: false
    };
  }

  return {
    proposalAddress: toAddr(proposalAddr),
    proposalContractId: toStr(id),
    admin: toAddr(admin),
    state: stateEnum,
    title: metaTitle ? String(metaTitle) : undefined,
    description: metaDescription ? String(metaDescription) : undefined,
    startTime,
    endTime,
    duration,
    subjectToken: toAddr(subjectToken),
    maxSupply: toStr(maxCap),
    target: toAddr('0x0000000000000000000000000000000000000000'),
    data: '0x',
    marketAddress: undefined,
    auctions: (yes || no) ? { yes: yes || null, no: no || null } : null
  };
}

async function upsertProposalAndAuctions(snapshot) {
  const Proposal = require('../models/Proposal');
  const Auction = require('../models/Auction');

  // Provide fallbacks for required fields not on-chain
  const fallbackTitle = snapshot.title ?? `Proposal #${snapshot.id}`;
  const fallbackDesc = snapshot.description ?? 'Synced from chain';

  // Find by contract address or on-chain id
  const query = snapshot.proposalAddress
    ? { proposalAddress: snapshot.proposalAddress }
    : (snapshot.proposalContractId ? { proposalContractId: snapshot.proposalContractId } : null);
  let doc = query ? await Proposal.findOne(query) : null;

  // Preserve existing auctions if snapshot didn't provide them
  const auctionsFinal = {
    yes: (snapshot.auctions && snapshot.auctions.yes !== undefined)
      ? (snapshot.auctions.yes || null)
      : (doc ? (doc.auctions?.yes ?? null) : null),
    no: (snapshot.auctions && snapshot.auctions.no !== undefined)
      ? (snapshot.auctions.no || null)
      : (doc ? (doc.auctions?.no ?? null) : null)
  };

  const baseFields = {
    proposalAddress: snapshot.proposalAddress,
    proposalContractId: snapshot.proposalContractId,
    admin: snapshot.admin,
    state: snapshot.state,
    title: fallbackTitle,
    description: fallbackDesc,
    startTime: snapshot.startTime,
    endTime: snapshot.endTime,
    duration: snapshot.duration,
    subjectToken: snapshot.subjectToken,
    maxSupply: snapshot.maxSupply,
    target: snapshot.target ?? '0x0000000000000000000000000000000000000000',
    data: snapshot.data ?? '0x',
    marketAddress: snapshot.marketAddress,
    // Include token addresses for direct access
    yesToken: snapshot.yesToken,
    noToken: snapshot.noToken,
    yesAuction: snapshot.yesAuction,
    noAuction: snapshot.noAuction,
    treasury: snapshot.treasury,
    minToOpen: snapshot.minToOpen,
    auctions: auctionsFinal
  };

  if (!doc) {
    const toCreate = { ...baseFields };
    // Internal id is set in pre-save
    doc = new Proposal(toCreate);
    try {
      await doc.save();
    } catch (e) {
      console.error('Proposal create failed:', e.message, {
        address: snapshot.proposalAddress,
        proposalContractId: snapshot.proposalContractId
      });
      throw e;
    }
  } else {
    // Update only changed
    const toSet = {};
    for (const k of Object.keys(baseFields)) {
      const oldVal = doc[k];
      const newVal = baseFields[k];
      const isAddr = ['proposalAddress','admin','subjectToken','target','marketAddress'].includes(k);
      const isObj = k === 'auctions';
      const eq = isObj
        ? JSON.stringify(oldVal || null) === JSON.stringify(newVal || null)
        : (isAddr ? (String(oldVal || '').toLowerCase() === String(newVal || '').toLowerCase()) : (String(oldVal ?? '') === String(newVal ?? '')));
      if (!eq) toSet[k] = newVal;
    }
    if (Object.keys(toSet).length) {
      try {
        doc = await Proposal.findByIdAndUpdate(doc._id, { $set: toSet }, { new: true, runValidators: true });
      } catch (e) {
        console.error('Proposal update failed:', e.message, { id: doc.id, address: doc.proposalAddress });
        throw e;
      }
    }
  }

  const proposalIdStr = String(doc.id);

  // Upsert Auction docs (without maxTokenCap/minTokenCap)
  const upsertAuction = async (side, a) => {
    if (!a || !a.auctionAddress) return;
    const proposalIdStrLocal = proposalIdStr;
    const payload = {
      // proposalId: proposalIdStrLocal, // do not include in $set to avoid conflict
      // side,                           // do not include in $set to avoid conflict
      auctionAddress: a.auctionAddress,
      marketToken: a.marketToken,
      pyusd: process.env.PYUSD_ADDRESS,
      treasury: a.treasury,
      admin: a.admin,
      startTime: a.startTime,
      endTime: a.endTime,
      priceStart: a.priceStart,
      minToOpen: a.minToOpen,
      cap: a.cap ?? snapshot.maxSupply,
      currentPrice: a.currentPrice,
      tokensSold: a.tokensSold,
      finalized: a.finalized,
      isValid: a.isValid,
      isCanceled: a.isCanceled
    };

    await Auction.findOneAndUpdate(
      { proposalId: proposalIdStrLocal, side },
      { $set: payload, $setOnInsert: { proposalId: proposalIdStrLocal, side } },
      { upsert: true, new: true }
    );
  };

  await Promise.all([
    upsertAuction('yes', auctionsFinal.yes),
    upsertAuction('no', auctionsFinal.no)
  ]);

  return doc;
}

// Sync using a Proposal contract address
async function syncProposalByAddress(proposalAddress) {
  const snap = await readProposalSnapshot(proposalAddress);
  const doc = await upsertProposalAndAuctions(snap);
  return { id: doc.id, address: proposalAddress, action: 'synced' };
}

// Sync all proposals from a ProposalManager
async function syncProposalsFromManager({ manager }) {
  const c = getContract(manager, PM_ABI, false);
  // Returns an array of proposal structs like frontend useGetAllProposals
  const proposals = await c.getAllProposals();
  const results = [];
  
  console.log(`Manager returned ${Array.isArray(proposals) ? proposals.length : 0} proposals`);
  
  if (!Array.isArray(proposals)) {
    console.error('getAllProposals did not return an array:', proposals);
    return results;
  }

  // Process each proposal struct similar to frontend mapping
  for (let i = 0; i < proposals.length; i++) {
    const p = proposals[i];
    try {
      // Process proposal data directly from manager response
      const processed = processProposalFromManager(p);
      
      if (!processed.proposalAddress || processed.proposalAddress === '0x0000000000000000000000000000000000000000') {
        console.warn(`Proposal ${i}: invalid or missing proposalAddress`, p);
        results.push({ index: i, error: 'invalid proposalAddress', proposal: p });
        continue;
      }

      console.log(`Processing proposal ${i}: ${processed.proposalAddress}`);
      
      // Upsert directly using processed data instead of calling individual contracts
      const doc = await upsertProposalAndAuctions(processed);
      results.push({ id: doc.id, address: processed.proposalAddress, action: 'synced' });
      
    } catch (e) {
      console.error(`Sync proposal error at index ${i}:`, e.message, p);
      results.push({ index: i, error: e.message, proposal: p });
    }
  }
  return results;
}

// Fast sync all proposals from manager using direct data processing (like frontend)
async function syncProposalsFromManagerFast({ manager }) {
  const c = getContract(manager, PM_ABI, false);
  const proposals = await c.getAllProposals();
  const results = [];
  
  console.log(`[Fast Sync] Manager returned ${Array.isArray(proposals) ? proposals.length : 0} proposals`);
  
  if (!Array.isArray(proposals)) {
    console.error('getAllProposals did not return an array:', proposals);
    return results;
  }

  const Proposal = require('../models/Proposal');
  
  // Process all proposals in batches to avoid overwhelming the database
  const batchSize = 10;
  for (let i = 0; i < proposals.length; i += batchSize) {
    const batch = proposals.slice(i, i + batchSize);
    const batchPromises = batch.map(async (p, batchIndex) => {
      const globalIndex = i + batchIndex;
      try {
        const processed = processProposalFromManager(p);
        
        if (!processed.proposalAddress || processed.proposalAddress === '0x0000000000000000000000000000000000000000') {
          return { index: globalIndex, error: 'invalid proposalAddress', proposal: p };
        }

        // Upsert directly using processed data
        const doc = await upsertProposalAndAuctions(processed);
        console.log(`[Fast Sync] Processed proposal ${globalIndex}: ${processed.proposalAddress} -> ${doc.id}`);
        
        return { 
          index: globalIndex,
          id: doc.id, 
          address: processed.proposalAddress, 
          action: 'synced',
          title: processed.title,
          state: processed.state
        };
        
      } catch (e) {
        console.error(`[Fast Sync] Error at index ${globalIndex}:`, e.message);
        return { index: globalIndex, error: e.message, proposal: p };
      }
    });

    const batchResults = await Promise.all(batchPromises);
    results.push(...batchResults);
    
    // Small delay between batches to not overwhelm the system
    if (i + batchSize < proposals.length) {
      await new Promise(resolve => setTimeout(resolve, 100));
    }
  }

  const successful = results.filter(r => !r.error).length;
  const failed = results.filter(r => r.error).length;
  console.log(`[Fast Sync] Completed: ${successful} successful, ${failed} failed`);

  return results;
}

// Subscribe to ProposalManager ProposalCreated and backfill
async function startProposalManagerWatcher({ manager, fromBlock }) {
  const provider = getProvider();
  const abi = require('../abi/ProposalManager.json').abi;
  const pm = new ethers.Contract(manager, abi, provider);

  // Helper: process one event
  const handleEvent = async (id, admin, proposal, title, log) => {
    try {
      const snap = await readProposalSnapshot(proposal);
      // Set address and on-chain id explicitly
      snap.proposalAddress = toAddr(proposal);
      snap.proposalContractId = String(id);
      // Fill title/description from event when available
      if (!snap.title) snap.title = title || `Proposal #${snap.id}`;
      if (!snap.description) snap.description = 'Synced from event';
      await upsertProposalAndAuctions(snap);
      return true;
    } catch (e) {
      console.error('handleEvent error:', e.message);
      return false;
    }
  };

  // Historical backfill using queryFilter
  try {
    const eventFrag = pm.interface.getEvent('ProposalCreated');
    const topic = pm.interface.getEventTopic(eventFrag);
    const filter = { address: manager, topics: [topic] };
    const latest = await provider.getBlockNumber();

    let start = Number(fromBlock || process.env.PM_FROM_BLOCK || 0);
    const step = 2_000; // paginate to avoid RPC limits
    while (start <= latest) {
      const end = Math.min(start + step, latest);
      const logs = await provider.getLogs({ ...filter, fromBlock: start, toBlock: end });
      for (const log of logs) {
        const parsed = pm.interface.parseLog(log);
        const [id, admin, proposal, title] = parsed.args;
        await handleEvent(Number(id), String(admin), String(proposal), String(title), log);
      }
      start = end + 1;
    }
  } catch (e) {
    console.warn('PM backfill skipped:', e.message);
  }

  // Live subscription
  pm.on('ProposalCreated', async (id, admin, proposal, title, ev) => {
    await handleEvent(Number(id), String(admin), String(proposal), String(title), ev?.log ?? ev);
  });

  return true;
}

// --------------------
// ProposalCreated watcher (backfill + live)
// --------------------
// Ensure single live subscription flag
let liveSubActive = false;

async function getCursor(key) {
  try {
    const Counter = require('../models/Counter');
    const c = await Counter.findById(key);
    return c?.seq || 0;
  } catch (_) { return 0; }
}

async function setCursor(key, value) {
  try {
    const Counter = require('../models/Counter');
    await Counter.findByIdAndUpdate(
      key,
      { $set: { seq: Number(value) } },
      { upsert: true, new: true }
    );
  } catch (e) {
    console.error('setCursor error:', e.message);
  }
}

function toLower(a) { return a ? String(a).toLowerCase() : a; }

async function handleProposalCreatedLog(io, log) {
  try {
    const parsed = PM_EVENT_IFACE.parseLog(log);
    const id = Number(parsed.args.id);
    const admin = toLower(parsed.args.admin);
    const proposalAddr = toLower(parsed.args.proposal);
    const title = String(parsed.args.title);

    const { syncProposalByAddress } = module.exports;
    const { notifyProposalUpdate } = require('../middleware/websocket');

    await syncProposalByAddress(proposalAddr);

    const Proposal = require('../models/Proposal');
    // Find by address or on-chain id
    const doc = await Proposal.findOne({ $or: [ { proposalAddress: proposalAddr }, { proposalContractId: String(id) } ] });
    if (doc && io) notifyProposalUpdate(io, doc);
  } catch (e) {
    console.error('handleProposalCreatedLog error:', e.message);
    try {
      const parsed = PM_EVENT_IFACE.parseLog(log);
      const id = Number(parsed.args.id);
      const admin = toLower(parsed.args.admin);
      const proposalAddr = toLower(parsed.args.proposal);
      const title = String(parsed.args.title || `Proposal #${id}`);
      const Proposal = require('../models/Proposal');

      const existing = await Proposal.findOne({ $or: [ { proposalAddress: proposalAddr }, { proposalContractId: String(id) } ] });
      if (!existing) {
        const now = Math.floor(Date.now() / 1000);
        await Proposal.create({
          proposalAddress: proposalAddr,
          proposalContractId: String(id),
          admin,
          title,
          description: 'Pending sync',
          startTime: now,
          endTime: now + 86400,
          duration: 86400,
          subjectToken: '0x0000000000000000000000000000000000000000',
          maxSupply: '0',
          target: '0x0000000000000000000000000000000000000000',
          data: '0x',
          state: 'auction',
          auctions: null
        });
        // Schedule a best-effort background sync retry to clear Pending sync
        setTimeout(() => {
          module.exports.syncProposalByAddress(proposalAddr).catch(() => {});
        }, 3000);
      }
    } catch (e2) {
      console.error('fallback minimal upsert failed:', e2.message);
    }
  }
}

async function backfillProposalCreated({ manager, fromBlock, toBlock, io }) {
  const provider = getProvider();
  const latest = toBlock ?? (await provider.getBlockNumber());
  const start = Math.max(0, Number(fromBlock ?? (latest - 5000)));
  const step = 3000; // chunk size to avoid RPC limits

  for (let from = start; from <= latest; from += step + 1) {
    const to = Math.min(latest, from + step);
    const filter = {
      address: manager,
      fromBlock: from,
      toBlock: to,
      topics: [PM_EVENT_TOPIC]
    };
    try {
      const logs = await provider.getLogs(filter);
      for (const log of logs) {
        await handleProposalCreatedLog(io, log);
        await setCursor(`cursor:pm:${toLower(manager)}`, Number(log.blockNumber));
      }
    } catch (e) {
      console.error(`backfill logs ${from}-${to} error:`, e.message);
    }
  }
}

function startProposalCreatedWatcher({ manager, confirmations = 0, fromBlock } = {}) {
  if (!manager) throw new Error('manager address required');
  const provider = getProvider();
  const addr = toLower(manager);
  const key = `cursor:pm:${addr}`;

  // Ensure single subscription
  if (liveSubActive) return;
  liveSubActive = true;

  (async () => {
    try {
      // Determine backfill start
      const latest = await provider.getBlockNumber();
      let startBlock = Number(fromBlock || (await getCursor(key)));
      if (!startBlock || startBlock <= 0) {
        const envStart = Number(process.env.PM_START_BLOCK || process.env.PROPOSAL_MANAGER_START_BLOCK || 0);
        startBlock = envStart > 0 ? envStart : Math.max(0, latest - 5000);
      }
      const io = require('../server').io;
      await backfillProposalCreated({ manager: addr, fromBlock: startBlock, toBlock: latest, io });

      // Live subscription
      const filter = { address: addr, topics: [PM_EVENT_TOPIC] };
      provider.on(filter, async (log) => {
        try {
          if (confirmations && confirmations > 0) {
            const block = await provider.getBlockNumber();
            if (block - Number(log.blockNumber) < confirmations) return;
          }
          const ioInst = require('../server').io;
          await handleProposalCreatedLog(ioInst, log);
          await setCursor(key, Number(log.blockNumber));
        } catch (e) {
          console.error('live ProposalCreated handler error:', e.message);
        }
      });
      console.log(`Subscribed to ProposalCreated on ${addr}`);
    } catch (e) {
      console.error('startProposalCreatedWatcher error:', e.message);
    }
  })();
}

// Finalize helpers

async function attemptFinalizeAuction(auctionAddress) {
  if (!auctionAddress) throw new Error('auctionAddress required');
  try {
    const { hash, receipt } = await sendTx({
      address: auctionAddress,
      abi: AUCTION_ABI,
      method: 'finalize',
      args: []
    });
    return { ok: true, hash, blockNumber: Number(receipt?.blockNumber || 0) };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

async function canFinalizeAuction(auctionAddress) {
  try {
    const c = getContract(auctionAddress, AUCTION_ABI, false);

    // Read finalized + end time first
    const [isFinalized, endTimeBn] = await Promise.all([
      c.isFinalized(),
      c.END_TIME(),
    ]);
    if (isFinalized) return { can: false, reason: 'already-finalized' };

    // Chain time (fallback to wall clock if provider fails)
    let nowTs;
    try {
      const block = await getProvider().getBlock('latest');
      nowTs = Number(block?.timestamp || 0);
    } catch (_) {
      nowTs = Math.floor(Date.now() / 1000);
    }
    const endTime = Number(endTimeBn);
    const endPassed = nowTs >= endTime;

    // If ended by time, we can finalize regardless of cap
    if (endPassed) return { can: true, reason: 'ended' };

    // Otherwise, check early-finalize threshold: >=99% cap
    let marketTokenAddr;
    try { marketTokenAddr = await c.MARKET_TOKEN(); } catch (_) { marketTokenAddr = undefined; }
    if (!marketTokenAddr) return { can: false, reason: 'not-ready' };

    try {
      const t = getContract(marketTokenAddr, TOKEN_MIN_ABI, false);
      const [totalSupplyBn, capBn] = await Promise.all([
        t.totalSupply(),
        t.cap()
      ]);
      const totalSupply = typeof totalSupplyBn === 'bigint' ? totalSupplyBn : BigInt(totalSupplyBn);
      const cap = typeof capBn === 'bigint' ? capBn : BigInt(capBn);
      const earlyThreshold = (cap * 99n) / 100n;
      if (totalSupply >= earlyThreshold) return { can: true, reason: 'cap-99' };
    } catch (_) {
      // ignore cap read errors and treat as not-ready until time end
    }

    return { can: false, reason: 'not-ready' };
  } catch (e) {
    return { can: false, reason: `read-error:${e.message}` };
  }
}

// Scan DB for auctions and try to finalize them only if proposal is in 'auction' state
async function monitorAuctionsToFinalize({ limit = 20 } = {}) {
  const signer = getSigner();
  if (!signer) {
    return { tried: 0, finalized: 0 };
  }
  const Auction = require('../models/Auction');
  const Proposal = require('../models/Proposal');
  const candidates = await Auction.find({}).sort({ updatedAt: 1 }).limit(limit);
  console.log(`[finalize-auction] scan: candidates=${candidates?.length || 0}`);
  if (!candidates || !candidates.length) return { tried: 0, finalized: 0 };

  let finalizedCount = 0;
  let tried = 0;

  for (const a of candidates) {
    const addr = a.auctionAddress;
    if (!addr) continue;

    let proposalAddr;
    try {
      const p = await Proposal.findOne({ id: a.proposalId });
      proposalAddr = p?.proposalAddress;
    } catch (_) {}
    if (!proposalAddr) continue;

    let stateNum = -1;
    try {
      const pc = getContract(proposalAddr, PROPOSAL_ABI, false);
      const st = await pc.state();
      stateNum = Number(st);
    } catch (e) {
      console.warn(`[finalize-auction] could not read proposal state ${proposalAddr}: ${e.message}`);
      continue;
    }

    if (stateNum !== 0) continue; // only auction state

    // Check readiness before attempting finalize to avoid stuck pending
    const readiness = await canFinalizeAuction(addr);
    if (!readiness.can) {
      if (readiness.reason && readiness.reason !== 'not-ready') {
        console.log(`[finalize-auction] skip: proposalId=${a.proposalId} auction=${addr} reason=${readiness.reason}`);
      }
      continue;
    }

    let signerAddr = 'unknown';
    let nonce = 'unknown';
    try {
      signerAddr = await signer.getAddress();
      nonce = await signer.getNonce();
    } catch (_) {}
    console.log(`[finalize-auction] attempting finalize: proposalId=${a.proposalId} proposal=${proposalAddr} auction=${addr} by=${signerAddr} nonce=${nonce}`);
    const startTime = Date.now();
    tried++;
    try {
      const res = await attemptFinalizeAuction(addr);
      const elapsed = Date.now() - startTime;
      if (res.ok) {
        finalizedCount++;
        try { await Auction.updateOne({ _id: a._id }, { $set: { finalized: true } }); } catch (_) {}
        console.log(`[finalize-auction] success: proposalId=${a.proposalId} auction=${addr} tx=${res.hash} block=${res.blockNumber} elapsed=${elapsed}ms`);
      } else {
        console.warn(`[finalize-auction] fail: proposalId=${a.proposalId} auction=${addr} error=${res.error} elapsed=${elapsed}ms`);
      }
    } catch (err) {
      const elapsed = Date.now() - startTime;
      console.error(`[finalize-auction] exception: proposalId=${a.proposalId} auction=${addr} error=${err?.message || err} elapsed=${elapsed}ms`);
    }
  }

  return { tried, finalized: finalizedCount };
}

// Resolve helpers for proposals that finished Live period
async function attemptResolveProposal(proposalAddress) {
  if (!proposalAddress) throw new Error('proposalAddress required');
  try {
    const { hash, receipt } = await sendTx({
      address: proposalAddress,
      abi: ABI_PROPOSAL,
      method: 'resolve',
      args: []
    });
    return { ok: true, hash, blockNumber: Number(receipt?.blockNumber || 0) };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

async function canResolveProposal(proposalAddress) {
  try {
    const c = getContract(proposalAddress, ABI_PROPOSAL, false);
    const [stateBn, liveEndBn] = await Promise.all([
      c.state(),
      c.liveEnd()
    ]);
    const stateNum = Number(stateBn);
    if (stateNum !== 1) return { can: false, reason: 'not-live' }; // 1 = Live

    // Chain time with fallback
    let nowTs;
    try {
      const block = await getProvider().getBlock('latest');
      nowTs = Number(block?.timestamp || 0);
    } catch (_) {
      nowTs = Math.floor(Date.now() / 1000);
    }
    const liveEnd = Number(liveEndBn);
    if (nowTs < liveEnd) return { can: false, reason: 'live-not-ended' };
    return { can: true, reason: 'ended' };
  } catch (e) {
    return { can: false, reason: `read-error:${e.message}` };
  }
}

// Scan DB for proposals in 'live' state and try resolve when liveEnd passed
async function monitorProposalsToResolve({ limit = 20 } = {}) {
  const signer = getSigner();
  if (!signer) return { tried: 0, resolved: 0 };
  const Proposal = require('../models/Proposal');
  const candidates = await Proposal.find({ state: 'live' }).sort({ updatedAt: 1 }).limit(limit);
  console.log(`[resolve-proposals] scan: candidates=${candidates?.length || 0}`);
  if (!candidates || !candidates.length) return { tried: 0, resolved: 0 };

  let resolved = 0;
  let tried = 0;

  for (const p of candidates) {
    const addr = p?.proposalAddress;
    if (!addr) continue;

    const readiness = await canResolveProposal(addr);
    if (!readiness.can) {
      if (readiness.reason && readiness.reason !== 'live-not-ended') {
        console.log(`[resolve-proposals] skip: id=${p.id} addr=${addr} reason=${readiness.reason}`);
      }
      continue;
    }

    tried++;
    const start = Date.now();
    try {
      const res = await attemptResolveProposal(addr);
      const elapsed = Date.now() - start;
      if (res.ok) {
        resolved++;
        console.log(`[resolve-proposals] success: id=${p.id} addr=${addr} tx=${res.hash} block=${res.blockNumber} elapsed=${elapsed}ms`);
      } else {
        console.warn(`[resolve-proposals] fail: id=${p.id} addr=${addr} error=${res.error} elapsed=${elapsed}ms`);
      }
    } catch (e) {
      const elapsed = Date.now() - start;
      console.error(`[resolve-proposals] exception: id=${p.id} addr=${addr} error=${e?.message || e} elapsed=${elapsed}ms`);
    }
  }

  return { tried, resolved };
}

module.exports = {
  // Core contract helpers
  getContract,
  callView,
  sendTx,

  // Polling utilities
  startPoll,
  stopPoll,
  stopAllPolls,
  executeBatch,

  // Orderbook/filled orders
  monitorFilledOrders,

  // Proposal sync and watchers
  syncProposalFromChain,
  syncProposalByAddress,
  syncProposalsFromManager,
  syncProposalsFromManagerFast,
  processProposalFromManager,
  startProposalManagerWatcher,
  startProposalCreatedWatcher,

  // Auction finalize monitor + helpers
  monitorAuctionsToFinalize,
  attemptFinalizeAuction,
  canFinalizeAuction,

  // Proposal resolve monitor + helpers
  monitorProposalsToResolve,
  attemptResolveProposal,
  canResolveProposal,

  // For testing
  _getProvider: getProvider,
  _getSigner: getSigner
};
