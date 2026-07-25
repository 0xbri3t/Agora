// computeTwap unit tests + on-chain push test against a Sepolia-fork Proposal.
const mongoose = require('mongoose');
const { ethers } = require('ethers');
const { bootAquaFork, teardown } = require('./helpers/aquaForkHarness');
const { computeTwap, pushOnce } = require('../src/services/twapPusherService');

jest.setTimeout(240000);

const MONGO_TEST_URI = process.env.MONGODB_TEST_URI
  || 'mongodb://admin:password123@localhost:27017/agora_twap_test?authSource=admin';

describe('computeTwap (pure)', () => {
  test('null when no fills', () => {
    expect(computeTwap([])).toBeNull();
    expect(computeTwap([{ price: '400000', amount: '0' }])).toBeNull();
  });

  test('single fill returns its price', () => {
    expect(computeTwap([{ price: '400000', amount: (10n * 10n ** 18n).toString() }])).toBe(400000n);
  });

  test('volume-weighted across fills', () => {
    // 10 tokens @0.40 + 30 tokens @0.60 -> (0.40*10 + 0.60*30)/40 = 0.55
    const fills = [
      { price: '400000', amount: (10n * 10n ** 18n).toString() },
      { price: '600000', amount: (30n * 10n ** 18n).toString() },
    ];
    expect(computeTwap(fills)).toBe(550000n);
  });
});

describe('pushOnce (fork)', () => {
  let h, Order, ProposalModel;

  beforeAll(async () => {
    await mongoose.connect(MONGO_TEST_URI);
    h = await bootAquaFork(8549);
    Order = require('../src/models/Order');
    ProposalModel = require('../src/models/Proposal');
  });

  afterAll(async () => {
    try { await mongoose.connection.dropDatabase(); } catch (_) {}
    await mongoose.disconnect();
    teardown(h);
  });

  test('pushes volume-weighted TWAPs to a live on-chain Proposal', async () => {
    // Deploy a real Proposal via ProposalManager on the fork, drive it to Live
    const fs = require('fs');
    const path = require('path');
    const art = (rel) => JSON.parse(fs.readFileSync(path.join(__dirname, '../../blockend/out', rel), 'utf8'));

    const deploy = async (rel, args) => {
      const a = art(rel);
      const f = new ethers.ContractFactory(a.abi, a.bytecode.object, h.maker);
      const c = await f.deploy(...args);
      await c.waitForDeployment();
      return c;
    };

    // MockPyth with a price so initialize works
    const mockPyth = await deploy('MockPyth.sol/MockPyth.json', [60, 1]);
    const feedId = '0xff61491a931112ddf1bd8147cd1b641375f79f5825126d665480874634fd0ace';
    const update = await mockPyth.createPriceFeedUpdateData(
      feedId, 3000_00000000n, 10_0000000n, -8, 3000_00000000n, 10_0000000n,
      BigInt(Math.floor(Date.now() / 1000)), BigInt(Math.floor(Date.now() / 1000))
    );
    const fee = await mockPyth.getUpdateFee([update]);
    await (await mockPyth.updatePriceFeeds([update], { value: fee })).wait();

    const CCA_FACTORY = '0x000000001F26a0044BaA66024e7b6599c61963F8';
    const impl = await deploy('Proposal.sol/Proposal.json', []);
    const pm = await deploy('ProposalManager.sol/ProposalManager.json',
      [h.cfg.usdcAddress, await impl.getAddress(), h.maker.address, CCA_FACTORY]);

    await (await pm.createProposal(
      'T', 'D', 600, 3600, 'S', 10n ** 18n, 100n * 10n ** 18n,
      ethers.ZeroAddress, '0x', await mockPyth.getAddress(), feedId
    )).wait();
    const info = await pm.getProposalById(1);
    const proposalAddr = info.proposalAddress;

    const proposalAbi = art('Proposal.sol/Proposal.json').abi;
    const proposal = new ethers.Contract(proposalAddr, proposalAbi, h.provider);

    // Drive the CCA auctions past graduation -> Live
    const usdc = h.usdc;
    await (await usdc.mint(h.maker.address, 10n ** 15n)).wait();
    const PERMIT2 = '0x000000000022D473030F116dDEE9F6B43aC78BA3';
    const permit2 = new ethers.Contract(PERMIT2,
      ['function approve(address token, address spender, uint160 amount, uint48 expiration)'], h.maker);
    const ccaAbi = art('ICCA.sol/ICCAuction.json').abi;
    const yesA = new ethers.Contract(await proposal.yesAuction(), ccaAbi, h.maker);
    const noA = new ethers.Contract(await proposal.noAuction(), ccaAbi, h.maker);
    await (await usdc.connect(h.maker).approve(PERMIT2, ethers.MaxUint256)).wait();
    await (await permit2.approve(h.cfg.usdcAddress, await yesA.getAddress(), (1n << 160n) - 1n, (1n << 48n) - 1n)).wait();
    await (await permit2.approve(h.cfg.usdcAddress, await noA.getAddress(), (1n << 160n) - 1n, (1n << 48n) - 1n)).wait();
    for (const auction of [yesA, noA]) {
      const maxPrice = (await auction.clearingPrice()) * 4n;
      await (await auction['submitBid(uint256,uint128,address,bytes)'](maxPrice, 7000n * 10n ** 6n, h.maker.address, '0x')).wait();
    }
    const endBlock = Number(await proposal.auctionEndBlock());
    let current = await h.provider.getBlockNumber();
    for (let i = current; i <= endBlock; i++) await h.provider.send('evm_mine', []);
    const proposalAsMaker = new ethers.Contract(proposalAddr, proposalAbi, h.maker);
    await (await proposalAsMaker.settleAuctions()).wait();
    expect(Number(await proposal.state())).toBe(1); // Live

    // Seed Mongo: proposal doc + filled Aqua lots
    await ProposalModel.deleteMany({}); await Order.deleteMany({});
    await ProposalModel.create({
      id: 1, proposalContractId: '1', proposalAddress: proposalAddr,
      admin: h.maker.address, title: 'T', description: 'D', state: 'live',
      startTime: 1, endTime: 9999999999, duration: 3600, subjectToken: ethers.ZeroAddress,
      maxSupply: '1', target: ethers.ZeroAddress, data: '0x',
      yesToken: await proposal.yesToken(), noToken: await proposal.noToken(),
    });
    const mkOrder = (side, price, amount) => ({
      proposalId: '1', side, orderType: 'sell', orderExecution: 'limit',
      price, amount, filledAmount: amount, userAddress: h.maker.address,
      status: 'filled', strategyHash: '0x' + side.padEnd(64, '0').slice(0, 64),
    });
    await Order.create(mkOrder('approve', '400000', (10n * 10n ** 18n).toString()));
    await Order.create(mkOrder('approve', '600000', (30n * 10n ** 18n).toString()));
    await Order.create(mkOrder('reject', '300000', (10n * 10n ** 18n).toString()));

    const results = await pushOnce({ provider: h.provider, signer: h.maker });
    expect(results).toHaveLength(1);
    expect(results[0].twapYes).toBe(550000n);
    expect(results[0].twapNo).toBe(300000n);

    expect(await proposal.twapPriceTokenYes()).toBe(550000n);
    expect(await proposal.twapPriceTokenNo()).toBe(300000n);
  });
});
