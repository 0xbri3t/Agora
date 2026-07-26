
export type Collateral = {
  symbol: string
  subjectTokenUrl: string
  pythAddress: `0x${string}`
  // Oracle price feed identifier (Pyth price ID)
  pythID: string
  logoURI?: string
  decimals?: number
  expo?: number
}

//  Map of supported collaterals per chainId.

// Real Pyth on Sepolia — also present on the local anvil fork of Sepolia.
const PYTH_SEPOLIA = "0xDd24F84d36BF92C65F92307595335bdFab5Bbd21" as const

const SEPOLIA_COLLATERALS: Collateral[] = [
  { symbol: "PYTH", subjectTokenUrl: "https://www.pyth.network/", pythAddress: PYTH_SEPOLIA, pythID: "0bbf28e9a841a1cc788f6a361b17ca072d0ea3098a1e5df1c3922d06719579ff", expo: -8 },
  { symbol: "UNI", subjectTokenUrl: "https://app.uniswap.org/", pythAddress: PYTH_SEPOLIA, pythID: "78d185a741d07edb3412b09008b7c5cfb9bbbd7d568bf00ba737b456ba171501", expo: -8 },
  { symbol: "BTC", subjectTokenUrl: "https://bitcoin.org/", pythAddress: PYTH_SEPOLIA, pythID: "e62df6c8b4a85fe1a67db44dc12de5db330f7ac66b72dc658afedf0f4a415b43", expo: -10 },
  { symbol: "ETH", subjectTokenUrl: "https://ethereum.org/es/", pythAddress: PYTH_SEPOLIA, pythID: "ff61491a931112ddf1bd8147cd1b641375f79f5825126d665480874634fd0ace", expo: -8 },
  // Equities via Pyth stock feeds — futarchy on real-world companies
  { symbol: "TSLA", subjectTokenUrl: "https://www.tesla.com/", pythAddress: PYTH_SEPOLIA, pythID: "16dad506d7db8da01c87581c87ca897a012a153557d4d578c3b9c9e1bc0632f1", expo: -5 },
  { symbol: "NVDA", subjectTokenUrl: "https://www.nvidia.com/", pythAddress: PYTH_SEPOLIA, pythID: "b1073854ed24cbc755dc527418f52b7d271f6cc967bbf8d8129112b18860a593", expo: -5 },
  { symbol: "AAPL", subjectTokenUrl: "https://www.apple.com/", pythAddress: PYTH_SEPOLIA, pythID: "49f6b65cb1de6b10eaf75e7c03ca029c306d0357e91b5311b175084a5ad55688", expo: -5 },
  { symbol: "MSTR", subjectTokenUrl: "https://www.strategy.com/", pythAddress: PYTH_SEPOLIA, pythID: "e1e80251e5f5184f2195008382538e847fafc36f751896889dd3d1b1f6111f09", expo: -5 },
]

export const SUPPORTED_COLLATERALS: Record<number, Collateral[]> = {
  // Ethereum Sepolia (11155111)
  11155111: SEPOLIA_COLLATERALS,

  // Local Anvil fork of Sepolia (31337) — same contracts as Sepolia
  31337: SEPOLIA_COLLATERALS,
}

// Helper to get supported collaterals by chain, safely.
export function getSupportedCollaterals(chainId?: number): Collateral[] {
  if (!chainId) return []
  return SUPPORTED_COLLATERALS[chainId] ?? []
}
