// ============ Token Registry (Canonical Source of Truth) ============
// Backend is the single source for token metadata across all chains.
// Frontend fetches from /api/tokens and falls back to its static copy.

export const SUPPORTED_CHAINS = [
  // ============ EVM Mainnets ============
  { id: 1, name: 'Ethereum', network: 'mainnet', currency: 'ETH', explorer: 'https://etherscan.io', isTestnet: false, lzEndpointId: 30101 },
  { id: 42161, name: 'Arbitrum', network: 'arbitrum', currency: 'ETH', explorer: 'https://arbiscan.io', isTestnet: false, lzEndpointId: 30110 },
  { id: 10, name: 'Optimism', network: 'optimism', currency: 'ETH', explorer: 'https://optimistic.etherscan.io', isTestnet: false, lzEndpointId: 30111 },
  { id: 8453, name: 'Base', network: 'base', currency: 'ETH', explorer: 'https://basescan.org', isTestnet: false, lzEndpointId: 30184 },
  { id: 137, name: 'Polygon', network: 'polygon', currency: 'MATIC', explorer: 'https://polygonscan.com', isTestnet: false, lzEndpointId: 30109 },
  // ============ EVM Testnets ============
  { id: 11155111, name: 'Sepolia', network: 'sepolia', currency: 'ETH', explorer: 'https://sepolia.etherscan.io', isTestnet: true, lzEndpointId: 40161 },
  { id: 421614, name: 'Arbitrum Sepolia', network: 'arbitrum-sepolia', currency: 'ETH', explorer: 'https://sepolia.arbiscan.io', isTestnet: true, lzEndpointId: 40231 },
  // ============ Nervos CKB ============
  { id: 'ckb-mainnet', name: 'Nervos CKB', network: 'ckb', currency: 'CKB', explorer: 'https://explorer.nervos.org', isTestnet: false, isCKB: true },
  { id: 'ckb-testnet', name: 'CKB Testnet', network: 'ckb-testnet', currency: 'CKB', explorer: 'https://pudge.explorer.nervos.org', isTestnet: true, isCKB: true },
];

// ============ LayerZero V2 Endpoint IDs ============
export const LZ_ENDPOINTS = {
  1: 30101,
  42161: 30110,
  10: 30111,
  8453: 30184,
  137: 30109,
  11155111: 40161,
  421614: 40231,
};

