"use client"

import { useState } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { useCopilotAsk, useCopilotInsights } from "@/hooks/use-copilot"

const fmtUsdc = (v: string | null) => (v ? (Number(v) / 1e6).toFixed(2) : "—")

export function CopilotPanel({ proposalId }: { proposalId: string }) {
  const { insights, isLoading, error, refetch } = useCopilotInsights(proposalId)
  const { ask, answer, isAsking, error: askError } = useCopilotAsk(proposalId)
  const [question, setQuestion] = useState("")

  const probability = insights?.impliedProbability
  const yesPct = probability ? probability.bps / 100 : null

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
            {yesPct !== null && (
              <div className="space-y-1.5">
                <div className="flex justify-between text-sm">
                  <span>YES {yesPct.toFixed(1)}%</span>
                  <span>NO {(100 - yesPct).toFixed(1)}%</span>
                </div>
                <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
                  <div
                    className="h-full rounded-full bg-primary transition-all duration-500"
                    style={{ width: `${yesPct}%` }}
                  />
                </div>
                <p className="text-xs text-muted-foreground">
                  Implied probability from {probability!.basis} · {insights.source}
                </p>
              </div>
            )}

            {insights.arbitrage.buyBoth && (
              <div className="rounded-md border border-border bg-muted/50 p-3 text-sm">
                <p className="font-medium">Arbitrage detected</p>
                <p className="text-muted-foreground">
                  Best YES ({fmtUsdc(insights.arbitrage.buyBoth.askYes)}) + best NO (
                  {fmtUsdc(insights.arbitrage.buyBoth.askNo)}) &lt; 1 USDC — risk-free edge of{" "}
                  {fmtUsdc(insights.arbitrage.buyBoth.edgeUsdc6d)} USDC per basket.
                </p>
              </div>
            )}

            {insights.arbitrage.violations.map((v) => (
              <div key={v.maker} className="rounded-md border border-border bg-muted/50 p-3 text-sm">
                <p className="font-medium">Invariant violation</p>
                <p className="text-muted-foreground">
                  {v.maker.slice(0, 10)}… quotes YES+NO {fmtUsdc(v.askYes)}+{fmtUsdc(v.askNo)}{" "}
                  &gt; 1 USDC.
                </p>
              </div>
            ))}

            <p className="text-sm leading-relaxed">{insights.summary}</p>
          </>
        )}

        <form
          className="flex gap-2"
          onSubmit={(e) => {
            e.preventDefault()
            void ask(question)
          }}
        >
          <Input
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            placeholder="Ask about this market…"
            disabled={isAsking}
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
