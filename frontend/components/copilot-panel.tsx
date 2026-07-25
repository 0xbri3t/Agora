"use client"

import { useEffect, useState } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { useCopilotAsk, useCopilotInsights } from "@/hooks/use-copilot"
import { LivingStoa } from "@/components/copilot/living-stoa"
import { SignalFeed } from "@/components/copilot/signal-feed"

const fmtUsdc = (v: string | null) => (v ? (Number(v) / 1e6).toFixed(2) : "—")

export function CopilotPanel({ proposalId }: { proposalId: string }) {
  const { insights, isLoading, error, refetch } = useCopilotInsights(proposalId)
  const { ask, answer, isAsking, error: askError } = useCopilotAsk(proposalId)
  const [question, setQuestion] = useState("")

  // Keep the stoa and the signal feed alive without manual refreshes
  useEffect(() => {
    const id = setInterval(() => { void refetch() }, 10_000)
    return () => clearInterval(id)
  }, [refetch])

  const probability = insights?.impliedProbability
  const yesPct = probability ? probability.bps / 100 : null
  // Capital share drives the stoa: auction split while bootstrapping,
  // implied probability once trading takes over.
  const yesShare = insights?.auction?.yesShareBps != null
    ? insights.auction.yesShareBps / 10_000
    : yesPct != null ? yesPct / 100
    : insights ? 0.5 : null

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0">
        <CardTitle className="text-lg">Copilot</CardTitle>
        <Button variant="ghost" size="sm" onClick={() => refetch()} disabled={isLoading}>
          {isLoading ? "Reading…" : "Refresh"}
        </Button>
      </CardHeader>
      <CardContent className="space-y-4">
        {error && (
          <p className="text-sm text-muted-foreground">Copilot unavailable: {error}</p>
        )}

        {insights && (
          <>
            {yesShare !== null && (
              <div className="space-y-1.5">
                <LivingStoa
                  yesShare={yesShare}
                  bidsYes={insights.auction?.bidsYes ?? 0}
                  bidsNo={insights.auction?.bidsNo ?? 0}
                  leaning={insights.auction?.leaning ?? null}
                />
                <p className="text-xs text-muted-foreground">
                  {insights.auction
                    ? `Uniswap CCA bootstrap · ${insights.auction.bidsYes + insights.auction.bidsNo} bids · ${fmtUsdc(insights.auction.committedUsdc)} USDC committed`
                    : probability
                      ? `Implied probability from ${probability.basis} · ${insights.source}`
                      : "awaiting first signal · capital split evenly"}
                </p>
              </div>
            )}

            <SignalFeed insights={insights} />

            {insights.arbitrage.spread && insights.arbitrage.spread.leading !== "TIED" && (
              <div className="rounded-md border border-border bg-muted/50 p-3 text-sm">
                <p className="font-medium">Forecast spread</p>
                <p className="text-muted-foreground">
                  {fmtUsdc(insights.arbitrage.spread.askYes)} USDC per token if it passes vs{" "}
                  {fmtUsdc(insights.arbitrage.spread.askNo)} if it does not —{" "}
                  {insights.arbitrage.spread.leading} ahead by{" "}
                  {fmtUsdc(insights.arbitrage.spread.gapUsdc6d)} USDC
                  {insights.arbitrage.spread.gapBps !== null &&
                    ` (${(insights.arbitrage.spread.gapBps / 100).toFixed(1)}%)`}
                  .
                </p>
              </div>
            )}

            {insights.arbitrage.violations.map((v) => (
              <div key={v.side} className="rounded-md border border-border bg-muted/50 p-3 text-sm">
                <p className="font-medium">Thin {v.side} side</p>
                <p className="text-muted-foreground">
                  Its {v.makers} makers quote between {fmtUsdc(v.low)} and {fmtUsdc(v.high)} USDC
                  ({(v.gapBps / 100).toFixed(0)}% apart) — little consensus behind that forecast.
                </p>
              </div>
            ))}

            <p className="text-sm leading-relaxed">{insights.summary}</p>
          </>
        )}

        <form
          className="flex items-center gap-2"
          onSubmit={(e) => {
            e.preventDefault()
            void ask(question)
          }}
        >
          <span className="font-mono text-sm text-muted-foreground" aria-hidden>&gt;</span>
          <Input
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            placeholder="ask the agora…"
            disabled={isAsking}
            className="font-mono"
          />
          <Button type="submit" disabled={isAsking || !question.trim()}>
            {isAsking ? "…" : "Ask"}
          </Button>
        </form>
        {askError && <p className="text-sm text-muted-foreground">{askError}</p>}
        {answer && <p className="text-sm leading-relaxed border-t border-border pt-3">{answer}</p>}
      </CardContent>
    </Card>
  )
}
