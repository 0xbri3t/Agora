"use client"

import { useEffect, useRef } from "react"

type Cell = {
  x: number
  y: number
  ch: string
  lum: number
  phase: number
  speed: number
  ox: number
  oy: number
}

const CELL_W = 8
const CELL_H = 10
const RAMP = " .·:;+*#%@"
const INK = "233,229,222"
// Source crop: trims the dry-grass strip on the left and edge noise so the
// temple owns the frame.
const CROP = { x: 0.1, y: 0.02, w: 0.88, h: 0.93 }
const HOVER_RADIUS = 95
const HOVER_PUSH = 16

export function AsciiAgora({ className }: { className?: string }) {
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext("2d")
    if (!ctx) return

    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches
    const mouse = { x: -9999, y: -9999 }
    let cells: Cell[] = []
    let raf = 0
    let running = false
    let last = 0
    let cssW = 0
    let cssH = 0

    const img = new Image()
    img.src = "/agora-athens.jpg"

    function buildCells() {
      if (!img.complete || img.naturalWidth === 0 || cssW === 0) return
      const cols = Math.floor(cssW / CELL_W)
      const rows = Math.floor(cssH / CELL_H)
      const off = document.createElement("canvas")
      off.width = cols
      off.height = rows
      const octx = off.getContext("2d")
      if (!octx) return
      octx.drawImage(
        img,
        img.naturalWidth * CROP.x,
        img.naturalHeight * CROP.y,
        img.naturalWidth * CROP.w,
        img.naturalHeight * CROP.h,
        0,
        0,
        cols,
        rows,
      )
      const data = octx.getImageData(0, 0, cols, rows).data
      const next: Cell[] = []
      for (let y = 0; y < rows; y++) {
        for (let x = 0; x < cols; x++) {
          const i = (y * cols + x) * 4
          const r = data[i]
          const g = data[i + 1]
          const b = data[i + 2]
          const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b
          const chroma = Math.max(r, g, b) - Math.min(r, g, b)
          const isSky = b > r + 14 && b > g + 6
          const isCloud = y / rows < 0.5 && lum > 185 && chroma < 38 && b >= r
          const isGreen = g > r + 8 && g > b + 8
          if (isSky || isCloud || isGreen || lum < 26) continue
          const ci = Math.min(RAMP.length - 1, Math.floor((lum / 255) * RAMP.length))
          if (ci === 0) continue
          next.push({
            x,
            y,
            ch: RAMP[ci],
            lum,
            phase: Math.random() * Math.PI * 2,
            speed: 0.5 + Math.random() * 1.2,
            ox: 0,
            oy: 0,
          })
        }
      }
      cells = next
    }

    function draw(t: number) {
      ctx.clearRect(0, 0, cssW, cssH)
      ctx.font = "9px ui-monospace, Menlo, monospace"
      ctx.textAlign = "center"
      ctx.textBaseline = "middle"
      for (const cell of cells) {
        const px = cell.x * CELL_W + CELL_W / 2
        const py = cell.y * CELL_H + CELL_H / 2
        let boost = 0
        if (!reducedMotion) {
          const dx = px - mouse.x
          const dy = py - mouse.y
          const d = Math.hypot(dx, dy)
          let tx = 0
          let ty = 0
          if (d < HOVER_RADIUS) {
            const f = (1 - d / HOVER_RADIUS) ** 2
            tx = (dx / (d || 1)) * f * HOVER_PUSH
            ty = (dy / (d || 1)) * f * HOVER_PUSH
            boost = f * 0.6
          }
          cell.ox += (tx - cell.ox) * 0.14
          cell.oy += (ty - cell.oy) * 0.14
        }
        const tw = reducedMotion ? 1 : 0.7 + 0.3 * Math.sin(t * 0.001 * cell.speed + cell.phase)
        const a = Math.min(1, (0.28 + (cell.lum / 255) * 0.72) * tw + boost)
        ctx.fillStyle = `rgba(${INK},${a})`
        ctx.fillText(cell.ch, px + cell.ox, py + cell.oy)
      }
    }

    function loop(t: number) {
      raf = requestAnimationFrame(loop)
      if (t - last < 33) return
      last = t
      draw(t)
    }

    function start() {
      if (running || cells.length === 0) return
      running = true
      if (reducedMotion) {
        draw(0)
      } else {
        raf = requestAnimationFrame(loop)
      }
    }

    function stop() {
      running = false
      cancelAnimationFrame(raf)
    }

    function resize() {
      const rect = canvas.getBoundingClientRect()
      cssW = rect.width
      cssH = rect.height
      const dpr = window.devicePixelRatio || 1
      canvas.width = Math.round(cssW * dpr)
      canvas.height = Math.round(cssH * dpr)
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      buildCells()
      if (reducedMotion) draw(0)
    }

    img.onload = () => {
      resize()
      start()
    }

    const ro = new ResizeObserver(() => {
      const wasRunning = running
      stop()
      resize()
      if (wasRunning) start()
    })
    ro.observe(canvas)

    const io = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting) start()
      else stop()
    })
    io.observe(canvas)

    const onMove = (e: MouseEvent) => {
      const rect = canvas.getBoundingClientRect()
      mouse.x = e.clientX - rect.left
      mouse.y = e.clientY - rect.top
    }
    const onLeave = () => {
      mouse.x = -9999
      mouse.y = -9999
    }
    canvas.addEventListener("mousemove", onMove)
    canvas.addEventListener("mouseleave", onLeave)

    return () => {
      stop()
      ro.disconnect()
      io.disconnect()
      canvas.removeEventListener("mousemove", onMove)
      canvas.removeEventListener("mouseleave", onLeave)
    }
  }, [])

  return (
    <canvas
      ref={canvasRef}
      className={className}
      aria-label="ASCII rendering of the Temple of Hephaestus in the Ancient Agora of Athens"
      role="img"
    />
  )
}
