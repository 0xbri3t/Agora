import deployedAddresses from './deployed-addresses.json'

const ZERO = "0x0000000000000000000000000000000000000000" as const

const addr = (chainId: number, name: string): `0x${string}` =>
  ((deployedAddresses as any)[chainId]?.[name] as `0x${string}`) || ZERO

export const CONTRACTS = {
  // Ethereum Sepolia (Aqua era)
  11155111: {
    COLLATERAL: addr(11155111, 'COLLATERAL'),
    PROPOSAL_MANAGER: addr(11155111, 'PROPOSAL_MANAGER'),
  },
  // Local Anvil fork of Sepolia (dev.sh)
  31337: {
    COLLATERAL: addr(31337, 'COLLATERAL'),
    PROPOSAL_MANAGER: addr(31337, 'PROPOSAL_MANAGER'),
  },
} as const;

export const getContractAddress = (chainId: number | undefined, contractName: keyof typeof CONTRACTS[11155111]) => {
  if (!chainId || !CONTRACTS[chainId as keyof typeof CONTRACTS]) {
    return undefined;
  }
  return CONTRACTS[chainId as keyof typeof CONTRACTS][contractName];
};
