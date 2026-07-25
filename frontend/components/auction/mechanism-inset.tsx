"use client"

import { useMemo } from "react"
import { motion, useReducedMotion } from "motion/react"

/** One active bid, straight from BidSubmitted logs (minus exits). */
export type RawBid = { price: number; amount: number }

interface MechanismInsetProps {
  yesBids: RawBid[]
  noBids: RawBid[]
  /** Tokens released by the issuance schedule so far (18d scaled down to whole tokens) */
  releasedTokens: number
  /** Full auction supply in whole tokens */
  totalSupplyTokens: number
  floorPrice: number
  clearingYes: number
  clearingNo: number
  yesColor: string
  noColor: string
}

/**
 * The CCA mechanism, drawn live: cumulative token demand (bids sorted from the
 * highest max price down, each contributing budget/maxPrice tokens) against the
 * supply released so far. Where a side's demand staircase crosses the released
 * supply line IS that side's clearing price; a staircase that never reaches the
 * line means the side clears at the floor — which is exactly why a lone bid
 * doesn't move the price.
 */
export function MechanismInset({
  yesBids,
  noBids,
  releasedTokens,
  totalSupplyTokens,
  floorPrice,
  clearingYes,
  clearingNo,
  yesColor,
  noColor,
}: MechanismInsetProps) {
  const reduced = useReducedMotion()

  const W = 320
  const H = 200
  const PAD = { top: 16, right: 14, bottom: 26, left: 40 }
  const plotW = W - PAD.left - PAD.right
  const plotH = H - PAD.top - PAD.bottom

  // Domains: X in tokens (0..supply), Y in USDC/token (0..peak)
  const maxPrice = useMemo(() => {
    const peak = Math.max(
      floorPrice,
      clearingYes,
      clearingNo,
      ...yesBids.map((b) => b.price),
      ...noBids.map((b) => b.price),
    )
    return peak > 0 ? peak * 1.15 : 1
  }, [floorPrice, clearingYes, clearingNo, yesBids, noBids])
  const maxTokens = totalSupplyTokens > 0 ? totalSupplyTokens : 1

  const x = (tokens: number) => PAD.left + (Math.min(tokens, maxTokens) / maxTokens) * plotW
  const y = (price: number) => PAD.top + plotH - (Math.min(price, maxPrice) / maxPrice) * plotH

  // Demand staircase: sort bids by max price descending; walking down in price,
  // cumulative tokens demanded grows by budget/maxPrice at each bid's level.
  const staircase = (bids: RawBid[]): Array<{ tokens: number; price: number }> => {
    const sorted = [...bids].filter((b) => b.price > 0).sort((a, b) => b.price - a.price)
    const pts: Array<{ tokens: number; price: number }> = []
    let cum = 0
    for (const b of sorted) {
      pts.push({ tokens: cum, price: b.price })
      cum += b.amount / b.price
      pts.push({ tokens: cum, price: b.price })
    }
    return pts
  }

  const path = (pts: Array<{ tokens: number; price: number }>) => {
    if (pts.length === 0) return ""
    return pts.map((p, i) => `${i === 0 ? "M" : "L"}${x(p.tokens).toFixed(1)},${y(p.price).toFixed(1)}`).join(" ")
  }

  const yesPts = useMemo(() => staircase(yesBids), [yesBids])
  const noPts = useMemo(() => staircase(noBids), [noBids])

  const supplyX = x(releasedTokens)
  const ink = "var(--muted-foreground)"

  return (
    <div className="rounded-md border bg-muted/30 p-3">
      <p className="mb-1 text-xs font-medium">The mechanism</p>
      <p className="mb-2 text-xs text-muted-foreground leading-snug">
        Each side&apos;s demand staircase against the supply released so far. The
        dots mark the live clearing prices — they climb as demand outpaces the
        release schedule at checkpoints.
      </p>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label="Demand versus released supply — the crossing sets the clearing price">
        {/* Axes */}
        <line x1={PAD.left} y1={PAD.top + plotH} x2={PAD.left + plotW} y2={PAD.top + plotH} stroke={ink} strokeWidth={1} strokeLinecap="round" opacity={0.5} />
        <line x1={PAD.left} y1={PAD.top} x2={PAD.left} y2={PAD.top + plotH} stroke={ink} strokeWidth={1} strokeLinecap="round" opacity={0.5} />
        <text x={PAD.left + plotW / 2} y={H - 6} textAnchor="middle" fontSize={9} fill={ink}>tokens</text>
        <text x={12} y={PAD.top + plotH / 2} textAnchor="middle" fontSize={9} fill={ink} transform={`rotate(-90 12 ${PAD.top + plotH / 2})`}>USDC / token</text>

        {/* Floor */}
        <line x1={PAD.left} y1={y(floorPrice)} x2={PAD.left + plotW} y2={y(floorPrice)} stroke={ink} strokeWidth={1} strokeDasharray="3 3" strokeLinecap="round" opacity={0.45} />
        <text x={PAD.left + plotW - 2} y={y(floorPrice) - 3} textAnchor="end" fontSize={8.5} fill={ink}>floor</text>

        {/* Released-supply region: everything left of the line is sellable now */}
        <rect x={PAD.left} y={PAD.top} width={Math.max(0, supplyX - PAD.left)} height={plotH} fill={ink} opacity={0.07} />
        <line x1={supplyX} y1={PAD.top} x2={supplyX} y2={PAD.top + plotH} stroke={ink} strokeWidth={1.5} strokeLinecap="round" opacity={0.7} />
        <text x={supplyX + 3} y={PAD.top + 9} fontSize={8.5} fill={ink}>released</text>

        {/* Demand staircases */}
        {noPts.length > 0 && (
          <path d={path(noPts)} fill="none" stroke={noColor} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
        )}
        {yesPts.length > 0 && (
          <path d={path(yesPts)} fill="none" stroke={yesColor} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
        )}

        {/* Clearing crossings — one dot per side at (released, clearing) */}
        {[{ p: clearingYes, c: yesColor, k: "yes" }, { p: clearingNo, c: noColor, k: "no" }].map(({ p, c, k }) => (
          <g key={k}>
            {!reduced && (
              <motion.circle
                cx={supplyX}
                cy={y(p)}
                fill={c}
                initial={{ r: 4, opacity: 0.5 }}
                animate={{ r: [4, 9, 4], opacity: [0.5, 0, 0.5] }}
                transition={{ duration: 2.4, repeat: Infinity, ease: "easeOut" }}
              />
            )}
            <circle cx={supplyX} cy={y(p)} r={4} fill={c} stroke="var(--card)" strokeWidth={1.5} />
          </g>
        ))}
      </svg>
    </div>
  )
}
