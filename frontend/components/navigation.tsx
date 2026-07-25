"use client"

import Link from "next/link"
import Image from "next/image"
import { WalletButton } from "@/components/wallet-button"
import { useIsMounted } from "@/hooks/use-is-mounted"

export function Navigation() {
  const mounted = useIsMounted()

  return (
    <nav className="sticky top-0 z-50 border-b border-border bg-background/85 backdrop-blur-sm">
      <div className="container mx-auto flex h-16 items-center justify-between px-4">
        <Link href="/" className="flex items-center gap-3 group">
          <Image
            src="/logo.svg"
            alt="Agora logo"
            width={32}
            height={32}
            priority
          />
          <span className="font-display text-[18px] text-foreground transition-opacity group-hover:opacity-80 sm:mr-2">
            Agora
          </span>
        </Link>

        <div className="flex items-center gap-4 sm:ml-2">
          {mounted && <WalletButton />}</div>
      </div>
    </nav>
  )
}
