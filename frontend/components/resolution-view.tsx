"use client"

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import type { MarketOption } from "@/lib/types"
import { useAccount, useReadContract, useConfig } from "wagmi"
import { useCallback, useMemo, useState } from "react"
import { toast } from "sonner"
import { proposal_abi } from "@/contracts/proposal-abi"
import { marketToken_abi } from "@/contracts/marketToken-abi"
import { treasury_abi } from "@/contracts/treasury-abi"
import { ethers } from "ethers"
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine } from "recharts"
import { getEthersSigner } from "@/lib/signer"

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
  userCollateralBalanceFormatted?: string
  claimableCollateralFormatted?: string
  userTreasuryCollateralFormatted?: string
}

const INK = "var(--foreground)"
const UP = "var(--data-up)"
const DOWN = "var(--destructive)"

const fmt = (n: number, d = 2) =>
  n.toLocaleString(undefined, { minimumFractionDigits: d, maximumFractionDigits: d })

export function AuctionResolved({
  winningMarket,
  finalYesPrice,
  finalNoPrice,
  totalVolume,
  userYesTokens,
  userNoTokens,
  onClaimLosingTokens,
  canClaim,
  userCollateralBalanceFormatted,
  claimableCollateralFormatted,
  userTreasuryCollateralFormatted,
}: AuctionResolvedProps) {
  const [isClaiming, setIsClaiming] = useState(false)
  const losingMarket = winningMarket === "YES" ? "NO" : "YES"
  const winningPrice = winningMarket === "YES" ? finalYesPrice : finalNoPrice
  const priceDiff = Math.abs(finalYesPrice - finalNoPrice)
  const userLosingTokens = winningMarket === "YES" ? userNoTokens : userYesTokens
  const winColor = winningMarket === "YES" ? UP : DOWN

  // Butterfly payoff centered on the winning TWAP. The payout window is
  // ±10% of the winning forecast (protocol width parameter), so the axis
  // stays in the price neighborhood that settlement actually pays.
  const wing = Math.max(winningPrice * 0.1, 0.01)
  const butterflyData = [
    { price: winningPrice - wing * 1.4, payoff: 0 },
    { price: winningPrice - wing, payoff: 0 },
    { price: winningPrice, payoff: 1 },
    { price: winningPrice + wing, payoff: 0 },
    { price: winningPrice + wing * 1.4, payoff: 0 },
  ]

  return (
    <div className="space-y-6">
      {/* Verdict */}
      <Card>
        <CardContent className="flex flex-col gap-6 py-6 md:flex-row md:items-center md:justify-between">
          <div className="space-y-1.5">
            <h2 className="font-display text-4xl text-foreground">
              <span style={{ color: winColor }}>{winningMarket}</span> wins
            </h2>
            <p className="max-w-md text-sm text-muted-foreground">
              The {winningMarket} market held the stronger TWAP. Winners keep
              their tokens; the {losingMarket} side reclaims its USDC pro rata.
            </p>
          </div>
          <div className="flex items-end gap-8">
            <div>
              <p className="text-xs text-muted-foreground">TWAP YES</p>
              <p
                className="font-mono text-2xl tabular-nums"
                style={{ color: winningMarket === "YES" ? UP : undefined, opacity: winningMarket === "YES" ? 1 : 0.55 }}
              >
                ${fmt(finalYesPrice)}
              </p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">TWAP NO</p>
              <p
                className="font-mono text-2xl tabular-nums"
                style={{ color: winningMarket === "NO" ? DOWN : undefined, opacity: winningMarket === "NO" ? 1 : 0.55 }}
              >
                ${fmt(finalNoPrice)}
              </p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Margin</p>
              <p className="font-mono text-2xl tabular-nums text-foreground">${fmt(priceDiff)}</p>
            </div>
          </div>
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3 items-start">
        {/* Butterfly settlement */}
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Butterfly settlement</CardTitle>
            <CardDescription>
              Winner tokens settle as butterfly options. The x-axis is the asset&apos;s
              possible spot price at expiry: payout peaks if it lands exactly on the
              winning forecast of ${fmt(winningPrice)} and fades to zero ±10% away.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {winningPrice <= 0 ? (
              <div className="flex h-56 items-center justify-center font-mono text-sm text-muted-foreground">
                settlement chart unavailable — no TWAP recorded for this market
              </div>
            ) : (
            <div className="h-56">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={butterflyData} margin={{ top: 24, right: 16, bottom: 4, left: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke={INK} opacity={0.15} />
                  <XAxis
                    dataKey="price"
                    type="number"
                    domain={["dataMin", "dataMax"]}
                    tickFormatter={(v: number) => `$${fmt(v)}`}
                    stroke={INK}
                    fontSize={11}
                    tick={{ fill: INK, opacity: 0.7 }}
                  />
                  <YAxis
                    domain={[0, 1.15]}
                    ticks={[0, 0.5, 1]}
                    tickFormatter={(v: number) => (v === 1 ? "max" : v === 0 ? "0" : "")}
                    stroke={INK}
                    fontSize={11}
                    tick={{ fill: INK, opacity: 0.7 }}
                    width={40}
                  />
                  <Tooltip
                    contentStyle={{
                      backgroundColor: "rgba(0,0,0,0.8)",
                      border: "1px solid rgba(255,255,255,0.2)",
                      borderRadius: "4px",
                      color: "#fff",
                    }}
                    formatter={(value: number) => [`${Math.round(value * 100)}% of max payout`, ""]}
                    labelFormatter={(label: number) => `spot $${fmt(Number(label))}`}
                  />
                  <ReferenceLine
                    x={winningPrice}
                    stroke={winColor}
                    strokeDasharray="4 4"
                    label={{ value: `winning TWAP $${fmt(winningPrice)}`, position: "insideTopLeft", fill: INK, fontSize: 10, opacity: 0.8, dy: -18 }}
                  />
                  <Line
                    type="linear"
                    dataKey="payoff"
                    stroke={winColor}
                    strokeWidth={2}
                    dot={false}
                    isAnimationActive={false}
                  />
                </LineChart>
              </ResponsiveContainer>
            </div>
            )}
            <p className="mt-3 font-mono text-xs text-muted-foreground">
              payout window ±10% around the forecast · settles against the reference price at expiry
            </p>
          </CardContent>
        </Card>

        {/* Your position */}
        <Card>
          <CardHeader>
            <CardTitle>Your position</CardTitle>
            <CardDescription>Balances and what you can claim</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <dl className="space-y-2.5 font-mono text-sm tabular-nums">
              <div className="flex items-baseline justify-between">
                <dt className="text-muted-foreground">tYES held</dt>
                <dd className="text-foreground">{fmt(userYesTokens)}</dd>
              </div>
              <div className="flex items-baseline justify-between">
                <dt className="text-muted-foreground">tNO held</dt>
                <dd className="text-foreground">{fmt(userNoTokens)}</dd>
              </div>
              {userTreasuryCollateralFormatted && (
                <div className="flex items-baseline justify-between">
                  <dt className="text-muted-foreground">Treasury share</dt>
                  <dd className="text-foreground">${fmt(Number(userTreasuryCollateralFormatted))}</dd>
                </div>
              )}
              <div className="flex items-baseline justify-between border-t border-border pt-2.5">
                <dt className="text-muted-foreground">Claimable ({losingMarket} side)</dt>
                <dd style={{ color: UP }}>
                  ${fmt(Number(claimableCollateralFormatted ?? 0))}
                </dd>
              </div>
              {userCollateralBalanceFormatted && (
                <div className="flex items-baseline justify-between">
                  <dt className="text-muted-foreground">Wallet USDC</dt>
                  <dd className="text-foreground">${fmt(Number(userCollateralBalanceFormatted))}</dd>
                </div>
              )}
            </dl>
            <Button
              className="w-full"
              size="lg"
              disabled={!canClaim || isClaiming || userLosingTokens <= 0}
              onClick={async () => {
                if (!canClaim || isClaiming) return
                try {
                  setIsClaiming(true)
                  await Promise.resolve(onClaimLosingTokens())
                } finally {
                  setIsClaiming(false)
                }
              }}
            >
              {isClaiming ? "Claiming…" : `Claim USDC from ${losingMarket} tokens`}
            </Button>
            {userLosingTokens <= 0 && (
              <p className="text-xs text-muted-foreground">
                Nothing to claim — you hold no {losingMarket} tokens.
              </p>
            )}
            {winningMarket && (userYesTokens > 0 || userNoTokens > 0) && (
              <p className="text-xs text-muted-foreground">
                {winningMarket === "YES" ? userYesTokens : userNoTokens} t{winningMarket} stay in your
                wallet and settle as butterflies at expiry.
              </p>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Summary strip */}
      <div className="flex flex-wrap items-center gap-x-8 gap-y-2 border-y border-border py-3 font-mono text-xs tabular-nums text-muted-foreground">
        <span>YES ${fmt(finalYesPrice)}</span>
        <span>NO ${fmt(finalNoPrice)}</span>
        <span>margin ${fmt(priceDiff)}</span>
        <span>volume ${fmt(totalVolume, 0)}</span>
        <span style={{ color: winColor }}>{winningMarket} executed</span>
      </div>
    </div>
  )
}

// ------------------------ AuctionResolvedOnChain ------------------------

export function AuctionResolvedOnChain({ proposalAddress }: { proposalAddress: `0x${string}` }) {
  const config = useConfig()
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
  const { data: collateralAddr } = useReadContract({
    address: proposalAddress,
    abi: proposal_abi,
    functionName: "collateral",
  })

  const yesToken = yesTokenAddr as `0x${string}` | undefined
  const noToken = noTokenAddr as `0x${string}` | undefined
  const treasury = treasuryAddr as `0x${string}` | undefined

  const canReadTokens = !!yesToken && !!noToken
  const canReadTreasury = !!treasury
  const collateral = collateralAddr as `0x${string}` | undefined

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
  // USDC wallet balance and decimals
  const { data: userCollateralBal, refetch: refetchUserCollateralBal } = useReadContract({
    address: collateral!,
    abi: marketToken_abi,
    functionName: "balanceOf",
    args: [user ?? ZERO],
    query: { enabled: !!collateral && !!user },
  })
  const { data: collateralDecimals } = useReadContract({
    address: collateral!,
    abi: marketToken_abi,
    functionName: "decimals",
    query: { enabled: !!collateral },
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
  // Compute claimable USDC from losing pot proportionally
  const losingSupply = (winningMarket === "YES" ? (noSupply as bigint | undefined) : (yesSupply as bigint | undefined)) ?? 0n
  const userLosingBalBig = (winningMarket === "YES" ? (noBal as bigint | undefined) : (yesBal as bigint | undefined)) ?? 0n
  const potLost = (winningMarket === "YES" ? (potNo as bigint | undefined) : (potYes as bigint | undefined)) ?? 0n
  const claimableUSDCBig = losingSupply > 0n ? (userLosingBalBig * potLost) / losingSupply : 0n
  const pydec = typeof collateralDecimals === 'number' ? collateralDecimals : Number(collateralDecimals ?? 6)
  // User's theoretical USDC share in Treasury across both pots
  const yesSupplyBig = (yesSupply as bigint | undefined) ?? 0n
  const noSupplyBig = (noSupply as bigint | undefined) ?? 0n
  const userYesBalBig = (yesBal as bigint | undefined) ?? 0n
  const userNoBalBig = (noBal as bigint | undefined) ?? 0n
  const potYesBig = (potYes as bigint | undefined) ?? 0n
  const potNoBig = (potNo as bigint | undefined) ?? 0n
  const shareYesBig = yesSupplyBig > 0n ? (userYesBalBig * potYesBig) / yesSupplyBig : 0n
  const shareNoBig = noSupplyBig > 0n ? (userNoBalBig * potNoBig) / noSupplyBig : 0n
  const totalTreasuryShareBig = shareYesBig + shareNoBig
  const userTreasuryCollateralFormatted = ethers.formatUnits(totalTreasuryShareBig, pydec)
  const userCollateralBalanceFormatted = ethers.formatUnits((userCollateralBal as bigint) ?? 0n, pydec)
  const claimableCollateralFormatted = ethers.formatUnits(claimableUSDCBig, pydec)

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
      const signer = await getEthersSigner(config)

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

      // 2) Call Proposal.claimTokens to receive remaining USDC
      const proposalContract = new ethers.Contract(proposalAddress, proposal_abi as any, signer)
      const tx = await proposalContract.claimTokens(losingToken)
      toast.message("Claiming USDC...", { description: tx.hash })
      const rcpt = await tx.wait()
      if (!rcpt || (rcpt.status !== 1n && rcpt.status !== 1)) throw new Error("Transaction failed")
      toast.success("Claim successful")

      // Refresh balances so UI reflects the claim
      try {
        await Promise.allSettled([
          typeof refetchYesBal === 'function' ? refetchYesBal() : Promise.resolve(null),
          typeof refetchNoBal === 'function' ? refetchNoBal() : Promise.resolve(null),
          typeof refetchUserCollateralBal === 'function' ? refetchUserCollateralBal() : Promise.resolve(null),
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
      userCollateralBalanceFormatted={userCollateralBalanceFormatted}
      claimableCollateralFormatted={claimableCollateralFormatted}
      userTreasuryCollateralFormatted={userTreasuryCollateralFormatted}
    />
  )
}
