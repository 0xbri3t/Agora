"use client"

import { motion } from "motion/react"
import { cn } from "@/lib/utils"

const PHASES = ["Auction", "Live", "Resolved"] as const
const LABELS: Record<(typeof PHASES)[number], string> = {
  Auction: "Auction",
  Live: "Trading",
  Resolved: "Resolved",
}

/**
 * Compact lifecycle stepper for a proposal: Auction → Trading → Resolved.
 * The connector fills up to the current phase and the active marker pulses.
 * Cancelled renders the auction step in the destructive tone.
 */
export function PhaseStepper({ state }: { state: string }) {
  const cancelled = state === "Cancelled"
  const idx = cancelled ? 0 : Math.max(0, PHASES.indexOf(state as (typeof PHASES)[number]))
  const progress = idx / (PHASES.length - 1)

  return (
    <div className="flex items-center gap-3" aria-label={`Phase: ${cancelled ? "Cancelled" : LABELS[PHASES[idx]]}`}>
      <div className="relative flex w-full max-w-xs items-center">
        {/* Track */}
        <div className="absolute inset-x-1 top-1/2 h-px -translate-y-1/2 bg-border" />
        {/* Fill */}
        <motion.div
          className={cn("absolute left-1 top-1/2 h-px -translate-y-1/2", cancelled ? "bg-destructive" : "bg-foreground")}
          initial={false}
          animate={{ width: `${progress * 100}%` }}
          transition={{ type: "spring", stiffness: 90, damping: 20 }}
        />
        <div className="relative flex w-full items-center justify-between">
          {PHASES.map((p, i) => {
            const done = i < idx
            const current = i === idx
            return (
              <div key={p} className="flex flex-col items-center gap-1.5">
                <span className="relative flex h-2.5 w-2.5 items-center justify-center">
                  {current && !cancelled && (
                    <motion.span
                      className="absolute inline-block h-2.5 w-2.5 bg-foreground"
                      animate={{ scale: [1, 2.1], opacity: [0.45, 0] }}
                      transition={{ duration: 1.3, repeat: Infinity, ease: "easeOut" }}
                    />
                  )}
                  <span
                    className={cn(
                      "inline-block h-2.5 w-2.5",
                      cancelled && current
                        ? "bg-destructive"
                        : done || current
                          ? "bg-foreground"
                          : "border border-border bg-background",
                    )}
                  />
                </span>
                <span
                  className={cn(
                    "font-mono text-[10px] leading-none",
                    cancelled && current
                      ? "text-destructive"
                      : current
                        ? "text-foreground"
                        : "text-muted-foreground/60",
                  )}
                >
                  {cancelled && current ? "Cancelled" : LABELS[p]}
                </span>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
