import { defineChain } from 'viem'

// Overridable so other devices on the LAN can point at the host's anvil
const ANVIL_RPC = process.env.NEXT_PUBLIC_ANVIL_RPC_URL || 'http://127.0.0.1:8545'

export const _anvil = defineChain({
  id: 31337,
  name: 'Anvil Local',
  nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
  rpcUrls: {
    default: { http: [ANVIL_RPC] },
    public:  { http: [ANVIL_RPC] },
  },

})

export const anvil = {
  ..._anvil,
  iconUrl: '/anvil.png',
  iconBackground: '#111',
}
