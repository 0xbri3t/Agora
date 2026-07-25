import { ethers } from "ethers"
import { useCallback, useMemo, useState } from "react"
import { toast } from "sonner"
import { collateral_abi } from '@/contracts/collateral-abi'
import { getContractAddress } from "@/contracts/constants"

import { useAccount, useReadContract, useChainId, usePublicClient, useConfig } from "wagmi"
import { getEthersSigner } from "@/lib/signer"


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
  const config = useConfig()

  const collateralAddress = useMemo(() => getContractAddress(chainId, 'COLLATERAL') as `0x${string}` | undefined, [chainId])
  const [error, setError] = useState<string | null>(null)
  const [isMinting, setIsMinting] = useState(false)
  const [lastHash, setLastHash] = useState<string | null>(null)
  const [collateralBalance, setCollateralBalance] = useState<bigint>(0n)

  const refetchOnchain = useCallback(async () => {
    try {
      if (!publicClient || !address || !collateralAddress) return
      const balance = (await publicClient.readContract({
        address: collateralAddress,
        abi: collateral_abi,
        functionName: 'balanceOf',
        args: [address],
      })) as bigint
      setCollateralBalance(balance ?? 0n)
    } catch (e) {
      console.error('Error fetching balance:', e)
    }
  }, [publicClient, address, collateralAddress])


  const mintPublic = useCallback(async () => {
    if (!collateralAddress || isMinting) return

    setIsMinting(true)
    try {
      // Works for both extension wallets and Openfort embedded/guest wallets
      const signer = await getEthersSigner(config)
      const contract = new ethers.Contract(collateralAddress, collateral_abi as any, signer)

      // MockUSDC exposes mint(to, amount); give testers a usable balance
      const tx = await contract.mint(address, 10_000n * 10n ** 6n)
      setLastHash(tx.hash)
      const receipt = await tx.wait()

      if (!receipt || receipt.status !== 1) {
        throw new Error("Transaction failed")
      }

      await refetchOnchain()
      setError(null)
      toast.success('Minted 10,000 USDC')
    } catch (err) {
      let errorMsg = 'Error minting';
      if (err instanceof Error && err.message) {
        errorMsg = err.message;
      } else if (typeof err === 'string') {
        errorMsg = err;
      }
      setError(errorMsg);
      toast.error('Mint failed', { description: errorMsg.slice(0, 200) });
      console.error('Error minting:', err);
    } finally {
      setIsMinting(false)
    }
  }, [collateralAddress, isMinting, refetchOnchain, config, address])

  return {
    mintPublic,
    isMinting,
    error,
    lastHash,
    collateralBalance,
    refetchOnchain,
  }
}
