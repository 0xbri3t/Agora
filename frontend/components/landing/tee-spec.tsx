const ROWS: Array<{ label: string; value: string }> = [
  { label: "Matching engine", value: "TEE enclave" },
  { label: "Order book", value: "private, TEE-isolated" },
  { label: "Wallet consent", value: "signature required per order" },
  { label: "Settlement", value: "on-chain, Hedera Testnet" },
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
