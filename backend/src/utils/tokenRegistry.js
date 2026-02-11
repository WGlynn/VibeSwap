// ============ Token Registry ============
// Canonical token addresses and chain configuration for the API

export const SUPPORTED_CHAINS = [
  {
    id: 1,
    name: 'Ethereum',
    network: 'mainnet',
    currency: 'ETH',
    explorer: 'https://etherscan.io',
    isTestnet: false,
    lzEndpointId: 30101,
  },
  {
    id: 42161,
    name: 'Arbitrum',
    network: 'arbitrum',
    currency: 'ETH',
    explorer: 'https://arbiscan.io',
    isTestnet: false,
    lzEndpointId: 30110,
  },
  {
    id: 10,
    name: 'Optimism',
    network: 'optimism',
    currency: 'ETH',
    explorer: 'https://optimistic.etherscan.io',
    isTestnet: false,
    lzEndpointId: 30111,
  },
  {
    id: 8453,
    name: 'Base',
    network: 'base',
    currency: 'ETH',
    explorer: 'https://basescan.org',
    isTestnet: false,
    lzEndpointId: 30184,
  },
  {
    id: 137,
    name: 'Polygon',
    network: 'polygon',
    currency: 'MATIC',
    explorer: 'https://polygonscan.com',
    isTestnet: false,
    lzEndpointId: 30109,
  },
  {
    id: 11155111,
    name: 'Sepolia',
    network: 'sepolia',
    currency: 'ETH',
    explorer: 'https://sepolia.etherscan.io',
    isTestnet: true,
    lzEndpointId: 40161,
  },
];

export const TOKENS_BY_CHAIN = {
  1: [
    { symbol: 'ETH', name: 'Ethereum', address: '0x0000000000000000000000000000000000000000', decimals: 18, isNative: true },
    { symbol: 'WETH', name: 'Wrapped Ether', address: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2', decimals: 18 },
    { symbol: 'USDC', name: 'USD Coin', address: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48', decimals: 6 },
    { symbol: 'USDT', name: 'Tether USD', address: '0xdAC17F958D2ee523a2206206994597C13D831ec7', decimals: 6 },
    { symbol: 'WBTC', name: 'Wrapped BTC', address: '0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599', decimals: 8 },
  ],
  42161: [
    { symbol: 'ETH', name: 'Ethereum', address: '0x0000000000000000000000000000000000000000', decimals: 18, isNative: true },
    { symbol: 'USDC', name: 'USD Coin', address: '0xaf88d065e77c8cC2239327C5EDb3A432268e5831', decimals: 6 },
    { symbol: 'USDT', name: 'Tether USD', address: '0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9', decimals: 6 },
    { symbol: 'ARB', name: 'Arbitrum', address: '0x912CE59144191C1204E64559FE8253a0e49E6548', decimals: 18 },
  ],
  10: [
    { symbol: 'ETH', name: 'Ethereum', address: '0x0000000000000000000000000000000000000000', decimals: 18, isNative: true },
    { symbol: 'USDC', name: 'USD Coin', address: '0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85', decimals: 6 },
    { symbol: 'OP', name: 'Optimism', address: '0x4200000000000000000000000000000000000042', decimals: 18 },
  ],
  8453: [
    { symbol: 'ETH', name: 'Ethereum', address: '0x0000000000000000000000000000000000000000', decimals: 18, isNative: true },
    { symbol: 'USDC', name: 'USD Coin', address: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913', decimals: 6 },
  ],
  137: [
    { symbol: 'MATIC', name: 'Polygon', address: '0x0000000000000000000000000000000000000000', decimals: 18, isNative: true },
    { symbol: 'USDC', name: 'USD Coin', address: '0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359', decimals: 6 },
    { symbol: 'USDT', name: 'Tether USD', address: '0xc2132D05D31c914a87C6611C10748AEb04B58e8F', decimals: 6 },
  ],
};
