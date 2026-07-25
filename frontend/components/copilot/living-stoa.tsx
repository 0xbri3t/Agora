"use client"

import { motion, useReducedMotion } from "motion/react"

/**
 * The brand stoa, animated by live market data. The two outer columns are the
 * YES and NO markets — their height tracks each side's share of committed
 * capital — and the roof physically tilts toward the side that is winning.
 * The three inner bars meter bid activity. Pure SVG + Motion springs.
 */
export function LivingStoa({
  yesShare,
  bidsYes,
  bidsNo,
  leaning,
}: {
  /** 0..1 — YES side share of capital (or implied probability fallback) */
  yesShare: number
  bidsYes: number
  bidsNo: number
  leaning: string | null
}) {
  const reduced = useReducedMotion()
  const share = Math.min(0.9, Math.max(0.1, yesShare))

  // Roof tilts up to ±5° toward the stronger side (negative = YES/left up)
  const tilt = -(share - 0.5) * 10

  // Column heights: 46..104 px inside the 120px column zone (baseline y=150)
  const colH = (s: number) => 46 + s * 58 / 0.9
  const yesH = colH(share)
  const noH = colH(1 - share)

  // Inner activity bars, normalized against the busier side
  const maxBids = Math.max(bidsYes, bidsNo, 1)
  const inner = [bidsYes / maxBids, (bidsYes + bidsNo) / (2 * maxBids), bidsNo / maxBids]
    .map((f) => 14 + f * 52)

  const spring = reduced ? { duration: 0 } : { type: "spring" as const, stiffness: 70, damping: 14 }
  const yesLeads = share > 0.5
  const noLeads = share < 0.5
  const YES_COLOR = "var(--data-up)"
  const NO_COLOR = "var(--destructive)"
  const INK = "var(--foreground)"

  return (
    <div className="select-none">
      <svg viewBox="0 0 360 196" className="w-full" role="img"
        aria-label={`YES holds ${(share * 100).toFixed(0)}% of committed capital`}>
        {/* Roof: architrave with the logo's wedge, tilting toward the leader */}
        <motion.g
          animate={{ rotate: tilt }}
          transition={spring}
          style={{ transformBox: "fill-box", transformOrigin: "center" }}
        >
          <polygon points="40,26 316,8 316,30 40,40" fill={INK} />
        </motion.g>

        {/* Outer columns: YES left, NO right — height = capital share */}
        <motion.rect
          x={48} width={30}
          animate={{ y: 150 - yesH, height: yesH }}
          transition={spring}
          fill={yesLeads ? YES_COLOR : INK}
        />
        <motion.rect
          x={282} width={30}
          animate={{ y: 150 - noH, height: noH }}
          transition={spring}
          fill={noLeads ? NO_COLOR : INK}
        />

        {/* Inner bars: bid activity meter */}
        {inner.map((h, i) => (
          <motion.rect
            key={i}
            x={124 + i * 46} width={22}
            animate={{ y: 150 - h, height: h }}
            transition={spring}
            fill={INK} opacity={0.45}
          />
        ))}

        {/* Base slab */}
        <rect x={40} y={156} width={276} height={12} fill={INK} />

        {/* Labels */}
        <text x={63} y={186} textAnchor="middle" fontSize={12}
          fill={yesLeads ? YES_COLOR : INK} className="font-mono tabular-nums">
          YES {(share * 100).toFixed(0)}%
        </text>
        <text x={297} y={186} textAnchor="middle" fontSize={12}
          fill={noLeads ? NO_COLOR : INK} className="font-mono tabular-nums">
          NO {((1 - share) * 100).toFixed(0)}%
        </text>
        {leaning && leaning !== "BALANCED" && (
          <text x={180} y={186} textAnchor="middle" fontSize={11} fill={INK} opacity={0.55}
            className="font-mono">
            capital leaning {leaning}
          </text>
        )}
      </svg>
    </div>
  )
}
