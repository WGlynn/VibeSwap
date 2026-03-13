import { useState, useMemo } from 'react'
import { Link } from 'react-router-dom'
import { motion } from 'framer-motion'
import { useWallet } from '../hooks/useWallet'
import { useDeviceWallet } from '../hooks/useDeviceWallet'
import GlassCard from './ui/GlassCard'
import PageHero from './ui/PageHero'

// ============ Constants ============

const PHI = 1.618033988749895
const CYAN = '#06b6d4'
const ease = [0.25, 0.1, 0.25, 1]

const sectionV = {
  hidden: { opacity: 0, y: 40, scale: 0.97 },
  visible: (i) => ({
    opacity: 1, y: 0, scale: 1,
    transition: { duration: 0.5, delay: 0.15 + i * (0.1 * PHI), ease },
  }),
}

// ============ Seeded PRNG ============

function seededRandom(seed) {
  let s = seed
  return () => {
    s = (s * 1103515245 + 12345) & 0x7fffffff
    return s / 0x7fffffff
  }
}

// ============ Utility ============

function truncAddr(addr) {
  if (!addr || addr.length < 12) return addr
  return addr.slice(0, 6) + '...' + addr.slice(-4)
}

function formatTimestamp(ts) {
  const d = new Date(ts)
  return d.toISOString().replace('T', ' ').slice(0, 19) + ' UTC'
}

// ============ Contract Data ============

const CONTRACTS = [
  {
    id: 'commit-reveal',
    name: 'CommitRevealAuction',
    address: '0x7a3B8c4e2F1d9E6b5A0C3D8F7E2B1A4C6D9F0E3',
    chain: 'Ethereum',
    chainColor: '#627eea',
    verified: true,
    description: 'Batch auction mechanism with commit-reveal phases. Eliminates MEV through hash commitments and Fisher-Yates shuffle settlement.',
    compiler: 'v0.8.20+commit.a1b79de6',
    license: 'MIT',
    proxy: 'UUPS (EIP-1967)',
    readFunctions: [
      { name: 'getCurrentBatchId', params: [], returns: 'uint256', result: '14832' },
      { name: 'getBatchPhase', params: [], returns: 'Phase', result: 'COMMIT' },
      { name: 'getCommitCount', params: ['uint256 batchId'], returns: 'uint256', result: '47' },
      { name: 'getRevealDeadline', params: ['uint256 batchId'], returns: 'uint256', result: '1710342800' },
      { name: 'COMMIT_DURATION', params: [], returns: 'uint256', result: '8' },
      { name: 'REVEAL_DURATION', params: [], returns: 'uint256', result: '2' },
    ],
    writeFunctions: [
      { name: 'commitOrder', params: ['bytes32 commitment'], description: 'Submit hashed order commitment with deposit' },
      { name: 'revealOrder', params: ['uint256 batchId', 'bytes calldata order', 'bytes32 secret'], description: 'Reveal committed order during reveal phase' },
      { name: 'claimSettlement', params: ['uint256 batchId'], description: 'Claim tokens after batch settlement' },
    ],
    events: [
      { name: 'OrderCommitted', block: 19284531, args: 'batchId=14832, trader=0x1a2B...3c4D', timestamp: 1710342400000 },
      { name: 'OrderRevealed', block: 19284529, args: 'batchId=14831, trader=0x5e6F...7g8H', timestamp: 1710342390000 },
      { name: 'BatchSettled', block: 19284520, args: 'batchId=14830, clearingPrice=1847.32e18', timestamp: 1710342380000 },
    ],
  },
  {
    id: 'vibe-amm',
    name: 'VibeAMM',
    address: '0x4B2C8D1E5F3A9067B8C2D4E6F1A3B5C7D9E0F2A',
    chain: 'Ethereum',
    chainColor: '#627eea',
    verified: true,
    description: 'Constant product AMM (x*y=k) with batch-aware liquidity. Provides baseline pricing between auction batches.',
    compiler: 'v0.8.20+commit.a1b79de6',
    license: 'MIT',
    proxy: 'UUPS (EIP-1967)',
    readFunctions: [
      { name: 'getReserves', params: ['address tokenA', 'address tokenB'], returns: '(uint256, uint256)', result: '(24500e18, 45200000e6)' },
      { name: 'getPrice', params: ['address tokenIn', 'address tokenOut'], returns: 'uint256', result: '1844.89e18' },
      { name: 'totalLiquidity', params: ['bytes32 pairId'], returns: 'uint256', result: '33280000e18' },
      { name: 'getSwapFee', params: [], returns: 'uint256', result: '30' },
      { name: 'K_CONSTANT', params: ['bytes32 pairId'], returns: 'uint256', result: '1107400000000e36' },
    ],
    writeFunctions: [
      { name: 'addLiquidity', params: ['address tokenA', 'address tokenB', 'uint256 amountA', 'uint256 amountB', 'uint256 minLP'], description: 'Provide liquidity to a trading pair' },
      { name: 'removeLiquidity', params: ['bytes32 pairId', 'uint256 lpAmount', 'uint256 minA', 'uint256 minB'], description: 'Withdraw liquidity and receive underlying tokens' },
    ],
    events: [
      { name: 'LiquidityAdded', block: 19284525, args: 'pairId=0xab12...ef34, provider=0x9a0B...1c2D, amountA=10e18', timestamp: 1710342350000 },
      { name: 'LiquidityRemoved', block: 19284518, args: 'pairId=0xab12...ef34, provider=0x3e4F...5g6H, lpBurned=500e18', timestamp: 1710342300000 },
    ],
  },
  {
    id: 'vibeswap-core',
    name: 'VibeSwapCore',
    address: '0x1D3E5F7A9B0C2D4E6F8A1B3C5D7E9F0A2B4C6D8',
    chain: 'Ethereum',
    chainColor: '#627eea',
    verified: true,
    description: 'Main orchestrator contract. Routes orders between commit-reveal auctions and AMM, manages protocol state and fee collection.',
    compiler: 'v0.8.20+commit.a1b79de6',
    license: 'MIT',
    proxy: 'UUPS (EIP-1967)',
    readFunctions: [
      { name: 'protocolVersion', params: [], returns: 'string', result: '"1.2.0"' },
      { name: 'totalVolume', params: [], returns: 'uint256', result: '847320000e18' },
      { name: 'supportedPairsCount', params: [], returns: 'uint256', result: '12' },
      { name: 'isPaused', params: [], returns: 'bool', result: 'false' },
      { name: 'protocolFeeRate', params: [], returns: 'uint256', result: '0' },
    ],
    writeFunctions: [
      { name: 'swap', params: ['address tokenIn', 'address tokenOut', 'uint256 amountIn', 'uint256 minOut', 'uint256 deadline'], description: 'Execute a swap through the optimal route' },
      { name: 'approve', params: ['address spender', 'uint256 amount'], description: 'Approve token spending allowance' },
    ],
    events: [
      { name: 'SwapExecuted', block: 19284530, args: 'trader=0x7a8B...9c0D, tokenIn=WETH, amountIn=2.5e18', timestamp: 1710342395000 },
      { name: 'PairAdded', block: 19280100, args: 'pairId=0xcd56...gh78, tokenA=WETH, tokenB=USDC', timestamp: 1710300000000 },
    ],
  },
  {
    id: 'shapley',
    name: 'ShapleyDistributor',
    address: '0x8E2F4A6B0C1D3E5F7A9B2C4D6E8F0A1B3C5D7E9',
    chain: 'Arbitrum',
    chainColor: '#28a0f0',
    verified: true,
    description: 'Game theory reward distribution using Shapley values. Calculates fair contribution of each participant to protocol value.',
    compiler: 'v0.8.20+commit.a1b79de6',
    license: 'MIT',
    proxy: 'UUPS (EIP-1967)',
    readFunctions: [
      { name: 'getShapleyValue', params: ['address participant'], returns: 'uint256', result: '4280e18' },
      { name: 'totalDistributed', params: [], returns: 'uint256', result: '1250000e18' },
      { name: 'currentEpoch', params: [], returns: 'uint256', result: '87' },
      { name: 'participantCount', params: [], returns: 'uint256', result: '3412' },
    ],
    writeFunctions: [
      { name: 'claimRewards', params: ['uint256 epoch'], description: 'Claim Shapley value rewards for a completed epoch' },
      { name: 'registerContribution', params: ['bytes32 contributionHash', 'uint256 value'], description: 'Register a contribution for Shapley calculation' },
    ],
    events: [
      { name: 'RewardsClaimed', block: 184729310, args: 'participant=0x2b3C...4d5E, epoch=86, amount=142e18', timestamp: 1710342200000 },
      { name: 'EpochFinalized', block: 184729200, args: 'epoch=86, totalValue=28400e18, participants=3401', timestamp: 1710342000000 },
    ],
  },
  {
    id: 'cross-chain',
    name: 'CrossChainRouter',
    address: '0x5A7B9C1D3E5F7A0B2C4D6E8F1A3B5C7D9E0F2A4',
    chain: 'Optimism',
    chainColor: '#ff0420',
    verified: true,
    description: 'LayerZero V2 OApp for cross-chain messaging. Routes swap orders and liquidity across supported chains with guaranteed delivery.',
    compiler: 'v0.8.20+commit.a1b79de6',
    license: 'MIT',
    proxy: 'UUPS (EIP-1967)',
    readFunctions: [
      { name: 'supportedChains', params: [], returns: 'uint32[]', result: '[1, 42161, 10, 8453, 43114]' },
      { name: 'messageCount', params: [], returns: 'uint256', result: '284710' },
      { name: 'pendingMessages', params: [], returns: 'uint256', result: '3' },
      { name: 'averageDeliveryTime', params: [], returns: 'uint256', result: '34' },
    ],
    writeFunctions: [
      { name: 'sendCrossChainSwap', params: ['uint32 dstChainId', 'bytes calldata swapData', 'bytes calldata adapterParams'], description: 'Send a swap order to a destination chain via LayerZero' },
      { name: 'retryMessage', params: ['uint32 srcChainId', 'bytes calldata srcAddress', 'uint64 nonce'], description: 'Retry a failed cross-chain message' },
    ],
    events: [
      { name: 'MessageSent', block: 117423580, args: 'dstChain=42161, nonce=284710, payload=0xf1e2...d3c4', timestamp: 1710342100000 },
      { name: 'MessageReceived', block: 117423550, args: 'srcChain=1, nonce=284709, status=SUCCESS', timestamp: 1710342050000 },
    ],
  },
]

