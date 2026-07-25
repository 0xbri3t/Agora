"use client"

import React, { useEffect, useState } from "react"
import { Skeleton } from "@/components/ui/skeleton"
import { Button } from "@/components/ui/button"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { AlertCircle } from "lucide-react"
import Link from "next/link"
import { ProposalHeader } from "@/components/proposal-header"
import { AuctionView } from "@/components/auction-view"
import { MarketView } from "@/components/market-view"
import { AuctionTradePanel } from "@/components/auction-trade-panel"
import { MarketTradePanel } from "@/components/market-trade-panel"
import { MarketBalancesPanel } from "@/components/market-balances-panel"
import { MarketPriceHeader } from "@/components/market-price-header"
import { useChainId, useAccount } from "wagmi"
// Removed blocking dialog imports
// import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog"
// import { ConnectWalletButton } from "@/components/connect-wallet-button"
import type { Proposal, UserOrder, MarketOption, UserBalance } from "@/lib/types"
import { useGetProposalById } from "@/hooks/use-get-proposalById"
import { useGetUserOrders } from "@/hooks/use-get-user-orders"
import { useCancelOrder } from "@/hooks/use-cancel-order"
import { toast } from "sonner"
import { useGetOrderbookOrders } from "@/hooks/use-get-orderbook-orders"
import { AuctionResolvedOnChain } from "@/components/resolution-view"
// import { useRouter } from "next/navigation"
import { getContractAddress } from "@/contracts/constants"

interface PageProps {
  params: { id: string }
}

function generateProposalData(id: string, hookProposal: any): Proposal {
  const zero = '0x0000000000000000000000000000000000000000'
  const now = Date.now()

  const pyUSD = getContractAddress(296, 'PYUSD')


  const auctionHistory = []
  for (let i = 24; i >= 0; i--) {
    auctionHistory.push({
      timestamp: now - i * 60 * 60 * 1000,
      yesPrice: 0.9 - (24 - i) * 0.02,
      noPrice: 0.85 - (24 - i) * 0.018,
    })
  }

  const twapHistory = []
  for (let i = 48; i >= 0; i--) {
    twapHistory.push({
      timestamp: now - i * 30 * 60 * 1000,
      yesTWAP: 0.55 + Math.random() * 0.1,
      noTWAP: 0.45 + Math.random() * 0.1,
    })
  }

  const volumeDistribution = Array.from({ length: 20 }, (_, i) => ({
    price: 0.4 + i * 0.02,
    buyVolume: 50 + Math.random() * 200,
    sellVolume: 50 + Math.random() * 200,
  }))

  return {
    id: hookProposal.id,
    admin: hookProposal.admin || zero,
    title: hookProposal.title || '',
    description: hookProposal.description || '',

    // state already matches the frontend `Proposal.state` union from the hook
    state: (hookProposal.state as 'Auction' | 'Live' | 'Resolved' | 'Cancelled') || 'Auction',
    // Auction / live times (seconds)
    auctionStartTime: Number(hookProposal.auctionStartTime || 0),
    auctionEndTime: Number(hookProposal.auctionEndTime || 0),
    liveStart: Number(hookProposal.liveStart || hookProposal.auctionEndTime || 0),
    liveEnd: Number(hookProposal.liveEnd || hookProposal.auctionEndTime || 0),
    liveDuration: Number(hookProposal.liveDuration || 0),

    // Token / treasury / auctions (use zero-address fallbacks)
    subjectToken: (hookProposal.subjectToken as `0x${string}`) || zero,
    minToOpen: hookProposal.minToOpen ? String(hookProposal.minToOpen) : '0',
    maxCap: hookProposal.maxCap ? String(hookProposal.maxCap) : '0',
    yesAuction: (hookProposal.yesAuction as `0x${string}`) || zero,
    noAuction: (hookProposal.noAuction as `0x${string}`) || zero,
    yesToken: (hookProposal.yesToken as `0x${string}`) || zero,
    noToken: (hookProposal.noToken as `0x${string}`) || zero,
    treasury: (hookProposal.treasury as `0x${string}`) || zero,

    // Execution target and calldata
    target: (hookProposal.target as `0x${string}`) || zero,
    data: hookProposal.data || '0x',

    // Proposal contract instance address
    proposalAddress: (hookProposal.proposalAddress as `0x${string}`) || zero,

    auctionData:
      hookProposal.state === "Auction" || hookProposal.state === "Cancelled"
        ? {
          yesCurrentPrice: 0.52,
          noCurrentPrice: 0.48,
          yesTotalBids: BigInt(hookProposal.state === "Cancelled" ? 5000000 : 15000000),
          noTotalBids: BigInt(hookProposal.state === "Cancelled" ? 3000000 : 12000000),
          minimumRequired: BigInt(10000000),
          auctionEndTime: BigInt(Math.floor((now + 1 * 24 * 60 * 60 * 1000) / 1000)),
          priceHistory: auctionHistory,
          yesRemainingMintable: BigInt(5000000000000000000000),
          noRemainingMintable: BigInt(5000000000000000000000)
        }
        : undefined,

    marketData:
      hookProposal.state === "Live" || hookProposal.state === "Resolved"
        ? {
          yesOrderBook: [],
          noOrderBook: [],
          twapHistory,
          // volumeDistribution,
        }
        : undefined,
  }
}

