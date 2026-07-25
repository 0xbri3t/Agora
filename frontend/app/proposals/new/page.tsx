"use client"

import React, { useState, useEffect } from "react"
import { useRouter } from "next/navigation"
import Link from "next/link"
import { ArrowLeft } from "lucide-react"
import { Hex } from "viem"
import { ethers } from "ethers"

import { Button as StatefulButton } from "@/components/ui/stateful-button"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { useToast } from "@/hooks/use-toast"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { ConnectWalletButton } from "@/components/wallet-button"

import { getSupportedCollaterals, type Collateral } from "@/lib/collaterals"
import { 
  useChainId,
  useAccount, useConfig } from "wagmi"
import { proposalManager_abi } from "@/contracts/proposalManager-abi"
import { getContractAddress } from "@/contracts/constants"
import { getEthersSigner } from "@/lib/signer"

export default function NewProposalPage() {

  const chainId = useChainId()
  const { address: account, isConnected } = useAccount()
  const config = useConfig()
  const contractAddress = getContractAddress(chainId, "PROPOSAL_MANAGER")

  const tokenOptions: Collateral[] = React.useMemo(
    () => getSupportedCollaterals(chainId),
    [chainId]
  )

  const byPythID = React.useMemo(
   () => new Map(tokenOptions.map(t => [t.pythID, t])),
    [tokenOptions]    
  )

  const router = useRouter()
  const { toast } = useToast()

  const isUint = (v: string) => /^\d+$/.test(v)

  // On the local fork durations are entered in MINUTES so a full lifecycle
  // demo fits in one take; everywhere else the unit is hours.
  const IS_FORK = process.env.NEXT_PUBLIC_OPENFORT_LOCAL === '1'
  const DURATION_UNIT = IS_FORK ? 'Minutes' : 'Hours'
  const DURATION_UNIT_SECONDS = IS_FORK ? 60 : 3600

  const [formData, setFormData] = useState({
    title: "",
    description: "",
    auctionDuration: "",
    liveDuration: "",
    subjectToken: "",
    minToOpen: "",
    maxCap: "",
    pythAddress: "",
    pythId: "",
  })

  // Validation state (declared after limits and toggles)

  // Limits
  const MAX_TITLE = 80
  const MAX_DESC = 600

  // Validation state and helpers
  type Errors = Partial<Record<
    | "title"
    | "description"
    | "auctionDuration"
    | "liveDuration"
    | "subjectToken"
    | "minToOpen"
    | "maxCap",
    string
  >>
  const [errors, setErrors] = useState<Errors>({})
  const [showErrors, setShowErrors] = useState(false)

  const validate = React.useCallback((): Errors => {
    const next: Errors = {}

    if (!formData.title.trim()) next.title = "Please provide a proposal title."
    else if (formData.title.length > MAX_TITLE) next.title = `Title is too long (max ${MAX_TITLE} characters).`

    if (!formData.description.trim()) next.description = "Please provide a proposal description."
    else if (formData.description.length > MAX_DESC) next.description = `Description is too long (max ${MAX_DESC} characters).`

    if (!formData.auctionDuration || Number(formData.auctionDuration) <= 0 || !isUint(formData.auctionDuration)) {
      next.auctionDuration = `Auction duration must be a positive whole number of ${DURATION_UNIT.toLowerCase()}.`
    } else if (Number(formData.auctionDuration) * DURATION_UNIT_SECONDS > 7 * 86400) {
      next.auctionDuration = "Auction duration cannot exceed 7 days."
    }

    if (!formData.liveDuration || Number(formData.liveDuration) <= 0 || !isUint(formData.liveDuration)) {
      next.liveDuration = `Live duration must be a positive whole number of ${DURATION_UNIT.toLowerCase()}.`
    } else if (Number(formData.liveDuration) * DURATION_UNIT_SECONDS > 30 * 86400) {
      next.liveDuration = "Live duration cannot exceed 30 days."
    }

    if (!formData.subjectToken) next.subjectToken = "Please select a token."

    if (!formData.minToOpen || Number(formData.minToOpen) <= 0 || !isUint(formData.minToOpen)) {
      next.minToOpen = "Min to open must be a positive integer greater than 0."
    }

    if (!formData.maxCap || Number(formData.maxCap) <= 0 || !isUint(formData.maxCap)) {
      next.maxCap = "Max cap must be a positive integer."
    }

    if (
      (!next.minToOpen && !next.maxCap) &&
      formData.minToOpen && formData.maxCap &&
      Number(formData.maxCap) < Number(formData.minToOpen)
    ) {
      next.maxCap = "Max cap must be greater than or equal to Min to open."
    }

    return next
  }, [formData])

  const isFormValid = React.useMemo(() => {
    const v = validate()
    return Object.keys(v).length === 0
  }, [validate])

  // Restrict numeric inputs to digits only
  const allowDigitKey = React.useCallback((e: React.KeyboardEvent<HTMLInputElement>) => {
    const allowed = ["Backspace", "Delete", "ArrowLeft", "ArrowRight", "Tab", "Home", "End"]
    if (allowed.includes(e.key)) return
    if (!/^[0-9]$/.test(e.key)) e.preventDefault()
  }, [])

  const preventNonDigitPaste = React.useCallback((e: React.ClipboardEvent<HTMLInputElement>) => {
    const text = e.clipboardData?.getData("text") ?? ""
    if (!/^\d+$/.test(text)) e.preventDefault()
  }, [])

  // Local tx state (ethers based)
  const [txHash, setTxHash] = useState<string | null>(null)
  const [isPending, setIsPending] = useState(false)
  const [isConfirming, setIsConfirming] = useState(false)
  const [isConfirmed, setIsConfirmed] = useState(false)
  const [error, setError] = useState<Error | null>(null)
  const submittingRef = React.useRef(false)

  // Guard dialog when not connected
  const [guardOpen, setGuardOpen] = useState(false)

  const handleSubmit = async (e?: React.FormEvent): Promise<boolean>=>{
    e?.preventDefault()

    // Prevent double-submission (double click / Enter spam)
    if (submittingRef.current || isPending || isConfirming) return false

    // If wallet not connected -> open guard modal and exit
    if (!isConnected || !account) {
      setGuardOpen(true)
      return false
    }

    submittingRef.current = true

    const fail = (desc: string) => {
      toast({ title: "Validation Error", description: desc, variant: "destructive" })
      submittingRef.current = false
      return false
    }

    // Guard: if invalid, show inline messages and focus first error
    const currentErrors = validate()
    if (Object.keys(currentErrors).length > 0) {
      setErrors(currentErrors)
      setShowErrors(true)
      const firstKey = Object.keys(currentErrors)[0] as keyof Errors
      if (firstKey) {
        const el = document.getElementById(firstKey as string)
        el?.focus()
      }
      return fail("Please complete the highlighted fields.")
    }

    toast({ title: "Submitting", description: "Validating inputs and preparing transaction..." })

    if (!contractAddress) {
      return fail("Contract not found on this network.")
    }

    // Target-contract execution was dropped from the product: proposals
    // resolve on markets alone, so the on-chain args are always empty.
    const targetAddressArg = "0x0000000000000000000000000000000000000000"

    // Ethers setup
    try {
      setError(null)
      setIsPending(true)

      // Connector-based signer: covers extension and embedded/guest wallets
      let signer
      try {
        signer = await getEthersSigner(config)
      } catch {
        setIsPending(false)
        submittingRef.current = false
        setGuardOpen(true)
        return false
      }

      const contract = new ethers.Contract(
        contractAddress as `0x${string}`,
        proposalManager_abi,
        signer
      )

      const to18 = (v: string) => (BigInt(v) * (10n ** 18n))

      const tx = await contract.createProposal(
        formData.title,
        formData.description,
        BigInt(formData.auctionDuration) * BigInt(DURATION_UNIT_SECONDS),
        BigInt(formData.liveDuration) * BigInt(DURATION_UNIT_SECONDS),
        formData.subjectToken,
        to18(formData.minToOpen),
        to18(formData.maxCap),
        targetAddressArg,
        "0x",
        formData.pythAddress as `0x${string}`,
        `0x${formData.pythId}`
      )

      setTxHash(tx.hash)
      setIsPending(false)
      setIsConfirming(true)

      const receipt = await tx.wait()
      const status = (receipt as any)?.status
      if (status === 1 || status === "1" || status === true) {
        setIsConfirmed(true)
        toast({
          title: "Proposal Created",
          description: "Your proposal will use the Pyth price at auction start.",
        })
        router.push("/proposals")
        return true
      } else {
        setError(new Error("Transaction failed"))
        toast({ title: "Transaction failed", description: "The transaction was mined but failed.", variant: "destructive" })
        return false
      }
    } catch (err: any) {
      setError(err)
      toast({ title: "Transaction Error", description: err?.message || String(err), variant: "destructive" })
      return false
    } finally {
      setIsPending(false)
      setIsConfirming(false)
      submittingRef.current = false
    }
  }

  useEffect(() => {
    // no-op here; navigation handled after receipt above
  }, [])

  const isInvalid = !isFormValid
  const isBusy = isPending || isConfirming

  return (
    <div className="container mx-auto px-4 py-12 max-w-3xl">
      {/* Wallet guard modal when trying to submit without connection */}
      <Dialog open={guardOpen && !isConnected} onOpenChange={setGuardOpen}>
        <DialogContent
          showCloseButton={true}
          className="bg-transparent border border-black/10 dark:border-white/20"
        >
          <DialogHeader>
            <DialogTitle>Connect your wallet</DialogTitle>
            <DialogDescription>
              You need to connect your wallet to create a proposal.
            </DialogDescription>
          </DialogHeader>
          <div className="flex items-center justify-center pt-2">
            <ConnectWalletButton onBeforeOpen={() => setGuardOpen(false)} />
          </div>
        </DialogContent>
      </Dialog>

      <Button asChild variant="ghost" className="mb-6">
        <Link href="/proposals">
          <ArrowLeft className="mr-2 h-4 w-4" />
          Back to Proposals
        </Link>
      </Button>

      <Card>
        <CardHeader>
          <CardTitle className="text-3xl">Create New Proposal</CardTitle>
          <CardDescription className="text-base">
            Submit a proposal to vote on. Provide clear details about your proposal and its expected impact.
          </CardDescription>
        </CardHeader>

        <CardContent>
          <form noValidate onSubmit={handleSubmit} className="space-y-6">

            {/* Title */}
            <div className="space-y-2">
              <Label htmlFor="title" className="text-base">Proposal Title *</Label>
              <Input
                id="title"
                placeholder="e.g., Increase Treasury Allocation for Development"
                value={formData.title}
                onChange={(e) => setFormData({ ...formData, title: e.target.value.slice(0, MAX_TITLE) })}
                className="text-base"
                maxLength={MAX_TITLE}
              />
              <div className="mt-1 flex items-center justify-between">
                {showErrors && errors.title ? (
                  <p className="text-xs text-destructive">{errors.title}</p>
                ) : <span />}
                <div className="text-xs text-muted-foreground">{formData.title.length}/{MAX_TITLE}</div>
              </div>
            </div>

            {/* Description */}
            <div className="space-y-2">
              <Label htmlFor="description" className="text-base">Description *</Label>
              <Textarea
                id="description"
                placeholder="Provide a detailed description..."
                value={formData.description}
                onChange={(e) => setFormData({ ...formData, description: e.target.value.slice(0, MAX_DESC) })}
                className="min-h-[150px] text-base"
                maxLength={MAX_DESC}
              />
              <div className="mt-1 flex items-center justify-between">
                {showErrors && errors.description ? (
                  <p className="text-xs text-destructive">{errors.description}</p>
                ) : <span />}
                <div className="text-xs text-muted-foreground">{formData.description.length}/{MAX_DESC}</div>
              </div>
            </div>

            {/* Auction + Live durations */}
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="auctionDuration" className="text-base">Auction Duration ({DURATION_UNIT}) *</Label>
                <Input
                  id="auctionDuration"
                  type="number"
                  min="1"
                  max="168"
                  inputMode="numeric"
                  pattern="[0-9]*"
                  step="1"
                  onKeyDown={allowDigitKey}
                  onPaste={preventNonDigitPaste}
                  value={formData.auctionDuration}
                  onChange={(e) => setFormData({ ...formData, auctionDuration: e.target.value })}
                  className="text-base"
                />
                {showErrors && errors.auctionDuration && (
                  <p className="text-xs text-destructive">{errors.auctionDuration}</p>
                )}
              </div>

              <div className="space-y-2">
                <Label htmlFor="liveDuration" className="text-base">Live Duration ({DURATION_UNIT}) *</Label>
                <Input
                  id="liveDuration"
                  type="number"
                  min="1"
                  max="720"
                  inputMode="numeric"
                  pattern="[0-9]*"
                  step="1"
                  onKeyDown={allowDigitKey}
                  onPaste={preventNonDigitPaste}
                  value={formData.liveDuration}
                  onChange={(e) => setFormData({ ...formData, liveDuration: e.target.value })}
                  className="text-base"
                />
                {showErrors && errors.liveDuration && (
                  <p className="text-xs text-destructive">{errors.liveDuration}</p>
                )}
              </div>
            </div>

            {/* Subject Token */}
            <div className="space-y-2">
              <Label htmlFor="subjectToken" className="text-base">Subject Token *</Label>
              <Select
                value={formData.subjectToken}
                onValueChange={(value) =>{
                  const selected = byPythID.get(value);
                  setFormData(prev => ({
                    ...prev,
                    subjectToken: value,
                    pythAddress: selected?.pythAddress ?? "",
                    pythId: selected?.pythID ?? "",
                  }))
                }}
              >
                <SelectTrigger id="subjectToken" className="text-base">
                  <SelectValue placeholder={tokenOptions.length ? "Select a token" : "No tokens for this chain"} />
                </SelectTrigger>
                <SelectContent>
                  {tokenOptions.map((t) => (
                    <SelectItem key={t.pythID} value={t.pythID}>
                      {t.symbol}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">Note: Initial auction price is read from the selected Pyth feed and scaled to 6 decimals (USDC).</p>
              {showErrors && errors.subjectToken && (
                <p className="text-xs text-destructive">{errors.subjectToken}</p>
              )}
            </div>

            {/* MinToOpen + MaxCap */}
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="minToOpen" className="text-base">Min To Open *</Label>
                <Input
                  id="minToOpen"
                  type="number"
                  min="1"
                  inputMode="numeric"
                  pattern="[0-9]*"
                  step="1"
                  onKeyDown={allowDigitKey}
                  onPaste={preventNonDigitPaste}
                  value={formData.minToOpen}
                  onChange={(e) => setFormData({ ...formData, minToOpen: e.target.value })}
                  className="text-base"
                />
                {showErrors && errors.minToOpen && (
                  <p className="text-xs text-destructive">{errors.minToOpen}</p>
                )}
              </div>

              <div className="space-y-2">
                <Label htmlFor="maxCap" className="text-base">Max Cap *</Label>
                <Input
                  id="maxCap"
                  type="number"
                  min="1"
                  inputMode="numeric"
                  pattern="[0-9]*"
                  step="1"
                  onKeyDown={allowDigitKey}
                  onPaste={preventNonDigitPaste}
                  value={formData.maxCap}
                  onChange={(e) => setFormData({ ...formData, maxCap: e.target.value })}
                  className="text-base"
                />
                {showErrors && errors.maxCap && (
                  <p className="text-xs text-destructive">{errors.maxCap}</p>
                )}
              </div>
            </div>

            {/* Submit */}
            <div className="flex gap-4 pt-4">
              <StatefulButton
                type="submit"
                // Do NOT use native disabled for invalid form so clicks can reveal inline errors.
                // Only disable natively when a tx is in-flight to block interaction.
                disabled={isBusy}
                aria-disabled={isInvalid || isBusy}
                onDisabledClick={() => {
                  // If disabled due to pending tx, ignore clicks completely
                  if (isBusy) return
                  // Otherwise show validation guidance
                  const v = validate()
                  setErrors(v)
                  setShowErrors(true)
                  const firstKey = Object.keys(v)[0] as keyof Errors
                  if (firstKey) {
                    const el = document.getElementById(firstKey as string)
                    el?.focus()
                  }
                  if (Object.keys(v).length > 0) {
                    toast({ title: "Incomplete form", description: "Please complete the highlighted fields to continue.", variant: "destructive" })
                  }
                }}
                className={
                  (isInvalid && !isBusy)
                    ? "flex-1 inline-flex items-center justify-center whitespace-nowrap rounded-md text-sm font-medium h-10 px-4 py-2 bg-muted text-muted-foreground border border-border hover:bg-muted hover:ring-0 focus-visible:ring-0"
                    : isBusy
                      ? "flex-1 inline-flex items-center justify-center whitespace-nowrap rounded-md text-sm font-medium h-10 px-4 py-2 bg-muted text-muted-foreground border border-border cursor-not-allowed pointer-events-none hover:bg-muted hover:ring-0 focus-visible:ring-0"
                      : "flex-1 inline-flex items-center justify-center whitespace-nowrap rounded-md text-sm font-medium ring-offset-background transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 h-10 px-4 py-2 bg-primary text-primary-foreground hover:bg-primary/90 hover:ring-green-500"
                }
              >
                {isPending ? "Creating..." : (isConfirming ? "Confirming..." : "Create Proposal")}
              </StatefulButton>
              <Button
                type="button"
                variant="outline"
                size="lg"
                onClick={() => router.push("/proposals")}
                disabled={isBusy}
              >
                Cancel
              </Button>
            </div>

            {/* Transaction feedback */}
            {txHash && <div>Transaction Hash: {txHash}</div>}
            {isConfirming && <div>Waiting for confirmation...</div>}
            {isConfirmed && <div>Transaction confirmed.</div>}
            {/* {error && <div>Error: {error.message}</div>} */}
          </form>
        </CardContent>
      </Card>
    </div>
  )
}
