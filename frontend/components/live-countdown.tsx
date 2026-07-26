"use client"

import { useEffect, useState } from "react"

// Quiet inline countdown to the end of the live trading window.
// Renders nothing until mounted (avoids SSR/client clock mismatch).
export function LiveCountdown({ endTime }: { endTime?: number }) {
  const endMs =
    typeof endTime === "number" && Number.isFinite(endTime) && endTime > 0
      ? endTime > 1e12
        ? endTime
        : endTime * 1000
      : undefined

  const [now, setNow] = useState<number | null>(null)

  useEffect(() => {
    setNow(Date.now())
    const id = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(id)
  }, [])

  if (!endMs || now === null) return null

  const remaining = Math.max(0, Math.floor((endMs - now) / 1000))
  if (remaining <= 0) {
    return <span className="font-mono text-xs text-muted-foreground">window closed</span>
  }

  const d = Math.floor(remaining / 86400)
  const h = Math.floor((remaining % 86400) / 3600)
  const m = Math.floor((remaining % 3600) / 60)
  const s = remaining % 60
  const pad = (n: number) => String(n).padStart(2, "0")
  const label = d > 0 ? `${d}d ${h}h ${pad(m)}m` : h > 0 ? `${h}h ${pad(m)}m ${pad(s)}s` : `${pad(m)}:${pad(s)}`

  return (
    <span
      className="font-mono text-xs text-muted-foreground tabular-nums"
      title="Time left in the live trading window"
    >
      ends in {label}
    </span>
  )
}
