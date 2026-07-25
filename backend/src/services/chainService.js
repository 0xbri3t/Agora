// Simple chain service using ethers v6
// - Write helper (internal only) with retry/fee-bump
// - Proposal sync from ProposalManager + ProposalCreated watcher
// - Auction finalize / proposal resolve monitors
// Comments kept simple in English

const { ethers } = require('ethers');
const { getProvider, getSigner } = require('../config/ethers');

// Load ABIs from JSON files (kept minimal)
const PM_ABI = require('../abi/ProposalManager.json').abi;
const PROPOSAL_ABI = require('../abi/Proposal.json').abi;
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

  // Register Aqua markets when the proposal is (or becomes) live
  if (doc.state === 'live' && doc.yesToken && doc.noToken) {
    try {
      const { registerMarket } = require('./aquaOrderbookService');
      registerMarket(doc.yesToken, { proposalId: proposalIdStr, side: 'approve' });
      registerMarket(doc.noToken, { proposalId: proposalIdStr, side: 'reject' });
    } catch (e) {
      console.error('Aqua market registration failed:', e.message);
    }
  }

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
    const proposalAddr = toLower(parsed.args.proposal);

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

// Settle helpers (Uniswap CCA era)
// Auctions are Continuous Clearing Auctions; once past their end block the
// Proposal's settleAuctions() checkpoints both CCAs and activates or cancels.

async function attemptSettleProposal(proposalAddress) {
  if (!proposalAddress) throw new Error('proposalAddress required');
  try {
    const { hash, receipt } = await sendTx({
      address: proposalAddress,
      abi: PROPOSAL_ABI,
      method: 'settleAuctions',
      args: []
    });
    return { ok: true, hash, blockNumber: Number(receipt?.blockNumber || 0) };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

// Scan DB for proposals in 'auction' state and settle the ones past their end block
async function monitorAuctionsToFinalize({ limit = 20 } = {}) {
  const signer = getSigner();
  if (!signer) {
    return { tried: 0, finalized: 0 };
  }
  const Proposal = require('../models/Proposal');
  const candidates = await Proposal.find({ state: 'auction' }).sort({ updatedAt: 1 }).limit(limit);
  if (!candidates || !candidates.length) return { tried: 0, finalized: 0 };

  let currentBlock;
  try {
    currentBlock = await getProvider().getBlockNumber();
  } catch (e) {
    console.warn(`[settle-auctions] cannot read block number: ${e.message}`);
    return { tried: 0, finalized: 0 };
  }

  let tried = 0;
  let settled = 0;
  for (const p of candidates) {
    const addr = p.proposalAddress;
    if (!addr) continue;

    try {
      const pc = getContract(addr, PROPOSAL_ABI, false);
      const [stateNum, endBlock] = await Promise.all([pc.state(), pc.auctionEndBlock()]);
      if (Number(stateNum) !== 0) continue; // only Auction state
      if (currentBlock < Number(endBlock)) continue; // not over yet
    } catch (e) {
      console.warn(`[settle-auctions] read failed ${addr}: ${e.message}`);
      continue;
    }

    tried++;
    const res = await attemptSettleProposal(addr);
    if (res.ok) {
      settled++;
      console.log(`[settle-auctions] settled: proposal=${addr} tx=${res.hash}`);
      try { await syncProposalByAddress(addr); } catch (_) {}
    } else {
      console.warn(`[settle-auctions] fail: proposal=${addr} error=${res.error}`);
    }
  }

  return { tried, finalized: settled };
}

// Resolve helpers for proposals that finished Live period
async function attemptResolveProposal(proposalAddress) {
  if (!proposalAddress) throw new Error('proposalAddress required');
  try {
    const { hash, receipt } = await sendTx({
      address: proposalAddress,
      abi: PROPOSAL_ABI,
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
    const c = getContract(proposalAddress, PROPOSAL_ABI, false);
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
  sendTx,
  enqueueTx,

  // Polling utilities
  startPoll,
  stopPoll,

  // Proposal sync and watchers
  syncProposalByAddress,
  syncProposalsFromManagerFast,
  processProposalFromManager,
  startProposalCreatedWatcher,

  // Auction finalize monitor + helpers
  monitorAuctionsToFinalize,
  attemptSettleProposal,

  // Proposal resolve monitor + helpers
  monitorProposalsToResolve,
  attemptResolveProposal,
  canResolveProposal
};
