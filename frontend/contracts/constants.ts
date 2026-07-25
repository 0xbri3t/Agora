import deployedAddresses from './deployed-addresses.json'

export const CONTRACTS = {
  296: {
    PYUSD: deployedAddresses[296]?.PYUSD as `0x${string}` || "0x0000000000000000000000000000000000000000" as const,
    PROPOSAL_MANAGER: deployedAddresses[296]?.PROPOSAL_MANAGER as `0x${string}` || "0x0000000000000000000000000000000000000000" as const
  },

  // Local Anvil chain (chain ID: 31337)
  // 31337: {
  //   PYUSD: deployedAddresses[31337]?.PYUSD as `0x${string}` || "0x0000000000000000000000000000000000000000" as const,
  //   PROPOSAL_MANAGER: deployedAddresses[31337]?.PROPOSAL_MANAGER as `0x${string}` || "0x0000000000000000000000000000000000000000" as const
  // },
} as const;

export const getContractAddress = (chainId: number | undefined, contractName: keyof typeof CONTRACTS[296]) => {
  if (!chainId || !CONTRACTS[chainId as keyof typeof CONTRACTS]) {
    return undefined;
  }
  return CONTRACTS[chainId as keyof typeof CONTRACTS][contractName];
};
