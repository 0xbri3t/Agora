import { useReadContract, useAccount, useChainId, usePublicClient } from 'wagmi'
import { proposalManager_abi } from '@/contracts/proposalManager-abi'
import { proposal_abi } from '@/contracts/proposal-abi'
import { getContractAddress } from '@/contracts/constants'
import { useEffect, useState } from 'react'

export interface Proposal {
  id: string
  title: string
  description: string
  status: 'active' | 'pending' | 'executed'
  createdBy: string
  createdAt: string
  address: string
  endTime: number
  startTime: number
}

export function useProposalsByAdmin() {
  const { address } = useAccount()
  const chainId = useChainId()
  const contractAddress = getContractAddress(chainId, 'PROPOSAL_MANAGER')
  const publicClient = usePublicClient()

  // Fetch proposal addresses by admin
  const { data: proposalAddresses, isLoading: isLoadingAddresses, error } = useReadContract({
    address: contractAddress as `0x${string}`,
    abi: proposalManager_abi,
    functionName: 'getProposalsByAdmin',
    args: address ? [address] : undefined,
    query: {
      enabled: !!address && !!contractAddress,
    },
  })

  const [proposals, setProposals] = useState<Proposal[]>([])
  const [isLoadingProposals, setIsLoadingProposals] = useState(false)

  useEffect(() => {
    async function fetchProposalDetails() {
      if (!proposalAddresses || proposalAddresses.length === 0 || !publicClient) {
        setProposals([])
        return
      }

      setIsLoadingProposals(true)
      
      try {
        // Process each proposal address
        const proposalData: Proposal[] = []
        
        for (const proposalAddress of proposalAddresses as string[]) {
          try {
            // Read all required data for this proposal
            const [
              id,
              admin,
              name,
              description,
              startTime,
              endTime,
              proposalExecuted,
              proposalEnded,
              isActive
            ] = await Promise.all([
              publicClient.readContract({
                address: proposalAddress as `0x${string}`,
                abi: proposal_abi,
                functionName: 'id',
              }),
              publicClient.readContract({
                address: proposalAddress as `0x${string}`,
                abi: proposal_abi,
                functionName: 'admin',
              }),
              publicClient.readContract({
                address: proposalAddress as `0x${string}`,
                abi: proposal_abi,
                functionName: 'name',
              }),
              publicClient.readContract({
                address: proposalAddress as `0x${string}`,
                abi: proposal_abi,
                functionName: 'description',
              }),
              publicClient.readContract({
                address: proposalAddress as `0x${string}`,
                abi: proposal_abi,
                functionName: 'startTime',
              }),
              publicClient.readContract({
                address: proposalAddress as `0x${string}`,
                abi: proposal_abi,
                functionName: 'endTime',
              }),
              publicClient.readContract({
                address: proposalAddress as `0x${string}`,
                abi: proposal_abi,
                functionName: 'proposalExecuted',
              }),
              publicClient.readContract({
                address: proposalAddress as `0x${string}`,
                abi: proposal_abi,
                functionName: 'proposalEnded',
              }),
              publicClient.readContract({
                address: proposalAddress as `0x${string}`,
                abi: proposal_abi,
                functionName: 'isActive',
              }),
            ])

            // Determine status
            let status: 'active' | 'pending' | 'executed'
            if (proposalExecuted || proposalEnded) {
              status = 'executed'
            } else if (isActive) {
              status = 'active'
            } else {
              status = 'pending'
            }

            proposalData.push({
              id: (id as bigint)?.toString() || '0',
              title: (name as string) || 'Untitled Proposal',
              description: (description as string) || 'No description available',
              status,
              createdBy: (admin as string) || '',
              createdAt: startTime ? new Date(Number(startTime as bigint) * 1000).toISOString() : new Date().toISOString(),
              address: proposalAddress,
              endTime: Number((endTime as bigint) || 0),
              startTime: Number((startTime as bigint) || 0),
            })
          } catch (proposalError) {
            console.error(`Error fetching data for proposal ${proposalAddress}:`, proposalError)
            // Continue with other proposals even if one fails
          }
        }

        setProposals(proposalData)
      } catch (error) {
        console.error('Error fetching proposal details:', error)
        setProposals([])
      } finally {
        setIsLoadingProposals(false)
      }
    }

    fetchProposalDetails()
  }, [proposalAddresses, publicClient])

  return {
    proposals,
    isLoading: isLoadingAddresses || isLoadingProposals,
    error,
    refetch: () => {
      // This would trigger a refetch of the proposal addresses
      // The useEffect will handle refetching the details
    }
  }
}
