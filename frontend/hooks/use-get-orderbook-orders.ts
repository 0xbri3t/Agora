import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { MarketOption, OrderBookEntry } from '@/lib/types'
import { io, Socket } from 'socket.io-client'

const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001/api'

export interface UseGetOrderbookOrdersOptions {
  proposalId: string
  market: MarketOption // 'YES' | 'NO'
  auto?: boolean
  pollMs?: number // optional polling fallback
}

// Public orderbook fetcher (no auth). Also listens to WS events to refetch in realtime
export function useGetOrderbookOrders(options: UseGetOrderbookOrdersOptions) {
  const { proposalId, market, auto = true, pollMs } = options

  const [orders, setOrders] = useState<OrderBookEntry[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const side = market === 'YES' ? 'approve' : 'reject'

  const fetchOrders = useCallback(async () => {
    if (!proposalId) return
    setIsLoading(true)
    setError(null)
    try {
      const res = await fetch(`${API_BASE}/orderbooks/${proposalId}/${side}/orders`)
      const ct = res.headers.get('content-type') || ''
      if (!res.ok) {
        let errMsg = `Request failed with status ${res.status}`
        if (ct.includes('application/json')) {
          try { const j = await res.json(); errMsg = j?.error || errMsg } catch {}
        } else {
          try { const t = await res.text(); if (t) errMsg = `${errMsg}: ${t.slice(0,160)}` } catch {}
        }
        setOrders([])
        setError(errMsg)
        return
      }
      if (!ct.includes('application/json')) {
        const t = await res.text().catch(() => '')
        setOrders([])
        setError(`Unexpected response (not JSON): ${t.slice(0,160)}`)
        return
      }
      const data = await res.json()
      const entries: OrderBookEntry[] = Array.isArray(data?.orders) ? data.orders.map((o: any) => {
        const price = typeof o.price === 'number' ? o.price : Number(o.price || 0)
        const amount = typeof o.amount === 'number' ? o.amount : Number(o.amount || 0)
        const filled = typeof o.filledAmount === 'number' ? o.filledAmount : Number(o.filledAmount || 0)
        const remaining = Math.max(0, amount - filled)
        const total = price * amount
        const fillPct = amount > 0 ? Math.min(1, Math.max(0, filled / amount)) : 0
        const side: 'buy' | 'sell' = (o.orderType === 'sell' ? 'sell' : 'buy')
        return { price, amount, total, side, filled, remaining, fillPct }
      }) : []
      setOrders(entries)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
      setOrders([])
    } finally {
      setIsLoading(false)
    }
  }, [proposalId, side])

  // initial fetch and when deps change
  useEffect(() => {
    if (!auto) return
    if (!proposalId) return
    void fetchOrders()
  }, [auto, proposalId, side, fetchOrders])

  // optional polling fallback
  useEffect(() => {
    if (!auto || !pollMs) return
    const id = setInterval(() => { void fetchOrders() }, pollMs)
    return () => clearInterval(id)
  }, [auto, pollMs, fetchOrders])

  // WebSocket: join orderbook room and refetch on events
  const socketRef = useRef<Socket | null>(null)
  const wsBase = useMemo(() => {
    const http = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001/api'
    const explicit = process.env.NEXT_PUBLIC_WS_URL
    return explicit || http.replace(/\/api$/, '')
  }, [])

  useEffect(() => {
    if (!auto || !proposalId) return

    if (!socketRef.current) {
      socketRef.current = io(wsBase, { transports: ['websocket'] })
    }
    const s = socketRef.current

    const handleConnect = () => {
      s.emit('join-orderbook', proposalId, side)
    }
    const handleOrderbookUpdated = () => { void fetchOrders() }
    const handleNewOrder = () => { void fetchOrders() }
    const handleOrderStatusChange = () => { void fetchOrders() }

    s.on('connect', handleConnect)
    s.on('orderbook-updated', handleOrderbookUpdated)
    s.on('new-order', handleNewOrder)
    s.on('order-status-change', handleOrderStatusChange)

    // Immediately join if already connected
    if (s.connected) {
      s.emit('join-orderbook', proposalId, side)
    }

    return () => {
      try { s.emit('leave-orderbook', proposalId, side) } catch {}
      s.off('connect', handleConnect)
      s.off('orderbook-updated', handleOrderbookUpdated)
      s.off('new-order', handleNewOrder)
      s.off('order-status-change', handleOrderStatusChange)
    }
  }, [auto, proposalId, side, wsBase, fetchOrders])

  return { orders, isLoading, error, refetch: fetchOrders }
}
