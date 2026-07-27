import type { PublicClient } from "viem"
import { cca_abi } from "@/contracts/cca-abi"

// A CCA's startBlock is immutable once deployed, but several auction pollers
// were re-reading it on every tick. Cache the promise per chain+address so
// each auction pays for the lookup exactly once per session; failed lookups
// are evicted so a transient RPC error doesn't stick.
const cache = new Map<string, Promise<bigint>>()

export function getAuctionStartBlock(publicClient: PublicClient, auction: string): Promise<bigint> {
  const key = `${publicClient.chain?.id ?? 0}:${auction.toLowerCase()}`
  let p = cache.get(key)
  if (!p) {
    p = publicClient.readContract({
      address: auction as `0x${string}`, abi: cca_abi, functionName: "startBlock",
    }) as Promise<bigint>
    p.catch(() => { if (cache.get(key) === p) cache.delete(key) })
    cache.set(key, p)
  }
  return p
}
