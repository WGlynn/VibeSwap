import { useState, useEffect, useMemo } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { useWallet } from '../hooks/useWallet'
import { useDeviceWallet } from '../hooks/useDeviceWallet'
import { useBalances } from '../hooks/useBalances'
import { useBridge } from '../hooks/useBridge'
import toast from 'react-hot-toast'
import GlassCard from './ui/GlassCard'
import InteractiveButton from './ui/InteractiveButton'

const PHI = 1.618033988749895
const CYAN = '#06b6d4'

// ============ Chain Definitions ============
const CHAINS = [
  { id: 1,     name: 'Ethereum',   logo: '⟠', hex: '#627EEA', lzGas: '0.0012', status: 'active' },
  { id: 42161, name: 'Arbitrum',   logo: '◈', hex: '#28A0F0', lzGas: '0.0003', status: 'active' },
  { id: 8453,  name: 'Base',       logo: '⬡', hex: '#0052FF', lzGas: '0.0003', status: 'active' },
  { id: 10,    name: 'Optimism',   logo: '⊕', hex: '#FF0420', lzGas: '0.0004', status: 'active' },
  { id: 137,   name: 'Polygon',    logo: '⬠', hex: '#8247E5', lzGas: '0.0002', status: 'active' },
  { id: 'sol', name: 'Solana',     logo: '◎', hex: '#9945FF', lzGas: '0.0001', status: 'coming_soon' },
  { id: 'ckb', name: 'Nervos CKB', logo: '⬢', hex: '#3CC68A', lzGas: '0',      status: 'coming_soon', isCKB: true },
]
const ACTIVE_CHAINS = CHAINS.filter(c => c.status === 'active')

const BRIDGE_TOKENS = [
  { symbol: 'ETH',  name: 'Ethereum',       logo: '⟠' },
  { symbol: 'USDC', name: 'USD Coin',        logo: '$' },
  { symbol: 'USDT', name: 'Tether',          logo: '$' },
  { symbol: 'WBTC', name: 'Wrapped Bitcoin', logo: '₿' },
]

const ROUTES = [
  { name: 'LayerZero V2', security: 'high',   icon: '◇', timeMul: 1.0, feeMul: 1.0 },
  { name: 'Canonical',    security: 'max',     icon: '⛓', timeMul: 3.0, feeMul: 0.8 },
  { name: 'Fast Lane',    security: 'medium',  icon: '⚡', timeMul: 0.4, feeMul: 1.5 },
]

const STEPS = [
  { key: 'init',  label: 'Initiated',       match: ['approving','burning','in_transit','completed'] },
  { key: 'src',   label: 'Source OK',        match: ['burning','in_transit','completed'] },
  { key: 'fly',   label: 'In Transit',       match: ['in_transit','completed'] },
  { key: 'dst',   label: 'Dest Confirmed',   match: ['completed'] },
]

const SEC = {
  max:    'bg-green-500/10 text-green-400 border-green-500/20',
  high:   'bg-cyan-500/10 text-cyan-400 border-cyan-500/20',
  medium: 'bg-yellow-500/10 text-yellow-400 border-yellow-500/20',
}

// ============ Tiny Helpers ============
function ChainDot({ chain, size = 20 }) {
  return (
    <div className="flex items-center justify-center rounded-full font-bold"
      style={{ width: size, height: size, backgroundColor: chain.hex + '22', color: chain.hex, fontSize: size * 0.55 }}>
      {chain.logo}
    </div>
  )
}

function fmtTime(s) { return s >= 60 ? `~${Math.round(s / 60)} min` : `~${s}s` }

function fmtAge(ts) {
  const d = Date.now() - ts
  if (d < 60000) return 'Just now'
  if (d < 3600000) return `${Math.round(d / 60000)}m ago`
  if (d < 86400000) return `${Math.round(d / 3600000)}h ago`
  return `${Math.round(d / 86400000)}d ago`
}