// ============ ABI Data ============

const ABI_DATA = [
  {
    category: 'Core',
    functions: [
      { sig: 'commitOrder(bytes32)', type: 'write', mutability: 'payable', params: [{ name: 'commitment', type: 'bytes32' }] },
      { sig: 'revealOrder(uint256,bytes,bytes32)', type: 'write', mutability: 'nonpayable', params: [{ name: 'batchId', type: 'uint256' }, { name: 'order', type: 'bytes' }, { name: 'secret', type: 'bytes32' }] },
      { sig: 'claimSettlement(uint256)', type: 'write', mutability: 'nonpayable', params: [{ name: 'batchId', type: 'uint256' }] },
      { sig: 'getCurrentBatchId()', type: 'read', mutability: 'view', params: [] },
      { sig: 'getBatchPhase()', type: 'read', mutability: 'view', params: [] },
      { sig: 'getCommitCount(uint256)', type: 'read', mutability: 'view', params: [{ name: 'batchId', type: 'uint256' }] },
    ],
  },
  {
    category: 'AMM',
    functions: [
      { sig: 'addLiquidity(address,address,uint256,uint256,uint256)', type: 'write', mutability: 'nonpayable', params: [{ name: 'tokenA', type: 'address' }, { name: 'tokenB', type: 'address' }, { name: 'amountA', type: 'uint256' }, { name: 'amountB', type: 'uint256' }, { name: 'minLP', type: 'uint256' }] },
      { sig: 'removeLiquidity(bytes32,uint256,uint256,uint256)', type: 'write', mutability: 'nonpayable', params: [{ name: 'pairId', type: 'bytes32' }, { name: 'lpAmount', type: 'uint256' }, { name: 'minA', type: 'uint256' }, { name: 'minB', type: 'uint256' }] },
      { sig: 'swap(address,address,uint256,uint256,uint256)', type: 'write', mutability: 'nonpayable', params: [{ name: 'tokenIn', type: 'address' }, { name: 'tokenOut', type: 'address' }, { name: 'amountIn', type: 'uint256' }, { name: 'minOut', type: 'uint256' }, { name: 'deadline', type: 'uint256' }] },
      { sig: 'getReserves(address,address)', type: 'read', mutability: 'view', params: [{ name: 'tokenA', type: 'address' }, { name: 'tokenB', type: 'address' }] },
      { sig: 'getPrice(address,address)', type: 'read', mutability: 'view', params: [{ name: 'tokenIn', type: 'address' }, { name: 'tokenOut', type: 'address' }] },
      { sig: 'totalLiquidity(bytes32)', type: 'read', mutability: 'view', params: [{ name: 'pairId', type: 'bytes32' }] },
    ],
  },
  {
    category: 'Rewards',
    functions: [
      { sig: 'claimRewards(uint256)', type: 'write', mutability: 'nonpayable', params: [{ name: 'epoch', type: 'uint256' }] },
      { sig: 'registerContribution(bytes32,uint256)', type: 'write', mutability: 'nonpayable', params: [{ name: 'contributionHash', type: 'bytes32' }, { name: 'value', type: 'uint256' }] },
      { sig: 'getShapleyValue(address)', type: 'read', mutability: 'view', params: [{ name: 'participant', type: 'address' }] },
      { sig: 'totalDistributed()', type: 'read', mutability: 'view', params: [] },
      { sig: 'currentEpoch()', type: 'read', mutability: 'view', params: [] },
    ],
  },
  {
    category: 'Cross-Chain',
    functions: [
      { sig: 'sendCrossChainSwap(uint32,bytes,bytes)', type: 'write', mutability: 'payable', params: [{ name: 'dstChainId', type: 'uint32' }, { name: 'swapData', type: 'bytes' }, { name: 'adapterParams', type: 'bytes' }] },
      { sig: 'retryMessage(uint32,bytes,uint64)', type: 'write', mutability: 'nonpayable', params: [{ name: 'srcChainId', type: 'uint32' }, { name: 'srcAddress', type: 'bytes' }, { name: 'nonce', type: 'uint64' }] },
      { sig: 'supportedChains()', type: 'read', mutability: 'view', params: [] },
      { sig: 'messageCount()', type: 'read', mutability: 'view', params: [] },
      { sig: 'pendingMessages()', type: 'read', mutability: 'view', params: [] },
    ],
  },
]

