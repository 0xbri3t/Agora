"use client"

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { X } from "lucide-react"
import type { UserOrder } from "@/lib/types"
import { Progress } from "@/components/ui/progress"

interface OrderListProps {
  orders: UserOrder[]
  onCancelOrder: (orderId: string) => void
  error?: string | null
  variant?: 'card' | 'plain'
}

export function OrderList({ orders, onCancelOrder, error, variant = 'card' }: OrderListProps) {
  const Inner = (
    <>
      {error ? (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : orders.length === 0 ? (
        <div className="text-sm text-muted-foreground">No orders to display for this market.</div>
      ) : (
        <div
          className="space-y-3 max-h-[22rem] min-h-[22rem] overflow-y-auto"
          style={{ scrollbarGutter: 'stable' }}
        >
          {[...orders].sort((a, b) => b.timestamp - a.timestamp).map((order) => {
            const fillPct = order.amount > 0 ? Math.min(100, Math.max(0, (order.filled / order.amount) * 100)) : 0
            const isFilled = order.status === 'filled' || (order.amount > 0 && order.filled >= order.amount)
            const isPartial = !isFilled && order.filled > 0
            const isCancelled = order.status === 'cancelled'
            const rowBg = isCancelled
              ? 'bg-red-100 dark:bg-red-950/30 border-red-400/30'
              : isFilled
              ? 'bg-emerald-50 dark:bg-emerald-950/20 border-emerald-200/50'
              : isPartial
              ? 'bg-amber-50 dark:bg-amber-950/20 border-amber-200/50'
              : 'bg-card'
            const displayPct = fillPct < 100 ? fillPct.toFixed(2) : fillPct.toFixed(0)
            return (
              <div key={order.id} className={`flex items-center justify-between p-3 rounded-lg border min-h-20 ${rowBg} ${isCancelled ? 'opacity-90' : ''}`}>
                <div className="flex-1 space-y-2 pr-3">
                  <div className="flex items-center gap-2 flex-wrap">
                    <Badge variant={order.side === "BUY" ? "default" : "secondary"}>{order.side}</Badge>
                    <Badge variant="outline">{order.type}</Badge>
                    <span className="text-sm font-medium">
                      {order.amount} @ ${order.price.toFixed(4)}
                    </span>
                    {isFilled && <Badge className="bg-emerald-600/15 text-emerald-700 dark:text-emerald-300 border-emerald-400/30">Filled</Badge>}
                    {isPartial && <Badge className="bg-amber-600/15 text-amber-700 dark:text-amber-300 border-amber-400/30">Partial</Badge>}
                    {order.status === 'cancelled' && <Badge variant="destructive">Cancelled</Badge>}
                  </div>
                  <div className="space-y-1">
                    <div className="flex items-center justify-between text-[11px] text-muted-foreground">
                      <span>Filled {order.filled.toFixed(4)} / {order.amount.toFixed(4)}</span>
                      <span>{displayPct}%</span>
                    </div>
                    <Progress value={fillPct} className="h-1.5" />
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {new Date(order.timestamp).toLocaleString()}
                  </div>
                </div>
                {order.status === "pending" && (
                  <Button
                    size="sm"
                    variant="destructive"
                    className="hover:opacity-100 hover:bg-destructive/90 hover:ring-2 hover:ring-red-500/40 hover:shadow-[0_0_0_3px_rgba(239,68,68,0.3)] transition-all"
                    onClick={() => onCancelOrder(order.id)}
                    title="Cancel order"
                  >
                    <X className="h-4 w-4" />
                  </Button>
                )}
              </div>
            )
          })}
        </div>
      )}
    </>
  )

  if (variant === 'plain') return Inner

  return (
    <Card>
      <CardHeader>
        <CardTitle>Your Orders</CardTitle>
      </CardHeader>
      <CardContent>
        {Inner}
      </CardContent>
    </Card>
  )
}
