// Integration tests for aquaClient against an anvil fork of Sepolia (real Aqua core).
// Spawns anvil on :8546, deploys router+builder+mocks from blockend artifacts.
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const { ethers } = require('ethers');

jest.setTimeout(240000);

const ANVIL_PORT = 8546;
const RPC = `http://127.0.0.1:${ANVIL_PORT}`;
const AQUA_SEPOLIA = '0x499943E74FB0cE105688beeE8Ef2ABec5D936d31';
const WETH_SEPOLIA = '0xfFf9976782d46CC05630D1f6eBAb18b2324d6B14';

// anvil default accounts 0 (maker/deployer) and 1 (taker)
const MAKER_PK = '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80';
const TAKER_PK = '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d';

const LOT_YES = 10n * 10n ** 18n; // 10 YES
const LOT_USDC = 4_000000n;       // 4 USDC -> 0.40 USDC/YES

function artifact(rel) {
  const p = path.join(__dirname, '../../blockend/out', rel);
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

function sepoliaRpcUrl() {
  if (process.env.SEPOLIA_RPC_URL) return process.env.SEPOLIA_RPC_URL;
  try {
    const env = fs.readFileSync(path.join(__dirname, '../../blockend/.env'), 'utf8');
    const m = env.match(/^SEPOLIA_RPC_URL=(.+)$/m);
    if (m) return m[1].trim();
  } catch (_) {}
  return 'https://ethereum-sepolia-rpc.publicnode.com';
}

let anvil;
let provider, maker, taker;
let cfg; // injected config for aquaClient
let yesAddress;
let aquaClient;

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

async function deploy(wallet, artifactPath, args) {
  const art = artifact(artifactPath);
  const factory = new ethers.ContractFactory(art.abi, art.bytecode.object, wallet);
  const c = await factory.deploy(...args);
  await c.waitForDeployment();
  return c;
}

beforeAll(async () => {
  anvil = spawn('anvil', ['--fork-url', sepoliaRpcUrl(), '--port', String(ANVIL_PORT)], {
    stdio: ['ignore', 'ignore', 'pipe'],
  });
  anvil.stderr.on('data', (d) => console.error('[anvil]', String(d)));
  await waitForRpc(RPC);

  provider = new ethers.JsonRpcProvider(RPC, undefined, { polling: true, pollingInterval: 200 });
  // Verify we're on the Sepolia fork, not some stale process
  const net = await provider.getNetwork();
  if (Number(net.chainId) !== 11155111) throw new Error(`unexpected chainId ${net.chainId}`);

  // NonceManager avoids nonce races on fast sequential txs (same pattern as src/config/ethers.js)
  maker = new ethers.NonceManager(new ethers.Wallet(MAKER_PK, provider));
  taker = new ethers.NonceManager(new ethers.Wallet(TAKER_PK, provider));
  maker.address = await maker.getAddress();
  taker.address = await taker.getAddress();

  // Deploy the FutarFi Aqua stack on the fork
  const router = await deploy(maker, 'LimitSwapVMRouter.sol/LimitSwapVMRouter.json',
    [AQUA_SEPOLIA, WETH_SEPOLIA, maker.address, 'FutarFi SwapVM', '1.0']);
  const builder = await deploy(maker, 'FutarFiQuoteBuilder.sol/FutarFiQuoteBuilder.json', [AQUA_SEPOLIA]);
  const usdc = await deploy(maker, 'MockUSDC.sol/MockUSDC.json', []);
  const yes = await deploy(maker, 'MockOutcomeToken.sol/MockOutcomeToken.json', ['FutarFi YES', 'tYES']);
  yesAddress = await yes.getAddress();

  cfg = {
    chainId: 11155111,
    aquaAddress: AQUA_SEPOLIA,
    routerAddress: await router.getAddress(),
    builderAddress: await builder.getAddress(),
    usdcAddress: await usdc.getAddress(),
  };

  // Fund + approvals: maker sells YES (approve Aqua); taker pays USDC (approve router)
  await (await yes.mint(maker.address, 100n * 10n ** 18n)).wait();
  await (await usdc.mint(taker.address, 1000_000000n)).wait();
  await (await yes.connect(maker).approve(AQUA_SEPOLIA, ethers.MaxUint256)).wait();
  await (await usdc.connect(taker).approve(cfg.routerAddress, ethers.MaxUint256)).wait();

  aquaClient = require('../src/services/aquaClient');
});

afterAll(async () => {
  if (provider) provider.destroy();
  if (anvil) anvil.kill('SIGKILL');
});

describe('aquaClient (anvil fork of Sepolia, real Aqua core)', () => {
  let shipped; // { strategyHash, order, txHash }

  test('shipQuote ships a lot; strategyHash matches router.hash(order)', async () => {
    shipped = await aquaClient.shipQuote({
      makerWallet: maker,
      outcomeToken: yesAddress,
      lotUsdc: LOT_USDC,
      lotToken: LOT_YES,
      salt: 1n,
      cfg,
    });
    expect(shipped.strategyHash).toMatch(/^0x[0-9a-f]{64}$/);
    expect(shipped.txHash).toMatch(/^0x[0-9a-f]{64}$/);

    const { router } = aquaClient.contracts(provider, cfg);
    const routerHash = await router.hash({
      maker: shipped.order.maker,
      traits: BigInt(shipped.order.traits),
      data: shipped.order.data,
    });
    expect(routerHash).toBe(shipped.strategyHash);
  });

  test('fillQuote fills the lot exactly at the encoded price', async () => {
    const res = await aquaClient.fillQuote({
      takerWallet: taker,
      order: shipped.order,
      lotUsdc: LOT_USDC,
      outcomeToken: yesAddress,
      cfg,
    });
    expect(res.amountIn).toBe(LOT_USDC);
    expect(res.amountOut).toBe(LOT_YES);
  });

  test('cancelQuote docks a fresh lot; subsequent fill reverts', async () => {
    const lot2 = await aquaClient.shipQuote({
      makerWallet: maker,
      outcomeToken: yesAddress,
      lotUsdc: LOT_USDC,
      lotToken: LOT_YES,
      salt: 2n,
      cfg,
    });

    await aquaClient.cancelQuote({
      makerWallet: maker,
      strategyHash: lot2.strategyHash,
      outcomeToken: yesAddress,
      cfg,
    });

    await expect(aquaClient.fillQuote({
      takerWallet: taker,
      order: lot2.order,
      lotUsdc: LOT_USDC,
      outcomeToken: yesAddress,
      cfg,
    })).rejects.toThrow();
  });
});
