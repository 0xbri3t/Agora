import { useCallback, useEffect, useState } from 'react'

const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001/api'

export interface CopilotInsights {
  source: 'subgraph' | 'mongo'
  proposal: {
    title: string
    status: string
    winner: string | null
    twapYes: string
    twapNo: string
    bestAskYes: string | null
    bestAskNo: string | null
    openAsksYes: number
    openAsksNo: number
  }
  impliedProbability: { bps: number; basis: string } | null
  arbitrage: {
    buyBoth: { askYes: string; askNo: string; edgeUsdc6d: string } | null
    violations: { maker: string; askYes: string; askNo: string; excessUsdc6d: string }[]
  }
  trend: { direction: string; leading: string; points: number } | null
  /** Uniswap CCA bootstrap phase signal (null once trading takes over) */
  auction: {
    clearingYes: string
    clearingNo: string
    bidsYes: number
    bidsNo: number
    committedUsdc: string
    yesShareBps: number | null
    concentrationYesBps: number | null
    concentrationNoBps: number | null
    leaning: string | null
  } | null
  summary: string
}

export function useCopilotInsights(proposalId: string | undefined) {
  const [insights, setInsights] = useState<CopilotInsights | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const refetch = useCallback(async () => {
    if (!proposalId) return
    setIsLoading(true)
    setError(null)
    try {
      const res = await fetch(`${API_BASE}/copilot/${proposalId}/insights`)
      if (!res.ok) throw new Error(`copilot ${res.status}`)
      setInsights(await res.json())
    } catch (e) {
      setError(e instanceof Error ? e.message : 'copilot unavailable')
    } finally {
      setIsLoading(false)
    }
  }, [proposalId])

  useEffect(() => {
    refetch()
  }, [refetch])

  return { insights, isLoading, error, refetch }
}

export function useCopilotAsk(proposalId: string | undefined) {
  const [answer, setAnswer] = useState<string | null>(null)
  const [isAsking, setIsAsking] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const ask = useCallback(
    async (question: string) => {
      if (!proposalId || !question.trim()) return
      setIsAsking(true)
      setError(null)
      setAnswer(null)
      try {
        const res = await fetch(`${API_BASE}/copilot/${proposalId}/ask`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ question }),
        })
        if (!res.ok) throw new Error(`copilot ${res.status}`)
        const data = await res.json()
        setAnswer(data.answer)
      } catch (e) {
        setError(e instanceof Error ? e.message : 'copilot unavailable')
      } finally {
        setIsAsking(false)
      }
    },
    [proposalId]
  )

  return { ask, answer, isAsking, error }
}
