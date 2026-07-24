// 1inch Aqua/SwapVM contracts used by the trading UI.
// Addresses synced from blockend/deployments/sepolia-aqua.json.
import addresses from './aqua-addresses.json'
import { parseAbi } from 'viem'

export const AQUA_ADDRESSES = {
  aqua: addresses.aqua as `0x${string}`,
  router: addresses.router as `0x${string}`,
  builder: addresses.builder as `0x${string}`,
  usdc: addresses.usdc as `0x${string}`,
  chainId: addresses.chainId,
}

export type AquaOrder = {
  maker: `0x${string}`
  traits: bigint
  data: `0x${string}`
}

export const BUILDER_ABI = parseAbi([
  'struct Order { address maker; uint256 traits; bytes data; }',
  'function buildQuote(address maker, address usdc, address outcomeToken, bytes32 salt) view returns (Order order, bytes shipStrategy, bytes32 strategyHash)',
  'function buildTakerData(address taker, bool isExactIn) pure returns (bytes)',
])

export const AQUA_ABI = parseAbi([
  'function ship(address app, bytes strategy, address[] tokens, uint256[] amounts) returns (bytes32 strategyHash)',
  'function dock(address app, bytes32 strategyHash, address[] tokens)',
])

export const ROUTER_ABI = parseAbi([
  'struct Order { address maker; uint256 traits; bytes data; }',
  'function swap(Order order, address tokenIn, address tokenOut, uint256 amount, bytes takerTraitsAndData) returns (uint256 amountIn, uint256 amountOut, bytes32 orderHash)',
])

export const ERC20_ABI = parseAbi([
  'function approve(address spender, uint256 value) returns (bool)',
  'function allowance(address owner, address spender) view returns (uint256)',
  'function balanceOf(address owner) view returns (uint256)',
])
