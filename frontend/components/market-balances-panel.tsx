"use client"

import { useEffect, useMemo, useCallback, useState } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { useAccount, useChainId, usePublicClient } from "wagmi"
import { useGetProposalById } from "@/hooks/use-get-proposalById"
import { marketToken_abi } from "@/contracts/marketToken-abi"
import {getContractAddress} from "@/contracts/constants"

export function MarketBalancesPanel({ proposalId }: { proposalId: string }) {
  const { address, isConnected } = useAccount()
  const publicClient = usePublicClient()
  const { proposal } = useGetProposalById(proposalId)
  const chainId = useChainId()

  const pyusdAddr = getContractAddress(chainId, 'PYUSD')
  const yesToken = proposal?.yesToken as `0x${string}` | undefined
  const noToken = proposal?.noToken as `0x${string}` | undefined

  const [pyusd, setPyusd] = useState<bigint>(0n)
  const [yes, setYes] = useState<bigint>(0n)
  const [no, setNo] = useState<bigint>(0n)

  const refetch = useCallback(async () => {
    try {
      if (!publicClient || !address) return
      if (pyusdAddr) {
        const b = await publicClient.readContract({ address: pyusdAddr, abi: marketToken_abi, functionName: 'balanceOf', args: [address] }) as bigint
        setPyusd(b ?? 0n)
      }
      if (yesToken) {
        const b = await publicClient.readContract({ address: yesToken, abi: marketToken_abi, functionName: 'balanceOf', args: [address] }) as bigint
        setYes(b ?? 0n)
      }
      if (noToken) {
        const b = await publicClient.readContract({ address: noToken, abi: marketToken_abi, functionName: 'balanceOf', args: [address] }) as bigint
        setNo(b ?? 0n)
      }
    } catch {
      // ignore
    }
  }, [publicClient, address, pyusdAddr, yesToken, noToken])

  useEffect(() => { void refetch() }, [refetch])
  useEffect(() => {
    const id = setInterval(() => { void refetch() }, 3000)
    return () => clearInterval(id)
  }, [refetch])

  const pyusdDisplay = useMemo(() => Number(pyusd ?? 0n) / 1e6, [pyusd])
  const yesDisplay = useMemo(() => Number(yes ?? 0n) / 1e18, [yes])
  const noDisplay = useMemo(() => Number(no ?? 0n) / 1e18, [no])

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg">Your Balances</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {!isConnected ? (
          <div className="text-sm text-muted-foreground">Connect your wallet to see balances.</div>
        ) : (
          <>
            <div
              className="flex items-center justify-between rounded-md border px-3 py-2"
              style={{
                // Blue gradient using color-mix for consistent theming
                backgroundColor: "color-mix(in oklab, #002991 12%, transparent)",
                borderColor: "color-mix(in oklab, #61cdff 40%, transparent)",
              }}
            >
              <span className="text-sm font-medium" style={{ color: "#61cdff" }}>PyUSD</span>
              <span className="font-mono text-base" style={{ color: "#61cdff" }}>
                 $ {pyusdDisplay.toLocaleString(undefined, { maximumFractionDigits: 6 })}
              </span>
            </div>

            {/* tYES balance with fixed green accents (same in light/dark) */}
            <div
              className="flex items-center justify-between rounded-md border px-3 py-2"
              style={{
                background: "color-mix(in oklab, #00ff85 8%, transparent)",
                borderColor: "color-mix(in oklab, #00ff85 30%, transparent)",
              }}
            >
              <span className="text-sm font-medium" style={{ color: "#00ff85" }}>tYES</span>
              <span className="font-mono text-base" style={{ color: "#00ff85" }}>
                {yesDisplay.toLocaleString(undefined, { maximumFractionDigits: 6 })}
              </span>
            </div>

            {/* tNO balance with fixed red accents (same in light/dark) */}
            <div
              className="flex items-center justify-between rounded-md border px-3 py-2"
              style={{
                background: "color-mix(in oklab, #ef4444 8%, transparent)",
                borderColor: "color-mix(in oklab, #ef4444 30%, transparent)",
              }}
            >
              <span className="text-sm font-medium" style={{ color: "#ef4444" }}>tNO</span>
              <span className="font-mono text-base" style={{ color: "#ef4444" }}>
                {noDisplay.toLocaleString(undefined, { maximumFractionDigits: 6 })}
              </span>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  )
}
