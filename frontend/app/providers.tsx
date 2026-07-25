'use client'

import '@rainbow-me/rainbowkit/styles.css'

import type { ReactNode } from 'react'
import { useEffect, useState } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { WagmiProvider } from 'wagmi'
import { RainbowKitProvider, darkTheme } from '@rainbow-me/rainbowkit'
import { config } from '@/lib/wagmi-config'
import { ThemeProvider } from "next-themes"
import { GlobalWalletAuth } from '@/components/global-wallet-auth'


export function Providers({ children }: { children: ReactNode }) {
  const [queryClient] = useState(() => new QueryClient())

  const [mounted, setMounted] = useState(false)
  useEffect(() => setMounted(true), [])
  if (!mounted) return null

  return (
        <ThemeProvider attribute="class" defaultTheme="dark" enableSystem={false}>
          <WagmiProvider config={config}>
            <QueryClientProvider client={queryClient}>
              <RainbowKitProvider theme={darkTheme()}>
                {/* Automatically authenticate on wallet connect */}
                <GlobalWalletAuth />
                {children}
              </RainbowKitProvider>
            </QueryClientProvider>
          </WagmiProvider>
        </ThemeProvider>
  )
}