export const TOKENS_BY_CHAIN = {
  // ============ Ethereum Mainnet ============
  1: [
    { symbol: 'ETH', name: 'Ethereum', address: '0x0000000000000000000000000000000000000000', decimals: 18, logo: 'https://assets.coingecko.com/coins/images/279/small/ethereum.png', isNative: true },
    { symbol: 'WETH', name: 'Wrapped Ether', address: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2', decimals: 18, logo: 'https://assets.coingecko.com/coins/images/2518/small/weth.png' },
    { symbol: 'USDC', name: 'USD Coin', address: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48', decimals: 6, logo: 'https://assets.coingecko.com/coins/images/6319/small/USD_Coin_icon.png' },
    { symbol: 'USDT', name: 'Tether USD', address: '0xdAC17F958D2ee523a2206206994597C13D831ec7', decimals: 6, logo: 'https://assets.coingecko.com/coins/images/325/small/Tether.png' },
    { symbol: 'DAI', name: 'Dai Stablecoin', address: '0x6B175474E89094C44Da98b954EedeAC495271d0F', decimals: 18, logo: 'https://assets.coingecko.com/coins/images/9956/small/4943.png' },
    { symbol: 'WBTC', name: 'Wrapped BTC', address: '0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599', decimals: 8, logo: 'https://assets.coingecko.com/coins/images/7598/small/wrapped_bitcoin_wbtc.png' },
  ],
  // ============ Arbitrum One ============
  42161: [
    { symbol: 'ETH', name: 'Ethereum', address: '0x0000000000000000000000000000000000000000', decimals: 18, logo: 'https://assets.coingecko.com/coins/images/279/small/ethereum.png', isNative: true },
    { symbol: 'WETH', name: 'Wrapped Ether', address: '0x82aF49447D8a07e3bd95BD0d56f35241523fBab1', decimals: 18, logo: 'https://assets.coingecko.com/coins/images/2518/small/weth.png' },
    { symbol: 'USDC', name: 'USD Coin', address: '0xaf88d065e77c8cC2239327C5EDb3A432268e5831', decimals: 6, logo: 'https://assets.coingecko.com/coins/images/6319/small/USD_Coin_icon.png' },
    { symbol: 'USDC.e', name: 'Bridged USDC', address: '0xFF970A61A04b1cA14834A43f5dE4533eBDDB5CC8', decimals: 6, logo: 'https://assets.coingecko.com/coins/images/6319/small/USD_Coin_icon.png' },
    { symbol: 'USDT', name: 'Tether USD', address: '0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9', decimals: 6, logo: 'https://assets.coingecko.com/coins/images/325/small/Tether.png' },
    { symbol: 'ARB', name: 'Arbitrum', address: '0x912CE59144191C1204E64559FE8253a0e49E6548', decimals: 18, logo: 'https://assets.coingecko.com/coins/images/16547/small/photo_2023-03-29_21.47.00.jpeg' },
  ],
  // ============ Optimism ============
  10: [
    { symbol: 'ETH', name: 'Ethereum', address: '0x0000000000000000000000000000000000000000', decimals: 18, logo: 'https://assets.coingecko.com/coins/images/279/small/ethereum.png', isNative: true },
    { symbol: 'WETH', name: 'Wrapped Ether', address: '0x4200000000000000000000000000000000000006', decimals: 18, logo: 'https://assets.coingecko.com/coins/images/2518/small/weth.png' },
    { symbol: 'USDC', name: 'USD Coin', address: '0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85', decimals: 6, logo: 'https://assets.coingecko.com/coins/images/6319/small/USD_Coin_icon.png' },
    { symbol: 'USDC.e', name: 'Bridged USDC', address: '0x7F5c764cBc14f9669B88837ca1490cCa17c31607', decimals: 6, logo: 'https://assets.coingecko.com/coins/images/6319/small/USD_Coin_icon.png' },
    { symbol: 'USDT', name: 'Tether USD', address: '0x94b008aA00579c1307B0EF2c499aD98a8ce58e58', decimals: 6, logo: 'https://assets.coingecko.com/coins/images/325/small/Tether.png' },
    { symbol: 'OP', name: 'Optimism', address: '0x4200000000000000000000000000000000000042', decimals: 18, logo: 'https://assets.coingecko.com/coins/images/25244/small/Optimism.png' },
  ],
  // ============ Base ============
  8453: [
    { symbol: 'ETH', name: 'Ethereum', address: '0x0000000000000000000000000000000000000000', decimals: 18, logo: 'https://assets.coingecko.com/coins/images/279/small/ethereum.png', isNative: true },
    { symbol: 'WETH', name: 'Wrapped Ether', address: '0x4200000000000000000000000000000000000006', decimals: 18, logo: 'https://assets.coingecko.com/coins/images/2518/small/weth.png' },
    { symbol: 'USDC', name: 'USD Coin', address: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913', decimals: 6, logo: 'https://assets.coingecko.com/coins/images/6319/small/USD_Coin_icon.png' },
    { symbol: 'USDbC', name: 'Bridged USDC', address: '0xd9aAEc86B65D86f6A7B5B1b0c42FFA531710b6CA', decimals: 6, logo: 'https://assets.coingecko.com/coins/images/6319/small/USD_Coin_icon.png' },
    { symbol: 'DAI', name: 'Dai Stablecoin', address: '0x50c5725949A6F0c72E6C4a641F24049A917DB0Cb', decimals: 18, logo: 'https://assets.coingecko.com/coins/images/9956/small/4943.png' },
  ],
  // ============ Polygon ============
  137: [
    { symbol: 'MATIC', name: 'Polygon', address: '0x0000000000000000000000000000000000000000', decimals: 18, logo: 'https://assets.coingecko.com/coins/images/4713/small/matic-token-icon.png', isNative: true },
    { symbol: 'WMATIC', name: 'Wrapped Matic', address: '0x0d500B1d8E8eF31E21C99d1Db9A6444d3ADf1270', decimals: 18, logo: 'https://assets.coingecko.com/coins/images/4713/small/matic-token-icon.png' },
    { symbol: 'WETH', name: 'Wrapped Ether', address: '0x7ceB23fD6bC0adD59E62ac25578270cFf1b9f619', decimals: 18, logo: 'https://assets.coingecko.com/coins/images/2518/small/weth.png' },
    { symbol: 'USDC', name: 'USD Coin', address: '0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359', decimals: 6, logo: 'https://assets.coingecko.com/coins/images/6319/small/USD_Coin_icon.png' },
    { symbol: 'USDC.e', name: 'Bridged USDC', address: '0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174', decimals: 6, logo: 'https://assets.coingecko.com/coins/images/6319/small/USD_Coin_icon.png' },
    { symbol: 'USDT', name: 'Tether USD', address: '0xc2132D05D31c914a87C6611C10748AEb04B58e8F', decimals: 6, logo: 'https://assets.coingecko.com/coins/images/325/small/Tether.png' },
  ],
  // ============ Sepolia Testnet ============
  11155111: [
    { symbol: 'ETH', name: 'Ethereum', address: '0x0000000000000000000000000000000000000000', decimals: 18, logo: 'https://assets.coingecko.com/coins/images/279/small/ethereum.png', isNative: true },
    { symbol: 'WETH', name: 'Wrapped Ether', address: '0xfFf9976782d46CC05630D1f6eBAb18b2324d6B14', decimals: 18, logo: 'https://assets.coingecko.com/coins/images/2518/small/weth.png' },
    { symbol: 'USDC', name: 'USD Coin', address: '0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238', decimals: 6, logo: 'https://assets.coingecko.com/coins/images/6319/small/USD_Coin_icon.png' },
  ],
};
