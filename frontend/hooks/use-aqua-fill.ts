"use client"

// Taker side of the Aqua order book: fill a resting lot exactly (all-or-nothing)
// via the SwapVM router. The lot's ISwapVM.Order tuple comes from the indexed book.
import { useCallback, useState } from 'react'
import { usePublicClient, useWriteContract, useAccount } from 'wagmi'
import { AQUA_ADDRESSES, ROUTER_ABI, BUILDER_ABI, ERC20_ABI, type AquaOrder } from '@/contracts/aqua'

export interface FillLotInput {
  order: { maker: string; traits: string; data: string } // from backend order book
  outcomeToken: `0x${string}`
  lotUsdc: bigint // exact USDC (6d) the lot costs
}

export function useAquaFill() {
  const { address } = useAccount()
  const publicClient = usePublicClient()
  const { writeContractAsync } = useWriteContract()
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const fillLot = useCallback(async ({ order, outcomeToken, lotUsdc }: FillLotInput) => {
    if (!address || !publicClient) return null
    setIsLoading(true)
    setError(null)
    try {
      // Taker pays USDC through the router (transferFrom + Aqua push)
      const allowance = await publicClient.readContract({
        address: AQUA_ADDRESSES.usdc, abi: ERC20_ABI, functionName: 'allowance',
        args: [address, AQUA_ADDRESSES.router],
      })
      if (allowance < lotUsdc) {
        const approveHash = await writeContractAsync({
          address: AQUA_ADDRESSES.usdc, abi: ERC20_ABI, functionName: 'approve',
          args: [AQUA_ADDRESSES.router, 2n ** 256n - 1n],
        })
        await publicClient.waitForTransactionReceipt({ hash: approveHash })
      }

      const takerData = await publicClient.readContract({
        address: AQUA_ADDRESSES.builder, abi: BUILDER_ABI, functionName: 'buildTakerData',
        args: [address, true],
      })

      const orderTuple: AquaOrder = {
        maker: order.maker as `0x${string}`,
        traits: BigInt(order.traits),
        data: order.data as `0x${string}`,
      }
      const hash = await writeContractAsync({
        address: AQUA_ADDRESSES.router, abi: ROUTER_ABI, functionName: 'swap',
        args: [orderTuple, AQUA_ADDRESSES.usdc, outcomeToken, lotUsdc, takerData],
      })
      await publicClient.waitForTransactionReceipt({ hash })
      return { txHash: hash }
    } catch (e: any) {
      setError(e?.shortMessage || e?.message || 'fill failed')
      return null
    } finally {
      setIsLoading(false)
    }
  }, [address, publicClient, writeContractAsync])

  return { fillLot, isLoading, error }
}
