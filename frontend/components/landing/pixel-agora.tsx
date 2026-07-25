"use client"

import { useEffect, useState } from "react"
import { PixelatedCanvas } from "@/components/ui/pixelated-canvas"

// Crop of the source photo: trims edge noise so the temple owns the frame.
const CROP = { x: 0.11, y: 0.03, w: 0.85, h: 0.84 }

/**
 * Preprocesses the Athens agora photo: crops to the temple and knocks out
 * sky, clouds and vegetation to transparency so only the temple is sampled
 * by the pixelated canvas.
 */
function useTempleSource() {
  const [src, setSrc] = useState<string | null>(null)

  useEffect(() => {
    const img = new Image()
    img.src = "/agora-athens.jpg"
    img.onload = () => {
      const w = Math.round(img.naturalWidth * CROP.w)
      const h = Math.round(img.naturalHeight * CROP.h)
      const off = document.createElement("canvas")
      off.width = w
      off.height = h
      const ctx = off.getContext("2d")
      if (!ctx) return
      ctx.drawImage(
        img,
        img.naturalWidth * CROP.x,
        img.naturalHeight * CROP.y,
        w,
        h,
        0,
        0,
        w,
        h,
      )
      const imageData = ctx.getImageData(0, 0, w, h)
      const d = imageData.data
      for (let p = 0; p < d.length; p += 4) {
        const r = d[p]
        const g = d[p + 1]
        const b = d[p + 2]
        const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b
        const chroma = Math.max(r, g, b) - Math.min(r, g, b)
        const row = Math.floor(p / 4 / w) / h
        const isSky = b > r + 14 && b > g + 6
        const isCloud = row < 0.5 && lum > 185 && chroma < 38 && b >= r
        const isGreen = g > b + 10 && g >= r - 6 && chroma > 18
        const isShadow = lum < 70
        if (isSky || isCloud || isGreen || isShadow) {
          d[p + 3] = 0
          continue
        }
        // Contrast stretch so lit stone pops against the carved-out shadows.
        const t = Math.min(1, Math.max(0, (lum - 70) / 150))
        const k = 0.55 + t * 0.75
        d[p] = Math.min(255, r * k)
        d[p + 1] = Math.min(255, g * k)
        d[p + 2] = Math.min(255, b * k)
      }
      ctx.putImageData(imageData, 0, 0)
      setSrc(off.toDataURL("image/png"))
    }
  }, [])

  return src
}

export function PixelAgora({ className }: { className?: string }) {
  const src = useTempleSource()

  if (!src) return <div className={className} />

  return (
    <div className={className}>
      <PixelatedCanvas
        src={src}
        width={820}
        height={700}
        cellSize={6}
        dotScale={0.72}
        shape="square"
        backgroundColor=""
        tintColor="#e9e5de"
        tintStrength={0.55}
        objectFit="contain"
        dropoutStrength={0.12}
        interactive
        distortionMode="repel"
        distortionStrength={7}
        distortionRadius={110}
        jitterStrength={4}
        jitterSpeed={3}
        followSpeed={0.2}
        fadeOnLeave
        fadeSpeed={0.08}
        maxFps={45}
      />
    </div>
  )
}
