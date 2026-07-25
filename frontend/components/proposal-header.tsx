import Link from "next/link"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { ArrowLeft, ExternalLink, User, Clock } from "lucide-react"
import { getSupportedCollaterals } from "@/lib/collaterals"
import type { Proposal } from "@/lib/types"

interface ProposalHeaderProps {
  proposal: Proposal
  chainId: number
}

const statusColors = {
  Auction: "bg-yellow-500/10 text-yellow-500 border-yellow-500/20",
  Live: "bg-green-500/10 text-green-500 border-green-500/20",
  Resolved: "bg-muted text-muted-foreground border-border",
  Cancelled: "bg-red-500/10 text-red-600 border-red-500/20",
}

export function ProposalHeader({ proposal, chainId }: ProposalHeaderProps) {
  // Use admin (on-chain) or fallback to contract instance address as the creator
  const creatorAddress = (proposal as any).admin || (proposal as any).address || ''
  const explorerUrl = getExplorerUrl(chainId, creatorAddress)

  // Resolve subject token info strictly from collaterals: symbol and subjectTokenUrl
  const collaterals = getSupportedCollaterals(chainId)
  const subjectMeta = collaterals.find(c => c.pythID.toUpperCase() === (proposal.subjectToken || '').toUpperCase())
  const subjectSymbol = subjectMeta?.symbol || ''
  const subjectUrl = subjectMeta?.subjectTokenUrl

  // Normalize state for coloring and label
  const stateRaw = String((proposal as any).state || '').toLowerCase()
  const stateLabel = stateRaw ? (stateRaw[0].toUpperCase() + stateRaw.slice(1)) : 'Auction'
  const badgeClass = (statusColors as any)[stateLabel] || statusColors.Auction

  // Derive the most accurate timeframe depending on state, with robust fallbacks
  const pAny = proposal as any
  const auctionStart: number | undefined = pAny.auctionStartTime ?? pAny.startTime ?? pAny?.auctions?.yes?.startTime ?? pAny?.auctions?.no?.startTime
  const auctionEndCandidate = Math.max(
    Number(pAny?.auctions?.yes?.endTime || 0),
    Number(pAny?.auctions?.no?.endTime || 0)
  )
  const auctionEnd: number | undefined = pAny.auctionEndTime ?? (auctionEndCandidate > 0 ? auctionEndCandidate : undefined) ?? pAny.endTime

  const liveStart: number | undefined = pAny.liveStart ?? pAny.startTime ?? auctionEnd
  // If liveEnd not present yet, try computing from liveStart + liveDuration
  const liveDurationSec: number | undefined = typeof pAny.liveDuration === 'number' ? pAny.liveDuration : undefined
  const liveStartMs: number | undefined = typeof liveStart === 'number' ? (liveStart > 1e12 ? liveStart : liveStart * 1000) : undefined
  const computedLiveEndMs: number | undefined = (liveStartMs && liveDurationSec) ? (liveStartMs + liveDurationSec * 1000) : undefined
  const liveEnd: number | undefined = pAny.liveEnd ?? (computedLiveEndMs !== undefined ? computedLiveEndMs : undefined) ?? pAny.endTime ?? auctionEnd

  const windowStart = stateRaw === 'live' ? liveStart : auctionStart
  const windowEnd = stateRaw === 'live' ? liveEnd : auctionEnd

  return (
    <div className="space-y-6">
      <Button variant="ghost" size="sm" asChild>
        <Link href="/proposals" onClick={() => window.dispatchEvent(new CustomEvent('proposals:refresh'))}>
          <ArrowLeft className="mr-2 h-4 w-4" />
          Back to Proposals
        </Link>
      </Button>

      <div className="space-y-4">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <h1 className="text-4xl font-bold text-balance break-words whitespace-normal leading-tight flex-1 min-w-0">{proposal.title}</h1>
        </div>

        <div className="flex items-center justify-between flex-wrap gap-4 text-sm text-muted-foreground">
          <div className="flex items-center gap-4 flex-wrap">
            <div className="flex items-center gap-2">
              <User className="h-4 w-4" />
              <span>Creator:</span>
              <a
                href={explorerUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="text-primary hover:underline inline-flex items-center gap-1"
              >
                {formatAddress(creatorAddress)}
                <ExternalLink className="h-3 w-3" />
              </a>
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              <Clock className="h-4 w-4" />
              <span>
                {formatDate(windowStart)} - {formatDate(windowEnd)}
              </span>
              <Badge variant="outline" className={badgeClass}>
                {stateLabel}
              </Badge>
            </div>
          </div>
          <div className="prose prose-invert max-w-none w-full">
            <p className="text-muted-foreground leading-relaxed whitespace-pre-wrap break-words">{proposal.description}</p>
          </div>
          {subjectSymbol && (
            subjectUrl ? (
              <a
                href={subjectUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-2 px-2 py-1 rounded-md border hover:bg-muted"
                title={`Open ${subjectSymbol} website`}
              >
                {subjectMeta?.logoURI ? (
                  <img src={subjectMeta.logoURI} alt={`${subjectSymbol} logo`} className="h-5 w-5 rounded-sm" />
                ) : (
                  <span className="inline-flex items-center justify-center h-5 w-5 rounded-full bg-muted-foreground/20 text-xs font-bold">
                    {subjectSymbol.slice(0,1)}
                  </span>
                )}
                <span className="font-medium">{subjectMeta?.symbol || subjectSymbol}</span>
                <ExternalLink className="h-3.5 w-3.5 opacity-70" />
              </a>
            ) : (
              <span className="inline-flex items-center gap-2 px-2 py-1 rounded-md border" title={subjectSymbol}>
                {subjectMeta?.logoURI ? (
                  <img src={subjectMeta.logoURI} alt={`${subjectSymbol} logo`} className="h-5 w-5 rounded-sm" />
                ) : (
                  <span className="inline-flex items-center justify-center h-5 w-5 rounded-full bg-muted-foreground/20 text-xs font-bold">
                    {subjectSymbol.slice(0,1)}
                  </span>
                )}
                <span className="font-medium">{subjectMeta?.symbol || subjectSymbol}</span>
              </span>
            )
          )}
       
        </div>

      </div>
    </div>
  )
}

function formatAddress(address: string): string {
  if (!address) return ''
  return `${address.slice(0, 6)}...${address.slice(-4)}`
}

function formatDate(timestamp: number | bigint | undefined): string {
  if (!timestamp && timestamp !== 0) return 'N/A'
  const tsNum = typeof timestamp === 'bigint' ? Number(timestamp) : Number(timestamp)
  if (!Number.isFinite(tsNum) || tsNum <= 0) return 'N/A'
  // If timestamp looks like milliseconds already (>= 1e12), use as-is; otherwise treat as seconds
  const ms = tsNum > 1e12 ? tsNum : tsNum * 1000
  return new Date(ms).toLocaleDateString()
}

function getExplorerUrl(chainId: number, address: string): string {
  const explorers: Record<number, string> = {
    1: "https://etherscan.io",
    11155111: "https://sepolia.etherscan.io",
    42161: "https://arbiscan.io",
    421614: "https://sepolia.arbiscan.io",
  }
  const baseUrl = explorers[chainId] || explorers[1]
  return `${baseUrl}/address/${address}`
}
