'use client'

import { useEffect, useRef, useState } from 'react'
import { useAccount, useSignMessage } from 'wagmi'
import { ConnectButton } from '@rainbow-me/rainbowkit'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Textarea } from '@/components/ui/textarea'
import { io, Socket } from 'socket.io-client'
import { useWalletAuth } from '@/hooks/use-wallet-auth'

const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001/api'

interface AuthData {
  message: string
  timestamp: number
  signature?: string
  instructions?: string
}

interface TestResult {
  test: string
  status: 'SUCCESS' | 'FAILED' | 'ERROR' | 'PARTIAL'
  data: any
  timestamp: string
}

export default function WalletTestPage() {
  const { address, isConnected } = useAccount()
  const { signMessageAsync } = useSignMessage()
  // Use global auth
  const { auth, ensureAuth } = useWalletAuth()
  
  const [authData, setAuthData] = useState<AuthData | null>(null)
  const [testResults, setTestResults] = useState<TestResult[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [orderData, setOrderData] = useState({
    proposalId: '',
    side: 'approve',
    orderType: 'buy',
    orderExecution: 'limit',
    price: '1.0',
    amount: '10'
  })
  const [proposalData, setProposalData] = useState({
    title: 'Test Proposal',
    description: 'This is a test proposal for wallet authentication',
    admin: '',
    collateralToken: '0x742d35Cc6634C0532925a3b8D4c4B2B1',
    maxSupply: '1000000',
    target: '500000'
  })
  const [testProposalId, setTestProposalId] = useState('')
  const [orderIdToCancel, setOrderIdToCancel] = useState('')

  const socketRef = useRef<Socket | null>(null)

  // Ensure global auth on connect
  useEffect(() => {
    if (isConnected) {
      ensureAuth().catch(() => {})
    }
  }, [isConnected, ensureAuth])

  // Sync local page state with global auth
  useEffect(() => {
    if (auth && address) {
      setAuthData({
        message: auth.message,
        timestamp: auth.timestamp,
        signature: auth.signature,
      })
    }
  }, [auth, address])

  // helper to fetch my orders
  const fetchMyOrders = async () => {
    if (!authData?.signature || !address) return
    try {
      const response = await fetch(`${API_BASE}/orderbooks/my-orders`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          address,
          signature: authData.signature,
          message: authData.message,
          timestamp: authData.timestamp
        })
      })
      const data = await response.json()
      setTestResults(prev => [{
        test: 'Get My Orders (Auto)',
        status: response.ok ? 'SUCCESS' : 'FAILED',
        data,
        timestamp: new Date().toLocaleTimeString()
      }, ...prev])
    } catch (e) {
      setTestResults(prev => [{
        test: 'Get My Orders (Auto)',
        status: 'ERROR',
        data: { error: e instanceof Error ? e.message : 'Unknown error' },
        timestamp: new Date().toLocaleTimeString()
      }, ...prev])
    }
  }

  // establish socket and authenticate when we have authData
  useEffect(() => {
    if (!isConnected || !address || !authData?.signature) return

    // lazy init socket
    if (!socketRef.current) {
      const base = (process.env.NEXT_PUBLIC_WS_URL || (process.env.NEXT_PUBLIC_API_URL ? process.env.NEXT_PUBLIC_API_URL.replace(/\/api$/, '') : 'http://localhost:3001'))
      socketRef.current = io(base, { transports: ['websocket'] })
      // log WS init to help debug
      setTestResults(prev => [{
        test: 'WS Init',
        status: 'SUCCESS',
        data: { wsBase: base, apiBase: API_BASE },
        timestamp: new Date().toLocaleTimeString()
      }, ...prev])
    }

    const socket = socketRef.current
    const handleAuthSuccess = (payload?: any) => {
      setTestResults(prev => [{
        test: 'WS Auth Success',
        status: 'SUCCESS',
        data: payload || {},
        timestamp: new Date().toLocaleTimeString()
      }, ...prev])
      socket.emit('subscribe-my-orders')
      // immediate fetch after subscribe
      fetchMyOrders()
    }
    const handleAuthError = (payload: any) => {
      setTestResults(prev => [{
        test: 'WS Auth Error',
        status: 'FAILED',
        data: payload,
        timestamp: new Date().toLocaleTimeString()
      }, ...prev])
    }
    const handleSubscribed = (payload: any) => {
      setTestResults(prev => [{
        test: 'WS Subscribed My Orders',
        status: 'SUCCESS',
        data: payload,
        timestamp: new Date().toLocaleTimeString()
      }, ...prev])
      fetchMyOrders()
    }
    const handleOrdersUpdated = (payload?: any) => {
      setTestResults(prev => [{
        test: 'my-orders-updated (WS Event)',
        status: 'SUCCESS',
        data: payload || {},
        timestamp: new Date().toLocaleTimeString()
      }, ...prev])
      fetchMyOrders()
    }
    const handleConnect = () => {
      setTestResults(prev => [{
        test: 'WS Connected',
        status: 'SUCCESS',
        data: { id: socket.id },
        timestamp: new Date().toLocaleTimeString()
      }, ...prev])
      // authenticate via signed message
      socket.emit('auth-wallet', {
        address,
        signature: authData.signature,
        message: authData.message,
        timestamp: authData.timestamp
      })
    }
    const handleDisconnect = (reason: any) => {
      setTestResults(prev => [{
        test: 'WS Disconnected',
        status: 'PARTIAL',
        data: { reason },
        timestamp: new Date().toLocaleTimeString()
      }, ...prev])
    }
    const handleConnectError = (err: any) => {
      setTestResults(prev => [{
        test: 'WS Connect Error',
        status: 'ERROR',
        data: { message: err?.message || String(err) },
        timestamp: new Date().toLocaleTimeString()
      }, ...prev])
    }

    socket.on('connect', handleConnect)
    socket.on('disconnect', handleDisconnect)
    socket.on('connect_error', handleConnectError)

    socket.on('auth-success', handleAuthSuccess)
    socket.on('auth-error', handleAuthError)

    socket.on('subscribed-my-orders', handleSubscribed)
    socket.on('my-orders-updated', handleOrdersUpdated)

    return () => {
      socket.off('connect', handleConnect)
      socket.off('disconnect', handleDisconnect)
      socket.off('connect_error', handleConnectError)

      socket.off('auth-success', handleAuthSuccess)
      socket.off('auth-error', handleAuthError)

      socket.off('subscribed-my-orders', handleSubscribed)
      socket.off('my-orders-updated', handleOrdersUpdated)
    }
  }, [isConnected, address, authData?.signature, authData?.message, authData?.timestamp])

  // optional: disconnect socket when leaving page
  useEffect(() => {
    return () => {
      if (socketRef.current) {
        try { socketRef.current.disconnect() } catch {}
        socketRef.current = null
      }
    }
  }, [])

  // Test 1: Generate auth message
  const testGenerateMessage = async () => {
    setIsLoading(true)
    try {
      const response = await fetch(`${API_BASE}/auth/message`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ address })
      })
      
      const data = await response.json()
      setTestResults(prev => [{
        test: 'Generate Message',
        status: response.ok ? 'SUCCESS' : 'FAILED',
        data,
        timestamp: new Date().toLocaleTimeString()
      }, ...prev])
      
      if (response.ok) {
        setAuthData(data)
      }
    } catch (error) {
      setTestResults(prev => [{
        test: 'Generate Message',
        status: 'ERROR',
        data: { error: error instanceof Error ? error.message : 'Unknown error' },
        timestamp: new Date().toLocaleTimeString()
      }, ...prev])
    }
    setIsLoading(false)
  }

  // Test 2: Sign message
  const testSignMessage = async () => {
    if (!authData) {
      alert('Generate message first')
      return
    }
    
    setIsLoading(true)
    try {
      const signature = await signMessageAsync({
        message: authData.message
      })
      
      setAuthData(prev => prev ? ({ ...prev, signature }) : null)
      setTestResults(prev => [{
        test: 'Sign Message',
        status: 'SUCCESS',
        data: { signature },
        timestamp: new Date().toLocaleTimeString()
      }, ...prev])
    } catch (error) {
      setTestResults(prev => [{
        test: 'Sign Message',
        status: 'ERROR',
        data: { error: error instanceof Error ? error.message : 'Unknown error' },
        timestamp: new Date().toLocaleTimeString()
      }, ...prev])
    }
    setIsLoading(false)
  }

  // Test 3: Verify signature
  const testVerifySignature = async () => {
    if (!authData?.signature) {
      alert('Sign message first')
      return
    }
    
    setIsLoading(true)
    try {
      const response = await fetch(`${API_BASE}/auth/verify`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          address,
          signature: authData.signature,
          message: authData.message,
          timestamp: authData.timestamp
        })
      })
      
      const data = await response.json()
      setTestResults(prev => [{
        test: 'Verify Signature',
        status: response.ok ? 'SUCCESS' : 'FAILED',
        data,
        timestamp: new Date().toLocaleTimeString()
      }, ...prev])
    } catch (error) {
      setTestResults(prev => [{
        test: 'Verify Signature',
        status: 'ERROR',
        data: { error: error instanceof Error ? error.message : 'Unknown error' },
        timestamp: new Date().toLocaleTimeString()
      }, ...prev])
    }
    setIsLoading(false)
  }

  // Test 4: Create order (protected endpoint)
  const testCreateOrder = async () => {
    if (!authData?.signature) {
      alert('Complete authentication first')
      return
    }

    if (!orderData.proposalId.trim()) {
      alert('Please enter a Proposal ID')
      return
    }
    
    setIsLoading(true)
    try {
      const requestBody = {
        address,
        signature: authData.signature,
        message: authData.message,
        timestamp: authData.timestamp,
        orderType: orderData.orderType,
        orderExecution: orderData.orderExecution,
        price: orderData.orderExecution === 'market' ? 0 : parseFloat(orderData.price),
        amount: parseFloat(orderData.amount)
      }

      console.log('Creating order with:', requestBody) // Debug log

      const response = await fetch(`${API_BASE}/orderbooks/${orderData.proposalId}/${orderData.side}/orders`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(requestBody)
      })
      
      let data
      let responseText = ''
      
      try {
        responseText = await response.text()
        if (responseText) {
          data = JSON.parse(responseText)
        } else {
          data = { error: 'Empty response from server' }
        }
      } catch (parseError) {
        console.error('JSON parse error:', parseError)
        data = { 
          error: 'Invalid response format',
          responseText: responseText,
          parseError: parseError instanceof Error ? parseError.message : 'JSON parse error',
          status: response.status,
          statusText: response.statusText
        }
      }
      
      setTestResults(prev => [{
        test: 'Create Order (Protected)',
        status: response.ok ? 'SUCCESS' : 'FAILED',
        data,
        timestamp: new Date().toLocaleTimeString()
      }, ...prev])
    } catch (error) {
      console.error('Create order error:', error)
      setTestResults(prev => [{
        test: 'Create Order (Protected)',
        status: 'ERROR',
        data: { 
          error: error instanceof Error ? error.message : 'Unknown error',
          stack: error instanceof Error ? error.stack : undefined,
          name: error instanceof Error ? error.name : undefined
        },
        timestamp: new Date().toLocaleTimeString()
      }, ...prev])
    }
    setIsLoading(false)
  }

  // Test 5: Get my orders
  const testGetMyOrders = async () => {
    if (!authData?.signature) {
      alert('Complete authentication first')
      return
    }
    
    setIsLoading(true)
    try {
      const response = await fetch(`${API_BASE}/orderbooks/my-orders`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          address,
          signature: authData.signature,
          message: authData.message,
          timestamp: authData.timestamp
        })
      })
      
      const data = await response.json()
      setTestResults(prev => [{
        test: 'Get My Orders',
        status: response.ok ? 'SUCCESS' : 'FAILED',
        data,
        timestamp: new Date().toLocaleTimeString()
      }, ...prev])
    } catch (error) {
      setTestResults(prev => [{
        test: 'Get My Orders',
        status: 'ERROR',
        data: { error: error instanceof Error ? error.message : 'Unknown error' },
        timestamp: new Date().toLocaleTimeString()
      }, ...prev])
    }
    setIsLoading(false)
  }

  // Test 6: Get market data (public)
  const testGetMarketData = async () => {
    setIsLoading(true)
    try {
      const response = await fetch(`${API_BASE}/orderbooks/${testProposalId}/approve/market-data`)
      
      const data = await response.json()
      setTestResults(prev => [{
        test: 'Get Market Data (Public)',
        status: response.ok ? 'SUCCESS' : 'FAILED',
        data,
        timestamp: new Date().toLocaleTimeString()
      }, ...prev])
    } catch (error) {
      setTestResults(prev => [{
        test: 'Get Market Data (Public)',
        status: 'ERROR',
        data: { error: error instanceof Error ? error.message : 'Unknown error' },
        timestamp: new Date().toLocaleTimeString()
      }, ...prev])
    }
    setIsLoading(false)
  }

  // Test 7: Get TWAP (public)
  const testGetTWAP = async () => {
    setIsLoading(true)
    try {
      const response = await fetch(`${API_BASE}/orderbooks/${testProposalId}/approve/twap`)
      
      const data = await response.json()
      setTestResults(prev => [{
        test: 'Get TWAP (Public)',
        status: response.ok ? 'SUCCESS' : 'FAILED',
        data,
        timestamp: new Date().toLocaleTimeString()
      }, ...prev])
    } catch (error) {
      setTestResults(prev => [{
        test: 'Get TWAP (Public)',
        status: 'ERROR',
        data: { error: error instanceof Error ? error.message : 'Unknown error' },
        timestamp: new Date().toLocaleTimeString()
      }, ...prev])
    }
    setIsLoading(false)
  }

  // Test 8: Get Candles (public)
  const testGetCandles = async () => {
    setIsLoading(true)
    try {
      const response = await fetch(`${API_BASE}/orderbooks/${testProposalId}/approve/candles?interval=1h&limit=10`)
      
      const data = await response.json()
      setTestResults(prev => [{
        test: 'Get Candles (Public)',
        status: response.ok ? 'SUCCESS' : 'FAILED',
        data,
        timestamp: new Date().toLocaleTimeString()
      }, ...prev])
    } catch (error) {
      setTestResults(prev => [{
        test: 'Get Candles (Public)',
        status: 'ERROR',
        data: { error: error instanceof Error ? error.message : 'Unknown error' },
        timestamp: new Date().toLocaleTimeString()
      }, ...prev])
    }
    setIsLoading(false)
  }

  // Test 9: Get all proposals (public)
  const testGetProposals = async () => {
    setIsLoading(true)
    try {
      console.log('Fetching all proposals from:', `${API_BASE}/proposals`)

      const response = await fetch(`${API_BASE}/proposals`)
      
      let data
      let responseText = ''
      
      try {
        responseText = await response.text()
        if (responseText) {
          data = JSON.parse(responseText)
        } else {
          data = { error: 'Empty response from server' }
        }
      } catch (parseError) {
        console.error('JSON parse error:', parseError)
        data = { 
          error: 'Invalid response format',
          responseText: responseText,
          parseError: parseError instanceof Error ? parseError.message : 'JSON parse error',
          status: response.status,
          statusText: response.statusText
        }
      }

      // Add helpful information
      const resultData = {
        ...data,
        count: Array.isArray(data) ? data.length : 'Not an array',
        responseStatus: response.status,
        responseOk: response.ok
      }

      setTestResults(prev => [{
        test: 'Get All Proposals (Public)',
        status: response.ok ? 'SUCCESS' : 'FAILED',
        data: resultData,
        timestamp: new Date().toLocaleTimeString()
      }, ...prev])
    } catch (error) {
      console.error('Get proposals error:', error)
      setTestResults(prev => [{
        test: 'Get All Proposals (Public)',
        status: 'ERROR',
        data: { 
          error: error instanceof Error ? error.message : 'Unknown error',
          stack: error instanceof Error ? error.stack : undefined,
          name: error instanceof Error ? error.name : undefined
        },
        timestamp: new Date().toLocaleTimeString()
      }, ...prev])
    }
    setIsLoading(false)
  }

  // Test 10: Create proposal (protected)
  const testCreateProposal = async () => {
    if (!authData?.signature) {
      alert('Complete authentication first')
      return
    }
    
    setIsLoading(true)
    try {
      const currentTime = Math.floor(Date.now() / 1000)
      const response = await fetch(`${API_BASE}/proposals`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          address,
          signature: authData.signature,
          message: authData.message,
          timestamp: authData.timestamp,
          ...proposalData,
          admin: address, // Set admin to current wallet address
          data: JSON.stringify({ // Add required data field
            category: 'governance',
            tags: ['test', 'wallet-auth'],
            metadata: {
              createdVia: 'wallet-test-interface',
              userAgent: 'web'
            }
          }),
          startTime: currentTime, // Add required startTime
          endTime: currentTime + (7 * 24 * 60 * 60), // Add required endTime (7 days from now)
          duration: 7 * 24 * 60 * 60 // Add required duration (7 days in seconds)
        })
      })
      
      const data = await response.json()
      setTestResults(prev => [{
        test: 'Create Proposal (Protected)',
        status: response.ok ? 'SUCCESS' : 'FAILED',
        data,
        timestamp: new Date().toLocaleTimeString()
      }, ...prev])
      if (response.ok && data?.id) {
        setTestProposalId(String(data.id))
        setOrderData(prev => ({ ...prev, proposalId: String(data.id) }))
      }
    } catch (error) {
      setTestResults(prev => [{
        test: 'Create Proposal (Protected)',
        status: 'ERROR',
        data: { error: error instanceof Error ? error.message : 'Unknown error' },
        timestamp: new Date().toLocaleTimeString()
      }, ...prev])
    }
    setIsLoading(false)
  }

  // Test 11: Get my trades (protected)
  const testGetMyTrades = async () => {
    if (!authData?.signature) {
      alert('Complete authentication first')
      return
    }
    
    setIsLoading(true)
    try {
      const response = await fetch(`${API_BASE}/orderbooks/my-trades`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          address,
          signature: authData.signature,
          message: authData.message,
          timestamp: authData.timestamp
        })
      })
      
      const data = await response.json()
      setTestResults(prev => [{
        test: 'Get My Trades (Protected)',
        status: response.ok ? 'SUCCESS' : 'FAILED',
        data,
        timestamp: new Date().toLocaleTimeString()
      }, ...prev])
    } catch (error) {
      setTestResults(prev => [{
        test: 'Get My Trades (Protected)',
        status: 'ERROR',
        data: { error: error instanceof Error ? error.message : 'Unknown error' },
        timestamp: new Date().toLocaleTimeString()
      }, ...prev])
    }
    setIsLoading(false)
  }

  // Test 12: Cancel order (protected)
  const testCancelOrder = async () => {
    if (!authData?.signature) {
      alert('Complete authentication first')
      return
    }
    
    if (!orderIdToCancel.trim()) {
      alert('Enter order ID to cancel')
      return
    }
    
    setIsLoading(true)
    try {
      console.log('Cancelling order:', orderIdToCancel) // Debug log

      const response = await fetch(`${API_BASE}/orderbooks/orders/${orderIdToCancel}`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          address,
          signature: authData.signature,
          message: authData.message,
          timestamp: authData.timestamp
        })
      })
      
      let data
      let responseText = ''
      
      try {
        responseText = await response.text()
        if (responseText) {
          data = JSON.parse(responseText)
        } else {
          data = { error: 'Empty response from server' }
        }
      } catch (parseError) {
        console.error('JSON parse error:', parseError)
        data = { 
          error: 'Invalid response format',
          responseText: responseText,
          parseError: parseError instanceof Error ? parseError.message : 'JSON parse error',
          status: response.status,
          statusText: response.statusText
        }
      }

      setTestResults(prev => [{
        test: 'Cancel Order (Protected)',
        status: response.ok ? 'SUCCESS' : 'FAILED',
        data,
        timestamp: new Date().toLocaleTimeString()
      }, ...prev])
    } catch (error) {
      console.error('Cancel order error:', error)
      setTestResults(prev => [{
        test: 'Cancel Order (Protected)',
        status: 'ERROR',
        data: { 
          error: error instanceof Error ? error.message : 'Unknown error',
          stack: error instanceof Error ? error.stack : undefined,
          name: error instanceof Error ? error.name : undefined
        },
        timestamp: new Date().toLocaleTimeString()
      }, ...prev])
    }
    setIsLoading(false)
  }

  // Test 13: Get my proposals (protected)
  const testGetMyProposals = async () => {
    if (!authData?.signature) {
      alert('Complete authentication first')
      return
    }
    
    setIsLoading(true)
    try {
      const response = await fetch(`${API_BASE}/proposals`)
      
      const data = await response.json()
      // Filter by current user's address
      const myProposals = data.filter((proposal: any) => 
        proposal.admin && proposal.admin.toLowerCase() === address?.toLowerCase()
      )
      
      setTestResults(prev => [{
        test: 'Get My Proposals (Filtered)',
        status: response.ok ? 'SUCCESS' : 'FAILED',
        data: myProposals,
        timestamp: new Date().toLocaleTimeString()
      }, ...prev])
    } catch (error) {
      setTestResults(prev => [{
        test: 'Get My Proposals (Filtered)',
        status: 'ERROR',
        data: { error: error instanceof Error ? error.message : 'Unknown error' },
        timestamp: new Date().toLocaleTimeString()
      }, ...prev])
    }
    setIsLoading(false)
  }

  // Test 14: Simulate authenticated trading (protected)
  const testAuthenticatedTrading = async () => {
    if (!authData?.signature) {
      alert('Complete authentication first')
      return
    }
    
    setIsLoading(true)
    try {
      // Test multiple authenticated operations in sequence
      const operations = [
        { name: 'My Orders', endpoint: '/orderbooks/my-orders' },
        { name: 'My Trades', endpoint: '/orderbooks/my-trades' }
      ]
      
      const results: Array<{
        operation: string
        status: 'SUCCESS' | 'FAILED' | 'ERROR'
        data: any
      }> = []
      
      for (const operation of operations) {
        try {
          const response = await fetch(`${API_BASE}${operation.endpoint}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              address,
              signature: authData.signature,
              message: authData.message,
              timestamp: authData.timestamp
            })
          })
          
          const data = await response.json()
          results.push({
            operation: operation.name,
            status: response.ok ? 'SUCCESS' : 'FAILED',
            data: data
          })
        } catch (error) {
          results.push({
            operation: operation.name,
            status: 'ERROR',
            data: { error: error instanceof Error ? error.message : 'Unknown error' }
          })
        }
      }
      
      setTestResults(prev => [{
        test: 'Batch Authenticated Operations',
        status: results.every(r => r.status === 'SUCCESS') ? 'SUCCESS' : 'PARTIAL',
        data: results,
        timestamp: new Date().toLocaleTimeString()
      }, ...prev])
    } catch (error) {
      setTestResults(prev => [{
        test: 'Batch Authenticated Operations',
        status: 'ERROR',
        data: { error: error instanceof Error ? error.message : 'Unknown error' },
        timestamp: new Date().toLocaleTimeString()
      }, ...prev])
    }
    setIsLoading(false)
  }

  const clearResults = () => {
    setTestResults([])
    setAuthData(null)
  }

  return (
    <div className="container mx-auto p-6">
      <div className="text-center space-y-2 mb-6">
        <h1 className="text-3xl font-bold">Wallet Authentication Testing</h1>
        <p className="text-muted-foreground">Test wallet verification with backend endpoints</p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left Column - Controls */}
        <div className="lg:col-span-2 space-y-6">

      {/* Wallet Connection */}
      <Card>
        <CardHeader>
          <CardTitle>1. Wallet Connection</CardTitle>
          <CardDescription>Connect your wallet using Rainbow Kit</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex items-center justify-between">
            <div>
              {isConnected ? (
                <div className="space-y-1">
                  <Badge variant="outline">Connected</Badge>
                  <p className="text-sm font-mono">{address}</p>
                </div>
              ) : (
                <Badge variant="destructive">Not Connected</Badge>
              )}
            </div>
            <ConnectButton />
          </div>
        </CardContent>
      </Card>

      {/* Authentication Tests */}
      {isConnected && (
        <Card>
          <CardHeader>
            <CardTitle>2. Authentication Flow</CardTitle>
            <CardDescription>Test the complete wallet authentication process</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <Button 
                onClick={testGenerateMessage} 
                disabled={isLoading}
                variant="outline"
              >
                Generate Message
              </Button>
              <Button 
                onClick={testSignMessage} 
                disabled={isLoading || !authData}
                variant="outline"
              >
                Sign Message
              </Button>
              <Button 
                onClick={testVerifySignature} 
                disabled={isLoading || !authData?.signature}
                variant="outline"
              >
                Verify Signature
              </Button>
            </div>
            
            {authData && (
              <div className="p-4 bg-muted rounded-lg">
                <h4 className="font-semibold mb-2">Current Auth Data:</h4>
                <pre className="text-xs overflow-auto">
                  {JSON.stringify(authData, null, 2)}
                </pre>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Protected Endpoints Test */}
      {isConnected && authData?.signature && (
        <Card>
          <CardHeader>
            <CardTitle>3. Protected Endpoints</CardTitle>
            <CardDescription>Test endpoints that require wallet authentication</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {/* Order Creation Form */}
            <div className="grid grid-cols-2 md:grid-cols-6 gap-4">
              <Input 
                placeholder="Proposal ID"
                value={orderData.proposalId}
                onChange={(e) => setOrderData(prev => ({ ...prev, proposalId: e.target.value }))}
              />
              <select 
                className="px-3 py-2 border rounded"
                value={orderData.side}
                onChange={(e) => setOrderData(prev => ({ ...prev, side: e.target.value }))}
              >
                <option value="approve">Approve</option>
                <option value="reject">Reject</option>
              </select>
              <select 
                className="px-3 py-2 border rounded"
                value={orderData.orderType}
                onChange={(e) => setOrderData(prev => ({ ...prev, orderType: e.target.value }))}
              >
                <option value="buy">Buy</option>
                <option value="sell">Sell</option>
              </select>
              <select 
                className="px-3 py-2 border rounded"
                value={orderData.orderExecution}
                onChange={(e) => setOrderData(prev => ({ ...prev, orderExecution: e.target.value }))}
              >
                <option value="limit">Limit</option>
                <option value="market">Market</option>
              </select>
              <Input 
                placeholder="Price"
                value={orderData.price}
                onChange={(e) => setOrderData(prev => ({ ...prev, price: e.target.value }))}
                disabled={orderData.orderExecution === 'market'}
              />
              <Input 
                placeholder="Amount"
                value={orderData.amount}
                onChange={(e) => setOrderData(prev => ({ ...prev, amount: e.target.value }))}
              />
            </div>
            
            <div className="flex gap-4 flex-wrap">
              <Button 
                onClick={testCreateOrder} 
                disabled={isLoading || !orderData.proposalId}
              >
                Create Order
              </Button>
              <Button 
                onClick={testGetMyOrders} 
                disabled={isLoading}
                variant="outline"
              >
                Get My Orders
              </Button>
              <Button 
                onClick={() => setOrderData(prev => ({ ...prev, proposalId: testProposalId }))}
                disabled={!testProposalId}
                variant="secondary"
                size="sm"
              >
                Use Last Proposal ID
              </Button>
            </div>
            
            <div className="text-sm text-muted-foreground bg-muted/50 p-3 rounded">
              <strong>Order Types:</strong> 
              <br />• <strong>Limit Order:</strong> Executes at specified price or better
              <br />• <strong>Market Order:</strong> Executes immediately at best available price (price field ignored)
              {orderData.orderExecution === 'market' && (
                <span>
                  <br />• <em>Market order selected - will execute at current market price</em>
                </span>
              )}
            </div>

            {/* Order Management Section */}
            <div className="border-t pt-4 space-y-4">
              <h4 className="font-semibold">Order Management (Protected)</h4>
              <div className="flex gap-4 items-end">
                <div className="flex-1">
                  <Input 
                    placeholder="Order ID to cancel"
                    value={orderIdToCancel}
                    onChange={(e) => setOrderIdToCancel(e.target.value)}
                  />
                </div>
                <Button 
                  onClick={testCancelOrder} 
                  disabled={isLoading || !orderIdToCancel}
                  variant="destructive"
                  size="sm"
                >
                  Cancel Order
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Additional Protected Endpoints */}
      {isConnected && authData?.signature && (
        <Card>
          <CardHeader>
            <CardTitle>3.5. Additional Protected Operations</CardTitle>
            <CardDescription>More wallet-authenticated operations</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex gap-4">
              <Button 
                onClick={testGetMyProposals} 
                disabled={isLoading}
                variant="outline"
              >
                Get My Proposals (Filter)
              </Button>
              <Button 
                onClick={testGetMyTrades} 
                disabled={isLoading}
                variant="outline"
              >
                Get My Trades
              </Button>
              <Button 
                onClick={testAuthenticatedTrading} 
                disabled={isLoading}
                className="bg-purple-600 hover:bg-purple-700"
              >
                Batch Auth Test
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Public Endpoints Test */}
      <Card>
        <CardHeader>
          <CardTitle>4. Public Endpoints</CardTitle>
          <CardDescription>Test public endpoints that don't require authentication</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Input 
              placeholder="Test Proposal ID"
              value={testProposalId}
              onChange={(e) => setTestProposalId(e.target.value)}
            />
          </div>
          
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <Button 
              onClick={testGetMarketData} 
              disabled={isLoading || !testProposalId}
              variant="outline"
            >
              Get Market Data
            </Button>
            <Button 
              onClick={testGetTWAP} 
              disabled={isLoading || !testProposalId}
              variant="outline"
            >
              Get TWAP
            </Button>
            <Button 
              onClick={testGetCandles} 
              disabled={isLoading || !testProposalId}
              variant="outline"
            >
              Get Candles
            </Button>
            <Button 
              onClick={testGetProposals} 
              disabled={isLoading}
              variant="outline"
            >
              Get All Proposals
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Proposal Management Test */}
      {isConnected && authData?.signature && (
        <Card>
          <CardHeader>
            <CardTitle>5. Proposal Management</CardTitle>
            <CardDescription>Test proposal creation and management (protected)</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {/* Removed editable Proposal ID, backend generates it */}
              <Input 
                placeholder="Proposal Title"
                value={proposalData.title}
                onChange={(e) => setProposalData(prev => ({ ...prev, title: e.target.value }))}
              />
              <Input 
                placeholder="Collateral Token Address"
                value={proposalData.collateralToken}
                onChange={(e) => setProposalData(prev => ({ ...prev, collateralToken: e.target.value }))}
              />
              <Input 
                placeholder="Max Supply"
                value={proposalData.maxSupply}
                onChange={(e) => setProposalData(prev => ({ ...prev, maxSupply: e.target.value }))}
              />
              <Input 
                placeholder="Target"
                value={proposalData.target}
                onChange={(e) => setProposalData(prev => ({ ...prev, target: e.target.value }))}
              />
            </div>
            <Textarea 
              placeholder="Proposal Description"
              value={proposalData.description}
              onChange={(e) => setProposalData(prev => ({ ...prev, description: e.target.value }))}
              rows={3}
            />
            
            <div className="flex gap-4 flex-wrap">
              <Button 
                onClick={testCreateProposal} 
                disabled={isLoading}
              >
                Create Proposal
              </Button>
              {/* Removed Generate New ID button */}
            </div>
          </CardContent>
        </Card>
      )}

        </div>

        {/* Right Column - Results */}
        <div className="lg:col-span-1">
          <Card className="sticky top-6">
            <CardHeader>
              <CardTitle className="flex items-center justify-between">
                Test Results
                <Button onClick={clearResults} variant="outline" size="sm">
                  Clear
                </Button>
              </CardTitle>
            </CardHeader>
            <CardContent>
              {testResults.length === 0 ? (
                <p className="text-muted-foreground text-center py-8">No test results yet</p>
              ) : (
                <div className="space-y-4 max-h-[calc(100vh-200px)] overflow-y-auto">
                  {testResults.map((result, index) => (
                    <div key={index} className="border rounded-lg p-4">
                      <div className="flex items-center justify-between mb-2">
                        <h4 className="font-semibold text-sm">{result.test}</h4>
                        <div className="flex items-center gap-2">
                          <Badge 
                            variant={
                              result.status === 'SUCCESS' ? 'default' : 
                              result.status === 'FAILED' ? 'destructive' :
                              result.status === 'PARTIAL' ? 'outline' : 'secondary'
                            }
                          >
                            {result.status}
                          </Badge>
                          <span className="text-xs text-muted-foreground">{result.timestamp}</span>
                        </div>
                      </div>
                      <Textarea
                        readOnly
                        value={JSON.stringify(result.data, null, 2)}
                        className="font-mono text-xs"
                        rows={Math.min(6, JSON.stringify(result.data, null, 2).split('\n').length)}
                      />
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  )
}
