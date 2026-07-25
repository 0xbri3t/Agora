import { getContractAddress } from "@/contracts/constants"

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

export const SUPPORTED_COLLATERALS: Record<number, Collateral[]> = {
  // Hedera Testnet (296):
  296: [
    // { symbol: "AAVE", subjectTokenUrl:"https://aave.com/", pythAddress: "0xa2aa501b19aff244d90cc15a4cf739d2725b5729", pythID: "2b9ab1e972a281585084148ba1389800799bd4be63b957507db1349314e47445", expo: -8 },
    { symbol: "PYTH", subjectTokenUrl:"https://www.pyth.network/", pythAddress: "0xa2aa501b19aff244d90cc15a4cf739d2725b5729", pythID: "0bbf28e9a841a1cc788f6a361b17ca072d0ea3098a1e5df1c3922d06719579ff", expo: -8 },
    { symbol: "HBAR", subjectTokenUrl:"https://hedera.com/", pythAddress: "0xa2aa501b19aff244d90cc15a4cf739d2725b5729", pythID: "3728e591097635310e6341af53db8b7ee42da9b3a8d918f9463ce9cca886dfbd", expo: -8 },
    { symbol: "UNI", subjectTokenUrl:"https://app.uniswap.org/", pythAddress: "0xa2aa501b19aff244d90cc15a4cf739d2725b5729", pythID: "78d185a741d07edb3412b09008b7c5cfb9bbbd7d568bf00ba737b456ba171501", expo: -8 },
    { symbol: "BTC", subjectTokenUrl:"https://bitcoin.org/", pythAddress: "0xa2aa501b19aff244d90cc15a4cf739d2725b5729", pythID: "e62df6c8b4a85fe1a67db44dc12de5db330f7ac66b72dc658afedf0f4a415b43", expo: -10 },
    { symbol: "ETH", subjectTokenUrl:"https://ethereum.org/es/", pythAddress: "0xa2aa501b19aff244d90cc15a4cf739d2725b5729", pythID: "ff61491a931112ddf1bd8147cd1b641375f79f5825126d665480874634fd0ace", expo: -8 },
  ],

  // Hedera Mainnet (295):
  295: [
    // { symbol: "AAVE", subjectTokenUrl:"https://aave.com/", pythAddress: "0xA2aa501b19aff244D90cc15a4Cf739D2725B5729", pythID: "2b9ab1e972a281585084148ba1389800799bd4be63b957507db1349314e47445", expo: -8 },
    { symbol: "PYTH", subjectTokenUrl:"https://www.pyth.network/", pythAddress: "0xA2aa501b19aff244D90cc15a4Cf739D2725B5729", pythID: "0bbf28e9a841a1cc788f6a361b17ca072d0ea3098a1e5df1c3922d06719579ff", expo: -8 },
    { symbol: "HBAR", subjectTokenUrl:"https://hedera.com/", pythAddress: "0xA2aa501b19aff244D90cc15a4Cf739D2725B5729", pythID: "3728e591097635310e6341af53db8b7ee42da9b3a8d918f9463ce9cca886dfbd", expo: -8 },
    { symbol: "UNI", subjectTokenUrl:"https://app.uniswap.org/", pythAddress: "0xA2aa501b19aff244D90cc15a4Cf739D2725B5729", pythID: "78d185a741d07edb3412b09008b7c5cfb9bbbd7d568bf00ba737b456ba171501", expo: -8 },
    { symbol: "BTC", subjectTokenUrl:"https://bitcoin.org/", pythAddress: "0xA2aa501b19aff244D90cc15a4Cf739D2725B5729", pythID: "e62df6c8b4a85fe1a67db44dc12de5db330f7ac66b72dc658afedf0f4a415b43", expo: -10 },
    { symbol: "ETH", subjectTokenUrl:"https://ethereum.org/es/", pythAddress: "0xA2aa501b19aff244D90cc15a4Cf739D2725B5729", pythID: "ff61491a931112ddf1bd8147cd1b641375f79f5825126d665480874634fd0ace", expo: -8 },
  ],

  // Ethereum Mainnet (1): real examples for USDC/DAI; set PYUSD accordingly
  1: [
    // { symbol: "AAVE", subjectTokenUrl:"https://aave.com/", pythAddress: "0x4305FB66699C3B2702D4d05CF36551390A4c69C6", pythID: "2b9ab1e972a281585084148ba1389800799bd4be63b957507db1349314e47445", expo: -8 },
    { symbol: "PYTH", subjectTokenUrl:"https://www.pyth.network/", pythAddress: "0x4305FB66699C3B2702D4d05CF36551390A4c69C6", pythID: "0bbf28e9a841a1cc788f6a361b17ca072d0ea3098a1e5df1c3922d06719579ff", expo: -8 },
    { symbol: "HBAR", subjectTokenUrl:"https://hedera.com/", pythAddress: "0x4305FB66699C3B2702D4d05CF36551390A4c69C6", pythID: "3728e591097635310e6341af53db8b7ee42da9b3a8d918f9463ce9cca886dfbd", expo: -8 },
    { symbol: "UNI", subjectTokenUrl:"https://app.uniswap.org/", pythAddress: "0x4305FB66699C3B2702D4d05CF36551390A4c69C6", pythID: "78d185a741d07edb3412b09008b7c5cfb9bbbd7d568bf00ba737b456ba171501", expo: -8 },
    { symbol: "BTC", subjectTokenUrl:"https://bitcoin.org/", pythAddress: "0x4305FB66699C3B2702D4d05CF36551390A4c69C6", pythID: "e62df6c8b4a85fe1a67db44dc12de5db330f7ac66b72dc658afedf0f4a415b43", expo: -10 },
    { symbol: "ETH", subjectTokenUrl:"https://ethereum.org/es/", pythAddress: "0x4305FB66699C3B2702D4d05CF36551390A4c69C6", pythID: "ff61491a931112ddf1bd8147cd1b641375f79f5825126d665480874634fd0ace", expo: -8 },
  ],
  
  // Sepolia (11155111): dev mocks on testnet
  11155111: [
    // { symbol: "AAVE", subjectTokenUrl:"https://aave.com/", pythAddress: "0xDd24F84d36BF92C65F92307595335bdFab5Bbd21", pythID: "2b9ab1e972a281585084148ba1389800799bd4be63b957507db1349314e47445", expo: -8 },
    { symbol: "PYTH", subjectTokenUrl:"https://www.pyth.network/", pythAddress: "0xDd24F84d36BF92C65F92307595335bdFab5Bbd21", pythID: "0bbf28e9a841a1cc788f6a361b17ca072d0ea3098a1e5df1c3922d06719579ff", expo: -8 },
    { symbol: "HBAR", subjectTokenUrl:"https://hedera.com/", pythAddress: "0xDd24F84d36BF92C65F92307595335bdFab5Bbd21", pythID: "3728e591097635310e6341af53db8b7ee42da9b3a8d918f9463ce9cca886dfbd", expo: -8 },
    { symbol: "UNI", subjectTokenUrl:"https://app.uniswap.org/", pythAddress: "0xDd24F84d36BF92C65F92307595335bdFab5Bbd21", pythID: "78d185a741d07edb3412b09008b7c5cfb9bbbd7d568bf00ba737b456ba171501", expo: -8 },
    { symbol: "BTC", subjectTokenUrl:"https://bitcoin.org/", pythAddress: "0xDd24F84d36BF92C65F92307595335bdFab5Bbd21", pythID: "e62df6c8b4a85fe1a67db44dc12de5db330f7ac66b72dc658afedf0f4a415b43", expo: -10 },
    { symbol: "ETH", subjectTokenUrl:"https://ethereum.org/es/", pythAddress: "0xDd24F84d36BF92C65F92307595335bdFab5Bbd21", pythID: "ff61491a931112ddf1bd8147cd1b641375f79f5825126d665480874634fd0ace", expo: -8 },
  ],

  // Local Anvil (31337): dev-only mock
  31337: [
    // { symbol: "AAVE",subjectTokenUrl:"https://aave.com/", pythAddress: "0x4305FB66699C3B2702D4d05CF36551390A4c69C6", pythID: "2b9ab1e972a281585084148ba1389800799bd4be63b957507db1349314e47445", expo: -8 },
    { symbol: "PYTH", subjectTokenUrl:"https://www.pyth.network/",pythAddress: "0x4305FB66699C3B2702D4d05CF36551390A4c69C6", pythID: "0bbf28e9a841a1cc788f6a361b17ca072d0ea3098a1e5df1c3922d06719579ff", expo: -8 },
    { symbol: "HBAR",subjectTokenUrl:"https://hedera.com/", pythAddress: "0x4305FB66699C3B2702D4d05CF36551390A4c69C6", pythID: "3728e591097635310e6341af53db8b7ee42da9b3a8d918f9463ce9cca886dfbd", expo: -8 },
    { symbol: "UNI", subjectTokenUrl:"https://app.uniswap.org/",pythAddress: "0x4305FB66699C3B2702D4d05CF36551390A4c69C6", pythID: "78d185a741d07edb3412b09008b7c5cfb9bbbd7d568bf00ba737b456ba171501", expo: -8 },
    { symbol: "BTC", subjectTokenUrl:"https://bitcoin.org/",pythAddress: "0x4305FB66699C3B2702D4d05CF36551390A4c69C6", pythID: "e62df6c8b4a85fe1a67db44dc12de5db330f7ac66b72dc658afedf0f4a415b43", expo: -10 },
    { symbol: "ETH", subjectTokenUrl:"https://ethereum.org/es/",pythAddress: "0x4305FB66699C3B2702D4d05CF36551390A4c69C6", pythID: "ff61491a931112ddf1bd8147cd1b641375f79f5825126d665480874634fd0ace", expo: -8 },
  ],
}

// Helper to get supported collaterals by chain, safely. 
export function getSupportedCollaterals(chainId?: number): Collateral[] {
  if (!chainId) return []
  return SUPPORTED_COLLATERALS[chainId] ?? []
}


