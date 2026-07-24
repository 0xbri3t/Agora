// Aqua/SwapVM client: ship, fill and cancel FutarFi fill-or-kill lot quotes.
// All order/taker-data encoding is delegated to the on-chain FutarFiQuoteBuilder
// (eth_call) so this module never re-implements MakerTraits/TakerTraits packing.
// Comments simple in English
const { ethers } = require('ethers');
const defaultCfg = require('../config/aqua');

// Human-readable ABIs (ethers v6), mirroring blockend/src/aqua + 1inch interfaces
const BUILDER_ABI = [
  'function buildQuote(address maker, address usdc, address outcomeToken, bytes32 salt) view returns (tuple(address maker, uint256 traits, bytes data) order, bytes shipStrategy, bytes32 strategyHash)',
  'function buildTakerData(address taker, bool isExactIn) pure returns (bytes)'
];
const ROUTER_ABI = [
  'function swap(tuple(address maker, uint256 traits, bytes data) order, address tokenIn, address tokenOut, uint256 amount, bytes takerTraitsAndData) returns (uint256 amountIn, uint256 amountOut, bytes32 orderHash)',
  'function hash(tuple(address maker, uint256 traits, bytes data) order) view returns (bytes32)',
  'event Swapped(bytes32 orderHash, address maker, address taker, address tokenIn, address tokenOut, uint256 amountIn, uint256 amountOut)'
];
const AQUA_ABI = [
  'function ship(address app, bytes strategy, address[] tokens, uint256[] amounts) returns (bytes32 strategyHash)',
  'function dock(address app, bytes32 strategyHash, address[] tokens)',
  'function rawBalances(address maker, address app, bytes32 strategyHash, address token) view returns (uint248 balance, uint8 tokensCount)',
  'event Shipped(address maker, address app, bytes32 strategyHash, bytes strategy)',
  'event Docked(address maker, address app, bytes32 strategyHash)'
];

function contracts(signerOrProvider, cfg) {
  const c = cfg || defaultCfg;
  return {
    builder: new ethers.Contract(c.builderAddress, BUILDER_ABI, signerOrProvider),
    router: new ethers.Contract(c.routerAddress, ROUTER_ABI, signerOrProvider),
    aqua: new ethers.Contract(c.aquaAddress, AQUA_ABI, signerOrProvider),
    cfg: c,
  };
}

// Normalize the order tuple returned by eth_call into a plain object we can
// store (JSON) and pass back into router.swap later.
function toOrderObject(orderResult) {
  return {
    maker: orderResult.maker ?? orderResult[0],
    traits: (orderResult.traits ?? orderResult[1]).toString(),
    data: orderResult.data ?? orderResult[2],
  };
}

/// Ship one fill-or-kill lot: shipped amounts [lotUsdc, lotToken] encode price+size.
/// Maker must have approved outcomeToken (and usdc) to the Aqua core beforehand.
async function shipQuote({ makerWallet, outcomeToken, lotUsdc, lotToken, salt, cfg }) {
  const { builder, aqua, cfg: c } = contracts(makerWallet, cfg);
  const saltBytes = ethers.zeroPadValue(ethers.toBeHex(BigInt(salt)), 32);

  const [orderResult, shipStrategy, strategyHash] = await builder.buildQuote(
    await makerWallet.getAddress(), c.usdcAddress, outcomeToken, saltBytes
  );

  const tokens = [outcomeToken, c.usdcAddress];
  const amounts = [BigInt(lotToken), BigInt(lotUsdc)];
  const tx = await aqua.ship(c.routerAddress, shipStrategy, tokens, amounts);
  const receipt = await tx.wait();

  return { strategyHash, order: toOrderObject(orderResult), txHash: receipt.hash };
}

/// Fill a lot exactly (all-or-nothing). Taker must have approved USDC to the router.
async function fillQuote({ takerWallet, order, lotUsdc, outcomeToken, cfg }) {
  const { builder, router, cfg: c } = contracts(takerWallet, cfg);
  const takerData = await builder.buildTakerData(await takerWallet.getAddress(), true);

  const tx = await router.swap(
    { maker: order.maker, traits: BigInt(order.traits), data: order.data },
    c.usdcAddress, outcomeToken, BigInt(lotUsdc), takerData
  );
  const receipt = await tx.wait();

  const swapped = receipt.logs
    .map((l) => { try { return router.interface.parseLog(l); } catch (_) { return null; } })
    .find((e) => e && e.name === 'Swapped');

  return {
    amountIn: swapped ? swapped.args.amountIn : null,
    amountOut: swapped ? swapped.args.amountOut : null,
    txHash: receipt.hash,
  };
}

/// Cancel a lot: dock releases the virtual balances; further fills revert.
async function cancelQuote({ makerWallet, strategyHash, outcomeToken, cfg }) {
  const { aqua, cfg: c } = contracts(makerWallet, cfg);
  const tx = await aqua.dock(c.routerAddress, strategyHash, [outcomeToken, c.usdcAddress]);
  const receipt = await tx.wait();
  return { txHash: receipt.hash };
}

module.exports = { shipQuote, fillQuote, cancelQuote, contracts, toOrderObject, BUILDER_ABI, ROUTER_ABI, AQUA_ABI };
