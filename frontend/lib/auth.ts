export type StoredAuth = {
  address: string
  message: string
  timestamp: number
  signature: string
  verified?: boolean
  verifiedAt?: number
}

export const AUTH_STORAGE_KEY = 'futarfi:walletAuth'

export function getStoredAuth(): StoredAuth | null {
  if (typeof window === 'undefined') return null
  try {
    const raw = window.localStorage.getItem(AUTH_STORAGE_KEY)
    return raw ? JSON.parse(raw) : null
  } catch {
    return null
  }
}

export function setStoredAuth(value: StoredAuth | null) {
  if (typeof window === 'undefined') return
  try {
    if (!value) window.localStorage.removeItem(AUTH_STORAGE_KEY)
    else window.localStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify(value))
  } catch {}
}