// ============ Audit Data ============

const AUDITS = [
  {
    auditor: 'Trail of Bits',
    date: 'January 2026',
    scope: 'CommitRevealAuction, VibeSwapCore, CircuitBreaker',
    findings: { critical: 0, high: 0, medium: 2, low: 5, informational: 8 },
    status: 'resolved',
    statusColor: '#22c55e',
    reportLink: '#',
    summary: 'All medium findings addressed in v1.1.0. Commit-reveal mechanism validated against MEV extraction. Fisher-Yates shuffle verified for uniform randomness.',
  },
  {
    auditor: 'OpenZeppelin',
    date: 'February 2026',
    scope: 'VibeAMM, VibeLP, ShapleyDistributor',
    findings: { critical: 0, high: 1, medium: 1, low: 3, informational: 6 },
    status: 'resolved',
    statusColor: '#22c55e',
    reportLink: '#',
    summary: 'High finding: reentrancy vector in removeLiquidity — fixed with nonReentrant guard. Shapley calculation gas optimization recommended and implemented.',
  },
  {
    auditor: 'Spearbit',
    date: 'March 2026',
    scope: 'CrossChainRouter, LayerZero integration, full protocol',
    findings: { critical: 0, high: 0, medium: 0, low: 2, informational: 4 },
    status: 'in-review',
    statusColor: '#f59e0b',
    reportLink: '#',
    summary: 'Clean audit of cross-chain messaging layer. LayerZero V2 OApp pattern correctly implemented. Pending final review of gas estimation edge cases.',
  },
]

// ============ Write Function Configs ============

const WRITE_FUNCTIONS = [
  {
    id: 'approve',
    name: 'approve',
    contract: 'VibeSwapCore',
    description: 'Approve token spending allowance for the protocol',
    params: [
      { name: 'spender', type: 'address', placeholder: '0x1D3E...6D8 (VibeSwapCore)' },
      { name: 'amount', type: 'uint256', placeholder: 'Amount in wei (e.g., 1000000000000000000)' },
    ],
  },
  {
    id: 'swap',
    name: 'swap',
    contract: 'VibeSwapCore',
    description: 'Execute a swap through the optimal route (AMM or batch auction)',
    params: [
      { name: 'tokenIn', type: 'address', placeholder: 'Input token address' },
      { name: 'tokenOut', type: 'address', placeholder: 'Output token address' },
      { name: 'amountIn', type: 'uint256', placeholder: 'Input amount in wei' },
      { name: 'minOut', type: 'uint256', placeholder: 'Minimum output (slippage protection)' },
      { name: 'deadline', type: 'uint256', placeholder: 'Unix timestamp deadline' },
    ],
  },
  {
    id: 'addLiquidity',
    name: 'addLiquidity',
    contract: 'VibeAMM',
    description: 'Provide liquidity to a trading pair and receive LP tokens',
    params: [
      { name: 'tokenA', type: 'address', placeholder: 'First token address' },
      { name: 'tokenB', type: 'address', placeholder: 'Second token address' },
      { name: 'amountA', type: 'uint256', placeholder: 'Amount of token A in wei' },
      { name: 'amountB', type: 'uint256', placeholder: 'Amount of token B in wei' },
      { name: 'minLP', type: 'uint256', placeholder: 'Minimum LP tokens to receive' },
    ],
  },
]

// ============ Section Wrapper ============

function Section({ index, title, subtitle, children }) {
  return (
    <motion.div custom={index} variants={sectionV} initial="hidden" animate="visible">
      <GlassCard glowColor="terminal" spotlight hover={false} className="p-5 md:p-6">
        <div className="mb-4">
          <h2 className="text-sm font-mono font-bold tracking-wider uppercase" style={{ color: CYAN }}>{title}</h2>
          {subtitle && <p className="text-[11px] font-mono text-black-400 mt-1 italic">{subtitle}</p>}
          <div className="h-px mt-3" style={{ background: `linear-gradient(90deg, ${CYAN}40, transparent)` }} />
        </div>
        {children}
      </GlassCard>
    </motion.div>
  )
}

// ============ Contract List Card ============

