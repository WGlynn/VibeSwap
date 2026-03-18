import { useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { useWallet } from '../hooks/useWallet'
import { useDeviceWallet } from '../hooks/useDeviceWallet'
import GlassCard from './ui/GlassCard'
import PageHero from './ui/PageHero'

const PHI = 1.618033988749895
const CYAN = '#06b6d4'

// ============ Token Definitions ============
const TOKENS = [
  { symbol: 'ETH',  name: 'Ethereum',   logo: '\u27E0', decimals: 18 },
  { symbol: 'USDC', name: 'USD Coin',    logo: '$',      decimals: 6  },
  { symbol: 'VIBE', name: 'VibeSwap',    logo: '\u2261', decimals: 18 },
  { symbol: 'JUL',  name: 'Joule',        logo: '\u2726', decimals: 18 },
]

// ============ Mock History ============
const MOCK_HISTORY = [
  {
    id: 1,
    date: '2026-03-10',
    token: 'ETH',
    recipients: 12,
    totalAmount: '3.6000',
    txHash: '0x7a3f...c821',
    status: 'completed',
  },
  {
    id: 2,
    date: '2026-03-07',
    token: 'USDC',
    recipients: 8,
    totalAmount: '24,500.00',
    txHash: '0x1b9e...d430',
    status: 'completed',
  },
  {
    id: 3,
    date: '2026-02-28',
    token: 'VIBE',
    recipients: 25,
    totalAmount: '100,000.00',
    txHash: '0xf4c2...a917',
    status: 'completed',
  },
]

// ============ Helpers ============
const isValidAddress = (addr) => /^0x[a-fA-F0-9]{40}$/.test(addr)

const createEmptyRow = () => ({ address: '', amount: '', id: Math.random().toString(36).slice(2) })

function formatGasEstimate(recipientCount) {
  // Individual transfers: ~21,000 gas each
  // Multi-send: ~21,000 base + ~9,000 per recipient (batched calldata)
  const individual = recipientCount * 21000
  const batched = 21000 + recipientCount * 9000
  const savingsPercent = Math.round((1 - batched / individual) * 100)
  const estimatedGwei = (batched * 30 / 1e9).toFixed(4)
  return { individual, batched, savingsPercent, estimatedGwei }
}

// ============ Row Component ============
function Row({ l, r }) {
  return (
    <div className="flex items-center justify-between text-sm">
      <span className="text-black-400">{l}</span>
      <span>{r}</span>
    </div>
  )
}

// ============ Recipient Row ============
function RecipientRow({ row, index, onChange, onRemove, canRemove }) {
  const addrTouched = row.address.length > 0
  const addrValid = isValidAddress(row.address)
  const amtTouched = row.amount.length > 0
  const amtValid = amtTouched && parseFloat(row.amount) > 0

  return (
    <motion.div
      initial={{ opacity: 0, y: -8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -8, height: 0 }}
      transition={{ duration: 1 / (PHI * PHI * PHI) }}
      className="flex items-start gap-2 mb-2"
    >
      {/* Row number */}
      <div className="flex-shrink-0 w-6 h-10 flex items-center justify-center text-xs font-mono text-black-500">
        {index + 1}
      </div>

      {/* Address input */}
      <div className="flex-1 min-w-0">
        <input
          type="text"
          value={row.address}
          onChange={(e) => onChange(row.id, 'address', e.target.value)}
          placeholder="0x..."
          className={`w-full px-3 py-2.5 rounded-xl bg-black-700 text-sm font-mono outline-none placeholder-black-500 transition-colors border ${
            addrTouched && !addrValid
              ? 'border-red-500/50 text-red-400'
              : addrTouched && addrValid
              ? 'border-matrix-500/30 text-white'
              : 'border-transparent text-white'
          }`}
        />
        {addrTouched && !addrValid && (
          <p className="text-[10px] text-red-400 mt-0.5 ml-1">Invalid address format</p>
        )}
      </div>

      {/* Amount input */}
      <div className="flex-shrink-0 w-28">
        <input
          type="number"
          value={row.amount}
          onChange={(e) => onChange(row.id, 'amount', e.target.value)}
          placeholder="0.00"
          min="0"
          step="any"
          className={`w-full px-3 py-2.5 rounded-xl bg-black-700 text-sm font-mono outline-none placeholder-black-500 transition-colors border ${
            amtTouched && !amtValid
              ? 'border-red-500/50 text-red-400'
              : amtTouched && amtValid
              ? 'border-matrix-500/30 text-white'
              : 'border-transparent text-white'
          }`}
        />
      </div>

      {/* Remove button */}
      <button
        onClick={() => onRemove(row.id)}
        disabled={!canRemove}
        className={`flex-shrink-0 w-10 h-10 flex items-center justify-center rounded-xl transition-colors ${
          canRemove
            ? 'hover:bg-red-500/10 text-black-500 hover:text-red-400'
            : 'text-black-700 cursor-not-allowed'
        }`}
      >
        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
        </svg>
      </button>
    </motion.div>
  )
}

// ============ Confirmation Modal ============
function ConfirmModal({ token, recipients, totalAmount, gasEstimate, onConfirm, onClose }) {
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
    >
      <div className="absolute inset-0 bg-black/80 backdrop-blur-sm" onClick={onClose} />
      <motion.div
        initial={{ scale: 0.95, opacity: 0, y: 20 }}
        animate={{ scale: 1, opacity: 1, y: 0 }}
        exit={{ scale: 0.95, opacity: 0, y: 20 }}
        transition={{ duration: 1 / (PHI * PHI) }}
        className="relative w-full max-w-md glass-card rounded-2xl shadow-2xl overflow-hidden"
      >
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-black-700">
          <h3 className="text-lg font-semibold">Confirm Multi-Send</h3>
          <button onClick={onClose} className="p-2 rounded-lg hover:bg-black-700">
            <svg className="w-5 h-5 text-black-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Body */}
        <div className="p-4 space-y-4">
          {/* Summary card */}
          <div className="p-4 rounded-xl bg-black-900/50 space-y-3">
            <div className="flex items-center justify-center space-x-3 mb-2">
              <div
                className="w-10 h-10 rounded-full flex items-center justify-center text-lg font-bold"
                style={{ backgroundColor: CYAN + '22', color: CYAN }}
              >
                {token.logo}
              </div>
              <div className="text-center">
                <div className="text-2xl font-bold text-white font-mono">{totalAmount}</div>
                <div className="text-sm text-black-400">{token.symbol} total</div>
              </div>
            </div>
            <div className="border-t border-black-700 pt-3 space-y-2">
              <Row l="Recipients" r={<span className="font-mono text-white">{recipients}</span>} />
              <Row l="Token" r={<span className="font-medium text-white">{token.symbol}</span>} />
              <Row l="Est. Gas" r={<span className="font-mono text-black-300">~{gasEstimate} ETH</span>} />
              <Row l="Protocol Fee" r={<span className="text-matrix-500 font-medium">Free</span>} />
            </div>
          </div>

          {/* Warning */}
          <div className="p-3 rounded-xl bg-terminal-500/10 border border-terminal-500/20">
            <div className="flex items-start space-x-2">
              <svg className="w-5 h-5 text-terminal-500 mt-0.5 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
                <path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
              </svg>
              <div className="text-sm text-black-300">
                <span className="font-medium text-terminal-400">Irreversible</span>
                <p className="text-xs mt-0.5 text-black-400">
                  This will send {token.symbol} to {recipients} addresses in a single transaction.
                  This action cannot be undone.
                </p>
              </div>
            </div>
          </div>
        </div>

        {/* Actions */}
        <div className="p-4 border-t border-black-700 space-y-3">
          <motion.button
            whileHover={{ scale: 1.01 }}
            whileTap={{ scale: 0.99 }}
            onClick={onConfirm}
            className="w-full py-4 rounded-xl text-lg font-semibold transition-colors"
            style={{ backgroundColor: CYAN + '22', color: CYAN, border: `1px solid ${CYAN}33` }}
          >
            Confirm &amp; Send
          </motion.button>
          <button
            onClick={onClose}
            className="w-full py-3 rounded-xl bg-black-700 hover:bg-black-600 text-black-300 font-medium transition-colors"
          >
            Cancel
          </button>
        </div>
      </motion.div>
    </motion.div>
  )
}

