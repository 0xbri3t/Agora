"use client"

import { motion, useReducedMotion } from "motion/react"
import { useGetAllProposals } from "@/hooks/use-get-all-proposals"

export function TickerTape() {
  const { proposals } = useGetAllProposals()
  const reducedMotion = useReducedMotion()

  if (proposals.length === 0) return null

  const items = proposals.map((p) => `${p.title} · ${p.state}`)
  // Duplicate content for a seamless loop.
  const track = [...items, ...items]
  const duration = Math.max(items.length * 4, 12)

  return (
    <div className="h-8 w-full overflow-hidden border-y border-border">
      <motion.div
        className="flex h-full w-max items-center gap-8 whitespace-nowrap px-4 font-mono text-xs text-muted-foreground"
        animate={reducedMotion ? undefined : { x: ["0%", "-50%"] }}
        transition={
          reducedMotion
            ? undefined
            : { duration, repeat: Infinity, ease: "linear" }
        }
      >
        {track.map((item, i) => (
          <span key={i} className="tabular-nums">
            {item}
          </span>
        ))}
      </motion.div>
    </div>
  )
}
