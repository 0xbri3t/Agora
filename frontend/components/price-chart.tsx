"use client"

import { useState } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from "recharts"
import type { PricePoint } from "@/lib/types"

interface PriceChartProps {
  data: PricePoint[]
}

type Timeframe = "1H" | "24H" | "7D"

export function PriceChart({ data }: PriceChartProps) {
  const [timeframe, setTimeframe] = useState<Timeframe>("24H")

  // Filter data based on timeframe
  const filteredData = filterDataByTimeframe(data, timeframe)

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle>Market Prices</CardTitle>
          <div className="flex gap-2">
            {(["1H", "24H", "7D"] as Timeframe[]).map((tf) => (
              <Button
                key={tf}
                variant={timeframe === tf ? "default" : "outline"}
                size="sm"
                onClick={() => setTimeframe(tf)}
              >
                {tf}
              </Button>
            ))}
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <ResponsiveContainer width="100%" height={400}>
          <LineChart data={filteredData}>
            <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
            <XAxis
              dataKey="timestamp"
              tickFormatter={(ts) => new Date(ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
              stroke="hsl(var(--muted-foreground))"
            />
            <YAxis
              stroke="hsl(var(--muted-foreground))"
              domain={[0, 1]}
              tickFormatter={(val) => `$${val.toFixed(2)}`}
            />
            <Tooltip
              contentStyle={{
                backgroundColor: "hsl(var(--card))",
                border: "1px solid hsl(var(--border))",
                borderRadius: "8px",
              }}
              labelFormatter={(ts) => new Date(ts as number).toLocaleString()}
              formatter={(value: number) => [`$${value.toFixed(4)}`, ""]}
            />
            <Legend />
            <Line type="monotone" dataKey="yesPrice" stroke="#00FF85" name="YES" strokeWidth={2} dot={false} />
            <Line type="monotone" dataKey="noPrice" stroke="#EF4444" name="NO" strokeWidth={2} dot={false} />
          </LineChart>
        </ResponsiveContainer>
      </CardContent>
    </Card>
  )
}

function filterDataByTimeframe(data: PricePoint[], timeframe: Timeframe): PricePoint[] {
  const now = Date.now()
  const cutoff = {
    "1H": now - 60 * 60 * 1000,
    "24H": now - 24 * 60 * 60 * 1000,
    "7D": now - 7 * 24 * 60 * 60 * 1000,
  }[timeframe]

  return data.filter((point) => point.timestamp >= cutoff)
}
