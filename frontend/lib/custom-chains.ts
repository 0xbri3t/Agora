import { defineChain } from 'viem'

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
