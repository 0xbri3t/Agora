import { getContractAddress } from "@/contracts/constants"

// Contract addresses per chain - dynamically imported from constants.ts for deployed contracts
export const CONTRACTS = {
  1: {
    // Mainnet
    proposalManager: "0x0000000000000000000000000000000000000000",
    baseToken: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48", // USDC
  },
  31337: {
    // Anvil (forked from mainnet) - addresses from deployed contracts
    proposalManager: getContractAddress(31337, 'PROPOSAL_MANAGER') || "0x0000000000000000000000000000000000000000",
    baseToken: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48", // USDC (same as mainnet since forked)
  },
  11155111: {
    // Sepolia
    proposalManager: "0x0000000000000000000000000000000000000000",
    baseToken: "0x0000000000000000000000000000000000000000",
  },
  42161: {
    // Arbitrum
    proposalManager: "0x0000000000000000000000000000000000000000",
    baseToken: "0xaf88d065e77c8cC2239327C5EDb3A432268e5831", // USDC
  },
  421614: {
    // Arbitrum Sepolia
    proposalManager: "0x0000000000000000000000000000000000000000",
    baseToken: "0x0000000000000000000000000000000000000000",
  },
} as const

export type SupportedChainId = keyof typeof CONTRACTS

export function getContracts(chainId: number) {
  return CONTRACTS[chainId as SupportedChainId] || CONTRACTS[11155111]
}

