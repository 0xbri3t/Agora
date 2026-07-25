"use client"

// Aqua-era trading panel: SELL places a fill-or-kill lot on 1inch Aqua (ship),
// BUY fills a resting lot exactly through the SwapVM router. All wallet txs.
import { useMemo, useState, useEffect, useCallback, useRef } from "react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { cn } from "@/lib/utils"
import { Label } from "@/components/ui/label"
import { useAccount, usePublicClient } from "wagmi"
import { toast } from "sonner"
import type { TradeAction, MarketOption } from "@/lib/types"
import { useAquaQuote } from "@/hooks/use-aqua-quote"
import { useAquaFill } from "@/hooks/use-aqua-fill"
import { useGetOrderbookOrders } from "@/hooks/use-get-orderbook-orders"
import { useGetProposalById } from "@/hooks/use-get-proposalById"
import { marketToken_abi } from "@/contracts/marketToken-abi"
import { AQUA_ADDRESSES } from "@/contracts/aqua"
import { parseUnits, formatUnits } from "viem"
import React from "react"
import { Button } from "@/components/ui/stateful-button"

type MarketTradePanelProps = {
  selectedMarket: MarketOption
  onMarketChange: (market: MarketOption) => void
  proposalId: string
  onOrderPlaced?: () => void
}

type LotOrder = {
  id?: string
  price: string | number
  amount: string | number
  status?: string
  orderType?: string
  strategyHash?: string
  aquaOrder?: { maker: string; traits: string; data: string } | null
}

