// ============================================================
// Chain Data — Canonical chain metadata for consistent display
// Used by ChainBadge, BridgePage, CrossChainPage, WalletPage
// ============================================================

export const CHAINS = {
  ethereum: { id: 1, name: 'Ethereum', abbr: 'ETH', color: '#627eea', rpc: 'mainnet', explorer: 'etherscan.io', gasUnit: 'gwei', blockTime: '~12s' },
  base: { id: 8453, name: 'Base', abbr: 'BASE', color: '#0052ff', rpc: 'base', explorer: 'basescan.org', gasUnit: 'gwei', blockTime: '~2s' },
  arbitrum: { id: 42161, name: 'Arbitrum', abbr: 'ARB', color: '#28a0f0', rpc: 'arbitrum', explorer: 'arbiscan.io', gasUnit: 'gwei', blockTime: '~0.3s' },
  optimism: { id: 10, name: 'Optimism', abbr: 'OP', color: '#ff0420', rpc: 'optimism', explorer: 'optimistic.etherscan.io', gasUnit: 'gwei', blockTime: '~2s' },
  polygon: { id: 137, name: 'Polygon', abbr: 'POL', color: '#8247e5', rpc: 'polygon', explorer: 'polygonscan.com', gasUnit: 'gwei', blockTime: '~2s' },
  bnb: { id: 56, name: 'BNB Chain', abbr: 'BNB', color: '#f3ba2f', rpc: 'bsc', explorer: 'bscscan.com', gasUnit: 'gwei', blockTime: '~3s' },
  avalanche: { id: 43114, name: 'Avalanche', abbr: 'AVAX', color: '#e84142', rpc: 'avalanche', explorer: 'snowtrace.io', gasUnit: 'nAVAX', blockTime: '~2s' },
  ckb: { id: 0, name: 'Nervos CKB', abbr: 'CKB', color: '#3cc68a', rpc: 'ckb', explorer: 'explorer.nervos.org', gasUnit: 'shannons', blockTime: '~8s' },
}

export const CHAIN_LIST = Object.values(CHAINS)

export function getChain(nameOrId) {
  if (typeof nameOrId === 'number') {
    return CHAIN_LIST.find((c) => c.id === nameOrId) || CHAINS.ethereum
  }
  const key = String(nameOrId).toLowerCase().replace(/\s/g, '')
  return CHAINS[key] || CHAIN_LIST.find((c) => c.name.toLowerCase().replace(/\s/g, '') === key) || CHAINS.ethereum
}

export function getChainColor(name) {
  return getChain(name).color
}

// Supported chains for VibeSwap (omnichain via LayerZero)
export const SUPPORTED_CHAINS = ['ethereum', 'base', 'arbitrum', 'optimism', 'polygon', 'ckb']
export const SUPPORTED_CHAIN_LIST = SUPPORTED_CHAINS.map((k) => CHAINS[k])

// Default chain
export const DEFAULT_CHAIN = CHAINS.base
