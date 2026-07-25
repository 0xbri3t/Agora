"use client"

import { useCallback, useMemo, useState, useEffect } from "react"
import { useAccount, useReadContract, useChainId, usePublicClient } from "wagmi"
import { parseUnits } from "viem"
import { ethers } from "ethers"
import { proposal_abi } from "@/contracts/proposal-abi"
import { dutchAuction_abi } from "@/contracts/dutchAuction-abi"
import { marketToken_abi } from "@/contracts/marketToken-abi"
import { getContractAddress } from "@/contracts/constants"

export type AuctionSide = "YES" | "NO"

const SIX_DECIMALS = 10n ** 6n // PyUSD and oracle price are 6 decimals

export function useAuctionBuy({ proposalAddress, side }: { proposalAddress: `0x${string}`; side: AuctionSide }) {
  const { address } = useAccount()
  const chainId = useChainId()
  const publicClient = usePublicClient()
  const [amount, setAmount] = useState<string>("") // PyUSD amount (6d)
  const [lastHash, setLastHash] = useState<`0x${string}` | undefined>()

  // Read addresses from Proposal
  const { data: treasury } = useReadContract({ address: proposalAddress, abi: proposal_abi, functionName: "treasury" })
  const { data: yesAuctionAddr } = useReadContract({ address: proposalAddress, abi: proposal_abi, functionName: "yesAuction" })
  const { data: noAuctionAddr } = useReadContract({ address: proposalAddress, abi: proposal_abi, functionName: "noAuction" })
  const { data: yesToken } = useReadContract({ address: proposalAddress, abi: proposal_abi, functionName: "yesToken" })
  const { data: noToken } = useReadContract({ address: proposalAddress, abi: proposal_abi, functionName: "noToken" })

  const auctionAddress = useMemo(() => (side === "YES" ? (yesAuctionAddr as `0x${string}`) : (noAuctionAddr as `0x${string}`)), [side, yesAuctionAddr, noAuctionAddr])
  const marketToken = useMemo(() => (side === "YES" ? (yesToken as `0x${string}`) : (noToken as `0x${string}`)), [side, yesToken, noToken])
  const pyusd = useMemo(() => getContractAddress(chainId, 'PYUSD') as `0x${string}` | undefined, [chainId])

  const { data: cap } = useReadContract({ address: marketToken, abi: marketToken_abi, functionName: "cap" })
  const { data: totalSupply } = useReadContract({ address: marketToken, abi: marketToken_abi, functionName: "totalSupply" })
  const { data: userBal } = useReadContract({ address: marketToken, abi: marketToken_abi, functionName: "balanceOf", args: [address ?? "0x0000000000000000000000000000000000000000"] })
  const { data: onchainPrice } = useReadContract({ address: auctionAddress, abi: dutchAuction_abi, functionName: "priceNow" }) // 6d
  const { data: pyusdBal } = useReadContract({
    address: pyusd,
    abi: marketToken_abi,
    functionName: "balanceOf",
    args: [address ?? "0x0000000000000000000000000000000000000000"],
  })

  // Local mirrors to enable instant post-tx updates and real-time polling
  const remainingComputed = useMemo(() => (cap && totalSupply ? (cap as bigint) - (totalSupply as bigint) : 0n), [cap, totalSupply])
  const [remainingState, setRemainingState] = useState<bigint>(0n)
  const [userTokenBalanceState, setUserTokenBalanceState] = useState<bigint>(0n)
  const [pyusdBalanceState, setPyusdBalanceState] = useState<bigint>(0n)

  useEffect(() => { if (typeof remainingComputed === "bigint") setRemainingState(remainingComputed) }, [remainingComputed])
  useEffect(() => { if (typeof userBal === "bigint") setUserTokenBalanceState(userBal) }, [userBal])
  useEffect(() => { if (typeof pyusdBal === "bigint") setPyusdBalanceState(pyusdBal) }, [pyusdBal])

  const [isApproving, setIsApproving] = useState(false)
  const [isBuying, setIsBuying] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Helper to refetch balances/remaining after a successful tx or on a timer
  const refetchOnchain = useCallback(async () => {
    try {
      if (!publicClient || !address || !marketToken || !pyusd) return
      const [capNow, tsNow, userNow, pyusdNow] = await Promise.all([
        publicClient.readContract({ address: marketToken as `0x${string}`, abi: marketToken_abi, functionName: 'cap' }) as Promise<bigint>,
        publicClient.readContract({ address: marketToken as `0x${string}`, abi: marketToken_abi, functionName: 'totalSupply' }) as Promise<bigint>,
        publicClient.readContract({ address: marketToken as `0x${string}`, abi: marketToken_abi, functionName: 'balanceOf', args: [address] }) as Promise<bigint>,
        publicClient.readContract({ address: pyusd as `0x${string}`, abi: marketToken_abi, functionName: 'balanceOf', args: [address] }) as Promise<bigint>,
      ])
      setRemainingState((capNow ?? 0n) - (tsNow ?? 0n))
      setUserTokenBalanceState(userNow ?? 0n)
      setPyusdBalanceState(pyusdNow ?? 0n)
    } catch (e) {
      // silent
    }
  }, [publicClient, address, marketToken, pyusd])

  // Lightweight polling to keep remaining up-to-date while auction is live
  useEffect(() => {
    if (!publicClient || !marketToken) return
    const id = setInterval(() => { void refetchOnchain() }, 3000)
    return () => clearInterval(id)
  }, [publicClient, marketToken, refetchOnchain])

  const doApproveAndBuy = useCallback(async () => {
    setError(null)
    // Required preconditions
    if (!address) {
      const err = "Connect wallet"
      setError(err)
      throw new Error(err)
    }
    if (!pyusd) {
      const err = "Token not configured for this network"
      setError(err)
      throw new Error(err)
    }
    if (!treasury) {
      const err = "Treasury not ready"
      setError(err)
      throw new Error(err)
    }
    if (!auctionAddress) {
      const err = "Auction not ready"
      setError(err)
      throw new Error(err)
    }

    // User-entered PyUSD amount -> 6 decimals
    const pay = parseUnits(amount || "0", 6)
    if (pay === 0n) {
      const err = "Enter an amount greater than 0"
      setError(err)
      throw new Error(err)
    }

    // Setup ethers provider/signer
    const anyWindow = window as any
    if (!anyWindow?.ethereum) {
      const err = "No wallet found"
      setError(err)
      throw new Error(err)
    }
    const provider = new ethers.BrowserProvider(anyWindow.ethereum)
    const signer = await provider.getSigner()

    try {
      const net = await provider.getNetwork()
      if (chainId && Number(net.chainId) !== chainId) {
        try {
          await anyWindow.ethereum.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: `0x${chainId.toString(16)}` }] })
        } catch {}
      }
    } catch {}

    // Fresh preflight: auction live and supply available
    let payAmount = pay
    try {
      if (!publicClient) throw new Error('No client')
      const [priceLatest, capNow, tsNow, pyusdNow] = await Promise.all([
        publicClient.readContract({ address: auctionAddress as `0x${string}`, abi: dutchAuction_abi, functionName: 'priceNow' }) as Promise<bigint>, // 6d
        publicClient.readContract({ address: marketToken as `0x${string}`, abi: marketToken_abi, functionName: 'cap' }) as Promise<bigint>,
        publicClient.readContract({ address: marketToken as `0x${string}`, abi: marketToken_abi, functionName: 'totalSupply' }) as Promise<bigint>,
        publicClient.readContract({ address: pyusd as `0x${string}`, abi: marketToken_abi, functionName: 'balanceOf', args: [address as `0x${string}`] }) as Promise<bigint>,
      ])
      if (priceLatest === 0n) {
        const err = 'Auction ended'
        setError(err)
        throw new Error(err)
      }
      if (tsNow >= capNow) {
        const err = 'Sold out'
        setError(err)
        throw new Error(err)
      }
      // const remainingNow = capNow - tsNow // token 18d
      // Max PyUSD you can spend to not exceed remaining tokens at current price: remaining * price (6d) / 1e18
      // const maxPay = (remainingNow * priceLatest) / (10n ** 18n)
      // 1% buffer to avoid overflow if price drops before mine
      // const buffer = maxPay / 100n > 0n ? maxPay / 100n : 1n
      // const maxPayWithBuffer = maxPay > buffer ? maxPay - buffer : 0n
      // if (payAmount > maxPayWithBuffer) {
        // payAmount = maxPayWithBuffer
      // }
      if (payAmount <= 0n) {
        const err = 'Amount too high for remaining capacity'
        setError(err)
        throw new Error(err)
      }
      if (payAmount > (pyusdNow ?? 0n)) {
        const err = 'Insufficient PyUSD balance'
        setError(err)
        throw new Error(err)
      }
    } catch (e) {
      throw e
    }

    const erc20 = new ethers.Contract(pyusd as string, marketToken_abi as any, signer)
    const auction = new ethers.Contract(auctionAddress as string, dutchAuction_abi as any, signer)

    // Check current allowance and approve if needed (approve to Treasury)
    try {
      const cur: bigint = await erc20.allowance(address, treasury as string)
      if (cur < payAmount) {
        setIsApproving(true)
        const tx = await erc20.approve(treasury as string, payAmount)
        setLastHash(tx.hash)
        const rcpt = await tx.wait(1)
        if (!rcpt || (rcpt.status !== 1n && rcpt.status !== 1)) {
          setIsApproving(false)
          const err = "Approve failed on-chain"
          setError(err)
          throw new Error(err)
        }
        setIsApproving(false)
        try { window.dispatchEvent(new Event('auction:tx')) } catch {}
      }
    } catch (e: any) {
      setIsApproving(false)
      const msg = e?.shortMessage || e?.message || "Approve failed"
      setError(msg)
      throw new Error(msg)
    }

    // Proceed to buy using 6d payAmount
    try {
      setIsBuying(true)
      const tx2 = await auction.buyLiquidity(payAmount)
      setLastHash(tx2.hash)
      const rcpt2 = await tx2.wait(1)
      if (!rcpt2 || (rcpt2.status !== 1n && rcpt2.status !== 1)) {
        const err = "Buy failed on-chain"
        setError(err)
        throw new Error(err)
      }
      // Refresh balances immediately after success
      await refetchOnchain()
      try { window.dispatchEvent(new Event('auction:tx')) } catch {}
    } catch (e: any) {
      const msg = e?.shortMessage || e?.message || "Buy failed"
      setError(msg)
      throw new Error(msg)
    } finally {
      setIsBuying(false)
    }
  }, [address, pyusd, treasury, auctionAddress, amount, chainId, refetchOnchain])

  return {
    amount,
    setAmount,
    approveAndBuy: doApproveAndBuy,
    isApproving,
    isBuying,
    error,
    auctionAddress,
    marketToken,
    remaining: remainingState,
    userTokenBalance: userTokenBalanceState,
    onchainPrice: (onchainPrice as bigint) ?? 0n,
    lastHash,
    pyusd,
    pyusdBalance: pyusdBalanceState,
  }
}
