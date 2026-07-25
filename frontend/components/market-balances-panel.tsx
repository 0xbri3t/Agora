"use client"

import { useEffect, useMemo, useCallback, useState } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Loader2 } from "lucide-react"
import { toast } from "sonner"
import { useAccount, useChainId, usePublicClient } from "wagmi"
import { useGetProposalById } from "@/hooks/use-get-proposalById"
import { useAuctionBids } from "@/hooks/use-auction-buy"
import { marketToken_abi } from "@/contracts/marketToken-abi"
import {getContractAddress} from "@/contracts/constants"

/** Auction bids turn into tradable tokens only after exitBid + claimTokens —
 *  without this button the tokens stay stuck in the settled CCA. */
function ClaimAuctionTokens({ auctionAddress, side, onClaimed }: {
  auctionAddress?: `0x${string}`
  side: "YES" | "NO"
  onClaimed: () => void
}) {
  const { bids, exitAndClaim, isWorking, refetch } = useAuctionBids({ auctionAddress })
  const [claiming, setClaiming] = useState(false)

  useEffect(() => {
    const id = setInterval(() => { void refetch() }, 5000)
    return () => clearInterval(id)
  }, [refetch])

  if (!auctionAddress || bids.length === 0) return null

  const committedUsdc = Number(bids.reduce((s, b) => s + b.amount, 0n)) / 1e6

  const claimAll = async () => {
    setClaiming(true)
    try {
      for (const b of bids) {
        const ok = await exitAndClaim(b.bidId)
        if (!ok) { toast.error(`Claim failed for ${side} bid #${b.bidId}`); return }
      }
      toast.success(`Claimed ${side} auction tokens`)
      onClaimed()
      await refetch()
    } finally {
      setClaiming(false)
    }
  }

  return (
    <div className="space-y-1">
      <Button size="sm" variant="outline" className="w-full" onClick={claimAll} disabled={claiming || isWorking}>
        {(claiming || isWorking) && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
        Claim {side} auction tokens · {committedUsdc.toLocaleString(undefined, { maximumFractionDigits: 2 })} USDC bid
      </Button>
      <p className="text-xs text-muted-foreground">
        Your auction tokens appear in the balance after claiming.
      </p>
    </div>
  )
}

export function MarketBalancesPanel({ proposalId }: { proposalId: string }) {
  const { address, isConnected } = useAccount()
  const publicClient = usePublicClient()
  const { proposal } = useGetProposalById(proposalId)
  const chainId = useChainId()

  const collateralAddr = getContractAddress(chainId, 'COLLATERAL')
  const yesToken = proposal?.yesToken as `0x${string}` | undefined
  const noToken = proposal?.noToken as `0x${string}` | undefined

  const [collateral, setCollateral] = useState<bigint>(0n)
  const [yes, setYes] = useState<bigint>(0n)
  const [no, setNo] = useState<bigint>(0n)

  const refetch = useCallback(async () => {
    try {
      if (!publicClient || !address) return
      if (collateralAddr) {
        const b = await publicClient.readContract({ address: collateralAddr, abi: marketToken_abi, functionName: 'balanceOf', args: [address] }) as bigint
        setCollateral(b ?? 0n)
      }
      if (yesToken) {
        const b = await publicClient.readContract({ address: yesToken, abi: marketToken_abi, functionName: 'balanceOf', args: [address] }) as bigint
        setYes(b ?? 0n)
      }
      if (noToken) {
        const b = await publicClient.readContract({ address: noToken, abi: marketToken_abi, functionName: 'balanceOf', args: [address] }) as bigint
        setNo(b ?? 0n)
      }
    } catch {
      // ignore
    }
  }, [publicClient, address, collateralAddr, yesToken, noToken])

  useEffect(() => { void refetch() }, [refetch])
  useEffect(() => {
    const id = setInterval(() => { void refetch() }, 3000)
    return () => clearInterval(id)
  }, [refetch])

  const collateralDisplay = useMemo(() => Number(collateral ?? 0n) / 1e6, [collateral])
  const yesDisplay = useMemo(() => Number(yes ?? 0n) / 1e18, [yes])
  const noDisplay = useMemo(() => Number(no ?? 0n) / 1e18, [no])

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg">Your Balances</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {!isConnected ? (
          <div className="text-sm text-muted-foreground">Connect your wallet to see balances.</div>
        ) : (
          <>
            <div
              className="flex items-center justify-between rounded-md border px-3 py-2"
              style={{
                // Blue gradient using color-mix for consistent theming
                backgroundColor: "color-mix(in oklab, #002991 12%, transparent)",
                borderColor: "color-mix(in oklab, #61cdff 40%, transparent)",
              }}
            >
              <span className="text-sm font-medium" style={{ color: "#61cdff" }}>USDC</span>
              <span className="font-mono text-base" style={{ color: "#61cdff" }}>
                 $ {collateralDisplay.toLocaleString(undefined, { maximumFractionDigits: 6 })}
              </span>
            </div>

            {/* tYES balance with fixed green accents (same in light/dark) */}
            <div
              className="flex items-center justify-between rounded-md border px-3 py-2"
              style={{
                background: "color-mix(in oklab, #00ff85 8%, transparent)",
                borderColor: "color-mix(in oklab, #00ff85 30%, transparent)",
              }}
            >
              <span className="text-sm font-medium" style={{ color: "#00ff85" }}>tYES</span>
              <span className="font-mono text-base" style={{ color: "#00ff85" }}>
                {yesDisplay.toLocaleString(undefined, { maximumFractionDigits: 6 })}
              </span>
            </div>

            {/* tNO balance with fixed red accents (same in light/dark) */}
            <div
              className="flex items-center justify-between rounded-md border px-3 py-2"
              style={{
                background: "color-mix(in oklab, #ef4444 8%, transparent)",
                borderColor: "color-mix(in oklab, #ef4444 30%, transparent)",
              }}
            >
              <span className="text-sm font-medium" style={{ color: "#ef4444" }}>tNO</span>
              <span className="font-mono text-base" style={{ color: "#ef4444" }}>
                {noDisplay.toLocaleString(undefined, { maximumFractionDigits: 6 })}
              </span>
            </div>

            <ClaimAuctionTokens auctionAddress={proposal?.yesAuction} side="YES" onClaimed={refetch} />
            <ClaimAuctionTokens auctionAddress={proposal?.noAuction} side="NO" onClaimed={refetch} />
          </>
        )}
      </CardContent>
    </Card>
  )
}
