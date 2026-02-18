// ============================================
// NERVOS CKB CONFIGURATION
// ============================================
// Cell model integration for VibeSwap's five-layer MEV defense
// PoW-gated state + MMR + forced inclusion + shuffle + uniform clearing

// ============================================
// CKB CHAIN IDENTIFIERS
// ============================================
// CKB uses a different chain model than EVM — not a "chainId" per se,
// but we assign synthetic IDs for the frontend chain selector
export const CKB_CHAIN_ID = 'ckb-mainnet'
export const CKB_TESTNET_CHAIN_ID = 'ckb-testnet'
export const CKB_DEVNET_CHAIN_ID = 'ckb-devnet'

export const CKB_CHAINS = [
  {
    id: CKB_CHAIN_ID,
    name: 'Nervos CKB',
    network: 'ckb',
    currency: 'CKB',
    rpcUrl: import.meta.env.VITE_CKB_RPC_URL || 'https://mainnet.ckbapp.dev/rpc',
    indexerUrl: import.meta.env.VITE_CKB_INDEXER_URL || 'https://mainnet.ckbapp.dev/indexer',
    explorer: 'https://explorer.nervos.org',
    isTestnet: false,
    isCKB: true,
    blockTime: 0.2, // ~200ms per block (theoretical, actual varies)
  },
  {
    id: CKB_TESTNET_CHAIN_ID,
    name: 'CKB Testnet',
    network: 'ckb-testnet',
    currency: 'CKB',
    rpcUrl: import.meta.env.VITE_CKB_TESTNET_RPC_URL || 'https://testnet.ckbapp.dev/rpc',
    indexerUrl: import.meta.env.VITE_CKB_TESTNET_INDEXER_URL || 'https://testnet.ckbapp.dev/indexer',
    explorer: 'https://pudge.explorer.nervos.org',
    isTestnet: true,
    isCKB: true,
    blockTime: 0.2,
  },
  {
    id: CKB_DEVNET_CHAIN_ID,
    name: 'CKB Devnet',
    network: 'ckb-devnet',
    currency: 'CKB',
    rpcUrl: 'http://localhost:8114',
    indexerUrl: 'http://localhost:8116',
    explorer: null,
    isTestnet: true,
    isCKB: true,
    blockTime: 0.2,
  },
]

// ============================================
// SCRIPT CODE HASHES (deployed on-chain)
// ============================================
// Placeholder hashes — replaced after CKB script deployment
const ZERO_HASH = '0x' + '0'.repeat(64)

export const CKB_SCRIPTS = {
  // VibeSwap custom scripts
  powLock: {
    codeHash: import.meta.env.VITE_CKB_POW_LOCK_CODE_HASH || ZERO_HASH,
    hashType: 'type',
  },
  batchAuctionType: {
    codeHash: import.meta.env.VITE_CKB_BATCH_AUCTION_CODE_HASH || ZERO_HASH,
    hashType: 'type',
  },
  commitType: {
    codeHash: import.meta.env.VITE_CKB_COMMIT_TYPE_CODE_HASH || ZERO_HASH,
    hashType: 'type',
  },
  ammPoolType: {
    codeHash: import.meta.env.VITE_CKB_AMM_POOL_CODE_HASH || ZERO_HASH,
    hashType: 'type',
  },
  lpPositionType: {
    codeHash: import.meta.env.VITE_CKB_LP_POSITION_CODE_HASH || ZERO_HASH,
    hashType: 'type',
  },
  complianceType: {
    codeHash: import.meta.env.VITE_CKB_COMPLIANCE_CODE_HASH || ZERO_HASH,
    hashType: 'type',
  },
  configType: {
    codeHash: import.meta.env.VITE_CKB_CONFIG_CODE_HASH || ZERO_HASH,
    hashType: 'type',
  },
  oracleType: {
    codeHash: import.meta.env.VITE_CKB_ORACLE_CODE_HASH || ZERO_HASH,
    hashType: 'type',
  },
  // Standard CKB scripts
  secp256k1Blake160: {
    codeHash: '0x9bd7e06f3ecf4be0f2fcd2188b23f1b9fcc88e5d4b65a8637b17723bbda3cce8',
    hashType: 'type',
  },
  // xUDT (extensible user-defined token) standard
  xUDT: {
    codeHash: '0x50bd8d6680b8b9cf98b73f3c08faf8b2a21914311954118ad6609f6e30a9f0e0',
    hashType: 'data1',
  },
}

