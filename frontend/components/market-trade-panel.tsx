"use client"

import { useMemo, useState, useEffect, useCallback, useRef } from "react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { cn } from "@/lib/utils"
import { Label } from "@/components/ui/label"
import { useAccount } from "wagmi"
import { usePublicClient } from "wagmi"
import { toast } from "sonner"
import type { OrderType, TradeAction, MarketOption } from "@/lib/types"
import { useCreateOrder } from "@/hooks/use-create-order"
import { useGetTop } from "@/hooks/use-get-top"
import { useGetProposalById } from "@/hooks/use-get-proposalById"
import { marketToken_abi } from "@/contracts/marketToken-abi"
import { parseUnits, formatUnits } from "viem"
import { ethers } from "ethers"
import React from "react";
import { Button } from "@/components/ui/stateful-button";
import { useChainId } from "wagmi"
import {getContractAddress} from "@/contracts/constants"

type MarketTradePanelProps = {
  selectedMarket: MarketOption
  onMarketChange: (market: MarketOption) => void
  proposalId: string
  onOrderPlaced?: () => void
}


export function MarketTradePanel({ selectedMarket, onMarketChange, proposalId, onOrderPlaced }: MarketTradePanelProps) {
  const { isConnected, address } = useAccount()
  const chainId = useChainId()
  
  const publicClient = usePublicClient()
  const { createOrder, isLoading: creating, error: createError } = useCreateOrder()

  const [orderType, setOrderType] = useState<OrderType>("market")
  const [tradeAction, setTradeAction] = useState<TradeAction>("BUY")
  const [amount, setAmount] = useState("")
  const [limitPrice, setLimitPrice] = useState("")
  const [amountError, setAmountError] = useState<string | null>(null)

  // Fetch proposal addresses so we can read balances and spender (proposal address)
  const { proposal } = useGetProposalById(proposalId)
  const pyusdAddr = getContractAddress(chainId, 'PYUSD') as `0x${string}` 
  const marketTokenAddr = (selectedMarket === "YES" ? proposal?.yesToken : proposal?.noToken) as `0x${string}` | undefined
  const proposalAddr = proposal?.proposalAddress as `0x${string}` | undefined // spender for applyBatch

  // Read user balances
  const [pyusdBalance, setPyusdBalance] = useState<bigint>(0n)
  const [userTokenBalance, setUserTokenBalance] = useState<bigint>(0n)

  const refetchBalances = useCallback(async () => {
    try {
      if (!publicClient || !address) return
      if (pyusdAddr) {
        const bal = (await publicClient.readContract({ address: pyusdAddr, abi: marketToken_abi, functionName: "balanceOf", args: [address] })) as bigint
        setPyusdBalance(bal ?? 0n)
      } else {
        setPyusdBalance(0n)
      }
      if (marketTokenAddr) {
        const bal2 = (await publicClient.readContract({ address: marketTokenAddr, abi: marketToken_abi, functionName: "balanceOf", args: [address] })) as bigint
        setUserTokenBalance(bal2 ?? 0n)
      } else {
        setUserTokenBalance(0n)
      }
    } catch {
      // ignore
    }
  }, [publicClient, address, pyusdAddr, marketTokenAddr])

  useEffect(() => { void refetchBalances() }, [refetchBalances])
  // Poll balances every 3s to reflect live changes
  useEffect(() => {
    const id = setInterval(() => { void refetchBalances() }, 3000)
    return () => clearInterval(id)
  }, [refetchBalances])

  const pyusdDisplay = useMemo(() => Number(pyusdBalance ?? 0n) / 1e6, [pyusdBalance])
  const tokenDisplay = useMemo(() => Number(userTokenBalance ?? 0n) / 1e18, [userTokenBalance])
  const balanceLabel = tradeAction === "BUY" ? "PyUSD" : `t${selectedMarket}`

  // Amount should not exceed available balance (PyUSD for BUY, MarketToken for SELL)
  const amountParsed = useMemo(() => {
    try {
      return parseUnits(amount || "0", tradeAction === "BUY" ? 6 : 18)
    } catch {
      return 0n
    }
  }, [amount, tradeAction])
  const maxBalance = (tradeAction === "BUY" ? pyusdBalance : userTokenBalance) || 0n
  const insufficientBalance = amountParsed > maxBalance
  const invalidAmount = amountParsed <= 0n
  const amountInputRef = useRef<HTMLInputElement | null>(null)

  // ----- Allowance & Approvals (spender = Proposal contract) -----
  const tokenToApprove = tradeAction === "BUY" ? pyusdAddr : marketTokenAddr
  const [allowance, setAllowance] = useState<bigint>(0n)
  const [isApproving, setIsApproving] = useState(false)

  const refetchAllowance = useCallback(async () => {
    try {
      if (!publicClient || !address || !proposalAddr || !tokenToApprove) {
        setAllowance(0n)
        return
      }
      const a = (await publicClient.readContract({
        address: tokenToApprove,
        abi: marketToken_abi,
        functionName: "allowance",
        args: [address, proposalAddr],
      })) as bigint
      setAllowance(a ?? 0n)
    } catch {
      setAllowance(0n)
    }
  }, [publicClient, address, proposalAddr, tokenToApprove])

  useEffect(() => { void refetchAllowance() }, [refetchAllowance])
  useEffect(() => { // refetch when inputs that affect required token change
    void refetchAllowance()
  }, [tradeAction, selectedMarket, refetchAllowance])

  const needsApproval = useMemo(() => {
    if (!amountParsed || amountParsed === 0n) return false
    return amountParsed > (allowance ?? 0n)
  }, [amountParsed, allowance])

  const handleApprove = useCallback(async (): Promise<boolean> => {
    if (!address) {
      toast.error("Connect wallet")
      return false
    }
    if (!tokenToApprove || !proposalAddr) {
      toast.error("Missing token or spender")
      return false
    }
    if (amountParsed <= 0n) {
      toast.error("Enter amount first")
      return false
    }

    const anyWindow = window as any
    if (!anyWindow?.ethereum) {
      toast.error("No wallet found")
      return false
    }

    try {
      setIsApproving(true)
      const provider = new ethers.BrowserProvider(anyWindow.ethereum)
      const signer = await provider.getSigner()
      const erc20 = new ethers.Contract(tokenToApprove as string, marketToken_abi as any, signer)
      const tx = await erc20.approve(proposalAddr as string, amountParsed)
      toast.info("Approval submitted", { description: tx.hash })
      const rcpt = await tx.wait(1)
      if (!rcpt || (rcpt.status !== 1n && rcpt.status !== 1)) {
        toast.error("Approve failed on-chain")
        setIsApproving(false)
        return false
      }
      await refetchAllowance()
      toast.success("Approved")
      return true
    } catch (e: any) {
      const msg = e?.shortMessage || e?.message || "Approve failed"
      toast.error(msg)
      return false
    } finally {
      setIsApproving(false)
    }
  }, [address, tokenToApprove, proposalAddr, amountParsed, refetchAllowance])

  // Live market price sourced from backend /top endpoint (best ask for BUY, best bid for SELL)
  const top = useGetTop({ proposalId, market: selectedMarket, auto: true, pollMs: 3000 })
  const estimatedPrice = useMemo(() => {
    if (orderType === "market") {
      return tradeAction === "BUY" ? (top.bestAsk ?? 0) : (top.bestBid ?? 0)
    }
    return Number.parseFloat(limitPrice) || 0
  }, [orderType, tradeAction, limitPrice, top.bestAsk, top.bestBid])
  const estimatedAmount = amount ? Number.parseFloat(amount) : 0
  const estimatedTotal = estimatedPrice * estimatedAmount
  // Totals are straightforward estimates (no slippage calculation)

  // What the user receives (tokens for BUY, PyUSD for SELL)
  const receiveLabel = tradeAction === "BUY" ? `t${selectedMarket}` : "PyUSD"
  const estimatedReceive = useMemo(() => {
    if (estimatedPrice <= 0 || estimatedAmount <= 0) return 0
    if (tradeAction === "BUY") {
      return (estimatedAmount / estimatedPrice)
    }
    return (estimatedAmount * estimatedPrice)
  }, [tradeAction, orderType, estimatedAmount, estimatedPrice])

  const handleCreateOrder = async (): Promise<boolean> => {
    if (!amount) return false

    // Auto-approve if needed before placing the order
    if (needsApproval) {
      const ok = await handleApprove()
      if (!ok) return false
    }

    const side: 'approve' | 'reject' = selectedMarket === "YES" ? 'approve' : 'reject'
    const payload = {
      proposalId,
      side,
      orderType: tradeAction === "BUY" ? ("buy" as const) : ("sell" as const),
      orderExecution: orderType,
      price: orderType === "market" ? 0 : Number(limitPrice || 0),
      amount: Number(amount || 0),
    }

    const out = await createOrder(payload)
    if (!out) {
      if (createError) toast.error("Order failed", { description: createError })
      return false
    }

    if (out.ok) {
      toast.success("Order created!", { description: `${tradeAction} ${amount}${orderType === "limit" ? ` @ $${limitPrice}` : " at market"}` })
      setAmount("")
      setLimitPrice("")
      await refetchBalances()
      onOrderPlaced?.()
      return true
    } else {
      toast.error("Order failed", { description: out.data?.error || `Status ${out.status}` })
      return false
    }
  }

  return (
    <div className="space-y-4">
      {/* Order Form */}
      <Card>
        <CardHeader className="space-y-3">
          {/* Market Selector – full width top, no borders between */}
          <div className="relative -mx-6 -mt-6 rounded-t-md bg-muted overflow-hidden">
            <div
              className={`absolute inset-y-0 w-1/2 transition-all duration-300 ease-out ${
                selectedMarket === "YES" ? "left-0 bg-primary" : "left-1/2 bg-destructive"
              }`}
            />
            <div className="relative z-10 flex w-full">
              <button
                onClick={() => onMarketChange("YES")}
                className={`${
                  selectedMarket === "YES" ? "text-black" : "text-muted-foreground hover:text-foreground"
                } w-1/2 py-3 font-semibold text-sm text-center`}
              >
                YES Market
              </button>
              <button
                onClick={() => onMarketChange("NO")}
                className={`${
                  selectedMarket === "NO" ? "text-black" : "text-muted-foreground hover:text-foreground"
                } w-1/2 py-3 font-semibold text-sm text-center`}
              >
                NO Market
              </button>
            </div>
          </div>

          <div>
            <CardTitle className="text-lg">Create Order</CardTitle>
            {/* Adjusted description styling */}
            <CardDescription>Place market or limit orders</CardDescription>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label className="text-sm font-medium">Action</Label>
            <div className="relative rounded-md bg-muted overflow-hidden">
              <div
                className={`absolute inset-y-0 w-1/2 transition-all duration-300 ease-out ${
                  tradeAction === "BUY" ? "left-0 bg-primary" : "left-1/2 bg-destructive"
                }`}
              />
              <div className="relative z-10 flex w-full">
                <button
                  onClick={() => setTradeAction("BUY")}
                  className={`${
                    tradeAction === "BUY" ? "text-black" : "text-muted-foreground hover:text-foreground"
                  } w-1/2 py-2 font-semibold text-sm text-center`}
                >
                  BUY
                </button>
                <button
                  onClick={() => { if (creating || isApproving) return; setTradeAction("SELL") }}
                  disabled={creating || isApproving}
                  aria-disabled={creating || isApproving}
                  className={cn(
                    `${tradeAction === "SELL" ? "text-black" : "text-muted-foreground hover:text-foreground"} w-1/2 py-2 font-semibold text-sm text-center`,
                    (creating || isApproving) && "cursor-not-allowed opacity-60 hover:text-muted-foreground"
                  )}
                >
                  SELL
                </button>
              </div>
            </div>
          </div>

          <div className="space-y-2">
            <Label className="text-sm font-medium">Order Type</Label>
            <div className="relative rounded-md bg-muted overflow-hidden">
              <div
                className={`absolute inset-y-0 w-1/2 transition-all duration-300 ease-out ${
                  orderType === "market" ? "left-0" : "left-1/2"
                } bg-blue-500`}
              />
              <div className="relative z-10 flex w-full">
                <button
                  onClick={() => setOrderType("market")}
                  className={`${orderType === "market" ? "text-black" : "text-muted-foreground hover:text-foreground"} w-1/2 py-2 font-semibold text-sm text-center`}
                >
                  Market
                </button>
                <button
                  onClick={() => setOrderType("limit")}
                  className={`${orderType === "limit" ? "text-black" : "text-muted-foreground hover:text-foreground"} w-1/2 py-2 font-semibold text-sm text-center`}
                >
                  Limit
                </button>
              </div>
            </div>
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label htmlFor="amount">Amount ({balanceLabel})</Label>
              <span className="text-xs text-muted-foreground text-right">
                <div>PyUSD: {pyusdDisplay.toLocaleString(undefined, { maximumFractionDigits: 6 })}</div>
                <div>{`t${selectedMarket}`}: {tokenDisplay.toLocaleString(undefined, { maximumFractionDigits: 6 })}</div>
              </span>
            </div>
            <div className="relative">
              <Input
                id="amount"
                type="number"
                placeholder="0.00"
                value={amount}
                onChange={(e) => {
                  setAmount(e.target.value)
                  if (amountError) setAmountError(null)
                }}
                disabled={!isConnected || creating}
                className="pr-14 no-spin"
                ref={amountInputRef}
              />
              <button
                type="button"
                onClick={() => {
                  const decimals = tradeAction === "BUY" ? 6 : 18
                  const amtStr = formatUnits(maxBalance, decimals)
                  setAmount(amtStr)
                }}
                className="absolute inset-y-0 right-2 my-auto px-2 text-xs font-medium text-muted-foreground hover:text-foreground"
                disabled={!isConnected || creating}
              >
                MAX
              </button>
            </div>
            {amountError && (
              <div className="text-xs text-amber-600 dark:text-amber-400">{amountError}</div>
            )}
            {insufficientBalance && (
              <div className="text-xs text-destructive">Insufficient {balanceLabel} balance for this amount.</div>
            )}
          </div>

          {orderType === "limit" && (
            <div className="space-y-2">
              <Label htmlFor="price">Limit Price</Label>
              <Input
                id="price"
                type="number"
                placeholder="0.00"
                value={limitPrice}
                onChange={(e) => setLimitPrice(e.target.value)}
                disabled={!isConnected || creating}
                className="no-spin"
              />
            </div>
          )}

          {/* Totals shown without slippage controls */}

          <div className="rounded-lg border bg-muted/50 p-2 space-y-1 text-sm">
            {orderType === "market" && (
              <div className="flex justify-between">
                <span className="text-muted-foreground">Est. Price:</span>
                <span className="font-mono">${estimatedPrice.toFixed(4)}</span>
              </div>
            )}
            {/* Simplified summary (no slippage line, no separate "You Pay") */}
            <div className="flex justify-between font-semibold pt-2">
              <span>You Receive:</span>
              <span className="font-mono">{estimatedReceive.toLocaleString(undefined, { maximumFractionDigits: 6 })} {receiveLabel}</span>
            </div>
          </div>

          {(() => {
            const variantEnabled =
              tradeAction === "BUY"
                ? "bg-primary text-primary-foreground hover:bg-primary/90"
                : "bg-destructive text-destructive-foreground hover:bg-destructive/90";
            // Disabled: muted gray with subtle border, no hover
            const variantDisabled = "bg-muted text-muted-foreground border border-border";
            const invalidLimit = orderType === "limit" && (!limitPrice || Number(limitPrice) <= 0);
            // Disable SELL while approving; keep existing guards
            const isDisabled = !isConnected
              || creating
              || (tradeAction === "SELL" && isApproving)
              || !amount
              || invalidAmount
              || invalidLimit
              || insufficientBalance;
            return (
              <Button
                onClick={handleCreateOrder}
                aria-disabled={isDisabled}
                onDisabledClick={() => {
                  // Ignore clicks while a tx is pending
                  if (creating || isApproving) return;
                  if (!amount || invalidAmount) {
                    amountInputRef.current?.focus()
                    setAmountError("Please enter a valid amount.")
                  }
                }}
                className={cn(
                  // Base button styles
                  "w-full inline-flex items-center justify-center whitespace-nowrap rounded-md text-sm font-medium ring-offset-background transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 h-10 px-4 py-2",
                  // Color variant or muted when disabled (affects loader/check via text-current)
                  isDisabled
                    ? cn(variantDisabled, "opacity-60 cursor-not-allowed hover:ring-0 focus-visible:ring-0", (creating || isApproving) && "pointer-events-none")
                    : cn(variantEnabled, tradeAction === "BUY" ? "hover:ring-green-500" : "hover:ring-red-500"),
                )}
              >
                {isApproving ? "Approving..." : (creating ? "Creating..." : `${tradeAction} ${orderType === "market" ? "at Market" : "with Limit"}`)}
              </Button>
            )
          })()}
        </CardContent>
      </Card>
    </div>
  )
}
