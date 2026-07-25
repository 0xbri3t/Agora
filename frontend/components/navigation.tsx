"use client"

import Link from "next/link"
import Image from "next/image"
import { ConnectButton } from "@rainbow-me/rainbowkit"
import { useIsMounted } from "@/hooks/use-is-mounted"
import { ThemeToggle } from "@/components/theme-toggle"

export function Navigation() {
  const mounted = useIsMounted()

  return (
    <nav className="sticky top-0 z-50 border-b border-border bg-black/20 dark:bg-black/50 backdrop-blur supports-[backdrop-filter]:bg-black/10 dark:supports-[backdrop-filter]:bg-black/40">
      <div className="container mx-auto flex h-16 items-center justify-between px-4">
        <Link href="/" className="flex items-center gap-3 group">
          {/* Light mode: black logo */}
          <Image
            src="/blackLogo.png"
            alt="FutarFi logo"
            width={40}
            height={40}
            className="block dark:hidden"
            priority
          />
          {/* Dark mode: white logo */}
          <Image
            src="/whiteLogo.png"
            alt="FutarFi logo"
            width={40}
            height={40}
            className="hidden dark:block"
            priority
          />
          <span className="text-xl font-bold text-foreground group-hover:text-primary transition-colors sm:mr-2">
            FutarFi
          </span>
        </Link>

        <div className="flex items-center gap-4 sm:ml-2">
          <ThemeToggle  />
          {mounted && <ConnectButton />}</div>
      </div>
    </nav>
  )
}
