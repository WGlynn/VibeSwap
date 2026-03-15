import { useState, useMemo } from 'react'
import { motion } from 'framer-motion'
import { useWallet } from '../hooks/useWallet'
import { useDeviceWallet } from '../hooks/useDeviceWallet'
import { useBalances } from '../hooks/useBalances'
import { usePriceFeed } from '../hooks/usePriceFeed'
import GlassCard from './ui/GlassCard'
import PageHero from './ui/PageHero'
import StatCard from './ui/StatCard'
import { seededRandom } from '../utils/design-tokens'

// ============================================================
// Wallet Page — Unified view of your on-chain identity
// Balances, transaction history, connected chains, security
// ============================================================

const PHI = 1.618033988749895
const CYAN = '#06b6d4'
const ease = [0.25, 0.1, 0.25, 1]
const sectionV = {
  hidden: { opacity: 0, y: 40, scale: 0.97 },
  visible: (i) => ({ opacity: 1, y: 0, scale: 1, transition: { duration: 0.5, delay: 0.15 + i * (0.1 * PHI), ease } }),
}
const cardV = {
  hidden: { opacity: 0, y: 12 },
  visible: (i) => ({ opacity: 1, y: 0, transition: { duration: 0.4, delay: 0.1 + i * (0.06 * PHI), ease } }),
}

// ============ Token Metadata ============

const rng = seededRandom(7742)

const TOKEN_META = [
  { symbol: 'ETH', name: 'Ethereum', color: '#627eea' },
  { symbol: 'USDC', name: 'USD Coin', color: '#2775ca' },
  { symbol: 'USDT', name: 'Tether', color: '#4ea8a6' },
  { symbol: 'WBTC', name: 'Wrapped BTC', color: '#f7931a' },
  { symbol: 'ARB', name: 'Arbitrum', color: '#28a0f0' },
  { symbol: 'OP', name: 'Optimism', color: '#ff0420' },
]

// Mock data for demo mode only (no wallet connected)
const MOCK_TOKENS = [
  { symbol: 'ETH', name: 'Ethereum', balance: 4.2847, usd: 14996.45, change: 2.4, color: '#627eea' },
  { symbol: 'USDC', name: 'USD Coin', balance: 12450.0, usd: 12450.0, change: 0.01, color: '#2775ca' },
  { symbol: 'VIBE', name: 'VibeSwap', balance: 85000, usd: 4250.0, change: 8.7, color: '#06b6d4' },
  { symbol: 'WBTC', name: 'Wrapped BTC', balance: 0.1834, usd: 12438.6, change: -1.2, color: '#f7931a' },
  { symbol: 'ARB', name: 'Arbitrum', balance: 3200, usd: 3520.0, change: 4.1, color: '#28a0f0' },
  { symbol: 'OP', name: 'Optimism', balance: 1850, usd: 2775.0, change: -0.8, color: '#ff0420' },
  { symbol: 'LINK', name: 'Chainlink', balance: 120, usd: 1800.0, change: 3.2, color: '#2a5ada' },
  { symbol: 'UNI', name: 'Uniswap', balance: 85, usd: 680.0, change: -2.1, color: '#ff007a' },
]

