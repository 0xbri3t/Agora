"use client"

import { useCallback, useMemo, useState, useEffect } from "react"
import { useAccount, useReadContract, useChainId, usePublicClient, useConfig, useSwitchChain } from "wagmi"
import { getEthersSigner } from "@/lib/signer"
import { parseUnits } from "viem"
import { ethers } from "ethers"
import { proposal_abi } from "@/contracts/proposal-abi"
import { cca_abi, permit2_abi, PERMIT2_ADDRESS, q96ToPrice6d, price6dToQ96, snapToTick } from "@/contracts/cca-abi"
import { getAuctionStartBlock } from "@/lib/cca-start-block"
import { marketToken_abi } from "@/contracts/marketToken-abi"
import { getContractAddress } from "@/contracts/constants"

export type AuctionSide = "YES" | "NO"

// Ethers fragments for the write path (viem abi objects are read-side)
const CCA_WRITE_ABI = [
  "function submitBid(uint256 maxPriceQ96, uint128 amount, address owner, bytes hookData) payable returns (uint256)",
  "function exitBid(uint256 bidId)",
  "function claimTokens(uint256 bidId)",
]
const PERMIT2_WRITE_ABI = [
  "function approve(address token, address spender, uint160 amount, uint48 expiration)",
]

/**
 * Bid on the Uniswap Continuous Clearing Auction bootstrapping one side of the
 * market. The user enters a USDC budget; the max price is set a comfortable
 * margin above the current clearing price (snapped to the tick grid).
 */