// ============ Main Component ============
function BridgePage() {
  const { isConnected: isExternalConnected, connect } = useWallet()
  const { isConnected: isDeviceConnected } = useDeviceWallet()
  const { getFormattedBalance } = useBalances()
  const { bridgeState, isLoading: isBridgeLoading, error: bridgeError,
    estimateGas, executeBridge, lastBridge, resetBridge } = useBridge()

  const isConnected = isExternalConnected || isDeviceConnected

  const [fromChain, setFromChain] = useState(ACTIVE_CHAINS[0])
  const [toChain, setToChain] = useState(ACTIVE_CHAINS[1])
  const [selectedToken, setSelectedToken] = useState(BRIDGE_TOKENS[0])
  const [amount, setAmount] = useState('')
  const [showFromDD, setShowFromDD] = useState(false)
  const [showToDD, setShowToDD] = useState(false)
  const [showTokenSelect, setShowTokenSelect] = useState(false)
  const [showConfirm, setShowConfirm] = useState(false)
  const [tab, setTab] = useState('send')
  const [gasEstimate, setGasEstimate] = useState(null)
  const [history, setHistory] = useState(() => {
    try { return JSON.parse(localStorage.getItem('vibeswap_bridge_history') || '[]') }
    catch { return [] }
  })

  const currentBalance = getFormattedBalance(selectedToken.symbol)

  // Gas estimation
  useEffect(() => {
    let off = false
    ;(async () => {
      if (!amount || parseFloat(amount) <= 0) { setGasEstimate(null); return }
      try {
        const e = await estimateGas(fromChain.id, toChain.id, selectedToken, amount)
        if (!off) setGasEstimate(e)
      } catch { if (!off) setGasEstimate(null) }
    })()
    return () => { off = true }
  }, [fromChain.id, toChain.id, selectedToken, amount, estimateGas])

  const lzFee = gasEstimate?.fee || (parseFloat(fromChain.lzGas) + parseFloat(toChain.lzGas)).toFixed(4)
  const etaSec = gasEstimate?.time || 180
  const eta = fmtTime(etaSec)
  const recv = amount ? parseFloat(amount).toFixed(4) : '0'

  const routes = useMemo(() => ROUTES.map(r => ({
    ...r, fee: (parseFloat(lzFee) * r.feeMul).toFixed(4),
    time: Math.round(etaSec * r.timeMul), recommended: r.name === 'LayerZero V2',
  })), [lzFee, etaSec])

  // Bridge state toasts
  useEffect(() => {
    const ID = 'bridge'
    if (bridgeState === 'approving') toast.loading('Approving token transfer...', { id: ID })
    else if (bridgeState === 'burning') toast.loading('Burning tokens on source chain...', { id: ID })
    else if (bridgeState === 'in_transit') toast.loading('LayerZero message in transit...', { id: ID })
    else if (bridgeState === 'completed') {
      toast.success(`Sent ${lastBridge?.amount || amount} ${lastBridge?.token || selectedToken.symbol} to ${lastBridge?.toChain || toChain.name}!`, { id: ID, duration: 5000 })
      setAmount('')
    } else if (bridgeState === 'failed') toast.error(bridgeError || 'Bridge transfer failed', { id: ID, duration: 5000 })
  }, [bridgeState, lastBridge, bridgeError, amount, selectedToken.symbol, toChain.name])

  // Save history
  useEffect(() => {
    if (bridgeState === 'completed' && lastBridge) {
      setHistory(prev => {
        const u = [lastBridge, ...prev].slice(0, 20)
        localStorage.setItem('vibeswap_bridge_history', JSON.stringify(u))
        return u
      })
    }
  }, [bridgeState, lastBridge])

  const handleSend = () => {
    if (!isConnected) { connect(); return }
    if (!amount || parseFloat(amount) <= 0) { toast.error('Enter an amount'); return }
    resetBridge()
    setShowConfirm(true)
  }

  const confirmSend = async () => {
    setShowConfirm(false)
    try { await executeBridge({ fromChain, toChain, token: selectedToken, amount }) }
    catch (err) { console.error('Bridge failed:', err) }
  }

  const transferActive = ['approving', 'burning', 'in_transit'].includes(bridgeState)
  const hasAmount = amount && parseFloat(amount) > 0

  return (
    <div className="max-w-lg mx-auto px-4">
      {/* Header */}
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-white">Send</h1>
        <p className="text-black-400 mt-1">Transfer money across networks instantly. No wire fees.</p>
        <div className="flex items-center space-x-2 mt-2 flex-wrap gap-y-1">
          <span className="flex items-center space-x-1.5 px-2 py-1 rounded-full bg-matrix-500/10 border border-matrix-500/20">
            <svg className="w-3 h-3 text-matrix-500" fill="currentColor" viewBox="0 0 20 20">
              <path fillRule="evenodd" d="M2.166 4.999A11.954 11.954 0 0010 1.944 11.954 11.954 0 0017.834 5c.11.65.166 1.32.166 2.001 0 5.225-3.34 9.67-8 11.317C5.34 16.67 2 12.225 2 7c0-.682.057-1.35.166-2.001zm11.541 3.708a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
            </svg>
            <span className="text-[10px] text-matrix-500 font-medium">secure transfer</span>
          </span>
          <span className="flex items-center px-2 py-1 rounded-full bg-matrix-500/10 border border-matrix-500/20">
            <span className="text-[10px] text-matrix-500 font-medium">0% fee</span>
          </span>
          <LzBadge />
        </div>
      </div>

      {/* Tab Switcher */}
      <div className="flex mb-4 p-1 rounded-xl bg-black-800/60 border border-black-700/50">
        {['send', 'history'].map(t => (
          <button key={t} onClick={() => setTab(t)}
            className={`flex-1 py-2 rounded-lg text-sm font-medium transition-all ${tab === t ? 'bg-black-700 text-white shadow-sm' : 'text-black-400 hover:text-black-200'}`}>
            {t === 'send' ? 'Send' : 'History'}
          </button>
        ))}
      </div>

      <AnimatePresence mode="wait">
        {tab === 'send' ? (
          <motion.div key="send" initial={{ opacity: 0, x: -10 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: 10 }} transition={{ duration: 0.18 }}>
            <GlassCard className="p-4">
              {/* From */}
              <div className="mb-2">
                <div className="text-sm text-black-400 mb-2">From</div>
                <div className="flex items-stretch gap-2">
                  <ChainBtn chain={fromChain} open={showFromDD} setOpen={setShowFromDD}
                    exclude={toChain.id} onSelect={c => { setFromChain(c); setShowFromDD(false) }} />
                  <div className="flex-1 min-w-0 bg-black-700 rounded-xl p-3">
                    <div className="flex items-center gap-2">
                      <input type="number" value={amount} onChange={e => setAmount(e.target.value)}
                        placeholder="0" className="flex-1 min-w-0 bg-transparent text-xl font-medium outline-none placeholder-black-500" />
                      <button onClick={() => setShowTokenSelect(true)}
                        className="flex-shrink-0 flex items-center space-x-1 px-2 py-1 rounded-lg bg-black-600 hover:bg-black-500 transition-colors">
                        <span>{selectedToken.logo}</span>
                        <span className="text-sm font-medium">{selectedToken.symbol}</span>
                      </button>
                    </div>
                    {isConnected && (
                      <div className="flex items-center justify-between mt-2 text-xs text-black-400">
                        <span className="truncate">Bal: {currentBalance}</span>
                        <button onClick={() => setAmount(currentBalance.replace(',', ''))} className="flex-shrink-0 text-matrix-500 hover:text-matrix-400 ml-2">MAX</button>
                      </div>
                    )}
                  </div>
                </div>
              </div>

              {/* Swap */}
              <div className="flex justify-center -my-1 relative z-10">
                <motion.button onClick={() => { setFromChain(toChain); setToChain(fromChain) }}
                  whileHover={{ rotate: 180 }} whileTap={{ scale: 0.95 }}
                  transition={{ type: 'spring', stiffness: 300, damping: 20 }}
                  className="p-2.5 rounded-xl bg-black-900 border-4 border-black-800 hover:bg-black-700 hover:shadow-glow-cyan-md transition-colors group">
                  <svg className="w-5 h-5 text-black-300 group-hover:text-white transition-colors" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16V4m0 0L3 8m4-4l4 4m6 0v12m0 0l4-4m-4 4l-4-4" />
                  </svg>
                </motion.button>
              </div>

              {/* To */}
              <div className="mt-2">
                <div className="text-sm text-black-400 mb-2">To</div>
                <div className="flex items-stretch gap-2">
                  <ChainBtn chain={toChain} open={showToDD} setOpen={setShowToDD}
                    exclude={fromChain.id} onSelect={c => { setToChain(c); setShowToDD(false) }} />
                  <div className="flex-1 min-w-0 bg-black-700/50 rounded-xl p-3">
                    <div className="flex items-center gap-2">
                      <input type="text" value={recv !== '0' ? recv : ''} readOnly placeholder="0"
                        className="flex-1 min-w-0 bg-transparent text-xl font-medium outline-none placeholder-black-500 text-black-200" />
                      <div className="flex-shrink-0 flex items-center space-x-1 px-2 py-1 rounded-lg bg-black-600">
                        <span>{selectedToken.logo}</span>
                        <span className="text-sm font-medium">{selectedToken.symbol}</span>
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              {/* Transfer Details */}
              {hasAmount && (
                <div className="mt-4 p-4 rounded-xl bg-black-900/50 space-y-3">
                  <Row l="Protocol Fee" r={<span className="text-matrix-500 font-medium">Free</span>} />
                  <Row l="LayerZero Gas" r={<span className="font-mono text-black-300">~{lzFee} ETH</span>} />
                  <Row l="Arrives In" r={eta} />
                  <div className="pt-2 border-t border-black-700">
                    <Row l="Recipient Gets" r={<span className="font-medium text-white">{recv} {selectedToken.symbol}</span>} />
                  </div>
                </div>
              )}

              <div className="mt-4 flex items-center justify-center space-x-2 text-sm text-black-500">
                <svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5" />
                </svg>
                <span>Immutable burn-and-mint bridge</span>
              </div>

              <InteractiveButton variant="primary" onClick={handleSend} loading={isBridgeLoading}
                className={`w-full mt-4 py-4 text-lg ${isConnected && hasAmount ? '' : '!bg-black-700 !text-black-400 !border-black-700'}`}>
                Send
              </InteractiveButton>
            </GlassCard>

            {/* Progress Tracker */}
            {transferActive && (
              <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="mt-4">
                <GlassCard className="p-4">
                  <div className="flex items-center space-x-2 mb-4">
                    <motion.div animate={{ rotate: 360 }} transition={{ repeat: Infinity, duration: PHI, ease: 'linear' }}>
                      <svg className="w-4 h-4" style={{ color: CYAN }} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                      </svg>
                    </motion.div>
                    <span className="text-sm font-medium text-white">Transfer in Progress</span>
                  </div>
                  <div className="flex items-center justify-between">
                    {STEPS.map((s, i) => {
                      const active = s.match.includes(bridgeState)
                      const done = s.key === 'dst' ? bridgeState === 'completed' : STEPS[i + 1]?.match.includes(bridgeState)
                      const now = active && !done
                      return (
                        <div key={s.key} className="flex items-center flex-1">
                          <div className="flex flex-col items-center">
                            <motion.div className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold border-2 ${done ? 'bg-matrix-500/20 border-matrix-500 text-matrix-500' : now ? 'border-cyan-400 text-cyan-400' : 'border-black-600 text-black-500'}`}
                              animate={now ? { scale: [1, 1.1, 1] } : {}} transition={now ? { repeat: Infinity, duration: PHI } : {}}>
                              {done ? <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}><path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" /></svg> : i + 1}
                            </motion.div>
                            <span className={`text-[9px] mt-1.5 text-center leading-tight ${active ? 'text-black-200' : 'text-black-500'}`}>{s.label}</span>
                          </div>
                          {i < STEPS.length - 1 && <div className="flex-1 mx-1 mt-[-16px]"><div className={`h-[2px] rounded-full ${done ? 'bg-matrix-500/60' : 'bg-black-700'}`} /></div>}
                        </div>
                      )
                    })}
                  </div>
                  <div className="mt-3 flex items-center justify-center space-x-2 text-xs text-black-400">
                    <ChainDot chain={fromChain} size={14} /><span>{fromChain.name}</span>
                    <span className="text-black-600">-&gt;</span>
                    <ChainDot chain={toChain} size={14} /><span>{toChain.name}</span>
                  </div>
                </GlassCard>
              </motion.div>
            )}

            {/* Route Comparison */}
            {hasAmount && (
              <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }} className="mt-4">
                <GlassCard className="p-4">
                  <div className="flex items-center space-x-2 mb-3">
                    <svg className="w-4 h-4 text-black-300" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 20l-5.447-2.724A1 1 0 013 16.382V5.618a1 1 0 011.447-.894L9 7m0 13l6-3m-6 3V7m6 10l4.553 2.276A1 1 0 0021 18.382V7.618a1 1 0 00-.553-.894L15 4m0 13V4m0 0L9 7" />
                    </svg>
                    <span className="text-sm font-medium text-white">Available Routes</span>
                  </div>
                  <div className="space-y-2">
                    {routes.map(r => (
                      <div key={r.name} className={`flex items-center justify-between p-3 rounded-xl border ${r.recommended ? 'bg-cyan-500/5 border-cyan-500/20' : 'bg-black-800/50 border-black-700/50 opacity-50'}`}>
                        <div className="flex items-center space-x-2.5">
                          <span className="text-base">{r.icon}</span>
                          <div>
                            <div className="flex items-center space-x-2">
                              <span className="text-sm font-medium text-white">{r.name}</span>
                              {r.recommended && <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-matrix-500/15 text-matrix-500 font-medium">ACTIVE</span>}
                            </div>
                            <span className={`text-[10px] px-1.5 py-0.5 rounded-full border ${SEC[r.security]}`}>{r.security}</span>
                          </div>
                        </div>
                        <div className="text-right">
                          <div className="text-sm font-mono text-black-300">~{r.fee} ETH</div>
                          <div className="text-xs text-black-500">{fmtTime(r.time)}</div>
                        </div>
                      </div>
                    ))}
                  </div>
                </GlassCard>
              </motion.div>
            )}

            {/* Supported Chains Grid */}
            <GlassCard className="mt-4 p-4">
              <div className="flex items-center space-x-2 mb-3">
                <svg className="w-4 h-4 text-black-300" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3.055 11H5a2 2 0 012 2v1a2 2 0 002 2 2 2 0 012 2v2.945M8 3.935V5.5A2.5 2.5 0 0010.5 8h.5a2 2 0 012 2 2 2 0 104 0 2 2 0 012-2h1.064M15 20.488V18a2 2 0 012-2h3.064M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                <span className="text-sm font-medium text-white">Supported Networks</span>
              </div>
              <div className="grid grid-cols-3 sm:grid-cols-4 gap-2">
                {CHAINS.map(c => (
                  <div key={c.id} className={`flex flex-col items-center p-2.5 rounded-xl border ${c.status === 'active' ? 'bg-black-800/50 border-black-700/50' : 'bg-black-900/30 border-black-800/30 opacity-50'}`}>
                    <ChainDot chain={c} size={28} />
                    <span className="text-[11px] font-medium mt-1.5 text-center leading-tight text-black-200">{c.name}</span>
                    <div className="flex items-center space-x-1 mt-1">
                      <div className={`w-1.5 h-1.5 rounded-full ${c.status === 'active' ? 'bg-green-400' : 'bg-black-500'}`} />
                      <span className={`text-[9px] ${c.status === 'active' ? 'text-green-400' : 'text-black-500'}`}>{c.status === 'active' ? 'Live' : 'Soon'}</span>
                    </div>
                  </div>
                ))}
              </div>
            </GlassCard>
          </motion.div>
        ) : (
          <motion.div key="history" initial={{ opacity: 0, x: 10 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -10 }} transition={{ duration: 0.18 }}>
            {history.length === 0 ? (
              <GlassCard className="p-8">
                <div className="text-center">
                  <svg className="w-12 h-12 mx-auto text-black-600 mb-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                  <p className="text-black-400 text-sm">No transfers yet</p>
                  <p className="text-black-500 text-xs mt-1">Your transfer history will appear here</p>
                </div>
              </GlassCard>
            ) : (
              <div className="space-y-2">
                {history.map((tx, i) => {
                  const hash = tx.txHash ? `${tx.txHash.slice(0, 6)}...${tx.txHash.slice(-4)}` : 'pending'
                  return (
                    <motion.div key={tx.txHash || i} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.04 }}>
                      <GlassCard className="p-3">
                        <div className="flex items-center justify-between">
                          <div className="flex items-center space-x-3">
                            <div className="w-6 h-6 rounded-full flex items-center justify-center text-[10px]" style={{ backgroundColor: CYAN + '22', color: CYAN }}>-&gt;</div>
                            <div>
                              <div className="text-sm font-medium text-white">{tx.amount} {tx.token}</div>
                              <div className="text-xs text-black-400">{tx.fromChain} -&gt; {tx.toChain}</div>
                            </div>
                          </div>
                          <div className="text-right">
                            <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-medium bg-green-500/10 text-green-400 border border-green-500/20">Completed</span>
                            <div className="text-[10px] text-black-500 mt-0.5">{fmtAge(tx.timestamp)}</div>
                          </div>
                        </div>
                        <div className="mt-2 pt-2 border-t border-black-700/50 flex items-center justify-between text-[10px] text-black-500">
                          <span className="font-mono">{hash}</span>
                          {tx.txHash && <button onClick={() => { navigator.clipboard.writeText(tx.txHash); toast.success('Tx hash copied') }} className="text-black-400 hover:text-black-200">Copy</button>}
                        </div>
                      </GlassCard>
                    </motion.div>
                  )
                })}
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>

      {/* Modals */}
      <AnimatePresence>
        {showConfirm && (
          <ConfirmModal from={fromChain} to={toChain} token={selectedToken}
            amount={amount} recv={recv} lzFee={lzFee} eta={eta}
            onConfirm={confirmSend} onClose={() => setShowConfirm(false)} />
        )}
      </AnimatePresence>
      <AnimatePresence>
        {showTokenSelect && (
          <TokenModal tokens={BRIDGE_TOKENS} selected={selectedToken}
            onSelect={t => { setSelectedToken(t); setShowTokenSelect(false) }}
            onClose={() => setShowTokenSelect(false)} getBalance={getFormattedBalance} />
        )}
      </AnimatePresence>
    </div>
  )
}

// ============ Small Sub-components ============
function Row({ l, r }) {
  return (
    <div className="flex items-center justify-between text-sm">
      <span className="text-black-400">{l}</span>
      <span>{r}</span>
    </div>
  )
}

function ChainBtn({ chain, open, setOpen, exclude, onSelect }) {
  return (
    <div className="relative">
      <button onClick={() => setOpen(!open)}
        className="h-full flex items-center space-x-2 px-3 py-2.5 rounded-xl bg-black-700 hover:bg-black-600 transition-colors whitespace-nowrap">
        <ChainDot chain={chain} size={20} />
        <span className="text-sm font-medium hidden sm:inline">{chain.name}</span>
        <svg className="w-4 h-4 text-black-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <motion.div initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }}
            className="absolute top-full left-0 mt-2 w-56 rounded-xl glass-card shadow-xl py-2 z-50">
            {ACTIVE_CHAINS.filter(c => c.id !== exclude).map(c => (
              <button key={c.id} onClick={() => onSelect(c)}
                className="w-full flex items-center space-x-3 px-4 py-2.5 hover:bg-black-700 transition-colors">
                <ChainDot chain={c} size={24} />
                <span className="font-medium text-sm">{c.name}</span>
                <div className="flex-1" />
                <div className="w-2 h-2 rounded-full" style={{ backgroundColor: c.hex + '80' }} />
              </button>
            ))}
          </motion.div>
        </>
      )}
    </div>
  )
}

function LzBadge() {
  const [show, setShow] = useState(false)
  return (
    <div className="relative">
      <button onClick={() => setShow(!show)} className="flex items-center space-x-1.5 px-2 py-1 rounded-full border" style={{ backgroundColor: CYAN + '0F', borderColor: CYAN + '33' }}>
        <svg className="w-3 h-3" style={{ color: CYAN }} viewBox="0 0 24 24" fill="currentColor"><path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5" /></svg>
        <span className="text-[10px] font-medium" style={{ color: CYAN }}>LayerZero V2</span>
      </button>
      <AnimatePresence>
        {show && (
          <>
            <div className="fixed inset-0 z-40" onClick={() => setShow(false)} />
            <motion.div initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -4 }}
              className="absolute top-full left-0 mt-2 w-64 p-3 rounded-xl glass-card shadow-xl z-50">
              <div className="flex items-center space-x-2 mb-2">
                <svg className="w-4 h-4" style={{ color: CYAN }} viewBox="0 0 24 24" fill="currentColor"><path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5" /></svg>
                <span className="text-sm font-semibold text-white">Powered by LayerZero V2</span>
              </div>
              <p className="text-xs text-black-400 mb-2">Omnichain interoperability protocol with configurable security stacks.</p>
              {['Immutable messaging', 'Decentralized verification', 'Burn-and-mint (no liquidity pools)'].map(t => (
                <div key={t} className="flex items-center space-x-1.5 text-xs text-black-400 mb-0.5">
                  <div className="w-1.5 h-1.5 rounded-full bg-green-400 flex-shrink-0" /><span>{t}</span>
                </div>
              ))}
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </div>
  )
}

// ============ Confirmation Modal ============
function ConfirmModal({ from, to, token, amount, recv, lzFee, eta, onConfirm, onClose }) {
  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/80 backdrop-blur-sm" onClick={onClose} />
      <motion.div initial={{ scale: 0.95, opacity: 0, y: 20 }} animate={{ scale: 1, opacity: 1, y: 0 }}
        exit={{ scale: 0.95, opacity: 0, y: 20 }} className="relative w-full max-w-md glass-card rounded-2xl shadow-2xl overflow-hidden">
        <div className="flex items-center justify-between p-4 border-b border-black-700">
          <h3 className="text-lg font-semibold">Confirm Send</h3>
          <button onClick={onClose} className="p-2 rounded-lg hover:bg-black-700"><svg className="w-5 h-5 text-black-400" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg></button>
        </div>
        <div className="p-4 space-y-4">
          <div className="flex flex-col sm:flex-row items-center justify-between p-4 rounded-xl bg-black-900 gap-3 sm:gap-0">
            <div className="text-center"><ChainDot chain={from} size={40} /><div className="text-sm font-medium mt-1">{from.name}</div></div>
            <div className="flex-1 flex flex-col items-center px-0 sm:px-4">
              <div className="text-2xl font-bold text-white">{amount}</div>
              <div className="flex items-center space-x-1 text-black-400"><span>{token.logo}</span><span>{token.symbol}</span></div>
              <svg className="w-6 h-6 text-matrix-500 mt-2 rotate-90 sm:rotate-0" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 8l4 4m0 0l-4 4m4-4H3" /></svg>
            </div>
            <div className="text-center"><ChainDot chain={to} size={40} /><div className="text-sm font-medium mt-1">{to.name}</div></div>
          </div>
          <div className="space-y-3 p-4 rounded-xl bg-black-700/50">
            <Row l="You Send" r={<span className="font-medium">{amount} {token.symbol}</span>} />
            <Row l="Recipient Gets" r={<span className="font-medium text-matrix-500">{recv} {token.symbol}</span>} />
            <div className="border-t border-black-600 my-2" />
            <Row l="Protocol Fee" r={<span className="text-matrix-500 font-medium">Free</span>} />
            <div className="flex items-center justify-between text-sm">
              <div className="flex items-center space-x-1">
                <span className="text-black-400">LayerZero Gas</span>
                <div className="group relative">
                  <svg className="w-3.5 h-3.5 text-black-500 cursor-help" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                  <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 px-3 py-2 bg-black-600 rounded-lg text-xs text-white opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap pointer-events-none z-10">
                    Cost to burn on {from.name} + mint on {to.name}
                  </div>
                </div>
              </div>
              <span className="font-mono text-black-300">~{lzFee} ETH</span>
            </div>
            <Row l="Estimated Time" r={eta} />
          </div>
          <div className="p-3 rounded-xl bg-terminal-500/10 border border-terminal-500/20">
            <div className="flex items-start space-x-2">
              <svg className="w-5 h-5 text-terminal-500 mt-0.5 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
                <path fillRule="evenodd" d="M2.166 4.999A11.954 11.954 0 0010 1.944 11.954 11.954 0 0017.834 5c.11.65.166 1.32.166 2.001 0 5.225-3.34 9.67-8 11.317C5.34 16.67 2 12.225 2 7c0-.682.057-1.35.166-2.001zm11.541 3.708a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
              </svg>
              <div className="text-sm text-black-300">
                <span className="font-medium text-terminal-400">Immutable Transfer</span>
                <p className="text-xs mt-0.5 text-black-400">Tokens are burned on {from.name} and minted on {to.name}. Irreversible, prevents double-spends.</p>
              </div>
            </div>
          </div>
        </div>
        <div className="p-4 border-t border-black-700 space-y-3">
          <InteractiveButton variant="primary" onClick={onConfirm} className="w-full py-4 text-lg">Confirm Send</InteractiveButton>
          <button onClick={onClose} className="w-full py-3 rounded-xl bg-black-700 hover:bg-black-600 text-black-300 font-medium transition-colors">Cancel</button>
        </div>
      </motion.div>
    </motion.div>
  )
}

// ============ Token Select Modal ============
function TokenModal({ tokens, selected, onSelect, onClose, getBalance }) {
  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <motion.div initial={{ scale: 0.95, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.95, opacity: 0 }}
        className="relative w-full max-w-sm glass-card rounded-2xl shadow-xl">
        <div className="flex items-center justify-between p-4 border-b border-black-700">
          <h3 className="font-semibold">Select Token</h3>
          <button onClick={onClose} className="p-2 rounded-xl hover:bg-black-700"><svg className="w-5 h-5 text-black-400" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg></button>
        </div>
        <div className="py-2">
          {tokens.map(t => (
            <button key={t.symbol} onClick={() => onSelect(t)}
              className={`w-full flex items-center justify-between px-4 py-3 hover:bg-black-700 transition-colors ${selected.symbol === t.symbol ? 'bg-matrix-500/10' : ''}`}>
              <div className="flex items-center space-x-3">
                <span className="text-2xl">{t.logo}</span>
                <div className="text-left"><div className="font-medium">{t.symbol}</div><div className="text-sm text-black-400">{t.name}</div></div>
              </div>
              <div className="font-medium">{getBalance(t.symbol)}</div>
            </button>
          ))}
        </div>
      </motion.div>
    </motion.div>
  )
}

export default BridgePage