const TRANSACTIONS = [
  { hash: '0x1a2b...3c4d', type: 'Swap', from: 'ETH', to: 'USDC', amount: '1.5 ETH', value: '$5,250', time: '2m ago', status: 'confirmed', chain: 'Base' },
  { hash: '0x5e6f...7g8h', type: 'Bridge', from: 'Base', to: 'Arbitrum', amount: '5,000 USDC', value: '$5,000', time: '14m ago', status: 'confirmed', chain: 'LayerZero' },
  { hash: '0x9i0j...1k2l', type: 'LP Add', from: 'ETH/USDC', to: '', amount: '2.0 ETH + 7,000 USDC', value: '$14,000', time: '1h ago', status: 'confirmed', chain: 'Base' },
  { hash: '0x3m4n...5o6p', type: 'Swap', from: 'VIBE', to: 'ETH', amount: '10,000 VIBE', value: '$500', time: '3h ago', status: 'confirmed', chain: 'Base' },
  { hash: '0x7q8r...9s0t', type: 'Claim', from: 'Rewards', to: '', amount: '250 VIBE', value: '$12.50', time: '6h ago', status: 'confirmed', chain: 'Base' },
  { hash: '0xab1c...de2f', type: 'Swap', from: 'USDC', to: 'WBTC', amount: '12,000 USDC', value: '$12,000', time: '1d ago', status: 'confirmed', chain: 'Ethereum' },
  { hash: '0x3g4h...5i6j', type: 'Stake', from: 'VIBE', to: '', amount: '50,000 VIBE', value: '$2,500', time: '2d ago', status: 'confirmed', chain: 'Base' },
  { hash: '0x7k8l...9m0n', type: 'Bridge', from: 'Ethereum', to: 'Base', amount: '2.0 ETH', value: '$7,000', time: '3d ago', status: 'confirmed', chain: 'LayerZero' },
]

const CHAINS_CONNECTED = [
  { name: 'Base', color: '#3b82f6', balance: '$28,420', status: 'active' },
  { name: 'Ethereum', color: '#627eea', balance: '$18,230', status: 'active' },
  { name: 'Arbitrum', color: '#28a0f0', balance: '$6,840', status: 'active' },
  { name: 'Optimism', color: '#ff0420', balance: '$2,775', status: 'idle' },
  { name: 'Polygon', color: '#8247e5', balance: '$420', status: 'idle' },
  { name: 'CKB', color: '#3cc68a', balance: '$0.00', status: 'available' },
]

const APPROVALS = [
  { protocol: 'VibeSwap Router', token: 'USDC', amount: 'Unlimited', risk: 'low', time: '2 days ago' },
  { protocol: 'VibeSwap Router', token: 'ETH', amount: 'Unlimited', risk: 'low', time: '3 days ago' },
  { protocol: 'Uniswap V3', token: 'USDC', amount: '$50,000', risk: 'medium', time: '14 days ago' },
  { protocol: 'Aave V3', token: 'WBTC', amount: 'Unlimited', risk: 'medium', time: '21 days ago' },
]

const SECURITY_CHECKS = [
  { label: 'Hardware Wallet', status: false, desc: 'Connect a hardware wallet for maximum security' },
  { label: 'Device Wallet', status: true, desc: 'WebAuthn passkey active on this device' },
  { label: 'Transaction Signing', status: true, desc: 'All transactions require explicit approval' },
  { label: 'MEV Protection', status: true, desc: 'Commit-reveal protects every swap from frontrunning' },
  { label: 'Approval Limits', status: false, desc: 'Set max approval amounts for each protocol' },
]

// ============ Subcomponents ============

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

function AllocationBar({ tokens }) {
  const total = tokens.reduce((s, t) => s + t.usd, 0)
  return (
    <div>
      <div className="flex h-3 rounded-full overflow-hidden mb-2" style={{ background: 'rgba(255,255,255,0.04)' }}>
        {tokens.map((t) => (
          <motion.div
            key={t.symbol}
            className="h-full"
            style={{ background: t.color }}
            initial={{ width: 0 }}
            animate={{ width: `${(t.usd / total) * 100}%` }}
            transition={{ duration: 0.8, ease: 'easeOut' }}
            title={`${t.symbol}: $${t.usd.toLocaleString()}`}
          />
        ))}
      </div>
      <div className="flex flex-wrap gap-3">
        {tokens.slice(0, 5).map((t) => (
          <div key={t.symbol} className="flex items-center gap-1.5">
            <div className="w-2 h-2 rounded-full" style={{ background: t.color }} />
            <span className="text-[9px] font-mono text-black-400">{t.symbol} {((t.usd / total) * 100).toFixed(1)}%</span>
          </div>
        ))}
        {tokens.length > 5 && (
          <span className="text-[9px] font-mono text-black-500">+{tokens.length - 5} more</span>
        )}
      </div>
    </div>
  )
}

