import { useAccount } from 'wagmi'
import { useCallback, useEffect, useMemo, useState } from 'react'
import type { UserOrder } from '@/lib/types'
import { useWalletAuth } from '@/hooks/use-wallet-auth'

const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001/api'

export interface AuthData {
  signature: string
  message: string
  timestamp: number
}

export interface UseGetUserOrdersOptions {
  authData?: AuthData | null
  status?: string
  proposalId?: string
  autoFetch?: boolean
}

export function useGetUserOrders(options: UseGetUserOrdersOptions = {}) {
  const { authData: overrideAuth = null, status, proposalId, autoFetch = true } = options
  const { address, isConnected } = useAccount()
  const { auth, loading: authLoading } = useWalletAuth()

  const [orders, setOrders] = useState<UserOrder[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Prefer explicit override, then global auth
  const resolvedAuth = useMemo(() => {
    if (overrideAuth?.signature) return overrideAuth
    if (auth?.signature) return {
      signature: auth.signature,
      message: auth.message,
      timestamp: auth.timestamp,
    }
    return null
  }, [overrideAuth?.signature, overrideAuth?.message, overrideAuth?.timestamp, auth?.signature, auth?.message, auth?.timestamp])

  const fetchOrders = useCallback(async () => {
    if (!address || !isConnected) {
      // Not connected -> no orders, no error
      setOrders([])
      setError(null)
      return
    }

    // Must have auth to call protected endpoint
    const a = resolvedAuth
    if (!a?.signature) {
      setOrders([])
      setError(null)
      return
    }

    setIsLoading(true)
    setError(null)
    try {
      const body: Record<string, unknown> = {
        address,
        signature: a.signature,
        message: a.message,
        timestamp: a.timestamp,
      }
      if (status) body.status = status
      if (proposalId) body.proposalId = proposalId

      const res = await fetch(`${API_BASE}/orderbooks/my-orders`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })

      const ct = res.headers.get('content-type') || ''
      if (!res.ok) {
        let errMsg = `Request failed with status ${res.status}`
        if (ct.includes('application/json')) {
          try {
            const data = await res.json()
            errMsg = data?.error || errMsg
          } catch {}
        } else {
          try {
            const text = await res.text()
            if (text) errMsg = `${errMsg}: ${text.slice(0, 160)}`
          } catch {}
        }
        setOrders([])
        setError(errMsg)
        return
      }

      if (!ct.includes('application/json')) {
        const text = await res.text().catch(() => '')
        setOrders([])
        setError(`Unexpected response (not JSON): ${text?.slice(0, 160)}`)
        return
      }

      const data = await res.json()
      setOrders(Array.isArray(data) ? data : [])
      setError(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
      setOrders([])
    } finally {
      setIsLoading(false)
    }
  }, [address, isConnected, resolvedAuth, status, proposalId])

  // No automatic ensureAuth here to avoid prompting on page load.
  // Consumers can trigger ensureAuth explicitly if needed.

  // Fetch whenever we have address + auth
  useEffect(() => {
    if (!autoFetch) return
    if (isConnected && address && resolvedAuth?.signature) {
      void fetchOrders()
    }
  }, [autoFetch, isConnected, address, resolvedAuth?.signature, status, proposalId, fetchOrders])

  return {
    orders,
    isLoading: isLoading || authLoading,
    error, // only real request errors; missing auth yields no error
    refetch: fetchOrders,
  }
}