// ============================================
// BATCH TIMING (CKB blocks)
// ============================================
// CKB uses block numbers, not wall clock seconds
export const CKB_BATCH_TIMING = {
  COMMIT_WINDOW_BLOCKS: 40,   // ~8 seconds at ~0.2s/block
  REVEAL_WINDOW_BLOCKS: 10,   // ~2 seconds
  TOTAL_BLOCKS: 50,
  BLOCK_TIME_MS: 200,         // Approximate milliseconds per CKB block
}

// ============================================
// PHASE CONSTANTS (matches Rust types)
// ============================================
export const CKB_PHASES = {
  COMMIT: 0,
  REVEAL: 1,
  SETTLING: 2,
  SETTLED: 3,
}

export const CKB_PHASE_NAMES = {
  [CKB_PHASES.COMMIT]: 'COMMIT',
  [CKB_PHASES.REVEAL]: 'REVEAL',
  [CKB_PHASES.SETTLING]: 'SETTLING',
  [CKB_PHASES.SETTLED]: 'SETTLED',
}

// ============================================
// ORDER TYPES
// ============================================
export const CKB_ORDER_TYPES = {
  BUY: 0,
  SELL: 1,
}

// ============================================
// PRECISION & DEFAULTS
// ============================================
export const CKB_PRECISION = BigInt('1000000000000000000') // 1e18
export const CKB_BPS_DENOMINATOR = BigInt(10000)
export const CKB_DEFAULT_FEE_BPS = 5           // 0.05%
export const CKB_DEFAULT_SLASH_BPS = 5000      // 50%
export const CKB_MIN_DEPOSIT_CKB = 100_000_000_000 // 1000 CKB in shannons
export const CKB_SHANNON_PER_CKB = 100_000_000

// ============================================
// CELL DATA SIZES (bytes) — matches Rust types
// ============================================
export const CELL_SIZES = {
  AUCTION: 217,
  COMMIT: 136,
  REVEAL_WITNESS: 77,
  POOL: 218,
  LP_POSITION: 72,
  COMPLIANCE: 108,
  CONFIG: 67,
  ORACLE: 89,
  POW_LOCK_ARGS: 33,
}

// ============================================
// CELL DATA PARSERS
// ============================================
// Parse little-endian bytes from cell data into JS objects
// These mirror the Rust serialize/deserialize in vibeswap-types

function readU8(data, offset) {
  return data[offset]
}

function readU16LE(data, offset) {
  return data[offset] | (data[offset + 1] << 8)
}

function readU32LE(data, offset) {
  return (data[offset] | (data[offset + 1] << 8) | (data[offset + 2] << 16) | (data[offset + 3] << 24)) >>> 0
}

function readU64LE(data, offset) {
  const lo = BigInt(readU32LE(data, offset))
  const hi = BigInt(readU32LE(data, offset + 4))
  return (hi << 32n) | lo
}

function readU128LE(data, offset) {
  const lo = readU64LE(data, offset)
  const hi = readU64LE(data, offset + 8)
  return (hi << 64n) | lo
}

function readBytes(data, offset, len) {
  return '0x' + Array.from(data.slice(offset, offset + len)).map(b => b.toString(16).padStart(2, '0')).join('')
}

export function parseAuctionCellData(data) {
  if (!data || data.length < CELL_SIZES.AUCTION) return null
  let offset = 0

  const phase = readU8(data, offset); offset += 1
  const batchId = readU64LE(data, offset); offset += 8
  const commitMmrRoot = readBytes(data, offset, 32); offset += 32
  const commitCount = readU32LE(data, offset); offset += 4
  const revealCount = readU32LE(data, offset); offset += 4
  const xorSeed = readBytes(data, offset, 32); offset += 32
  const clearingPrice = readU128LE(data, offset); offset += 16
  const fillableVolume = readU128LE(data, offset); offset += 16
  const difficultyTarget = readBytes(data, offset, 32); offset += 32
  const prevStateHash = readBytes(data, offset, 32); offset += 32
  const phaseStartBlock = readU64LE(data, offset); offset += 8
  const pairId = readBytes(data, offset, 32)

  return {
    phase, batchId, commitMmrRoot, commitCount, revealCount,
    xorSeed, clearingPrice, fillableVolume, difficultyTarget,
    prevStateHash, phaseStartBlock, pairId,
    phaseName: CKB_PHASE_NAMES[phase] || 'UNKNOWN',
  }
}

