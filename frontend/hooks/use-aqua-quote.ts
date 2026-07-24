"use client"

// Maker side of the Aqua order book: place a fill-or-kill lot (ship) and
// cancel it (dock). All txs are signed by the user's wallet — no API orders.
import { useCallback, useState } from 'react'
import { usePublicClient, useWriteContract, useAccount } from 'wagmi'
import { parseUnits } from 'viem'
import { AQUA_ADDRESSES, AQUA_ABI, BUILDER_ABI, ERC20_ABI } from '@/contracts/aqua'

export interface ShipQuoteInput {
  outcomeToken: `0x${string}`
  amountTokens: string   // human units, e.g. "10"
  priceUsdc: string      // USDC per token, e.g. "0.40"
}

export function useAquaQuote() {
  const { address } = useAccount()
  const publicClient = usePublicClient()
  const { writeContractAsync } = useWriteContract()
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  /// Ship one lot: shipped amounts encode price and size exactly.
  const shipQuote = useCallback(async ({ outcomeToken, amountTokens, priceUsdc }: ShipQuoteInput) => {
    if (!address || !publicClient) return null
    setIsLoading(true)
    setError(null)
    try {
      const lotToken = parseUnits(amountTokens, 18)
      const lotUsdc = (lotToken * parseUnits(priceUsdc, 6)) / 10n ** 18n
      if (lotUsdc === 0n) throw new Error('Lot too small')

      // Maker must allow Aqua to pull the outcome token at fill time
      const allowance = await publicClient.readContract({
        address: outcomeToken, abi: ERC20_ABI, functionName: 'allowance',
        args: [address, AQUA_ADDRESSES.aqua],
      })
      if (allowance < lotToken) {
        const approveHash = await writeContractAsync({
          address: outcomeToken, abi: ERC20_ABI, functionName: 'approve',
          args: [AQUA_ADDRESSES.aqua, 2n ** 256n - 1n],
        })
        await publicClient.waitForTransactionReceipt({ hash: approveHash })
      }

      // On-chain encoder: program + order + ship payload (no local bit-packing)
      const salt = BigInt(Date.now())
      const [, shipStrategy, strategyHash] = await publicClient.readContract({
        address: AQUA_ADDRESSES.builder, abi: BUILDER_ABI, functionName: 'buildQuote',
        args: [address, AQUA_ADDRESSES.usdc, outcomeToken, `0x${salt.toString(16).padStart(64, '0')}`],
      })

      const hash = await writeContractAsync({
        address: AQUA_ADDRESSES.aqua, abi: AQUA_ABI, functionName: 'ship',
        args: [AQUA_ADDRESSES.router, shipStrategy, [outcomeToken, AQUA_ADDRESSES.usdc], [lotToken, lotUsdc]],
      })
      await publicClient.waitForTransactionReceipt({ hash })
      return { strategyHash, txHash: hash }
    } catch (e: any) {
      setError(e?.shortMessage || e?.message || 'ship failed')
      return null
    } finally {
      setIsLoading(false)
    }
  }, [address, publicClient, writeContractAsync])

  /// Cancel a lot: dock releases the virtual balances.
  const dockQuote = useCallback(async (strategyHash: `0x${string}`, outcomeToken: `0x${string}`) => {
    if (!publicClient) return null
    setIsLoading(true)
    setError(null)
    try {
      const hash = await writeContractAsync({
        address: AQUA_ADDRESSES.aqua, abi: AQUA_ABI, functionName: 'dock',
        args: [AQUA_ADDRESSES.router, strategyHash, [outcomeToken, AQUA_ADDRESSES.usdc]],
      })
      await publicClient.waitForTransactionReceipt({ hash })
      return { txHash: hash }
    } catch (e: any) {
      setError(e?.shortMessage || e?.message || 'dock failed')
      return null
    } finally {
      setIsLoading(false)
    }
  }, [publicClient, writeContractAsync])

  return { shipQuote, dockQuote, isLoading, error }
}