// ============ Main Component ============
export default function MultiSendPage() {
  const { isConnected: isExternalConnected, connect } = useWallet()
  const { isConnected: isDeviceConnected } = useDeviceWallet()
  const isConnected = isExternalConnected || isDeviceConnected

  const [selectedToken, setSelectedToken] = useState(TOKENS[0])
  const [showTokenDD, setShowTokenDD] = useState(false)
  const [recipients, setRecipients] = useState([
    createEmptyRow(),
    createEmptyRow(),
    createEmptyRow(),
  ])
  const [showConfirm, setShowConfirm] = useState(false)
  const [tab, setTab] = useState('send')
  const [csvTooltip, setCsvTooltip] = useState(false)

  // ============ Recipient CRUD ============
  const handleRowChange = (id, field, value) => {
    setRecipients((prev) =>
      prev.map((r) => (r.id === id ? { ...r, [field]: value } : r))
    )
  }

  const handleRemoveRow = (id) => {
    if (recipients.length <= 1) return
    setRecipients((prev) => prev.filter((r) => r.id !== id))
  }

  const handleAddRow = () => {
    setRecipients((prev) => [...prev, createEmptyRow()])
  }

  // ============ CSV Import (Mock) ============
  const handleCsvImport = () => {
    // Mock: simulate parsing a CSV with sample data
    const mockCsvData = [
      { address: '0x742d35Cc6634C0532925a3b844Bc9e7595f2bD68', amount: '1.5' },
      { address: '0x53d284357ec70cE289D6D64134DfAc8E511c8a3D', amount: '2.0' },
      { address: '0xAb5801a7D398351b8bE11C439e05C5B3259aeC9B', amount: '0.75' },
      { address: '0xBE0eB53F46cd790Cd13851d5EFf43D12404d33E8', amount: '3.25' },
    ]
    setRecipients(
      mockCsvData.map((d) => ({
        address: d.address,
        amount: d.amount,
        id: Math.random().toString(36).slice(2),
      }))
    )
  }

  // ============ Validation & Summary ============
  const validRecipients = recipients.filter(
    (r) => isValidAddress(r.address) && parseFloat(r.amount) > 0
  )
  const totalAmount = validRecipients
    .reduce((sum, r) => sum + parseFloat(r.amount), 0)
    .toFixed(4)
  const hasErrors = recipients.some(
    (r) =>
      (r.address.length > 0 && !isValidAddress(r.address)) ||
      (r.amount.length > 0 && !(parseFloat(r.amount) > 0))
  )
  const gas = formatGasEstimate(Math.max(validRecipients.length, 1))
  const canSend = validRecipients.length > 0 && !hasErrors

  // ============ Send Handler ============
  const handleSend = () => {
    if (!isConnected) {
      connect()
      return
    }
    if (!canSend) return
    setShowConfirm(true)
  }

  const confirmSend = () => {
    setShowConfirm(false)
    // Mock: would call multi-send contract here
  }

  // ============ Render ============
  return (
    <div className="min-h-screen">
      <PageHero
        title="Multi-Send"
        subtitle="Send tokens to multiple recipients in a single transaction"
        category="defi"
        badge="Live"
        badgeColor={CYAN}
      />

      <div className="max-w-2xl mx-auto px-4 pb-12">
        {/* Gas Savings Banner */}
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 1 / (PHI * PHI), delay: 1 / (PHI * PHI * PHI) }}
          className="mb-6"
        >
          <div
            className="flex items-center justify-between p-3 rounded-xl border"
            style={{ backgroundColor: CYAN + '08', borderColor: CYAN + '22' }}
          >
            <div className="flex items-center space-x-2">
              <svg className="w-5 h-5" style={{ color: CYAN }} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
              </svg>
              <span className="text-sm font-medium" style={{ color: CYAN }}>
                Save ~{gas.savingsPercent}% on gas vs individual transfers
              </span>
            </div>
            <span className="text-xs font-mono text-black-400">
              Batched calldata
            </span>
          </div>
        </motion.div>

        {/* Tab Switcher */}
        <div className="flex mb-4 p-1 rounded-xl bg-black-800/60 border border-black-700/50">
          {['send', 'history'].map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`flex-1 py-2 rounded-lg text-sm font-medium transition-all ${
                tab === t
                  ? 'bg-black-700 text-white shadow-sm'
                  : 'text-black-400 hover:text-black-200'
              }`}
            >
              {t === 'send' ? 'Multi-Send' : 'History'}
            </button>
          ))}
        </div>

        <AnimatePresence mode="wait">
          {tab === 'send' ? (
            <motion.div
              key="send"
              initial={{ opacity: 0, x: -10 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: 10 }}
              transition={{ duration: 0.18 }}
            >
              {/* Not Connected State */}
              {!isConnected ? (
                <GlassCard className="p-8">
                  <div className="text-center">
                    <motion.div
                      animate={{ scale: [1, 1.05, 1] }}
                      transition={{ repeat: Infinity, duration: PHI * 2 }}
                      className="w-16 h-16 mx-auto mb-4 rounded-2xl flex items-center justify-center"
                      style={{ backgroundColor: CYAN + '15', border: `1px solid ${CYAN}33` }}
                    >
                      <svg className="w-8 h-8" style={{ color: CYAN }} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M17 9V7a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2m2 4h10a2 2 0 002-2v-6a2 2 0 00-2-2H9a2 2 0 00-2 2v6a2 2 0 002 2zm7-5a2 2 0 11-4 0 2 2 0 014 0z" />
                      </svg>
                    </motion.div>
                    <h2 className="text-xl font-bold text-white mb-2">Connect Wallet</h2>
                    <p className="text-black-400 text-sm mb-6 max-w-sm mx-auto">
                      Connect your wallet to send tokens to multiple recipients in a single gas-efficient transaction.
                    </p>
                    <motion.button
                      whileHover={{ scale: 1.02 }}
                      whileTap={{ scale: 0.98 }}
                      onClick={connect}
                      className="px-8 py-3 rounded-xl font-semibold text-sm transition-colors"
                      style={{ backgroundColor: CYAN + '22', color: CYAN, border: `1px solid ${CYAN}33` }}
                    >
                      Connect Wallet
                    </motion.button>
                  </div>
                </GlassCard>
              ) : (
                <>
                  {/* Token Selector */}
                  <GlassCard className="p-4 mb-4">
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-sm text-black-400">Token</span>
                      <div className="relative">
                        <button
                          onClick={() => setShowTokenDD(!showTokenDD)}
                          className="flex items-center space-x-2 px-3 py-2 rounded-xl bg-black-700 hover:bg-black-600 transition-colors"
                        >
                          <span className="text-base">{selectedToken.logo}</span>
                          <span className="text-sm font-medium">{selectedToken.symbol}</span>
                          <svg
                            className={`w-4 h-4 text-black-400 transition-transform ${showTokenDD ? 'rotate-180' : ''}`}
                            fill="none" viewBox="0 0 24 24" stroke="currentColor"
                          >
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                          </svg>
                        </button>
                        <AnimatePresence>
                          {showTokenDD && (
                            <>
                              <div className="fixed inset-0 z-40" onClick={() => setShowTokenDD(false)} />
                              <motion.div
                                initial={{ opacity: 0, y: -4 }}
                                animate={{ opacity: 1, y: 0 }}
                                exit={{ opacity: 0, y: -4 }}
                                className="absolute top-full right-0 mt-2 w-48 rounded-xl glass-card shadow-xl py-2 z-50"
                              >
                                {TOKENS.map((t) => (
                                  <button
                                    key={t.symbol}
                                    onClick={() => { setSelectedToken(t); setShowTokenDD(false) }}
                                    className={`w-full flex items-center space-x-3 px-4 py-2.5 hover:bg-black-700 transition-colors ${
                                      selectedToken.symbol === t.symbol ? 'bg-matrix-500/10' : ''
                                    }`}
                                  >
                                    <span className="text-lg">{t.logo}</span>
                                    <div className="text-left">
                                      <div className="text-sm font-medium">{t.symbol}</div>
                                      <div className="text-xs text-black-400">{t.name}</div>
                                    </div>
                                  </button>
                                ))}
                              </motion.div>
                            </>
                          )}
                        </AnimatePresence>
                      </div>
                    </div>
                  </GlassCard>

                  {/* Recipient List */}
                  <GlassCard className="p-4 mb-4">
                    <div className="flex items-center justify-between mb-3">
                      <span className="text-sm font-medium text-white">Recipients</span>
                      <div className="flex items-center space-x-2">
                        {/* CSV Import */}
                        <div className="relative">
                          <button
                            onClick={handleCsvImport}
                            onMouseEnter={() => setCsvTooltip(true)}
                            onMouseLeave={() => setCsvTooltip(false)}
                            className="flex items-center space-x-1.5 px-3 py-1.5 rounded-lg bg-black-700 hover:bg-black-600 transition-colors text-xs text-black-300 hover:text-white"
                          >
                            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
                            </svg>
                            <span>Import CSV</span>
                          </button>
                          <AnimatePresence>
                            {csvTooltip && (
                              <motion.div
                                initial={{ opacity: 0, y: 4 }}
                                animate={{ opacity: 1, y: 0 }}
                                exit={{ opacity: 0, y: 4 }}
                                className="absolute top-full right-0 mt-2 w-52 p-3 rounded-xl glass-card shadow-xl z-50"
                              >
                                <p className="text-xs text-black-300 mb-2">CSV Format:</p>
                                <code className="block text-[10px] font-mono text-black-400 bg-black-900 p-2 rounded-lg">
                                  address,amount<br />
                                  0x742d...5f2b,1.5<br />
                                  0x53d2...8a3D,2.0
                                </code>
                              </motion.div>
                            )}
                          </AnimatePresence>
                        </div>
                      </div>
                    </div>

                    {/* Column Headers */}
                    <div className="flex items-center gap-2 mb-2 text-[10px] font-mono text-black-500 uppercase tracking-wider">
                      <div className="w-6">#</div>
                      <div className="flex-1">Address</div>
                      <div className="w-28">Amount</div>
                      <div className="w-10" />
                    </div>

                    {/* Rows */}
                    <AnimatePresence>
                      {recipients.map((row, i) => (
                        <RecipientRow
                          key={row.id}
                          row={row}
                          index={i}
                          onChange={handleRowChange}
                          onRemove={handleRemoveRow}
                          canRemove={recipients.length > 1}
                        />
                      ))}
                    </AnimatePresence>

                    {/* Add Recipient */}
                    <motion.button
                      whileHover={{ scale: 1.01 }}
                      whileTap={{ scale: 0.99 }}
                      onClick={handleAddRow}
                      className="w-full mt-2 py-2.5 rounded-xl border border-dashed border-black-600 hover:border-black-500 text-black-400 hover:text-black-200 text-sm font-medium transition-colors flex items-center justify-center space-x-2"
                    >
                      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                      </svg>
                      <span>Add Recipient</span>
                    </motion.button>
                  </GlassCard>

                  {/* Summary */}
                  <GlassCard className="p-4 mb-4">
                    <div className="flex items-center space-x-2 mb-3">
                      <svg className="w-4 h-4 text-black-300" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 7h6m0 10v-3m-3 3h.01M9 17h.01M9 14h.01M12 14h.01M15 11h.01M12 11h.01M9 11h.01M7 21h10a2 2 0 002-2V5a2 2 0 00-2-2H7a2 2 0 00-2 2v14a2 2 0 002 2z" />
                      </svg>
                      <span className="text-sm font-medium text-white">Summary</span>
                    </div>

                    <div className="space-y-3 p-3 rounded-xl bg-black-900/50">
                      <Row
                        l="Valid Recipients"
                        r={
                          <span className="font-mono text-white">
                            {validRecipients.length}
                            <span className="text-black-500"> / {recipients.length}</span>
                          </span>
                        }
                      />
                      <Row
                        l="Total Amount"
                        r={
                          <span className="font-mono text-white">
                            {totalAmount} {selectedToken.symbol}
                          </span>
                        }
                      />
                      <Row
                        l="Est. Gas Cost"
                        r={
                          <span className="font-mono text-black-300">
                            ~{gas.estimatedGwei} ETH
                          </span>
                        }
                      />
                      <Row
                        l="Protocol Fee"
                        r={<span className="text-matrix-500 font-medium">Free</span>}
                      />
                      <div className="border-t border-black-700 pt-2">
                        <Row
                          l="Gas Savings"
                          r={
                            <span className="font-medium" style={{ color: CYAN }}>
                              ~{gas.savingsPercent}% cheaper
                            </span>
                          }
                        />
                      </div>
                    </div>
                  </GlassCard>

                  {/* Send Button */}
                  <motion.button
                    whileHover={canSend ? { scale: 1.01 } : {}}
                    whileTap={canSend ? { scale: 0.99 } : {}}
                    onClick={handleSend}
                    disabled={!canSend}
                    className={`w-full py-4 rounded-xl text-lg font-semibold transition-all ${
                      canSend
                        ? 'text-white shadow-lg'
                        : 'bg-black-700 text-black-500 cursor-not-allowed border border-black-600'
                    }`}
                    style={
                      canSend
                        ? {
                            backgroundColor: CYAN + '22',
                            color: CYAN,
                            border: `1px solid ${CYAN}44`,
                            boxShadow: `0 0 30px -10px ${CYAN}33`,
                          }
                        : {}
                    }
                  >
                    {canSend
                      ? `Send to ${validRecipients.length} Recipient${validRecipients.length !== 1 ? 's' : ''}`
                      : 'Enter recipients to continue'}
                  </motion.button>

                  {/* Batch info */}
                  <div className="mt-3 flex items-center justify-center space-x-2 text-xs text-black-500">
                    <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                    <span>All transfers execute atomically in one transaction</span>
                  </div>
                </>
              )}
            </motion.div>
          ) : (
            <motion.div
              key="history"
              initial={{ opacity: 0, x: 10 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -10 }}
              transition={{ duration: 0.18 }}
            >
              {/* History Tab */}
              <div className="space-y-3">
                {isConnected && <div className="text-center py-6 text-black-500 text-sm font-mono">No multi-send history yet</div>}
                {(isConnected ? [] : MOCK_HISTORY).map((tx, i) => {
                  const tokenDef = TOKENS.find((t) => t.symbol === tx.token) || TOKENS[0]
                  return (
                    <motion.div
                      key={tx.id}
                      initial={{ opacity: 0, y: 8 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ delay: i * (1 / (PHI * PHI * PHI * PHI)) }}
                    >
                      <GlassCard className="p-4">
                        <div className="flex items-center justify-between mb-3">
                          <div className="flex items-center space-x-3">
                            <div
                              className="w-10 h-10 rounded-full flex items-center justify-center text-sm font-bold"
                              style={{ backgroundColor: CYAN + '18', color: CYAN }}
                            >
                              {tokenDef.logo}
                            </div>
                            <div>
                              <div className="text-sm font-medium text-white">
                                {tx.totalAmount} {tx.token}
                              </div>
                              <div className="text-xs text-black-400">
                                {tx.recipients} recipients
                              </div>
                            </div>
                          </div>
                          <div className="text-right">
                            <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-medium bg-green-500/10 text-green-400 border border-green-500/20">
                              Completed
                            </span>
                            <div className="text-[10px] text-black-500 mt-0.5 font-mono">
                              {tx.date}
                            </div>
                          </div>
                        </div>
                        <div className="flex items-center justify-between pt-2 border-t border-black-700/50 text-[10px] text-black-500">
                          <span className="font-mono">{tx.txHash}</span>
                          <button
                            onClick={() => navigator.clipboard?.writeText(tx.txHash)}
                            className="text-black-400 hover:text-black-200 transition-colors"
                          >
                            Copy
                          </button>
                        </div>
                      </GlassCard>
                    </motion.div>
                  )
                })}

                {/* Stats footer */}
                <div className="mt-4 p-4 rounded-xl bg-black-800/40 border border-black-700/30">
                  <div className="grid grid-cols-3 gap-4 text-center">
                    <div>
                      <div className="text-lg font-bold font-mono text-white">
                        {isConnected ? 0 : MOCK_HISTORY.length}
                      </div>
                      <div className="text-[10px] text-black-500 uppercase tracking-wider">
                        Batches
                      </div>
                    </div>
                    <div>
                      <div className="text-lg font-bold font-mono text-white">
                        {isConnected ? 0 : MOCK_HISTORY.reduce((s, tx) => s + tx.recipients, 0)}
                      </div>
                      <div className="text-[10px] text-black-500 uppercase tracking-wider">
                        Recipients
                      </div>
                    </div>
                    <div>
                      <div className="text-lg font-bold font-mono" style={{ color: CYAN }}>
                        ~40%
                      </div>
                      <div className="text-[10px] text-black-500 uppercase tracking-wider">
                        Gas Saved
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Confirmation Modal */}
        <AnimatePresence>
          {showConfirm && (
            <ConfirmModal
              token={selectedToken}
              recipients={validRecipients.length}
              totalAmount={totalAmount}
              gasEstimate={gas.estimatedGwei}
              onConfirm={confirmSend}
              onClose={() => setShowConfirm(false)}
            />
          )}
        </AnimatePresence>
      </div>
    </div>
  )
}
