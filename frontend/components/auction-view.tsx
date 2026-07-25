"use client"

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Progress } from "@/components/ui/progress"
import { ComposedChart, Line, Area, Scatter, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Dot, ReferenceLine } from "recharts"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import type { AuctionData, UserBalance } from "@/lib/types"
import { formatUnits } from "viem"
import { useEffect, useMemo, useState, useCallback, useRef, use } from "react"
import { Clock } from "lucide-react"
import { useTheme } from "next-themes"
import { useAccount, useReadContract, usePublicClient } from "wagmi"
import { proposal_abi } from "@/contracts/proposal-abi"
import { marketToken_abi } from "@/contracts/marketToken-abi"
import { cca_abi, q96ToPrice6d } from "@/contracts/cca-abi"
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
  // Wall-clock reading taken when the chain timestamp arrived, so the offset
  // between the two stays fixed while the clock keeps ticking every second.
  const driftRef = useRef<number>(0)

  useEffect(() => {
    if (typeof nowOverride !== 'number') { driftRef.current = 0; return }
    const chainNowSec = nowOverride > 1e12 ? Math.floor(nowOverride / 1000) : Math.floor(nowOverride)
    driftRef.current = chainNowSec - Math.floor(Date.now() / 1000)
  }, [nowOverride])

  useEffect(() => {
    const calculateTimeLeft = () => {
      let endSec = Number(endTime)
      // If it's a timestamp in milliseconds, convert to seconds
      if (endSec > 1e12) endSec = Math.floor(endSec / 1000)

      // Tick off the local clock, corrected by the chain offset. Using the
      // block timestamp directly would freeze the countdown between blocks.
      const nowSec = Math.floor(Date.now() / 1000) + driftRef.current

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
  }, [endTime])

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
  // Onchain minimum required to open (USDC, 6d or 18d per contract). Here it's uint256, represents USDC amount.
  const { data: minToOpen } = useReadContract({ address: proposalAddress, abi: proposal_abi, functionName: "minToOpen" })
  const { data: isCancelled } = useReadContract({ address: proposalAddress, abi: proposal_abi, functionName: "state" })
  const proposalState = isCancelled === 3 ? "Cancelled" : (isCancelled === 2 ? "Resolved" : (isCancelled === 1 ? "Live" : "Auction")) as ProposalStatus

  // Minimum tokens sold for a market to open (18d) — Proposal-level threshold
  const yesMinToOpen = minToOpen
  const noMinToOpen = minToOpen

  // Onchain remaining (cap - totalSupply) and user balances
  const { data: yesCap } = useReadContract({ address: yesTokenAddr as `0x${string}` | undefined, abi: marketToken_abi, functionName: "cap" })
  const { data: yesSupply } = useReadContract({ address: yesTokenAddr as `0x${string}` | undefined, abi: marketToken_abi, functionName: "totalSupply" })
  const { data: yesDecimals } = useReadContract({ address: yesTokenAddr as `0x${string}` | undefined, abi: marketToken_abi, functionName: "decimals" })
  const { data: noCap } = useReadContract({ address: noTokenAddr as `0x${string}` | undefined, abi: marketToken_abi, functionName: "cap" })
  const { data: noSupply } = useReadContract({ address: noTokenAddr as `0x${string}` | undefined, abi: marketToken_abi, functionName: "totalSupply" })
  const { data: noDecimals } = useReadContract({ address: noTokenAddr as `0x${string}` | undefined, abi: marketToken_abi, functionName: "decimals" })
  const { data: yesUserBal } = useReadContract({ address: yesTokenAddr as `0x${string}` | undefined, abi: marketToken_abi, functionName: "balanceOf", args: [address ?? "0x0000000000000000000000000000000000000000"] })
  const { data: noUserBal } = useReadContract({ address: noTokenAddr as `0x${string}` | undefined, abi: marketToken_abi, functionName: "balanceOf", args: [address ?? "0x0000000000000000000000000000000000000000"] })

  // On-chain raised amounts (USDC, 6d) from Treasury
  const { data: potYes } = useReadContract({ address: treasuryAddr as `0x${string}` | undefined, abi: treasury_abi, functionName: "potYes" })
  const { data: potNo } = useReadContract({ address: treasuryAddr as `0x${string}` | undefined, abi: treasury_abi, functionName: "potNo" })

  // On-chain current clearing price (Q96 -> 6 decimals)
  const { data: yesClearingQ96 } = useReadContract({ address: yesAuctionAddr as `0x${string}` | undefined, abi: cca_abi, functionName: "clearingPrice" })
  const { data: noClearingQ96 } = useReadContract({ address: noAuctionAddr as `0x${string}` | undefined, abi: cca_abi, functionName: "clearingPrice" })
  const yesPrice6d = typeof yesClearingQ96 === "bigint" ? q96ToPrice6d(yesClearingQ96) : undefined
  const noPrice6d = typeof noClearingQ96 === "bigint" ? q96ToPrice6d(noClearingQ96) : undefined

  // Local overrides to allow instant updates after tx + periodic polling
  const [yesRemOverride, setYesRemOverride] = useState<bigint | undefined>(undefined)
  const [noRemOverride, setNoRemOverride] = useState<bigint | undefined>(undefined)
  const [yesBalOverride, setYesBalOverride] = useState<bigint | undefined>(undefined)
  const [noBalOverride, setNoBalOverride] = useState<bigint | undefined>(undefined)
  const [yesPriceNow, setYesPriceNow] = useState<number>(auctionData.yesCurrentPrice)
  const [noPriceNow, setNoPriceNow] = useState<number>(auctionData.noCurrentPrice)
  const [raisedOverride, setRaisedOverride] = useState<bigint | undefined>(undefined)
  const [raisedYesSide, setRaisedYesSide] = useState<bigint | undefined>(undefined)
  const [raisedNoSide, setRaisedNoSide] = useState<bigint | undefined>(undefined)
  const [blockTimestamp, setBlockTimestamp] = useState<number | undefined>(undefined)

  useEffect(() => { if (typeof yesPrice6d === "bigint") setYesPriceNow(Number(yesPrice6d) / 1_000_000) }, [yesPrice6d])
  useEffect(() => { if (typeof noPrice6d === "bigint") setNoPriceNow(Number(noPrice6d) / 1_000_000) }, [noPrice6d])

  // Curve params: the CCA clearing price starts at the floor and rises with demand
  const { data: floorQ96 } = useReadContract({ address: yesAuctionAddr as `0x${string}` | undefined, abi: cca_abi, functionName: "floorPrice" })
  const startPrice6d = typeof floorQ96 === "bigint" ? q96ToPrice6d(floorQ96) : undefined

  // minToOpen is a TOKEN amount (18d); graduation requires its USDC value at
  // the auction floor, per auction (Proposal._buildAuctionParameters). Convert
  // so the quorum compares USDC against USDC — both sides combined.
  const minimumRequired = useMemo(() => {
    const minTokens = (typeof minToOpen === "bigint" ? minToOpen : auctionData.minimumRequired)
    if (typeof floorQ96 === "bigint" && floorQ96 > 0n) {
      return (2n * minTokens * q96ToPrice6d(floorQ96)) / 10n ** 18n
    }
    return minTokens
  }, [minToOpen, auctionData.minimumRequired, floorQ96])
  const { data: startTimeSec } = useReadContract({ address: proposalAddress, abi: proposal_abi, functionName: "auctionStartTime" })
  const { data: endTimeSec } = useReadContract({ address: proposalAddress, abi: proposal_abi, functionName: "auctionEndTime" })

  const [startPrice, setStartPrice] = useState<number | undefined>(undefined)
  const [startTime, setStartTime] = useState<number | undefined>(undefined)
  const [endTime, setEndTime] = useState<number | undefined>(undefined)
  useEffect(() => { if (typeof startPrice6d === "bigint") setStartPrice(Number(startPrice6d) / 1_000_000) }, [startPrice6d])
  useEffect(() => { if (typeof startTimeSec === "bigint") setStartTime(Number(startTimeSec)) }, [startTimeSec])
  useEffect(() => { if (typeof endTimeSec === "bigint") setEndTime(Number(endTimeSec)) }, [endTimeSec])

  // Use on-chain END_TIME for countdown when available
  const effectiveEndTime = (typeof endTimeSec === "bigint" ? endTimeSec : auctionData.auctionEndTime)
  const timeLeft = useCountdown(effectiveEndTime, blockTimestamp)

  // Unsold supply lives on the CCA: the outcome tokens are pre-minted in full
  // to the auction at creation, so cap - totalSupply is always zero here.
  const { data: yesUnsold } = useReadContract({ address: yesAuctionAddr as `0x${string}` | undefined, abi: cca_abi, functionName: "remainingSupply" })
  const { data: noUnsold } = useReadContract({ address: noAuctionAddr as `0x${string}` | undefined, abi: cca_abi, functionName: "remainingSupply" })

  const yesRemaining = useMemo(() => {
    if (typeof yesRemOverride === "bigint") return yesRemOverride
    if (typeof yesUnsold === "bigint") return yesUnsold
    return auctionData.yesRemainingMintable
  }, [yesRemOverride, yesUnsold, auctionData.yesRemainingMintable])

  const noRemaining = useMemo(() => {
    if (typeof noRemOverride === "bigint") return noRemOverride
    if (typeof noUnsold === "bigint") return noUnsold
    return auctionData.noRemainingMintable
  }, [noRemOverride, noUnsold, auctionData.noRemainingMintable])

  const yesRemainingPercent = useMemo(() => {
    if (typeof yesCap === "bigint" && yesCap > 0n) return Number((yesRemaining * 100n) / yesCap)
    return Number((yesRemaining * 100n) / (auctionData.yesRemainingMintable + auctionData.yesTotalBids))
  }, [yesCap, yesRemaining, auctionData.yesRemainingMintable, auctionData.yesTotalBids])

  const noRemainingPercent = useMemo(() => {
    if (typeof noCap === "bigint" && noCap > 0n) return Number((noRemaining * 100n) / noCap)
    return Number((noRemaining * 100n) / (auctionData.noRemainingMintable + auctionData.noTotalBids))
  }, [noCap, noRemaining, auctionData.noRemainingMintable, auctionData.noTotalBids])

  // On-chain clearing-price history (ClearingPriceUpdated logs) and live bids
  // per auction. This is the data the reference Uniswap CCA UI charts: the
  // clearing price only rises as demand fills the auction, so we render each
  // update as a step, anchored at the floor when the auction starts.
  type PricePoint = { time: number; price: number; isCurrent: boolean }
  type BidPoint = { price: number; demand: number }
  type BidMark = { time: number; price: number; amount: number }
  const [yesHistory, setYesHistory] = useState<PricePoint[]>([])
  const [noHistory, setNoHistory] = useState<PricePoint[]>([])
  const [yesDemand, setYesDemand] = useState<BidPoint[]>([])
  const [noDemand, setNoDemand] = useState<BidPoint[]>([])
  const [yesBidMarks, setYesBidMarks] = useState<BidMark[]>([])
  const [noBidMarks, setNoBidMarks] = useState<BidMark[]>([])

  const fetchAuctionActivity = useCallback(async () => {
    if (!publicClient || !yesAuctionAddr || !noAuctionAddr) return
    const clearingEvt = cca_abi.find((e: any) => e.type === "event" && e.name === "ClearingPriceUpdated")
    const bidEvt = cca_abi.find((e: any) => e.type === "event" && e.name === "BidSubmitted")
    const exitEvt = cca_abi.find((e: any) => e.type === "event" && e.name === "BidExited")
    const tsCache = new Map<bigint, number>()
    const blockTs = async (bn: bigint) => {
      const hit = tsCache.get(bn)
      if (hit !== undefined) return hit
      const b = await publicClient.getBlock({ blockNumber: bn })
      const ts = Number(b.timestamp)
      tsCache.set(bn, ts)
      return ts
    }
    const load = async (auction: `0x${string}`) => {
      const from: bigint = await publicClient.readContract({ address: auction, abi: cca_abi, functionName: "startBlock" }) as unknown as bigint
      const [priceLogs, bidLogs, exitLogs] = await Promise.all([
        publicClient.getLogs({ address: auction, event: clearingEvt as any, fromBlock: from, toBlock: "latest" }),
        publicClient.getLogs({ address: auction, event: bidEvt as any, fromBlock: from, toBlock: "latest" }),
        publicClient.getLogs({ address: auction, event: exitEvt as any, fromBlock: from, toBlock: "latest" }),
      ])
      const history: PricePoint[] = []
      for (const log of priceLogs.slice(-200)) {
        const args: any = (log as any).args
        history.push({
          time: await blockTs(log.blockNumber!),
          price: Number(q96ToPrice6d(args.clearingPriceQ96 as bigint)) / 1_000_000,
          isCurrent: false,
        })
      }
      history.sort((a, b) => a.time - b.time)
      // Active bids -> cumulative demand at or above each max price (USDC 6d)
      const exited = new Set(exitLogs.map((l: any) => (l.args.bidId as bigint).toString()))
      const activeLogs = bidLogs.filter((l: any) => !exited.has((l.args.id as bigint).toString()))
      const active = activeLogs
        .map((l: any) => l.args)
        .map((a: any) => ({ price: Number(q96ToPrice6d(a.priceQ96 as bigint)) / 1_000_000, amount: Number(a.amount as bigint) / 1_000_000 }))
        .sort((a, b) => a.price - b.price)
      const total = active.reduce((s, b) => s + b.amount, 0)
      let below = 0
      const demand: BidPoint[] = active.map((b) => {
        const point = { price: b.price, demand: total - below }
        below += b.amount
        return point
      })
      // Bid marks for the price chart: when it landed, at what max price, how big
      const marks: BidMark[] = []
      for (const l of activeLogs.slice(-120)) {
        const a: any = (l as any).args
        marks.push({
          time: await blockTs(l.blockNumber!),
          price: Number(q96ToPrice6d(a.priceQ96 as bigint)) / 1_000_000,
          amount: Number(a.amount as bigint) / 1_000_000,
        })
      }
      return { history, demand, marks }
    }
    try {
      const [yes, no] = await Promise.all([load(yesAuctionAddr as `0x${string}`), load(noAuctionAddr as `0x${string}`)])
      setYesHistory(yes.history)
      setNoHistory(no.history)
      setYesDemand(yes.demand)
      setNoDemand(no.demand)
      setYesBidMarks(yes.marks)
      setNoBidMarks(no.marks)
    } catch {
      // silent: chart falls back to floor + live point
    }
  }, [publicClient, yesAuctionAddr, noAuctionAddr])

  useEffect(() => {
    void fetchAuctionActivity()
    const id = setInterval(() => { void fetchAuctionActivity() }, 15_000)
    const onTx = () => { void fetchAuctionActivity() }
    window.addEventListener("auction:tx", onTx)
    return () => { clearInterval(id); window.removeEventListener("auction:tx", onTx) }
  }, [fetchAuctionActivity])

  // Step series per market: floor anchor -> logged clearing updates -> live point.
  const now = (typeof blockTimestamp === 'number' ? blockTimestamp : Math.floor(Date.now() / 1000))
  const buildSeries = useCallback((history: PricePoint[], priceNow: number): PricePoint[] => {
    if (!startPrice || !startTime) return []
    const pts: PricePoint[] = [{ time: startTime, price: startPrice, isCurrent: false }, ...history]
    const clampedNow = endTime ? Math.min(now, endTime) : now
    if (clampedNow > startTime) pts.push({ time: clampedNow, price: priceNow, isCurrent: true })
    return pts
  }, [startPrice, startTime, endTime, now])
  const yesSeries = useMemo(() => buildSeries(yesHistory, yesPriceNow), [buildSeries, yesHistory, yesPriceNow])
  const noSeries = useMemo(() => buildSeries(noHistory, noPriceNow), [buildSeries, noHistory, noPriceNow])

  // Y domain: from 0 to a hair above the highest clearing seen (clearing RISES from the floor)
  const yMax = useMemo(() => {
    const peak = Math.max(
      startPrice ?? 0,
      yesPriceNow,
      noPriceNow,
      ...yesHistory.map(p => p.price),
      ...noHistory.map(p => p.price),
      // Bid bubbles sit at their max price — keep them inside the plot
      ...yesBidMarks.map(b => b.price),
      ...noBidMarks.map(b => b.price),
    )
    return peak > 0 ? peak * 1.15 : 1
  }, [startPrice, yesPriceNow, noPriceNow, yesHistory, noHistory, yesBidMarks, noBidMarks])

  // --- Issuance: the contract releases supply evenly per block, so released
  // tokens are a straight line from startTime to endTime. Cleared per side is
  // read from the CCA (supply - remainingSupply). All in whole tokens.
  const supplyTokens = useMemo(() => (typeof yesCap === "bigint" && yesCap > 0n ? Number(yesCap) / 1e18 : 0), [yesCap])
  const releasedTokens = useMemo(() => {
    if (!startTime || !endTime || endTime <= startTime || supplyTokens <= 0) return 0
    const frac = Math.min(1, Math.max(0, (now - startTime) / (endTime - startTime)))
    return supplyTokens * frac
  }, [startTime, endTime, now, supplyTokens])
  const clearedYesTokens = useMemo(() => Math.max(0, supplyTokens - Number(yesRemaining) / 1e18), [supplyTokens, yesRemaining])
  const clearedNoTokens = useMemo(() => Math.max(0, supplyTokens - Number(noRemaining) / 1e18), [supplyTokens, noRemaining])
  const releasePerMin = useMemo(() => {
    if (!startTime || !endTime || endTime <= startTime || supplyTokens <= 0) return 0
    return (supplyTokens / (endTime - startTime)) * 60
  }, [startTime, endTime, supplyTokens])
  const releasedPct = supplyTokens > 0 ? (releasedTokens / supplyTokens) * 100 : 0

  // Order-book view (the Gnosis-auction classic): cumulative TOKEN demand at or
  // above each price — each bid contributes budget/maxPrice tokens. Sorted from
  // the highest price down, so the curve steps down-right.
  const tokenDemand = useCallback((marks: BidMark[]): Array<{ price: number; tokens: number }> => {
    const sorted = [...marks].filter((b) => b.price > 0).sort((a, b) => b.price - a.price)
    const pts: Array<{ price: number; tokens: number }> = []
    let cum = 0
    for (const b of sorted) {
      pts.push({ price: b.price, tokens: cum })
      cum += b.amount / b.price
      pts.push({ price: b.price, tokens: cum })
    }
    if (pts.length > 0) pts.push({ price: 0, tokens: cum })
    return pts
  }, [])
  const yesTokenDemand = useMemo(() => tokenDemand(yesBidMarks), [tokenDemand, yesBidMarks])
  const noTokenDemand = useMemo(() => tokenDemand(noBidMarks), [tokenDemand, noBidMarks])
  const demandXMax = useMemo(() => {
    const peak = Math.max(startPrice ?? 0, yesPriceNow, noPriceNow, ...yesBidMarks.map(b => b.price), ...noBidMarks.map(b => b.price))
    return peak > 0 ? peak * 1.2 : 1
  }, [startPrice, yesPriceNow, noPriceNow, yesBidMarks, noBidMarks])
  const demandYMax = useMemo(() => {
    const peak = Math.max(
      supplyTokens,
      ...yesTokenDemand.map(p => p.tokens),
      ...noTokenDemand.map(p => p.tokens),
    )
    return peak > 0 ? peak * 1.1 : 1
  }, [supplyTokens, yesTokenDemand, noTokenDemand])

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
        const p: bigint = await publicClient.readContract({ address: yesAuctionAddr as any, abi: cca_abi, functionName: "clearingPrice" })
        setYesPriceNow(Number(q96ToPrice6d(p)) / 1_000_000)
      }
      if (noAuctionAddr) {
        const p: bigint = await publicClient.readContract({ address: noAuctionAddr as any, abi: cca_abi, functionName: "clearingPrice" })
        setNoPriceNow(Number(q96ToPrice6d(p)) / 1_000_000)
      }
      // Unsold supply, straight from each CCA
      if (yesAuctionAddr) {
        const left: bigint = await publicClient.readContract({ address: yesAuctionAddr as any, abi: cca_abi, functionName: "remainingSupply" })
        setYesRemOverride(left ?? 0n)
      }
      if (noAuctionAddr) {
        const left: bigint = await publicClient.readContract({ address: noAuctionAddr as any, abi: cca_abi, functionName: "remainingSupply" })
        setNoRemOverride(left ?? 0n)
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
      // Raised (USDC 6d). Treasury pots only fill at settlement, so during the
      // auction the committed bids ARE the raised amount — sum the live
      // BidSubmitted budgets (minus exits) from both CCAs.
      let raised = 0n
      if (treasuryAddr) {
        const [py, pn] = await Promise.all([
          publicClient.readContract({ address: treasuryAddr as any, abi: treasury_abi, functionName: "potYes" }) as Promise<bigint>,
          publicClient.readContract({ address: treasuryAddr as any, abi: treasury_abi, functionName: "potNo" }) as Promise<bigint>,
        ])
        raised = (py ?? 0n) + (pn ?? 0n)
      }
      if (raised === 0n && yesAuctionAddr && noAuctionAddr) {
        const bidEvent = cca_abi.find((f: any) => f.type === 'event' && f.name === 'BidSubmitted') as any
        const exitEvent = cca_abi.find((f: any) => f.type === 'event' && f.name === 'BidExited') as any
        const sumSide = async (auctionAddr: string) => {
          const fromBlock = await publicClient.readContract({ address: auctionAddr as any, abi: cca_abi, functionName: 'startBlock' }) as bigint
          const [submitted, exited] = await Promise.all([
            publicClient.getLogs({ address: auctionAddr as any, event: bidEvent, fromBlock }),
            publicClient.getLogs({ address: auctionAddr as any, event: exitEvent, fromBlock }),
          ])
          const exitedIds = new Set(exited.map((l: any) => String(l.args.bidId)))
          let sum = 0n
          for (const l of submitted as any[]) {
            if (!exitedIds.has(String(l.args.id))) sum += BigInt(l.args.amount)
          }
          return sum
        }
        try {
          const [ry, rn] = await Promise.all([sumSide(yesAuctionAddr), sumSide(noAuctionAddr)])
          setRaisedYesSide(ry)
          setRaisedNoSide(rn)
          raised = ry + rn
        } catch { /* keep partial sum */ }
      }
      setRaisedOverride(raised)
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

  // Compute total raised (USDC 6d) preferring on-chain Treasury values
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
  // Per-side USDC required to graduate: the value of minToOpen tokens at the
  // auction floor (mirrors Proposal._buildAuctionParameters).
  const requiredPerSide = useMemo(() => {
    const minTokens = (typeof minToOpen === "bigint" ? minToOpen : auctionData.minimumRequired)
    if (typeof floorQ96 === "bigint" && floorQ96 > 0n) {
      return (minTokens * q96ToPrice6d(floorQ96)) / 10n ** 18n
    }
    return 0n
  }, [minToOpen, auctionData.minimumRequired, floorQ96])

  const yesMinProgressPercent = useMemo(() => {
    // Graduation is measured in committed USDC, not tokens sold — the CCA only
    // marks tokens sold as blocks release supply, which lags live bids.
    if (typeof raisedYesSide === "bigint" && requiredPerSide > 0n) {
      const pct = Number((raisedYesSide * 1000n) / requiredPerSide) / 10
      return pct > 100 ? 100 : pct
    }
    const supply = yesSupplyForMin
    const min = (typeof yesMinToOpen === "bigint" ? yesMinToOpen : 0n)
    if (min <= 0n) return 100
    const pctTimes10 = (supply * 1000n) / min // one decimal
    const pct = Number(pctTimes10) / 10
    return pct > 100 ? 100 : pct
  }, [raisedYesSide, requiredPerSide, yesSupplyForMin, yesMinToOpen])

  const noMinProgressPercent = useMemo(() => {
    if (typeof raisedNoSide === "bigint" && requiredPerSide > 0n) {
      const pct = Number((raisedNoSide * 1000n) / requiredPerSide) / 10
      return pct > 100 ? 100 : pct
    }
    const supply = noSupplyForMin
    const min = (typeof noMinToOpen === "bigint" ? noMinToOpen : 0n)
    if (min <= 0n) return 100
    const pctTimes10 = (supply * 1000n) / min // one decimal
    const pct = Number(pctTimes10) / 10
    return pct > 100 ? 100 : pct
  }, [raisedNoSide, requiredPerSide, noSupplyForMin, noMinToOpen])

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

  const YES_COLOR = "var(--data-up)"
  const NO_COLOR = "var(--destructive)"

  const timeTickFormatter = (t: number) => {
    if (!startTime || !endTime) return ""
    const dur = endTime - startTime
    const d = new Date(t * 1000)
    if (dur >= 24 * 60 * 60) {
      return d.toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })
    }
    return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
  }
  const tooltipStyle = isDark ? {
    backgroundColor: "rgba(0,0,0,0.75)",
    border: "1px solid rgba(255,255,255,0.2)",
    borderRadius: "4px",
    color: "#ffffff",
  } : {
    backgroundColor: "rgba(255,255,255,0.95)",
    border: "1px solid rgba(0,0,0,0.15)",
    borderRadius: "4px",
    color: "#000000",
  }
  const seriesDot = (color: string) => (dotProps: any) => {
    if (dotProps.payload.isCurrent) {
      return <AnimatedDot {...dotProps} color={color} key={`animated-${dotProps.index}`} />
    }
    return <Dot {...dotProps} r={0} key={`dot-${dotProps.index}`} />
  }

  // A bid drawn where it happened: radius grows with the square root of its
  // USDC budget (area ~ money), bright while its max price still beats the
  // side's clearing, dimmed once the market has moved past it.
  const bidBubble = (color: string, clearingNow: number) => (props: any) => {
    const { cx, cy, payload } = props
    if (typeof cx !== "number" || typeof cy !== "number") return <g />
    const r = Math.max(4, Math.min(13, Math.sqrt(payload.amount || 0) / 6))
    const winning = payload.price >= clearingNow
    return (
      <g>
        <circle cx={cx} cy={cy} r={r} fill={color} opacity={winning ? 0.75 : 0.28} stroke="var(--card)" strokeWidth={1.5} />
      </g>
    )
  }

  const ChartCard = (
    <Card className={fullHeight ? "h-full flex flex-col" : undefined}>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle>Clearing Price</CardTitle>
            <CardDescription>Uniswap CCA: starts at the floor and rises with demand</CardDescription>
          </div>
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-3 text-xs">
              <span className="flex items-center gap-1.5"><span className="inline-block h-2 w-2" style={{ backgroundColor: YES_COLOR }} />YES</span>
              <span className="flex items-center gap-1.5"><span className="inline-block h-2 w-2" style={{ backgroundColor: NO_COLOR }} />NO</span>
            </div>
            <div className="flex items-center gap-2 text-sm">
              <Clock className="h-4 w-4 text-muted-foreground" />
              <span title={formatDateTime(effectiveEndTime)}>{countdownText}</span>
            </div>
            <Badge variant={isSuccessful ? "default" : "secondary"} className={proposalState === "Cancelled" ?  "bg-red-500/10 text-red-600 border-red-500/20" : "bg-primary/10 text-primary border-primary/20" }>
              {isSuccessful ? "Minimum Reached" : "In Progress"}
            </Badge>
          </div>
        </div>
        {supplyTokens > 0 && (
          <div className="mt-2 space-y-1.5">
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
              <span className="font-mono tabular-nums text-foreground">
                {releasedTokens.toLocaleString(undefined, { maximumFractionDigits: 2 })}
                <span className="text-muted-foreground"> / {supplyTokens.toLocaleString(undefined, { maximumFractionDigits: 0 })} tokens released</span>
              </span>
              <span className="font-mono tabular-nums">{releasedPct.toFixed(1)}%</span>
              <span className="font-mono tabular-nums">{releasePerMin.toLocaleString(undefined, { maximumFractionDigits: 2 })} tok/min</span>
              <span className="hidden sm:inline">· even per-block issuance</span>
            </div>
            <Progress value={releasedPct} className="h-1.5" />
          </div>
        )}
      </CardHeader>
      <CardContent className={fullHeight ? "min-h-[16rem] flex-1" : undefined}>
        <Tabs defaultValue="price" className={fullHeight ? "flex h-full flex-col" : undefined}>
          <TabsList className="mb-2 w-fit">
            <TabsTrigger value="price">Price</TabsTrigger>
            <TabsTrigger value="demand">Demand</TabsTrigger>
          </TabsList>
          <TabsContent value="price" className={fullHeight ? "flex-1" : undefined}>
            <div className={fullHeight ? "h-full min-h-[14rem] flex flex-col" : "h-72 flex flex-col"}>
              <div className="flex-1 min-h-0">
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart margin={{ top: 5, right: 20, bottom: 5, left: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke={textColor} opacity={isDark ? 0.25 : 0.15} />
                  <XAxis
                    dataKey="time"
                    type="number"
                    scale="linear"
                    domain={startTime && endTime ? [startTime, endTime] : ["auto", "auto"] as any}
                    ticks={xTicks}
                    tickFormatter={timeTickFormatter}
                    stroke={textColor}
                    fontSize={12}
                    tick={{ fill: textColor }}
                    minTickGap={48}
                    axisLine={{ stroke: textColor }}
                    allowDuplicatedCategory={false}
                  />
                  <YAxis
                    stroke={textColor}
                    fontSize={12}
                    domain={[0, yMax]}
                    tick={{ fill: textColor }}
                    tickFormatter={(v: number) => formatPriceShort(v)}
                    width={72}
                    tickCount={6}
                  />
                  <Tooltip
                    contentStyle={tooltipStyle}
                    formatter={(value: any, name: any) => [`$${formatPriceFull(Number(value))}`, name]}
                    labelFormatter={(label: any) => timeTickFormatter(Number(label))}
                  />
                  {typeof startPrice === "number" && (
                    <ReferenceLine
                      y={startPrice}
                      stroke={textColor}
                      strokeDasharray="4 4"
                      opacity={0.4}
                      label={{ value: "floor", position: "insideTopLeft", fill: textColor, fontSize: 11, opacity: 0.6 }}
                    />
                  )}
                  <Line
                    data={yesSeries}
                    name="YES"
                    type="stepAfter"
                    dataKey="price"
                    stroke={YES_COLOR}
                    strokeWidth={2}
                    dot={seriesDot(YES_COLOR)}
                    isAnimationActive={false}
                  />
                  <Line
                    data={noSeries}
                    name="NO"
                    type="stepAfter"
                    dataKey="price"
                    stroke={NO_COLOR}
                    strokeWidth={2}
                    dot={seriesDot(NO_COLOR)}
                    isAnimationActive={false}
                  />
                  {/* Bids as bubbles: when, at what max price, sized by budget.
                      Bright while still competitive (max >= that side's clearing),
                      dimmed once the clearing has passed them by. */}
                  <Scatter data={yesBidMarks} name="YES bid" dataKey="price" shape={bidBubble(YES_COLOR, yesPriceNow)} isAnimationActive={false} />
                  <Scatter data={noBidMarks} name="NO bid" dataKey="price" shape={bidBubble(NO_COLOR, noPriceNow)} isAnimationActive={false} />
                </ComposedChart>
              </ResponsiveContainer>
              </div>
            </div>
          </TabsContent>
          <TabsContent value="demand" className={fullHeight ? "flex-1" : undefined}>
            {/* The classic auction order-book (Gnosis-style): cumulative token
                demand at or above each price, against the horizontal supply
                lines. Where a side's curve crosses the released-supply line is
                where its clearing settles — and the released line RISES every
                block, which is the whole CCA idea in one picture. */}
            <div className={fullHeight ? "h-full min-h-[14rem]" : "h-72"}>
              {yesTokenDemand.length === 0 && noTokenDemand.length === 0 ? (
                <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
                  No active bids yet — the demand curve builds as bids arrive.
                </div>
              ) : (
                <ResponsiveContainer width="100%" height="100%">
                  <ComposedChart margin={{ top: 5, right: 20, bottom: 5, left: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke={textColor} opacity={isDark ? 0.25 : 0.15} />
                    <XAxis
                      dataKey="price"
                      type="number"
                      domain={[0, demandXMax]}
                      tickFormatter={(v: number) => `$${formatPriceShort(v)}`}
                      stroke={textColor}
                      fontSize={12}
                      tick={{ fill: textColor }}
                      axisLine={{ stroke: textColor }}
                      label={{ value: "Price per token", position: "insideBottom", offset: -5, fill: textColor, fontSize: 11 }}
                    />
                    <YAxis
                      stroke={textColor}
                      fontSize={12}
                      tick={{ fill: textColor }}
                      domain={[0, demandYMax]}
                      tickFormatter={(v: number) => formatPriceShort(v)}
                      width={72}
                      label={{ value: "Tokens demanded", angle: -90, position: "insideLeft", fill: textColor, fontSize: 11 }}
                    />
                    <Tooltip
                      contentStyle={tooltipStyle}
                      formatter={(value: any, name: any) => [`${formatPriceFull(Number(value))} tokens`, name]}
                      labelFormatter={(label: any) => `at ≥ $${formatPriceFull(Number(label))}`}
                    />
                    {/* Supply: what's released so far (rises every block) and the full auction supply */}
                    <ReferenceLine
                      y={releasedTokens}
                      stroke={textColor}
                      strokeWidth={1.5}
                      label={{ value: `released now · ${releasedTokens.toFixed(1)} tok`, position: "insideTopRight", fill: textColor, fontSize: 10, opacity: 0.8 }}
                    />
                    <ReferenceLine
                      y={supplyTokens}
                      stroke={textColor}
                      strokeDasharray="4 4"
                      opacity={0.4}
                      label={{ value: "total supply", position: "insideTopRight", fill: textColor, fontSize: 10, opacity: 0.6 }}
                    />
    {/* Floor + live clearing per side. All three often sit on the same
                        price early on (clearing starts at the floor) — collapse
                        the labels instead of stacking them on one line. */}
                    {(() => {
                      const close = (a: number, b: number) => Math.abs(a - b) < Math.max(a, b) * 0.01
                      const bothAtFloor = typeof startPrice === "number" && close(yesPriceNow, startPrice) && close(noPriceNow, startPrice)
                      if (bothAtFloor) {
                        return (
                          <ReferenceLine x={startPrice} stroke={textColor} strokeDasharray="4 4" opacity={0.6} label={{ value: "clearing · at floor", position: "insideTop", fill: textColor, fontSize: 10, opacity: 0.8 }} />
                        )
                      }
                      const sameClearing = close(yesPriceNow, noPriceNow)
                      return (
                        <>
                          {typeof startPrice === "number" && !close(yesPriceNow, startPrice) && !close(noPriceNow, startPrice) && (
                            <ReferenceLine x={startPrice} stroke={textColor} strokeDasharray="4 4" opacity={0.4} label={{ value: "floor", position: "insideBottom", fill: textColor, fontSize: 10, opacity: 0.6 }} />
                          )}
                          {yesPriceNow > 0 && <ReferenceLine x={yesPriceNow} stroke={YES_COLOR} strokeDasharray="4 4" opacity={0.7} label={{ value: sameClearing ? "YES & NO clearing" : "YES clearing", position: "insideTop", fill: YES_COLOR, fontSize: 10 }} />}
                          {noPriceNow > 0 && !sameClearing && <ReferenceLine x={noPriceNow} stroke={NO_COLOR} strokeDasharray="4 4" opacity={0.7} label={{ value: "NO clearing", position: "insideBottom", fill: NO_COLOR, fontSize: 10 }} />}
                        </>
                      )
                    })()}
                    <Area data={yesTokenDemand} name="YES demand" type="stepAfter" dataKey="tokens" stroke={YES_COLOR} strokeWidth={2} fill={YES_COLOR} fillOpacity={0.1} dot={false} isAnimationActive={false} />
                    <Area data={noTokenDemand} name="NO demand" type="stepAfter" dataKey="tokens" stroke={NO_COLOR} strokeWidth={2} fill={NO_COLOR} fillOpacity={0.1} dot={false} isAnimationActive={false} />
                  </ComposedChart>
                </ResponsiveContainer>
              )}
            </div>
          </TabsContent>
        </Tabs>
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
