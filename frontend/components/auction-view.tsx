"use client"

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Progress } from "@/components/ui/progress"
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Dot } from "recharts"
import type { AuctionData, UserBalance } from "@/lib/types"
import { formatUnits } from "viem"
import { useEffect, useMemo, useState, useCallback, use } from "react"
import { Clock } from "lucide-react"
import { useTheme } from "next-themes"
import { useAccount, useReadContract, usePublicClient } from "wagmi"
import { proposal_abi } from "@/contracts/proposal-abi"
import { marketToken_abi } from "@/contracts/marketToken-abi"
import { dutchAuction_abi } from "@/contracts/dutchAuction-abi"
import { treasury_abi } from "@/contracts/treasury-abi"
import { ProposalStatus } from "@/lib/types"


interface AuctionViewProps {
  auctionData: AuctionData
  userBalance: UserBalance
  proposalAddress?: `0x${string}`
  // Render mode: full (default), only chart card, or only stats section
  mode?: "full" | "chart" | "stats"
  // When showing chart, allow the chart card to stretch to fill available height
  fullHeight?: boolean
}

const AnimatedDot = (props: any) => {
  const { cx, cy, color } = props
  return (
    <g>
      <circle cx={cx} cy={cy} r={8} fill={color} className="animate-pulse" opacity={0.6} />
      <circle cx={cx} cy={cy} r={5} fill={color} />
      <circle cx={cx} cy={cy} r={2} fill="hsl(var(--background))" />
    </g>
  )
}
function useCountdown(endTime: bigint | number, nowOverride?: number) {
  const [timeLeft, setTimeLeft] = useState({ days: 0, hours: 0, minutes: 0, seconds: 0 })

  useEffect(() => {
    const calculateTimeLeft = () => {
      let endSec = Number(endTime)
      // If it's a timestamp in milliseconds, convert to seconds
      if (endSec > 1e12) endSec = Math.floor(endSec / 1000)

      // Derive current time from Date.now() each tick and apply drift from chain time if provided
      const clientNowSec = Math.floor(Date.now() / 1000)
      const chainNowSec = typeof nowOverride === 'number'
        ? (nowOverride > 1e12 ? Math.floor(nowOverride / 1000) : Math.floor(nowOverride))
        : clientNowSec
      const drift = chainNowSec - clientNowSec
      const nowSec = clientNowSec + drift

      const diff = endSec - nowSec

      if (diff > 0) {
        const days = Math.floor(diff / (60 * 60 * 24))
        const hours = Math.floor((diff % (60 * 60 * 24)) / (60 * 60))
        const minutes = Math.floor((diff % (60 * 60)) / 60)
        const seconds = diff % 60
        setTimeLeft({ days, hours, minutes, seconds })
      } else {
        setTimeLeft({ days: 0, hours: 0, minutes: 0, seconds: 0 })
      }
    }

    // Initial calculation
    calculateTimeLeft()

    const interval = setInterval(calculateTimeLeft, 1000)
    return () => clearInterval(interval)
  }, [endTime, nowOverride])

  return timeLeft
}

// Helper to format a timestamp (seconds or ms) into a readable date & time
function formatDateTime(timestamp: number | bigint | undefined): string {
  if (timestamp === undefined || timestamp === null) return "N/A"
  const tsNum = typeof timestamp === "bigint" ? Number(timestamp) : Number(timestamp)
  const ms = tsNum > 1e12 ? tsNum : tsNum * 1000
  return new Date(ms).toLocaleString()
}

// Helper to pad time units (e.g., 3 -> 03)
function pad2(n: number) { return n.toString().padStart(2, '0') }