export function parsePoolCellData(data) {
  if (!data || data.length < CELL_SIZES.POOL) return null
  let offset = 0

  const reserve0 = readU128LE(data, offset); offset += 16
  const reserve1 = readU128LE(data, offset); offset += 16
  const totalLpSupply = readU128LE(data, offset); offset += 16
  const feeRateBps = readU16LE(data, offset); offset += 2
  const twapPriceCum = readU128LE(data, offset); offset += 16
  const twapLastBlock = readU64LE(data, offset); offset += 8
  const kLast = readBytes(data, offset, 32); offset += 32
  const minimumLiquidity = readU128LE(data, offset); offset += 16
  const pairId = readBytes(data, offset, 32); offset += 32
  const token0TypeHash = readBytes(data, offset, 32); offset += 32
  const token1TypeHash = readBytes(data, offset, 32)

  return {
    reserve0, reserve1, totalLpSupply, feeRateBps,
    twapPriceCum, twapLastBlock, kLast, minimumLiquidity,
    pairId, token0TypeHash, token1TypeHash,
  }
}

export function parseCommitCellData(data) {
  if (!data || data.length < CELL_SIZES.COMMIT) return null
  let offset = 0

  const orderHash = readBytes(data, offset, 32); offset += 32
  const batchId = readU64LE(data, offset); offset += 8
  const depositCkb = readU64LE(data, offset); offset += 8
  const tokenTypeHash = readBytes(data, offset, 32); offset += 32
  const tokenAmount = readU128LE(data, offset); offset += 16
  const blockNumber = readU64LE(data, offset); offset += 8
  const senderLockHash = readBytes(data, offset, 32)

  return {
    orderHash, batchId, depositCkb, tokenTypeHash,
    tokenAmount, blockNumber, senderLockHash,
  }
}

export function parseLPPositionCellData(data) {
  if (!data || data.length < CELL_SIZES.LP_POSITION) return null
  return {
    lpAmount: readU128LE(data, 0),
    entryPrice: readU128LE(data, 16),
    poolId: readBytes(data, 32, 32),
    depositBlock: readU64LE(data, 64),
  }
}

export function parseOracleCellData(data) {
  if (!data || data.length < CELL_SIZES.ORACLE) return null
  return {
    price: readU128LE(data, 0),
    blockNumber: readU64LE(data, 16),
    confidence: readU8(data, 24),
    sourceHash: readBytes(data, 25, 32),
    pairId: readBytes(data, 57, 32),
  }
}

// ============================================
// CELL DATA BUILDERS
// ============================================
// Build cell data bytes for transaction construction

function writeU8(buf, offset, value) {
  buf[offset] = value & 0xFF
  return offset + 1
}

function writeU64LE(buf, offset, value) {
  const v = BigInt(value)
  for (let i = 0; i < 8; i++) {
    buf[offset + i] = Number((v >> BigInt(i * 8)) & 0xFFn)
  }
  return offset + 8
}

function writeU128LE(buf, offset, value) {
  const v = BigInt(value)
  for (let i = 0; i < 16; i++) {
    buf[offset + i] = Number((v >> BigInt(i * 8)) & 0xFFn)
  }
  return offset + 16
}

function writeBytes(buf, offset, hexStr, len) {
  const hex = hexStr.startsWith('0x') ? hexStr.slice(2) : hexStr
  for (let i = 0; i < len; i++) {
    buf[offset + i] = parseInt(hex.slice(i * 2, i * 2 + 2) || '00', 16)
  }
  return offset + len
}

export function buildCommitCellData({ orderHash, batchId, depositCkb, tokenTypeHash, tokenAmount, blockNumber, senderLockHash }) {
  const buf = new Uint8Array(CELL_SIZES.COMMIT)
  let offset = 0
  offset = writeBytes(buf, offset, orderHash, 32)
  offset = writeU64LE(buf, offset, batchId)
  offset = writeU64LE(buf, offset, depositCkb)
  offset = writeBytes(buf, offset, tokenTypeHash, 32)
  offset = writeU128LE(buf, offset, tokenAmount)
  offset = writeU64LE(buf, offset, blockNumber)
  writeBytes(buf, offset, senderLockHash, 32)
  return buf
}

