import { http, createConfig } from "wagmi"
import { mainnet, sepolia, type Chain } from "wagmi/chains"
import { connectorsForWallets } from "@rainbow-me/rainbowkit"
import { metaMaskWallet, rabbyWallet, injectedWallet, walletConnectWallet } from "@rainbow-me/rainbowkit/wallets"
import { anvil } from './custom-chains'

const projectId = process.env.NEXT_PUBLIC_WALLET_CONNECT_PROJECT_ID || "00000000000000000000000000000000" // 32 character fallback

// Validate projectId length
if (projectId.length !== 32) {
  console.warn('WalletConnect Project ID must be exactly 32 characters long. Please set NEXT_PUBLIC_WALLET_CONNECT_PROJECT_ID in your environment variables.')
}

const chains = [
  sepolia,
  anvil as unknown as Chain,
] as [Chain, ...Chain[]]

// Always show MetaMask + Rabby; allow others via injected + WalletConnect
// Use signature compatible with various RainbowKit versions: provide wallets (uninvoked) and params separately.
const connectors = connectorsForWallets(
  [
    {
      groupName: 'Recommended',
      wallets: [
        metaMaskWallet,
        rabbyWallet,
      ],
    },
    {
      groupName: 'Other wallets',
      wallets: [
        // Auto-detect other injected providers (Brave, Bitget, OKX, etc.)
        injectedWallet,
        // Enable QR-based wallets via WalletConnect without forcing any brand
        walletConnectWallet,
      ],
    },
  ],
  { appName: 'Agora', projectId }
)


export const config = createConfig({
  chains,
  transports: {
    [sepolia.id]: http(process.env.NEXT_PUBLIC_RPC_URL || 'https://ethereum-sepolia-rpc.publicnode.com'),
    [anvil.id]: http(),
  },
  connectors,
  ssr: true,
})