export function MarketTradePanel({ selectedMarket, onMarketChange, proposalId, onOrderPlaced }: MarketTradePanelProps) {
  const { isConnected, address } = useAccount()
  const publicClient = usePublicClient()

  const { shipQuote, isLoading: shipping, error: shipError } = useAquaQuote()
  const { fillLot, isLoading: filling, error: fillError } = useAquaFill()

  const [tradeAction, setTradeAction] = useState<TradeAction>("BUY")
  const [amount, setAmount] = useState("")
  const [limitPrice, setLimitPrice] = useState("")
  const [amountError, setAmountError] = useState<string | null>(null)

  const { proposal } = useGetProposalById(proposalId)
  const usdcAddr = AQUA_ADDRESSES.usdc
  const marketTokenAddr = (selectedMarket === "YES" ? proposal?.yesToken : proposal?.noToken) as `0x${string}` | undefined

  // Live lots (open sell orders indexed from Aqua Shipped events)
  const { orders: liveOrders, refetch: refetchOrders } = useGetOrderbookOrders({ proposalId, market: selectedMarket, auto: true, pollMs: 3000 })
  const askLots = useMemo<LotOrder[]>(() => {
    const list = (Array.isArray(liveOrders) ? liveOrders : []) as LotOrder[]
    return list
      .filter((o) => o.orderType === 'sell' && (o.status === 'open') && o.aquaOrder?.data)
      .sort((a, b) => Number(a.price) - Number(b.price))
      .slice(0, 6)
  }, [liveOrders])

  // Balances (USDC 6d, market token 18d)
  const [usdcBalance, setUsdcBalance] = useState<bigint>(0n)
  const [userTokenBalance, setUserTokenBalance] = useState<bigint>(0n)

  const refetchBalances = useCallback(async () => {
    try {
      if (!publicClient || !address) return
      const bal = (await publicClient.readContract({ address: usdcAddr, abi: marketToken_abi, functionName: "balanceOf", args: [address] })) as bigint
      setUsdcBalance(bal ?? 0n)
      if (marketTokenAddr) {
        const bal2 = (await publicClient.readContract({ address: marketTokenAddr, abi: marketToken_abi, functionName: "balanceOf", args: [address] })) as bigint
        setUserTokenBalance(bal2 ?? 0n)
      } else {
        setUserTokenBalance(0n)
      }
    } catch {
      // ignore
    }
  }, [publicClient, address, usdcAddr, marketTokenAddr])

  useEffect(() => { void refetchBalances() }, [refetchBalances])
  useEffect(() => {
    const id = setInterval(() => { void refetchBalances() }, 3000)
    return () => clearInterval(id)
  }, [refetchBalances])

  const usdcDisplay = useMemo(() => Number(usdcBalance ?? 0n) / 1e6, [usdcBalance])
  const tokenDisplay = useMemo(() => Number(userTokenBalance ?? 0n) / 1e18, [userTokenBalance])

  // ----- SELL (place a lot) -----
  const amountParsed = useMemo(() => {
    try { return parseUnits(amount || "0", 18) } catch { return 0n }
  }, [amount])
  const insufficientBalance = tradeAction === "SELL" && amountParsed > (userTokenBalance || 0n)
  const invalidAmount = amountParsed <= 0n
  const amountInputRef = useRef<HTMLInputElement | null>(null)
  const busy = shipping || filling

  const lotTotalUsdc = useMemo(() => {
    const p = Number(limitPrice || 0)
    const a = Number(amount || 0)
    return p > 0 && a > 0 ? p * a : 0
  }, [limitPrice, amount])

  const handlePlaceLot = async (): Promise<boolean> => {
    if (!marketTokenAddr) { toast.error("Market not ready"); return false }
    if (!amount || invalidAmount || !limitPrice || Number(limitPrice) <= 0) return false

    const out = await shipQuote({ outcomeToken: marketTokenAddr, amountTokens: amount, priceUsdc: limitPrice })
    if (!out) {
      toast.error("Lot placement failed", { description: shipError ?? undefined })
      return false
    }
    toast.success("Lot placed on Aqua!", { description: `SELL ${amount} t${selectedMarket} @ $${limitPrice} (fill-or-kill)` })
    setAmount(""); setLimitPrice("")
    await refetchBalances(); refetchOrders?.()
    onOrderPlaced?.()
    return true
  }

  // ----- BUY (fill a lot) -----
  const handleFillLot = async (lot: LotOrder): Promise<boolean> => {
    if (!marketTokenAddr || !lot.aquaOrder) return false
    // exact lot cost: price (USDC 6d per 1e18) * amount (18d) / 1e18
    const price6d = BigInt(Math.round(Number(lot.price)))
    const amount18 = BigInt(lot.amount.toString())
    const lotUsdc = (price6d * amount18) / 10n ** 18n

    const out = await fillLot({ order: lot.aquaOrder, outcomeToken: marketTokenAddr, lotUsdc })
    if (!out) {
      toast.error("Fill failed", { description: fillError ?? undefined })
      return false
    }
    toast.success("Lot filled!", { description: `Bought ${formatUnits(amount18, 18)} t${selectedMarket} for ${formatUnits(lotUsdc, 6)} USDC` })
    await refetchBalances(); refetchOrders?.()
    onOrderPlaced?.()
    return true
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="space-y-3">
          {/* Market Selector */}
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
            <CardTitle className="text-lg">Trade on Aqua</CardTitle>
            <CardDescription>Lots settle on-chain via 1inch SwapVM</CardDescription>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* BUY / SELL */}
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
                  onClick={() => { if (busy) return; setTradeAction("SELL") }}
                  disabled={busy}
                  className={cn(
                    `${tradeAction === "SELL" ? "text-black" : "text-muted-foreground hover:text-foreground"} w-1/2 py-2 font-semibold text-sm text-center`,
                    busy && "cursor-not-allowed opacity-60"
                  )}
                >
                  SELL
                </button>
              </div>
            </div>
          </div>

          {/* Balances */}
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span>USDC: {usdcDisplay.toLocaleString(undefined, { maximumFractionDigits: 6 })}</span>
            <span>{`t${selectedMarket}`}: {tokenDisplay.toLocaleString(undefined, { maximumFractionDigits: 6 })}</span>
          </div>

          {tradeAction === "SELL" ? (
            <>
              {/* SELL: place a fill-or-kill lot */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label htmlFor="amount">Amount (t{selectedMarket})</Label>
                </div>
                <div className="relative">
                  <Input
                    id="amount"
                    type="number"
                    placeholder="0.00"
                    value={amount}
                    onChange={(e) => { setAmount(e.target.value); if (amountError) setAmountError(null) }}
                    disabled={!isConnected || busy}
                    className="pr-14 no-spin"
                    ref={amountInputRef}
                  />
                  <button
                    type="button"
                    onClick={() => setAmount(formatUnits(userTokenBalance || 0n, 18))}
                    className="absolute inset-y-0 right-2 my-auto px-2 text-xs font-medium text-muted-foreground hover:text-foreground"
                    disabled={!isConnected || busy}
                  >
                    MAX
                  </button>
                </div>
                {amountError && <div className="text-xs text-amber-600 dark:text-amber-400">{amountError}</div>}
                {insufficientBalance && <div className="text-xs text-destructive">Insufficient t{selectedMarket} balance.</div>}
              </div>

              <div className="space-y-2">
                <Label htmlFor="price">Price (USDC per t{selectedMarket})</Label>
                <Input
                  id="price"
                  type="number"
                  placeholder="0.00"
                  value={limitPrice}
                  onChange={(e) => setLimitPrice(e.target.value)}
                  disabled={!isConnected || busy}
                  className="no-spin"
                />
              </div>

              <div className="rounded-lg border bg-muted/50 p-2 space-y-1 text-sm">
                <div className="flex justify-between font-semibold">
                  <span>Lot total:</span>
                  <span className="font-mono">{lotTotalUsdc.toLocaleString(undefined, { maximumFractionDigits: 6 })} USDC</span>
                </div>
                <div className="text-xs text-muted-foreground">Fill-or-kill: the lot fills entirely at this exact price, or not at all. Funds stay in your wallet until filled. Cancel anytime.</div>
              </div>

              {(() => {
                const invalidLimit = !limitPrice || Number(limitPrice) <= 0
                const isDisabled = !isConnected || busy || !amount || invalidAmount || invalidLimit || insufficientBalance
                return (
                  <Button
                    onClick={handlePlaceLot}
                    aria-disabled={isDisabled}
                    onDisabledClick={() => {
                      if (busy) return
                      if (!amount || invalidAmount) {
                        amountInputRef.current?.focus()
                        setAmountError("Please enter a valid amount.")
                      }
                    }}
                    className={cn(
                      "w-full inline-flex items-center justify-center whitespace-nowrap rounded-md text-sm font-medium ring-offset-background transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 h-10 px-4 py-2",
                      isDisabled
                        ? "bg-muted text-muted-foreground border border-border opacity-60 cursor-not-allowed"
                        : "bg-destructive text-destructive-foreground hover:bg-destructive/90 hover:ring-red-500",
                    )}
                  >
                    {shipping ? "Placing lot..." : "Place Sell Lot"}
                  </Button>
                )
              })()}
            </>
          ) : (
            <>
              {/* BUY: fill a resting lot exactly */}
              <div className="space-y-2">
                <Label className="text-sm font-medium">Available lots (best price first)</Label>
                {askLots.length === 0 ? (
                  <div className="rounded-lg border bg-muted/50 p-4 text-sm text-muted-foreground text-center">
                    No lots on the {selectedMarket} book yet. Place a sell lot or check back soon.
                  </div>
                ) : (
                  <div className="space-y-2">
                    {askLots.map((lot, i) => {
                      const price6d = Number(lot.price)
                      const amount18 = BigInt(lot.amount.toString())
                      const priceHuman = price6d / 1e6
                      const sizeHuman = Number(formatUnits(amount18, 18))
                      const costHuman = priceHuman * sizeHuman
                      const cantAfford = parseUnits(costHuman.toFixed(6), 6) > (usdcBalance || 0n)
                      return (
                        <div key={lot.strategyHash ?? i} className="flex items-center justify-between rounded-lg border p-2 text-sm">
                          <div>
                            <div className="font-mono font-semibold">${priceHuman.toFixed(4)} <span className="text-muted-foreground font-normal">/ t{selectedMarket}</span></div>
                            <div className="text-xs text-muted-foreground">{sizeHuman.toLocaleString(undefined, { maximumFractionDigits: 4 })} t{selectedMarket} · {costHuman.toLocaleString(undefined, { maximumFractionDigits: 4 })} USDC total</div>
                          </div>
                          <Button
                            onClick={() => handleFillLot(lot)}
                            aria-disabled={!isConnected || busy || cantAfford}
                            className={cn(
                              "inline-flex items-center justify-center whitespace-nowrap rounded-md text-xs font-semibold h-8 px-3",
                              (!isConnected || busy || cantAfford)
                                ? "bg-muted text-muted-foreground border border-border opacity-60 cursor-not-allowed"
                                : "bg-primary text-primary-foreground hover:bg-primary/90",
                            )}
                          >
                            {filling ? "Filling..." : cantAfford ? "Low USDC" : "Fill lot"}
                          </Button>
                        </div>
                      )
                    })}
                  </div>
                )}
                <div className="text-xs text-muted-foreground">Lots are all-or-nothing: you buy the whole lot at its exact price, settled on-chain through 1inch Aqua.</div>
              </div>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
