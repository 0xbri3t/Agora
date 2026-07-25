'use client'

import type { ReactNode } from 'react'
import { useEffect, useState } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { WagmiProvider, useAccount } from 'wagmi'
import { AuthProvider, OpenfortProvider, useOpenfortCore } from '@openfort/react'
import { useEthereumEmbeddedWallet } from '@openfort/react/ethereum'
import { AccountTypeEnum } from '@openfort/openfort-js'
import { OpenfortWagmiBridge } from '@openfort/react/wagmi'
import { config } from '@/lib/wagmi-config'
import { ThemeProvider } from "next-themes"
import { GlobalWalletAuth } from '@/components/global-wallet-auth'

const OPENFORT_KEY = process.env.NEXT_PUBLIC_OPENFORT_PUBLISHABLE_KEY
const SHIELD_KEY = process.env.NEXT_PUBLIC_SHIELD_PUBLISHABLE_KEY
const SPONSORSHIP_ID = process.env.NEXT_PUBLIC_OPENFORT_SPONSORSHIP_ID
// Fork mode: Openfort's bundler/paymaster can't reach a local anvil, so the
// embedded wallet runs as a plain EOA signing locally and broadcasting to the
// fork RPC. Gas comes from an anvil faucet instead of sponsorship.
const OPENFORT_LOCAL = process.env.NEXT_PUBLIC_OPENFORT_LOCAL === '1'
const ANVIL_RPC = process.env.NEXT_PUBLIC_ANVIL_RPC_URL || 'http://127.0.0.1:8545'

/**
 * @openfort/react 1.6.3 passes the gas policy to openfort-js as `{ policy }`,
 * but openfort-js 1.5.3 renamed that option to `feeSponsorship` — so the
 * sponsorship silently never reaches the embedded provider and UserOps go out
 * without a paymaster ("AA21 didn't pay prefund"). The provider is a
 * singleton with an update path, so re-applying the policy under the right
 * key once the wallet is up fixes every later transaction.
 */
function FeeSponsorshipFix() {
  const { client } = useOpenfortCore()
  const { status } = useEthereumEmbeddedWallet()

  useEffect(() => {
    if (status !== 'connected' || !SPONSORSHIP_ID || OPENFORT_LOCAL) return
    client.embeddedWallet
      .getEthereumProvider({ feeSponsorship: SPONSORSHIP_ID })
      .catch((err: unknown) => console.error('Failed to apply fee sponsorship policy:', err))
  }, [status, client])

  return null
}

/** Fork mode only: give the embedded EOA gas money straight from anvil. */
function AnvilFaucet() {
  const { address, chainId } = useAccount()

  useEffect(() => {
    if (!OPENFORT_LOCAL || !address || chainId !== 31337) return
    const rpc = (method: string, params: unknown[]) =>
      fetch(ANVIL_RPC, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
      }).then((r) => r.json())
    rpc('eth_getBalance', [address, 'latest'])
      .then((res) => {
        if (BigInt(res.result ?? '0x0') < 10n ** 17n) {
          // 10 ETH, plenty for a test session
          return rpc('anvil_setBalance', [address, '0x8AC7230489E80000'])
        }
      })
      .catch((err) => console.error('Anvil faucet failed:', err))
  }, [address, chainId])

  return null
}

/**
 * Wallet layer. With an Openfort publishable key configured we get guest
 * (embedded) wallets and gas sponsorship on top of the usual injected /
 * WalletConnect connectors. Without one — local dev, forks — the app still
 * runs on plain wagmi with those same connectors.
 */
function WalletProvider({ children }: { children: ReactNode }) {
  if (!OPENFORT_KEY || !SHIELD_KEY) {
    return <>{children}</>
  }

  return (
    <OpenfortWagmiBridge>
      <OpenfortProvider
        publishableKey={OPENFORT_KEY}
        walletConfig={{
          shieldPublishableKey: SHIELD_KEY,
          createEncryptedSessionEndpoint: '/api/openfort/encryption-session',
          // Guests land with a usable wallet instead of a setup flow
          connectOnLogin: true,
          // Gas sponsorship runs through Openfort's bundler, which only
          // accepts smart accounts — an EOA is rejected with
          // "Account type not supported". On a local fork the bundler can't
          // reach the chain at all, so there the wallet is a plain EOA
          // broadcasting to the fork RPC (see OPENFORT_LOCAL).
          ...(OPENFORT_LOCAL
            ? {
                ethereum: {
                  accountType: AccountTypeEnum.EOA,
                  chainId: 31337,
                  rpcUrls: { 31337: ANVIL_RPC },
                },
              }
            : SPONSORSHIP_ID
              ? {
                  ethereum: {
                    accountType: AccountTypeEnum.SMART_ACCOUNT,
                    ethereumFeeSponsorshipId: SPONSORSHIP_ID,
                  },
                }
              : {}),
        }}
        uiConfig={{
          authProviders: [AuthProvider.GUEST, AuthProvider.EMAIL_OTP, AuthProvider.WALLET],
        }}
      >
        <FeeSponsorshipFix />
        <AnvilFaucet />
        {children}
      </OpenfortProvider>
    </OpenfortWagmiBridge>
  )
}

export function Providers({ children }: { children: ReactNode }) {
  const [queryClient] = useState(() => new QueryClient())

  const [mounted, setMounted] = useState(false)
  useEffect(() => setMounted(true), [])
  if (!mounted) return null

  return (
    <ThemeProvider attribute="class" defaultTheme="dark" enableSystem={false}>
      <WagmiProvider config={config}>
        <QueryClientProvider client={queryClient}>
          <WalletProvider>
            {/* Automatically authenticate on wallet connect */}
            <GlobalWalletAuth />
            {children}
          </WalletProvider>
        </QueryClientProvider>
      </WagmiProvider>
    </ThemeProvider>
  )
}
