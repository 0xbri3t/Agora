import { defineChain } from 'viem'
import { hedera, hederaTestnet } from 'wagmi/chains'



// Hedera mainnet with custom icon
export const hederaWithIcon = {
  ...hedera,
  iconUrl: '/hedera.png',
  iconBackground: '#0B1A2B', 
}

// Hedera testnet with custom icon
export const hederaTestnetWithIcon = {
  ...hederaTestnet,
  iconUrl: '/hederaTestnet.jpg',
  iconBackground: '#0B1A2B',
}


export const _anvil = defineChain({
  id: 31337, 
  name: 'Anvil Local',
  nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
  rpcUrls: {
    default: { http: ['http://127.0.0.1:8545'] },
    public:  { http: ['http://127.0.0.1:8545'] },
  },
  
})

export const anvil = {
  ..._anvil,
  iconUrl: '/anvil.png',
  iconBackground: '#111',
}