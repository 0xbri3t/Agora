// Shared test harness: anvil fork of Sepolia + Agora Aqua stack deployment.
// Comments simple in English
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const { ethers } = require('ethers');

const AQUA_SEPOLIA = '0x499943E74FB0cE105688beeE8Ef2ABec5D936d31';
const WETH_SEPOLIA = '0xfFf9976782d46CC05630D1f6eBAb18b2324d6B14';
const MAKER_PK = '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80';
const TAKER_PK = '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d';

function artifact(rel) {
  const p = path.join(__dirname, '../../../blockend/out', rel);
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

function sepoliaRpcUrl() {
  if (process.env.SEPOLIA_RPC_URL) return process.env.SEPOLIA_RPC_URL;
  try {
    const env = fs.readFileSync(path.join(__dirname, '../../../blockend/.env'), 'utf8');
    const m = env.match(/^SEPOLIA_RPC_URL=(.+)$/m);
    if (m) return m[1].trim();
  } catch (_) {}
  return 'https://ethereum-sepolia-rpc.publicnode.com';
}

async function waitForRpc(url, tries = 60) {
  for (let i = 0; i < tries; i++) {
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', method: 'eth_chainId', id: 1 }),
      });
      if (res.ok) return;
    } catch (_) {}
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new Error('anvil did not become ready');
}

/// Boots an anvil fork on `port`, deploys router+builder+USDC+YES, funds and approves.
/// Returns { anvil, provider, maker, taker, cfg, yesAddress, contracts... }
async function bootAquaFork(port) {
  const rpc = `http://127.0.0.1:${port}`;
  const anvil = spawn('anvil', ['--fork-url', sepoliaRpcUrl(), '--port', String(port)], {
    stdio: ['ignore', 'ignore', 'pipe'],
  });
  anvil.stderr.on('data', (d) => console.error('[anvil]', String(d)));
  await waitForRpc(rpc);

  const provider = new ethers.JsonRpcProvider(rpc, undefined, { polling: true, pollingInterval: 200 });
  const net = await provider.getNetwork();
  if (Number(net.chainId) !== 11155111) throw new Error(`unexpected chainId ${net.chainId}`);

  const maker = new ethers.NonceManager(new ethers.Wallet(MAKER_PK, provider));
  const taker = new ethers.NonceManager(new ethers.Wallet(TAKER_PK, provider));
  maker.address = await maker.getAddress();
  taker.address = await taker.getAddress();

  async function deploy(wallet, artifactPath, args) {
    const art = artifact(artifactPath);
    const factory = new ethers.ContractFactory(art.abi, art.bytecode.object, wallet);
    const c = await factory.deploy(...args);
    await c.waitForDeployment();
    return c;
  }

  const router = await deploy(maker, 'LimitSwapVMRouter.sol/LimitSwapVMRouter.json',
    [AQUA_SEPOLIA, WETH_SEPOLIA, maker.address, 'Agora SwapVM', '1.0']);
  const builder = await deploy(maker, 'AgoraQuoteBuilder.sol/AgoraQuoteBuilder.json', [AQUA_SEPOLIA]);
  const usdc = await deploy(maker, 'MockUSDC.sol/MockUSDC.json', []);
  const yes = await deploy(maker, 'MockOutcomeToken.sol/MockOutcomeToken.json', ['Agora YES', 'tYES']);

  const cfg = {
    chainId: 11155111,
    aquaAddress: AQUA_SEPOLIA,
    routerAddress: await router.getAddress(),
    builderAddress: await builder.getAddress(),
    usdcAddress: await usdc.getAddress(),
  };

  await (await yes.mint(maker.address, 100n * 10n ** 18n)).wait();
  await (await usdc.mint(taker.address, 1000_000000n)).wait();
  await (await yes.connect(maker).approve(AQUA_SEPOLIA, ethers.MaxUint256)).wait();
  await (await usdc.connect(taker).approve(cfg.routerAddress, ethers.MaxUint256)).wait();

  return {
    anvil, provider, maker, taker, cfg,
    yesAddress: await yes.getAddress(),
    router, builder, usdc, yes,
    // First local (post-fork) block: use as fromBlock in queryFilter to avoid
    // forwarding huge eth_getLogs ranges to the upstream RPC.
    forkBlock: await provider.getBlockNumber(),
  };
}

function teardown(h) {
  if (h?.provider) h.provider.destroy();
  if (h?.anvil) h.anvil.kill('SIGKILL');
}

module.exports = { bootAquaFork, teardown, AQUA_SEPOLIA, WETH_SEPOLIA };
