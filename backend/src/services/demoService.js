// Demo orchestrator: five funded local wallets act out a believable auction
// and market session on a proposal, staggered in time so the charts move the
// way a real crowd would move them. Fork-only (anvil chain 31337) — the
// wallets derive from anvil's default mnemonic, so they are pre-funded with
// ETH and can mint MockUSDC freely.
// Comments simple in English
const { ethers } = require('ethers');
const aquaClient = require('./aquaClient');
const aquaCfg = require('../config/aqua');
const Order = require('../models/Order');
const { updateOrderBook } = require('../routes/orderbooks');

const ANVIL_MNEMONIC = 'test test test test test test test test test test test junk';
const WALLET_INDICES = [5, 6, 7, 8, 9]; // leave 0-4 for humans/deployer

const PROPOSAL_ABI = [
  'function yesAuction() view returns (address)',
  'function noAuction() view returns (address)',
  'function yesToken() view returns (address)',
  'function noToken() view returns (address)',
  'function collateral() view returns (address)',
  'function state() view returns (uint8)',
  'function auctionEndBlock() view returns (uint64)',
  'function liveEnd() view returns (uint256)',
  'function settleAuctions()',
  'function resolve()',
];
const CCA_ABI = [
  'function clearingPrice() view returns (uint256)',
  'function floorPrice() view returns (uint256)',
  'function tickSpacing() view returns (uint256)',
  'function startBlock() view returns (uint64)',
  'function endBlock() view returns (uint64)',
  'function claimBlock() view returns (uint64)',
  'function submitBid(uint256 maxPriceQ96, uint128 amount, address owner, bytes hookData) payable returns (uint256)',
  'function exitBid(uint256 bidId)',
  'function exitPartiallyFilledBid(uint256 bidId, uint64 lastFullyFilledCheckpointBlock, uint64 outbidBlock)',
  'function claimTokens(uint256 bidId)',
  'event BidSubmitted(uint256 indexed id, address indexed owner, uint256 priceQ96, uint128 amount)',
  'event BidExited(uint256 indexed bidId, address indexed owner, uint256 tokensFilled, uint256 currencyRefunded)',
  'event ClearingPriceUpdated(uint256 blockNumber, uint256 clearingPriceQ96)',
];
const ERC20_ABI = [
  'function approve(address, uint256) returns (bool)',
  'function allowance(address, address) view returns (uint256)',
  'function balanceOf(address) view returns (uint256)',
  'function mint(address, uint256)',
];
const PERMIT2 = '0x000000000022D473030F116dDEE9F6B43aC78BA3';
const PERMIT2_ABI = [
  'function approve(address token, address spender, uint160 amount, uint48 expiration)',
  'function allowance(address, address, address) view returns (uint160, uint48, uint48)',
];
const Q96 = 2n ** 96n;