export function useAuctionBuy({ proposalAddress, side }: { proposalAddress: `0x${string}`; side: AuctionSide }) {
  const { address } = useAccount()
  const chainId = useChainId()
  const publicClient = usePublicClient()
  const config = useConfig()
  const [amount, setAmount] = useState<string>("") // USDC budget (6d)
  const [lastHash, setLastHash] = useState<`0x${string}` | undefined>()

  // Read addresses from Proposal
  const { data: yesAuctionAddr } = useReadContract({ address: proposalAddress, abi: proposal_abi, functionName: "yesAuction" })
  const { data: noAuctionAddr } = useReadContract({ address: proposalAddress, abi: proposal_abi, functionName: "noAuction" })
  const { data: yesToken } = useReadContract({ address: proposalAddress, abi: proposal_abi, functionName: "yesToken" })
  const { data: noToken } = useReadContract({ address: proposalAddress, abi: proposal_abi, functionName: "noToken" })

  const auctionAddress = useMemo(() => (side === "YES" ? (yesAuctionAddr as `0x${string}`) : (noAuctionAddr as `0x${string}`)), [side, yesAuctionAddr, noAuctionAddr])
  const marketToken = useMemo(() => (side === "YES" ? (yesToken as `0x${string}`) : (noToken as `0x${string}`)), [side, yesToken, noToken])
  const usdcAddress = useMemo(() => getContractAddress(chainId, 'COLLATERAL') as `0x${string}` | undefined, [chainId])

  const { data: clearingQ96 } = useReadContract({ address: auctionAddress, abi: cca_abi, functionName: "clearingPrice" })
  const { data: userBal } = useReadContract({ address: marketToken, abi: marketToken_abi, functionName: "balanceOf", args: [address ?? "0x0000000000000000000000000000000000000000"] })
  const { data: usdcBal } = useReadContract({
    address: usdcAddress,
    abi: marketToken_abi,
    functionName: "balanceOf",
    args: [address ?? "0x0000000000000000000000000000000000000000"],
  })

  // Local mirrors to enable instant post-tx updates and real-time polling
  const [remainingState, setRemainingState] = useState<bigint>(0n)
  const [userTokenBalanceState, setUserTokenBalanceState] = useState<bigint>(0n)
  const [usdcBalanceState, setUsdcBalanceState] = useState<bigint>(0n)
  const [clearingPrice6d, setClearingPrice6d] = useState<bigint>(0n)

  useEffect(() => { if (typeof userBal === "bigint") setUserTokenBalanceState(userBal) }, [userBal])
  useEffect(() => { if (typeof usdcBal === "bigint") setUsdcBalanceState(usdcBal) }, [usdcBal])
  useEffect(() => { if (typeof clearingQ96 === "bigint") setClearingPrice6d(q96ToPrice6d(clearingQ96)) }, [clearingQ96])

  const [isApproving, setIsApproving] = useState(false)
  const [isBuying, setIsBuying] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Helper to refetch balances/remaining after a successful tx or on a timer
  const refetchOnchain = useCallback(async () => {
    try {
      if (!publicClient || !address || !marketToken || !usdcAddress || !auctionAddress) return
      const [remainingNow, clearingNow, userNow, usdcNow] = await Promise.all([
        publicClient.readContract({ address: auctionAddress, abi: cca_abi, functionName: 'remainingSupply' }) as Promise<bigint>,
        publicClient.readContract({ address: auctionAddress, abi: cca_abi, functionName: 'clearingPrice' }) as Promise<bigint>,
        publicClient.readContract({ address: marketToken as `0x${string}`, abi: marketToken_abi, functionName: 'balanceOf', args: [address] }) as Promise<bigint>,
        publicClient.readContract({ address: usdcAddress as `0x${string}`, abi: marketToken_abi, functionName: 'balanceOf', args: [address] }) as Promise<bigint>,
      ])
      setRemainingState(remainingNow ?? 0n)
      setClearingPrice6d(q96ToPrice6d(clearingNow ?? 0n))
      setUserTokenBalanceState(userNow ?? 0n)
      setUsdcBalanceState(usdcNow ?? 0n)
    } catch (e) {
      // silent
    }
  }, [publicClient, address, marketToken, usdcAddress, auctionAddress])

  // Polling to keep clearing price up-to-date while auction is live. 12s, not
  // 3s: the hook mounts once per side, so short ticks add up on a public RPC.
  useEffect(() => {
    if (!publicClient || !auctionAddress) return
    const id = setInterval(() => { void refetchOnchain() }, 12_000)
    return () => clearInterval(id)
  }, [publicClient, auctionAddress, refetchOnchain])

  /** @param maxPrice6d Optional user cap (USDC 6d per token). Defaults to 2x current clearing. */
  const doApproveAndBuy = useCallback(async (maxPrice6d?: bigint) => {
    setError(null)
    if (!address) { setError("Connect wallet"); throw new Error("Connect wallet") }
    if (!usdcAddress) { setError("Token not configured for this network"); throw new Error("no usdc") }
    if (!auctionAddress) { setError("Auction not ready"); throw new Error("no auction") }

    const budget = parseUnits(amount || "0", 6)
    if (budget === 0n) { setError("Enter an amount greater than 0"); throw new Error("zero amount") }

    // Signer comes from the wagmi connector so embedded/guest wallets work too
    let signer
    try {
      signer = await getEthersSigner(config)
    } catch (e: any) {
      const msg = e?.message?.includes('chain') ? e.message : "Connect wallet"
      setError(msg)
      throw new Error(msg)
    }

    // The auction only exists on the app's chain: a wallet signing against a
    // different network fails estimateGas with "missing revert data".
    const walletChain = Number((await signer.provider.getNetwork()).chainId)
    if (walletChain !== chainId) {
      const msg = `Wrong network: wallet is on chain ${walletChain}, switch it to chain ${chainId}`
      setError(msg)
      throw new Error(msg)
    }

    if (!publicClient) { setError("No client"); throw new Error("no client") }

    // Preflight: auction still open, bid above clearing, budget available
    const [clearingNow, tickSpacing, endBlock, blockNow, usdcNow] = await Promise.all([
      publicClient.readContract({ address: auctionAddress, abi: cca_abi, functionName: 'clearingPrice' }) as Promise<bigint>,
      publicClient.readContract({ address: auctionAddress, abi: cca_abi, functionName: 'tickSpacing' }) as Promise<bigint>,
      publicClient.readContract({ address: auctionAddress, abi: cca_abi, functionName: 'endBlock' }) as Promise<bigint>,
      publicClient.getBlockNumber(),
      publicClient.readContract({ address: usdcAddress, abi: marketToken_abi, functionName: 'balanceOf', args: [address] }) as Promise<bigint>,
    ])
    if (blockNow >= endBlock) { setError('Auction ended'); throw new Error('Auction ended') }
    if (budget > (usdcNow ?? 0n)) { setError('Insufficient USDC balance'); throw new Error('Insufficient USDC') }

    // Max price: the user's cap when given, else 2x current clearing. Snapped
    // down to the tick grid, and at least one tick above clearing so the bid
    // is accepted. The max only bounds participation — everyone pays the
    // final clearing price.
    if (typeof maxPrice6d === "bigint" && price6dToQ96(maxPrice6d) <= clearingNow) {
      const nowUsdc = (Number(q96ToPrice6d(clearingNow)) / 1e6).toFixed(2)
      const msg = `Max price is below the current clearing price ($${nowUsdc}) — the bid would never fill`
      setError(msg)
      throw new Error(msg)
    }
    const rawMaxQ96 = typeof maxPrice6d === "bigint" ? price6dToQ96(maxPrice6d) : clearingNow * 2n
    let maxPriceQ96 = snapToTick(rawMaxQ96, tickSpacing)
    if (maxPriceQ96 <= clearingNow) maxPriceQ96 = snapToTick(clearingNow, tickSpacing) + tickSpacing

    // Permit2 flow: USDC -> Permit2 (ERC20 approve) + Permit2 allowance -> auction
    try {
      setIsApproving(true)
      const erc20 = new ethers.Contract(usdcAddress, marketToken_abi as any, signer)
      const cur: bigint = await erc20.allowance(address, PERMIT2_ADDRESS)
      if (cur < budget) {
        const tx = await erc20.approve(PERMIT2_ADDRESS, ethers.MaxUint256)
        setLastHash(tx.hash)
        await tx.wait(1)
      }
      const [p2amount] = await publicClient.readContract({
        address: PERMIT2_ADDRESS, abi: permit2_abi, functionName: 'allowance',
        args: [address, usdcAddress, auctionAddress],
      }) as unknown as [bigint, number, number]
      if (p2amount < budget) {
        const permit2 = new ethers.Contract(PERMIT2_ADDRESS, PERMIT2_WRITE_ABI, signer)
        const tx = await permit2.approve(usdcAddress, auctionAddress, (1n << 160n) - 1n, (1n << 48n) - 1n)
        setLastHash(tx.hash)
        await tx.wait(1)
      }
      setIsApproving(false)
      try { window.dispatchEvent(new Event('auction:tx')) } catch {}
    } catch (e: any) {
      setIsApproving(false)
      const msg = e?.shortMessage || e?.message || "Approve failed"
      setError(msg)
      throw new Error(msg)
    }

    // Submit the bid
    try {
      setIsBuying(true)
      const auction = new ethers.Contract(auctionAddress, CCA_WRITE_ABI, signer)
      const tx2 = await auction.submitBid(maxPriceQ96, budget, address, "0x")
      setLastHash(tx2.hash)
      const rcpt2 = await tx2.wait(1)
      if (!rcpt2 || (rcpt2.status !== 1n && rcpt2.status !== 1)) {
        const err = "Bid failed on-chain"
        setError(err)
        throw new Error(err)
      }
      await refetchOnchain()
      try { window.dispatchEvent(new Event('auction:tx')) } catch {}
    } catch (e: any) {
      const msg = e?.shortMessage || e?.message || "Bid failed"
      setError(msg)
      throw new Error(msg)
    } finally {
      setIsBuying(false)
    }
  }, [address, usdcAddress, auctionAddress, amount, chainId, publicClient, refetchOnchain, config])

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
    onchainPrice: clearingPrice6d, // USDC 6d per token (clearing price)
    lastHash,
    collateral: usdcAddress,
    collateralBalance: usdcBalanceState,
  }
}

