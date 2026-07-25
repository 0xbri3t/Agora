// Integration tests for aquaClient against an anvil fork of Sepolia (real Aqua core).
const { bootAquaFork, teardown } = require('./helpers/aquaForkHarness');

jest.setTimeout(240000);

const LOT_YES = 10n * 10n ** 18n; // 10 YES
const LOT_USDC = 4_000000n;       // 4 USDC -> 0.40 USDC/YES

let h;
let aquaClient;

beforeAll(async () => {
  h = await bootAquaFork(8546);
  aquaClient = require('../src/services/aquaClient');
});

afterAll(async () => {
  teardown(h);
});

describe('aquaClient (anvil fork of Sepolia, real Aqua core)', () => {
  let shipped; // { strategyHash, order, txHash }

  test('shipQuote ships a lot; strategyHash matches router.hash(order)', async () => {
    shipped = await aquaClient.shipQuote({
      makerWallet: h.maker,
      outcomeToken: h.yesAddress,
      lotUsdc: LOT_USDC,
      lotToken: LOT_YES,
      salt: 1n,
      cfg: h.cfg,
    });
    expect(shipped.strategyHash).toMatch(/^0x[0-9a-f]{64}$/);
    expect(shipped.txHash).toMatch(/^0x[0-9a-f]{64}$/);

    const { router } = aquaClient.contracts(h.provider, h.cfg);
    const routerHash = await router.hash({
      maker: shipped.order.maker,
      traits: BigInt(shipped.order.traits),
      data: shipped.order.data,
    });
    expect(routerHash).toBe(shipped.strategyHash);
  });

  test('fillQuote fills the lot exactly at the encoded price', async () => {
    const res = await aquaClient.fillQuote({
      takerWallet: h.taker,
      order: shipped.order,
      lotUsdc: LOT_USDC,
      outcomeToken: h.yesAddress,
      cfg: h.cfg,
    });
    expect(res.amountIn).toBe(LOT_USDC);
    expect(res.amountOut).toBe(LOT_YES);
  });

  test('cancelQuote docks a fresh lot; subsequent fill reverts', async () => {
    const lot2 = await aquaClient.shipQuote({
      makerWallet: h.maker,
      outcomeToken: h.yesAddress,
      lotUsdc: LOT_USDC,
      lotToken: LOT_YES,
      salt: 2n,
      cfg: h.cfg,
    });

    await aquaClient.cancelQuote({
      makerWallet: h.maker,
      strategyHash: lot2.strategyHash,
      outcomeToken: h.yesAddress,
      cfg: h.cfg,
    });

    await expect(aquaClient.fillQuote({
      takerWallet: h.taker,
      order: lot2.order,
      lotUsdc: LOT_USDC,
      outcomeToken: h.yesAddress,
      cfg: h.cfg,
    })).rejects.toThrow();
  });
});
