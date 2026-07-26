"use client"

// Rolling odometer digits (adapted from the reactbits Counter): each digit is
// a column of 0-9 driven by a spring, so value changes roll into place instead
// of swapping. Inherits font/color from the caller; sized via fontSize.
import { motion, MotionValue, useSpring, useTransform } from "motion/react"
import { useEffect } from "react"

function RollDigit({ mv, digit, height }: { mv: MotionValue<number>; digit: number; height: number }) {
  const y = useTransform(mv, (latest) => {
    const placeValue = latest % 10
    const offset = (10 + digit - placeValue) % 10
    let memo = offset * height
    if (offset > 5) memo -= 10 * height
    return memo
  })
  return (
    <motion.span
      style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", y }}
    >
      {digit}
    </motion.span>
  )
}

function normalizeNearInteger(num: number): number {
  const nearest = Math.round(num)
  const tolerance = 1e-9 * Math.max(1, Math.abs(num))
  return Math.abs(num - nearest) < tolerance ? nearest : num
}

function DigitColumn({ place, value, height }: { place: number; value: number; height: number }) {
  const target = Math.floor(normalizeNearInteger(value / place))
  const animated = useSpring(target, { stiffness: 90, damping: 18, mass: 0.6 })
  useEffect(() => {
    animated.set(target)
  }, [animated, target])
  return (
    <span
      style={{
        height,
        position: "relative",
        width: "1ch",
        display: "inline-flex",
        overflow: "hidden",
        fontVariantNumeric: "tabular-nums",
      }}
    >
      {Array.from({ length: 10 }, (_, i) => (
        <RollDigit key={i} mv={animated} digit={i} height={height} />
      ))}
    </span>
  )
}

interface RollingNumberProps {
  value: number
  decimals?: number
  /** Minimum integer digits — pads with rolling zeros (e.g. padTo=2 for 05) */
  padTo?: number
  fontSize?: number
  prefix?: string
  suffix?: string
  className?: string
}

export function RollingNumber({
  value,
  decimals = 0,
  padTo = 1,
  fontSize = 14,
  prefix,
  suffix,
  className,
}: RollingNumberProps) {
  const safe = Number.isFinite(value) ? Math.max(0, value) : 0
  // Extra headroom above/below the glyph so the edge fade never clips it
  const height = Math.round(fontSize * 1.25)
  const intDigits = Math.max(padTo, String(Math.floor(safe)).length)

  const cells: Array<{ key: string; place?: number; char?: string }> = []
  for (let i = 0; i < intDigits; i++) {
    const remaining = intDigits - i
    if (i > 0 && remaining % 3 === 0) cells.push({ key: `sep-${i}`, char: "," })
    cells.push({ key: `int-${remaining}`, place: 10 ** (remaining - 1) })
  }
  if (decimals > 0) {
    cells.push({ key: "dot", char: "." })
    for (let d = 1; d <= decimals; d++) cells.push({ key: `dec-${d}`, place: 10 ** -d })
  }

  const staticCell: React.CSSProperties = { height, display: "inline-flex", alignItems: "center" }

  return (
    <span
      className={className}
      style={{
        display: "inline-flex",
        alignItems: "center",
        lineHeight: 1,
        fontSize,
        fontVariantNumeric: "tabular-nums",
        // Digits fade as they roll past the edges — theme-agnostic (mask, not a
        // painted gradient), and the 18% bands stay clear of the glyph itself.
        WebkitMaskImage: "linear-gradient(to bottom, transparent 0%, black 18%, black 82%, transparent 100%)",
        maskImage: "linear-gradient(to bottom, transparent 0%, black 18%, black 82%, transparent 100%)",
      }}
    >
      {prefix && <span style={staticCell}>{prefix}</span>}
      {cells.map((c) =>
        c.char !== undefined ? (
          <span key={c.key} style={staticCell}>
            {c.char}
          </span>
        ) : (
          <DigitColumn key={c.key} place={c.place!} value={safe} height={height} />
        ),
      )}
      {suffix && <span style={staticCell}>{suffix}</span>}
    </span>
  )
}