// Price formatting helpers to keep big labels from breaking
function formatPriceShort(value: number): string {
  const abs = Math.abs(value)
  if (abs >= 1e12) return (value / 1e12).toFixed(2) + "T"
  if (abs >= 1e9) return (value / 1e9).toFixed(2) + "B"
  if (abs >= 1e6) return (value / 1e6).toFixed(2) + "M"
  if (abs >= 1e3) return (value / 1e3).toFixed(2) + "K"
  return value.toFixed(2)
}
function formatPriceFull(value: number): string {
  return Number(value).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

export function AuctionView({ auctionData, userBalance, proposalAddress, mode = "full", fullHeight = false }: AuctionViewProps) {
  const { resolvedTheme } = useTheme()
  const { address } = useAccount()
  const publicClient = usePublicClient()
  // Theme-aware styling for auction chart line and axes
  const isDark = (resolvedTheme ?? "dark") === "dark"
  const lineColor = isDark ? "#ffffff" : "#000000"
  const textColor = isDark ? "#ffffff" : "#000000"
  // Removed countdown here; will compute after fetching END_TIME
  const totalBids = auctionData.yesTotalBids + auctionData.noTotalBids

  // Onchain token addresses
  const { data: yesTokenAddr } = useReadContract({ address: proposalAddress, abi: proposal_abi, functionName: "yesToken" })
  const { data: noTokenAddr } = useReadContract({ address: proposalAddress, abi: proposal_abi, functionName: "noToken" })
  // Onchain auction addresses (for current on-chain price)
  const { data: yesAuctionAddr } = useReadContract({ address: proposalAddress, abi: proposal_abi, functionName: "yesAuction" })
  const { data: noAuctionAddr } = useReadContract({ address: proposalAddress, abi: proposal_abi, functionName: "noAuction" })
  const { data: treasuryAddr } = useReadContract({ address: proposalAddress, abi: proposal_abi, functionName: "treasury" })
  // Onchain minimum required to open (PyUSD, 6d or 18d per contract). Here it's uint256, represents PyUSD amount.
  const { data: minToOpen } = useReadContract({ address: proposalAddress, abi: proposal_abi, functionName: "minToOpen" })
  const minimumRequired = (typeof minToOpen === "bigint" ? minToOpen : auctionData.minimumRequired)
  const { data: isCancelled } = useReadContract({ address: proposalAddress, abi: proposal_abi, functionName: "state" })
  const proposalState = isCancelled === 3 ? "Cancelled" : (isCancelled === 2 ? "Resolved" : (isCancelled === 1 ? "Live" : "Auction")) as ProposalStatus

  // Per-auction minimum token supply to consider market valid (18 decimals, token units)
  const { data: yesMinToOpen } = useReadContract({ address: yesAuctionAddr as `0x${string}` | undefined, abi: dutchAuction_abi, functionName: "MIN_TO_OPEN" })
  const { data: noMinToOpen } = useReadContract({ address: noAuctionAddr as `0x${string}` | undefined, abi: dutchAuction_abi, functionName: "MIN_TO_OPEN" })

  // Onchain remaining (cap - totalSupply) and user balances
  const { data: yesCap } = useReadContract({ address: yesTokenAddr as `0x${string}` | undefined, abi: marketToken_abi, functionName: "cap" })
  const { data: yesSupply } = useReadContract({ address: yesTokenAddr as `0x${string}` | undefined, abi: marketToken_abi, functionName: "totalSupply" })
  const { data: yesDecimals } = useReadContract({ address: yesTokenAddr as `0x${string}` | undefined, abi: marketToken_abi, functionName: "decimals" })
  const { data: noCap } = useReadContract({ address: noTokenAddr as `0x${string}` | undefined, abi: marketToken_abi, functionName: "cap" })
  const { data: noSupply } = useReadContract({ address: noTokenAddr as `0x${string}` | undefined, abi: marketToken_abi, functionName: "totalSupply" })
  const { data: noDecimals } = useReadContract({ address: noTokenAddr as `0x${string}` | undefined, abi: marketToken_abi, functionName: "decimals" })
  const { data: yesUserBal } = useReadContract({ address: yesTokenAddr as `0x${string}` | undefined, abi: marketToken_abi, functionName: "balanceOf", args: [address ?? "0x0000000000000000000000000000000000000000"] })
  const { data: noUserBal } = useReadContract({ address: noTokenAddr as `0x${string}` | undefined, abi: marketToken_abi, functionName: "balanceOf", args: [address ?? "0x0000000000000000000000000000000000000000"] })

  // On-chain raised amounts (PyUSD, 6d) from Treasury
  const { data: potYes } = useReadContract({ address: treasuryAddr as `0x${string}` | undefined, abi: treasury_abi, functionName: "potYes" })
  const { data: potNo } = useReadContract({ address: treasuryAddr as `0x${string}` | undefined, abi: treasury_abi, functionName: "potNo" })

  // On-chain current price (6 decimals) like the trade panel
  const { data: yesPrice6d } = useReadContract({ address: yesAuctionAddr as `0x${string}` | undefined, abi: dutchAuction_abi, functionName: "priceNow" })
  const { data: noPrice6d } = useReadContract({ address: noAuctionAddr as `0x${string}` | undefined, abi: dutchAuction_abi, functionName: "priceNow" })

  // Local overrides to allow instant updates after tx + periodic polling
  const [yesRemOverride, setYesRemOverride] = useState<bigint | undefined>(undefined)
  const [noRemOverride, setNoRemOverride] = useState<bigint | undefined>(undefined)
  const [yesBalOverride, setYesBalOverride] = useState<bigint | undefined>(undefined)
  const [noBalOverride, setNoBalOverride] = useState<bigint | undefined>(undefined)
  const [yesPriceNow, setYesPriceNow] = useState<number>(auctionData.yesCurrentPrice)
  const [noPriceNow, setNoPriceNow] = useState<number>(auctionData.noCurrentPrice)
  const [raisedOverride, setRaisedOverride] = useState<bigint | undefined>(undefined)
  const [blockTimestamp, setBlockTimestamp] = useState<number | undefined>(undefined)

  useEffect(() => { if (typeof yesPrice6d === "bigint") setYesPriceNow(Number(yesPrice6d) / 1_000_000) }, [yesPrice6d])
  useEffect(() => { if (typeof noPrice6d === "bigint") setNoPriceNow(Number(noPrice6d) / 1_000_000) }, [noPrice6d])

  // Fetch on-chain curve params from YES auction
  const { data: startPrice6d } = useReadContract({ address: yesAuctionAddr as `0x${string}` | undefined, abi: dutchAuction_abi, functionName: "START_PRICE" })
  const { data: startTimeSec } = useReadContract({ address: yesAuctionAddr as `0x${string}` | undefined, abi: dutchAuction_abi, functionName: "START_TIME" })
  const { data: endTimeSec } = useReadContract({ address: yesAuctionAddr as `0x${string}` | undefined, abi: dutchAuction_abi, functionName: "END_TIME" })

  const [startPrice, setStartPrice] = useState<number | undefined>(undefined)
  const [startTime, setStartTime] = useState<number | undefined>(undefined)
  const [endTime, setEndTime] = useState<number | undefined>(undefined)
  useEffect(() => { if (typeof startPrice6d === "bigint") setStartPrice(Number(startPrice6d) / 1_000_000) }, [startPrice6d])
  useEffect(() => { if (typeof startTimeSec === "bigint") setStartTime(Number(startTimeSec)) }, [startTimeSec])
  useEffect(() => { if (typeof endTimeSec === "bigint") setEndTime(Number(endTimeSec)) }, [endTimeSec])

  // Use on-chain END_TIME for countdown when available
  const effectiveEndTime = (typeof endTimeSec === "bigint" ? endTimeSec : auctionData.auctionEndTime)
  const timeLeft = useCountdown(effectiveEndTime, blockTimestamp)

  // Compute remaining using overrides first, then on-chain read, then fallback to provided auctionData
  const yesRemaining = useMemo(() => {
    if (typeof yesRemOverride === "bigint") return yesRemOverride
    if (typeof yesCap === "bigint" && typeof yesSupply === "bigint") return yesCap - yesSupply
    return auctionData.yesRemainingMintable
  }, [yesRemOverride, yesCap, yesSupply, auctionData.yesRemainingMintable])

  const noRemaining = useMemo(() => {
    if (typeof noRemOverride === "bigint") return noRemOverride
    if (typeof noCap === "bigint" && typeof noSupply === "bigint") return noCap - noSupply
    return auctionData.noRemainingMintable
  }, [noRemOverride, noCap, noSupply, auctionData.noRemainingMintable])

  const yesRemainingPercent = useMemo(() => {
    if (typeof yesCap === "bigint" && yesCap > 0n) return Number((yesRemaining * 100n) / yesCap)
    return Number((yesRemaining * 100n) / (auctionData.yesRemainingMintable + auctionData.yesTotalBids))
  }, [yesCap, yesRemaining, auctionData.yesRemainingMintable, auctionData.yesTotalBids])

  const noRemainingPercent = useMemo(() => {
    if (typeof noCap === "bigint" && noCap > 0n) return Number((noRemaining * 100n) / noCap)
    return Number((noRemaining * 100n) / (auctionData.noRemainingMintable + auctionData.noTotalBids))
  }, [noCap, noRemaining, auctionData.noRemainingMintable, auctionData.noTotalBids])

  // Build on-chain linear function points from START->END, price goes to 0 at END_TIME
  const chartData = useMemo(() => {
    if (!startPrice || !startTime || !endTime || endTime <= startTime) return [] as Array<{ time: number; price: number; isCurrent: boolean }>
    const SAMPLES = 100
    const duration = endTime - startTime
    const pts = Array.from({ length: SAMPLES + 1 }, (_, i) => {
      const t = startTime + Math.round((i * duration) / SAMPLES)
      const price = Math.max(startPrice * ((endTime - t) / duration), 0)
      return { time: t, price, isCurrent: false }
    })
    const now = (typeof blockTimestamp === 'number' ? blockTimestamp : Math.floor(Date.now() / 1000))
    if (now >= startTime && now <= endTime) {
      const priceAtNow = yesPriceNow
      pts.push({ time: now, price: priceAtNow, isCurrent: true })
      pts.sort((a, b) => a.time - b.time)
    }
    return pts
  }, [startPrice, startTime, endTime, yesPriceNow, blockTimestamp])

  // Manual refetch to update instantly after tx and every 10s
  const refetchNow = useCallback(async () => {
    try {
      if (!publicClient) return
      // Latest block timestamp for accurate X axis and current-dot position
      try {
        const latest = await publicClient.getBlock()
        const ts: any = (latest as any)?.timestamp
        if (typeof ts === 'bigint') setBlockTimestamp(Number(ts))
        else if (typeof ts === 'number') setBlockTimestamp(ts)
      } catch {}
      // Prices
      if (yesAuctionAddr) {
        const p: bigint = await publicClient.readContract({ address: yesAuctionAddr as any, abi: dutchAuction_abi, functionName: "priceNow" })
        setYesPriceNow(Number(p) / 1_000_000)
      }
      if (noAuctionAddr) {
        const p: bigint = await publicClient.readContract({ address: noAuctionAddr as any, abi: dutchAuction_abi, functionName: "priceNow" })
        setNoPriceNow(Number(p) / 1_000_000)
      }
      // Remaining caps
      if (yesTokenAddr) {
        const [capNow, tsNow] = await Promise.all([
          publicClient.readContract({ address: yesTokenAddr as any, abi: marketToken_abi, functionName: "cap" }) as Promise<bigint>,
          publicClient.readContract({ address: yesTokenAddr as any, abi: marketToken_abi, functionName: "totalSupply" }) as Promise<bigint>,
        ])
        setYesRemOverride((capNow ?? 0n) - (tsNow ?? 0n))
      }
      if (noTokenAddr) {
        const [capNow, tsNow] = await Promise.all([
          publicClient.readContract({ address: noTokenAddr as any, abi: marketToken_abi, functionName: "cap" }) as Promise<bigint>,
          publicClient.readContract({ address: noTokenAddr as any, abi: marketToken_abi, functionName: "totalSupply" }) as Promise<bigint>,
        ])
        setNoRemOverride((capNow ?? 0n) - (tsNow ?? 0n))
      }
      // User balances
      if (address && yesTokenAddr) {
        const bal: bigint = await publicClient.readContract({ address: yesTokenAddr as any, abi: marketToken_abi, functionName: "balanceOf", args: [address] })
        setYesBalOverride(bal ?? 0n)
      }
      if (address && noTokenAddr) {
        const bal: bigint = await publicClient.readContract({ address: noTokenAddr as any, abi: marketToken_abi, functionName: "balanceOf", args: [address] })
        setNoBalOverride(bal ?? 0n)
      }
      // Treasury raised (PyUSD 6d)
      if (treasuryAddr) {
        const [py, pn] = await Promise.all([
          publicClient.readContract({ address: treasuryAddr as any, abi: treasury_abi, functionName: "potYes" }) as Promise<bigint>,
          publicClient.readContract({ address: treasuryAddr as any, abi: treasury_abi, functionName: "potNo" }) as Promise<bigint>,
        ])
        setRaisedOverride((py ?? 0n) + (pn ?? 0n))
      }
    } catch {
      // silent
    }
  }, [publicClient, yesAuctionAddr, noAuctionAddr, yesTokenAddr, noTokenAddr, address, treasuryAddr])

  useEffect(() => {
    const onTx = () => { void refetchNow() }
    window.addEventListener("auction:tx", onTx)
    // Prime once on mount for immediate freshness
    void refetchNow()
    // Poll every 3 seconds to reflect other users' actions
    const id = setInterval(() => { void refetchNow() }, 3_000)
    return () => {
      window.removeEventListener("auction:tx", onTx)
      clearInterval(id)
    }
  }, [refetchNow])

  // Keep overrides in sync with baseline reads if they were not set yet
  useEffect(() => { if (yesBalOverride === undefined && typeof yesUserBal === "bigint") setYesBalOverride(yesUserBal) }, [yesBalOverride, yesUserBal])
  useEffect(() => { if (noBalOverride === undefined && typeof noUserBal === "bigint") setNoBalOverride(noUserBal) }, [noBalOverride, noUserBal])

  // Compute total raised (PyUSD 6d) preferring on-chain Treasury values
  const totalRaised = useMemo(() => {
    if (typeof raisedOverride === "bigint") return raisedOverride
    if (typeof potYes === "bigint" || typeof potNo === "bigint") return ((potYes as bigint) ?? 0n) + ((potNo as bigint) ?? 0n)
    // fallback to provided auctionData sums if present (assumed 6d)
    return (auctionData.yesTotalBids ?? 0n) + (auctionData.noTotalBids ?? 0n)
  }, [raisedOverride, potYes, potNo, auctionData.yesTotalBids, auctionData.noTotalBids])
  const isSuccessful = totalRaised >= minimumRequired

  // Percent progress toward minimum required (total raised vs minimum)
  const minProgressPercent = useMemo(() => {
    if ((minimumRequired ?? 0n) <= 0n) return 100
    const pctTimes10 = (totalRaised * 1000n) / minimumRequired // one decimal precision
    const pct = Number(pctTimes10) / 10
    return pct > 100 ? 100 : pct
  }, [totalRaised, minimumRequired])

  // Compute current totalSupply derived from (cap - remaining) when possible to reflect our live overrides/polling
  const yesSupplyForMin = useMemo(() => {
    if (typeof yesCap === "bigint") return yesCap - yesRemaining
    return (typeof yesSupply === "bigint" ? yesSupply : 0n)
  }, [yesCap, yesRemaining, yesSupply])

  const noSupplyForMin = useMemo(() => {
    if (typeof noCap === "bigint") return noCap - noRemaining
    return (typeof noSupply === "bigint" ? noSupply : 0n)
  }, [noCap, noRemaining, noSupply])

  // Percent progress toward minimum based on TOKEN supply vs MIN_TO_OPEN (both 18 decimals)
  const yesMinProgressPercent = useMemo(() => {
    const supply = yesSupplyForMin
    const min = (typeof yesMinToOpen === "bigint" ? yesMinToOpen : 0n)
    if (min <= 0n) return 100
    const pctTimes10 = (supply * 1000n) / min // one decimal
    const pct = Number(pctTimes10) / 10
    return pct > 100 ? 100 : pct
  }, [yesSupplyForMin, yesMinToOpen])

  const noMinProgressPercent = useMemo(() => {
    const supply = noSupplyForMin
    const min = (typeof noMinToOpen === "bigint" ? noMinToOpen : 0n)
    if (min <= 0n) return 100
    const pctTimes10 = (supply * 1000n) / min // one decimal
    const pct = Number(pctTimes10) / 10
    return pct > 100 ? 100 : pct
  }, [noSupplyForMin, noMinToOpen])

  // Precompute X-axis ticks with proportional days/hours granularity and ensure last tick = auction end
  const xTicks = useMemo(() => {
    if (!startTime || !endTime || endTime <= startTime) return [] as number[]
    const duration = endTime - startTime
    const day = 24 * 60 * 60
    const hour = 60 * 60
    const minute = 60
    let step = hour
    if (duration >= 5 * day) step = day
    else if (duration >= 48 * hour) step = 12 * hour
    else if (duration >= 24 * hour) step = 6 * hour
    else if (duration >= 12 * hour) step = 3 * hour
    else if (duration >= 6 * hour) step = hour
    else if (duration >= 3 * hour) step = 30 * minute
    else if (duration >= hour) step = 15 * minute
    else if (duration >= 10 * minute) step = 5 * minute
    else step = minute

    const ticks: number[] = []
    // Start exactly at startTime
    let t = startTime
    while (t < endTime) {
      ticks.push(t)
      t += step
    }
    // Ensure we include the exact end time as the final tick
    if (ticks[ticks.length - 1] !== endTime) ticks.push(endTime)
    return ticks
  }, [startTime, endTime])

  // Build countdown text (e.g., 1d 03:22:10) and fallback when ended
  const countdownText = useMemo(() => {
    const total = timeLeft.days + timeLeft.hours + timeLeft.minutes + timeLeft.seconds
    if (total <= 0) return "Ended"
    const d = timeLeft.days > 0 ? `${timeLeft.days}d ` : ""
    return `${d}${pad2(timeLeft.hours)}:${pad2(timeLeft.minutes)}:${pad2(timeLeft.seconds)}`
  }, [timeLeft])

  const ChartCard = (
    <Card className={fullHeight ? "h-full flex flex-col" : undefined}>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle>Auction Price Evolution</CardTitle>
            <CardDescription>Linear price decrease over time</CardDescription>
          </div>
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-2 text-sm">
              <Clock className="h-4 w-4 text-muted-foreground" />
              <span title={formatDateTime(effectiveEndTime)}>{countdownText}</span>
            </div>
            <Badge variant={isSuccessful ? "default" : "secondary"} className={proposalState === "Cancelled" ?  "bg-red-500/10 text-red-600 border-red-500/20" : "bg-primary/10 text-primary border-primary/20" }>
              {isSuccessful ? "Minimum Reached" : "In Progress"}
            </Badge>
          </div>
        </div>
      </CardHeader>
      <CardContent className={fullHeight ? "min-h-[16rem] flex-1" : undefined}>
        <div className={fullHeight ? "h-full" : "h-80"}>
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={chartData} margin={{ top: 5, right: 20, bottom: 5, left: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke={textColor} opacity={isDark ? 0.25 : 0.15} />
                <XAxis
                  dataKey="time"
                  type="number"
                  scale="linear"
                  domain={startTime && endTime ? [startTime, endTime] : ["auto", "auto"] as any}
                  ticks={xTicks}
                  tickFormatter={(t: number) => {
                    if (!startTime || !endTime) return ""
                    const dur = endTime - startTime
                    const d = new Date(t * 1000)
                    // For multi-day ranges show day+time; otherwise HH:MM
                    if (dur >= 24 * 60 * 60) {
                      return d.toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })
                    }
                    return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
                  }}
                  stroke={textColor}
                  fontSize={12}
                  tick={{ fill: textColor }}
                  minTickGap={48}
                  axisLine={{ stroke: textColor }}
                  label={{ value: "Time", position: "insideBottom", offset: -5, fill: textColor }}
                />
                <YAxis
                  stroke={textColor}
                  fontSize={12}
                  domain={[0, startPrice ?? 1]}
                  tick={{ fill: textColor }}
                  tickFormatter={(v: number) => formatPriceShort(v)}
                  width={72}
                  tickCount={6}
                  label={{ value: "", angle: -90, position: "insideLeft", fill: textColor }}
                />
                <Tooltip
                  contentStyle={isDark ? {
                    backgroundColor: "rgba(0,0,0,0.75)",
                    border: "1px solid rgba(255,255,255,0.2)",
                    borderRadius: "8px",
                    color: "#ffffff",
                  } : {
                    backgroundColor: "rgba(255,255,255,0.95)",
                    border: "1px solid rgba(0,0,0,0.15)",
                    borderRadius: "8px",
                    color: "#000000",
                  }}
                  formatter={(value: any) => [`$${formatPriceFull(Number(value))}`, "Price"]}
                  labelFormatter={(label: any) => {
                    const t = Number(label)
                    if (!startTime || !endTime) return new Date(t * 1000).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
                    const dur = endTime - startTime
                    const d = new Date(t * 1000)
                    return dur >= 24 * 60 * 60
                      ? d.toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })
                      : d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
                  }}
                />
                <Line
                  type="linear"
                  dataKey="price"
                  stroke={lineColor}
                  strokeWidth={2}
                  dot={(dotProps: any) => {
                    if (dotProps.payload.isCurrent) {
                      return <AnimatedDot {...dotProps} color={lineColor} key={`animated-${dotProps.index}`} />
                    }
                    return <Dot {...dotProps} r={0} key={`dot-${dotProps.index}`} />
                  }}
                />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </CardContent>
    </Card>
  )

  const StatsSection = (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* YES Token Card */}
        <Card className="border-primary/30 bg-primary/5">
          <CardHeader className="pb-3">
            <CardTitle className="text-lg text-primary">tYES</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <p className="text-sm text-muted-foreground mb-1">Current Price</p>
              <p className="text-3xl font-bold text-primary">${yesPriceNow.toFixed(2)}</p>
            </div>

            <div className="space-y-2">
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Remaining Mintable</span>
                <span className="font-mono text-foreground">{(Number((yesRemaining) / BigInt(1e18)).toFixed(6))}</span>
              </div>
              <Progress value={yesRemainingPercent} className="h-2 bg-primary/20" />
              <p className="text-xs text-muted-foreground text-right">{yesRemainingPercent.toFixed(1)}% remaining</p>
            </div>

            {/* Progress to Minimum (token supply vs minToOpen) */}
            <div className="space-y-2">
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Quorum</span>
                <span className="font-mono text-foreground">{yesMinProgressPercent.toFixed(1)}%</span>
              </div>
              <Progress value={yesMinProgressPercent} className="h-2 bg-primary/20" />
              <p className="text-xs text-muted-foreground text-right">{yesMinProgressPercent.toFixed(1)}% of minimum</p>
            </div>

            <div className="pt-2 border-t border-primary/20">
              <p className="text-xs text-muted-foreground mb-1">Your Balance</p>
              <p className="font-mono text-lg text-foreground">{(Number((yesBalOverride ?? yesUserBal) ?? 0n) / 1e18).toFixed(6)}</p>
            </div>
          </CardContent>
        </Card>

        {/* NO Token Card */}
        <Card className="border-destructive/30 bg-destructive/5">
          <CardHeader className="pb-3">
            <CardTitle className="text-lg text-destructive">tNO</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <p className="text-sm text-muted-foreground mb-1">Current Price</p>
              <p className="text-3xl font-bold text-destructive">${noPriceNow.toFixed(2)}</p>
            </div>

            <div className="space-y-2">
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Remaining Mintable</span>
                <span className="font-mono text-foreground">{(Number((noRemaining) / BigInt(1e18)).toFixed(6))}</span>
              </div>
              <Progress value={noRemainingPercent} className="h-2 bg-destructive/20 [&>div]:bg-destructive" />
              <p className="text-xs text-muted-foreground text-right">{noRemainingPercent.toFixed(1)}% remaining</p>
            </div>

            {/* Progress to Minimum (token supply vs minToOpen) */}
            <div className="space-y-2">
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Quorum</span>
                <span className="font-mono text-foreground">{noMinProgressPercent.toFixed(1)}%</span>
              </div>
              <Progress value={noMinProgressPercent} className="h-2 bg-destructive/20 [&>div]:bg-destructive" />
              <p className="text-xs text-muted-foreground text-right">{noMinProgressPercent.toFixed(1)}% of minimum</p>
            </div>

            <div className="pt-2 border-t border-destructive/20">
              <p className="text-xs text-muted-foreground mb-1">Your Balance</p>
              <p className="font-mono text-lg text-foreground">
                {(Number((noBalOverride ?? noUserBal) ?? 0n) / 1e18).toFixed(6)}
              </p>
            </div>
          </CardContent>
        </Card>
      </div>
  )

  if (mode === "chart") return ChartCard
  if (mode === "stats") return StatsSection

  return (
    <div className="space-y-6">
      {ChartCard}
      {StatsSection}
    </div>
  )
}
