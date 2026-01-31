// Contract addresses per chain
export const CONTRACTS = {
  // Sepolia Testnet
  11155111: {
    vibeSwapCore: '0x0000000000000000000000000000000000000000',
    auction: '0x0000000000000000000000000000000000000000',
    amm: '0x0000000000000000000000000000000000000000',
    treasury: '0x0000000000000000000000000000000000000000',
    router: '0x0000000000000000000000000000000000000000',
  },
  // Arbitrum Sepolia
  421614: {
    vibeSwapCore: '0x0000000000000000000000000000000000000000',
    auction: '0x0000000000000000000000000000000000000000',
    amm: '0x0000000000000000000000000000000000000000',
    treasury: '0x0000000000000000000000000000000000000000',
    router: '0x0000000000000000000000000000000000000000',
  },
}

// Common tokens per chain
export const TOKENS = {
  11155111: [
    {
      symbol: 'ETH',
      name: 'Ethereum',
      address: '0x0000000000000000000000000000000000000000',
      decimals: 18,
      logo: 'https://assets.coingecko.com/coins/images/279/small/ethereum.png',
    },
    {
      symbol: 'WETH',
      name: 'Wrapped Ether',
      address: '0xfFf9976782d46CC05630D1f6eBAb18b2324d6B14',
      decimals: 18,
      logo: 'https://assets.coingecko.com/coins/images/2518/small/weth.png',
    },
    {
      symbol: 'USDC',
      name: 'USD Coin',
      address: '0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238',
      decimals: 6,
      logo: 'https://assets.coingecko.com/coins/images/6319/small/USD_Coin_icon.png',
    },
  ],
}

// Batch timing constants (in seconds)
export const BATCH_TIMING = {
  COMMIT_DURATION: 8,
  REVEAL_DURATION: 2,
  TOTAL_DURATION: 10,
}

// Default settings
export const DEFAULT_SETTINGS = {
  slippage: '0.5',
  deadline: 30, // minutes
}

// Supported chains
export const SUPPORTED_CHAINS = [
  {
    id: 1,
    name: 'Ethereum',
    network: 'mainnet',
    currency: 'ETH',
    rpcUrl: 'https://eth.llamarpc.com',
    explorer: 'https://etherscan.io',
    isTestnet: false,
  },
  {
    id: 42161,
    name: 'Arbitrum',
    network: 'arbitrum',
    currency: 'ETH',
    rpcUrl: 'https://arb1.arbitrum.io/rpc',
    explorer: 'https://arbiscan.io',
    isTestnet: false,
  },
  {
    id: 10,
    name: 'Optimism',
    network: 'optimism',
    currency: 'ETH',
    rpcUrl: 'https://mainnet.optimism.io',
    explorer: 'https://optimistic.etherscan.io',
    isTestnet: false,
  },
  {
    id: 8453,
    name: 'Base',
    network: 'base',
    currency: 'ETH',
    rpcUrl: 'https://mainnet.base.org',
    explorer: 'https://basescan.org',
    isTestnet: false,
  },
  {
    id: 137,
    name: 'Polygon',
    network: 'polygon',
    currency: 'MATIC',
    rpcUrl: 'https://polygon-rpc.com',
    explorer: 'https://polygonscan.com',
    isTestnet: false,
  },
  {
    id: 11155111,
    name: 'Sepolia',
    network: 'sepolia',
    currency: 'ETH',
    rpcUrl: 'https://rpc.sepolia.org',
    explorer: 'https://sepolia.etherscan.io',
    isTestnet: true,
  },
]

// LayerZero endpoint IDs
export const LZ_ENDPOINTS = {
  1: 30101,     // Ethereum
  42161: 30110, // Arbitrum
  10: 30111,    // Optimism
  8453: 30184,  // Base
  137: 30109,   // Polygon
}
