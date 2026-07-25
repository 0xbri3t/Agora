"use client"

import { useEffect, useRef, useState } from "react"
import { motion, useReducedMotion } from "motion/react"
import type { CopilotInsights } from "@/hooks/use-copilot"

type Signal = { id: number; time: string; text: string; tone: "up" | "down" | "flat" }

const fmtUsdc = (v: string | null | undefined) =>
  v ? (Number(v) / 1e6).toLocaleString(undefined, { maximumFractionDigits: 2 }) : null

function stamp() {
  return new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })
}

/** Derive terminal-feed lines by diffing each insights payload against the last. */
function derive(prev: CopilotInsights | null, next: CopilotInsights): Omit<Signal, "id" | "time">[] {
  const out: Omit<Signal, "id" | "time">[] = []
  const a = next.auction
  const pa = prev?.auction

  if (a && !pa) {
    out.push({ text: `auction live · ${a.bidsYes + a.bidsNo} bids · $${fmtUsdc(a.committedUsdc)} committed`, tone: "flat" })
  }
  if (a && pa) {
    const dBids = a.bidsYes + a.bidsNo - (pa.bidsYes + pa.bidsNo)
    if (dBids > 0) out.push({ text: `+${dBids} bid${dBids > 1 ? "s" : ""} · $${fmtUsdc(a.committedUsdc)} committed`, tone: "flat" })
    if (a.clearingYes !== pa.clearingYes) {
      const upSide = Number(a.clearingYes) > Number(pa.clearingYes)
      out.push({ text: `YES clearing $${fmtUsdc(pa.clearingYes)} → $${fmtUsdc(a.clearingYes)}`, tone: upSide ? "up" : "down" })
    }
    if (a.clearingNo !== pa.clearingNo) {
      const upSide = Number(a.clearingNo) > Number(pa.clearingNo)
      out.push({ text: `NO clearing $${fmtUsdc(pa.clearingNo)} → $${fmtUsdc(a.clearingNo)}`, tone: upSide ? "up" : "down" })
    }
    if (a.leaning !== pa.leaning && a.leaning && a.leaning !== "BALANCED") {
      out.push({ text: `capital now leaning ${a.leaning}`, tone: a.leaning === "YES" ? "up" : "down" })
    }
  }

  const s = next.arbitrage.spread
  const ps = prev?.arbitrage.spread
  if (s && s.leading !== "TIED" && (!ps || ps.leading !== s.leading || ps.gapUsdc6d !== s.gapUsdc6d)) {
    const pct = s.gapBps !== null ? ` (${(s.gapBps / 100).toFixed(1)}%)` : ""
    out.push({ text: `forecast spread: ${s.leading} ahead by $${fmtUsdc(s.gapUsdc6d)}${pct}`, tone: s.leading === "YES" ? "up" : "down" })
  }

  if (next.trend && (!prev?.trend || prev.trend.leading !== next.trend.leading)) {
    out.push({ text: `TWAP trend ${next.trend.direction} · ${next.trend.leading} leading (${next.trend.points} pts)`, tone: next.trend.leading === "YES" ? "up" : "down" })
  }

  for (const v of next.arbitrage.violations) {
    const had = prev?.arbitrage.violations.some((p) => p.side === v.side)
    if (!had) out.push({ text: `thin ${v.side} book: ${v.makers} makers ${(v.gapBps / 100).toFixed(0)}% apart`, tone: "flat" })
  }

  return out
}

export function SignalFeed({ insights }: { insights: CopilotInsights | null }) {
  const [signals, setSignals] = useState<Signal[]>([])
  const prevRef = useRef<CopilotInsights | null>(null)
  const idRef = useRef(0)
  const reduced = useReducedMotion()

  useEffect(() => {
    if (!insights) return
    const fresh = derive(prevRef.current, insights)
    prevRef.current = insights
    if (fresh.length === 0) return
    setSignals((cur) =>
      [...fresh.map((f) => ({ ...f, id: idRef.current++, time: stamp() })), ...cur].slice(0, 8),
    )
  }, [insights])

  if (signals.length === 0) return null

  return (
    <div className="space-y-1 border-t border-border pt-3 font-mono text-xs">
      {signals.map((s) => (
        <motion.div
          key={s.id}
          initial={reduced ? false : { x: -8 }}
          animate={{ x: 0 }}
          transition={{ type: "spring", stiffness: 300, damping: 26 }}
          className="flex gap-2"
        >
          <span className="shrink-0 text-muted-foreground/60 tabular-nums">{s.time}</span>
          <span className={
            s.tone === "up" ? "text-[var(--data-up)]"
            : s.tone === "down" ? "text-[var(--destructive)]"
            : "text-foreground/80"
          }>
            {s.text}
          </span>
        </motion.div>
      ))}
    </div>
  )
}
