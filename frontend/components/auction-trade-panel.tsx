"use client"

import { useMemo, useState, useEffect } from "react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/stateful-button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { useAccount } from "wagmi"
import { toast } from "sonner"
import type { MarketOption, AuctionData } from "@/lib/types"
import { useAuctionBuy } from "@/hooks/use-auction-buy"
import { formatUnits } from "viem"
import { parseUnits } from "viem"
import { cn } from "@/lib/utils"
import { useRef } from "react"
import { ethers } from "ethers"
import { proposal_abi } from "@/contracts/proposal-abi"
import { dutchAuction_abi } from "@/contracts/dutchAuction-abi"
import { marketToken_abi } from "@/contracts/marketToken-abi"
import { treasury_abi } from "@/contracts/treasury-abi"

interface AuctionTradePanelProps {
  auctionData: AuctionData
  isFailed: boolean
  proposalAddress: `0x${string}`
  fullHeight?: boolean
}

export function AuctionTradePanel({ auctionData, isFailed, proposalAddress, fullHeight = false }: AuctionTradePanelProps) {
  const { isConnected, address } = useAccount()
  const [selectedMarket, setSelectedMarket] = useState<MarketOption>("YES")
  const { amount, setAmount, approveAndBuy, isApproving, isBuying, error, remaining, userTokenBalance, onchainPrice, pyusdBalance } =
    useAuctionBuy({ proposalAddress, side: selectedMarket })
  const amountInputRef = useRef<HTMLInputElement | null>(null)
  const [amountError, setAmountError] = useState<string | null>(null)
  const [isClaiming, setIsClaiming] = useState(false)

  // Oracle price is scaled to 6 decimals (PyUSD, 6d)
  const currentPrice = useMemo(() => {
    if (onchainPrice && onchainPrice > 0n) return Number(onchainPrice) / 1_000_000
    return selectedMarket === "YES" ? auctionData.yesCurrentPrice : auctionData.noCurrentPrice
  }, [onchainPrice, selectedMarket, auctionData])
  const estimatedTokens = amount ? (Number.parseFloat(amount) / currentPrice).toFixed(2) : "0.00"

  // Guard: entered PyUSD amount (6d) must not exceed user's PyUSD balance
  const amount6d = useMemo(() => {
    try { return parseUnits(amount || "0", 6) } catch { return 0n }
  }, [amount])
  const insufficientBalance = amount6d > (pyusdBalance ?? 0n)
  const invalidAmount = amount6d <= 0n

  const isDisabled = !isConnected || !amount || invalidAmount || isApproving || isBuying || !proposalAddress || insufficientBalance
  const handleBid = async (): Promise<boolean> => {
    if (isDisabled) return false
    try {
      await approveAndBuy()
      toast.success("Liquidity added!", { description: `${amount} PyUSD for ${estimatedTokens} ${selectedMarket} tokens` })
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
      const anyWindow = window as any
      if (!anyWindow?.ethereum) { toast.error("No wallet found"); return false }
      const provider = new ethers.BrowserProvider(anyWindow.ethereum)
      const signer = await provider.getSigner()

      // Read addresses from Proposal
      const proposal = new ethers.Contract(proposalAddress, proposal_abi as any, signer)
      const [yesAuctionAddr, noAuctionAddr, yesTokenAddr, noTokenAddr, treasuryAddr] = await Promise.all([
        proposal.yesAuction(),
        proposal.noAuction(),
        proposal.yesToken(),
        proposal.noToken(),
        proposal.treasury(),
      ])

      if (!yesAuctionAddr || !noAuctionAddr || !yesTokenAddr || !noTokenAddr || !treasuryAddr) {
        toast.error("Proposal not ready")
        return false
      }

      // Preflight: refunds must be enabled
      const treasury = new ethers.Contract(treasuryAddr as string, treasury_abi as any, signer)
      const enabled: boolean = await treasury.refundsEnabled().catch(() => false)
      if (!enabled) {
        toast.error("Refunds not enabled yet")
        return false
      }

      const me = address as string
      const steps: Array<{ token: string; auction: string; label: string }> = [
        { token: noTokenAddr as string, auction: noAuctionAddr as string, label: "NO" },
        { token: yesTokenAddr as string, auction: yesAuctionAddr as string, label: "YES" },
      ]

      let didAnything = false

      for (const { token, auction, label } of steps) {
        if (!token || token === ethers.ZeroAddress) continue
        const erc20 = new ethers.Contract(token, marketToken_abi as any, signer)
        const bal: bigint = await erc20.balanceOf(me)
        if (!bal || bal === 0n) continue

        // Ensure allowance to Treasury for token refunds
        const cur: bigint = await erc20.allowance(me, treasuryAddr)
        if (cur < bal) {
          const txA = await erc20.approve(treasuryAddr, bal)
          await txA.wait(1)
        }

        const auc = new ethers.Contract(auction, dutchAuction_abi as any, signer)
        try {
          const txR = await auc.refundTokens()
          await txR.wait(1)
          didAnything = true
          toast.success(`Refunded t${label}`, { description: `Returned ${(Number(bal) / 1e18).toFixed(6)} t${label}` })
          // Important: refund transfers full PYUSD balance. Stop after first success to avoid double-payout.
          break
        } catch (e: any) {
          // If it failed, re-check refunds flag to give a clearer message
          const stillEnabled: boolean = await treasury.refundsEnabled().catch(() => false)
          if (!stillEnabled) {
            toast.error("Refunds not enabled yet")
          } else {
            const msg = e?.shortMessage || e?.message || "Refund failed"
            toast.error("Refund failed", { description: msg })
          }
          return false
        }
      }

      if (!didAnything) {
        toast.error("No tokens to refund")
        return false
      }

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
  const [balances, setBalances] = useState<{ tYES: string; tNO: string; treasuryPYUSD: string; pyusdWallet: string } | null>(null)
  useEffect(() => {
    if (!isFailed || !isConnected || !address || !proposalAddress) return

    let cancelled = false

    const fetchBalances = async () => {
      try {
        const anyWindow = window as any
        if (!anyWindow?.ethereum) return
        const provider = new ethers.BrowserProvider(anyWindow.ethereum)
        const signer = await provider.getSigner()
        const proposal = new ethers.Contract(proposalAddress, proposal_abi as any, signer)
        const [yesTokenAddr, noTokenAddr, treasuryAddr, pyusdAddr] = await Promise.all([
          proposal.yesToken(),
          proposal.noToken(),
          proposal.treasury(),
          proposal.pyUSD(),
        ])
        if (!yesTokenAddr || !noTokenAddr || !treasuryAddr || !pyusdAddr) return
        const yesToken = new ethers.Contract(yesTokenAddr, marketToken_abi as any, signer)
        const noToken = new ethers.Contract(noTokenAddr, marketToken_abi as any, signer)
        const treasury = new ethers.Contract(treasuryAddr, treasury_abi as any, signer)
        const pyusd = new ethers.Contract(pyusdAddr, marketToken_abi as any, signer)
        const [tYESRaw, tNORaw, yesSupplyRaw, noSupplyRaw, potYesRaw, potNoRaw, decimals, pyusdWalletRaw] = await Promise.all([
          yesToken.balanceOf(address),
          noToken.balanceOf(address),
          yesToken.totalSupply(),
          noToken.totalSupply(),
          treasury.potYes(),
          treasury.potNo(),
          yesToken.decimals(),
          pyusd.balanceOf(address),
        ])
        const tYES = ethers.formatUnits(tYESRaw, decimals)
        const tNO = ethers.formatUnits(tNORaw, decimals)
        // Treasury PYUSD share: proportional from both pots
        const shareYES = yesSupplyRaw > 0n ? (tYESRaw * potYesRaw) / yesSupplyRaw : 0n
        const shareNO = noSupplyRaw > 0n ? (tNORaw * potNoRaw) / noSupplyRaw : 0n
        const treasuryPYUSD = ethers.formatUnits((BigInt(shareYES) + BigInt(shareNO)), 6)
        const pyusdWallet = ethers.formatUnits(pyusdWalletRaw, 6)
        if (!cancelled) setBalances({ tYES, tNO, treasuryPYUSD, pyusdWallet })
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
                  Your PYUSD balance: {Number(balances.pyusdWallet).toLocaleString(undefined, { maximumFractionDigits: 6 })}
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
                  <p className="text-xs text-muted-foreground">Your PYUSD in Treasury</p>
                  <p className="text-lg font-semibold">{Number(balances.treasuryPYUSD).toLocaleString(undefined, { maximumFractionDigits: 6 })}</p>
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
            {isClaiming ? "Claiming..." : "Claim PYUSD Collateral"}
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
            <CardTitle className="text-lg">Buy Liquidity</CardTitle>
            <CardDescription>Buy {selectedMarket} tokens at current auction price</CardDescription>
          </div>
        </CardHeader>

  <CardContent className={cn("space-y-4", fullHeight && "flex-1 flex flex-col")}> 
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label htmlFor="amount">Amount (PyUSD)</Label>
              <span className="text-xs text-muted-foreground">Balance: {(Number(pyusdBalance) / 1e6).toLocaleString(undefined, { maximumFractionDigits: 6 })} PyUSD</span>
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
                onClick={() => setAmount(formatUnits(pyusdBalance as bigint, 6))}
                className="absolute inset-y-0 right-2 my-auto px-2 text-xs font-medium text-muted-foreground hover:text-foreground"
                disabled={!isConnected || isApproving || isBuying}
              >
                MAX
              </button>
            </div>
          </div>

          <div className="rounded-lg border bg-muted/50 p-4 space-y-2 text-sm">
            <div className="flex justify-between">
              <span className="text-muted-foreground">Current Price (PyUSD, 6d):</span>
              <span className="font-mono">${currentPrice.toFixed(2)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Estimated Tokens:</span>
              <span className="font-mono">{Number(estimatedTokens).toFixed(6)}</span>
            </div>
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
            <div className="text-xs text-destructive">Insufficient PyUSD balance for this amount.</div>
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
                {isApproving ? "Approving..." : isBuying ? "Buying..." : "Buy Liquidity"}
              </Button>
            )
          })()}
        </CardContent>
      </Card>
    </div>
  )
}
