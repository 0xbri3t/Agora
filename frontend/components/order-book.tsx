"use client"

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import "../styles/scrollbar-hide.css"
import type { OrderBookEntry, MarketOption } from "@/lib/types"
import { useState, useMemo, useEffect, useRef } from "react"

interface OrderBookProps {
  orderBook: OrderBookEntry[]
  market: MarketOption
  variant?: 'card' | 'plain'
}

export function OrderBook({ orderBook, market, variant = 'card' }: OrderBookProps) {
  // Default to 10, show up to 10 without scroll, scroll only for extras
  const [limit, setLimit] = useState<number>(10)
  const gridRef = useRef<HTMLDivElement | null>(null)
  const [maxHeightPx, setMaxHeightPx] = useState<number | null>(null)
  // Compute live proportions using counts of total orders per side
  const totalBuys = orderBook.filter(o => o.side === 'buy').length
  const totalSells = orderBook.filter(o => o.side === 'sell').length
  const totalOrders = totalBuys + totalSells
  const bidPct = totalOrders > 0 ? (totalBuys / totalOrders) * 100 : 0
  const askPct = totalOrders > 0 ? (totalSells / totalOrders) * 100 : 0

  const buyOrders = useMemo(() => orderBook.filter((o) => o.side === "buy").slice(0, limit), [orderBook, limit])
  const sellOrders = useMemo(() => orderBook.filter((o) => o.side === "sell").slice(0, limit), [orderBook, limit])

  // Measure the height of 10 operations and lock as fixed height for all cases
  useEffect(() => {
    if (maxHeightPx != null) return // already measured
    // Always measure with 10 operations for height lock
    const el = gridRef.current;
    if (!el) return;
    const raf = requestAnimationFrame(() => {
      setMaxHeightPx(el.clientHeight);
    });
    return () => cancelAnimationFrame(raf);
  }, [orderBook, maxHeightPx])

  const Row = ({ order, align }: { order: OrderBookEntry; align: "left" | "right" }) => {
    const filled = typeof order.filled === 'number' ? order.filled : 0
    const amount = typeof order.amount === 'number' ? order.amount : 0
    const computedPct = amount > 0 ? Math.min(1, Math.max(0, filled / amount)) : 0
    const fillPct = typeof order.fillPct === 'number' ? order.fillPct : computedPct
  const pctNum = fillPct * 100
  const width = `${pctNum.toFixed(2)}%`

    return (
      <div className="relative grid grid-cols-2 md:grid-cols-4 items-center text-sm font-mono py-0.5">
        {/* background fill bar */}
        <div
          className={`absolute inset-y-0 ${align === 'left' ? 'left-0' : 'right-0'} ${align === 'left' ? 'bg-primary/15' : 'bg-destructive/15'}`}
          style={{ width }}
        />
        {/* foreground content */}
        <span className={`relative z-10 ${align === 'left' ? 'text-primary' : 'text-destructive'} text-left`}>${order.price.toFixed(4)}</span>
        <span className="relative z-10 text-right md:text-center">{order.amount.toFixed(3)}</span>
        <span className="relative z-10 text-center text-muted-foreground hidden md:block">{pctNum.toFixed(0)}%</span>
        <span className="relative z-10 text-right text-muted-foreground hidden md:block">${order.total.toFixed(2)}</span>
      </div>
    )
  }

  const Inner = (
  <div className="space-y-4">
      {/* Proportional bar */}
      <div className="h-2 w-full rounded bg-muted overflow-hidden flex">
        <div className="h-full bg-primary" style={{ width: `${bidPct}%` }} />
        <div className="h-full bg-destructive" style={{ width: `${askPct}%` }} />
      </div>
      {/* Limit selector below bar, right-aligned, self-contained label text */}
      <div className="flex justify-end">
        <select
          aria-label="Order limit"
          value={limit}
          onChange={(e) => setLimit(Number(e.target.value))}
          className="text-xs rounded border bg-muted text-foreground px-2 py-1 focus:outline-none focus:ring-1 focus:ring-foreground/30"
        >
          <option value={10}>Last 10 operations</option>
          <option value={30}>Last 30 operations</option>
          <option value={50}>Last 50 operations</option>
          <option value={100}>Last 100 operations</option>
        </select>
      </div>
      <div
        ref={gridRef}
        className={`grid grid-cols-2 gap-4${limit > 10 ? ' overflow-y-auto scrollbar-hide' : ''}`}
        style={maxHeightPx ? { scrollbarGutter: 'stable', maxHeight: `${maxHeightPx}px`, minHeight: `${maxHeightPx}px` } : {}}
      >
        {/* Buy Orders */}
        <div className="space-y-2">
          <div className="text-[11px] tracking-wide font-semibold text-primary/80">Bids</div>
          <div className="grid grid-cols-2 md:grid-cols-4 items-center text-xs font-semibold text-muted-foreground pb-2 border-b">
            <span className="text-left">Price</span>
            <span className="text-right md:text-center">Amount</span>
            <span className="text-center hidden md:block">Filled</span>
            <span className="text-right hidden md:block">Total</span>
          </div>
          <div className="space-y-1">
            {buyOrders.map((order, i) => (
              <Row key={`buy-${i}`} order={order} align="left" />
            ))}
          </div>
        </div>

        {/* Sell Orders */}
        <div className="space-y-2">
          <div className="text-[11px] tracking-wide font-semibold text-destructive/80">Asks</div>
          <div className="grid grid-cols-2 md:grid-cols-4 items-center text-xs font-semibold text-muted-foreground pb-2 border-b">
            <span className="text-left">Price</span>
            <span className="text-right md:text-center">Amount</span>
            <span className="text-center hidden md:block">Filled</span>
            <span className="text-right hidden md:block">Total</span>
          </div>
          <div className="space-y-1">
            {sellOrders.map((order, i) => (
              <Row key={`sell-${i}`} order={order} align="right" />
            ))}
          </div>
        </div>
      </div>
    </div>
  )

  if (variant === 'plain') return Inner

  return (
    <Card>
      <CardHeader>
        <CardTitle>Order Book - t{market}</CardTitle>
      </CardHeader>
      <CardContent>{Inner}</CardContent>
    </Card>
  )
}
