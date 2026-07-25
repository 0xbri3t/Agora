"use client"

import { useMemo, useState, useEffect } from "react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/stateful-button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { useAccount, useConfig } from "wagmi"
import { toast } from "sonner"
import type { MarketOption, AuctionData } from "@/lib/types"
import { useAuctionBuy } from "@/hooks/use-auction-buy"
import { formatUnits } from "viem"
import { parseUnits } from "viem"
import { cn } from "@/lib/utils"
import { useRef } from "react"
import { ethers } from "ethers"
import { proposal_abi } from "@/contracts/proposal-abi"
import { cca_abi } from "@/contracts/cca-abi"
import { marketToken_abi } from "@/contracts/marketToken-abi"
import { treasury_abi } from "@/contracts/treasury-abi"
import { getEthersSigner } from "@/lib/signer"

interface AuctionTradePanelProps {
  auctionData: AuctionData
  isFailed: boolean
  proposalAddress: `0x${string}`
  fullHeight?: boolean
}

export function AuctionTradePanel({ auctionData, isFailed, proposalAddress, fullHeight = false }: AuctionTradePanelProps) {
  const { isConnected, address } = useAccount()
  const config = useConfig()
  const [selectedMarket, setSelectedMarket] = useState<MarketOption>("YES")
  const { amount, setAmount, approveAndBuy, isApproving, isBuying, error, remaining, userTokenBalance, onchainPrice, collateralBalance } =
    useAuctionBuy({ proposalAddress, side: selectedMarket })
  const amountInputRef = useRef<HTMLInputElement | null>(null)
  const [amountError, setAmountError] = useState<string | null>(null)
  const [isClaiming, setIsClaiming] = useState(false)

  // Oracle price is scaled to 6 decimals (USDC, 6d)
  const currentPrice = useMemo(() => {
    if (onchainPrice && onchainPrice > 0n) return Number(onchainPrice) / 1_000_000
    return selectedMarket === "YES" ? auctionData.yesCurrentPrice : auctionData.noCurrentPrice
  }, [onchainPrice, selectedMarket, auctionData])
  const estimatedTokens = amount ? (Number.parseFloat(amount) / currentPrice).toFixed(2) : "0.00"

  // Guard: entered USDC amount (6d) must not exceed user's USDC balance
  const amount6d = useMemo(() => {
    try { return parseUnits(amount || "0", 6) } catch { return 0n }
  }, [amount])
  const insufficientBalance = amount6d > (collateralBalance ?? 0n)
  const invalidAmount = amount6d <= 0n

  const isDisabled = !isConnected || !amount || invalidAmount || isApproving || isBuying || !proposalAddress || insufficientBalance
  const handleBid = async (): Promise<boolean> => {
    if (isDisabled) return false
    try {
      await approveAndBuy()
      toast.success("Liquidity added!", { description: `${amount} USDC for ${estimatedTokens} ${selectedMarket} tokens` })
      setAmount("")
      return true
    } catch (e: any) {
      toast.error("Liquidity failed", { description: error || e?.message })
      return false
    }
  }

  const handleClaim = async (): Promise<boolean> => {
    if (!isConnected) { toast.error("Connect wallet"); return false }
    if (!address) { toast.error("No account"); return false }
    setIsClaiming(true)
    try {
      const signer = await getEthersSigner(config)
      const provider = signer.provider

      const proposal = new ethers.Contract(proposalAddress, proposal_abi as any, signer)
      const [yesAuctionAddr, noAuctionAddr] = await Promise.all([
        proposal.yesAuction(),
        proposal.noAuction(),
      ])
      if (!yesAuctionAddr || !noAuctionAddr) { toast.error("Proposal not ready"); return false }

      // A non-graduated CCA refunds bidders directly: exit every bid we own.
      const iface = new ethers.Interface([
        'event BidSubmitted(uint256 indexed id, address indexed owner, uint256 priceQ96, uint128 amount)',
        'event BidExited(uint256 indexed bidId, address indexed owner, uint256 tokensFilled, uint256 currencyRefunded)',
        'function exitBid(uint256 bidId)',
        'function startBlock() view returns (uint64)',
      ])
      let exited = 0
      for (const auctionAddr of [yesAuctionAddr as string, noAuctionAddr as string]) {
        // Scan from the auction's first block: block 0 makes a forked node
        // forward the query upstream, where the range is rejected.
        const fromBlock = await new ethers.Contract(auctionAddr, iface, provider).startBlock()
        const submitted = await provider.getLogs({
          address: auctionAddr, fromBlock,
          topics: [iface.getEvent('BidSubmitted')!.topicHash, null, ethers.zeroPadValue(address, 32)],
        })
        const alreadyExited = await provider.getLogs({
          address: auctionAddr, fromBlock,
          topics: [iface.getEvent('BidExited')!.topicHash, null, ethers.zeroPadValue(address, 32)],
        })
        const exitedIds = new Set(alreadyExited.map((l) => String(iface.parseLog(l)!.args.bidId)))
        const auction = new ethers.Contract(auctionAddr, iface, signer)
        for (const log of submitted) {
          const bidId = iface.parseLog(log)!.args.id as bigint
          if (exitedIds.has(String(bidId))) continue
          try {
            const tx = await auction.exitBid(bidId)
            await tx.wait(1)
            exited++
          } catch (e: any) {
            toast.error("Exit failed", { description: e?.shortMessage || e?.message })
            return false
          }
        }
      }

      if (exited === 0) {
        toast.error("No bids to refund")
        return false
      }
      toast.success(`Refunded ${exited} bid${exited > 1 ? 's' : ''}`)
      try { window.dispatchEvent(new Event('auction:tx')) } catch {}
      return true
    } catch (e: any) {
      const msg = e?.shortMessage || e?.message || "Refund failed"
      toast.error("Refund failed", { description: msg })
      return false
    } finally {
      setIsClaiming(false)
    }
  }

  // On-chain reads for failed auction balances
  const [balances, setBalances] = useState<{ tYES: string; tNO: string; treasuryCollateral: string; collateralWallet: string } | null>(null)
  useEffect(() => {
    if (!isFailed || !isConnected || !address || !proposalAddress) return

    let cancelled = false

    const fetchBalances = async () => {
      try {
        const signer = await getEthersSigner(config)
        const proposal = new ethers.Contract(proposalAddress, proposal_abi as any, signer)
        const [yesTokenAddr, noTokenAddr, treasuryAddr, collateralAddr] = await Promise.all([
          proposal.yesToken(),
          proposal.noToken(),
          proposal.treasury(),
          proposal.collateral(),
        ])
        if (!yesTokenAddr || !noTokenAddr || !treasuryAddr || !collateralAddr) return
        const yesToken = new ethers.Contract(yesTokenAddr, marketToken_abi as any, signer)
        const noToken = new ethers.Contract(noTokenAddr, marketToken_abi as any, signer)
        const treasury = new ethers.Contract(treasuryAddr, treasury_abi as any, signer)
        const collateral = new ethers.Contract(collateralAddr, marketToken_abi as any, signer)
        const [tYESRaw, tNORaw, yesSupplyRaw, noSupplyRaw, potYesRaw, potNoRaw, decimals, collateralWalletRaw] = await Promise.all([
          yesToken.balanceOf(address),
          noToken.balanceOf(address),
          yesToken.totalSupply(),
          noToken.totalSupply(),
          treasury.potYes(),
          treasury.potNo(),
          yesToken.decimals(),
          collateral.balanceOf(address),
        ])
        const tYES = ethers.formatUnits(tYESRaw, decimals)
        const tNO = ethers.formatUnits(tNORaw, decimals)
        // Treasury USDC share: proportional from both pots
        const shareYES = yesSupplyRaw > 0n ? (tYESRaw * potYesRaw) / yesSupplyRaw : 0n
        const shareNO = noSupplyRaw > 0n ? (tNORaw * potNoRaw) / noSupplyRaw : 0n
        const treasuryCollateral = ethers.formatUnits((BigInt(shareYES) + BigInt(shareNO)), 6)
        const collateralWallet = ethers.formatUnits(collateralWalletRaw, 6)
        if (!cancelled) setBalances({ tYES, tNO, treasuryCollateral, collateralWallet })
      } catch {
        if (!cancelled) setBalances(null)
      }
    }

    // Initial load
    fetchBalances()

    // Refresh on any auction-related tx broadcast
    const onTx = () => { fetchBalances() }
    try { window.addEventListener("auction:tx", onTx) } catch {}

    return () => {
      cancelled = true
      try { window.removeEventListener("auction:tx", onTx) } catch {}
    }
  }, [isFailed, isConnected, address, proposalAddress])

  if (isFailed) {
    return (
      <Card className={fullHeight ? "h-full flex flex-col" : undefined}>
        <CardHeader>
          <CardTitle className="text-destructive">Auction Failed</CardTitle>
          <CardDescription>Minimum bid requirement not met</CardDescription>
        </CardHeader>
        <CardContent className={fullHeight ? "flex-1 flex flex-col justify-end" : undefined}>
          {/* Balances block above claim button */}
          {balances && (
            <>
              <div className="mb-2">
                <span className="text-sm font-semibold text-muted-foreground">
                  Your USDC balance: {Number(balances.collateralWallet).toLocaleString(undefined, { maximumFractionDigits: 6 })}
                </span>
              </div>
              <div className="mb-4 flex flex-wrap gap-3 justify-between">
                <div className="rounded-md border bg-muted/30 p-3 min-w-[120px]">
                  <p className="text-xs text-muted-foreground">Your tYES</p>
                  <p className="text-lg font-semibold">{Number(balances.tYES).toLocaleString(undefined, { maximumFractionDigits: 6 })}</p>
                </div>
                <div className="rounded-md border bg-muted/30 p-3 min-w-[120px]">
                  <p className="text-xs text-muted-foreground">Your tNO</p>
                  <p className="text-lg font-semibold">{Number(balances.tNO).toLocaleString(undefined, { maximumFractionDigits: 6 })}</p>
                </div>
                <div className="rounded-md border bg-muted/30 p-3 min-w-[140px]">
                  <p className="text-xs text-muted-foreground">Your USDC in Treasury</p>
                  <p className="text-lg font-semibold">{Number(balances.treasuryCollateral).toLocaleString(undefined, { maximumFractionDigits: 6 })}</p>
                </div>
              </div>
            </>
          )}
          <Button
            className={[
              "w-full text-base py-5",
              "rounded-md text-white",
              "bg-gradient-to-b from-emerald-500 to-emerald-600",
              "shadow ring-1 ring-emerald-400/40",
              "transition-all duration-200",
              "hover:from-emerald-500/90 hover:to-emerald-600/90 hover:shadow-lg hover:shadow-emerald-500/20",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400",
              "disabled:opacity-50 disabled:cursor-not-allowed",
            ].join(" ")}
            onClick={handleClaim}
            aria-disabled={!isConnected || isClaiming || balances?.tYES === "0.0" && balances?.tNO === "0.0"}
          >
            {isClaiming ? "Claiming..." : "Claim USDC Collateral"}
          </Button>
        </CardContent>
      </Card>
    )
  }

  return (
    <div className="h-full">
      <Card className={fullHeight ? "h-full flex flex-col" : undefined}>
        <CardHeader className="space-y-3">
          {/* Market Selector – full width top, no borders between (match MarketTradePanel) */}
          <div className="relative -mx-6 -mt-6 rounded-t-md bg-muted overflow-hidden">
            <div
              className={`absolute inset-y-0 w-1/2 transition-all duration-300 ease-out ${
                selectedMarket === "YES" ? "left-0 bg-primary" : "left-1/2 bg-destructive"
              }`}
            />
            <div className="relative z-10 flex w-full">
              <button
                onClick={() => setSelectedMarket("YES")}
                className={`${
                  selectedMarket === "YES" ? "text-black" : "text-muted-foreground hover:text-foreground"
                } w-1/2 py-3 font-semibold text-sm text-center`}
              >
                YES Market
              </button>
              <button
                onClick={() => setSelectedMarket("NO")}
                className={`${
                  selectedMarket === "NO" ? "text-black" : "text-muted-foreground hover:text-foreground"
                } w-1/2 py-3 font-semibold text-sm text-center`}
              >
                NO Market
              </button>
            </div>
          </div>

          <div>
            <CardTitle className="text-lg">Place Bid</CardTitle>
            <CardDescription>Bid a USDC budget for {selectedMarket} tokens; the auction clears everyone at one price</CardDescription>
          </div>
        </CardHeader>

  <CardContent className={cn("space-y-4", fullHeight && "flex-1 flex flex-col")}> 
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label htmlFor="amount">Amount (USDC)</Label>
              <span className="text-xs text-muted-foreground">Balance: {(Number(collateralBalance) / 1e6).toLocaleString(undefined, { maximumFractionDigits: 6 })} USDC</span>
            </div>
            <div className="relative">
              <Input
                id="amount"
                type="number"
                placeholder="0.00"
                value={amount}
                onChange={(e) => { setAmount(e.target.value); if (amountError) setAmountError(null) }}
                disabled={!isConnected || isApproving || isBuying}
                className="pr-14 no-spin"
                ref={amountInputRef}
              />
              {amountError && (
                <div className="mt-1 text-xs text-amber-600 dark:text-amber-400">{amountError}</div>
              )}
              <button
                type="button"
                onClick={() => setAmount(formatUnits(collateralBalance as bigint, 6))}
                className="absolute inset-y-0 right-2 my-auto px-2 text-xs font-medium text-muted-foreground hover:text-foreground"
                disabled={!isConnected || isApproving || isBuying}
              >
                MAX
              </button>
            </div>
          </div>

          <div className="rounded-lg border bg-muted/50 p-4 space-y-2 text-sm">
            <div className="flex justify-between">
              <span className="text-muted-foreground">Current Price (USDC, 6d):</span>
              <span className="font-mono">${currentPrice.toFixed(2)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Your Max Price (2× current):</span>
              <span className="font-mono">${(currentPrice * 2).toFixed(2)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Estimated Tokens:</span>
              <span className="font-mono">{Number(estimatedTokens).toFixed(6)}</span>
            </div>
            <p className="text-xs text-muted-foreground">
              Uniform-price auction: you commit a USDC budget capped at your max
              price. Everyone pays the same final clearing price at close — your
              exact tokens are known then, and claimed after settlement.
            </p>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Your t{selectedMarket} Balance:</span>
              <span className="font-mono">{(Number((userTokenBalance) ?? 0n) / 1e18).toFixed(6)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Remaining Mintable:</span>
              <span className="font-mono">{(Number(remaining) / 1e18).toFixed(6)}</span>
            </div>
          </div>

          {insufficientBalance && (
            <div className="text-xs text-destructive">Insufficient USDC balance for this amount.</div>
          )}

          {(() => {
            const variantEnabled = selectedMarket === "YES"
              ? "bg-primary text-primary-foreground hover:bg-primary/90"
              : "bg-destructive text-destructive-foreground hover:bg-destructive/90";
            const variantDisabled = "bg-muted text-muted-foreground border border-border";
            return (
              <Button
                onClick={handleBid}
                aria-disabled={isDisabled}
                onDisabledClick={() => {
                  // Ignore clicks during approval/buy pending states
                  if (isApproving || isBuying) return
                  if (!amount || invalidAmount) {
                    amountInputRef.current?.focus()
                    setAmountError("Please enter a valid amount.")
                  }
                }}
                className={cn(
                  "w-full inline-flex items-center justify-center whitespace-nowrap rounded-md text-sm font-medium ring-offset-background transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 h-10 px-4 py-2",
                  isDisabled
                    ? cn(variantDisabled, "opacity-60 cursor-not-allowed hover:ring-0 focus-visible:ring-0", (isApproving || isBuying) && "pointer-events-none")
                    : cn(variantEnabled, selectedMarket === "YES" ? "hover:ring-green-500" : "hover:ring-red-500"),
                )}
              >
                {isApproving ? "Approving..." : isBuying ? "Bidding..." : "Place Bid"}
              </Button>
            )
          })()}
        </CardContent>
      </Card>
    </div>
  )
}