// The demo signs and broadcasts a LOT of transactions — use a plain HTTP
// provider. The backend's shared provider is a WebSocket; a socket degraded
// by hot restarts queues sendRawTransaction into the void (local tx hashes
// that never reach the node).
function getProvider() {
  return new ethers.JsonRpcProvider(process.env.RPC_URL || 'http://127.0.0.1:8545', undefined, { polling: true, pollingInterval: 500 });
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// A tx.wait that cannot hang the whole run: races a deadline, and on timeout
// resets the wallet's cached nonce so the next tx re-syncs with the chain.
async function waitTx(txPromise, wallet, ms = 20_000) {
  const tx = await txPromise;
  const res = await Promise.race([tx.wait(), sleep(ms).then(() => 'timeout')]);
  if (res === 'timeout') {
    if (typeof wallet?.reset === 'function') wallet.reset();
    throw new Error(`tx ${tx.hash?.slice(0, 10)} not mined in ${ms / 1000}s`);
  }
  return res;
}

// Fork-only hygiene: stuck nonce-gapped txs from an aborted run would stall
// every later wait forever. Anvil lets us just drop them.
async function clearTxpool(provider) {
  try { await provider.send('anvil_dropAllTransactions', []); } catch (_) { /* not anvil */ }
}

// Anvil remembers dropped tx hashes and silently ignores an identical
// re-broadcast. A per-tx fee jitter makes every attempt a fresh hash.
function feeJitter() {
  const j = BigInt(Math.floor(Math.random() * 1_000_000));
  return { maxPriorityFeePerGas: 1_000_000_000n + j, maxFeePerGas: 3_000_000_000n + j };
}

// ---------------------------------------------------------------------------
// State: one run log per proposal+phase, polled by the frontend
// ---------------------------------------------------------------------------
const runs = {}; // { `${id}:${phase}`: { running, startedAt, log: [] } }

function runKey(proposalId, phase) { return `${proposalId}:${phase}`; }

function getRun(proposalId, phase) {
  return runs[runKey(proposalId, phase)] || { running: false, log: [] };
}

function log(run, msg) {
  const line = `${new Date().toISOString().slice(11, 19)} ${msg}`;
  run.log.push(line);
  if (run.log.length > 200) run.log.shift();
  console.log(`[demo] ${line}`);
}

// ---------------------------------------------------------------------------
// Wallets
// ---------------------------------------------------------------------------
function demoWallets(provider) {
  return WALLET_INDICES.map((i) => {
    const w = ethers.HDNodeWallet.fromPhrase(ANVIL_MNEMONIC, undefined, `m/44'/60'/0'/0/${i}`);
    return new ethers.NonceManager(w.connect(provider));
  });
}

// NonceManager seeds itself from the 'pending' count, and anvil reports
// nonce-gapped leftovers as pending — one stale tx and every new one is born
// with nonce+1, queued forever. Drop the pool until pending == latest for
// every demo wallet before a run signs anything.
async function syncNonces(run, provider, wallets) {
  for (let attempt = 0; attempt < 5; attempt++) {
    await clearTxpool(provider);
    let clean = true;
    for (const w of wallets) {
      const addr = await w.getAddress();
      const [pending, latest] = await Promise.all([
        provider.getTransactionCount(addr, 'pending'),
        provider.getTransactionCount(addr, 'latest'),
      ]);
      if (pending !== latest) clean = false;
      if (typeof w.reset === 'function') w.reset();
      // Forked anvil does NOT fund its default accounts — they carry their
      // real (drained) Sepolia balances. Top up gas money directly.
      const bal = await provider.getBalance(addr);
      if (bal < 10n ** 18n) {
        await provider.send('anvil_setBalance', [addr, '0x21E19E0C9BAB2400000']); // 10k ETH
      }
    }
    if (clean) return;
    log(run, 'stale txs in the pool — clearing and retrying nonce sync…');
    await sleep(1000);
  }
  throw new Error('could not sync wallet nonces with the chain');
}

// Setup txs (mints, approvals) must survive the occasional dropped/stuck tx:
// retry with a fresh fee jitter and a re-synced nonce instead of dying.
async function sendRetry(run, wallet, makeTx, label, tries = 3) {
  for (let i = 0; i < tries; i++) {
    try {
      return await waitTx(makeTx(), wallet);
    } catch (e) {
      if (i === tries - 1) throw e;
      log(run, `${label} retrying (${(e.shortMessage || e.message || '').slice(0, 50)})`);
      if (typeof wallet?.reset === 'function') wallet.reset();
      await sleep(1500);
    }
  }
}

// Aqua ship/fill wait on tx.wait() with no deadline — cap them so one stuck
// tx cannot leave the whole run spinning forever.
function withTimeout(promise, ms, label) {
  return Promise.race([
    promise,
    sleep(ms).then(() => { throw new Error(`${label} timed out after ${ms / 1000}s`); }),
  ]);
}

async function ensureUsdc(run, wallets, usdcAddr, minUnits) {
  for (const w of wallets) {
    const addr = await w.getAddress();
    const usdc = new ethers.Contract(usdcAddr, ERC20_ABI, w);
    const bal = await usdc.balanceOf(addr);
    if (bal < minUnits) {
      await sendRetry(run, w, () => usdc.mint(addr, minUnits * 2n, feeJitter()), `mint for ${addr.slice(0, 8)}`);
      log(run, `funded ${addr.slice(0, 8)} with ${ethers.formatUnits(minUnits * 2n, 6)} USDC`);
    }
  }
}

// ---------------------------------------------------------------------------
// Phase 1: auction activity — staggered bids that walk the clearing price up
// ---------------------------------------------------------------------------
async function runAuctionDemo(proposalAddress, proposalId) {
  const key = runKey(proposalId, 'auction');
  if (runs[key]?.running) throw new Error('auction demo already running');
  const run = (runs[key] = { running: true, startedAt: Date.now(), log: [] });

  const finish = (msg) => { log(run, msg); run.running = false; };

  try {
    const provider = getProvider();
    const wallets = demoWallets(provider);
    await syncNonces(run, provider, wallets);
    const proposal = new ethers.Contract(proposalAddress, PROPOSAL_ABI, provider);
    const [yesAuction, noAuction, usdcAddr, state] = await Promise.all([
      proposal.yesAuction(), proposal.noAuction(), proposal.collateral(), proposal.state(),
    ]);
    if (Number(state) !== 0) throw new Error(`proposal not in auction (state=${state})`);

    log(run, `5 demo wallets joining the auction on ${proposalAddress.slice(0, 10)}…`);

    // The script's USDC budgets are calibrated against UNI's ~$0.36 floor.
    // Floors scale with the subject's Pyth price (ETH ≈ $188, BTC ≈ $6k) and
    // so does the graduation minimum — scale every budget by the same factor
    // or the auction can never reach its quorum.
    const roYesEarly = new ethers.Contract(yesAuction, CCA_ABI, provider);
    const floorQ96 = await roYesEarly.floorPrice();
    const floor6d = Number((floorQ96 * 10n ** 18n) / Q96) / 1e6;
    const scale = Math.max(1, floor6d / 0.36);
    if (scale > 1.5) log(run, `subject floor $${floor6d.toFixed(2)} — scaling bid budgets x${scale.toFixed(0)}`);

    await ensureUsdc(run, wallets, usdcAddr, BigInt(Math.ceil(500 * scale)) * 10n ** 6n);

    // One-time approvals: USDC -> Permit2, Permit2 -> each auction
    for (const w of wallets) {
      const addr = await w.getAddress();
      const usdc = new ethers.Contract(usdcAddr, ERC20_ABI, w);
      if ((await usdc.allowance(addr, PERMIT2)) < 10n ** 30n) {
        await sendRetry(run, w, () => usdc.approve(PERMIT2, ethers.MaxUint256, feeJitter()), `permit2 approve ${addr.slice(0, 8)}`);
      }
      const p2 = new ethers.Contract(PERMIT2, PERMIT2_ABI, w);
      for (const auction of [yesAuction, noAuction]) {
        const [amt] = await p2.allowance(addr, usdcAddr, auction);
        if (amt < 10n ** 12n) {
          await sendRetry(run, w, () => p2.approve(usdcAddr, auction, (1n << 160n) - 1n, (1n << 48n) - 1n, feeJitter()), `auction approve ${addr.slice(0, 8)}`);
        }
      }
    }
    log(run, 'approvals in place — bids start now');

    // The script: who bids what, when. Max prices are multiples of the LIVE
    // clearing at bid time, so each wave of demand can lift the price for the
    // next — that is what draws a moving chart. YES gets the stronger book.
    // Calibrated so the final clearings land a believable 2-4x above the
    // floor on BOTH sides (YES a notch higher), instead of running away by
    // hundreds. Whales go FIRST — their absolute caps survive the final
    // clearing, so they always hold claimable tokens for the market phase
    // even if the auction ends before the tail of the script.
    const script = [
      { w: 4, side: 'YES', usdc: 60, floorMult: 8, wait: 0 },
      { w: 2, side: 'NO',  usdc: 45, floorMult: 7, wait: 2 },
      { w: 0, side: 'YES', usdc: 20, mult: 1.5, wait: 10 }, // let the whale spike decay first
      { w: 1, side: 'NO',  usdc: 15, mult: 1.4, wait: 4 },
      { w: 3, side: 'YES', usdc: 25, mult: 1.8, wait: 3 },
      { w: 1, side: 'YES', usdc: 30, mult: 2.2, wait: 4 },
      { w: 0, side: 'NO',  usdc: 15, mult: 1.7, wait: 3 },
      { w: 3, side: 'NO',  usdc: 15, mult: 2.0, wait: 3 },
      { w: 2, side: 'YES', usdc: 35, mult: 2.6, wait: 3 },
      { w: 4, side: 'NO',  usdc: 12, mult: 2.3, wait: 3 },
    ];

    // Two invariants keep the market phase alive no matter how the timing
    // lands. (1) Non-whale caps never exceed 6x floor — strictly below the
    // whale caps (7-8x), so even a spike frozen by the auction close cannot
    // outbid the whales. (2) No bids in the last TAIL_BLOCKS: a bid near the
    // close freezes its own spike as the final clearing and outbids everyone.
    const NON_WHALE_CAP_MULT = 6n;
    const TAIL_BLOCKS = 12n;

    // The contract prices blocks at 12s but anvil mines every 2s, so a nominal
    // duration runs ~6x faster in wall time. Scale the pacing to fit whatever
    // is actually left of the auction, keeping a tail for the last bids.
    const roYes = new ethers.Contract(yesAuction, CCA_ABI, provider);
    const [nowB, endB] = await Promise.all([provider.getBlockNumber(), roYes.endBlock()]);
    const realSecondsLeft = Number(endB - BigInt(nowB)) * 2;
    const scriptSeconds = script.reduce((s, x) => s + x.wait, 0);
    const pace = Math.min(1, (realSecondsLeft * 0.6) / Math.max(1, scriptSeconds));
    log(run, `~${realSecondsLeft}s of auction left — pacing bids at ${(pace * 100).toFixed(0)}%`);

    let placedCount = 0;
    for (const step of script) {
      await sleep(step.wait * pace * 1000);
      const auctionAddr = step.side === 'YES' ? yesAuction : noAuction;
      const auction = new ethers.Contract(auctionAddr, CCA_ABI, wallets[step.w]);
      const ro = new ethers.Contract(auctionAddr, CCA_ABI, provider);

      const budget = BigInt(Math.round(step.usdc * scale)) * 10n ** 6n;
      const addr = await wallets[step.w].getAddress();

      // BidMustBeAboveClearingPrice trap: the clearingPrice() VIEW lags at the
      // last checkpoint, but submitBid recomputes live — right after a whale
      // bid against thin released supply the real clearing spikes to the whale
      // cap (~8x floor) for ~20s while the view still reports the floor. A
      // re-read can't see it, so escalate the cap instead: scripted intent
      // first, then 5x floor, then 9x floor — above ANY possible clearing
      // (whale caps are 7-8x), so the last attempt cannot be rejected on price.
      let placed = false;
      for (let attempt = 0; attempt < 4 && !placed; attempt++) {
        const [nowBlock, endBlock] = await Promise.all([provider.getBlockNumber(), ro.endBlock()]);
        if (BigInt(nowBlock) >= endBlock - TAIL_BLOCKS) {
          finish(`leaving the last blocks quiet so the clearing settles — ${placedCount} bids placed`);
          return;
        }
        const [clearing, tick, floorPx] = await Promise.all([ro.clearingPrice(), ro.tickSpacing(), ro.floorPrice()]);
        // mult rides the live clearing (these bids often end up outbid —
        // refund material) but is hard-capped below the whale caps; floorMult
        // sets the absolute whale cap that must survive the final clearing so
        // the whales hold tokens for the market phase.
        const capMax = floorPx * NON_WHALE_CAP_MULT;
        const scripted = step.floorMult
          ? floorPx * BigInt(step.floorMult)
          : (clearing * BigInt(Math.round(step.mult * 100))) / 100n;
        let rawMax;
        if (step.floorMult) {
          rawMax = scripted; // whale caps are already absolute — never escalate them
        } else {
          rawMax = [scripted, scripted, floorPx * 4n, capMax][attempt];
          if (rawMax > capMax) rawMax = capMax;
        }
        let maxQ96 = (rawMax / tick) * tick;
        if (maxQ96 <= clearing) maxQ96 = (clearing / tick) * tick + 2n * tick;
        if (!step.floorMult && maxQ96 > capMax) {
          log(run, `${addr.slice(0, 8)} ${step.side} bid skipped — clearing already above the non-whale cap`);
          break;
        }
        try {
          // Nonce-free pre-check: a plain revert here (spiked live clearing)
          // costs nothing — a reverted SEND would poison the NonceManager and
          // stall the next attempt for a full timeout.
          await auction.submitBid.staticCall(maxQ96, budget, addr, '0x');
          await waitTx(auction.submitBid(maxQ96, budget, addr, '0x', feeJitter()), wallets[step.w]);
          const px = Number((clearing * 10n ** 18n) / Q96) / 1e6;
          const capNote = step.floorMult ? `${step.floorMult}x floor` : attempt <= 1 ? `${step.mult}x` : `escalated ${attempt === 2 ? '4' : '6'}x floor`;
          log(run, `${addr.slice(0, 8)} bid ${Math.round(step.usdc * scale)} USDC on ${step.side} (max ${capNote}, clearing was $${px.toFixed(2)})`);
          placed = true;
          placedCount++;
        } catch (e) {
          if (typeof wallets[step.w].reset === 'function') wallets[step.w].reset();
          log(run, `${addr.slice(0, 8)} ${step.side} bid rejected (attempt ${attempt + 1}/4, ${(e.shortMessage || e.message || '').slice(0, 60)}) — retrying…`);
          await sleep(3000);
        }
      }
      if (!placed) log(run, `wallet ${step.w} ${step.side} bid skipped after 4 attempts`);
    }
    finish(`auction script done — ${placedCount} bids placed across both sides`);
  } catch (e) {
    finish(`error: ${e.message}`);
  }
}

// ---------------------------------------------------------------------------
// Phase 2: market activity — claims, then staggered Aqua ship/fill on both books
// ---------------------------------------------------------------------------
async function claimAuctionTokens(run, provider, wallets, auctionAddr, label) {
  const ro = new ethers.Contract(auctionAddr, CCA_ABI, provider);
  const fromBlock = await ro.startBlock();
  // Only bids whose max price beat the final clearing exit cleanly with
  // exitBid — the partially-outbid path needs checkpoint hints and has proven
  // unreliable against the deployed CCA, so the demo leaves those bids alone
  // (they double as material for the refund UI).
  const finalClearing = BigInt(await ro.clearingPrice());
  for (const w of wallets) {
    const addr = await w.getAddress();
    const [submitted, exited] = await Promise.all([
      provider.getLogs({ address: auctionAddr, fromBlock, topics: [ro.interface.getEvent('BidSubmitted').topicHash, null, ethers.zeroPadValue(addr, 32)] }),
      provider.getLogs({ address: auctionAddr, fromBlock, topics: [ro.interface.getEvent('BidExited').topicHash, null, ethers.zeroPadValue(addr, 32)] }),
    ]);
    const done = new Set(exited.map((l) => ro.interface.parseLog(l).args.bidId.toString()));
    const auction = new ethers.Contract(auctionAddr, CCA_ABI, w);
    for (const l of submitted) {
      const parsed = ro.interface.parseLog(l).args;
      const bidId = parsed.id;
      if (done.has(bidId.toString())) continue;
      if (BigInt(parsed.priceQ96) <= finalClearing) {
        log(run, `${addr.slice(0, 8)} ${label} bid #${bidId} was outbid — left for the refund flow`);
        continue;
      }
      try {
        await waitTx(auction.exitBid(bidId, feeJitter()), w);
        await waitTx(auction.claimTokens(bidId, feeJitter()), w);
        log(run, `${addr.slice(0, 8)} claimed ${label} tokens for bid #${bidId}`);
      } catch (e) {
        log(run, `${addr.slice(0, 8)} claim ${label} #${bidId} skipped (${e.shortMessage || e.message})`);
      }
    }
  }
}

async function runMarketDemo(proposalAddress, proposalId, bias = 'yes') {
  const key = runKey(proposalId, 'market');
  if (runs[key]?.running) throw new Error('market demo already running');
  const run = (runs[key] = { running: true, startedAt: Date.now(), log: [] });
  const finish = (msg) => { log(run, msg); run.running = false; };

  try {
    const provider = getProvider();
    const wallets = demoWallets(provider);
    await syncNonces(run, provider, wallets);
    const proposal = new ethers.Contract(proposalAddress, PROPOSAL_ABI, provider);
    const [yesAuction, noAuction, yesToken, noToken, usdcAddr, state] = await Promise.all([
      proposal.yesAuction(), proposal.noAuction(), proposal.yesToken(), proposal.noToken(),
      proposal.collateral(), proposal.state(),
    ]);
    if (Number(state) !== 1) throw new Error(`proposal not live (state=${state})`);

    const cfg = { ...aquaCfg, usdcAddress: usdcAddr };

    // Claims open a couple of blocks after claimBlock — right after an
    // auto-settle the window can still be shut, so wait it out.
    const claimBlock = await new ethers.Contract(yesAuction, CCA_ABI, provider).claimBlock();
    while (BigInt(await provider.getBlockNumber()) <= claimBlock + 2n) {
      log(run, 'waiting for the claim window to open…');
      await sleep(4000);
    }
    log(run, 'claiming auction tokens for the demo wallets…');
    await claimAuctionTokens(run, provider, wallets, yesAuction, 'YES');
    await claimAuctionTokens(run, provider, wallets, noAuction, 'NO');

    await ensureUsdc(run, wallets, usdcAddr, 50_000n * 10n ** 6n);

    // Approvals: makers custody via Aqua (tokens + USDC), takers pay the router
    for (const w of wallets) {
      const addr = await w.getAddress();
      for (const [token, spender] of [
        [yesToken, cfg.aquaAddress], [noToken, cfg.aquaAddress], [usdcAddr, cfg.aquaAddress],
        [usdcAddr, cfg.routerAddress], [yesToken, cfg.routerAddress], [noToken, cfg.routerAddress],
      ]) {
        const erc = new ethers.Contract(token, ERC20_ABI, w);
        if ((await erc.allowance(addr, spender)) < 10n ** 30n) {
          await sendRetry(run, w, () => erc.approve(spender, ethers.MaxUint256, feeJitter()), `market approve ${addr.slice(0, 8)}`);
        }
      }
    }
    log(run, 'approvals in place — trading starts now');

    // Base forecast per side: the auction's final clearing (USDC 6d per token)
    const clr = async (a) => {
      const c = await new ethers.Contract(a, CCA_ABI, provider).clearingPrice();
      return Number((c * 10n ** 18n) / Q96) / 1e6;
    };
    const yesBase = await clr(yesAuction);
    const noBase = await clr(noAuction);
    log(run, `base forecasts — YES $${yesBase.toFixed(2)}, NO $${noBase.toFixed(2)}`);

    // bias='no' uses each step's pxNo drift instead of px. The auction always
    // leaves the YES base well above NO, and the TWAP weighs the WHOLE path —
    // a gentle mirror is not enough, so the no-side paths cross hard: YES
    // collapses toward 0.42x its base while NO doubles off its own.
    const px = (step) => (bias === 'no' ? step.pxNo : step.px);
    if (bias === 'no') log(run, 'bias: the crowd turns against this one — NO climbs');

    // Resting BIDS for the order book (display seed). The Aqua lot protocol is
    // maker-sells-only, so buy-side depth cannot rest on-chain — seed believable
    // bid rows (some partially filled) straight into the book store so the demo
    // book reads like a real two-sided market.
    const seedBids = async (side, base) => {
      const sideKey = side === 'YES' ? 'approve' : 'reject';
      await Order.deleteMany({ proposalId: String(proposalId), side: sideKey, orderType: 'buy', txHash: 'demo-seed' });
      const rows = [
        { mult: 0.95, qty: 2.4, fillPct: 0.55, who: 1 },
        { mult: 0.9, qty: 1.6, fillPct: 0, who: 3 },
        { mult: 0.85, qty: 3.2, fillPct: 0.3, who: 0 },
        { mult: 0.79, qty: 1.2, fillPct: 0, who: 2 },
      ];
      for (const r of rows) {
        const amount = ethers.parseUnits(r.qty.toString(), 18);
        const filled = (amount * BigInt(Math.round(r.fillPct * 100))) / 100n;
        await Order.create({
          proposalId: String(proposalId),
          side: sideKey,
          orderType: 'buy',
          orderExecution: 'limit',
          price: String(Math.round(base * r.mult * 1e6)),
          amount: amount.toString(),
          filledAmount: filled.toString(),
          userAddress: await wallets[r.who].getAddress(),
          status: r.fillPct > 0 ? 'partial' : 'open',
          txHash: 'demo-seed',
        });
      }
      await updateOrderBook(String(proposalId), sideKey).catch(() => {});
    };
    // Anchor the seeded bids (and the resting asks below) to where each side
    // will END after the scripted drift, so the final book reads coherent:
    // bids under the last trade, asks above it, for either bias.
    const yesFinal = yesBase * (bias === 'no' ? 0.42 : 1.3);
    const noFinal = noBase * (bias === 'no' ? 2.1 : 0.85);
    await seedBids('YES', yesFinal);
    await seedBids('NO', noFinal);
    log(run, 'bid side seeded on both books');

    // The script: maker ships a lot, a different taker fills it. With the
    // default bias the YES side drifts up (conviction building) and NO drifts
    // down — the futarchy gap opens on the charts in real time. qty in whole
    // tokens, price as multiple of base.
    const script = [
      { maker: 4, taker: 1, side: 'YES', qty: 2.0, px: 1.00, pxNo: 1.00, wait: 0 },
      { maker: 2, taker: 3, side: 'NO',  qty: 1.5, px: 1.00, pxNo: 1.00, wait: 3 },
      { maker: 4, taker: 0, side: 'YES', qty: 1.8, px: 1.05, pxNo: 0.92, wait: 3 },
      { maker: 2, taker: 0, side: 'NO',  qty: 1.2, px: 0.96, pxNo: 1.20, wait: 4 },
      { maker: 4, taker: 2, side: 'YES', qty: 2.5, px: 1.09, pxNo: 0.84, wait: 3 },
      { maker: 4, taker: 3, side: 'YES', qty: 1.5, px: 1.14, pxNo: 0.74, wait: 4 },
      { maker: 2, taker: 1, side: 'NO',  qty: 1.8, px: 0.91, pxNo: 1.45, wait: 3 },
      { maker: 4, taker: 0, side: 'YES', qty: 2.2, px: 1.18, pxNo: 0.63, wait: 3 },
      { maker: 2, taker: 4, side: 'NO',  qty: 1.0, px: 0.88, pxNo: 1.75, wait: 4 },
      { maker: 4, taker: 1, side: 'YES', qty: 1.6, px: 1.24, pxNo: 0.52, wait: 3 },
      { maker: 2, taker: 0, side: 'NO',  qty: 1.4, px: 0.85, pxNo: 2.10, wait: 3 },
      { maker: 4, taker: 3, side: 'YES', qty: 2.0, px: 1.30, pxNo: 0.42, wait: 4 },
    ];

    let filled = 0;
    for (const step of script) {
      await sleep(step.wait * 1000);
      const outcomeToken = step.side === 'YES' ? yesToken : noToken;
      const base = step.side === 'YES' ? yesBase : noBase;
      const price = base * px(step);
      const lotToken = ethers.parseUnits(step.qty.toString(), 18);
      const lotUsdc = (lotToken * ethers.parseUnits(price.toFixed(6), 6)) / 10n ** 18n;
      const makerW = wallets[step.maker];
      const takerW = wallets[step.taker];
      const makerAddr = await makerW.getAddress();
      const takerAddr = await takerW.getAddress();

      // Maker may not hold enough outcome tokens (claims vary) — skip honestly
      const bal = await new ethers.Contract(outcomeToken, ERC20_ABI, provider).balanceOf(makerAddr);
      if (bal < lotToken) { log(run, `${makerAddr.slice(0, 8)} lacks ${step.side} tokens for a ${step.qty} lot — skipped`); continue; }

      // One failed lot must not end the session — log it and keep trading.
      try {
        const salt = BigInt(Date.now()) * 1000n + BigInt(step.maker);
        const shipped = await withTimeout(
          aquaClient.shipQuote({ makerWallet: makerW, outcomeToken, lotUsdc, lotToken, salt, cfg }), 25_000, 'ship');
        await sleep(800);
        await withTimeout(
          aquaClient.fillQuote({ takerWallet: takerW, order: shipped.order, lotUsdc, outcomeToken, cfg }), 25_000, 'fill');
        log(run, `${makerAddr.slice(0, 8)} sold ${step.qty} ${step.side} @ $${price.toFixed(2)} → filled by ${takerAddr.slice(0, 8)}`);
        filled++;
      } catch (e) {
        if (typeof makerW?.reset === 'function') makerW.reset();
        if (typeof takerW?.reset === 'function') takerW.reset();
        log(run, `${step.side} lot by ${makerAddr.slice(0, 8)} failed (${(e.shortMessage || e.message || '').slice(0, 80)}) — continuing`);
      }
    }

    // Resting ASK ladder: real Aqua lots shipped above the last trade and left
    // unfilled, so the book shows live sell-side depth anyone could take.
    const ladder = [
      { maker: 4, side: 'YES', qty: 1.4, lad: 1.05 },
      { maker: 4, side: 'YES', qty: 2.1, lad: 1.12 },
      { maker: 2, side: 'NO', qty: 1.2, lad: 1.05 },
      { maker: 2, side: 'NO', qty: 2.0, lad: 1.12 },
    ];
    for (const step of ladder) {
      const outcomeToken = step.side === 'YES' ? yesToken : noToken;
      const price = (step.side === 'YES' ? yesFinal : noFinal) * step.lad;
      const lotToken = ethers.parseUnits(step.qty.toString(), 18);
      const lotUsdc = (lotToken * ethers.parseUnits(price.toFixed(6), 6)) / 10n ** 18n;
      const makerW = wallets[step.maker];
      const makerAddr = await makerW.getAddress();
      const bal = await new ethers.Contract(outcomeToken, ERC20_ABI, provider).balanceOf(makerAddr);
      if (bal < lotToken) { log(run, `${makerAddr.slice(0, 8)} lacks ${step.side} tokens for a resting lot — skipped`); continue; }
      try {
        const salt = BigInt(Date.now()) * 1000n + 500n + BigInt(step.maker);
        await withTimeout(
          aquaClient.shipQuote({ makerWallet: makerW, outcomeToken, lotUsdc, lotToken, salt, cfg }), 25_000, 'ship');
        log(run, `${makerAddr.slice(0, 8)} resting ask: ${step.qty} ${step.side} @ $${price.toFixed(2)}`);
        await sleep(600);
      } catch (e) {
        if (typeof makerW?.reset === 'function') makerW.reset();
        log(run, `resting ${step.side} lot failed (${(e.shortMessage || e.message || '').slice(0, 60)}) — continuing`);
      }
    }
    finish(`market script done — ${filled} trades filled, resting asks on both books`);
  } catch (e) {
    finish(`error: ${e.message}`);
  }
}

// ---------------------------------------------------------------------------
// Time skip: jump the chain past the current phase (fork-only, like dev.sh skip)
// ---------------------------------------------------------------------------
async function skipPhase(proposalAddress) {
  const provider = getProvider();
  const [w] = demoWallets(provider);
  const proposal = new ethers.Contract(proposalAddress, PROPOSAL_ABI, w);
  const state = Number(await proposal.state());

  if (state === 0) {
    // Auction ends by BLOCK — mine straight past the end block, then settle.
    const [end, now] = await Promise.all([proposal.auctionEndBlock(), provider.getBlockNumber()]);
    const delta = Number(end) - now + 1;
    if (delta > 0) await provider.send('anvil_mine', ['0x' + delta.toString(16)]);
    try {
      await waitTx(proposal.settleAuctions(feeJitter()), w);
    } catch (_) { /* backend monitor may have settled first — state check below */ }
    return { skipped: 'auction', state: Number(await proposal.state()) };
  }

  if (state === 1) {
    // Push the freshest TWAPs BEFORE resolving: the periodic pusher fires once
    // a minute, and resolving ahead of it settles on stale/zero TWAPs — an
    // empty tie where both sides lose and the resolution view shows nothing.
    try {
      const { pushOnce } = require('./twapPusherService');
      const attestor = new ethers.NonceManager(new ethers.Wallet(process.env.PRIVATE_KEY, provider));
      await pushOnce({ provider, signer: attestor });
    } catch (e) {
      console.error('[demo] pre-resolve twap push failed:', e.message);
    }

    // Live ends by TIMESTAMP — warp past liveEnd, then resolve.
    const [liveEnd, block] = await Promise.all([proposal.liveEnd(), provider.getBlock('latest')]);
    const delta = Number(liveEnd) - Number(block.timestamp) + 1;
    if (delta > 0) {
      await provider.send('evm_increaseTime', [delta]);
      await provider.send('anvil_mine', ['0x1']);
    }
    try {
      await waitTx(proposal.resolve(feeJitter()), w);
    } catch (_) { /* monitor may resolve it seconds later */ }
    return { skipped: 'live', state: Number(await proposal.state()) };
  }

  return { skipped: 'nothing', state };
}

module.exports = { runAuctionDemo, runMarketDemo, getRun, skipPhase };
