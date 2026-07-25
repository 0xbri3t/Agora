const ROWS: Array<{ label: string; value: string }> = [
  { label: "Trading engine", value: "1inch Aqua / SwapVM" },
  { label: "Maker custody", value: "self-custodial, funds stay in wallet" },
  { label: "Quotes", value: "fill-or-kill lots, exact price" },
  { label: "Settlement", value: "on-chain, Ethereum Sepolia" },
]

export function TeeSpec() {
  return (
    <dl className="divide-y divide-border border-y border-border">
      {ROWS.map((row) => (
        <div
          key={row.label}
          className="flex items-baseline justify-between gap-6 py-4"
        >
          <dt className="text-sm text-foreground">{row.label}</dt>
          <dd className="font-mono text-sm tabular-nums text-muted-foreground">
            {row.value}
          </dd>
        </div>
      ))}
    </dl>
  )
}
