"use client"

import { useState } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import type { MarketOption, OrderBookEntry, UserOrder } from "@/lib/types"
import { OrderBook } from "@/components/order-book"
import { OrderList } from "@/components/order-list"

interface Props {
  market: MarketOption
  orderBook: OrderBookEntry[]
  userOrders: UserOrder[]
  onCancelOrder: (orderId: string) => void
  userOrdersError?: string | null
  compact?: boolean
}

export function MarketDepthAndOrders({ market, orderBook, userOrders, onCancelOrder, userOrdersError, compact }: Props) {
  const [tab, setTab] = useState<"book" | "yours">("book")

  if (compact) {
    return (
      <div className="space-y-4">
        <div className="w-full p-4 h-auto rounded-none flex gap-6 select-none">
          <button
            type="button"
            aria-pressed={tab === 'book'}
            onClick={() => setTab('book')}
            className={`px-0 py-0 h-auto text-[15px] font-semibold border-b-2 transition-colors ${
              tab === 'book' ? 'text-black dark:text-white border-black dark:border-white' : 'text-muted-foreground border-transparent'
            } bg-transparent hover:bg-transparent focus-visible:outline-none focus-visible:ring-0`}
          >
            Order Book
          </button>
          <button
            type="button"
            aria-pressed={tab === 'yours'}
            onClick={() => setTab('yours')}
            className={`px-0 py-0 h-auto text-[15px] font-semibold border-b-2 transition-colors ${
              tab === 'yours' ? 'text-black dark:text-white border-black dark:border-white' : 'text-muted-foreground border-transparent'
            } bg-transparent hover:bg-transparent focus-visible:outline-none focus-visible:ring-0`}
          >
            Your Orders
          </button>
        </div>
        <div>
          {tab === "book" ? (
            <OrderBook orderBook={orderBook} market={market} variant="plain" />
          ) : (
            <OrderList orders={userOrders} onCancelOrder={onCancelOrder} error={userOrdersError} variant="plain" />
          )}
        </div>
      </div>
    )
  }

  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="w-full p-0 h-auto rounded-none flex gap-6 select-none">
          <button
            type="button"
            aria-pressed={tab === 'book'}
            onClick={() => setTab('book')}
            className={`px-0 py-0 h-auto text-sm font-medium border-b-2 transition-colors ${
              tab === 'book' ? 'text-foreground border-foreground' : 'text-muted-foreground border-transparent'
            } bg-transparent hover:bg-transparent focus-visible:outline-none focus-visible:ring-0`}
          >
            Order Book
          </button>
          <button
            type="button"
            aria-pressed={tab === 'yours'}
            onClick={() => setTab('yours')}
            className={`px-0 py-0 h-auto text-sm font-medium border-b-2 transition-colors ${
              tab === 'yours' ? 'text-foreground border-foreground' : 'text-muted-foreground border-transparent'
            } bg-transparent hover:bg-transparent focus-visible:outline-none focus-visible:ring-0`}
          >
            Your Orders
          </button>
        </div>
      </CardHeader>
      <CardContent>
        {tab === "book" ? (
          <OrderBook orderBook={orderBook} market={market} />
        ) : (
          <OrderList orders={userOrders} onCancelOrder={onCancelOrder} error={userOrdersError} />
        )}
      </CardContent>
    </Card>
  )
}
