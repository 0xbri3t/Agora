#!/usr/bin/env node
// Ships one fill-or-kill lot: sell <amountYes> YES at <priceUsdc> per YES.
// Usage: node scripts/demo/ship-quote.js <amountYes> <priceUsdc>   e.g. 10 0.40
// Comments simple in English
const { ethers } = require('ethers');
const { getProvider, getMaker, getCfg, saveState, loadState, explorer } = require('./lib');
const aquaClient = require('../../src/services/aquaClient');

async function main() {
  const [amountYesArg, priceArg] = process.argv.slice(2);
  if (!amountYesArg || !priceArg) {
    console.error('usage: ship-quote.js <amountYes> <priceUsdcPerYes>  e.g. 10 0.40');
    process.exit(1);
  }
  const lotToken = ethers.parseUnits(amountYesArg, 18);
  const lotUsdc = (lotToken * ethers.parseUnits(priceArg, 6)) / 10n ** 18n;

  const provider = getProvider();
  const maker = getMaker(provider);
  const cfg = getCfg();
  const makerAddr = await maker.getAddress();

  const erc20 = ['function balanceOf(address) view returns (uint256)'];
  const yes = new ethers.Contract(cfg.yesAddress, erc20, provider);
  const before = await yes.balanceOf(makerAddr);

  const salt = BigInt(Date.now());
  const res = await aquaClient.shipQuote({
    makerWallet: maker, outcomeToken: cfg.yesAddress, lotUsdc, lotToken, salt, cfg,
  });

  const after = await yes.balanceOf(makerAddr);

  console.log(`shipped lot: sell ${amountYesArg} YES @ ${priceArg} USDC (total ${ethers.formatUnits(lotUsdc, 6)} USDC)`);
  console.log(`strategyHash: ${res.strategyHash}`);
  console.log(`tx: ${explorer(res.txHash)}`);
  console.log(`maker YES balance before/after ship: ${ethers.formatUnits(before, 18)} -> ${ethers.formatUnits(after, 18)}  (unchanged: funds stay in wallet — Aqua custody)`);

  // Persist order for fill/cancel scripts
  const st = loadState();
  const orders = st.orders || {};
  orders[res.strategyHash] = { order: res.order, lotUsdc: lotUsdc.toString(), lotToken: lotToken.toString() };
  saveState({ orders });
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
