"use client"

import { ConnectButton } from "@rainbow-me/rainbowkit"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"

type Props = {
  className?: string
  label?: string
  onBeforeOpen?: () => void
}

// A consistent blue-styled Connect Wallet button that triggers RainbowKit's connect modal
export function ConnectWalletButton({ className, label = "Connect Wallet", onBeforeOpen }: Props) {
  return (
    <ConnectButton.Custom>
      {({ openConnectModal, account, mounted }) => {
        const connected = mounted && account

        if (connected) return null

        return (
          <Button
            type="button"
            onClick={() => {
              onBeforeOpen?.()
              openConnectModal()
            }}
            className={cn(
              // Ensure blue styling regardless of theme
              "bg-blue-600 hover:bg-blue-500 text-white shadow-sm",
              // Match rounded, padding similar to navbar's default button scale
              "px-4 py-2",
              className,
            )}
          >
            {label}
          </Button>
        )
      }}
    </ConnectButton.Custom>
  )
}