function ContractCard({ contract, index, isSelected, onSelect }) {
  const rng = seededRandom(index * 1337)
  const gasUsed = Math.floor(rng() * 500000 + 200000)

  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 0.1 + index * (0.08 * PHI), duration: 0.4, ease }}
    >
      <button
        onClick={() => onSelect(contract.id)}
        className="w-full text-left rounded-xl p-4 transition-all"
        style={{
          background: isSelected ? `${CYAN}08` : 'rgba(0,0,0,0.3)',
          border: isSelected ? `1px solid ${CYAN}40` : '1px solid rgba(255,255,255,0.04)',
          boxShadow: isSelected ? `0 0 20px ${CYAN}10` : 'none',
        }}
      >
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-2">
            <div className="w-2 h-2 rounded-full" style={{ backgroundColor: contract.verified ? '#22c55e' : '#f59e0b' }} />
            <h3 className="text-[12px] font-mono font-bold text-white">{contract.name}</h3>
          </div>
          <span
            className="text-[9px] font-mono px-2 py-0.5 rounded-full"
            style={{
              background: `${contract.chainColor}15`,
              border: `1px solid ${contract.chainColor}30`,
              color: contract.chainColor,
            }}
          >
            {contract.chain}
          </span>
        </div>
        <div className="flex items-center gap-2 mb-2">
          <span className="text-[10px] font-mono text-black-400">{truncAddr(contract.address)}</span>
          <span
            className="text-[8px] font-mono px-1.5 py-0.5 rounded"
            style={{
              background: contract.verified ? 'rgba(34,197,94,0.1)' : 'rgba(245,158,11,0.1)',
              border: `1px solid ${contract.verified ? 'rgba(34,197,94,0.2)' : 'rgba(245,158,11,0.2)'}`,
              color: contract.verified ? '#22c55e' : '#f59e0b',
            }}
          >
            {contract.verified ? 'Verified' : 'Pending'}
          </span>
          <span className="text-[8px] font-mono text-black-500">{contract.proxy}</span>
        </div>
        <p className="text-[10px] font-mono text-black-400 leading-relaxed line-clamp-2">{contract.description}</p>
        <div className="flex items-center justify-between mt-2 pt-2" style={{ borderTop: '1px solid rgba(255,255,255,0.04)' }}>
          <span className="text-[9px] font-mono text-black-500">Gas: ~{(gasUsed / 1000).toFixed(0)}k</span>
          <span className="text-[9px] font-mono text-black-500">{contract.compiler}</span>
        </div>
      </button>
    </motion.div>
  )
}

// ============ Read Function Row ============

function ReadFunctionRow({ fn, index }) {
  const [expanded, setExpanded] = useState(false)

  return (
    <motion.div
      initial={{ opacity: 0, x: -8 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ delay: 0.05 + index * (0.04 * PHI), duration: 0.3, ease }}
    >
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full text-left rounded-lg p-3 transition-all"
        style={{
          background: expanded ? `${CYAN}06` : 'rgba(0,0,0,0.3)',
          border: expanded ? `1px solid ${CYAN}20` : '1px solid rgba(255,255,255,0.04)',
        }}
      >
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="text-[9px] font-mono px-1.5 py-0.5 rounded" style={{ background: 'rgba(34,197,94,0.1)', border: '1px solid rgba(34,197,94,0.2)', color: '#22c55e' }}>view</span>
            <span className="text-[11px] font-mono font-bold text-white">{fn.name}</span>
            <span className="text-[10px] font-mono text-black-500">({fn.params.join(', ')})</span>
          </div>
          <span className="text-[10px] font-mono" style={{ color: CYAN }}>{expanded ? '-' : '+'}</span>
        </div>
        {expanded && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            className="mt-2 pt-2"
            style={{ borderTop: '1px solid rgba(255,255,255,0.04)' }}
          >
            <div className="flex items-center justify-between">
              <span className="text-[9px] font-mono text-black-500">Returns: {fn.returns}</span>
              <span className="text-[10px] font-mono font-bold" style={{ color: CYAN }}>{fn.result}</span>
            </div>
          </motion.div>
        )}
      </button>
    </motion.div>
  )
}

// ============ Write Function Form ============

function WriteFunctionForm({ fn, isConnected }) {
  const [params, setParams] = useState(() => fn.params.reduce((acc, p) => ({ ...acc, [p.name]: '' }), {}))
  const [status, setStatus] = useState(null)

  const handleSubmit = (e) => {
    e.preventDefault()
    if (!isConnected) {
      setStatus({ type: 'error', message: 'Connect wallet to execute transactions' })
      return
    }
    const empty = fn.params.find((p) => !params[p.name])
    if (empty) {
      setStatus({ type: 'error', message: `Missing required parameter: ${empty.name}` })
      return
    }
    setStatus({ type: 'pending', message: 'Simulating transaction...' })
    setTimeout(() => {
      setStatus({ type: 'success', message: 'Transaction simulated successfully (demo mode)' })
    }, 1500)
  }

  return (
    <form onSubmit={handleSubmit} className="rounded-xl p-4" style={{ background: 'rgba(0,0,0,0.3)', border: '1px solid rgba(255,255,255,0.04)' }}>
      <div className="flex items-center gap-2 mb-2">
        <span className="text-[9px] font-mono px-1.5 py-0.5 rounded" style={{ background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.2)', color: '#ef4444' }}>write</span>
        <h4 className="text-[11px] font-mono font-bold text-white">{fn.name}</h4>
        <span className="text-[9px] font-mono text-black-500 ml-auto">{fn.contract}</span>
      </div>
      <p className="text-[10px] font-mono text-black-400 mb-3">{fn.description}</p>
      <div className="space-y-2">
        {fn.params.map((p) => (
          <div key={p.name}>
            <label className="block text-[9px] font-mono text-black-500 uppercase tracking-wider mb-1">
              {p.name} <span className="text-black-600">({p.type})</span>
            </label>
            <input
              type="text"
              value={params[p.name]}
              onChange={(e) => setParams((prev) => ({ ...prev, [p.name]: e.target.value }))}
              placeholder={p.placeholder}
              className="w-full text-[10px] font-mono rounded-lg px-3 py-2 outline-none transition-all"
              style={{
                background: 'rgba(0,0,0,0.4)',
                border: '1px solid rgba(255,255,255,0.06)',
                color: 'white',
              }}
              onFocus={(e) => { e.target.style.borderColor = `${CYAN}40` }}
              onBlur={(e) => { e.target.style.borderColor = 'rgba(255,255,255,0.06)' }}
            />
          </div>
        ))}
      </div>
      <div className="flex items-center gap-3 mt-3">
        <button
          type="submit"
          className="text-[10px] font-mono font-bold px-4 py-2 rounded-lg transition-all"
          style={{
            background: isConnected ? `${CYAN}15` : 'rgba(255,255,255,0.03)',
            border: `1px solid ${isConnected ? `${CYAN}40` : 'rgba(255,255,255,0.06)'}`,
            color: isConnected ? CYAN : 'rgba(255,255,255,0.2)',
            cursor: isConnected ? 'pointer' : 'not-allowed',
          }}
        >
          {isConnected ? 'Simulate' : 'Connect Wallet'}
        </button>
        {status && (
          <motion.span
            initial={{ opacity: 0, x: -8 }}
            animate={{ opacity: 1, x: 0 }}
            className="text-[9px] font-mono"
            style={{
              color: status.type === 'success' ? '#22c55e' : status.type === 'error' ? '#ef4444' : '#f59e0b',
            }}
          >
            {status.message}
          </motion.span>
        )}
      </div>
    </form>
  )
}

// ============ Event Log Row ============

function EventLogRow({ event, index }) {
  return (
    <motion.div
      initial={{ opacity: 0, x: -12 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ delay: 0.05 + index * (0.06 * PHI), duration: 0.3, ease }}
      className="flex items-start gap-3 pl-1"
    >
      <div
        className="flex-shrink-0 w-5 h-5 rounded-full flex items-center justify-center mt-0.5 z-10"
        style={{ background: `${CYAN}12`, border: `1.5px solid ${CYAN}40` }}
      >
        <div className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: CYAN }} />
      </div>
      <div
        className="flex-1 rounded-lg p-3"
        style={{ background: 'rgba(0,0,0,0.3)', border: `1px solid ${CYAN}10` }}
      >
        <div className="flex items-center justify-between mb-1">
          <span className="text-[11px] font-mono font-bold" style={{ color: CYAN }}>{event.name}</span>
          <span className="text-[9px] font-mono text-black-500">Block {event.block.toLocaleString()}</span>
        </div>
        <p className="text-[10px] font-mono text-black-400">{event.args}</p>
        <p className="text-[9px] font-mono text-black-500 mt-1">{formatTimestamp(event.timestamp)}</p>
      </div>
    </motion.div>
  )
}

