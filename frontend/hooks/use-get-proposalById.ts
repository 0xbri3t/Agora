import { useReadContract, useChainId } from 'wagmi'
import { useMemo } from 'react'
import { proposalManager_abi } from '@/contracts/proposalManager-abi'
import { getContractAddress } from '@/contracts/constants'

export function useGetProposalById(id: string) {
  const chainId = useChainId()
  const contractAddress = getContractAddress(chainId, 'PROPOSAL_MANAGER')

  const { data, isLoading, error, refetch } = useReadContract({
    address: contractAddress as `0x${string}`,
    abi: proposalManager_abi,
    functionName: 'getProposalById',
    args: [id ? BigInt(id) : 0n],
    query: { enabled: !!contractAddress && !!id },
  })

  const stateMap = ['Auction', 'Live', 'Resolved', 'Cancelled'] as const

  const proposal = useMemo(() => {
    if (!data) return null
    const p = data as any
    return {
      id: p.id?.toString?.() ?? '0',
      admin: p.admin as string,
      title: p.title as string,
      description: p.description as string,
      state: stateMap[Number(p.state)] as 'Auction' | 'Live' | 'Resolved' | 'Cancelled',
      auctionStartTime: Number(p.auctionStartTime),
      auctionEndTime: Number(p.auctionEndTime),
      liveStart: Number(p.liveStart),
      liveEnd: Number(p.liveEnd),
      liveDuration: Number(p.liveDuration),
      subjectToken: p.subjectToken as string,
      minToOpen: p.minToOpen?.toString?.() ?? '0',
      maxCap: p.maxCap?.toString?.() ?? '0',
      yesAuction: p.yesAuction as `0x${string}`,
      noAuction: p.noAuction as `0x${string}`,
      yesToken: p.yesToken as `0x${string}`,
      noToken: p.noToken as `0x${string}`,
      treasury: p.treasury as `0x${string}`,
      target: p.target as `0x${string}`,
      data: p.data as string,
      proposalAddress: p.proposalAddress as `0x${string}`,
    }
  }, [data])

  return { proposal, isLoading, error, refetch }
}