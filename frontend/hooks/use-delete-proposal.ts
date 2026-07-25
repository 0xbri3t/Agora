import { ethers } from "ethers"
import { useCallback, useState } from "react"
import { getContractAddress } from "@/contracts/constants"
import { proposalManager_abi } from "@/contracts/proposalManager-abi"
import { useAccount, useChainId } from "wagmi"
import { useWalletAuth } from "./use-wallet-auth"

const API_BASE = process.env.NEXT_PUBLIC_API_URL || "http://localhost:3001/api"

type DeleteParams = {
  // On-chain proposal contract address to delete
  proposalAddress: `0x${string}` | string
  // Optional: backend Proposal.id to also remove from DB
  backendId?: string | number
  // If true and backendId provided, attempt backend deletion after on-chain success
  alsoDeleteBackend?: boolean
}

export function useDeleteProposal() {
  const { address: walletAddress } = useAccount()
  const chainId = useChainId()
  const { ensureAuth } = useWalletAuth()

  const proposalManagerAddress = getContractAddress(chainId, "PROPOSAL_MANAGER") as `0x${string}`
  const [error, setError] = useState<string | null>(null)
  const [lastHash, setLastHash] = useState<string | null>(null)
  const [pending, setPending] = useState<boolean>(false)

  const anyWindow = typeof window !== "undefined" ? (window as any) : ({} as any)

  const deleteProposal = useCallback(
    async ({ proposalAddress, backendId, alsoDeleteBackend = true }: DeleteParams) => {
      setError(null)
      setPending(true)
      try {
        if (!proposalManagerAddress) throw new Error("ProposalManager address not configured for this network")
        if (!proposalAddress) throw new Error("proposalAddress is required")
        if (!anyWindow?.ethereum) throw new Error("No wallet provider found")

        // 1) Send on-chain transaction to delete the proposal contract
        const provider = new ethers.BrowserProvider(anyWindow.ethereum)
        const signer = await provider.getSigner()
        const contract = new ethers.Contract(proposalManagerAddress, proposalManager_abi as any, signer)

        const tx = await contract.deleteProposal(proposalAddress)
        setLastHash(tx.hash)
        const receipt = await tx.wait()
        if (!receipt || receipt.status !== 1) {
          throw new Error("Delete transaction failed")
        }

      
        setError(null)
        return { txHash: tx.hash, backendDeleted: Boolean(backendId && alsoDeleteBackend) }
      } catch (err) {
        let errorMsg = "Error deleting proposal"
        if (err instanceof Error && err.message) errorMsg = err.message
        else if (typeof err === "string") errorMsg = err
        setError(errorMsg)
        console.error("Delete proposal error:", err)
        return { error: errorMsg }
      } finally {
        setPending(false)
      }
    },
    [proposalManagerAddress, ensureAuth]
  )

  return {
    deleteProposal,
    error,
    lastHash,
    pending,
  }
}
