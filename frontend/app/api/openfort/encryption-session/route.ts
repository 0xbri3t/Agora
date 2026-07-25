import { NextResponse } from 'next/server'

// Openfort Shield mints a short-lived encryption session so an embedded wallet
// can recover itself without prompting the user for a password. The secret
// half of the Shield credentials must never reach the browser, hence this
// server route (referenced by walletConfig.createEncryptedSessionEndpoint).
const SHIELD_ENDPOINT = 'https://shield.openfort.io/project/encryption-session'

export async function POST() {
  const publishableKey = process.env.NEXT_PUBLIC_SHIELD_PUBLISHABLE_KEY
  const secretKey = process.env.SHIELD_SECRET_KEY
  const encryptionShare = process.env.SHIELD_ENCRYPTION_SHARE

  if (!publishableKey || !secretKey || !encryptionShare) {
    return NextResponse.json(
      { error: 'Shield keys are not configured on the server' },
      { status: 501 }
    )
  }

  try {
    const response = await fetch(SHIELD_ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': publishableKey,
        'x-api-secret': secretKey,
      },
      body: JSON.stringify({ encryption_part: encryptionShare }),
    })

    if (!response.ok) {
      const detail = await response.text()
      return NextResponse.json(
        { error: `Shield responded ${response.status}`, detail: detail.slice(0, 200) },
        { status: 502 }
      )
    }

    // Shield answers { session_id }, the SDK expects { session: string }
    const data = await response.json()
    const session = data.session_id ?? data.session
    if (typeof session !== 'string' || session.length === 0) {
      return NextResponse.json({ error: 'Shield returned no session id' }, { status: 502 })
    }
    return NextResponse.json({ session })
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'encryption session failed' },
      { status: 500 }
    )
  }
}