// ============ ABI Function Row ============

function ABIFunctionRow({ fn, index }) {
  const [expanded, setExpanded] = useState(false)
  const isWrite = fn.type === 'write'

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 0.03 + index * (0.03 * PHI), duration: 0.25, ease }}
    >
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full text-left rounded-lg p-2.5 transition-all"
        style={{
          background: expanded ? 'rgba(0,0,0,0.4)' : 'rgba(0,0,0,0.2)',
          border: expanded ? `1px solid ${CYAN}15` : '1px solid rgba(255,255,255,0.03)',
        }}
      >
        <div className="flex items-center gap-2">
          <span
            className="text-[8px] font-mono px-1.5 py-0.5 rounded flex-shrink-0"
            style={{
              background: isWrite ? 'rgba(239,68,68,0.1)' : 'rgba(34,197,94,0.1)',
              border: `1px solid ${isWrite ? 'rgba(239,68,68,0.2)' : 'rgba(34,197,94,0.2)'}`,
              color: isWrite ? '#ef4444' : '#22c55e',
            }}
          >
            {fn.mutability}
          </span>
          <span className="text-[10px] font-mono text-white font-bold truncate">{fn.sig}</span>
          <span className="text-[10px] font-mono ml-auto flex-shrink-0" style={{ color: CYAN }}>{expanded ? '-' : '+'}</span>
        </div>
        {expanded && fn.params.length > 0 && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            className="mt-2 pt-2 space-y-1"
            style={{ borderTop: '1px solid rgba(255,255,255,0.04)' }}
          >
            {fn.params.map((p, pi) => (
              <div key={pi} className="flex items-center gap-2 pl-2">
                <span className="text-[9px] font-mono text-black-500">{pi}:</span>
                <span className="text-[9px] font-mono" style={{ color: CYAN }}>{p.type}</span>
                <span className="text-[9px] font-mono text-black-400">{p.name}</span>
              </div>
            ))}
          </motion.div>
        )}
      </button>
    </motion.div>
  )
}

// ============ Audit Card ============

function AuditCard({ audit, index }) {
  const totalFindings = audit.findings.critical + audit.findings.high + audit.findings.medium + audit.findings.low + audit.findings.informational
  const severityColors = { critical: '#ef4444', high: '#f97316', medium: '#f59e0b', low: '#3b82f6', informational: '#6b7280' }

  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 0.15 + index * (0.1 * PHI), duration: 0.4, ease }}
      className="rounded-xl p-4"
      style={{ background: 'rgba(0,0,0,0.3)', border: '1px solid rgba(255,255,255,0.04)' }}
    >
      <div className="flex items-center justify-between mb-3">
        <div>
          <h4 className="text-[12px] font-mono font-bold text-white">{audit.auditor}</h4>
          <p className="text-[9px] font-mono text-black-500">{audit.date}</p>
        </div>
        <span
          className="text-[9px] font-mono font-bold px-2 py-0.5 rounded-full uppercase tracking-wider"
          style={{
            background: `${audit.statusColor}10`,
            border: `1px solid ${audit.statusColor}30`,
            color: audit.statusColor,
          }}
        >
          {audit.status}
        </span>
      </div>
      <p className="text-[9px] font-mono text-black-500 uppercase tracking-wider mb-2">Scope: {audit.scope}</p>

      {/* Findings bar */}
      <div className="mb-3">
        <div className="flex items-center gap-1 h-2 rounded-full overflow-hidden" style={{ background: 'rgba(255,255,255,0.04)' }}>
          {Object.entries(audit.findings).map(([severity, count]) => {
            if (count === 0) return null
            const pct = (count / totalFindings) * 100
            return (
              <motion.div
                key={severity}
                initial={{ width: 0 }}
                animate={{ width: `${pct}%` }}
                transition={{ duration: 0.8, delay: 0.3, ease: 'easeOut' }}
                className="h-full"
                style={{ backgroundColor: severityColors[severity] }}
              />
            )
          })}
        </div>
        <div className="flex items-center gap-3 mt-2 flex-wrap">
          {Object.entries(audit.findings).map(([severity, count]) => (
            <div key={severity} className="flex items-center gap-1">
              <div className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: severityColors[severity] }} />
              <span className="text-[8px] font-mono text-black-500 capitalize">{severity}</span>
              <span className="text-[9px] font-mono font-bold" style={{ color: severityColors[severity] }}>{count}</span>
            </div>
          ))}
        </div>
      </div>

      <p className="text-[10px] font-mono text-black-400 leading-relaxed mb-3">{audit.summary}</p>

      <a
        href={audit.reportLink}
        className="inline-flex items-center gap-1.5 text-[9px] font-mono font-bold px-3 py-1.5 rounded-lg transition-all"
        style={{
          background: `${CYAN}08`,
          border: `1px solid ${CYAN}20`,
          color: CYAN,
        }}
      >
        View Full Report
        <span style={{ fontSize: '10px' }}>&rarr;</span>
      </a>
    </motion.div>
  )
}

