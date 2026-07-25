"use client"

import Link from "next/link"
import { useMemo } from "react"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { useGetAllProposals } from "@/hooks/use-get-all-proposals"
import type { Proposal } from "@/lib/types"

const MAX_ROWS = 6

const statusStyles: Record<Proposal["state"], string> = {
  Auction: "text-data-wait",
  Live: "text-data-up",
  Resolved: "text-muted-foreground",
  Cancelled: "text-muted-foreground",
}

function formatEndTime(proposal: Proposal): string {
  const seconds =
    proposal.state === "Auction" ? proposal.auctionEndTime : proposal.liveEnd
  if (!seconds) return "—"
  return new Date(seconds * 1000).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  })
}

function SkeletonRow({ i }: { i: number }) {
  return (
    <div
      className="flex items-center justify-between gap-4 border-b border-border px-4 py-3 last:border-b-0"
      aria-hidden
    >
      <div
        className="h-3 rounded-sm bg-accent animate-pulse"
        style={{ width: `${52 - i * 4}%` }}
      />
      <div className="h-3 w-12 rounded-sm bg-accent animate-pulse" />
      <div className="h-3 w-14 rounded-sm bg-accent animate-pulse" />
    </div>
  )
}

export function LiveMarketsPanel({ className }: { className?: string }) {
  const { proposals, isLoading, error } = useGetAllProposals()

  const rows = useMemo(() => proposals.slice(0, MAX_ROWS), [proposals])

  return (
    <div
      className={cn(
        "flex flex-col rounded-[4px] border border-border bg-card",
        className,
      )}
    >
      <div className="flex shrink-0 items-center justify-between border-b border-border px-4 py-3">
        <span className="text-xs font-medium tracking-wide text-foreground">
          MARKETS
        </span>
        <span className="font-mono text-xs tabular-nums text-muted-foreground">
          {isLoading ? "—" : String(proposals.length).padStart(2, "0")}
        </span>
      </div>

      <div className="max-h-[226px] overflow-hidden">
        {isLoading ? (
          <div>
            {Array.from({ length: 5 }).map((_, i) => (
              <SkeletonRow key={i} i={i} />
            ))}
          </div>
        ) : error ? (
          <div className="px-4 py-6">
            <p className="text-sm text-muted-foreground">feed unavailable</p>
          </div>
        ) : rows.length === 0 ? (
          <div className="flex flex-col gap-3 px-4 py-6">
            <p className="text-sm text-muted-foreground">
              0 markets &mdash; create the first
            </p>
            <Button asChild variant="ghost" size="sm" className="w-fit px-0">
              <Link href="/proposals/new">New proposal &#8594;</Link>
            </Button>
          </div>
        ) : (
          <div>
            {rows.map((proposal) => (
              <Link
                key={proposal.id}
                href={`/proposals/${proposal.id}`}
                className="flex items-center justify-between gap-4 border-b border-border px-4 py-3 text-sm transition-colors last:border-b-0 hover:bg-accent"
              >
                <span className="min-w-0 flex-1 truncate text-foreground">
                  {proposal.title}
                </span>
                <span
                  className={cn(
                    "shrink-0 text-xs font-medium",
                    statusStyles[proposal.state],
                  )}
                >
                  {proposal.state === "Live" ? "Live" : proposal.state}
                </span>
                <span className="shrink-0 font-mono text-xs tabular-nums text-muted-foreground">
                  {formatEndTime(proposal)}
                </span>
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
