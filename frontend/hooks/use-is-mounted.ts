"use client"

import { useEffect, useState } from "react"

/**
 * Hook to safely check if component is mounted (client-side)
 * Prevents hydration mismatches with wallet connections
 */
export function useIsMounted() {
  const [mounted, setMounted] = useState(false)

  useEffect(() => {
    setMounted(true)
  }, [])

  return mounted
}
