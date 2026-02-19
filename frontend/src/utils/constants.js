// ============================================
// VIBESWAP MAINNET CONFIGURATION
// ============================================

// Helper to get contract address from env or fallback
const getEnvAddress = (key, fallback = '0x0000000000000000000000000000000000000000') => {
  return import.meta.env[key] || fallback
}

// ============================================
// CONTRACT ADDRESSES
// ============================================
// Note: Zero addresses indicate contracts not yet deployed
// Fill in actual addresses after mainnet deployment
export const CONTRACTS = {
  // ============================================
  // ETHEREUM MAINNET (Chain ID: 1)
  // ============================================
  1: {
    vibeSwapCore: getEnvAddress('VITE_ETH_VIBESWAP_CORE'),
    auction: getEnvAddress('VITE_ETH_AUCTION'),
    amm: getEnvAddress('VITE_ETH_VIBE_AMM'),
    treasury: getEnvAddress('VITE_ETH_TREASURY'),
    router: getEnvAddress('VITE_ETH_ROUTER'),
    identity: getEnvAddress('VITE_ETH_IDENTITY'),
    recovery: getEnvAddress('VITE_ETH_RECOVERY'),
    shapleyDistributor: getEnvAddress('VITE_ETH_SHAPLEY_DISTRIBUTOR'),
    ilProtectionVault: getEnvAddress('VITE_ETH_IL_PROTECTION_VAULT'),
    slippageGuaranteeFund: getEnvAddress('VITE_ETH_SLIPPAGE_GUARANTEE_FUND'),
  },
  // ============================================
  // ARBITRUM ONE (Chain ID: 42161)
  // ============================================
  42161: {
    vibeSwapCore: getEnvAddress('VITE_ARB_VIBESWAP_CORE'),
    auction: getEnvAddress('VITE_ARB_AUCTION'),
    amm: getEnvAddress('VITE_ARB_VIBE_AMM'),
    treasury: getEnvAddress('VITE_ARB_TREASURY'),
    router: getEnvAddress('VITE_ARB_ROUTER'),
  },
  // ============================================
  // OPTIMISM (Chain ID: 10)
  // ============================================
  10: {
    vibeSwapCore: getEnvAddress('VITE_OP_VIBESWAP_CORE'),
    auction: getEnvAddress('VITE_OP_AUCTION'),
    amm: getEnvAddress('VITE_OP_VIBE_AMM'),
    treasury: getEnvAddress('VITE_OP_TREASURY'),
    router: getEnvAddress('VITE_OP_ROUTER'),
  },
  // ============================================
  // BASE (Chain ID: 8453)
  // ============================================
  8453: {
    vibeSwapCore: getEnvAddress('VITE_BASE_VIBESWAP_CORE'),
    auction: getEnvAddress('VITE_BASE_AUCTION'),
    amm: getEnvAddress('VITE_BASE_VIBE_AMM'),
    treasury: getEnvAddress('VITE_BASE_TREASURY'),
    router: getEnvAddress('VITE_BASE_ROUTER'),
  },
  // ============================================
  // POLYGON (Chain ID: 137)
  // ============================================
  137: {
    vibeSwapCore: getEnvAddress('VITE_POLYGON_VIBESWAP_CORE'),
    auction: getEnvAddress('VITE_POLYGON_AUCTION'),
    amm: getEnvAddress('VITE_POLYGON_VIBE_AMM'),
    treasury: getEnvAddress('VITE_POLYGON_TREASURY'),
    router: getEnvAddress('VITE_POLYGON_ROUTER'),
  },
  // ============================================
  // SEPOLIA TESTNET (Chain ID: 11155111)
  // ============================================
  11155111: {
    vibeSwapCore: getEnvAddress('VITE_SEPOLIA_VIBESWAP_CORE'),
    auction: getEnvAddress('VITE_SEPOLIA_AUCTION'),
    amm: getEnvAddress('VITE_SEPOLIA_VIBE_AMM'),
    treasury: getEnvAddress('VITE_SEPOLIA_TREASURY'),
    router: getEnvAddress('VITE_SEPOLIA_ROUTER'),
  },
  // ============================================
  // ARBITRUM SEPOLIA (Chain ID: 421614)
  // ============================================
  421614: {
    vibeSwapCore: getEnvAddress('VITE_ARB_SEPOLIA_VIBESWAP_CORE'),
    auction: getEnvAddress('VITE_ARB_SEPOLIA_AUCTION'),
    amm: getEnvAddress('VITE_ARB_SEPOLIA_VIBE_AMM'),
    treasury: getEnvAddress('VITE_ARB_SEPOLIA_TREASURY'),
    router: getEnvAddress('VITE_ARB_SEPOLIA_ROUTER'),
  },
  // ============================================
  // LOCAL DEVELOPMENT (Chain ID: 31337)
  // ============================================
  31337: {
    vibeSwapCore: '0x5FbDB2315678afecb367f032d93F642f64180aa3',
    auction: '0x9fE46736679d2D9a65F0992F2272dE9f3c7fa6e0',
    amm: '0xe7f1725E7734CE288F8367e1Bb143E90bb3F0512',
    treasury: '0xCf7Ed3AccA5a467e9e704C703E8D87F634fB0Fc9',
    router: '0xDc64a140Aa3E981100a9becA4E685f962f0cF6C9',
  },
}

