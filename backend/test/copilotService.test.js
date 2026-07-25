// Pure-function tests for the copilot analytics (no chain, no DB).
const {
  impliedProbability,
  detectArbitrage,
  twapTrend,
  auctionSignal,
  summarize,
} = require('../src/services/copilotService');

const base = {
  title: 'Adopt Aqua trading?',
  status: 'LIVE',
  winner: null,
  twapYes: 0n,
  twapNo: 0n,
  asksYes: [],
  asksNo: [],
  twapHistory: [],
  auctionYes: null,
  auctionNo: null,
};

/** Build one side's CCA state from a list of bid amounts (USDC 6d). */
const auctionSide = (bids) => ({
  clearingPrice: 500000n,
  bidCount: bids.length,
  totalBidAmount: bids.reduce((sum, b) => sum + b, 0n),
  bids: bids.map((amount) => ({ bidder: '0xa', maxPrice: 600000n, amount })),
});

describe('impliedProbability', () => {
  test('prefers TWAPs when present', () => {
    const p = impliedProbability({ ...base, twapYes: 600000n, twapNo: 400000n });
    expect(p).toEqual({ bps: 6000, basis: 'twap' });
  });

  test('falls back to best asks when TWAPs are zero', () => {
    const p = impliedProbability({
      ...base,
      asksYes: [{ maker: '0xa', price: 750000n, lotToken: 1n }],
      asksNo: [{ maker: '0xb', price: 250000n, lotToken: 1n }],
    });
    expect(p).toEqual({ bps: 7500, basis: 'best asks' });
  });

  test('null when no data at all', () => {
    expect(impliedProbability(base)).toBeNull();
  });
});

describe('detectArbitrage', () => {
  test('flags a cross-maker buy-both basket under 1 USDC', () => {
    const result = detectArbitrage({
      ...base,
      asksYes: [{ maker: '0xa', price: 400000n, lotToken: 1n }],
      asksNo: [{ maker: '0xb', price: 350000n, lotToken: 1n }],
    });
    expect(result.buyBoth).toEqual({
      askYes: '400000',
      askNo: '350000',
      edgeUsdc6d: '250000',
    });
    expect(result.violations).toHaveLength(0);
  });

  test('flags a single maker whose YES+NO pair sums over 1 USDC', () => {
    const result = detectArbitrage({
      ...base,
      asksYes: [
        { maker: '0xevil', price: 700000n, lotToken: 1n },
        { maker: '0xok', price: 500000n, lotToken: 1n },
      ],
      asksNo: [
        { maker: '0xevil', price: 450000n, lotToken: 1n },
        { maker: '0xok', price: 400000n, lotToken: 1n },
      ],
    });
    expect(result.violations).toEqual([
      { maker: '0xevil', askYes: '700000', askNo: '450000', excessUsdc6d: '150000' },
    ]);
  });

  test('coherent book yields nothing', () => {
    const result = detectArbitrage({
      ...base,
      asksYes: [{ maker: '0xa', price: 600000n, lotToken: 1n }],
      asksNo: [{ maker: '0xa', price: 400000n, lotToken: 1n }],
    });
    expect(result.buyBoth).toBeNull();
    expect(result.violations).toHaveLength(0);
  });
});

describe('twapTrend', () => {
  test('reads direction and leader from the spread', () => {
    const trend = twapTrend({
      ...base,
      twapHistory: [
        { twapYes: 500000n, twapNo: 500000n, timestamp: 1 },
        { twapYes: 550000n, twapNo: 450000n, timestamp: 2 },
        { twapYes: 620000n, twapNo: 380000n, timestamp: 3 },
      ],
    });
    expect(trend.direction).toBe('toward YES');
    expect(trend.leading).toBe('YES');
    expect(trend.spreadNow).toBe('240000');
    expect(trend.points).toBe(3);
  });

  test('null with fewer than two points', () => {
    expect(twapTrend(base)).toBeNull();
  });
});

describe('auctionSignal', () => {
  test('reads which side the CCA bidders are backing', () => {
    const signal = auctionSignal({
      ...base,
      status: 'AUCTION',
      auctionYes: auctionSide([700_000000n, 100_000000n]),
      auctionNo: auctionSide([200_000000n]),
    });
    expect(signal.bidsYes).toBe(2);
    expect(signal.bidsNo).toBe(1);
    expect(signal.committedUsdc).toBe('1000000000');
    expect(signal.yesShareBps).toBe(8000);
    expect(signal.leaning).toBe('YES');
  });

  test('flags demand concentrated in one bid', () => {
    const signal = auctionSignal({
      ...base,
      status: 'AUCTION',
      auctionYes: auctionSide([950_000000n, 50_000000n]),
      auctionNo: auctionSide([500_000000n, 500_000000n]),
    });
    expect(signal.concentrationYesBps).toBe(9500);
    expect(signal.concentrationNoBps).toBe(5000);
    expect(signal.leaning).toBe('BALANCED');
  });

  test('null without auction data or bids', () => {
    expect(auctionSignal(base)).toBeNull();
    expect(auctionSignal({ ...base, auctionYes: auctionSide([]), auctionNo: auctionSide([]) })).toBeNull();
  });
});

describe('summarize', () => {
  test('leads with the bootstrap read while the proposal is in auction', () => {
    const data = {
      ...base,
      status: 'AUCTION',
      auctionYes: auctionSide([950_000000n, 50_000000n]),
      auctionNo: auctionSide([200_000000n]),
    };
    const signal = auctionSignal(data);
    const text = summarize(data, null, detectArbitrage(data), null, signal);
    expect(text).toContain('Bootstrap phase');
    expect(text).toContain('1200.00 USDC');
    expect(text).toContain('leaning YES');
    expect(text).toContain('rests on a single participant');
  });

  test('weaves probability, trend and arbitrage into prose', () => {
    const data = { ...base, twapYes: 600000n, twapNo: 400000n };
    const probability = impliedProbability(data);
    const arbitrage = detectArbitrage({
      ...data,
      asksYes: [{ maker: '0xa', price: 400000n, lotToken: 1n }],
      asksNo: [{ maker: '0xb', price: 350000n, lotToken: 1n }],
    });
    const text = summarize(data, probability, arbitrage, null);
    expect(text).toContain('60.0%');
    expect(text).toContain('risk-free');
  });

  test('reports a resolved winner', () => {
    const data = { ...base, status: 'RESOLVED', winner: 'YES' };
    const text = summarize(data, null, detectArbitrage(data), null);
    expect(text).toContain('YES won');
  });
});
