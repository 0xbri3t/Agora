"use client"
import React, { useEffect, useRef, useState } from "react"
import { MarketDepthAndOrders } from "@/components/market-depth-orders"
import { MarketPriceHeader } from "@/components/market-price-header"
import type { MarketData, MarketOption, OrderBookEntry, UserOrder } from "@/lib/types"
import { createChart, LineSeries } from "lightweight-charts"
const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001/api'
interface MarketViewProps {
  marketData: MarketData
  userOrders: UserOrder[]
  selectedMarket: MarketOption
  onMarketChange: (market: MarketOption) => void
  onCancelOrder: (orderId: string) => void
  userOrdersError?: string | null
  orderBookEntries?: OrderBookEntry[]
  proposalId?: string
  // When provided, allows rendering only the chart block or only the orders block for grid alignment
  mode?: 'both' | 'chart' | 'orders'
}

// Helper to map backend candle to lightweight-charts format
type LinePoint = { time: number; value: number }
const toSecs = (ts: string) => Math.floor(new Date(ts).getTime() / 1000)

export function MarketView({
  marketData,
  userOrders,
  selectedMarket,
  onMarketChange,
  onCancelOrder,
  userOrdersError,
  orderBookEntries,
  proposalId,
  mode = 'both',
}: MarketViewProps) {
  const [interval, setInterval] = useState<'1s' | '1m' | '5m' | '15m' | '1h' | '4h' | '1d'>('1m')
  const fallbackOrderBook = selectedMarket === "YES" ? marketData.yesOrderBook : marketData.noOrderBook
  const orderBook = orderBookEntries && orderBookEntries.length > 0 ? orderBookEntries : fallbackOrderBook
  const baseOrders = userOrders ?? []
  const marketOrders = baseOrders.filter((order) => order.market === selectedMarket)

  const chartContainerRef = useRef<HTMLDivElement | null>(null)
  const wrapperRef = useRef<HTMLDivElement | null>(null)
  // Local buffers for 1s mode
  const yes1sRef = useRef<LinePoint[]>([])
  const no1sRef = useRef<LinePoint[]>([])
  useEffect(() => {
    const container = chartContainerRef.current
    if (!container) return

    const chartOptions = {
      layout: {
        textColor: '#94a3b8',
        background: { type: 'solid', color: 'rgba(0,0,0,0)' },
        // -        background: { type: 'solid', color: '#1a1a1a'
      },
      grid: {
        vertLines: { color: 'rgba(68,68,68,0.1)' },
        horzLines: { color: 'rgba(68,68,68,0.1)' },
      },
      // Prevent negative ticks by ensuring autoscale never dips below 0 via zero bottom margin
      rightPriceScale: {
        scaleMargins: { top: 0.1, bottom: 0 },
      },
      timeScale: {
        rightOffset: 0,
        shiftVisibleRangeOnNewBar: true,
        timeVisible: true,
        secondsVisible: interval === '1s',
        tickMarkFormatter: (time: any) => {
          try {
            const ts = typeof time === 'number' ? time : Number(time)
            const d = new Date(ts * 1000)
            return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: interval === '1s' ? '2-digit' : undefined })
          } catch {
            return ''
          }
        },
      },
      height: 420,
    } as const

    const chart = createChart(container, chartOptions as any)
    // YES (approve) in green, NO (reject) in red
    const yesSeries = (chart as any).addSeries
      ? (chart as any).addSeries(LineSeries, {
        color: '#16a34a',
        lineWidth: 2,
        lastValueVisible: true,
        priceLineVisible: true,
        title: 'tYES',
      })
      : (chart as any).addLineSeries({
        color: '#16a34a',
        lineWidth: 2,
        lastValueVisible: true,
        priceLineVisible: true,
        title: 'tYES',
      })
    const noSeries = (chart as any).addSeries
      ? (chart as any).addSeries(LineSeries, {
        color: '#ef4444',
        lineWidth: 2,
        lastValueVisible: true,
        priceLineVisible: true,
        title: 'tNO',
      })
      : (chart as any).addLineSeries({
        color: '#ef4444',
        lineWidth: 2,
        lastValueVisible: true,
        priceLineVisible: true,
        title: 'tNO',
      })

    // Ensure the chart fills its wrapper (absolute inset-0 via CSS)

    // Initial fetch + realtime polling from backend (both markets)
    const controller = new AbortController()
    const limit = 300

    const mapLine = (candles: any[]): LinePoint[] =>
      candles.map((c: any) => ({
        time: toSecs(c.timestamp),
        // Clamp to zero so the y-axis never needs to show negatives
        value: Math.max(0, Number(c.close ?? c.open ?? 0)),
      }))

    // Build union time grid and carry forward last value so both lines extend to the latest time
    const padLines = (yes: LinePoint[], no: LinePoint[]): { yes: LinePoint[]; no: LinePoint[] } => {
      const timesSet = new Set<number>()
      for (const p of yes) timesSet.add(p.time)
      for (const p of no) timesSet.add(p.time)
      let times = Array.from(timesSet).sort((a, b) => a - b)

      // If both series empty, synthesize a single timestamp "now" so we render zeros
      if (times.length === 0) {
        const now = Math.floor(Date.now() / 1000)
        times = [now]
      }
      // Ensure both tokens start at 0 slightly before the first real candle
      const intervalToSec: Record<typeof interval, number> = {
        '1s': 1,
        '1m': 60,
        '5m': 300,
        '15m': 900,
        '1h': 3600,
        '4h': 14400,
        '1d': 86400,
      }
      const delta = intervalToSec[interval] ?? 60
      const start = Math.max(0, times[0] - delta)

      const yesByTime = new Map(yes.map(p => [p.time, p.value]))
      const noByTime = new Map(no.map(p => [p.time, p.value]))

      const outYes: LinePoint[] = []
      const outNo: LinePoint[] = []

      // Seed both series with a 0 at the synthetic start time
      outYes.push({ time: start, value: 0 })
      outNo.push({ time: start, value: 0 })

      // If a side has no data at all, output zeros across all times
      if (yes.length === 0) {
        for (const t of times) outYes.push({ time: t, value: 0 })
      }
      if (no.length === 0) {
        for (const t of times) outNo.push({ time: t, value: 0 })
      }

      // Carry-forward last known values for sides that do have data
      if (yes.length > 0) {
        let last: number | undefined
        const firstT = yes[0].time
        for (const t of times) {
          const v = yesByTime.get(t)
          if (v !== undefined) last = v
          if (t >= firstT && last !== undefined) outYes.push({ time: t, value: last })
        }
      }
      if (no.length > 0) {
        let last: number | undefined
        const firstT = no[0].time
        for (const t of times) {
          const v = noByTime.get(t)
          if (v !== undefined) last = v
          if (t >= firstT && last !== undefined) outNo.push({ time: t, value: last })
        }
      }

      // Extend last known value horizontally up to "now" so the line keeps drawing even if price doesn't change
      const now = Math.floor(Date.now() / 1000)
      if (outYes.length > 0) {
        const lastY = outYes[outYes.length - 1]
        if (lastY.time < now) outYes.push({ time: now, value: lastY.value })
      }
      if (outNo.length > 0) {
        const lastN = outNo[outNo.length - 1]
        if (lastN.time < now) outNo.push({ time: now, value: lastN.value })
      }

      return { yes: outYes, no: outNo }
    }

    const loadInitial = async () => {
      if (!proposalId) return
      try {
        if (interval === '1s') {
          // Seed 1s buffers with start@0 and first sample
          yes1sRef.current = []
          no1sRef.current = []
          const now = Math.floor(Date.now() / 1000)
          const start = now - 1
          yes1sRef.current.push({ time: start, value: 0 })
          no1sRef.current.push({ time: start, value: 0 })
          // Try to fetch an initial mid from top-of-book
          const [ty, tn] = await Promise.all([
            fetch(`${API_BASE}/orderbooks/${proposalId}/yes/top`, { signal: controller.signal }).then(r => r.ok ? r.json().catch(() => null) : null),
            fetch(`${API_BASE}/orderbooks/${proposalId}/no/top`, { signal: controller.signal }).then(r => r.ok ? r.json().catch(() => null) : null),
          ])
          const calcMid = (json: any): number | undefined => {
            const bid = json?.bestBid?.price != null ? Number(json.bestBid.price) : undefined
            const ask = json?.bestAsk?.price != null ? Number(json.bestAsk.price) : undefined
            if (bid != null && ask != null) return (bid + ask) / 2
            return bid ?? ask ?? undefined
          }
          const yMid = calcMid(ty)
          const nMid = calcMid(tn)
          if (yMid != null) yes1sRef.current.push({ time: now, value: Math.max(0, yMid) })
          if (nMid != null) no1sRef.current.push({ time: now, value: Math.max(0, nMid) })
          yesSeries.setData(yes1sRef.current)
          noSeries.setData(no1sRef.current)
          chart.timeScale().fitContent()
          try { chart.timeScale().scrollToRealTime?.() } catch { }
        } else {
          const [resYes, resNo] = await Promise.all([
            fetch(`${API_BASE}/orderbooks/${proposalId}/yes/candles?interval=${interval}&limit=${limit}`, { signal: controller.signal }),
            fetch(`${API_BASE}/orderbooks/${proposalId}/no/candles?interval=${interval}&limit=${limit}`, { signal: controller.signal }),
          ])
          const [jsonYes, jsonNo] = await Promise.all([
            resYes.ok ? resYes.json().catch(() => null) : null,
            resNo.ok ? resNo.json().catch(() => null) : null,
          ])
          const yes = Array.isArray(jsonYes?.candles) ? mapLine(jsonYes.candles) : []
          const no = Array.isArray(jsonNo?.candles) ? mapLine(jsonNo.candles) : []
          const padded = padLines(yes, no)
          yesSeries.setData(padded.yes)
          noSeries.setData(padded.no)
          chart.timeScale().fitContent()
          try { chart.timeScale().scrollToRealTime?.() } catch { }
        }
      } catch (_) { /* ignore */ }
    }

    const poll = async () => {
      if (!proposalId) return
      try {
        if (interval === '1s') {
          const now = Math.floor(Date.now() / 1000)
          const [ty, tn] = await Promise.all([
            fetch(`${API_BASE}/orderbooks/${proposalId}/yes/top`, { signal: controller.signal }).then(r => r.ok ? r.json().catch(() => null) : null),
            fetch(`${API_BASE}/orderbooks/${proposalId}/no/top`, { signal: controller.signal }).then(r => r.ok ? r.json().catch(() => null) : null),
          ])
          const calcMid = (json: any): number | undefined => {
            const bid = json?.bestBid?.price != null ? Number(json.bestBid.price) : undefined
            const ask = json?.bestAsk?.price != null ? Number(json.bestAsk.price) : undefined
            if (bid != null && ask != null) return (bid + ask) / 2
            return bid ?? ask ?? undefined
          }
          const yMid = calcMid(ty)
          const nMid = calcMid(tn)
          const pushCapped = (arr: LinePoint[], pt: LinePoint) => {
            arr.push(pt)
            // Cap buffer to last 1200 points (~20 minutes at 1s) to avoid unbounded growth
            if (arr.length > 1200) arr.splice(0, arr.length - 1200)
          }
          if (yMid != null) pushCapped(yes1sRef.current, { time: now, value: Math.max(0, yMid) })
          else if (yes1sRef.current.length) {
            // carry forward last
            const last = yes1sRef.current[yes1sRef.current.length - 1]
            if (last.time < now) pushCapped(yes1sRef.current, { time: now, value: last.value })
          }
          if (nMid != null) pushCapped(no1sRef.current, { time: now, value: Math.max(0, nMid) })
          else if (no1sRef.current.length) {
            const last = no1sRef.current[no1sRef.current.length - 1]
            if (last.time < now) pushCapped(no1sRef.current, { time: now, value: last.value })
          }
          yesSeries.setData(yes1sRef.current)
          noSeries.setData(no1sRef.current)
          try { chart.timeScale().scrollToRealTime?.() } catch { }
        } else {
          const [resYes, resNo] = await Promise.all([
            fetch(`${API_BASE}/orderbooks/${proposalId}/yes/candles?interval=${interval}&limit=${limit}`, { signal: controller.signal }),
            fetch(`${API_BASE}/orderbooks/${proposalId}/no/candles?interval=${interval}&limit=${limit}`, { signal: controller.signal }),
          ])
          const [jsonYes, jsonNo] = await Promise.all([
            resYes.ok ? resYes.json().catch(() => null) : null,
            resNo.ok ? resNo.json().catch(() => null) : null,
          ])
          const yes = Array.isArray(jsonYes?.candles) ? mapLine(jsonYes.candles) : []
          const no = Array.isArray(jsonNo?.candles) ? mapLine(jsonNo.candles) : []
          const padded = padLines(yes, no)
          yesSeries.setData(padded.yes)
          noSeries.setData(padded.no)
          try { chart.timeScale().scrollToRealTime?.() } catch { }
        }
      } catch (_) { /* ignore */ }
    }

    void loadInitial()
    const pollMsMap: Record<typeof interval, number> = {
      '1s': 1000,
      '1m': 5000,
      '5m': 15000,
      '15m': 30000,
      '1h': 60000,
      '4h': 120000,
      '1d': 300000,
    }
    const pollEvery = pollMsMap[interval] ?? 10000
    const intervalID = window.setInterval(() => { void poll() }, pollEvery)

    // Hide TradingView logo/link if present (lightweight-charts branding anchor)
    const hideBranding = () => {
      const links = container.querySelectorAll('a[href*="tradingview.com"]')
      links.forEach((el) => {
        ; (el as HTMLElement).style.display = 'none'
      })
    }
    hideBranding()
    const mo = new MutationObserver(() => hideBranding())
    mo.observe(container, { childList: true, subtree: true })

    const onResize = () => {
      const wrap = wrapperRef.current
      if (!wrap) return
      const rect = wrap.getBoundingClientRect()
      if ((chart as any).resize) {
        (chart as any).resize(Math.max(0, Math.floor(rect.width)), Math.max(0, Math.floor(rect.height)))
      } else {
        chart.applyOptions({ width: Math.max(0, Math.floor(rect.width)), height: Math.max(0, Math.floor(rect.height)) })
      }
    }
    window.addEventListener('resize', onResize)
    // Observe wrapper size changes too
    const RO = (window as any).ResizeObserver
    const ro = RO ? new RO(() => onResize()) : null
    if (ro && wrapperRef.current) ro.observe(wrapperRef.current)
    // Initial size sync (next tick)
    setTimeout(onResize, 0)

    return () => {
      clearInterval(intervalID)
      controller.abort()
      window.removeEventListener('resize', onResize)
      if (ro && wrapperRef.current) ro.unobserve(wrapperRef.current)
      mo.disconnect()
      chart.remove()
    }
  }, [proposalId, interval])

  const ChartBlock = (
    <div ref={wrapperRef} className="relative w-full h-[420px] rounded-md border overflow-hidden">
      <div className="absolute top-2 left-2 z-10 font-sans ">
        <select
          aria-label="Timeframe"
          value={interval}
          onChange={(e) => setInterval(e.target.value as any)}
          className="text-sm rounded border bg-muted text-foreground px-2 py-1 focus:outline-none focus:ring-1 focus:ring-foreground/30 font-sans appearance-none"
          style={{ fontFamily: 'var(--font-sans, var(--font-geist-sans, ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial, Noto Sans, Apple Color Emoji, Segoe UI Emoji, Segoe UI Symbol))' }}
        >

          <option className="" value="1s">1s</option>
          <option className="" value="1m">1m</option>
          <option className="" value="5m">5m</option>
          <option className="" value="15m">15m</option>
          <option className="" value="1h">1h</option>
          <option className="" value="4h">4h</option>
          <option className="" value="1d">1d</option>
        </select>
      </div>
      <div id="chartContainer" ref={chartContainerRef} className="absolute inset-0" />
    </div>
  )

  const OrdersBlock = (
    <MarketDepthAndOrders
      compact
      market={selectedMarket}
      orderBook={orderBook}
      userOrders={marketOrders}
      onCancelOrder={onCancelOrder}
      userOrdersError={userOrdersError}
    />
  )

  if (mode === 'chart') return ChartBlock
  if (mode === 'orders') return OrdersBlock

  return (
    <div className="space-y-8">
      {ChartBlock}
      {proposalId ? (
        <div className="md:hidden">
          <MarketPriceHeader proposalId={String(proposalId)} />
        </div>
      ) : null}
      {OrdersBlock}
    </div>
  )
}