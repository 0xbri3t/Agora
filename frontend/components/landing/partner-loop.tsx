"use client"

import { useEffect, useState } from "react"
import { motion, useReducedMotion } from "motion/react"
import DecryptedText from "@/components/ui/decrypted-text"

/**
 * Partner stack as three horizontal bands, each with its own looping
 * micro-visualization: Uniswap's clearing price staircase, 1inch's
 * fill-or-kill lot grid, The Graph's index rows being written. Deliberately
 * a different visual language from the DecisionFlow rail above it.
 */

const INK = "var(--foreground)"
const UP = "var(--data-up)"

function useTick(ms: number, steps: number, enabled: boolean) {
  const [t, setT] = useState(0)
  useEffect(() => {
    if (!enabled) return
    const id = setInterval(() => setT((v) => (v + 1) % steps), ms)
    return () => clearInterval(id)
  }, [ms, steps, enabled])
  return t
}

/** Uniswap: clearing price staircase climbing from the floor, then reset. */
function ClearingSteps({ animate }: { animate: boolean }) {
  const STEPS = 6
  const t = useTick(520, STEPS + 2, animate)
  const lit = animate ? Math.min(t, STEPS) : STEPS
  return (
    <svg viewBox="0 0 220 96" className="w-full" aria-hidden>
      <line x1={8} y1={84} x2={212} y2={84} stroke={INK} strokeWidth={1.5} opacity={0.25} />
      {Array.from({ length: STEPS }, (_, i) => (
        <motion.rect
          key={i}
          x={16 + i * 33}
          width={22}
          animate={{
            y: 84 - (14 + i * 12),
            height: 14 + i * 12,
            opacity: i < lit ? 0.9 : 0.15,
          }}
          transition={{ duration: 0.3 }}
          fill={i === STEPS - 1 ? UP : INK}
        />
      ))}
      <text x={210} y={20} textAnchor="end" fontSize={9} fill={INK} opacity={0.45} className="font-mono">
        clearing ↑
      </text>
    </svg>
  )
}

/** 1inch: a ladder of lots filling all-or-nothing, one snap at a time. */
function LotGrid({ animate }: { animate: boolean }) {
  const COLS = 8
  const ROWS = 3
  const N = COLS * ROWS
  const t = useTick(240, N + 6, animate)
  const filled = animate ? Math.min(t, N) : N
  return (
    <svg viewBox="0 0 220 96" className="w-full" aria-hidden>
      {Array.from({ length: N }, (_, i) => {
        const c = i % COLS
        const r = Math.floor(i / COLS)
        const isFilled = i < filled
        return (
          <motion.rect
            key={i}
            x={14 + c * 25}
            y={16 + r * 24}
            width={18}
            height={17}
            animate={{ opacity: isFilled ? 0.9 : 0.12 }}
            transition={{ duration: 0.15 }}
            fill={isFilled && (i + 1) % COLS === 0 ? UP : INK}
          />
        )
      })}
      <text x={210} y={12} textAnchor="end" fontSize={9} fill={INK} opacity={0.45} className="font-mono">
        fill-or-kill
      </text>
    </svg>
  )
}

/** The Graph: index rows being written, cursor blinking on the live one. */
function IndexRows({ animate }: { animate: boolean }) {
  const ROWS = 5
  const t = useTick(430, ROWS + 2, animate)
  const written = animate ? Math.min(t, ROWS) : ROWS
  const widths = [150, 118, 164, 96, 138]
  return (
    <svg viewBox="0 0 220 96" className="w-full" aria-hidden>
      {widths.map((w, i) => (
        <g key={i}>
          <motion.rect
            x={14}
            y={14 + i * 16}
            height={7}
            animate={{ width: i < written ? w : 0, opacity: i < written ? 0.55 : 0 }}
            transition={{ duration: 0.35, ease: "easeOut" }}
            fill={INK}
          />
          <rect x={14 + 158} y={14 + i * 16} width={34} height={7}
            fill={INK} opacity={i < written ? 0.2 : 0} />
        </g>
      ))}
      {animate && written < ROWS && (
        <motion.rect
          x={16} y={14 + written * 16} width={7} height={7} fill={UP}
          animate={{ opacity: [1, 0.2, 1] }}
          transition={{ duration: 0.8, repeat: Infinity }}
        />
      )}
      <text x={210} y={12} textAnchor="end" fontSize={9} fill={INK} opacity={0.45} className="font-mono">
        indexing
      </text>
    </svg>
  )
}

const PARTNERS = [
  {
    name: "Uniswap",
    engine: "CCA",
    logo: "/logos/uniswap.svg",
    role: "Bootstraps each market — a continuous clearing auction discovers the opening price.",
    Viz: ClearingSteps,
  },
  {
    name: "1inch",
    engine: "Aqua · SwapVM",
    logo: "/logos/1inch.svg",
    role: "Runs the trading — self-custodial fill-or-kill lots, settled wallet to wallet.",
    Viz: LotGrid,
  },
  {
    name: "The Graph",
    engine: "Subgraph",
    logo: "/logos/thegraph.svg",
    role: "Indexes every bid, fill and TWAP — feeds the charts and the copilot.",
    Viz: IndexRows,
  },
] as const

export function PartnerLoop({ className }: { className?: string }) {
  const reduced = useReducedMotion()
  return (
    <div className={className}>
      <div className="divide-y divide-border border-y border-border">
        {PARTNERS.map(({ name, engine, logo, role, Viz }) => (
          <div
            key={name}
            className="grid grid-cols-1 items-center gap-6 py-8 sm:grid-cols-[minmax(0,7fr)_minmax(0,5fr)] sm:gap-12"
          >
            <div className="flex items-start gap-4">
              <img src={logo} alt="" className="mt-0.5 h-9 w-9 shrink-0" />
              <div className="space-y-1">
                <div className="flex items-baseline gap-2.5">
                  <span className="font-display text-xl text-foreground">{name}</span>
                  <span className="font-mono text-[11px] text-muted-foreground/70">{engine}</span>
                </div>
                <p className="max-w-md text-sm leading-relaxed text-muted-foreground">
                  <DecryptedText
                    text={role}
                    animateOn="inViewHover"
                    sequential
                    speed={5}
                    maxIterations={5}
                    useOriginalCharsOnly={false}
                    characters={"!<>-_\\/[]{}—=+*^?#01"}
                    encryptedClassName="opacity-40"
                  />
                </p>
              </div>
            </div>
            <div className="max-w-[240px] justify-self-center sm:justify-self-end">
              <Viz animate={!reduced} />
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
