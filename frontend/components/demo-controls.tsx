"use client"

// Fork-only demo driver, visible to the proposal admin: two buttons that make
// five funded local wallets act out the auction and the market with staggered,
// believable activity — so the whole lifecycle can be shown live in a minute.
import { useCallback, useEffect, useRef, useState } from "react"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Loader2, Play } from "lucide-react"
import { toast } from "sonner"
import { useAccount } from "wagmi"

const API_BASE = process.env.NEXT_PUBLIC_API_URL || "http://localhost:3001/api"
const IS_FORK = process.env.NEXT_PUBLIC_OPENFORT_LOCAL === "1"

type RunState = { running: boolean; log: string[] }

export function DemoControls({ proposalId, admin }: { proposalId: string; admin?: string }) {
  const { address } = useAccount()
  const [status, setStatus] = useState<{ auction: RunState; market: RunState } | null>(null)
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const isAdmin = !!address && !!admin && address.toLowerCase() === admin.toLowerCase()

  const poll = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/demo/${proposalId}/status`)
      if (res.ok) setStatus(await res.json())
    } catch { /* backend down — leave stale */ }
  }, [proposalId])

  useEffect(() => {
    if (!IS_FORK || !isAdmin) return
    void poll()
    pollRef.current = setInterval(() => { void poll() }, 1500)
    return () => { if (pollRef.current) clearInterval(pollRef.current) }
  }, [poll, isAdmin])

  if (!IS_FORK || !isAdmin) return null

  const start = async (phase: "auction" | "market") => {
    try {
      const res = await fetch(`${API_BASE}/demo/${proposalId}/${phase}`, { method: "POST" })
      const data = await res.json()
      if (!res.ok) throw new Error(data?.error || `demo ${res.status}`)
      toast.success(`${phase === "auction" ? "Auction" : "Market"} simulation started`)
      void poll()
    } catch (e: any) {
      toast.error("Demo failed to start", { description: e?.message })
    }
  }

  const auctionRunning = status?.auction?.running ?? false
  const marketRunning = status?.market?.running ?? false
  const lastLines = [...(status?.auction?.log ?? []), ...(status?.market?.log ?? [])].slice(-4)

  return (
    <Card className="border-dashed">
      <CardHeader className="pb-3">
        <CardTitle className="text-base">Demo director</CardTitle>
        <CardDescription>
          Five funded local wallets act out the crowd — staggered bids in the
          auction, then ship/fill trading on both books. Admin-only, fork-only.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="outline" onClick={() => start("auction")} disabled={auctionRunning}>
            {auctionRunning ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Play className="mr-2 h-4 w-4" />}
            {auctionRunning ? "Auction crowd running…" : "Simulate auction crowd"}
          </Button>
          <Button size="sm" variant="outline" onClick={() => start("market")} disabled={marketRunning}>
            {marketRunning ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Play className="mr-2 h-4 w-4" />}
            {marketRunning ? "Market trading running…" : "Simulate market trading"}
          </Button>
        </div>
        {lastLines.length > 0 && (
          <div className="rounded-md bg-muted/40 p-2 font-mono text-xs text-muted-foreground space-y-0.5">
            {lastLines.map((l, i) => <div key={i}>{l}</div>)}
          </div>
        )}
      </CardContent>
    </Card>
  )
}
