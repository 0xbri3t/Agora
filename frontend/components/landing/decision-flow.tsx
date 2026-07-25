"use client"

import { useEffect, useState } from "react"
import { motion, useReducedMotion } from "motion/react"

/**
 * The decision pipeline, animated as a continuous loop: a proposal travels
 * Proposal -> Auction -> Trading -> Execution. Each station's visual plays
 * when the pulse arrives and stays lit. All captions are static text —
 * nothing readable is gated on the animation.
 */

const STATIONS = [
  { x: 120, name: "Proposal", engine: "anyone posts it", detail: "A decision, framed as a market", logo: null, engineW: 0 },
  { x: 360, name: "Auction", engine: "Uniswap CCA", detail: "Clearing price discovers the floor", logo: "/logos/uniswap.svg", engineW: 70 },
  { x: 600, name: "Trading", engine: "1inch Aqua", detail: "YES and NO forecasts compete", logo: "/logos/1inch.svg", engineW: 63 },
  { x: 840, name: "Resolution", engine: "TWAP oracle", detail: "The stronger forecast wins", logo: null, engineW: 0 },
] as const

const YES_SPARK = "M528,168 L548,160 L568,163 L588,150 L608,154 L628,140 L648,143 L672,132"
const NO_SPARK = "M528,150 L548,155 L568,152 L588,160 L608,158 L628,166 L648,163 L672,172"

const STAGE_MS = 1800
const INK = "var(--foreground)"
const YES = "var(--data-up)"
const NO = "var(--destructive)"

export function DecisionFlow({ className }: { className?: string }) {
  const reduced = useReducedMotion()
  const [stage, setStage] = useState(reduced ? 3 : 0)

  useEffect(() => {
    if (reduced) return
    const id = setInterval(() => setStage((s) => (s + 1) % 4), STAGE_MS)
    return () => clearInterval(id)
  }, [reduced])

  const spring = { type: "spring" as const, stiffness: 80, damping: 16 }
  const at = (i: number) => stage >= i

  return (
    <div className={className}>
      <svg viewBox="0 0 960 292" className="w-full" role="img"
        aria-label="A proposal flows through auction, trading and resolution">

        {/* Rail */}
        <line x1={48} y1={206} x2={912} y2={206} stroke={INK} strokeWidth={2} opacity={0.14} />
        {STATIONS.map((s, i) => (
          <motion.rect key={s.name} x={s.x - 4} y={202} width={8} height={8}
            animate={{ opacity: at(i) ? 1 : 0.25 }} fill={INK} />
        ))}

        {/* Travelling pulse */}
        <motion.circle
          cy={206} r={5} fill={INK}
          animate={{ cx: STATIONS[stage].x }}
          transition={reduced ? { duration: 0 } : spring}
        />
        {!reduced && (
          <motion.circle
            cy={206} r={5} fill="none" stroke={INK} strokeWidth={1.5}
            animate={{ cx: STATIONS[stage].x, r: [5, 14], opacity: [0.6, 0] }}
            transition={{ cx: spring, r: { duration: 1.1, repeat: Infinity }, opacity: { duration: 1.1, repeat: Infinity } }}
          />
        )}

        {/* S1 — Proposal: document */}
        <g opacity={at(0) ? 1 : 0.35}>
          <rect x={101} y={102} width={38} height={50} fill="none" stroke={INK} strokeWidth={1.5} />
          {[116, 127, 138].map((y) => (
            <line key={y} x1={109} y1={y} x2={131} y2={y} stroke={INK} strokeWidth={1.5} opacity={0.6} />
          ))}
          <text x={120} y={92} textAnchor="middle" fontSize={12} fill={INK} className="font-mono">?</text>
        </g>

        {/* S2 — Auction: clearing columns rise from the floor */}
        <g opacity={at(1) ? 1 : 0.35}>
          <line x1={310} y1={170} x2={410} y2={170} stroke={INK} strokeWidth={1.5} opacity={0.5} />
          <motion.rect x={330} width={18} fill={YES}
            initial={false}
            animate={at(1) ? { y: 170 - 62, height: 62 } : { y: 170 - 12, height: 12 }}
            transition={reduced ? { duration: 0 } : spring} />
          <motion.rect x={372} width={18} fill={NO}
            initial={false}
            animate={at(1) ? { y: 170 - 40, height: 40 } : { y: 170 - 12, height: 12 }}
            transition={reduced ? { duration: 0 } : { ...spring, delay: 0.15 }} />
          <line x1={310} y1={96} x2={410} y2={96} stroke={INK} strokeWidth={1} strokeDasharray="3 4" opacity={0.35} />
        </g>

        {/* S3 — Trading: YES and NO forecasts race */}
        <g opacity={at(2) ? 1 : 0.35}>
          <motion.path d={YES_SPARK} fill="none" stroke={YES} strokeWidth={2}
            initial={false}
            animate={{ pathLength: at(2) ? 1 : 0.12 }}
            transition={reduced ? { duration: 0 } : { duration: 1.1, ease: "easeOut" }} />
          <motion.path d={NO_SPARK} fill="none" stroke={NO} strokeWidth={2}
            initial={false}
            animate={{ pathLength: at(2) ? 1 : 0.12 }}
            transition={reduced ? { duration: 0 } : { duration: 1.1, ease: "easeOut" }} />
          <text x={684} y={135} fontSize={10} fill={YES} className="font-mono">TWAP</text>
        </g>

        {/* S4 — Execution: the roof lands on the winning column */}
        <g opacity={at(3) ? 1 : 0.35}>
          <motion.rect x={796} width={16} fill={YES}
            initial={false}
            animate={at(3) ? { y: 170 - 58, height: 58 } : { y: 170 - 26, height: 26 }}
            transition={reduced ? { duration: 0 } : spring} />
          <motion.rect x={848} width={16} fill={INK} opacity={0.45}
            initial={false}
            animate={{ y: 170 - 26, height: 26 }} />
          <motion.rect x={784} width={92} height={9} fill={INK}
            initial={false}
            animate={at(3) ? { y: 96, rotate: -4 } : { y: 66, rotate: 0 }}
            transition={reduced ? { duration: 0 } : { ...spring, delay: 0.2 }}
            style={{ transformBox: "fill-box", transformOrigin: "left center" }} />
          <rect x={780} y={170} width={100} height={7} fill={INK} opacity={0.7} />
          {at(3) && (
            <text x={830} y={92} textAnchor="middle" fontSize={10} fill={YES} className="font-mono">
              RESOLVED
            </text>
          )}
        </g>

        {/* Captions — always fully visible */}
        {STATIONS.map((s, i) => (
          <g key={s.name}>
            <text x={s.x} y={240} textAnchor="middle" fontSize={14} fill={INK}
              opacity={at(i) ? 1 : 0.5} className="font-display">
              {s.name}
            </text>
            {s.logo ? (
              <>
                <image href={s.logo} x={s.x - (s.engineW + 18) / 2} y={248} width={13} height={13} />
                <text x={s.x - (s.engineW + 18) / 2 + 18} y={258} textAnchor="start" fontSize={10.5}
                  fill={INK} opacity={0.55} className="font-mono">
                  {s.engine}
                </text>
              </>
            ) : (
              <text x={s.x} y={258} textAnchor="middle" fontSize={10.5} fill={INK} opacity={0.55}
                className="font-mono">
                {s.engine}
              </text>
            )}
            <text x={s.x} y={276} textAnchor="middle" fontSize={11} fill={INK} opacity={0.4}>
              {s.detail}
            </text>
          </g>
        ))}
      </svg>
    </div>
  )
}
