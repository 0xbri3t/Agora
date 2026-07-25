// FULL Aqua-era lifecycle on a Sepolia fork:
// create proposal -> auction -> Live -> ship YES/NO lots on Aqua -> fills ->
// index events -> push TWAP -> resolve -> loser claims collateral.
const mongoose = require('mongoose');
const fs = require('fs');
const path = require('path');
const { ethers } = require('ethers');
const { bootAquaFork, teardown } = require('./helpers/aquaForkHarness');
const { pushOnce } = require('../src/services/twapPusherService');

jest.setTimeout(300000);

const MONGO_TEST_URI = process.env.MONGODB_TEST_URI
  || 'mongodb://admin:password123@localhost:27017/agora_e2e_test?authSource=admin';

const art = (rel) => JSON.parse(fs.readFileSync(path.join(__dirname, '../../blockend/out', rel), 'utf8'));

let h, svc, aquaClient, Order, ProposalModel;

beforeAll(async () => {
  await mongoose.connect(MONGO_TEST_URI);
  h = await bootAquaFork(8551);
  svc = require('../src/services/aquaOrderbookService');
  aquaClient = require('../src/services/aquaClient');
  Order = require('../src/models/Order');
  ProposalModel = require('../src/models/Proposal');
  await Order.deleteMany({}); await ProposalModel.deleteMany({});
});

afterAll(async () => {
  try { await mongoose.connection.dropDatabase(); } catch (_) {}
  await mongoose.disconnect();
  teardown(h);
});

