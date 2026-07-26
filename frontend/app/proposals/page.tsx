"use client"

import Link from "next/link"
import { getSupportedCollaterals } from "@/lib/collaterals"
import { useChainId } from "wagmi"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { Card } from "@/components/ui/card"
import { Plus, Loader2, AlertCircle, ChevronUp, ChevronDown } from "lucide-react"
// import { useProposalsByAdmin } from "@/hooks/use-proposals-by-admin"
import { useGetAllProposals } from "@/hooks/use-get-all-proposals"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { useAccount } from "wagmi"
import { useEffect, useMemo, useState } from "react"
// Remove guard modal imports
// import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { ConnectWalletButton } from "@/components/wallet-button"
// import { useRouter, usePathname } from "next/navigation"
import { useCreateOrder } from "@/hooks/use-mintPublic"
import { useDeleteProposal } from "@/hooks/use-delete-proposal"
import { useToast } from "@/hooks/use-toast"
import { useConfig } from "wagmi"
import { useRouter } from "next/navigation"
import { Play } from "lucide-react"
import { createDemoProposal } from "@/lib/demo-proposal"

const IS_FORK = process.env.NEXT_PUBLIC_OPENFORT_LOCAL === "1"


const statusStyles = {
  Auction: "text-data-wait",
  Live: "text-data-up",
  Resolved: "text-muted-foreground",
  Cancelled: "text-data-down",
} as const

const statusLabels = {
  Auction: 'Auction',
  Live: 'Live',
  Resolved: 'Resolved',
  Cancelled: 'Cancelled',
} as const

type StatusKey = keyof typeof statusStyles

// Lifecycle order for the Status column sort
const statusRank: Record<StatusKey, number> = { Auction: 0, Live: 1, Resolved: 2, Cancelled: 3 }

type SortKey = "title" | "status" | "created" | "ends"
type SortDir = "asc" | "desc"

function SortHeader({
  label,
  sortId,
  activeKey,
  dir,
  onSort,
  className = "",
}: {
  label: string
  sortId: SortKey
  activeKey: SortKey
  dir: SortDir
  onSort: (key: SortKey) => void
  className?: string
}) {
  const active = activeKey === sortId
  return (
    <button
      type="button"
      onClick={() => onSort(sortId)}
      className={`flex items-center gap-1 transition-colors hover:text-foreground ${active ? "text-foreground" : ""} ${className}`}
    >
      {label}
      {active && (dir === "asc" ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />)}
    </button>
  )
}

