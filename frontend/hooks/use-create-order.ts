import { useAccount } from 'wagmi'
import { useCallback, useState } from 'react'
import { useWalletAuth } from '@/hooks/use-wallet-auth'

const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001/api'

export type CreateOrderInput = {
  proposalId: string
  side: 'approve' | 'reject'
  orderType: 'buy' | 'sell'
  orderExecution: 'limit' | 'market'
  price: number
  amount: number
}

export type CreateOrderResult = {
  ok: boolean
  status: number
  data: any
}

export function useCreateOrder() {
  const { address, isConnected } = useAccount()
  const { auth, ensureAuth, clearAuth, setAuth, loading: authLoading } = useWalletAuth()

  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<CreateOrderResult | null>(null)

  const verifyWithServer = useCallback(async (candidate: { address: string; signature: string; message: string; timestamp: number }) => {
    try {
      const res = await fetch(`${API_BASE}/auth/verify`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(candidate),
      })
      return res.ok
    } catch {
      return false
    }
  }, [])

  const createOrder = useCallback(async (input: CreateOrderInput): Promise<CreateOrderResult | null> => {
    setError(null)
    setResult(null)

    if (!isConnected || !address) {
      setError('Wallet not connected')
      return null
    }

    // Resolve auth: use stored, else request
    let authReady = auth
    if (!authReady || !authReady.signature) {
      authReady = await ensureAuth()
    }
    if (!authReady || !authReady.signature) {
      setError('Missing authentication')
      return null
    }

    // Always verify with backend before placing the order
    let isValid = await verifyWithServer({
      address,
      signature: authReady.signature,
      message: authReady.message,
      timestamp: authReady.timestamp,
    })

    if (isValid) {
      setAuth({ ...authReady, verified: true, verifiedAt: Date.now() })
    } else {
      // purge stale local storage and try a forced re-auth once
      clearAuth()
      const fresh = await ensureAuth(true)
      if (!fresh || !fresh.signature) {
        setError('Authentication failed')
        return null
      }
      authReady = fresh
      isValid = await verifyWithServer({ address, signature: fresh.signature, message: fresh.message, timestamp: fresh.timestamp })
      if (!isValid) {
        setError('Authentication verification failed')
        return null
      }
      setAuth({ ...fresh, verified: true, verifiedAt: Date.now() })
    }

    setIsLoading(true)
    const buildBody = (a: typeof authReady) => ({
      address,
      signature: a!.signature,
      message: a!.message,
      timestamp: a!.timestamp,
      orderType: input.orderType,
      orderExecution: input.orderExecution,
      price: input.orderExecution === 'market' ? 0 : Number(input.price || 0),
      amount: Number(input.amount || 0),
    })

    const send = async (a: typeof authReady) => {
      const url = `${API_BASE}/orderbooks/${input.proposalId}/${input.side}/orders`
      return fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(buildBody(a)),
      })
    }

    try {
      let res = await send(authReady)

      // If unauthorized, clear and re-auth once, then retry
      if (res.status === 401 || res.status === 403) {
        clearAuth()
        const fresh = await ensureAuth(true)
        if (!fresh || !fresh.signature) throw new Error('Re-auth failed')
        setAuth({ ...fresh, verified: true, verifiedAt: Date.now() })
        res = await send(fresh)
      }

      // Robust parse like wallet-test
      let data: any
      let responseText = ''
      try {
        responseText = await res.text()
        data = responseText ? JSON.parse(responseText) : { error: 'Empty response from server' }
      } catch (parseError) {
        data = {
          error: 'Invalid response format',
          responseText,
          status: res.status,
          statusText: res.statusText,
        }
      }

      const out: CreateOrderResult = { ok: res.ok, status: res.status, data }
      setResult(out)
      if (!res.ok) setError(data?.error || `Request failed with status ${res.status}`)
      return out
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      setError(msg)
      return null
    } finally {
      setIsLoading(false)
    }
  }, [address, isConnected, auth, ensureAuth, clearAuth, setAuth, verifyWithServer])

  return { createOrder, isLoading: isLoading || authLoading, error, result }
}
