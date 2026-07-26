"use client"

// Fork-only demo driver, visible to the proposal admin: two compact buttons
// that make five funded local wallets act out the auction and the market with
// staggered, believable activity. One slim, width-capped card — the log is a
// single truncated line, never a wall of text.
import { useCallback, useEffect, useRef, useState } from "react"
import { Button } from "@/components/ui/button"
import { Loader2, Play } from "lucide-react"
import { toast } from "sonner"
import { useAccount } from "wagmi"

const API_BASE = process.env.NEXT_PUBLIC_API_URL || "http://localhost:3001/api"
const IS_FORK = process.env.NEXT_PUBLIC_OPENFORT_LOCAL === "1"

type RunState = { running: boolean; log: string[] }

const clip = (s: string, n = 160) => (s.length > n ? s.slice(0, n) + "…" : s)

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
      let data: any = null
      try { data = await res.json() } catch { /* non-JSON error body */ }
      if (!res.ok) throw new Error(data?.error || `demo request failed (${res.status})`)
      toast.success(`${phase === "auction" ? "Auction" : "Market"} simulation started`)
      void poll()
    } catch (e: any) {
      toast.error("Demo failed to start", { description: clip(String(e?.message ?? e)) })
    }
  }

  const auctionRunning = status?.auction?.running ?? false
  const marketRunning = status?.market?.running ?? false
  const anyRunning = auctionRunning || marketRunning
  const lastLine = [...(status?.auction?.log ?? []), ...(status?.market?.log ?? [])].slice(-1)[0]

  return (
    <div className="w-full max-w-xs min-w-0 overflow-hidden rounded-md border border-dashed px-3 py-2 space-y-1.5">
      <div className="flex items-center justify-between gap-2">
        <span className="shrink-0 text-xs font-medium text-muted-foreground">Demo director</span>
        <div className="flex shrink-0 gap-1.5">
          <Button size="sm" variant="outline" className="h-7 px-2 text-xs" onClick={() => start("auction")} disabled={auctionRunning}>
            {auctionRunning ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : <Play className="mr-1 h-3 w-3" />}
            Auction
          </Button>
          <Button size="sm" variant="outline" className="h-7 px-2 text-xs" onClick={() => start("market")} disabled={marketRunning}>
            {marketRunning ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : <Play className="mr-1 h-3 w-3" />}
            Market
          </Button>
        </div>
      </div>
      {anyRunning && lastLine && (
        <p className="min-w-0 truncate font-mono text-[11px] text-muted-foreground" title={clip(lastLine, 400)}>
          {clip(lastLine)}
        </p>
      )}
    </div>
  )
}
