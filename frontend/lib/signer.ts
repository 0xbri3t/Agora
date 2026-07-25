import { ethers } from 'ethers'
import { getConnectorClient } from 'wagmi/actions'
import type { Config } from 'wagmi'

/**
 * An ethers signer for whichever wallet is connected.
 *
 * `window.ethereum` only exists for browser-extension wallets, so reading it
 * directly silently excludes Openfort's embedded/guest wallets — those live
 * behind the wagmi connector. Going through the connector covers both.
 */
export async function getEthersSigner(config: Config): Promise<ethers.JsonRpcSigner> {
  const client = await getConnectorClient(config)

  // On the local fork, Openfort's embedded provider forwards eth_estimateGas
  // to its own API, which rejects chain 31337 with a 400 — the EOA signs and
  // broadcasts locally, so the estimate is the only backend round trip. Route
  // it straight to anvil instead.
  let transport: ethers.Eip1193Provider = client.transport as ethers.Eip1193Provider
  if (client.chain.id === 31337) {
    const raw = transport
    const anvilRpc = process.env.NEXT_PUBLIC_ANVIL_RPC_URL || 'http://127.0.0.1:8545'
    transport = {
      request: async (args: { method: string; params?: unknown }) => {
        if (args.method === 'eth_estimateGas') {
          const res = await fetch(anvilRpc, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: args.method, params: args.params ?? [] }),
          })
          const json = await res.json()
          if (json.error) throw new Error(json.error.message)
          return json.result
        }
        return raw.request(args as { method: string; params?: Array<unknown> })
      },
    }
  }

  const provider = new ethers.BrowserProvider(transport, {
    chainId: client.chain.id,
    name: client.chain.name,
  })
  return provider.getSigner(client.account.address)
}
