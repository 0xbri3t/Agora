"use client"

import { useState } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import type { MarketOption, OrderBookEntry, TradeFill, UserOrder } from "@/lib/types"
import { OrderBook } from "@/components/order-book"
import { OrderList } from "@/components/order-list"
import { TradesList } from "@/components/trades-list"

interface Props {
  market: MarketOption
  orderBook: OrderBookEntry[]
  userOrders: UserOrder[]
  onCancelOrder: (orderId: string) => void
  userOrdersError?: string | null
  compact?: boolean
  trades?: TradeFill[]
}

type Tab = "book" | "trades" | "yours"

export function MarketDepthAndOrders({ market, orderBook, userOrders, onCancelOrder, userOrdersError, compact, trades }: Props) {
  const [tab, setTab] = useState<Tab>("book")

  const TabButton = ({ id, label, large }: { id: Tab; label: string; large?: boolean }) => (
    <button
      type="button"
      aria-pressed={tab === id}
      onClick={() => setTab(id)}
      className={`px-0 py-0 h-auto ${large ? 'text-[15px] font-semibold' : 'text-sm font-medium'} border-b-2 transition-colors ${
        tab === id
          ? (large ? 'text-black dark:text-white border-black dark:border-white' : 'text-foreground border-foreground')
          : 'text-muted-foreground border-transparent'
      } bg-transparent hover:bg-transparent focus-visible:outline-none focus-visible:ring-0`}
    >
      {label}
    </button>
  )

  const Body = tab === "book" ? (
    <OrderBook orderBook={orderBook} market={market} variant="plain" />
  ) : tab === "trades" ? (
    <TradesList trades={trades ?? []} market={market} />
  ) : (
    <OrderList orders={userOrders} onCancelOrder={onCancelOrder} error={userOrdersError} variant="plain" />
  )

  if (compact) {
    return (
      <div className="space-y-4">
        <div className="w-full p-4 h-auto rounded-none flex gap-6 select-none">
          <TabButton id="book" label="Order Book" large />
          <TabButton id="trades" label="Trades" large />
          <TabButton id="yours" label="Your Orders" large />
        </div>
        <div>{Body}</div>
      </div>
    )
  }

  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="w-full p-0 h-auto rounded-none flex gap-6 select-none">
          <TabButton id="book" label="Order Book" />
          <TabButton id="trades" label="Trades" />
          <TabButton id="yours" label="Your Orders" />
        </div>
      </CardHeader>
      <CardContent>{Body}</CardContent>
    </Card>
  )
}