// ============ Main Component ============

export default function SmartContractPage() {
  const { isConnected: isExternalConnected } = useWallet()
  const { isConnected: isDeviceConnected } = useDeviceWallet()
  const isConnected = isExternalConnected || isDeviceConnected

  const [selectedContract, setSelectedContract] = useState(CONTRACTS[0].id)
  const [activeTab, setActiveTab] = useState('read')
  const [expandedAbiCategory, setExpandedAbiCategory] = useState(null)
  const [eventFilter, setEventFilter] = useState('')
  const [writeFnIndex, setWriteFnIndex] = useState(0)

  const contract = useMemo(
    () => CONTRACTS.find((c) => c.id === selectedContract) || CONTRACTS[0],
    [selectedContract]
  )

  // Aggregate all events across contracts, sorted by block desc
  const allEvents = useMemo(() => {
    const events = CONTRACTS.flatMap((c) =>
      c.events.map((e) => ({ ...e, contractName: c.name }))
    )
    events.sort((a, b) => b.block - a.block)
    return events
  }, [])

  const filteredEvents = useMemo(() => {
    if (!eventFilter) return allEvents
    const lower = eventFilter.toLowerCase()
    return allEvents.filter(
      (e) =>
        e.name.toLowerCase().includes(lower) ||
        e.contractName.toLowerCase().includes(lower) ||
        e.args.toLowerCase().includes(lower)
    )
  }, [allEvents, eventFilter])

  const rng = useMemo(() => seededRandom(42), [])
  const particlePositions = useMemo(() => {
    return Array.from({ length: 12 }).map(() => ({
      left: `${rng() * 100}%`,
      top: `${rng() * 100}%`,
      duration: 3 + rng() * 3,
      delay: rng() * 4,
      y: -(30 + rng() * 30),
    }))
  }, [rng])

  const tabs = [
    { id: 'read', label: 'Read' },
    { id: 'write', label: 'Write' },
    { id: 'events', label: 'Events' },
  ]

  return (
    <div className="min-h-screen pb-20">
      {/* ============ Background Particles ============ */}
      <div className="fixed inset-0 pointer-events-none overflow-hidden z-0">
        {particlePositions.map((p, i) => (
          <motion.div
            key={i}
            className="absolute w-px h-px rounded-full"
            style={{ background: CYAN, left: p.left, top: p.top }}
            animate={{ opacity: [0, 0.2, 0], scale: [0, 1.5, 0], y: [0, p.y] }}
            transition={{ duration: p.duration, repeat: Infinity, delay: p.delay, ease: 'easeOut' }}
          />
        ))}
      </div>

      <div className="relative z-10 max-w-5xl mx-auto px-4 pt-2">
        {/* ============ Page Hero ============ */}
        <PageHero
          title="Smart Contracts"
          category="ecosystem"
          subtitle="Explore and interact with VibeSwap contracts"
          badge="5 Deployed"
          badgeColor="#22c55e"
        />

        <div className="space-y-6">
          {/* ============ Contract List ============ */}
          <Section index={0} title="Deployed Contracts" subtitle="Browse all verified VibeSwap smart contracts">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {CONTRACTS.map((c, i) => (
                <ContractCard
                  key={c.id}
                  contract={c}
                  index={i}
                  isSelected={selectedContract === c.id}
                  onSelect={setSelectedContract}
                />
              ))}
            </div>
            <div className="mt-4 rounded-lg p-3" style={{ background: 'rgba(0,0,0,0.3)', border: `1px solid ${CYAN}10` }}>
              <div className="flex items-center gap-2">
                <div className="w-2 h-2 rounded-full" style={{ backgroundColor: '#22c55e' }} />
                <span className="text-[10px] font-mono text-black-400">
                  All contracts use <span className="text-white font-bold">UUPS (EIP-1967)</span> upgradeable proxy pattern with OpenZeppelin v5.0.1
                </span>
              </div>
            </div>
          </Section>

          {/* ============ Contract Reader / Writer ============ */}
          <Section
            index={1}
            title={`${contract.name}`}
            subtitle={`${truncAddr(contract.address)} on ${contract.chain} — ${contract.verified ? 'Source Verified' : 'Pending Verification'}`}
          >
            {/* Tab Bar */}
            <div className="flex items-center gap-1 mb-4 rounded-lg p-1" style={{ background: 'rgba(0,0,0,0.3)' }}>
              {tabs.map((tab) => (
                <button
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id)}
                  className="flex-1 text-[10px] font-mono font-bold py-2 rounded-md transition-all uppercase tracking-wider"
                  style={{
                    background: activeTab === tab.id ? `${CYAN}12` : 'transparent',
                    border: activeTab === tab.id ? `1px solid ${CYAN}25` : '1px solid transparent',
                    color: activeTab === tab.id ? CYAN : 'rgba(255,255,255,0.3)',
                  }}
                >
                  {tab.label}
                </button>
              ))}
            </div>

            {/* Read Functions */}
            {activeTab === 'read' && (
              <div className="space-y-2">
                {contract.readFunctions.map((fn, i) => (
                  <ReadFunctionRow key={fn.name} fn={fn} index={i} />
                ))}
                {contract.readFunctions.length === 0 && (
                  <p className="text-[10px] font-mono text-black-500 text-center py-6">No read functions available</p>
                )}
              </div>
            )}

            {/* Write Functions */}
            {activeTab === 'write' && (
              <div className="space-y-3">
                {contract.writeFunctions.map((fn, i) => {
                  const writeFn = {
                    id: fn.name,
                    name: fn.name,
                    contract: contract.name,
                    description: fn.description,
                    params: fn.params.map((p) => {
                      const parts = p.split(' ')
                      return { name: parts[parts.length - 1], type: parts.slice(0, -1).join(' '), placeholder: `Enter ${parts[parts.length - 1]}` }
                    }),
                  }
                  return <WriteFunctionForm key={fn.name} fn={writeFn} isConnected={isConnected} />
                })}
                {!isConnected && (
                  <div className="rounded-lg p-3 mt-2" style={{ background: 'rgba(245,158,11,0.05)', border: '1px solid rgba(245,158,11,0.15)' }}>
                    <p className="text-[10px] font-mono text-amber-400">
                      Connect a wallet to simulate write transactions. All executions run in demo mode.
                    </p>
                  </div>
                )}
              </div>
            )}

            {/* Events */}
            {activeTab === 'events' && (
              <div>
                <div className="relative mb-3">
                  <div className="absolute left-3 top-2 bottom-2 w-px" style={{ background: `linear-gradient(180deg, ${CYAN}40, transparent)` }} />
                  <div className="space-y-2">
                    {contract.events.map((event, i) => (
                      <EventLogRow key={`${event.name}-${event.block}`} event={event} index={i} />
                    ))}
                    {contract.events.length === 0 && (
                      <p className="text-[10px] font-mono text-black-500 text-center py-6">No recent events</p>
                    )}
                  </div>
                </div>
              </div>
            )}
          </Section>

          {/* ============ Write Functions (Dedicated) ============ */}
          <Section index={2} title="Execute Functions" subtitle="Submit transactions to VibeSwap contracts (demo mode)">
            {/* Function selector */}
            <div className="flex items-center gap-2 mb-4 flex-wrap">
              {WRITE_FUNCTIONS.map((fn, i) => (
                <button
                  key={fn.id}
                  onClick={() => setWriteFnIndex(i)}
                  className="text-[10px] font-mono font-bold px-3 py-1.5 rounded-lg transition-all"
                  style={{
                    background: writeFnIndex === i ? `${CYAN}12` : 'rgba(0,0,0,0.3)',
                    border: `1px solid ${writeFnIndex === i ? `${CYAN}30` : 'rgba(255,255,255,0.04)'}`,
                    color: writeFnIndex === i ? CYAN : 'rgba(255,255,255,0.4)',
                  }}
                >
                  {fn.name}()
                </button>
              ))}
            </div>
            <WriteFunctionForm fn={WRITE_FUNCTIONS[writeFnIndex]} isConnected={isConnected} />
            <div className="mt-4 rounded-lg p-3" style={{ background: 'rgba(0,0,0,0.3)', border: '1px solid rgba(255,255,255,0.04)' }}>
              <p className="text-[9px] font-mono text-black-500 uppercase tracking-wider mb-1">Transaction Safety</p>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 mt-2">
                {[
                  { label: 'Simulation', desc: 'All txns simulated before broadcast', color: '#22c55e' },
                  { label: 'Gas Estimation', desc: 'Automatic gas limit with 20% buffer', color: '#3b82f6' },
                  { label: 'Slippage Guard', desc: 'Reverts if output below minimum', color: '#a855f7' },
                ].map((item) => (
                  <div key={item.label} className="flex items-start gap-2 rounded-lg p-2" style={{ background: `${item.color}06`, border: `1px solid ${item.color}12` }}>
                    <div className="w-1.5 h-1.5 rounded-full mt-1 flex-shrink-0" style={{ backgroundColor: item.color }} />
                    <div>
                      <p className="text-[9px] font-mono font-bold text-white">{item.label}</p>
                      <p className="text-[8px] font-mono text-black-500">{item.desc}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </Section>

          {/* ============ Event Logs ============ */}
          <Section index={3} title="Event Logs" subtitle="Recent events emitted across all VibeSwap contracts">
            <div className="mb-3">
              <input
                type="text"
                value={eventFilter}
                onChange={(e) => setEventFilter(e.target.value)}
                placeholder="Filter events by name, contract, or args..."
                className="w-full text-[10px] font-mono rounded-lg px-3 py-2 outline-none transition-all"
                style={{
                  background: 'rgba(0,0,0,0.4)',
                  border: '1px solid rgba(255,255,255,0.06)',
                  color: 'white',
                }}
                onFocus={(e) => { e.target.style.borderColor = `${CYAN}40` }}
                onBlur={(e) => { e.target.style.borderColor = 'rgba(255,255,255,0.06)' }}
              />
            </div>
            <div className="relative">
              <div className="absolute left-3 top-2 bottom-2 w-px" style={{ background: `linear-gradient(180deg, ${CYAN}30, transparent)` }} />
              <div className="space-y-2">
                {filteredEvents.map((event, i) => (
                  <motion.div
                    key={`${event.contractName}-${event.name}-${event.block}`}
                    initial={{ opacity: 0, x: -12 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ delay: 0.05 + i * (0.05 * PHI), duration: 0.3, ease }}
                    className="flex items-start gap-3 pl-1"
                  >
                    <div
                      className="flex-shrink-0 w-5 h-5 rounded-full flex items-center justify-center mt-0.5 z-10"
                      style={{ background: `${CYAN}12`, border: `1.5px solid ${CYAN}40` }}
                    >
                      <div className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: CYAN }} />
                    </div>
                    <div
                      className="flex-1 rounded-lg p-3"
                      style={{ background: 'rgba(0,0,0,0.3)', border: `1px solid ${CYAN}10` }}
                    >
                      <div className="flex items-center justify-between mb-1">
                        <div className="flex items-center gap-2">
                          <span className="text-[11px] font-mono font-bold" style={{ color: CYAN }}>{event.name}</span>
                          <span className="text-[8px] font-mono px-1.5 py-0.5 rounded" style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.06)', color: 'rgba(255,255,255,0.5)' }}>
                            {event.contractName}
                          </span>
                        </div>
                        <span className="text-[9px] font-mono text-black-500">Block {event.block.toLocaleString()}</span>
                      </div>
                      <p className="text-[10px] font-mono text-black-400">{event.args}</p>
                      <p className="text-[9px] font-mono text-black-500 mt-1">{formatTimestamp(event.timestamp)}</p>
                    </div>
                  </motion.div>
                ))}
                {filteredEvents.length === 0 && (
                  <p className="text-[10px] font-mono text-black-500 text-center py-6 pl-8">No events match the current filter</p>
                )}
              </div>
            </div>
          </Section>

          {/* ============ ABI Browser ============ */}
          <Section index={4} title="ABI Browser" subtitle="Expandable function signatures with parameter types">
            <div className="space-y-3">
              {ABI_DATA.map((category, ci) => {
                const isExpanded = expandedAbiCategory === category.category
                const readCount = category.functions.filter((f) => f.type === 'read').length
                const writeCount = category.functions.filter((f) => f.type === 'write').length

                return (
                  <div key={category.category}>
                    <button
                      onClick={() => setExpandedAbiCategory(isExpanded ? null : category.category)}
                      className="w-full text-left rounded-xl p-3 transition-all"
                      style={{
                        background: isExpanded ? `${CYAN}06` : 'rgba(0,0,0,0.3)',
                        border: isExpanded ? `1px solid ${CYAN}20` : '1px solid rgba(255,255,255,0.04)',
                      }}
                    >
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <span className="text-[11px] font-mono font-bold text-white">{category.category}</span>
                          <span className="text-[9px] font-mono text-black-500">{category.functions.length} functions</span>
                        </div>
                        <div className="flex items-center gap-2">
                          <span className="text-[8px] font-mono px-1.5 py-0.5 rounded" style={{ background: 'rgba(34,197,94,0.1)', color: '#22c55e' }}>{readCount} read</span>
                          <span className="text-[8px] font-mono px-1.5 py-0.5 rounded" style={{ background: 'rgba(239,68,68,0.1)', color: '#ef4444' }}>{writeCount} write</span>
                          <span className="text-[10px] font-mono" style={{ color: CYAN }}>{isExpanded ? '-' : '+'}</span>
                        </div>
                      </div>
                    </button>
                    {isExpanded && (
                      <motion.div
                        initial={{ opacity: 0, height: 0 }}
                        animate={{ opacity: 1, height: 'auto' }}
                        className="mt-1 pl-3 space-y-1"
                      >
                        {category.functions.map((fn, fi) => (
                          <ABIFunctionRow key={fn.sig} fn={fn} index={fi} />
                        ))}
                      </motion.div>
                    )}
                  </div>
                )
              })}
            </div>
            <div className="mt-4 rounded-lg p-3" style={{ background: 'rgba(0,0,0,0.3)', border: `1px solid ${CYAN}10` }}>
              <p className="text-[10px] font-mono text-black-400">
                <span className="text-white font-bold">Function selectors</span> are computed as the first 4 bytes of keccak256 of the function signature.
                All ABIs follow the <span style={{ color: CYAN }}>Solidity v0.8.20</span> ABI encoding specification.
              </p>
            </div>
          </Section>

          {/* ============ Audit Status ============ */}
          <Section index={5} title="Audit Status" subtitle="Security audit results from leading firms">
            <div className="space-y-4">
              {AUDITS.map((audit, i) => (
                <AuditCard key={audit.auditor} audit={audit} index={i} />
              ))}
            </div>

            {/* Audit Summary */}
            <div className="mt-4 rounded-xl p-4" style={{ background: 'rgba(0,0,0,0.3)', border: `1px solid ${CYAN}12` }}>
              <h4 className="text-[11px] font-mono font-bold text-white mb-3">Security Summary</h4>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                {[
                  { label: 'Critical Findings', value: '0', color: '#22c55e' },
                  { label: 'Audits Completed', value: '2 / 3', color: CYAN },
                  { label: 'Lines Audited', value: '~4,200', color: '#a855f7' },
                  { label: 'Bug Bounty', value: '$250K', color: '#f59e0b' },
                ].map((stat) => (
                  <div key={stat.label} className="rounded-lg p-3 text-center" style={{ background: `${stat.color}06`, border: `1px solid ${stat.color}12` }}>
                    <p className="text-lg font-mono font-bold" style={{ color: stat.color }}>{stat.value}</p>
                    <p className="text-[8px] font-mono text-black-500 uppercase tracking-wider mt-1">{stat.label}</p>
                  </div>
                ))}
              </div>
              <div className="mt-3 rounded-lg p-3" style={{ background: 'rgba(0,0,0,0.3)', border: '1px solid rgba(255,255,255,0.04)' }}>
                <p className="text-[10px] font-mono text-black-400 leading-relaxed">
                  <span className="text-white font-bold">Security philosophy:</span> VibeSwap follows defense-in-depth with circuit breakers,
                  flash loan protection (EOA-only commits), TWAP validation (max 5% deviation), rate limiting (1M tokens/hour/user),
                  and 50% slashing for invalid reveals. All contracts use <span style={{ color: CYAN }}>OpenZeppelin v5.0.1</span> patterns
                  with <span style={{ color: CYAN }}>nonReentrant</span> guards on every state-changing function.
                </p>
              </div>
            </div>

            {/* Bug Bounty */}
            <div className="mt-4 rounded-xl p-4" style={{ background: 'rgba(245,158,11,0.04)', border: '1px solid rgba(245,158,11,0.15)' }}>
              <div className="flex items-center gap-2 mb-2">
                <div className="w-6 h-6 rounded-md flex items-center justify-center text-[10px] font-mono font-bold"
                  style={{ background: 'rgba(245,158,11,0.1)', border: '1px solid rgba(245,158,11,0.3)', color: '#f59e0b' }}>$</div>
                <h4 className="text-xs font-mono font-bold text-amber-400">Bug Bounty Program</h4>
              </div>
              <p className="text-[10px] font-mono text-black-400 leading-relaxed mb-3">
                Up to <span className="text-amber-400 font-bold">$250,000</span> for critical vulnerabilities.
                Scope includes all deployed contracts, cross-chain messaging, and oracle integrations.
              </p>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                {[
                  { severity: 'Critical', reward: '$100K - $250K', color: '#ef4444' },
                  { severity: 'High', reward: '$25K - $100K', color: '#f97316' },
                  { severity: 'Medium', reward: '$5K - $25K', color: '#f59e0b' },
                  { severity: 'Low', reward: '$1K - $5K', color: '#3b82f6' },
                ].map((tier) => (
                  <div key={tier.severity} className="rounded-lg p-2 text-center" style={{ background: `${tier.color}06`, border: `1px solid ${tier.color}15` }}>
                    <p className="text-[9px] font-mono font-bold uppercase" style={{ color: tier.color }}>{tier.severity}</p>
                    <p className="text-[10px] font-mono text-black-400 mt-0.5">{tier.reward}</p>
                  </div>
                ))}
              </div>
            </div>
          </Section>
        </div>

        {/* ============ Footer ============ */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 1.2 * PHI }}
          className="mt-12 mb-8 text-center"
        >
          <blockquote className="max-w-lg mx-auto">
            <p className="text-sm text-black-300 italic font-mono">"Code is law, but only when the code is audited, verified, and open for all to read."</p>
          </blockquote>
          <div className="w-16 h-px mx-auto my-4" style={{ background: `linear-gradient(90deg, transparent, ${CYAN}40, transparent)` }} />
          <p className="text-[10px] font-mono text-black-500 tracking-widest uppercase">VibeSwap Smart Contract Explorer</p>
          <div className="flex items-center justify-center gap-4 mt-3">
            <Link to="/docs" className="text-[9px] font-mono transition-colors" style={{ color: `${CYAN}80` }}>Documentation</Link>
            <Link to="/security" className="text-[9px] font-mono transition-colors" style={{ color: `${CYAN}80` }}>Security</Link>
            <Link to="/circuit-breaker" className="text-[9px] font-mono transition-colors" style={{ color: `${CYAN}80` }}>Circuit Breakers</Link>
          </div>
        </motion.div>
      </div>
    </div>
  )
}
