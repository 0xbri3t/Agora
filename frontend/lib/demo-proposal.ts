import { ethers } from "ethers"
import type { Config } from "wagmi"
import { getEthersSigner } from "@/lib/signer"
import { proposalManager_abi } from "@/contracts/proposalManager-abi"
import { getContractAddress } from "@/contracts/constants"

// The one calibrated demo proposal. Every parameter here is tuned to the demo
// director script in backend/src/services/demoService.js — the bid budgets and
// max-price multiples assume this exact supply, minimum and floor, and the
// auction duration leaves just enough room for the staggered script on the
// 2s-block fork (720s nominal / 12s-per-block CCA clock = 60 blocks ≈ 120
// real seconds, ~20s of which go to per-auction Permit2 approvals). Change
// these and the demo stops being reproducible.
export const DEMO_PROPOSAL = {
  title: "Adopt UNI as a treasury reserve",
  description:
    "Futarchy demo: if the YES market prices this world above NO at close, the treasury adopts UNI. Calibrated for the demo director.",
  auctionDuration: 1080n, // 90 blocks ≈ 3 real minutes on the fork — room to click Auction calmly
  liveDuration: 600n, // short live phase — skip time to reach resolution fast
  subjectToken: "78d185a741d07edb3412b09008b7c5cfb9bbbd7d568bf00ba737b456ba171501", // UNI (Pyth price id)
  minToOpen: 10n ** 18n, // 1 token per side to graduate
  maxCap: 100n * 10n ** 18n, // 100 tokens per side
  pythAddress: "0xDd24F84d36BF92C65F92307595335bdFab5Bbd21", // Pyth on Sepolia + fork
} as const

// Creates the demo proposal from the connected wallet (who becomes its admin,
// so the demo director buttons show up for them) and returns the new id.
export async function createDemoProposal(config: Config, chainId: number): Promise<string> {
  const managerAddr = getContractAddress(chainId, "PROPOSAL_MANAGER")
  if (!managerAddr || managerAddr === "0x0000000000000000000000000000000000000000") {
    throw new Error("No ProposalManager deployed on this chain")
  }
  const signer = await getEthersSigner(config)
  const contract = new ethers.Contract(managerAddr, proposalManager_abi, signer)
  const tx = await contract.createProposal(
    DEMO_PROPOSAL.title,
    DEMO_PROPOSAL.description,
    DEMO_PROPOSAL.auctionDuration,
    DEMO_PROPOSAL.liveDuration,
    DEMO_PROPOSAL.subjectToken,
    DEMO_PROPOSAL.minToOpen,
    DEMO_PROPOSAL.maxCap,
    ethers.ZeroAddress,
    "0x",
    DEMO_PROPOSAL.pythAddress,
    `0x${DEMO_PROPOSAL.subjectToken}`,
  )
  const receipt = await tx.wait()
  if (!receipt || (receipt.status !== 1 && receipt.status !== "1")) {
    throw new Error("Transaction failed")
  }
  const iface = new ethers.Interface(proposalManager_abi as any)
  for (const log of receipt.logs ?? []) {
    try {
      const parsed = iface.parseLog(log)
      if (parsed?.name === "ProposalCreated") return String(parsed.args[0])
    } catch {
      // logs from other contracts in the receipt
    }
  }
  throw new Error("ProposalCreated event not found in receipt")
}
