#!/usr/bin/env node
// Sets up the Aqua demo: deploys router/builder/USDC if not configured,
// deploys a demo YES token, mints balances and sets approvals.
// Usage: node scripts/demo/setup-demo.js
// Comments simple in English
const { ethers } = require('ethers');
const { getProvider, getMaker, getTaker, getCfg, saveState, deployFromArtifact, rpcUrl } = require('./lib');

const AQUA = '0x499943E74FB0cE105688beeE8Ef2ABec5D936d31';
const WETH = '0xfFf9976782d46CC05630D1f6eBAb18b2324d6B14';

async function main() {
  const provider = getProvider();
  const maker = getMaker(provider);
  const taker = getTaker(provider);
  const makerAddr = await maker.getAddress();
  const takerAddr = await taker.getAddress();
  console.log(`rpc:   ${rpcUrl()}`);
  console.log(`maker: ${makerAddr}`);
  console.log(`taker: ${takerAddr}`);

  // Auto-fund the taker with gas from the deployer if it's empty
  const takerBal = await provider.getBalance(takerAddr);
  if (takerBal < ethers.parseEther('0.002')) {
    console.log('funding taker with 0.005 ETH from deployer...');
    await (await maker.sendTransaction({ to: takerAddr, value: ethers.parseEther('0.005') })).wait();
  }

  let cfg = getCfg();

  // Deploy core stack if missing (fork demo / first live run without Task-5 broadcast)
  if (!cfg.routerAddress) {
    console.log('deploying LimitSwapVMRouter...');
    const router = await deployFromArtifact(maker, 'LimitSwapVMRouter.sol/LimitSwapVMRouter.json',
      [AQUA, WETH, makerAddr, 'FutarFi SwapVM', '1.0']);
    saveState({ router: await router.getAddress() });
  }
  if (!cfg.builderAddress) {
    console.log('deploying FutarFiQuoteBuilder...');
    const builder = await deployFromArtifact(maker, 'FutarFiQuoteBuilder.sol/FutarFiQuoteBuilder.json', [AQUA]);
    saveState({ builder: await builder.getAddress() });
  }
  if (!cfg.usdcAddress) {
    console.log('deploying MockUSDC...');
    const usdc = await deployFromArtifact(maker, 'MockUSDC.sol/MockUSDC.json', []);
    saveState({ usdc: await usdc.getAddress() });
  }

  console.log('deploying demo YES token...');
  const yes = await deployFromArtifact(maker, 'MockOutcomeToken.sol/MockOutcomeToken.json', ['FutarFi YES', 'tYES']);
  saveState({ yes: await yes.getAddress() });

  cfg = getCfg();

  // Fund + approvals
  const erc20 = ['function mint(address,uint256)', 'function approve(address,uint256) returns (bool)', 'function balanceOf(address) view returns (uint256)'];
  const yesC = new ethers.Contract(cfg.yesAddress, erc20, maker);
  const usdcC = new ethers.Contract(cfg.usdcAddress, erc20, maker);

  console.log('minting 100 YES to maker, 1000 USDC to taker...');
  await (await yesC.mint(makerAddr, 100n * 10n ** 18n)).wait();
  await (await usdcC.mint(takerAddr, 1000_000000n)).wait();

  console.log('approvals: maker YES->Aqua, taker USDC->router...');
  await (await yesC.approve(AQUA, ethers.MaxUint256)).wait();
  await (await usdcC.connect(taker).approve(cfg.routerAddress, ethers.MaxUint256)).wait();

  console.log('\n=== demo ready ===');
  console.log(JSON.stringify(getCfg(), null, 2));
  console.log('\nNext: node scripts/demo/ship-quote.js 10 0.40');
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
