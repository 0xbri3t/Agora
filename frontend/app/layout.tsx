import type React from "react"
import type { Metadata } from "next"
import { GeistSans } from "geist/font/sans"
import { GeistMono } from "geist/font/mono"
import { Providers } from "./providers"
import { Navigation } from "@/components/navigation"
import { SiteFooter } from "@/components/site-footer"
import { Toaster } from "@/components/ui/toaster"
import { Suspense } from "react"
import { Toaster as SonnerToaster } from "sonner"
import "@/styles/globals.css"

export const metadata: Metadata = {
  title: "FutarFi",
  description: "Create proposals, open prediction markets, and execute outcomes trustlessly",
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html lang="en" className="dark">
      <body className={`font-sans ${GeistSans.variable} ${GeistMono.variable} antialiased`}>
        <Providers>
          <div className="min-h-screen flex flex-col">
            <Suspense fallback={<div>Loading...</div>}>
              <Navigation />
              <main className="flex-1">{children}</main>
              <SiteFooter />
            </Suspense>
          </div>
          <Suspense fallback={<div>Loading...</div>}>
            <Toaster />
            <SonnerToaster richColors position="top-center" />
          </Suspense>
        </Providers>
      </body>
    </html>
  )
}
