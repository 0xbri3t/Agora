import { useAccount } from 'wagmi'
import { useCallback, useState } from 'react'
import { useWalletAuth } from '@/hooks/use-wallet-auth'

const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001/api'

export type CancelOrderResult = {
  ok: boolean
  status: number
  data: any
}

export function useCancelOrder() {
  const { address, isConnected } = useAccount()
  const { auth, ensureAuth, clearAuth, setAuth, loading: authLoading } = useWalletAuth()

  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<CancelOrderResult | null>(null)

  const verifyWithServer = useCallback(
    async (candidate: {
      address: string
      signature: string
      message: string
      timestamp: number
    }) => {
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
    },
    []
  )

  const cancelOrder = useCallback(
    async (orderId: string): Promise<CancelOrderResult | null> => {
      setError(null)
      setResult(null)

      if (!isConnected || !address) {
        setError('Wallet not connected')
        return null
      }

      // Resolve auth
      let authReady = auth
      if (!authReady || !authReady.signature) {
        authReady = await ensureAuth()
      }
      if (!authReady || !authReady.signature) {
        setError('Missing authentication')
        return null
      }

      // Verify with backend before sending
      let isValid = await verifyWithServer({
        address,
        signature: authReady.signature,
        message: authReady.message,
        timestamp: authReady.timestamp,
      })
      if (isValid) {
        setAuth({ ...authReady, verified: true, verifiedAt: Date.now() })
      } else {
        clearAuth()
        const fresh = await ensureAuth(true)
        if (!fresh || !fresh.signature) {
          setError('Authentication failed')
          return null
        }
        authReady = fresh
        isValid = await verifyWithServer({
          address,
          signature: fresh.signature,
          message: fresh.message,
          timestamp: fresh.timestamp,
        })
        if (!isValid) {
          setError('Authentication verification failed')
          return null
        }
        setAuth({ ...fresh, verified: true, verifiedAt: Date.now() })
      }

      setIsLoading(true)
      try {
        const res = await fetch(`${API_BASE}/orderbooks/orders/${orderId}`, {
          method: 'DELETE',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            address,
            signature: authReady.signature,
            message: authReady.message,
            timestamp: authReady.timestamp,
          }),
        })

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

        const out: CancelOrderResult = { ok: res.ok, status: res.status, data }
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
    },
    [address, isConnected, auth, ensureAuth, clearAuth, setAuth, verifyWithServer]
  )

  return { cancelOrder, isLoading: isLoading || authLoading, error, result }
}
