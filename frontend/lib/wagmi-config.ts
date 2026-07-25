import { http, createConfig } from "wagmi"
import { sepolia, type Chain } from "wagmi/chains"
import { getDefaultConfig } from "@openfort/react/wagmi"
import { anvil } from './custom-chains'

// Without a real project ID the WalletConnect connector just spams 403s
// ("Origin not found on Allowlist") — omit it and the connector is skipped.
const projectId = process.env.NEXT_PUBLIC_WALLET_CONNECT_PROJECT_ID
if (projectId && projectId.length !== 32) {
  console.warn('WalletConnect Project ID must be exactly 32 characters long. Please set NEXT_PUBLIC_WALLET_CONNECT_PROJECT_ID in your environment variables.')
}

// On a local fork, anvil is the ONLY chain: with Sepolia configured, stale
// sessions reconnect on 11155111 and wagmi keeps polling the public Sepolia
// RPC forever. Without it, old sessions are invalid and everything lands on
// the fork.
const isLocalFork = process.env.NEXT_PUBLIC_OPENFORT_LOCAL === '1'
const chains = (isLocalFork
  ? [anvil as unknown as Chain]
  : [sepolia, anvil as unknown as Chain]) as [Chain, ...Chain[]]

// Openfort supplies the external wallet connectors (MetaMask, WalletConnect,
// Coinbase, injected) alongside its own embedded/guest wallet, so there is no
// separate wallet kit here.
export const config = createConfig(
  getDefaultConfig({
    appName: 'Agora',
    appDescription: 'Futarchy markets decide',
    walletConnectProjectId: projectId,
    chains,
    transports: isLocalFork
      ? { [anvil.id]: http() }
      : {
          [sepolia.id]: http(process.env.NEXT_PUBLIC_RPC_URL || 'https://ethereum-sepolia-rpc.publicnode.com'),
          [anvil.id]: http(),
        },
    ssr: true,
  })
)
