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
  const provider = new ethers.BrowserProvider(client.transport, {
    chainId: client.chain.id,
    name: client.chain.name,
  })
  return provider.getSigner(client.account.address)
}
