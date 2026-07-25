// Demo orchestrator: five funded local wallets act out a believable auction
// and market session on a proposal, staggered in time so the charts move the
// way a real crowd would move them. Fork-only (anvil chain 31337) — the
// wallets derive from anvil's default mnemonic, so they are pre-funded with
// ETH and can mint MockUSDC freely.
// Comments simple in English
const { ethers } = require('ethers');
const { getProvider } = require('../config/ethers');
const aquaClient = require('./aquaClient');
const aquaCfg = require('../config/aqua');

const ANVIL_MNEMONIC = 'test test test test test test test test test test test junk';
const WALLET_INDICES = [5, 6, 7, 8, 9]; // leave 0-4 for humans/deployer

const PROPOSAL_ABI = [
  'function yesAuction() view returns (address)',
  'function noAuction() view returns (address)',
  'function yesToken() view returns (address)',
  'function noToken() view returns (address)',
  'function collateral() view returns (address)',
  'function state() view returns (uint8)',
];
const CCA_ABI = [
  'function clearingPrice() view returns (uint256)',
  'function floorPrice() view returns (uint256)',
  'function tickSpacing() view returns (uint256)',
  'function startBlock() view returns (uint64)',
  'function endBlock() view returns (uint64)',
  'function submitBid(uint256 maxPriceQ96, uint128 amount, address owner, bytes hookData) payable returns (uint256)',
  'function exitBid(uint256 bidId)',
  'function claimTokens(uint256 bidId)',
  'event BidSubmitted(uint256 indexed id, address indexed owner, uint256 priceQ96, uint128 amount)',
  'event BidExited(uint256 indexed bidId, address indexed owner, uint256 tokensFilled, uint256 currencyRefunded)',
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

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

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

async function ensureUsdc(run, wallets, usdcAddr, minUnits) {
  for (const w of wallets) {
    const addr = await w.getAddress();
    const usdc = new ethers.Contract(usdcAddr, ERC20_ABI, w);
    const bal = await usdc.balanceOf(addr);
    if (bal < minUnits) {
      await (await usdc.mint(addr, minUnits * 2n)).wait();
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
    const proposal = new ethers.Contract(proposalAddress, PROPOSAL_ABI, provider);
    const [yesAuction, noAuction, usdcAddr, state] = await Promise.all([
      proposal.yesAuction(), proposal.noAuction(), proposal.collateral(), proposal.state(),
    ]);
    if (Number(state) !== 0) throw new Error(`proposal not in auction (state=${state})`);

    log(run, `5 demo wallets joining the auction on ${proposalAddress.slice(0, 10)}…`);
    await ensureUsdc(run, wallets, usdcAddr, 50_000n * 10n ** 6n);

    // One-time approvals: USDC -> Permit2, Permit2 -> each auction
    for (const w of wallets) {
      const addr = await w.getAddress();
      const usdc = new ethers.Contract(usdcAddr, ERC20_ABI, w);
      if ((await usdc.allowance(addr, PERMIT2)) < 10n ** 30n) {
        await (await usdc.approve(PERMIT2, ethers.MaxUint256)).wait();
      }
      const p2 = new ethers.Contract(PERMIT2, PERMIT2_ABI, w);
      for (const auction of [yesAuction, noAuction]) {
        const [amt] = await p2.allowance(addr, usdcAddr, auction);
        if (amt < 10n ** 12n) {
          await (await p2.approve(usdcAddr, auction, (1n << 160n) - 1n, (1n << 48n) - 1n)).wait();
        }
      }
    }
    log(run, 'approvals in place — bids start now');

    // The script: who bids what, when. Max prices are multiples of the LIVE
    // clearing at bid time, so each wave of demand can lift the price for the
    // next — that is what draws a moving chart. YES gets the stronger book.
    const script = [
      { w: 0, side: 'YES', usdc: 3_000, mult: 1.6, wait: 0 },
      { w: 1, side: 'NO',  usdc: 2_000, mult: 1.4, wait: 3 },
      { w: 2, side: 'YES', usdc: 4_000, mult: 2.2, wait: 3 },
      { w: 3, side: 'NO',  usdc: 1_500, mult: 1.8, wait: 4 },
      { w: 4, side: 'YES', usdc: 2_500, mult: 3.0, wait: 3 },
      { w: 1, side: 'YES', usdc: 3_500, mult: 4.0, wait: 4 },
      { w: 3, side: 'YES', usdc: 5_000, mult: 5.0, wait: 3 },
      { w: 0, side: 'NO',  usdc: 1_000, mult: 2.5, wait: 3 },
      { w: 2, side: 'NO',  usdc: 2_500, mult: 3.5, wait: 4 },
      { w: 4, side: 'YES', usdc: 6_000, mult: 6.0, wait: 3 },
    ];

    // The contract prices blocks at 12s but anvil mines every 2s, so a nominal
    // duration runs ~6x faster in wall time. Scale the pacing to fit whatever
    // is actually left of the auction, keeping a tail for the last bids.
    const roYes = new ethers.Contract(yesAuction, CCA_ABI, provider);
    const [nowB, endB] = await Promise.all([provider.getBlockNumber(), roYes.endBlock()]);
    const realSecondsLeft = Number(endB - BigInt(nowB)) * 2;
    const scriptSeconds = script.reduce((s, x) => s + x.wait, 0);
    const pace = Math.min(1, (realSecondsLeft * 0.6) / Math.max(1, scriptSeconds));
    log(run, `~${realSecondsLeft}s of auction left — pacing bids at ${(pace * 100).toFixed(0)}%`);

    for (const step of script) {
      await sleep(step.wait * pace * 1000);
      const auctionAddr = step.side === 'YES' ? yesAuction : noAuction;
      const auction = new ethers.Contract(auctionAddr, CCA_ABI, wallets[step.w]);
      const ro = new ethers.Contract(auctionAddr, CCA_ABI, provider);

      const [nowBlock, endBlock] = await Promise.all([provider.getBlockNumber(), ro.endBlock()]);
      if (BigInt(nowBlock) >= endBlock) { finish('auction ended — stopping bid script'); return; }

      const [clearing, tick] = await Promise.all([ro.clearingPrice(), ro.tickSpacing()]);
      const rawMax = (clearing * BigInt(Math.round(step.mult * 100))) / 100n;
      let maxQ96 = (rawMax / tick) * tick;
      if (maxQ96 <= clearing) maxQ96 = (clearing / tick) * tick + tick;

      const budget = BigInt(step.usdc) * 10n ** 6n;
      const addr = await wallets[step.w].getAddress();
      await (await auction.submitBid(maxQ96, budget, addr, '0x')).wait();
      const px = Number((clearing * 10n ** 18n) / Q96) / 1e6;
      log(run, `${addr.slice(0, 8)} bid ${step.usdc} USDC on ${step.side} (max ${step.mult}x, clearing was $${px.toFixed(2)})`);
    }
    finish('auction script done — 10 bids placed across both sides');
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
  for (const w of wallets) {
    const addr = await w.getAddress();
    const [submitted, exited] = await Promise.all([
      provider.getLogs({ address: auctionAddr, fromBlock, topics: [ro.interface.getEvent('BidSubmitted').topicHash, null, ethers.zeroPadValue(addr, 32)] }),
      provider.getLogs({ address: auctionAddr, fromBlock, topics: [ro.interface.getEvent('BidExited').topicHash, null, ethers.zeroPadValue(addr, 32)] }),
    ]);
    const done = new Set(exited.map((l) => ro.interface.parseLog(l).args.bidId.toString()));
    const auction = new ethers.Contract(auctionAddr, CCA_ABI, w);
    for (const l of submitted) {
      const bidId = ro.interface.parseLog(l).args.id;
      if (done.has(bidId.toString())) continue;
      try {
        await (await auction.exitBid(bidId)).wait();
        await (await auction.claimTokens(bidId)).wait();
        log(run, `${addr.slice(0, 8)} claimed ${label} tokens for bid #${bidId}`);
      } catch (e) {
        log(run, `${addr.slice(0, 8)} claim ${label} #${bidId} skipped (${e.shortMessage || e.message})`);
      }
    }
  }
}

async function runMarketDemo(proposalAddress, proposalId) {
  const key = runKey(proposalId, 'market');
  if (runs[key]?.running) throw new Error('market demo already running');
  const run = (runs[key] = { running: true, startedAt: Date.now(), log: [] });
  const finish = (msg) => { log(run, msg); run.running = false; };

  try {
    const provider = getProvider();
    const wallets = demoWallets(provider);
    const proposal = new ethers.Contract(proposalAddress, PROPOSAL_ABI, provider);
    const [yesAuction, noAuction, yesToken, noToken, usdcAddr, state] = await Promise.all([
      proposal.yesAuction(), proposal.noAuction(), proposal.yesToken(), proposal.noToken(),
      proposal.collateral(), proposal.state(),
    ]);
    if (Number(state) !== 1) throw new Error(`proposal not live (state=${state})`);

    const cfg = { ...aquaCfg, usdcAddress: usdcAddr };

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
          await (await erc.approve(spender, ethers.MaxUint256)).wait();
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

    // The script: maker ships a lot, a different taker fills it. YES drifts up
    // (conviction building), NO drifts down — the futarchy gap opens on the
    // charts in real time. qty in whole tokens, price as multiple of base.
    const script = [
      { maker: 0, taker: 1, side: 'YES', qty: 2.0, px: 1.00, wait: 0 },
      { maker: 2, taker: 3, side: 'NO',  qty: 1.5, px: 1.00, wait: 3 },
      { maker: 1, taker: 4, side: 'YES', qty: 1.8, px: 1.05, wait: 3 },
      { maker: 3, taker: 0, side: 'NO',  qty: 1.2, px: 0.96, wait: 4 },
      { maker: 4, taker: 2, side: 'YES', qty: 2.5, px: 1.09, wait: 3 },
      { maker: 0, taker: 3, side: 'YES', qty: 1.5, px: 1.14, wait: 4 },
      { maker: 2, taker: 1, side: 'NO',  qty: 1.8, px: 0.91, wait: 3 },
      { maker: 1, taker: 0, side: 'YES', qty: 2.2, px: 1.18, wait: 3 },
      { maker: 3, taker: 4, side: 'NO',  qty: 1.0, px: 0.88, wait: 4 },
      { maker: 4, taker: 1, side: 'YES', qty: 1.6, px: 1.24, wait: 3 },
      { maker: 2, taker: 0, side: 'NO',  qty: 1.4, px: 0.85, wait: 3 },
      { maker: 0, taker: 4, side: 'YES', qty: 2.0, px: 1.30, wait: 4 },
    ];

    for (const step of script) {
      await sleep(step.wait * 1000);
      const outcomeToken = step.side === 'YES' ? yesToken : noToken;
      const base = step.side === 'YES' ? yesBase : noBase;
      const price = base * step.px;
      const lotToken = ethers.parseUnits(step.qty.toString(), 18);
      const lotUsdc = (lotToken * ethers.parseUnits(price.toFixed(6), 6)) / 10n ** 18n;
      const makerW = wallets[step.maker];
      const takerW = wallets[step.taker];
      const makerAddr = await makerW.getAddress();
      const takerAddr = await takerW.getAddress();

      // Maker may not hold enough outcome tokens (claims vary) — skip honestly
      const bal = await new ethers.Contract(outcomeToken, ERC20_ABI, provider).balanceOf(makerAddr);
      if (bal < lotToken) { log(run, `${makerAddr.slice(0, 8)} lacks ${step.side} tokens for a ${step.qty} lot — skipped`); continue; }

      const salt = BigInt(Date.now()) * 1000n + BigInt(step.maker);
      const shipped = await aquaClient.shipQuote({ makerWallet: makerW, outcomeToken, lotUsdc, lotToken, salt, cfg });
      await sleep(800);
      await aquaClient.fillQuote({ takerWallet: takerW, order: shipped.order, lotUsdc, outcomeToken, cfg });
      log(run, `${makerAddr.slice(0, 8)} sold ${step.qty} ${step.side} @ $${price.toFixed(2)} → filled by ${takerAddr.slice(0, 8)}`);
    }
    finish('market script done — trades printed on both books');
  } catch (e) {
    finish(`error: ${e.message}`);
  }
}

module.exports = { runAuctionDemo, runMarketDemo, getRun };
