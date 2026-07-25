'use client'

import type { ReactNode } from 'react'
import { useEffect, useState } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { WagmiProvider } from 'wagmi'
import { AuthProvider, OpenfortProvider } from '@openfort/react'
import { AccountTypeEnum } from '@openfort/openfort-js'
import { OpenfortWagmiBridge } from '@openfort/react/wagmi'
import { config } from '@/lib/wagmi-config'
import { ThemeProvider } from "next-themes"
import { GlobalWalletAuth } from '@/components/global-wallet-auth'

const OPENFORT_KEY = process.env.NEXT_PUBLIC_OPENFORT_PUBLISHABLE_KEY
const SHIELD_KEY = process.env.NEXT_PUBLIC_SHIELD_PUBLISHABLE_KEY
const SPONSORSHIP_ID = process.env.NEXT_PUBLIC_OPENFORT_SPONSORSHIP_ID

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
          // "Account type not supported".
          ...(SPONSORSHIP_ID
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
