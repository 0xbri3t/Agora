#!/usr/bin/env node
// Cancels a shipped lot (dock): releases virtual balances, further fills revert.
// Usage: node scripts/demo/cancel-quote.js <strategyHash>
// Comments simple in English
const { getProvider, getMaker, getCfg, loadState, explorer } = require('./lib');
const aquaClient = require('../../src/services/aquaClient');

async function main() {
  const [strategyHash] = process.argv.slice(2);
  const st = loadState();
  if (!strategyHash || !st.orders?.[strategyHash]) {
    console.error('usage: cancel-quote.js <strategyHash>');
    console.error('known lots:', Object.keys(st.orders || {}).join('\n  ') || '(none)');
    process.exit(1);
  }

  const provider = getProvider();
  const maker = getMaker(provider);
  const cfg = getCfg();

  const res = await aquaClient.cancelQuote({
    makerWallet: maker, strategyHash, outcomeToken: cfg.yesAddress, cfg,
  });

  console.log(`docked (cancelled) lot ${strategyHash}`);
  console.log(`tx: ${explorer(res.txHash)}`);
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
