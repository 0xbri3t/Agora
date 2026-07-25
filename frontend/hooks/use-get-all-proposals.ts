import { useReadContract, useChainId } from 'wagmi'
import { useMemo } from 'react'
import { proposalManager_abi } from '@/contracts/proposalManager-abi'
import { getContractAddress } from '@/contracts/constants'
import type { Proposal } from '@/lib/types'

export function useGetAllProposals() {
  const chainId = useChainId()
  const contractAddress = getContractAddress(chainId, 'PROPOSAL_MANAGER')

  const { data, isLoading, error, refetch } = useReadContract({
    address: contractAddress as `0x${string}`,
    abi: proposalManager_abi,
    functionName: 'getAllProposals',
    query: { enabled: !!contractAddress },
  })

  const stateMap = ['Auction', 'Live', 'Resolved', 'Cancelled'] as const;



  const proposals = useMemo(() => {
    if (!data) return []
    return (data as unknown as Proposal[]).map((p) => ({
      id: p.id.toString(),
      admin: p.admin,
      title: p.title,
      description: p.description,
      state: stateMap[Number(p.state)] as Proposal['state'],
      auctionStartTime: Number(p.auctionStartTime),
      auctionEndTime: Number(p.auctionEndTime),
      liveStart: Number(p.liveStart),
      liveEnd: Number(p.liveEnd),
      liveDuration: Number(p.liveDuration),
      subjectToken: p.subjectToken,
      minToOpen: p.minToOpen.toString(),
      maxCap: p.maxCap.toString(),
      yesAuction: p.yesAuction as `0x${string}`,
      noAuction: p.noAuction as `0x${string}`,
      yesToken: p.yesToken as `0x${string}`,
      noToken: p.noToken as `0x${string}`,
      treasury: p.treasury as `0x${string}`,
      target: p.target as `0x${string}`,
      data: p.data,
      address: p.proposalAddress as `0x${string}`,
    }))
  }, [data])

  return { proposals, isLoading, error, refetch }
}