/**
 * The connected user's bids on one CCA (from BidSubmitted logs), with
 * exit + claim actions for after the auction ends.
 */
export function useAuctionBids({ auctionAddress }: { auctionAddress?: `0x${string}` }) {
  const { address } = useAccount()
  const publicClient = usePublicClient()
  const config = useConfig()
  const [bids, setBids] = useState<{ bidId: bigint; priceQ96: bigint; amount: bigint }[]>([])
  const [isWorking, setIsWorking] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const refetch = useCallback(async () => {
    try {
      if (!publicClient || !address || !auctionAddress) return
      // Start at the auction's own first block: 'earliest' makes a forked node
      // forward the query upstream, where the block range is rejected.
      const fromBlock = await getAuctionStartBlock(publicClient, auctionAddress)

      const [submitted, claimedLogs] = await Promise.all([
        publicClient.getLogs({
          address: auctionAddress,
          event: cca_abi.find((f) => f.type === 'event' && f.name === 'BidSubmitted') as any,
          args: { owner: address }, fromBlock,
        }),
        publicClient.getLogs({
          address: auctionAddress,
          event: cca_abi.find((f) => f.type === 'event' && f.name === 'TokensClaimed') as any,
          args: { owner: address }, fromBlock,
        }),
      ])
      const claimed = new Set(claimedLogs.map((l: any) => String(l.args.bidId)))
      setBids(
        submitted
          .filter((l: any) => !claimed.has(String(l.args.id)))
          .map((l: any) => ({ bidId: l.args.id as bigint, priceQ96: l.args.priceQ96 as bigint, amount: l.args.amount as bigint }))
      )
    } catch {
      // silent
    }
  }, [publicClient, address, auctionAddress])

  useEffect(() => { void refetch() }, [refetch])

  /** exitBid (refund of unspent budget) then claimTokens. */
  const exitAndClaim = useCallback(async (bidId: bigint) => {
    setError(null)
    setIsWorking(true)
    try {
      if (!auctionAddress) throw new Error('No auction')
      const signer = await getEthersSigner(config)
      const auction = new ethers.Contract(auctionAddress, CCA_WRITE_ABI, signer)
      try {
        const tx = await auction.exitBid(bidId)
        await tx.wait(1)
      } catch {
        // already exited (or partially-filled edge case) — try claiming anyway
      }
      const tx2 = await auction.claimTokens(bidId)
      await tx2.wait(1)
      await refetch()
      try { window.dispatchEvent(new Event('auction:tx')) } catch {}
      return true
    } catch (e: any) {
      setError(e?.shortMessage || e?.message || 'Claim failed')
      return false
    } finally {
      setIsWorking(false)
    }
  }, [auctionAddress, refetch, config])

  return { bids, refetch, exitAndClaim, isWorking, error }
}
