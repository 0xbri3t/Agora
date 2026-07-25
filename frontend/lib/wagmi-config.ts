import { http, createConfig } from "wagmi"
import { sepolia, type Chain } from "wagmi/chains"
import { getDefaultConfig } from "@openfort/react/wagmi"
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

// Openfort supplies the external wallet connectors (MetaMask, WalletConnect,
// Coinbase, injected) alongside its own embedded/guest wallet, so there is no
// separate wallet kit here.
export const config = createConfig(
  getDefaultConfig({
    appName: 'Agora',
    appDescription: 'Futarchy markets decide',
    walletConnectProjectId: projectId,
    chains,
    transports: {
      [sepolia.id]: http(process.env.NEXT_PUBLIC_RPC_URL || 'https://ethereum-sepolia-rpc.publicnode.com'),
      [anvil.id]: http(),
    },
    ssr: true,
  })
)
