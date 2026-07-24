#!/usr/bin/env node
// Fills a shipped lot exactly (all-or-nothing) as the taker.
// Usage: node scripts/demo/fill-quote.js <strategyHash>
// Comments simple in English
const { ethers } = require('ethers');
const { getProvider, getTaker, getCfg, loadState, explorer } = require('./lib');
const aquaClient = require('../../src/services/aquaClient');

async function main() {
  const [strategyHash] = process.argv.slice(2);
  const st = loadState();
  const entry = strategyHash ? st.orders?.[strategyHash] : null;
  if (!entry) {
    console.error('usage: fill-quote.js <strategyHash>  (must be shipped by ship-quote.js first)');
    console.error('known lots:', Object.keys(st.orders || {}).join('\n  ') || '(none)');
    process.exit(1);
  }

  const provider = getProvider();
  const taker = getTaker(provider);
  const cfg = getCfg();

  const res = await aquaClient.fillQuote({
    takerWallet: taker, order: entry.order,
    lotUsdc: BigInt(entry.lotUsdc), outcomeToken: cfg.yesAddress, cfg,
  });

  console.log(`filled lot ${strategyHash}`);
  console.log(`paid:     ${ethers.formatUnits(res.amountIn, 6)} USDC`);
  console.log(`received: ${ethers.formatUnits(res.amountOut, 18)} YES`);
  console.log(`tx: ${explorer(res.txHash)}  (Pulled/Pushed/Swapped events on-chain)`);
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
