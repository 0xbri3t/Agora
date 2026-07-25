import { parseAbi } from 'viem'

// Uniswap Continuous Clearing Auction — subset used by the Agora frontend.
// Prices are currency-per-token in Q96 fixed point.
export const cca_abi = parseAbi([
  'event BidSubmitted(uint256 indexed id, address indexed owner, uint256 priceQ96, uint128 amount)',
  'event BidExited(uint256 indexed bidId, address indexed owner, uint256 tokensFilled, uint256 currencyRefunded)',
  'event ClearingPriceUpdated(uint256 blockNumber, uint256 clearingPriceQ96)',
  'event TokensClaimed(uint256 indexed bidId, address indexed owner, uint256 tokensFilled)',
  'function submitBid(uint256 maxPriceQ96, uint128 amount, address owner, bytes hookData) payable returns (uint256 bidId)',
  'function exitBid(uint256 bidId)',
  'function claimTokens(uint256 bidId)',
  'function clearingPrice() view returns (uint256)',
  'function floorPrice() view returns (uint256)',
  'function tickSpacing() view returns (uint256)',
  'function isGraduated() view returns (bool)',
  'function currencyRaised() view returns (uint256)',
  'function totalCleared() view returns (uint256)',
  'function remainingSupply() view returns (uint256)',
  'function totalSupply() view returns (uint128)',
  'function startBlock() view returns (uint64)',
  'function endBlock() view returns (uint64)',
  'function claimBlock() view returns (uint64)',
] as const)

// Canonical Permit2 — the CCA pulls bid currency through it
export const PERMIT2_ADDRESS = '0x000000000022D473030F116dDEE9F6B43aC78BA3' as const

export const permit2_abi = parseAbi([
  'function approve(address token, address spender, uint160 amount, uint48 expiration)',
  'function allowance(address owner, address token, address spender) view returns (uint160 amount, uint48 expiration, uint48 nonce)',
] as const)

export const Q96 = 2n ** 96n

/** Q96 currency-per-token -> USDC 6d per 1e18 token (UI convention). */
export function q96ToPrice6d(priceQ96: bigint): bigint {
  return (priceQ96 * 10n ** 18n) / Q96
}

/** Snap a Q96 price DOWN to the auction's tick grid. */
export function snapToTick(priceQ96: bigint, tickSpacing: bigint): bigint {
  if (tickSpacing === 0n) return priceQ96
  return (priceQ96 / tickSpacing) * tickSpacing
}
