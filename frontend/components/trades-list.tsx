"use client"

import type { MarketOption, TradeFill } from "@/lib/types"

interface TradesListProps {
  trades: TradeFill[]
  market: MarketOption
}

// Executed fills feed for a market (mirrors the OrderBook row styling)
export function TradesList({ trades, market }: TradesListProps) {
  if (trades.length === 0) {
    return <div className="text-sm text-muted-foreground">No trades yet on the {market} market.</div>
  }

  return (
    <div className="space-y-2">
      <div className="grid grid-cols-3 md:grid-cols-4 items-center text-xs font-semibold text-muted-foreground pb-2 border-b">
        <span className="text-left">Price</span>
        <span className="text-right md:text-center">Amount</span>
        <span className="text-right hidden md:block">Total</span>
        <span className="text-right">Time</span>
      </div>
      <div className="space-y-1 max-h-[22rem] overflow-y-auto" style={{ scrollbarGutter: "stable" }}>
        {trades.map((t, i) => (
          <div key={`${t.timestamp}-${i}`} className="grid grid-cols-3 md:grid-cols-4 items-center text-sm font-mono py-0.5">
            <span className={`text-left ${t.side === "buy" ? "text-primary" : "text-destructive"}`}>
              ${t.price.toFixed(4)}
            </span>
            <span className="text-right md:text-center">{t.amount.toFixed(3)}</span>
            <span className="text-right text-muted-foreground hidden md:block">${t.total.toFixed(2)}</span>
            <span className="text-right text-muted-foreground text-xs">
              {t.timestamp ? new Date(t.timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" }) : "—"}
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}