test('full lifecycle: proposal -> auction -> Aqua trading -> TWAP -> resolve -> claim', async () => {
  const deploy = async (rel, args) => {
    const a = art(rel);
    const f = new ethers.ContractFactory(a.abi, a.bytecode.object, h.maker);
    const c = await f.deploy(...args);
    await c.waitForDeployment();
    return c;
  };

  // --- 1. Agora stack + proposal ---
  const mockPyth = await deploy('MockPyth.sol/MockPyth.json', [60, 1]);
  const feedId = '0xff61491a931112ddf1bd8147cd1b641375f79f5825126d665480874634fd0ace';
  const now = BigInt(Math.floor(Date.now() / 1000));
  const update = await mockPyth.createPriceFeedUpdateData(feedId, 3000_00000000n, 10_0000000n, -8, 3000_00000000n, 10_0000000n, now, now);
  await (await mockPyth.updatePriceFeeds([update], { value: await mockPyth.getUpdateFee([update]) })).wait();

  const impl = await deploy('Proposal.sol/Proposal.json', []);
  const pm = await deploy('ProposalManager.sol/ProposalManager.json', [h.cfg.usdcAddress, await impl.getAddress(), h.maker.address]);
  await (await pm.createProposal('Ship feature X?', 'Futarchy decides', 600, 3600, 'ETH', 10n ** 18n, 100n * 10n ** 18n, ethers.ZeroAddress, '0x', await mockPyth.getAddress(), feedId)).wait();

  const info = await pm.getProposalById(1);
  const proposal = new ethers.Contract(info.proposalAddress, art('Proposal.sol/Proposal.json').abi, h.provider);

  // --- 2. Auction -> Live ---
  await (await h.usdc.mint(h.maker.address, 10n ** 15n)).wait();
  const treasury = await proposal.treasury();
  await (await h.usdc.connect(h.maker).approve(treasury, ethers.MaxUint256)).wait();
  const auctionAbi = art('DutchAuction.sol/DutchAuction.json').abi;
  const yesA = new ethers.Contract(await proposal.yesAuction(), auctionAbi, h.maker);
  const noA = new ethers.Contract(await proposal.noAuction(), auctionAbi, h.maker);
  await (await yesA.buyLiquidity(7000n * 10n ** 6n)).wait();
  await (await noA.buyLiquidity(7000n * 10n ** 6n)).wait();
  await h.provider.send('evm_increaseTime', [700]);
  await h.provider.send('evm_mine', []);
  await (await yesA.finalize()).wait();
  await (await noA.finalize()).wait();
  expect(Number(await proposal.state())).toBe(1); // Live

  const yesToken = await proposal.yesToken();
  const noToken = await proposal.noToken();

  // --- 3. Register markets + seed proposal doc (what chainService sync does) ---
  svc.registerMarket(yesToken, { proposalId: '1', side: 'approve' });
  svc.registerMarket(noToken, { proposalId: '1', side: 'reject' });
  await ProposalModel.create({
    id: 1, proposalContractId: '1', proposalAddress: info.proposalAddress,
    admin: h.maker.address, title: 'Ship feature X?', description: 'Futarchy decides',
    state: 'live', startTime: 1, endTime: 9999999999, duration: 3600,
    subjectToken: ethers.ZeroAddress, maxSupply: '1', target: ethers.ZeroAddress, data: '0x',
    yesToken, noToken,
  });

  // --- 4. Trade on Aqua: maker ships lots, taker fills them ---
  const erc20 = ['function approve(address,uint256) returns (bool)', 'function balanceOf(address) view returns (uint256)'];
  const yesC = new ethers.Contract(yesToken, erc20, h.maker);
  const noC = new ethers.Contract(noToken, erc20, h.maker);
  await (await yesC.approve(h.cfg.aquaAddress, ethers.MaxUint256)).wait();
  await (await noC.approve(h.cfg.aquaAddress, ethers.MaxUint256)).wait();

  const LOT = 10n ** 18n; // 1 token lots
  const shipYes = await aquaClient.shipQuote({ makerWallet: h.maker, outcomeToken: yesToken, lotUsdc: 600000n, lotToken: LOT, salt: 100n, cfg: h.cfg }); // 0.60
  const shipNo = await aquaClient.shipQuote({ makerWallet: h.maker, outcomeToken: noToken, lotUsdc: 350000n, lotToken: LOT, salt: 101n, cfg: h.cfg }); // 0.35

  await aquaClient.fillQuote({ takerWallet: h.taker, order: shipYes.order, lotUsdc: 600000n, outcomeToken: yesToken, cfg: h.cfg });
  await aquaClient.fillQuote({ takerWallet: h.taker, order: shipNo.order, lotUsdc: 350000n, outcomeToken: noToken, cfg: h.cfg });

  // --- 5. Index the real on-chain events into the order book ---
  const { aqua, router } = aquaClient.contracts(h.provider, h.cfg);
  for (const evt of await aqua.queryFilter('Shipped', h.forkBlock, 'latest')) {
    await svc.processShippedEvent(evt, { provider: h.provider, cfg: h.cfg });
  }
  for (const evt of await router.queryFilter('Swapped', h.forkBlock, 'latest')) {
    await svc.processSwappedEvent(evt);
  }
  const filled = await Order.find({ status: 'filled' });
  expect(filled).toHaveLength(2);

  // --- 6. Attestor pushes volume-weighted TWAPs on-chain ---
  const results = await pushOnce({ provider: h.provider, signer: h.maker });
  expect(results).toHaveLength(1);
  expect(await proposal.twapPriceTokenYes()).toBe(600000n);
  expect(await proposal.twapPriceTokenNo()).toBe(350000n);

  // --- 7. Resolve after live period: YES wins ---
  await h.provider.send('evm_increaseTime', [4000]);
  await h.provider.send('evm_mine', []);
  await (await new ethers.Contract(info.proposalAddress, art('Proposal.sol/Proposal.json').abi, h.maker).resolve()).wait();
  expect(Number(await proposal.state())).toBe(2); // Resolved

  const noTokenC = new ethers.Contract(noToken, [...erc20, 'function paused() view returns (bool)'], h.provider);
  expect(await noTokenC.paused()).toBe(true); // loser paused

  // --- 8. Losing-side holder claims collateral pro-rata ---
  const usdcBefore = await h.usdc.balanceOf(h.maker.address);
  await (await noC.approve(treasury, ethers.MaxUint256)).wait();
  const proposalAsMaker = new ethers.Contract(info.proposalAddress, art('Proposal.sol/Proposal.json').abi, h.maker);
  await (await proposalAsMaker.claimTokens(noToken)).wait();
  const usdcAfter = await h.usdc.balanceOf(h.maker.address);
  expect(usdcAfter > usdcBefore).toBe(true);
});
