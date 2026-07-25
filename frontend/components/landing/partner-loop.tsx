"use client"

import { useEffect, useState } from "react"
import { motion, useReducedMotion } from "motion/react"

/**
 * The partner stack as a closed loop: Uniswap bootstraps the market, 1inch
 * runs the trading, The Graph indexes it all and feeds the copilot — whose
 * insights flow back into the next bid. A pulse cycles the loop; each node
 * lights up as it passes. Text is static and never gated on animation.
 */

const NODES = [
  {
    x: 160,
    name: "Uniswap",
    engine: "CCA",
    logo: "/logos/uniswap.svg",
    role: "Bootstraps each market — a continuous clearing auction discovers the opening price.",
  },
  {
    x: 480,
    name: "1inch",
    engine: "Aqua · SwapVM",
    logo: "/logos/1inch.svg",
    role: "Runs the trading — self-custodial fill-or-kill lots, settled wallet to wallet.",
  },
  {
    x: 800,
    name: "The Graph",
    engine: "Subgraph",
    logo: "/logos/thegraph.svg",
    role: "Indexes every bid, fill and TWAP — feeds the charts and the copilot.",
  },
] as const

const STAGE_MS = 1500
const INK = "var(--foreground)"

export function PartnerLoop({ className }: { className?: string }) {
  const reduced = useReducedMotion()
  const [stage, setStage] = useState(reduced ? 2 : 0)

  useEffect(() => {
    if (reduced) return
    const id = setInterval(() => setStage((s) => (s + 1) % 3), STAGE_MS)
    return () => clearInterval(id)
  }, [reduced])

  const dur = STAGE_MS / 1000
  // stage 0: Uniswap -> 1inch, stage 1: 1inch -> The Graph, stage 2: return leg
  const pulseAnim = stage === 0
    ? { cx: [160, 480], cy: [60, 60] }
    : stage === 1
      ? { cx: [480, 800], cy: [60, 60] }
      : { cx: [800, 800, 160, 160], cy: [60, 118, 118, 60] }

  const active = (i: number) => (stage === 2 ? i === 0 || i === 2 : i === stage || i === stage + 1)

  return (
    <div className={className}>
      <svg viewBox="0 0 960 132" className="w-full" role="img"
        aria-label="Uniswap bootstraps the market, 1inch runs the trading, The Graph indexes it">
        {/* Forward rail */}
        <line x1={160} y1={60} x2={800} y2={60} stroke={INK} strokeWidth={1.5} opacity={0.15} />
        {/* Return rail */}
        <path d="M800,60 L800,118 L160,118 L160,60" fill="none" stroke={INK} strokeWidth={1.5}
          strokeDasharray="4 5" opacity={0.12} />

        {/* Edge labels */}
        <text x={320} y={50} textAnchor="middle" fontSize={10.5} fill={INK} opacity={0.5} className="font-mono">
          opening price
        </text>
        <text x={640} y={50} textAnchor="middle" fontSize={10.5} fill={INK} opacity={0.5} className="font-mono">
          fills · TWAP
        </text>
        <text x={480} y={112} textAnchor="middle" fontSize={10.5} fill={INK} opacity={0.5} className="font-mono">
          insights → next bid
        </text>

        {/* Travelling pulse */}
        {!reduced && (
          <motion.circle
            r={4.5} fill={INK}
            animate={pulseAnim}
            transition={{ duration: dur, ease: "easeInOut", times: stage === 2 ? [0, 0.25, 0.75, 1] : undefined }}
          />
        )}

        {/* Nodes: bare logos on the rail */}
        {NODES.map((n, i) => (
          <motion.g key={n.name} animate={{ opacity: active(i) ? 1 : 0.45 }}>
            <circle cx={n.x} cy={60} r={30} fill="var(--background)" stroke={INK}
              strokeOpacity={0.18} strokeWidth={1.5} />
            <image href={n.logo} x={n.x - 17} y={43} width={34} height={34} />
          </motion.g>
        ))}
      </svg>

      <div className="mx-auto mt-6 grid max-w-5xl grid-cols-1 gap-8 sm:grid-cols-3">
        {NODES.map((n, i) => (
          <div key={n.name} className="flex flex-col items-center gap-1.5 text-center">
            <div className="flex items-baseline gap-2">
              <span className="font-display text-lg text-foreground">{n.name}</span>
              <span className="font-mono text-[11px] text-muted-foreground/70">{n.engine}</span>
            </div>
            <p className="max-w-[26ch] text-sm leading-relaxed text-muted-foreground">
              {n.role}
            </p>
          </div>
        ))}
      </div>
    </div>
  )
}
