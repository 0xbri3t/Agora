import { ethers } from "ethers"
import { useCallback, useMemo, useState } from "react"
import { pyUSD_abi } from '@/contracts/pyUsd-abi'
import { getContractAddress } from "@/contracts/constants"

import { useAccount, useReadContract, useChainId, usePublicClient } from "wagmi"


const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001/api'

export type CreateOrderResult = {
  ok: boolean
  status: number
  data: any
}

export function useCreateOrder() {
  const { address } = useAccount()
  const chainId = useChainId()
  const publicClient = usePublicClient()

  const pyusdAddress = useMemo(() => getContractAddress(chainId, 'PYUSD') as `0x${string}` | undefined, [chainId])
  const [error, setError] = useState<string | null>(null)
  const [lastHash, setLastHash] = useState<string | null>(null)
  const [pyUSDBalance, setPyUSDBalance] = useState<bigint>(0n)

  const refetchOnchain = useCallback(async () => {
    try {
      if (!publicClient || !address || !pyusdAddress) return
      const balance = (await publicClient.readContract({
        address: pyusdAddress,
        abi: pyUSD_abi,
        functionName: 'balanceOf',
        args: [address],
      })) as bigint
      setPyUSDBalance(balance ?? 0n)
    } catch (e) {
      console.error('Error fetching balance:', e)
    }
  }, [publicClient, address, pyusdAddress])


  const anyWindow = window as any
  const mintPublic = useCallback(async () => {
    if (!pyusdAddress) return
    if (!anyWindow?.ethereum) {
      setError("No wallet found")
      return
    }

    try {
      const provider = new ethers.BrowserProvider(anyWindow?.ethereum)
      const signer = await provider.getSigner()
      const contract = new ethers.Contract(pyusdAddress, pyUSD_abi as any, signer)

      const tx = await contract.mintPublic()
      setLastHash(tx.hash)
      const receipt = await tx.wait()

      if (!receipt || receipt.status !== 1) {
        throw new Error("Transaction failed")
      }

      await refetchOnchain()
      setError(null)
    } catch (err) {
      let errorMsg = 'Error minting';
      if (err instanceof Error && err.message) {
        errorMsg = err.message;
      } else if (typeof err === 'string') {
        errorMsg = err;
      }
      setError(errorMsg);
      console.error('Error minting:', err);
    } finally {
    }
  }, [pyusdAddress, refetchOnchain])

  return {
    mintPublic,
    error,
    lastHash,
    pyUSDBalance,
    refetchOnchain,
  }
}
