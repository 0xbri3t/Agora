'use client'

/**
 * Disabled: we now perform wallet auth on-demand (e.g., when placing an order).
 * This component remains as a no-op to avoid prompting on login or every page.
 */
export function GlobalWalletAuth() {
  return null
}
