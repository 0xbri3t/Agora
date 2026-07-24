// Integration tests: real Aqua events (anvil fork) -> Mongo order-book bridge.
// Requires the dev MongoDB (docker) on localhost:27017 (uses a separate test DB).
const mongoose = require('mongoose');
const { bootAquaFork, teardown } = require('./helpers/aquaForkHarness');

jest.setTimeout(240000);

const MONGO_TEST_URI = process.env.MONGODB_TEST_URI
  || 'mongodb://admin:password123@localhost:27017/futarfi_aqua_test?authSource=admin';

const LOT_YES = 10n * 10n ** 18n;
const LOT_USDC = 4_000000n;
const PROPOSAL_ID = 'test-proposal-1';

let h; // fork harness
let aquaClient, svc, Order;

beforeAll(async () => {
  await mongoose.connect(MONGO_TEST_URI);
  h = await bootAquaFork(8547);

  aquaClient = require('../src/services/aquaClient');
  svc = require('../src/services/aquaOrderbookService');
  Order = require('../src/models/Order');

  svc.registerMarket(h.yesAddress, { proposalId: PROPOSAL_ID, side: 'approve' });
});

afterAll(async () => {
  try { await mongoose.connection.dropDatabase(); } catch (_) {}
  await mongoose.disconnect();
  teardown(h);
});

beforeEach(async () => {
  await Order.deleteMany({});
});

async function shipAndGetEvent(salt) {
  const shipped = await aquaClient.shipQuote({
    makerWallet: h.maker, outcomeToken: h.yesAddress,
    lotUsdc: LOT_USDC, lotToken: LOT_YES, salt, cfg: h.cfg,
  });
  const { aqua } = aquaClient.contracts(h.provider, h.cfg);
  const evts = await aqua.queryFilter('Shipped', h.forkBlock, 'latest');
  const evt = evts.find((e) => e.args[2] === shipped.strategyHash);
  return { shipped, evt };
}

describe('aquaOrderbookService', () => {
  test('decodeShipCalldata extracts price/size from ship tx', async () => {
    const { evt } = await shipAndGetEvent(10n);
    const tx = await h.provider.getTransaction(evt.transactionHash);
    const lot = svc.decodeShipCalldata(tx.data, h.cfg.usdcAddress);

    expect(lot.lotToken).toBe(LOT_YES);
    expect(lot.lotUsdc).toBe(LOT_USDC);
    expect(lot.priceUsdcPerToken).toBe(400000n); // 0.40 USDC (6d) per YES
    expect(lot.outcomeToken.toLowerCase()).toBe(h.yesAddress.toLowerCase());
  });

  test('Shipped -> open Order; Swapped -> filled; rebuilds order book', async () => {
    const { shipped, evt } = await shipAndGetEvent(11n);

    const created = await svc.processShippedEvent(evt, { provider: h.provider, cfg: h.cfg });
    expect(created).not.toBeNull();

    let order = await Order.findOne({ strategyHash: shipped.strategyHash });
    expect(order.status).toBe('open');
    expect(order.side).toBe('approve');
    expect(order.orderType).toBe('sell');
    expect(order.price).toBe('400000');
    expect(order.amount).toBe(LOT_YES.toString());
    expect(order.userAddress.toLowerCase()).toBe(h.maker.address.toLowerCase());

    // Fill the lot on-chain, then process the real Swapped event
    await aquaClient.fillQuote({
      takerWallet: h.taker, order: shipped.order,
      lotUsdc: LOT_USDC, outcomeToken: h.yesAddress, cfg: h.cfg,
    });
    const { router } = aquaClient.contracts(h.provider, h.cfg);
    const swaps = await router.queryFilter('Swapped', h.forkBlock, 'latest');
    const swapEvt = swaps.find((e) => e.args[0] === shipped.strategyHash);
    expect(swapEvt).toBeDefined();

    await svc.processSwappedEvent(swapEvt);
    order = await Order.findOne({ strategyHash: shipped.strategyHash });
    expect(order.status).toBe('filled');
    expect(order.filledAmount).toBe(LOT_YES.toString());
    expect(order.fills).toHaveLength(1);
    expect(order.fills[0].isExecuted).toBe(true);
  });

  test('Docked -> cancelled', async () => {
    const { shipped, evt } = await shipAndGetEvent(12n);
    await svc.processShippedEvent(evt, { provider: h.provider, cfg: h.cfg });

    await aquaClient.cancelQuote({
      makerWallet: h.maker, strategyHash: shipped.strategyHash,
      outcomeToken: h.yesAddress, cfg: h.cfg,
    });
    const { aqua } = aquaClient.contracts(h.provider, h.cfg);
    const docks = await aqua.queryFilter('Docked', h.forkBlock, 'latest');
    const dockEvt = docks.find((e) => e.args[2] === shipped.strategyHash);

    await svc.processDockedEvent(dockEvt);
    const order = await Order.findOne({ strategyHash: shipped.strategyHash });
    expect(order.status).toBe('cancelled');
  });

  test('Shipped for an unregistered token is ignored', async () => {
    const { evt } = await shipAndGetEvent(13n);
    svc.registerMarket(h.yesAddress, { proposalId: PROPOSAL_ID, side: 'approve' }); // keep registered
    // simulate unknown token by decoding against a different USDC address
    const tx = await h.provider.getTransaction(evt.transactionHash);
    const lot = svc.decodeShipCalldata(tx.data, '0x0000000000000000000000000000000000000001');
    expect(lot).toBeNull();
  });
});
