"use client"

import { OpenfortButton } from "@openfort/react"
import { useAccount, useConnect, useDisconnect } from "wagmi"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"

const OPENFORT_ENABLED = Boolean(
  process.env.NEXT_PUBLIC_OPENFORT_PUBLISHABLE_KEY && process.env.NEXT_PUBLIC_SHIELD_PUBLISHABLE_KEY
)

function truncate(address: string) {
  return `${address.slice(0, 6)}…${address.slice(-4)}`
}

/**
 * Bare wagmi fallback used when Openfort is not configured (local dev): picks
 * the first available injected connector so anvil accounts still work.
 */
function PlainWalletButton({ className, label }: { className?: string; label: string }) {
  const { address, isConnected } = useAccount()
  const { connect, connectors, isPending } = useConnect()
  const { disconnect } = useDisconnect()

  if (isConnected && address) {
    return (
      <Button variant="outline" className={className} onClick={() => disconnect()}>
        {truncate(address)}
      </Button>
    )
  }

  const injected = connectors.find((c) => c.type === "injected") ?? connectors[0]
  return (
    <Button
      className={className}
      disabled={!injected || isPending}
      onClick={() => injected && connect({ connector: injected })}
    >
      {isPending ? "Connecting…" : label}
    </Button>
  )
}

/**
 * The app's single wallet entry point. With Openfort configured this opens its
 * modal — guest wallet, email OTP, or an external wallet.
 */
export function WalletButton({ className, label = "Connect Wallet" }: { className?: string; label?: string }) {
  if (!OPENFORT_ENABLED) return <PlainWalletButton className={className} label={label} />
  return <OpenfortButton label={label} showAvatar showBalance />
}

/**
 * Renders nothing once a wallet is connected — for prompts that only make
 * sense while disconnected.
 */
export function ConnectWalletButton({
  className,
  label = "Connect Wallet",
  onBeforeOpen,
}: {
  className?: string
  label?: string
  onBeforeOpen?: () => void
}) {
  const { isConnected } = useAccount()
  if (isConnected) return null

  if (!OPENFORT_ENABLED) {
    return <PlainWalletButton className={cn("bg-blue-600 hover:bg-blue-500 text-white", className)} label={label} />
  }

  return (
    <OpenfortButton.Custom>
      {({ show, isConnected: connected }) => {
        if (connected) return null
        return (
          <Button
            type="button"
            onClick={() => {
              onBeforeOpen?.()
              show?.()
            }}
            className={cn("bg-blue-600 hover:bg-blue-500 text-white shadow-sm px-4 py-2", className)}
          >
            {label}
          </Button>
        )
      }}
    </OpenfortButton.Custom>
  )
}
