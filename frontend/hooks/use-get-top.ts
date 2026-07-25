import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { MarketOption } from '@/lib/types'
import { io, Socket } from 'socket.io-client'

const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001/api'

export interface UseGetTopOptions {
  proposalId: string
  market: MarketOption // 'YES' | 'NO'
  auto?: boolean
  pollMs?: number
}

export interface TopLevel {
  price: string
  amount: string
  orderCount: number
}

export interface TopResult {
  bestBid?: number
  bestAsk?: number
  mid?: number
}

export function useGetTop(options: UseGetTopOptions) {
  const { proposalId, market, auto = true, pollMs } = options
  const side = market === 'YES' ? 'approve' : 'reject'

  const [data, setData] = useState<TopResult>({})
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const computeFromOrdersFallback = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/orderbooks/${proposalId}/${side}/orders`)
      const ct = res.headers.get('content-type') || ''
      if (!res.ok) return false
      let json: any = null
      if (ct.includes('application/json')) json = await res.json()
      else json = { orders: [] }
      const orders = Array.isArray(json?.orders) ? json.orders : []
      const bids: number[] = []
      const asks: number[] = []
      for (const o of orders) {
        const price = typeof o.price === 'number' ? o.price : Number(o.price || 0)
        const orderType = o.orderType || (o.side === 'sell' ? 'sell' : 'buy')
        if (orderType === 'buy') bids.push(price)
        else asks.push(price)
      }
      const bestBid = bids.length ? Math.max(...bids) : undefined
      const bestAsk = asks.length ? Math.min(...asks) : undefined
      let mid: number | undefined = undefined
      if (bestBid !== undefined && bestAsk !== undefined) mid = (bestBid + bestAsk) / 2
      else if (bestBid !== undefined) mid = bestBid
      else if (bestAsk !== undefined) mid = bestAsk
      setData({ bestBid, bestAsk, mid })
      return true
    } catch {
      return false
    }
  }, [proposalId, side])

  const fetchTop = useCallback(async () => {
    if (!proposalId) return
    setIsLoading(true)
    setError(null)
    try {
      const res = await fetch(`${API_BASE}/orderbooks/${proposalId}/${side}/top`)
      const ct = res.headers.get('content-type') || ''
      if (!res.ok) {
        const ok = await computeFromOrdersFallback()
        if (!ok) {
          let errMsg = `Request failed with status ${res.status}`
          if (ct.includes('application/json')) { try { const j = await res.json(); errMsg = j?.error || errMsg } catch {} }
          else { try { const t = await res.text(); if (t) errMsg = `${errMsg}: ${t.slice(0,160)}` } catch {} }
          setError(errMsg)
          setData({})
        }
        return
      }
      if (!ct.includes('application/json')) {
        // Non-JSON; try fallback
        const ok = await computeFromOrdersFallback()
        if (!ok) setError('Unexpected response for /top (not JSON)')
        return
      }
      const json = await res.json()
      const bestBid = json?.bestBid?.price != null ? Number(json.bestBid.price) : undefined
      const bestAsk = json?.bestAsk?.price != null ? Number(json.bestAsk.price) : undefined
      let mid: number | undefined = undefined
      if (bestBid !== undefined && bestAsk !== undefined) mid = (bestBid + bestAsk) / 2
      else if (bestBid !== undefined) mid = bestBid
      else if (bestAsk !== undefined) mid = bestAsk
      setData({ bestBid, bestAsk, mid })
    } catch (e) {
      const ok = await computeFromOrdersFallback()
      if (!ok) {
        setError(e instanceof Error ? e.message : String(e))
        setData({})
      }
    } finally {
      setIsLoading(false)
    }
  }, [proposalId, side, computeFromOrdersFallback])

  // Initial fetch
  useEffect(() => {
    if (!auto) return
    if (!proposalId) return
    void fetchTop()
  }, [auto, proposalId, side, fetchTop])

  // Optional polling
  useEffect(() => {
    if (!auto || !pollMs) return
    const id = setInterval(() => { void fetchTop() }, pollMs)
    return () => clearInterval(id)
  }, [auto, pollMs, fetchTop])

  // WebSocket: join orderbook room and refetch on updates
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

    const handleConnect = () => { s.emit('join-orderbook', proposalId, side) }
    // If backend provides minimal top-of-book payload, consume it directly
    const handleTop = (payload: any) => {
      try {
        if (!payload) return
        // If rooms are set up, we only get our proposal/side, but guard anyway
        if (String(payload.proposalId) !== String(proposalId) || String(payload.side) !== String(side)) return
        const bestBid = payload?.bestBid?.price != null ? Number(payload.bestBid.price) : undefined
        const bestAsk = payload?.bestAsk?.price != null ? Number(payload.bestAsk.price) : undefined
        let mid: number | undefined = undefined
        const midStr = payload?.mid
        if (typeof midStr === 'string') {
          const m = Number(midStr)
          if (!Number.isNaN(m)) mid = m
        }
        if (mid === undefined) {
          if (bestBid !== undefined && bestAsk !== undefined) mid = (bestBid + bestAsk) / 2
          else if (bestBid !== undefined) mid = bestBid
          else if (bestAsk !== undefined) mid = bestAsk
        }
        setData({ bestBid, bestAsk, mid })
      } catch {
        // If something goes wrong, fallback fetch once
        void fetchTop()
      }
    }
    // Fallback triggers when other events arrive but top payload isn't provided
    const handleOrderbookUpdated = () => { void fetchTop() }
    const handleNewOrder = () => { void fetchTop() }
    const handleOrderStatusChange = () => { void fetchTop() }

    s.on('connect', handleConnect)
    s.on('orderbook-top', handleTop)
    s.on('orderbook-updated', handleOrderbookUpdated)
    s.on('new-order', handleNewOrder)
    s.on('order-status-change', handleOrderStatusChange)

    if (s.connected) s.emit('join-orderbook', proposalId, side)

    return () => {
      try { s.emit('leave-orderbook', proposalId, side) } catch {}
      s.off('connect', handleConnect)
      s.off('orderbook-top', handleTop)
      s.off('orderbook-updated', handleOrderbookUpdated)
      s.off('new-order', handleNewOrder)
      s.off('order-status-change', handleOrderStatusChange)
    }
  }, [auto, proposalId, side, wsBase, fetchTop])

  return { ...data, isLoading, error, refetch: fetchTop }
}