// ============================================
// CANONICAL TOKEN ADDRESSES
// ============================================
// Using well-known canonical addresses for each chain
export const TOKENS = {
  // ============================================
  // ETHEREUM MAINNET
  // ============================================
  1: [
    {
      symbol: 'ETH',
      name: 'Ethereum',
      address: '0x0000000000000000000000000000000000000000',
      decimals: 18,
      logo: 'https://assets.coingecko.com/coins/images/279/small/ethereum.png',
      isNative: true,
    },
    {
      symbol: 'WETH',
      name: 'Wrapped Ether',
      address: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2',
      decimals: 18,
      logo: 'https://assets.coingecko.com/coins/images/2518/small/weth.png',
    },
    {
      symbol: 'USDC',
      name: 'USD Coin',
      address: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
      decimals: 6,
      logo: 'https://assets.coingecko.com/coins/images/6319/small/USD_Coin_icon.png',
    },
    {
      symbol: 'USDT',
      name: 'Tether USD',
      address: '0xdAC17F958D2ee523a2206206994597C13D831ec7',
      decimals: 6,
      logo: 'https://assets.coingecko.com/coins/images/325/small/Tether.png',
    },
    {
      symbol: 'DAI',
      name: 'Dai Stablecoin',
      address: '0x6B175474E89094C44Da98b954EescdeCB5f28',
      decimals: 18,
      logo: 'https://assets.coingecko.com/coins/images/9956/small/4943.png',
    },
    {
      symbol: 'WBTC',
      name: 'Wrapped BTC',
      address: '0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599',
      decimals: 8,
      logo: 'https://assets.coingecko.com/coins/images/7598/small/wrapped_bitcoin_wbtc.png',
    },
  ],
  // ============================================
  // ARBITRUM ONE
  // ============================================
  42161: [
    {
      symbol: 'ETH',
      name: 'Ethereum',
      address: '0x0000000000000000000000000000000000000000',
      decimals: 18,
      logo: 'https://assets.coingecko.com/coins/images/279/small/ethereum.png',
      isNative: true,
    },
    {
      symbol: 'WETH',
      name: 'Wrapped Ether',
      address: '0x82aF49447D8a07e3bd95BD0d56f35241523fBab1',
      decimals: 18,
      logo: 'https://assets.coingecko.com/coins/images/2518/small/weth.png',
    },
    {
      symbol: 'USDC',
      name: 'USD Coin',
      address: '0xaf88d065e77c8cC2239327C5EDb3A432268e5831',
      decimals: 6,
      logo: 'https://assets.coingecko.com/coins/images/6319/small/USD_Coin_icon.png',
    },
    {
      symbol: 'USDC.e',
      name: 'Bridged USDC',
      address: '0xFF970A61A04b1cA14834A43f5dE4533eBDDB5CC8',
      decimals: 6,
      logo: 'https://assets.coingecko.com/coins/images/6319/small/USD_Coin_icon.png',
    },
    {
      symbol: 'USDT',
      name: 'Tether USD',
      address: '0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9',
      decimals: 6,
      logo: 'https://assets.coingecko.com/coins/images/325/small/Tether.png',
    },
    {
      symbol: 'ARB',
      name: 'Arbitrum',
      address: '0x912CE59144191C1204E64559FE8253a0e49E6548',
      decimals: 18,
      logo: 'https://assets.coingecko.com/coins/images/16547/small/photo_2023-03-29_21.47.00.jpeg',
    },
  ],
  // ============================================
  // OPTIMISM
  // ============================================
  10: [
    {
      symbol: 'ETH',
      name: 'Ethereum',
      address: '0x0000000000000000000000000000000000000000',
      decimals: 18,
      logo: 'https://assets.coingecko.com/coins/images/279/small/ethereum.png',
      isNative: true,
    },
    {
      symbol: 'WETH',
      name: 'Wrapped Ether',
      address: '0x4200000000000000000000000000000000000006',
      decimals: 18,
      logo: 'https://assets.coingecko.com/coins/images/2518/small/weth.png',
    },
    {
      symbol: 'USDC',
      name: 'USD Coin',
      address: '0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85',
      decimals: 6,
      logo: 'https://assets.coingecko.com/coins/images/6319/small/USD_Coin_icon.png',
    },
    {
      symbol: 'USDC.e',
      name: 'Bridged USDC',
      address: '0x7F5c764cBc14f9669B88837ca1490cCa17c31607',
      decimals: 6,
      logo: 'https://assets.coingecko.com/coins/images/6319/small/USD_Coin_icon.png',
    },
    {
      symbol: 'USDT',
      name: 'Tether USD',
      address: '0x94b008aA00579c1307B0EF2c499aD98a8ce58e58',
      decimals: 6,
      logo: 'https://assets.coingecko.com/coins/images/325/small/Tether.png',
    },
    {
      symbol: 'OP',
      name: 'Optimism',
      address: '0x4200000000000000000000000000000000000042',
      decimals: 18,
      logo: 'https://assets.coingecko.com/coins/images/25244/small/Optimism.png',
    },
  ],
  // ============================================
  // BASE
  // ============================================
  8453: [
    {
      symbol: 'ETH',
      name: 'Ethereum',
      address: '0x0000000000000000000000000000000000000000',
      decimals: 18,
      logo: 'https://assets.coingecko.com/coins/images/279/small/ethereum.png',
      isNative: true,
    },
    {
      symbol: 'WETH',
      name: 'Wrapped Ether',
      address: '0x4200000000000000000000000000000000000006',
      decimals: 18,
      logo: 'https://assets.coingecko.com/coins/images/2518/small/weth.png',
    },
    {
      symbol: 'USDC',
      name: 'USD Coin',
      address: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
      decimals: 6,
      logo: 'https://assets.coingecko.com/coins/images/6319/small/USD_Coin_icon.png',
    },
    {
      symbol: 'USDbC',
      name: 'Bridged USDC',
      address: '0xd9aAEc86B65D86f6A7B5B1b0c42FFA531710b6CA',
      decimals: 6,
      logo: 'https://assets.coingecko.com/coins/images/6319/small/USD_Coin_icon.png',
    },
    {
      symbol: 'DAI',
      name: 'Dai Stablecoin',
      address: '0x50c5725949A6F0c72E6C4a641F24049A917DB0Cb',
      decimals: 18,
      logo: 'https://assets.coingecko.com/coins/images/9956/small/4943.png',
    },
  ],
  // ============================================
  // POLYGON
  // ============================================
  137: [
    {
      symbol: 'MATIC',
      name: 'Polygon',
      address: '0x0000000000000000000000000000000000000000',
      decimals: 18,
      logo: 'https://assets.coingecko.com/coins/images/4713/small/matic-token-icon.png',
      isNative: true,
    },
    {
      symbol: 'WMATIC',
      name: 'Wrapped Matic',
      address: '0x0d500B1d8E8eF31E21C99d1Db9A6444d3ADf1270',
      decimals: 18,
      logo: 'https://assets.coingecko.com/coins/images/4713/small/matic-token-icon.png',
    },
    {
      symbol: 'WETH',
      name: 'Wrapped Ether',
      address: '0x7ceB23fD6bC0adD59E62ac25578270cFf1b9f619',
      decimals: 18,
      logo: 'https://assets.coingecko.com/coins/images/2518/small/weth.png',
    },
    {
      symbol: 'USDC',
      name: 'USD Coin',
      address: '0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359',
      decimals: 6,
      logo: 'https://assets.coingecko.com/coins/images/6319/small/USD_Coin_icon.png',
    },
    {
      symbol: 'USDC.e',
      name: 'Bridged USDC',
      address: '0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174',
      decimals: 6,
      logo: 'https://assets.coingecko.com/coins/images/6319/small/USD_Coin_icon.png',
    },
    {
      symbol: 'USDT',
      name: 'Tether USD',
      address: '0xc2132D05D31c914a87C6611C10748AEb04B58e8F',
      decimals: 6,
      logo: 'https://assets.coingecko.com/coins/images/325/small/Tether.png',
    },
  ],
  // ============================================
  // SEPOLIA TESTNET
  // ============================================
  11155111: [
    {
      symbol: 'ETH',
      name: 'Ethereum',
      address: '0x0000000000000000000000000000000000000000',
      decimals: 18,
      logo: 'https://assets.coingecko.com/coins/images/279/small/ethereum.png',
      isNative: true,
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

// ============================================
// BATCH TIMING CONSTANTS
// ============================================
export const BATCH_TIMING = {
  COMMIT_DURATION: 8,  // seconds
  REVEAL_DURATION: 2,  // seconds
  TOTAL_DURATION: 10,  // seconds
}

// ============================================
// DEFAULT SETTINGS
// ============================================
export const DEFAULT_SETTINGS = {
  slippage: '0.5',     // percent
  deadline: 30,        // minutes
  maxPriorityFee: '2', // gwei
}

// ============================================
// SUPPORTED CHAINS
// ============================================
export const SUPPORTED_CHAINS = [
  {
    id: 1,
    name: 'Ethereum',
    network: 'mainnet',
    currency: 'ETH',
    rpcUrl: import.meta.env.VITE_ETH_RPC_URL || 'https://eth.llamarpc.com',
    explorer: 'https://etherscan.io',
    isTestnet: false,
    lzEndpointId: 30101,
  },
  {
    id: 42161,
    name: 'Arbitrum',
    network: 'arbitrum',
    currency: 'ETH',
    rpcUrl: import.meta.env.VITE_ARB_RPC_URL || 'https://arb1.arbitrum.io/rpc',
    explorer: 'https://arbiscan.io',
    isTestnet: false,
    lzEndpointId: 30110,
  },
  {
    id: 10,
    name: 'Optimism',
    network: 'optimism',
    currency: 'ETH',
    rpcUrl: import.meta.env.VITE_OP_RPC_URL || 'https://mainnet.optimism.io',
    explorer: 'https://optimistic.etherscan.io',
    isTestnet: false,
    lzEndpointId: 30111,
  },
  {
    id: 8453,
    name: 'Base',
    network: 'base',
    currency: 'ETH',
    rpcUrl: import.meta.env.VITE_BASE_RPC_URL || 'https://mainnet.base.org',
    explorer: 'https://basescan.org',
    isTestnet: false,
    lzEndpointId: 30184,
  },
  {
    id: 137,
    name: 'Polygon',
    network: 'polygon',
    currency: 'MATIC',
    rpcUrl: import.meta.env.VITE_POLYGON_RPC_URL || 'https://polygon-rpc.com',
    explorer: 'https://polygonscan.com',
    isTestnet: false,
    lzEndpointId: 30109,
  },
  {
    id: 11155111,
    name: 'Sepolia',
    network: 'sepolia',
    currency: 'ETH',
    rpcUrl: import.meta.env.VITE_SEPOLIA_RPC_URL || 'https://rpc.sepolia.org',
    explorer: 'https://sepolia.etherscan.io',
    isTestnet: true,
    lzEndpointId: 40161,
  },
  {
    id: 421614,
    name: 'Arbitrum Sepolia',
    network: 'arbitrum-sepolia',
    currency: 'ETH',
    rpcUrl: import.meta.env.VITE_ARB_SEPOLIA_RPC_URL || 'https://sepolia-rollup.arbitrum.io/rpc',
    explorer: 'https://sepolia.arbiscan.io',
    isTestnet: true,
    lzEndpointId: 40231,
  },
  // ============================================
  // NERVOS CKB (UTXO Cell Model)
  // ============================================
  {
    id: 'ckb-mainnet',
    name: 'Nervos CKB',
    network: 'ckb',
    currency: 'CKB',
    rpcUrl: import.meta.env.VITE_CKB_RPC_URL || 'https://mainnet.ckbapp.dev/rpc',
    explorer: 'https://explorer.nervos.org',
    isTestnet: false,
    isCKB: true,
  },
  {
    id: 'ckb-testnet',
    name: 'CKB Testnet',
    network: 'ckb-testnet',
    currency: 'CKB',
    rpcUrl: import.meta.env.VITE_CKB_TESTNET_RPC_URL || 'https://testnet.ckbapp.dev/rpc',
    explorer: 'https://pudge.explorer.nervos.org',
    isTestnet: true,
    isCKB: true,
  },
]

// ============================================
// LAYERZERO ENDPOINT IDS (V2)
// ============================================
export const LZ_ENDPOINTS = {
  // Mainnets
  1: 30101,      // Ethereum
  42161: 30110,  // Arbitrum
  10: 30111,     // Optimism
  8453: 30184,   // Base
  137: 30109,    // Polygon
  // Testnets
  11155111: 40161,  // Sepolia
  421614: 40231,    // Arbitrum Sepolia
}

// ============================================
// UTILITY FUNCTIONS
// ============================================

// Check if contracts are deployed for a chain
export const areContractsDeployed = (chainId) => {
  const contracts = CONTRACTS[chainId]
  if (!contracts) return false
  return contracts.vibeSwapCore !== '0x0000000000000000000000000000000000000000'
}

// Get chain by ID
export const getChainById = (chainId) => {
  return SUPPORTED_CHAINS.find(c => c.id === chainId)
}

// Get mainnet chains only
export const getMainnetChains = () => {
  return SUPPORTED_CHAINS.filter(c => !c.isTestnet)
}

// Get testnet chains only
export const getTestnetChains = () => {
  return SUPPORTED_CHAINS.filter(c => c.isTestnet)
}

// Check if in production mode
export const isProductionMode = () => {
  return import.meta.env.VITE_PRODUCTION_MODE === 'true'
}

// Check if a chain ID is a CKB chain
export const isCKBChain = (chainId) => {
  return typeof chainId === 'string' && chainId.startsWith('ckb-')
}

// Get EVM-only chains
export const getEVMChains = () => {
  return SUPPORTED_CHAINS.filter(c => !c.isCKB)
}

// Get CKB chains
export const getCKBChains = () => {
  return SUPPORTED_CHAINS.filter(c => c.isCKB)
}