// ============ Main Component ============

export default function WalletPage() {
  const { isConnected: isExternalConnected, address } = useWallet()
  const { isConnected: isDeviceConnected, address: deviceAddress } = useDeviceWallet()
  const isConnected = isExternalConnected || isDeviceConnected
  const { getBalance, isLoading: balancesLoading } = useBalances()
  const { getPrice, getChange } = usePriceFeed(['ETH', 'USDC', 'USDT', 'WBTC', 'ARB', 'OP'])

  const [txFilter, setTxFilter] = useState('all')
  const [showAllTokens, setShowAllTokens] = useState(false)

  const displayAddress = address || deviceAddress || '0x7f3a...b4c2'

  // Build token list from real balances when wallet connected, mock when not
  const TOKENS = useMemo(() => {
    if (!isConnected) return MOCK_TOKENS
    return TOKEN_META.map(meta => {
      const balance = getBalance(meta.symbol)
      const price = getPrice(meta.symbol)
      const usd = balance * price
      const change = getChange(meta.symbol)
      return { ...meta, balance, usd, change }
    }).filter(t => t.balance > 0 || t.symbol === 'ETH') // Always show ETH, hide zero-balance tokens
  }, [isConnected, getBalance, getPrice, getChange])

  const totalBalance = useMemo(() => TOKENS.reduce((s, t) => s + t.usd, 0), [TOKENS])
  const filteredTx = txFilter === 'all' ? TRANSACTIONS : TRANSACTIONS.filter((t) => t.type.toLowerCase() === txFilter)
  const visibleTokens = showAllTokens ? TOKENS : TOKENS.slice(0, 5)

  if (!isConnected) {
    return (
      <div className="min-h-screen pb-20">
        <PageHero title="Wallet" category="account" subtitle="Your on-chain identity and assets" />
        <div className="max-w-2xl mx-auto px-4 mt-8">
          <GlassCard glowColor="terminal" className="p-8 text-center">
            <div className="text-4xl mb-4">🔒</div>
            <h3 className="text-lg font-bold text-white mb-2">Wallet Not Connected</h3>
            <p className="text-sm font-mono text-black-400 mb-4">
              Connect your wallet to view balances, transactions, and manage your on-chain identity.
            </p>
            <motion.div
              className="inline-block px-4 py-1.5 rounded-full text-xs font-mono"
              style={{ background: `${CYAN}15`, border: `1px solid ${CYAN}30`, color: CYAN }}
              animate={{ opacity: [0.5, 1, 0.5] }}
              transition={{ duration: 2 * PHI, repeat: Infinity }}
            >
              Sign in to continue
            </motion.div>
          </GlassCard>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen pb-20">
      {/* Background */}
      <div className="fixed inset-0 pointer-events-none overflow-hidden z-0">
        {Array.from({ length: 8 }).map((_, i) => (
          <motion.div key={i} className="absolute w-px h-px rounded-full"
            style={{ background: CYAN, left: `${(i * PHI * 19) % 100}%`, top: `${(i * PHI * 29) % 100}%` }}
            animate={{ opacity: [0, 0.2, 0], scale: [0, 1.5, 0], y: [0, -50] }}
            transition={{ duration: 4, repeat: Infinity, delay: i * 0.6, ease: 'easeOut' }} />
        ))}
      </div>

      <div className="relative z-10">
        <PageHero title="Wallet" category="account" subtitle="Your on-chain identity and assets"
          badge={displayAddress} badgeColor={CYAN} />

        <div className="max-w-5xl mx-auto px-4 space-y-6">
          {/* Stats */}
          <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 0.1, ease }}
            className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <StatCard label="Total Balance" value={totalBalance / 1000} prefix="$" suffix="K" decimals={1} sparkSeed={501} change={3.2} />
            <StatCard label="Tokens" value={TOKENS.length} decimals={0} sparkSeed={502} />
            <StatCard label="Chains Active" value={CHAINS_CONNECTED.filter((c) => c.status === 'active').length} decimals={0} sparkSeed={503} />
            <StatCard label="Transactions" value={TRANSACTIONS.length} decimals={0} sparkSeed={504} change={12.0} />
          </motion.div>

          {/* Token Balances */}
          <Section index={0} title="Token Balances" subtitle="Your holdings across all connected chains">
            <AllocationBar tokens={TOKENS} />
            <div className="mt-4 space-y-1.5">
              {visibleTokens.map((t, i) => (
                <motion.div key={t.symbol} custom={i} variants={cardV} initial="hidden" animate="visible"
                  className="flex items-center gap-3 rounded-lg p-3"
                  style={{ background: 'rgba(0,0,0,0.3)', border: '1px solid rgba(255,255,255,0.04)' }}>
                  <div className="w-8 h-8 rounded-full flex items-center justify-center text-[10px] font-mono font-bold flex-shrink-0"
                    style={{ background: `${t.color}18`, border: `1px solid ${t.color}35`, color: t.color }}>
                    {t.symbol.slice(0, 2)}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-mono font-bold text-white">{t.symbol}</span>
                      <span className="text-[10px] font-mono text-black-500">{t.name}</span>
                    </div>
                    <span className="text-[10px] font-mono text-black-400">
                      {t.balance.toLocaleString('en-US', { maximumFractionDigits: 4 })} {t.symbol}
                    </span>
                  </div>
                  <div className="text-right flex-shrink-0">
                    <div className="text-sm font-mono font-bold text-white">
                      ${t.usd.toLocaleString('en-US', { minimumFractionDigits: 2 })}
                    </div>
                    <div className="text-[10px] font-mono" style={{ color: t.change >= 0 ? '#22c55e' : '#ef4444' }}>
                      {t.change >= 0 ? '+' : ''}{t.change}%
                    </div>
                  </div>
                </motion.div>
              ))}
            </div>
            {TOKENS.length > 5 && (
              <button onClick={() => setShowAllTokens(!showAllTokens)}
                className="w-full mt-3 py-2 rounded-lg text-[10px] font-mono text-black-400 hover:text-cyan-400 transition-colors"
                style={{ background: 'rgba(0,0,0,0.2)', border: '1px solid rgba(255,255,255,0.04)' }}>
                {showAllTokens ? 'Show Less' : `Show All ${TOKENS.length} Tokens`}
              </button>
            )}
          </Section>

          {/* Connected Chains */}
          <Section index={1} title="Connected Chains" subtitle="Networks where your wallet is active">
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
              {CHAINS_CONNECTED.map((c, i) => (
                <motion.div key={c.name} custom={i} variants={cardV} initial="hidden" animate="visible"
                  className="rounded-lg p-3" style={{ background: `${c.color}06`, border: `1px solid ${c.color}15` }}>
                  <div className="flex items-center gap-2 mb-2">
                    <div className="w-2 h-2 rounded-full" style={{
                      background: c.status === 'active' ? c.color : c.status === 'idle' ? `${c.color}50` : 'rgba(255,255,255,0.1)',
                      boxShadow: c.status === 'active' ? `0 0 6px ${c.color}60` : 'none',
                    }} />
                    <span className="text-xs font-mono font-bold text-white">{c.name}</span>
                    <span className="text-[8px] font-mono uppercase tracking-wider ml-auto"
                      style={{ color: c.status === 'active' ? c.color : 'rgba(255,255,255,0.3)' }}>
                      {c.status}
                    </span>
                  </div>
                  <div className="text-sm font-mono font-bold" style={{ color: c.color }}>{c.balance}</div>
                </motion.div>
              ))}
            </div>
          </Section>

          {/* Transaction History */}
          <Section index={2} title="Recent Transactions" subtitle="Your latest on-chain activity">
            <div className="flex gap-1.5 mb-4 flex-wrap">
              {['all', 'swap', 'bridge', 'lp add', 'claim', 'stake'].map((f) => (
                <button key={f} onClick={() => setTxFilter(f)}
                  className="px-2.5 py-1 rounded-lg text-[10px] font-mono font-bold uppercase tracking-wider transition-colors"
                  style={{
                    background: txFilter === f ? `${CYAN}20` : 'rgba(0,0,0,0.3)',
                    border: `1px solid ${txFilter === f ? `${CYAN}40` : 'rgba(255,255,255,0.04)'}`,
                    color: txFilter === f ? CYAN : 'rgba(255,255,255,0.4)',
                  }}>
                  {f}
                </button>
              ))}
            </div>
            <div className="space-y-1.5">
              {filteredTx.map((tx, i) => {
                const typeColors = {
                  Swap: '#06b6d4', Bridge: '#a855f7', 'LP Add': '#22c55e',
                  Claim: '#f59e0b', Stake: '#3b82f6',
                }
                const tc = typeColors[tx.type] || CYAN
                return (
                  <motion.div key={tx.hash} custom={i} variants={cardV} initial="hidden" animate="visible"
                    className="flex items-center gap-3 rounded-lg p-3"
                    style={{ background: 'rgba(0,0,0,0.3)', border: `1px solid ${tc}10` }}>
                    <div className="w-8 h-8 rounded-lg flex items-center justify-center text-[9px] font-mono font-bold flex-shrink-0"
                      style={{ background: `${tc}12`, border: `1px solid ${tc}25`, color: tc }}>
                      {tx.type.slice(0, 2).toUpperCase()}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-[11px] font-mono font-bold text-white">{tx.type}</span>
                        {tx.from && <span className="text-[10px] font-mono text-black-500">{tx.from}</span>}
                        {tx.to && <>
                          <span className="text-[9px]" style={{ color: tc }}>&rarr;</span>
                          <span className="text-[10px] font-mono text-black-500">{tx.to}</span>
                        </>}
                      </div>
                      <div className="flex items-center gap-2 mt-0.5">
                        <span className="text-[9px] font-mono text-black-600">{tx.hash}</span>
                        <span className="text-[9px] font-mono text-black-600">{tx.chain}</span>
                      </div>
                    </div>
                    <div className="text-right flex-shrink-0">
                      <div className="text-[11px] font-mono font-bold text-white">{tx.value}</div>
                      <div className="text-[9px] font-mono text-black-500">{tx.time}</div>
                    </div>
                  </motion.div>
                )
              })}
            </div>
          </Section>

          {/* Token Approvals */}
          <Section index={3} title="Token Approvals" subtitle="Protocols with permission to spend your tokens">
            <div className="space-y-2">
              {APPROVALS.map((a, i) => {
                const riskColors = { low: '#22c55e', medium: '#f59e0b', high: '#ef4444' }
                const rc = riskColors[a.risk]
                return (
                  <motion.div key={`${a.protocol}-${a.token}`} custom={i} variants={cardV} initial="hidden" animate="visible"
                    className="flex items-center gap-3 rounded-lg p-3"
                    style={{ background: 'rgba(0,0,0,0.3)', border: `1px solid ${rc}10` }}>
                    <div className="flex-1 min-w-0">
                      <div className="text-[11px] font-mono font-bold text-white">{a.protocol}</div>
                      <div className="text-[10px] font-mono text-black-500">{a.token} — {a.amount}</div>
                    </div>
                    <div className="flex items-center gap-2 flex-shrink-0">
                      <span className="text-[9px] font-mono text-black-600">{a.time}</span>
                      <span className="text-[8px] font-mono font-bold px-1.5 py-0.5 rounded-full uppercase"
                        style={{ background: `${rc}12`, border: `1px solid ${rc}25`, color: rc }}>
                        {a.risk}
                      </span>
                      <button className="text-[9px] font-mono px-2 py-1 rounded-md transition-colors"
                        style={{ background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.2)', color: '#ef4444' }}>
                        Revoke
                      </button>
                    </div>
                  </motion.div>
                )
              })}
            </div>
            <div className="mt-3 rounded-lg p-3" style={{ background: `${CYAN}04`, border: `1px solid ${CYAN}10` }}>
              <p className="text-[10px] font-mono text-black-400">
                <span className="text-white font-bold">Tip:</span> Regularly review and revoke unused token approvals.
                Unlimited approvals on unused protocols increase your attack surface.
              </p>
            </div>
          </Section>

          {/* Security */}
          <Section index={4} title="Security Status" subtitle="Wallet protection and safety checks">
            <div className="space-y-2">
              {SECURITY_CHECKS.map((check, i) => (
                <motion.div key={check.label} custom={i} variants={cardV} initial="hidden" animate="visible"
                  className="flex items-center gap-3 rounded-lg p-3"
                  style={{ background: 'rgba(0,0,0,0.3)', border: `1px solid rgba(255,255,255,0.04)` }}>
                  <div className="w-6 h-6 rounded-full flex items-center justify-center text-xs flex-shrink-0"
                    style={{
                      background: check.status ? 'rgba(34,197,94,0.12)' : 'rgba(245,158,11,0.12)',
                      border: `1px solid ${check.status ? 'rgba(34,197,94,0.3)' : 'rgba(245,158,11,0.3)'}`,
                      color: check.status ? '#22c55e' : '#f59e0b',
                    }}>
                    {check.status ? '\u2713' : '!'}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-[11px] font-mono font-bold text-white">{check.label}</div>
                    <div className="text-[10px] font-mono text-black-500">{check.desc}</div>
                  </div>
                  <span className="text-[9px] font-mono px-2 py-0.5 rounded-full flex-shrink-0"
                    style={{
                      background: check.status ? 'rgba(34,197,94,0.1)' : 'rgba(245,158,11,0.1)',
                      border: `1px solid ${check.status ? 'rgba(34,197,94,0.2)' : 'rgba(245,158,11,0.2)'}`,
                      color: check.status ? '#22c55e' : '#f59e0b',
                    }}>
                    {check.status ? 'Active' : 'Setup'}
                  </span>
                </motion.div>
              ))}
            </div>
            <div className="mt-4 grid grid-cols-3 gap-3">
              {[
                { label: 'Security Score', value: '72%', color: '#f59e0b' },
                { label: 'Last Backup', value: 'Never', color: '#ef4444' },
                { label: 'Wallet Type', value: 'Hot', color: CYAN },
              ].map((m) => (
                <div key={m.label} className="rounded-lg p-3 text-center"
                  style={{ background: 'rgba(0,0,0,0.3)', border: '1px solid rgba(255,255,255,0.04)' }}>
                  <div className="text-[9px] font-mono text-black-500 uppercase tracking-wider">{m.label}</div>
                  <div className="text-sm font-mono font-bold mt-1" style={{ color: m.color }}>{m.value}</div>
                </div>
              ))}
            </div>
          </Section>
        </div>

        {/* Footer */}
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 1.5 }} className="mt-12 mb-8 text-center">
          <div className="w-16 h-px mx-auto mb-4" style={{ background: `linear-gradient(90deg, transparent, ${CYAN}40, transparent)` }} />
          <p className="text-[10px] font-mono text-black-600 tracking-widest uppercase">Your keys, your crypto</p>
        </motion.div>
      </div>
    </div>
  )
}
