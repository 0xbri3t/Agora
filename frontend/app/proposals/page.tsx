"use client"

import Link from "next/link"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { Plus, Loader2, AlertCircle } from "lucide-react"
// import { useProposalsByAdmin } from "@/hooks/use-proposals-by-admin"
import { useGetAllProposals } from "@/hooks/use-get-all-proposals"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { useAccount } from "wagmi"
import { useEffect, useMemo } from "react"
// Remove guard modal imports
// import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
// import { ConnectWalletButton } from "@/components/connect-wallet-button"
// import { useRouter, usePathname } from "next/navigation"
import { useCreateOrder } from "@/hooks/use-mintPublic"
import { useDeleteProposal } from "@/hooks/use-delete-proposal"
import { useToast } from "@/hooks/use-toast"


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

export default function ProposalsPage() {
  const { proposals, isLoading, error, refetch } = useGetAllProposals()
  const { isConnected, address } = useAccount()
  // const router = useRouter()
  const { mintPublic, pyUSDBalance, error: mintError, refetchOnchain } = useCreateOrder()
  const { deleteProposal, pending, error: deleteError } = useDeleteProposal()
  const { toast } = useToast()

  // Always fetch proposals on-chain via hook (works with or without a connected wallet)

  // Refresh PYUSD balance every 5 seconds if connected
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

  // Helper function to format address
  const formatAddress = (addr: string) => {
    if (!addr) return ""
    return `${addr.slice(0, 6)}...${addr.slice(-4)}`
  }




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
                {Number(pyUSDBalance) / 1e6} USDC
              </span>
              <Button size="sm" variant="outline" onClick={mintPublic}>
                Mint USDC
              </Button>
            </div>
          ) : null}
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
        <Card className="p-12">
          <div className="flex flex-col items-center text-center space-y-4">
            <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
            <div className="space-y-2">
              <h3 className="text-xl font-semibold">Loading Proposals</h3>
              <p className="text-muted-foreground">Please wait while we fetch the latest proposals.</p>
            </div>
          </div>
        </Card>
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
          {/* Removed wallet guard to allow viewing proposals without a connected wallet */}
          {/* Header row (md+) — labels for the shared grid template */}
          <div className="hidden md:grid grid-cols-[1fr_auto_auto_auto] items-center gap-6 border-b border-border px-4 py-2 text-xs text-muted-foreground">
            <span>Title</span>
            <span className="w-20 text-right">Status</span>
            <span className="w-28 text-right">Admin</span>
            <span className="w-24 text-right">Ends</span>
          </div>
          {filteredList.map((proposal: any) => {
            const stateKey = (proposal.state ?? 'Auction') as StatusKey
            return (
              <Link
                key={proposal.id}
                href={`/proposals/${proposal.id}`}
                className="grid grid-cols-1 md:grid-cols-[1fr_auto_auto_auto] items-center gap-1 md:gap-6 border-b border-border px-4 py-3 last:border-b-0 transition-colors hover:bg-card"
              >
                <span className="min-w-0 truncate text-foreground">{proposal.title}</span>
                <span className={`md:w-20 md:text-right text-sm font-medium ${statusStyles[stateKey]}`}>
                  {statusLabels[stateKey]}
                </span>
                <span className="md:w-28 md:text-right font-mono text-xs tabular-nums text-muted-foreground">
                  {formatAddress(proposal.admin)}
                </span>
                <span className="md:w-24 md:text-right font-mono text-xs tabular-nums text-muted-foreground">
                  {new Date((proposal.auctionStartTime || 0) * 1000).toLocaleDateString(undefined, {
                    month: "short",
                    day: "numeric",
                  })}
                </span>

                {/* {isConnected && address && proposal?.admin && String(address).toLowerCase() === String(proposal.admin).toLowerCase() ? (
                  <div className="md:col-span-4 flex justify-end">
                    <Button
                      size="sm"
                      variant="ghost"
                      className="text-data-down hover:text-data-down hover:bg-data-down/10"
                      disabled={pending}
                      onClick={async (e) => {
                        e.preventDefault()
                        e.stopPropagation()
                        try {
                          const res = await deleteProposal({ proposalAddress: proposal.address })
                          if ((res as any)?.error) throw new Error((res as any).error)
                          toast({ title: "Proposal deleted", description: `Tx hash: ${(res as any).txHash ?? ''}` })
                          try { await refetch?.() } catch {}
                        } catch (err: any) {
                          toast({ title: "Delete failed", description: err?.message || String(err), variant: "destructive" })
                        }
                      }}
                    >
                      Delete proposal
                    </Button>
                  </div>
                ) : null} */}
              </Link>
            )
          })}
        </div>
      )}
    </div>
  )
}
