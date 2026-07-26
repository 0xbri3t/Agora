"use client"

// The auction's parting gift: the discovered price of each world. Shown as a
// slim strip above the market chart when the Live phase opens, so the story
// reads "the auction found these prices — now the market trades around them".
import { useMemo } from "react"
import { motion, useReducedMotion } from "motion/react"
import { useReadContract } from "wagmi"
import { proposal_abi } from "@/contracts/proposal-abi"
import { cca_abi, q96ToPrice6d } from "@/contracts/cca-abi"

export function PriceDiscoveryStrip({ proposalAddress }: { proposalAddress?: `0x${string}` }) {
  const reduced = useReducedMotion()
  const { data: yesAuction } = useReadContract({ address: proposalAddress, abi: proposal_abi, functionName: "yesAuction" })
  const { data: noAuction } = useReadContract({ address: proposalAddress, abi: proposal_abi, functionName: "noAuction" })
  const { data: yesClr } = useReadContract({ address: yesAuction as `0x${string}` | undefined, abi: cca_abi, functionName: "clearingPrice" })
  const { data: noClr } = useReadContract({ address: noAuction as `0x${string}` | undefined, abi: cca_abi, functionName: "clearingPrice" })

  const prices = useMemo(() => {
    if (typeof yesClr !== "bigint" || typeof noClr !== "bigint") return null
    return {
      yes: Number(q96ToPrice6d(yesClr)) / 1e6,
      no: Number(q96ToPrice6d(noClr)) / 1e6,
    }
  }, [yesClr, noClr])

  if (!prices) return null

  return (
    <motion.div
      initial={reduced ? false : { y: -6 }}
      animate={{ y: 0 }}
      transition={{ duration: 0.4, ease: "easeOut" }}
      className="mb-3 flex flex-wrap items-center gap-x-4 gap-y-1 rounded-md border bg-muted/30 px-3 py-2 text-sm"
    >
      <span className="text-xs text-muted-foreground">Price discovery · auction close</span>
      <span className="flex items-center gap-1.5 font-mono tabular-nums">
        <span className="inline-block h-2 w-2 rounded-full" style={{ backgroundColor: "var(--data-up)" }} />
        YES ${prices.yes.toFixed(2)}
      </span>
      <span className="flex items-center gap-1.5 font-mono tabular-nums">
        <span className="inline-block h-2 w-2 rounded-full" style={{ backgroundColor: "var(--destructive)" }} />
        NO ${prices.no.toFixed(2)}
      </span>
      <span className="text-xs text-muted-foreground">
        · the market now trades around these forecasts
      </span>
    </motion.div>
  )
}