// Map backend order document -> frontend UserOrder
function mapBackendOrderToUserOrder(o: any): UserOrder {
  const statusMap: Record<string, UserOrder["status"]> = {
    open: "pending",
    partial: "pending",
    filled: "filled",
    cancelled: "cancelled",
  }
  return {
    id: String(o._id ?? o.id ?? ""),
    market: (o.side === "approve" ? "YES" : "NO"),
    type: (o.orderExecution === "market" ? "market" : "limit"),
    side: (o.orderType === "sell" ? "SELL" : "BUY"),
    price: typeof o.price === "number" ? o.price : Number(o.price ?? o.executedPrice ?? 0),
    amount: typeof o.amount === "number" ? o.amount : Number(o.amount ?? 0),
    filled: typeof o.filledAmount === "number" ? o.filledAmount : Number(o.filledAmount ?? 0),
    status: statusMap[o.status] ?? "pending",
    timestamp: o.createdAt ? new Date(o.createdAt).getTime() : Date.now(),
  }
}


export default function ProposalDetailPage({ params }: PageProps) {
  const { id } = params

  const chainId = useChainId()

  const { proposal: hookProposal, isLoading: hookLoading, error: hookError } = useGetProposalById(id)

  const [proposal, setProposal] = useState<Proposal | null>(null)
  const [userOrders, setUserOrders] = useState<UserOrder[]>([])
  const [userBalance, setUserBalance] = useState<UserBalance | null>(null)
  const [selectedMarket, setSelectedMarket] = useState<MarketOption>("YES")
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // Fetch authenticated user orders for this proposal (if user has authenticated)
  const { orders: rawUserOrders, error: userOrdersError, isLoading: userOrdersLoading, refetch: refetchUserOrders } = useGetUserOrders({ proposalId: id })

  const { cancelOrder, isLoading: cancellingOrder } = useCancelOrder()

  // Live public orderbook for selected market
  const { orders: liveOrderbook, refetch: refetchOrderbook } = useGetOrderbookOrders({ proposalId: id, market: selectedMarket, auto: true, pollMs: 3000 })

  useEffect(() => {
    if (!hookProposal) {
      setProposal(null)
      setError(hookError ? String(hookError) : null)
      setIsLoading(hookLoading)
      return
    }

    const proposalData = generateProposalData(id, hookProposal)

    setProposal(proposalData)
    setError(null)
    setIsLoading(hookLoading)
  }, [hookProposal, hookLoading, hookError])

  // Map hook orders -> UI orders
  useEffect(() => {
    if (!rawUserOrders || !Array.isArray(rawUserOrders)) {
      setUserOrders([])
      return
    }
    setUserOrders(rawUserOrders.map(mapBackendOrderToUserOrder))
  }, [rawUserOrders])

  const handleCancelOrder = async (orderId: string) => {
    const res = await cancelOrder(orderId)
    if (!res) {
      toast.error("Cancel failed")
      return
    }
    if (res.ok) {
      toast.success("Order cancelled")
      setUserOrders((prev) => prev.map((o) => (o.id === orderId ? { ...o, state: "cancelled" as const } : o)))
      void refetchUserOrders()
      void refetchOrderbook()
    } else {
      toast.error("Cancel failed", { description: res.data?.error || `state ${res.status}` })
    }
  }

  const isResolvedView = (proposal as any)?.state === "Resolved"

  if (isLoading) {
    return (
      <div className="container mx-auto px-4 py-12">
        <div className="grid lg:grid-cols-3 gap-8">
          <div className="lg:col-span-2 space-y-6">
            <Skeleton className="h-8 w-32" />
            <Skeleton className="h-12 w-full" />
            <Skeleton className="h-96 w-full" />
          </div>
          <div className="space-y-4">
            <Skeleton className="h-32 w-full" />
            <Skeleton className="h-64 w-full" />
          </div>
        </div>
      </div>
    )
  }

  if (error || !proposal) {
    return (
      <div className="container mx-auto px-4 py-12">
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>{error || "Proposal not found"}</AlertDescription>
        </Alert>
        <Button asChild className="mt-4">
          <Link href="/proposals" onClick={() => window.dispatchEvent(new CustomEvent('proposals:refresh'))}>Back to Proposals</Link>
        </Button>
      </div>
    )
  }

  return (
    <div className="container mx-auto px-4 py-12">
      {/* Removed blocking Connect Wallet dialog to allow full read-only view when disconnected */}
      {/*
      <Dialog open={showGuard && !isConnected} onOpenChange={setShowGuard}>
        <DialogContent showCloseButton className="bg-transparent border border-black/10 dark:border-white/20">
          <DialogHeader>
            <DialogTitle>Connect your wallet</DialogTitle>
            <DialogDescription>To view and interact with this proposal, please connect your wallet.</DialogDescription>
          </DialogHeader>
          <div className="flex items-center justify-center pt-2">
            <ConnectWalletButton onBeforeOpen={() => setShowGuard(false)} />
          </div>
        </DialogContent>
      </Dialog>
      */}

      <div className="grid lg:grid-cols-3 gap-6 items-start">
        <div className="lg:col-span-3">
          <ProposalHeader proposal={proposal} chainId={chainId} />
        </div>

        {isResolvedView ? (
          <div className="lg:col-span-3">
            <AuctionResolvedOnChain proposalAddress={(proposal as any).proposalAddress} />
          </div>
        ) : ((proposal as any).state === "Auction" || (proposal as any).state === "Cancelled") ? (
          <>
            <div className="lg:col-span-2 h-full">
              <div className="h-full">
                <AuctionView
                  mode="chart"
                  fullHeight
                  proposalAddress={(proposal as any).proposalAddress}
                  auctionData={(proposal as any).auctionData}
                  userBalance={(userBalance as any)}
                />
              </div>
            </div>
            <div className="lg:col-span-1 h-full">
              <div className="h-full">
                <AuctionTradePanel
                  fullHeight
                  proposalAddress={(proposal as any).proposalAddress}
                  auctionData={(proposal as any).auctionData}
                  isFailed={(proposal as any).state === "Cancelled"}
                />
              </div>
            </div>
            <div className="lg:col-span-2">
              <AuctionView
                mode="stats"
                proposalAddress={(proposal as any).proposalAddress}
                auctionData={(proposal as any).auctionData}
                userBalance={(userBalance as any)}
              />
            </div>
          </>
        ) : (
          (proposal as any).marketData && (
            <>
              <div className="lg:col-span-2">
                <MarketView
                  marketData={(proposal as any).marketData}
                  userOrders={userOrders}
                  selectedMarket={selectedMarket}
                  onMarketChange={setSelectedMarket}
                  onCancelOrder={handleCancelOrder}
                  userOrdersError={userOrdersError}
                  orderBookEntries={liveOrderbook}
                  proposalId={proposal.id}
                />
              </div>
              <div className="lg:col-span-1 space-y-4">
                <div className="hidden md:block">
                  <MarketPriceHeader proposalId={String(proposal.id)} />
                </div>
                <MarketTradePanel
                  selectedMarket={selectedMarket}
                  onMarketChange={setSelectedMarket}
                  proposalId={proposal.id}
                  onOrderPlaced={() => { refetchUserOrders(); refetchOrderbook(); }}
                />
                <MarketBalancesPanel proposalId={proposal.id} />
              </div>

            </>
          )
        )}
      </div>
    </div>
  )
}
