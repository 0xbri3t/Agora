"use client"

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { CheckCircle2, TrendingUp, Coins, Target, Shield, Clock } from "lucide-react"
import type { MarketOption } from "@/lib/types"
import { useAccount, useReadContract } from "wagmi"
import { useCallback, useMemo, useEffect, useState } from "react"
import { toast } from "sonner"
import { proposal_abi } from "@/contracts/proposal-abi"
import { marketToken_abi } from "@/contracts/marketToken-abi"
import { treasury_abi } from "@/contracts/treasury-abi"
import { ethers } from "ethers"
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine } from "recharts"

interface AuctionResolvedProps {
  winningMarket: MarketOption
  finalYesPrice: number
  finalNoPrice: number
  totalVolume: number
  userYesTokens: number
  userNoTokens: number
  onClaimWinnings: () => void
  onClaimLosingTokens: () => void
  canClaim: boolean
  // Optional, formatted values to show above the claim button
  userPyusdBalanceFormatted?: string
  claimablePyusdFormatted?: string
  userTreasuryPyusdFormatted?: string
}

export function AuctionResolved({
  winningMarket,
  finalYesPrice,
  finalNoPrice,
  totalVolume,
  userYesTokens,
  userNoTokens,
  onClaimWinnings,
  onClaimLosingTokens,
  canClaim,
  userPyusdBalanceFormatted,
  claimablePyusdFormatted,
  userTreasuryPyusdFormatted,
}: AuctionResolvedProps) {
  const [isClaiming, setIsClaiming] = useState(false)
  const losingMarket = winningMarket === "YES" ? "NO" : "YES"
  const winningPrice = winningMarket === "YES" ? finalYesPrice : finalNoPrice
  const losingPrice = winningMarket === "YES" ? finalNoPrice : finalYesPrice
  const userWinningTokens = winningMarket === "YES" ? userYesTokens : userNoTokens
  const userLosingTokens = winningMarket === "YES" ? userNoTokens : userYesTokens
  // Detect cancelled state (prop or context, aquí ejemplo por tokens = 0)
  const isCancelled = userYesTokens === 0 && userNoTokens === 0
  const outcomeLabel = isCancelled ? "Cancelled" : (winningMarket === "YES" ? "Approved" : "Rejected")
  const priceDiff = Math.abs(finalYesPrice - finalNoPrice)

  // Data for Butterfly Spread (flat segment at payoff -0.5 between midpoints)
  const butterflyData = [
    { price: winningPrice - priceDiff, payoff: -0.5 },
    { price: winningPrice - priceDiff / 2, payoff: -0.5 },
    { price: winningPrice, payoff: 2 },
    { price: winningPrice + priceDiff / 2, payoff: -0.5 },
    { price: winningPrice + priceDiff, payoff: -0.5 },
  ]

  // Reference line data for payoff = 0
  const zeroLineData = butterflyData.map((d) => ({ price: d.price, payoff: 0 }))

  return (
    <div className="space-y-6">
      {/* Final Results Header */}
      <Card className={isCancelled ? "border-red-500/50 bg-red-500/5 shadow-lg" : "border-green-500/50 bg-green-500/5 shadow-lg"}>
        <CardHeader className="text-center pb-4">
          <div className="flex justify-center mb-4">
            <div className={isCancelled ? "rounded-full bg-red-500/20 p-4" : "rounded-full bg-green-500/20 p-4"}>
              <CheckCircle2 className={isCancelled ? "h-12 w-12 text-red-600 dark:text-red-400" : "h-12 w-12 text-green-600 dark:text-green-400"} />
            </div>
          </div>
          <CardTitle className={isCancelled ? "text-3xl font-bold text-red-600 dark:text-red-400" : "text-3xl font-bold text-green-600 dark:text-green-400"}>
            {isCancelled ? "Market Cancelled" : "Market Resolved"}
          </CardTitle>
          <CardDescription className="text-lg mt-2">
            {isCancelled ? "This market was cancelled and no tokens can be claimed." : "The market has been settled and final results are available"}
          </CardDescription>
        </CardHeader>
      </Card>

      {/* Two-column layout: Left = Winning + Chart, Right = Losing + Summary */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-6">
          {/* Winning Market */}
          <Card className={isCancelled ? "border-red-500/50 shadow-md" : "border-green-500/50 shadow-md"}>
            <CardHeader>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <TrendingUp className={isCancelled ? "h-6 w-6 text-red-600 dark:text-red-400" : "h-6 w-6 text-green-600 dark:text-green-400"} />
                  <div>
                    <CardTitle className="text-2xl">{isCancelled ? "Market Status" : "Winning Market"}</CardTitle>
                    <CardDescription>{isCancelled ? "Market was cancelled" : "Final settlement details"}</CardDescription>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <Badge className={`text-white text-lg px-4 py-2 ${isCancelled ? 'bg-red-600 hover:bg-red-700' : (winningMarket === 'YES' ? 'bg-green-600 hover:bg-green-700' : 'bg-red-600 hover:bg-red-700')}`}>{outcomeLabel}</Badge>
                </div>
              </div>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="grid grid-cols-2 gap-6">
                <div className="space-y-2">
                  <p className="text-sm text-muted-foreground">Final Price</p>
                  <p className="text-3xl font-bold text-green-600 dark:text-green-400">${winningPrice.toFixed(4)}</p>
                </div>
                <div className="space-y-2">
                  <p className="text-sm text-muted-foreground">Total Volume</p>
                  <p className="text-3xl font-bold text-foreground">${totalVolume.toLocaleString()}</p>
                </div>
              </div>

              <div className="mb-4">
                <h3 className="text-xl font-bold mb-4 text-foreground">Butterfly Option Strategy</h3>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {/* Card 1: Real Skin in the Game */}
                  <div className="group relative overflow-hidden rounded-lg border border-border bg-gradient-to-br from-blue-500/10 via-background to-background p-6 transition-all duration-300 hover:shadow-lg hover:shadow-blue-500/20 hover:border-blue-500/50">
                    <div className="absolute inset-0 bg-gradient-to-br from-blue-500/5 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300" />
                    <div className="relative z-10">
                      <div className="flex items-start gap-3 mb-3">
                        <div className="rounded-full bg-blue-500/20 p-2 group-hover:bg-blue-500/30 transition-colors">
                          <Target className="h-5 w-5 text-blue-600 dark:text-blue-400" />
                        </div>
                        <h4 className="font-semibold text-base text-foreground">Real Skin in the Game</h4>
                      </div>
                      <p className="text-sm text-muted-foreground leading-relaxed">
                        Participants have genuine commitment when passing proposals through an option-based approach
                      </p>
                    </div>
                  </div>

                  {/* Card 2: Proportional Rewards */}
                  <div className="group relative overflow-hidden rounded-lg border border-border bg-gradient-to-br from-green-500/10 via-background to-background p-6 transition-all duration-300 hover:shadow-lg hover:shadow-green-500/20 hover:border-green-500/50">
                    <div className="absolute inset-0 bg-gradient-to-br from-green-500/5 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300" />
                    <div className="relative z-10">
                      <div className="flex items-start gap-3 mb-3">
                        <div className="rounded-full bg-green-500/20 p-2 group-hover:bg-green-500/30 transition-colors">
                          <TrendingUp className="h-5 w-5 text-green-600 dark:text-green-400" />
                        </div>
                        <h4 className="font-semibold text-base text-foreground">Proportional Rewards</h4>
                      </div>
                      <p className="text-sm text-muted-foreground leading-relaxed">
                        Users are rewarded based on how close their prediction is to the actual spot price
                      </p>
                    </div>
                  </div>

                  {/* Card 3: Limited Downside Risk */}
                  <div className="group relative overflow-hidden rounded-lg border border-border bg-gradient-to-br from-amber-500/10 via-background to-background p-6 transition-all duration-300 hover:shadow-lg hover:shadow-amber-500/20 hover:border-amber-500/50">
                    <div className="absolute inset-0 bg-gradient-to-br from-amber-500/5 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300" />
                    <div className="relative z-10">
                      <div className="flex items-start gap-3 mb-3">
                        <div className="rounded-full bg-amber-500/20 p-2 group-hover:bg-amber-500/30 transition-colors">
                          <Shield className="h-5 w-5 text-amber-600 dark:text-amber-400" />
                        </div>
                        <h4 className="font-semibold text-base text-foreground">Limited Downside Risk</h4>
                      </div>
                      <p className="text-sm text-muted-foreground leading-relaxed">
                        Premium-based betting reflects true conviction while protecting participants from unlimited losses
                      </p>
                    </div>
                  </div>

                  {/* Card 4: Flexible Exercise */}
                  <div className="group relative overflow-hidden rounded-lg border border-border bg-gradient-to-br from-orange-500/10 via-background to-background p-6 transition-all duration-300 hover:shadow-lg hover:shadow-orange-500/20 hover:border-orange-500/50">
                    <div className="absolute inset-0 bg-gradient-to-br from-orange-500/5 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300" />
                    <div className="relative z-10">
                      <div className="flex items-start gap-3 mb-3">
                        <div className="rounded-full bg-orange-500/20 p-2 group-hover:bg-orange-500/30 transition-colors">
                          <Clock className="h-5 w-5 text-orange-600 dark:text-orange-400" />
                        </div>
                        <h4 className="font-semibold text-base text-foreground">Flexible Exercise</h4>
                      </div>
                      <p className="text-sm text-muted-foreground leading-relaxed">
                        Short-term options can be exercised at any moment, giving users control over their exposure
                      </p>
                    </div>
                  </div>
                </div>
              </div>

              {/* Butterfly Spread Chart */}
              <div className="flex justify-center items-center mt-10" style={{ minHeight: '420px' }}>
                <ResponsiveContainer width="100%" height={380}>
                  <LineChart data={butterflyData}>
                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(0,0,0,0.08)" />
                    <XAxis dataKey="price" />
                    <YAxis domain={[-1.5, 2.5]} />
                    <Tooltip
                      formatter={(value: number) => {
                        if (value > 0) return `$${(value * winningPrice).toFixed(2)}`
                        if (value < 0) return `$${(Math.abs(value) * 1.5 * winningPrice).toFixed(2)}`
                        if (value === 0) return `$${winningPrice.toFixed(2)}`
                      }}
                    />

                    <Line type="linear" dataKey="payoff" stroke="#22c55e" strokeWidth={2} dot={{ r: 4 }} />

                    <Line
                      type="linear"
                      dataKey="payoff"
                      data={zeroLineData}
                      stroke="#ef4444"
                      strokeDasharray="4 2"
                      dot={false}
                    />

                    <ReferenceLine
                      y={10}
                      stroke="#f59e0b"
                      strokeDasharray="3 3"
                      label={{ value: "Start +10", position: "top" }}
                    />
                  </LineChart>
                </ResponsiveContainer>
              </div>


              {userWinningTokens > 0 && false && (
                <div className="pt-4 border-t border-border">
                  <div className="flex items-center justify-between mb-4">
                    <div>
                      <p className="text-sm text-muted-foreground">Your Winning Tokens</p>
                      <p className="text-2xl font-bold text-green-600 dark:text-green-400">
                        {userWinningTokens.toFixed(2)} {winningMarket}
                      </p>
                      <p className="text-sm text-muted-foreground mt-1">
                        Value: ${(userWinningTokens * winningPrice).toFixed(2)}
                      </p>
                    </div>
                    <Coins className="h-8 w-8 text-green-600 dark:text-green-400" />
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Right column: Losing Market + Market Summary */}
        <div className="lg:col-span-1 space-y-6">
          {/* Losing Market */}
          <Card className="border-border/50 shadow-md">
            <CardHeader>
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle className="text-xl">Losing Market</CardTitle>
                  <CardDescription>Reclaim your PYUSD tokens from the losing side</CardDescription>
                </div>
                <Badge variant="outline" className="text-lg px-4 py-2">
                  {losingMarket}
                </Badge>
              </div>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="grid grid-cols-2 gap-6">
                <div className="space-y-2">
                  <p className="text-sm text-muted-foreground">Final Price</p>
                  <p className="text-2xl font-semibold text-muted-foreground">${losingPrice.toFixed(4)}</p>
                </div>
              </div>
                <div className="pt-4 border-t border-border">
                  <div className="flex items-center justify-between mb-4">
                    <div>
                      <p className="text-sm text-muted-foreground">Your Tokens</p>
                      <p className="text-xl font-semibold text-foreground">
                        {userLosingTokens.toFixed(2)} t{losingMarket}
                      </p>
                      <p className="text-xs text-muted-foreground mt-1">These tokens can be reclaimed</p>
                    </div>
                    <Coins className="h-6 w-6 text-muted-foreground" />
                  </div>
                  <div className="mb-4 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-2 gap-3">
                    {userTreasuryPyusdFormatted && (
                      <div className="rounded-md border bg-muted/30 p-3">
                        <p className="text-xs text-muted-foreground">Your total PYUSD in Treasury</p>
                        <p className="text-lg font-semibold">${Number(userTreasuryPyusdFormatted).toLocaleString(undefined, { maximumFractionDigits: 6 })}</p>
                      </div>
                    )}
                    {claimablePyusdFormatted && (
                      <div className="rounded-md border bg-emerald-500/5 p-3">
                        <p className="text-xs text-muted-foreground">Claim PYUSD from loser token</p>
                        <p className="text-lg font-semibold text-emerald-600 dark:text-emerald-400">
                          ${Number(claimablePyusdFormatted).toLocaleString(undefined, { maximumFractionDigits: 6 })}
                        </p>
                      </div>
                    )}
                  </div>
                  {/* User PYUSD balance as plain text between claimable and button */}
                  {userPyusdBalanceFormatted && (
                    <p className="text-sm text-muted-foreground mb-2">Your PYUSD balance: <span className="font-semibold">${Number(userPyusdBalanceFormatted).toLocaleString(undefined, { maximumFractionDigits: 6 })}</span></p>
                  )}
                  <Button
                    onClick={async () => {
                      if (!canClaim || isClaiming) return
                      try {
                        setIsClaiming(true)
                        await Promise.resolve(onClaimLosingTokens())
                      } finally {
                        setIsClaiming(false)
                      }
                    }}
                    className={[
                      "w-full text-base py-5",
                      "rounded-md text-white",
                      "bg-gradient-to-b from-emerald-500 to-emerald-600",
                      "shadow ring-1 ring-emerald-400/40",
                      "transition-all duration-200",
                      "hover:from-emerald-500/90 hover:to-emerald-600/90 hover:shadow-lg hover:shadow-emerald-500/20",
                      "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400",
                      "disabled:opacity-50 disabled:cursor-not-allowed",
                    ].join(" ")}
                    size="lg"
                    disabled={!canClaim || isClaiming}
                  >
                    <Coins className="mr-2 h-4 w-4" />
                    {isClaiming ? "Claiming..." : "Claim PYUSD tokens"}
                  </Button>
                </div>
            </CardContent>
          </Card>

          {/* Market Summary */}
          <Card className="border-border/50">
            <CardHeader>
              <CardTitle>Market Summary</CardTitle>
              <CardDescription>Final statistics for this prediction market</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-1">
                  <p className="text-sm text-muted-foreground">YES Final Price</p>
                  <p className="text-xl font-semibold">${finalYesPrice.toFixed(4)}</p>
                </div>
                <div className="space-y-1">
                  <p className="text-sm text-muted-foreground">NO Final Price</p>
                  <p className="text-xl font-semibold">${finalNoPrice.toFixed(4)}</p>
                </div>
                <div className="space-y-1">
                  <p className="text-sm text-muted-foreground">Price Difference (YES - NO)</p>
                  <p className="text-xl font-semibold">${priceDiff.toFixed(4)}</p>
                </div>
                <div className="space-y-1">
                  <p className="text-sm text-muted-foreground">Total Volume</p>
                  <p className="text-xl font-semibold">${totalVolume.toLocaleString()}</p>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  )
}

// ------------------------ AuctionResolvedOnChain ------------------------

export function AuctionResolvedOnChain({ proposalAddress }: { proposalAddress: `0x${string}` }) {
  const { address: user, isConnected, status } = useAccount()
  const ZERO = "0x0000000000000000000000000000000000000000" as const

  const { data: yesTokenAddr } = useReadContract({
    address: proposalAddress,
    abi: proposal_abi,
    functionName: "yesToken",
  })
  const { data: noTokenAddr } = useReadContract({
    address: proposalAddress,
    abi: proposal_abi,
    functionName: "noToken",
  })
  const { data: treasuryAddr } = useReadContract({
    address: proposalAddress,
    abi: proposal_abi,
    functionName: "treasury",
  })
  const { data: twapYes } = useReadContract({
    address: proposalAddress,
    abi: proposal_abi,
    functionName: "twapPriceTokenYes",
  })
  const { data: twapNo } = useReadContract({
    address: proposalAddress,
    abi: proposal_abi,
    functionName: "twapPriceTokenNo",
  })
  const { data: pyUSDAddr } = useReadContract({
    address: proposalAddress,
    abi: proposal_abi,
    functionName: "pyUSD",
  })

  const yesToken = yesTokenAddr as `0x${string}` | undefined
  const noToken = noTokenAddr as `0x${string}` | undefined
  const treasury = treasuryAddr as `0x${string}` | undefined

  const canReadTokens = !!yesToken && !!noToken
  const canReadTreasury = !!treasury
  const pyUSD = pyUSDAddr as `0x${string}` | undefined

  const { data: yesRedeemer } = useReadContract({
    address: yesToken!,
    abi: marketToken_abi,
    functionName: "redeemer",
    query: { enabled: canReadTokens },
  })
  const { data: noRedeemer } = useReadContract({
    address: noToken!,
    abi: marketToken_abi,
    functionName: "redeemer",
    query: { enabled: canReadTokens },
  })
  const { data: yesBal, refetch: refetchYesBal } = useReadContract({
    address: yesToken!,
    abi: marketToken_abi,
    functionName: "balanceOf",
    args: [user ?? ZERO],
    query: { enabled: canReadTokens && !!user },
  })
  const { data: noBal, refetch: refetchNoBal } = useReadContract({
    address: noToken!,
    abi: marketToken_abi,
    functionName: "balanceOf",
    args: [user ?? ZERO],
    query: { enabled: canReadTokens && !!user },
  })
  // Read total supplies for claimable computation
  const { data: yesSupply } = useReadContract({
    address: yesToken!,
    abi: marketToken_abi,
    functionName: "totalSupply",
    query: { enabled: canReadTokens },
  })
  const { data: noSupply } = useReadContract({
    address: noToken!,
    abi: marketToken_abi,
    functionName: "totalSupply",
    query: { enabled: canReadTokens },
  })
  const { data: potYes } = useReadContract({
    address: treasury!,
    abi: treasury_abi,
    functionName: "potYes",
    query: { enabled: canReadTreasury },
  })
  const { data: potNo } = useReadContract({
    address: treasury!,
    abi: treasury_abi,
    functionName: "potNo",
    query: { enabled: canReadTreasury },
  })
  const { data: refundsEnabled } = useReadContract({
    address: treasury!,
    abi: treasury_abi,
    functionName: "refundsEnabled",
    query: { enabled: canReadTreasury },
  })
  // PYUSD wallet balance and decimals
  const { data: userPyUSDBal, refetch: refetchUserPyUSDBal } = useReadContract({
    address: pyUSD!,
    abi: marketToken_abi,
    functionName: "balanceOf",
    args: [user ?? ZERO],
    query: { enabled: !!pyUSD && !!user },
  })
  const { data: pyUSDDecimals } = useReadContract({
    address: pyUSD!,
    abi: marketToken_abi,
    functionName: "decimals",
    query: { enabled: !!pyUSD },
  })

  const yesLost = useMemo(() => !!yesRedeemer && (yesRedeemer as string) !== ZERO, [yesRedeemer])
  const noLost = useMemo(() => !!noRedeemer && (noRedeemer as string) !== ZERO, [noRedeemer])

  const winningMarket: MarketOption = useMemo(() => {
    if (yesLost && !noLost) return "NO"
    if (noLost && !yesLost) return "YES"
    return "YES"
  }, [yesLost, noLost])

  const finalYesPrice = Number((twapYes as bigint) ?? 0n) / 1e6
  const finalNoPrice = Number((twapNo as bigint) ?? 0n) / 1e6
  const totalVolume = (Number((potYes as bigint) ?? 0n) + Number((potNo as bigint) ?? 0n)) / 1e6
  const userYesTokens = Number((yesBal as bigint) ?? 0n) / 1e18
  const userNoTokens = Number((noBal as bigint) ?? 0n) / 1e18
  // Compute claimable PYUSD from losing pot proportionally
  const losingSupply = (winningMarket === "YES" ? (noSupply as bigint | undefined) : (yesSupply as bigint | undefined)) ?? 0n
  const userLosingBalBig = (winningMarket === "YES" ? (noBal as bigint | undefined) : (yesBal as bigint | undefined)) ?? 0n
  const potLost = (winningMarket === "YES" ? (potNo as bigint | undefined) : (potYes as bigint | undefined)) ?? 0n
  const claimablePYUSDBig = losingSupply > 0n ? (userLosingBalBig * potLost) / losingSupply : 0n
  const pydec = typeof pyUSDDecimals === 'number' ? pyUSDDecimals : Number(pyUSDDecimals ?? 6)
  // User's theoretical PYUSD share in Treasury across both pots
  const yesSupplyBig = (yesSupply as bigint | undefined) ?? 0n
  const noSupplyBig = (noSupply as bigint | undefined) ?? 0n
  const userYesBalBig = (yesBal as bigint | undefined) ?? 0n
  const userNoBalBig = (noBal as bigint | undefined) ?? 0n
  const potYesBig = (potYes as bigint | undefined) ?? 0n
  const potNoBig = (potNo as bigint | undefined) ?? 0n
  const shareYesBig = yesSupplyBig > 0n ? (userYesBalBig * potYesBig) / yesSupplyBig : 0n
  const shareNoBig = noSupplyBig > 0n ? (userNoBalBig * potNoBig) / noSupplyBig : 0n
  const totalTreasuryShareBig = shareYesBig + shareNoBig
  const userTreasuryPyusdFormatted = ethers.formatUnits(totalTreasuryShareBig, pydec)
  const userPyusdBalanceFormatted = ethers.formatUnits((userPyUSDBal as bigint) ?? 0n, pydec)
  const claimablePyusdFormatted = ethers.formatUnits(claimablePYUSDBig, pydec)

  // Ready when wallet connected and on-chain flags/addresses are available and refunds are enabled
  const isReady = isConnected && canReadTokens && canReadTreasury && (refundsEnabled === true)

  const onClaimLosingTokens = useCallback(async () => {
    if (!isReady) {
      toast.message("Initializing wallet...", { description: "Please wait a moment" })
      return
    }
    if (!isConnected) {
      toast.error("Connect wallet")
      return
    }
    if (!refundsEnabled) {
      toast.error("Refunds not enabled yet")
      return
    }

    const losingToken = winningMarket === "YES" ? noToken : yesToken
    const losingBal = (winningMarket === "YES" ? (noBal as bigint) : (yesBal as bigint)) ?? 0n

    if (!losingToken) return
    if (losingBal === 0n) {
      toast.error("No tokens to redeem")
      return
    }

    try {
      const anyWindow = window as any
      if (!anyWindow?.ethereum) throw new Error("No wallet found")
      const provider = new ethers.BrowserProvider(anyWindow.ethereum)
      const signer = await provider.getSigner()

      // 1) Ensure allowance for Treasury to pull losing tokens
      if (!treasury) throw new Error("Treasury not available")
      const losingTokenContract = new ethers.Contract(losingToken, marketToken_abi as any, signer)
      const userAddr = await signer.getAddress()
      const currentAllowance: bigint = await losingTokenContract.allowance(userAddr, treasury)

      if (currentAllowance < losingBal) {
        const approveTx = await losingTokenContract.approve(treasury, losingBal)
        toast.message("Approving losing tokens...", { description: approveTx.hash })
        const approveRcpt = await approveTx.wait()
        if (!approveRcpt || (approveRcpt.status !== 1n && approveRcpt.status !== 1)) throw new Error("Approval failed")
      }

      // 2) Call Proposal.claimTokens to receive remaining PYUSD
      const proposalContract = new ethers.Contract(proposalAddress, proposal_abi as any, signer)
      const tx = await proposalContract.claimTokens(losingToken)
      toast.message("Claiming PYUSD...", { description: tx.hash })
      const rcpt = await tx.wait()
      if (!rcpt || (rcpt.status !== 1n && rcpt.status !== 1)) throw new Error("Transaction failed")
      toast.success("Claim successful")

      // Refresh balances so UI reflects the claim
      try {
        await Promise.allSettled([
          typeof refetchYesBal === 'function' ? refetchYesBal() : Promise.resolve(null),
          typeof refetchNoBal === 'function' ? refetchNoBal() : Promise.resolve(null),
          typeof refetchUserPyUSDBal === 'function' ? refetchUserPyUSDBal() : Promise.resolve(null),
        ])
      } catch {}
    } catch (e: any) {
      toast.error("Claim failed", { description: e?.shortMessage || e?.message })
    }
  }, [isReady, isConnected, refundsEnabled, winningMarket, yesToken, noToken, proposalAddress, yesBal, noBal, treasury, refetchYesBal, refetchNoBal])

  const onClaimWinnings = useCallback(() => {
    toast.info("Winner tokens remain in your wallet. No claim required.")
  }, [])

  return (
    <AuctionResolved
      winningMarket={winningMarket}
      finalYesPrice={finalYesPrice}
      finalNoPrice={finalNoPrice}
      totalVolume={totalVolume}
      userYesTokens={userYesTokens}
      userNoTokens={userNoTokens}
      onClaimWinnings={onClaimWinnings}
      onClaimLosingTokens={onClaimLosingTokens}
      canClaim={isReady}
      userPyusdBalanceFormatted={userPyusdBalanceFormatted}
      claimablePyusdFormatted={claimablePyusdFormatted}
      userTreasuryPyusdFormatted={userTreasuryPyusdFormatted}
    />
  )
}