export default function ProposalsPage() {
  const { proposals, isLoading, error, refetch } = useGetAllProposals()
  const { isConnected, address } = useAccount()
  // const router = useRouter()
  const { mintPublic, isMinting, collateralBalance, error: mintError, refetchOnchain } = useCreateOrder()
  const chainId = useChainId()
  const collaterals = getSupportedCollaterals(chainId)
  const SUBJECT_LOGOS: Record<string, string> = { UNI: "/logos/uniswap.svg", BTC: "/logos/btc.svg", ETH: "/logos/eth.svg", "1INCH": "/logos/1inch.svg" }
  const subjectFor = (p: any) => {
    const meta = collaterals.find(c => c.pythID.toUpperCase() === (p.subjectToken || "").toUpperCase())
    return meta ? { symbol: meta.symbol, logo: SUBJECT_LOGOS[meta.symbol] } : null
  }
  const { deleteProposal, pending, error: deleteError } = useDeleteProposal()
  const { toast } = useToast()
  const wagmiConfig = useConfig()
  const router = useRouter()
  const [demoPending, setDemoPending] = useState(false)

  // Fork-only: creates the one hardcoded, calibrated demo proposal so every
  // demo run starts from identical parameters. Creator becomes admin, so the
  // demo director buttons appear on the new proposal's page.
  const handleDemoProposal = async () => {
    setDemoPending(true)
    try {
      const id = await createDemoProposal(wagmiConfig, chainId)
      toast({ title: "Demo proposal created", description: `Proposal #${id} — calibrated for the demo director.` })
      try { refetch?.() } catch {}
      router.push(`/proposals/${id}`)
    } catch (e: any) {
      toast({ title: "Demo proposal failed", description: e?.shortMessage || e?.message || String(e), variant: "destructive" })
    } finally {
      setDemoPending(false)
    }
  }

  // Always fetch proposals on-chain via hook (works with or without a connected wallet)

  // Refresh USDC balance every 5 seconds if connected
  useEffect(() => {
    if (!isConnected) return;
    refetchOnchain(); // Fetch balance immediately on mount
    const interval = setInterval(() => {
      refetchOnchain();
    }, 5000); // Actualiza cada 5 segundos
    return () => clearInterval(interval);
  }, [isConnected, refetchOnchain]);

  // Ensure proposals are refetched when returning to this page (back navigation, bfcache, or tab visibility)
  useEffect(() => {
    if (!refetch) return

    const onPop = () => {
      try { refetch() } catch (e) { /* ignore */ }
    }

    const onVisibility = () => {
      if (document.visibilityState === 'visible') {
        try { refetch() } catch (e) { /* ignore */ }
      }
    }

    const onPageShow = (ev: PageTransitionEvent) => {
      try {
        // pageshow persisted indicates bfcache navigation restore
        if ((ev as any)?.persisted) refetch()
      } catch (e) { /* ignore */ }
    }

    window.addEventListener('popstate', onPop)
    window.addEventListener('pageshow', onPageShow as EventListener)
    document.addEventListener('visibilitychange', onVisibility)

    return () => {
      window.removeEventListener('popstate', onPop)
      window.removeEventListener('pageshow', onPageShow as EventListener)
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [refetch])

  // Listen for explicit refresh events dispatched by detail pages when navigating back
  useEffect(() => {
    if (!refetch) return
    const handler = () => {
      try { refetch() } catch (e) { /* ignore */ }
    }
    window.addEventListener('proposals:refresh', handler as EventListener)
    return () => window.removeEventListener('proposals:refresh', handler as EventListener)
  }, [refetch])

  // Always use on-chain proposals
  const list = proposals || []
  const loading = isLoading
  const errorToShow = error as any

  // Filter out proposals with the disallowed title
  const filteredList = useMemo(() => {
    try {
      return (list || []).filter((p: any) => String(p?.title ?? '').trim() !== 'Phat Nickher')
    } catch (e) {
      return list || []
    }
  }, [list])

  // Sorting — click a column header to sort, click again to flip direction.
  // Default: newest created first.
  const [sortKey, setSortKey] = useState<SortKey>("created")
  const [sortDir, setSortDir] = useState<SortDir>("desc")

  const toggleSort = (key: SortKey) => {
    if (key === sortKey) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"))
    } else {
      setSortKey(key)
      setSortDir("asc")
    }
  }

  const sortedList = useMemo(() => {
    const dir = sortDir === "asc" ? 1 : -1
    return [...filteredList].sort((a: any, b: any) => {
      switch (sortKey) {
        case "title":
          return dir * String(a.title ?? "").localeCompare(String(b.title ?? ""))
        case "status":
          return dir * ((statusRank[(a.state ?? "Auction") as StatusKey] ?? 0) - (statusRank[(b.state ?? "Auction") as StatusKey] ?? 0))
        case "created":
          return dir * ((a.auctionStartTime ?? 0) - (b.auctionStartTime ?? 0))
        case "ends":
          return dir * (((a.liveEnd || a.auctionEndTime) ?? 0) - ((b.liveEnd || b.auctionEndTime) ?? 0))
        default:
          return 0
      }
    })
  }, [filteredList, sortKey, sortDir])

  return (
    <div className="container mx-auto px-4 py-12">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 mb-8">
        <div className="min-w-0 flex-1">
          <h1 className="font-display text-4xl text-foreground mb-1">Markets</h1>
          <p className="font-mono text-xs tabular-nums text-muted-foreground">
            {String(filteredList.length).padStart(2, "0")} proposals
          </p>
        </div>
        <div className="flex flex-col sm:flex-row items-start sm:items-center gap-4 sm:gap-6 w-full sm:w-auto">
          {isConnected ? (
            <div className="flex items-center gap-3 w-full sm:w-auto">
              <span className="font-mono text-sm tabular-nums text-muted-foreground" id="collateral-balance">
                {Number(collateralBalance) / 1e6} USDC
              </span>
              <Button size="sm" variant="outline" onClick={mintPublic} disabled={isMinting}>
                {isMinting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                {isMinting ? "Minting…" : "Mint USDC"}
              </Button>
            </div>
          ) : null}
          {IS_FORK && isConnected && (
            <Button size="lg" variant="outline" className="w-full sm:w-auto" onClick={handleDemoProposal} disabled={demoPending}>
              {demoPending ? <Loader2 className="mr-2 h-5 w-5 animate-spin" /> : <Play className="mr-2 h-5 w-5" />}
              {demoPending ? "Creating…" : "Demo proposal"}
            </Button>
          )}
          <Button asChild size="lg" variant="default" className="w-full sm:w-auto">
            <Link href="/proposals/new">
              <Plus className="mr-2 h-5 w-5" />
              New proposal
            </Link>
          </Button>
        </div>
      </div>

      {errorToShow && (
        <Alert variant="destructive" className="mb-6">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>
            Failed to load proposals. Please check your connection and try again.
          </AlertDescription>
        </Alert>
      )}

      {loading ? (
        <div className="flex flex-col border border-border rounded-[4px]">
          <div className="hidden md:grid grid-cols-[1fr_auto_auto_auto_auto] items-center gap-6 border-b border-border px-4 py-2 text-xs text-muted-foreground">
            <span>Title</span>
            <span className="w-20 text-right">Status</span>
            <span className="w-24 text-right">Subject</span>
            <span className="w-24 text-right">Created</span>
            <span className="w-24 text-right">Ends</span>
          </div>
          {Array.from({ length: 8 }).map((_, i) => (
            <div
              key={i}
              className="grid grid-cols-1 md:grid-cols-[1fr_auto_auto_auto_auto] items-center gap-1 md:gap-6 border-b border-border px-4 py-3 last:border-b-0"
            >
              <Skeleton className="h-5 w-3/5 max-w-64" />
              <Skeleton className="h-4 w-20 md:justify-self-end" />
              <Skeleton className="h-4 w-24 md:justify-self-end" />
              <Skeleton className="h-4 w-24 md:justify-self-end" />
              <Skeleton className="h-4 w-24 md:justify-self-end" />
            </div>
          ))}
        </div>
  ) : filteredList.length === 0 ? (
        <Card className="p-12">
          <div className="flex flex-col items-center text-center space-y-4">
            <div className="p-4 rounded-full bg-muted">
              <Plus className="h-8 w-8 text-muted-foreground" />
            </div>
            <div className="space-y-2">
              <h3 className="text-xl font-semibold">No proposals yet</h3>
              <p className="text-muted-foreground max-w-md">
                No proposals have been created yet. Be the first to create a proposal.
              </p>
            </div>
            <Button asChild size="lg" className="mt-4">
              <Link href="/proposals/new">Create First Proposal</Link>
            </Button>
          </div>
        </Card>
      ) : (
        <div className="flex flex-col border border-border rounded-[4px]">
          {/* Header row (md+) — click a label to sort, click again to flip */}
          <div className="hidden md:grid grid-cols-[1fr_auto_auto_auto_auto] items-center gap-6 border-b border-border px-4 py-2 text-xs text-muted-foreground">
            <SortHeader label="Title" sortId="title" activeKey={sortKey} dir={sortDir} onSort={toggleSort} />
            <SortHeader label="Status" sortId="status" activeKey={sortKey} dir={sortDir} onSort={toggleSort} className="w-20 justify-end" />
            <span className="w-24 text-right">Subject</span>
            <SortHeader label="Created" sortId="created" activeKey={sortKey} dir={sortDir} onSort={toggleSort} className="w-24 justify-end" />
            <SortHeader label="Ends" sortId="ends" activeKey={sortKey} dir={sortDir} onSort={toggleSort} className="w-24 justify-end" />
          </div>
          {sortedList.map((proposal: any) => {
            const stateKey = (proposal.state ?? 'Auction') as StatusKey
            return (
              <Link
                key={proposal.id}
                href={`/proposals/${proposal.id}`}
                className="grid grid-cols-1 md:grid-cols-[1fr_auto_auto_auto_auto] items-center gap-1 md:gap-6 border-b border-border px-4 py-3 last:border-b-0 transition-colors hover:bg-card"
              >
                <span className="min-w-0 truncate text-foreground">{proposal.title}</span>
                <span className={`md:w-20 md:text-right text-sm font-medium ${statusStyles[stateKey]}`}>
                  {statusLabels[stateKey]}
                </span>
                <span className="flex items-center gap-1.5 md:w-24 md:justify-end font-mono text-xs text-muted-foreground">
                  {(() => {
                    const subj = subjectFor(proposal)
                    if (!subj) return <span>—</span>
                    return (
                      <>
                        {subj.logo && <img src={subj.logo} alt="" className="h-4 w-4" />}
                        {subj.symbol}
                      </>
                    )
                  })()}
                </span>
                <span className="md:w-24 md:text-right font-mono text-xs tabular-nums text-muted-foreground">
                  {new Date((proposal.auctionStartTime || 0) * 1000).toLocaleDateString(undefined, {
                    month: "short",
                    day: "numeric",
                  })}
                </span>
                <span className="md:w-24 md:text-right font-mono text-xs tabular-nums text-muted-foreground">
                  {new Date(((proposal.liveEnd || proposal.auctionEndTime) || 0) * 1000).toLocaleDateString(undefined, {
                    month: "short",
                    day: "numeric",
                  })}
                </span>
              </Link>
            )
          })}
        </div>
      )}
    </div>
  )
}