export function buildRevealWitness({ orderType, amountIn, limitPrice, secret, priorityBid, commitIndex }) {
  const buf = new Uint8Array(CELL_SIZES.REVEAL_WITNESS)
  let offset = 0
  offset = writeU8(buf, offset, orderType)
  offset = writeU128LE(buf, offset, amountIn)
  offset = writeU128LE(buf, offset, limitPrice)
  offset = writeBytes(buf, offset, secret, 32)
  offset = writeU64LE(buf, offset, priorityBid)
  // writeU32LE for commitIndex
  const ci = commitIndex >>> 0
  buf[offset] = ci & 0xFF
  buf[offset + 1] = (ci >> 8) & 0xFF
  buf[offset + 2] = (ci >> 16) & 0xFF
  buf[offset + 3] = (ci >> 24) & 0xFF
  return buf
}

// ============================================
// CKB TOKEN LIST (xUDT tokens)
// ============================================
// On CKB, tokens are xUDT cells identified by type script hash
export const CKB_TOKENS = {
  [CKB_CHAIN_ID]: [
    {
      symbol: 'CKB',
      name: 'Common Knowledge Byte',
      typeHash: null, // Native — capacity based
      decimals: 8,    // 1 CKB = 1e8 shannons
      logo: 'https://assets.coingecko.com/coins/images/4951/small/nervos.png',
      isNative: true,
    },
    {
      symbol: 'dCKB',
      name: 'Deposit CKB (NervosDAO)',
      typeHash: import.meta.env.VITE_CKB_DCKB_TYPE_HASH || ZERO_HASH,
      decimals: 8,
      logo: 'https://assets.coingecko.com/coins/images/4951/small/nervos.png',
    },
  ],
  [CKB_TESTNET_CHAIN_ID]: [
    {
      symbol: 'CKB',
      name: 'Common Knowledge Byte',
      typeHash: null,
      decimals: 8,
      logo: 'https://assets.coingecko.com/coins/images/4951/small/nervos.png',
      isNative: true,
    },
  ],
}

// ============================================
// UTILITY FUNCTIONS
// ============================================

export const isCKBChain = (chainId) => {
  return chainId === CKB_CHAIN_ID || chainId === CKB_TESTNET_CHAIN_ID || chainId === CKB_DEVNET_CHAIN_ID
}

export const getCKBChainById = (chainId) => {
  return CKB_CHAINS.find(c => c.id === chainId)
}

export const areCKBScriptsDeployed = () => {
  return CKB_SCRIPTS.batchAuctionType.codeHash !== ZERO_HASH
}

export const formatCKB = (shannons) => {
  const ckb = Number(BigInt(shannons)) / CKB_SHANNON_PER_CKB
  return ckb.toLocaleString(undefined, { maximumFractionDigits: 4 })
}

export const formatTokenAmount = (amount, decimals = 18) => {
  const value = Number(BigInt(amount)) / (10 ** decimals)
  if (value > 1_000_000) return (value / 1_000_000).toFixed(2) + 'M'
  if (value > 1_000) return (value / 1_000).toFixed(2) + 'K'
  return value.toFixed(4)
}

// Compute SHA-256 hash for order commitment (browser-native crypto)
export async function computeOrderHash(orderType, amountIn, limitPrice, priorityBid, secret) {
  const buf = new ArrayBuffer(1 + 16 + 16 + 8 + 32)
  const view = new DataView(buf)
  const bytes = new Uint8Array(buf)

  let offset = 0
  view.setUint8(offset, orderType); offset += 1

  // Write u128 as little-endian
  const writeU128 = (off, val) => {
    const v = BigInt(val)
    for (let i = 0; i < 16; i++) {
      bytes[off + i] = Number((v >> BigInt(i * 8)) & 0xFFn)
    }
  }
  writeU128(offset, amountIn); offset += 16
  writeU128(offset, limitPrice); offset += 16

  // Write u64 priority_bid as LE
  const pb = BigInt(priorityBid)
  for (let i = 0; i < 8; i++) {
    bytes[offset + i] = Number((pb >> BigInt(i * 8)) & 0xFFn)
  }
  offset += 8

  // Write 32-byte secret
  const secretBytes = typeof secret === 'string'
    ? new Uint8Array(secret.match(/.{2}/g).map(b => parseInt(b, 16)))
    : new Uint8Array(secret)
  bytes.set(secretBytes.slice(0, 32), offset)

  const hashBuffer = await crypto.subtle.digest('SHA-256', buf)
  return '0x' + Array.from(new Uint8Array(hashBuffer)).map(b => b.toString(16).padStart(2, '0')).join('')
}

// Generate cryptographically random 32-byte secret
export function generateSecret() {
  const secret = new Uint8Array(32)
  crypto.getRandomValues(secret)
  return '0x' + Array.from(secret).map(b => b.toString(16).padStart(2, '0')).join('')
}
