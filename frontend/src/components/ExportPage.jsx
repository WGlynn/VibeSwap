import { useState } from 'react'
import { motion } from 'framer-motion'
import { useWallet } from '../hooks/useWallet'
import { useDeviceWallet } from '../hooks/useDeviceWallet'
import GlassCard from './ui/GlassCard'
import PageHero from './ui/PageHero'

const PHI = 1.618033988749895
const CYAN = '#06b6d4'

// ============ Export Format Definitions ============
const EXPORT_FORMATS = [
  {
    id: 'csv',
    name: 'CSV',
    description: 'Comma-separated values. Compatible with Excel, Google Sheets, and most tax software.',
    icon: (
      <svg className="w-8 h-8" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M3 10h18M3 14h18M3 6h18M3 18h18" />
      </svg>
    ),
    ext: '.csv',
  },
  {
    id: 'json',
    name: 'JSON',
    description: 'Structured data format. Ideal for developers and automated pipeline ingestion.',
    icon: (
      <svg className="w-8 h-8" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M17.25 6.75L22.5 12l-5.25 5.25m-10.5 0L1.5 12l5.25-5.25m7.5-3l-4.5 16.5" />
      </svg>
    ),
    ext: '.json',
  },
  {
    id: 'pdf',
    name: 'PDF',
    description: 'Formatted report with summary tables. Ready for accountants and filing.',
    icon: (
      <svg className="w-8 h-8" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m2.25 0H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" />
      </svg>
    ),
    ext: '.pdf',
  },
]

// ============ Data Type Definitions ============
const DATA_TYPES = [
  { id: 'swaps', label: 'Swaps', description: 'Token swap transactions' },
  { id: 'lp', label: 'LP Transactions', description: 'Liquidity adds/removes' },
  { id: 'bridge', label: 'Bridge Transfers', description: 'Cross-chain transfers' },
  { id: 'rewards', label: 'Rewards', description: 'Staking & incentive rewards' },
  { id: 'gas', label: 'Gas Fees', description: 'Network transaction fees' },
]

// ============ Tax Service Definitions ============
const TAX_SERVICES = [
  { name: 'CoinTracker', color: '#4F46E5' },
  { name: 'Koinly', color: '#00C48C' },
  { name: 'TaxBit', color: '#2563EB' },
  { name: 'ZenLedger', color: '#8B5CF6' },
]

// ============ Mock Export History ============
const MOCK_HISTORY = [
  { id: 1, date: '2026-03-01', format: 'CSV', size: '24.3 KB', filename: 'vibeswap_export_2026-03-01.csv' },
  { id: 2, date: '2026-02-15', format: 'PDF', size: '118.7 KB', filename: 'vibeswap_report_2026-02-15.pdf' },
  { id: 3, date: '2026-01-31', format: 'JSON', size: '41.2 KB', filename: 'vibeswap_export_2026-01-31.json' },
]

// ============ Mock Tax Summary ============
const TAX_SUMMARY = {
  year: 2025,
  totalGains: 12847.32,
  totalLosses: 3291.18,
  netGainLoss: 9556.14,
  shortTerm: 6102.44,
  longTerm: 3453.70,
  totalTransactions: 247,
}

// ============ Helpers ============
function fmtUsd(val) {
  return '$' + val.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

// ============ Main Component ============
export default function ExportPage() {
  const { isConnected: isExternalConnected, connect } = useWallet()
  const { isConnected: isDeviceConnected } = useDeviceWallet()
  const isConnected = isExternalConnected || isDeviceConnected

  const [startDate, setStartDate] = useState('2025-01-01')
  const [endDate, setEndDate] = useState('2025-12-31')
  const [selectedTypes, setSelectedTypes] = useState(['swaps', 'lp', 'bridge', 'rewards', 'gas'])
  const [exportingId, setExportingId] = useState(null)

  const toggleType = (id) => {
    setSelectedTypes((prev) =>
      prev.includes(id) ? prev.filter((t) => t !== id) : [...prev, id]
    )
  }

  const handleExport = (formatId) => {
    setExportingId(formatId)
    setTimeout(() => setExportingId(null), PHI * 1000)
  }

  const handleRedownload = (historyId) => {
    setExportingId('history-' + historyId)
    setTimeout(() => setExportingId(null), PHI * 1000)
  }

  // ============ Not Connected State ============
  if (!isConnected) {
    return (
      <div className="max-w-4xl mx-auto px-4">
        <PageHero
          title="Export & Tax Reporting"
          subtitle="Download transaction history and generate tax reports"
          category="system"
          badge="Beta"
          badgeColor={CYAN}
        />
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 1 / PHI, ease: [0.25, 0.1, 1 / PHI, 1] }}
        >
          <GlassCard className="p-12" glowColor="terminal" spotlight>
            <div className="text-center">
              <svg
                className="w-16 h-16 mx-auto mb-4 text-black-600"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={1}
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M16.5 10.5V6.75a4.5 4.5 0 10-9 0v3.75m-.75 11.25h10.5a2.25 2.25 0 002.25-2.25v-6.75a2.25 2.25 0 00-2.25-2.25H6.75a2.25 2.25 0 00-2.25 2.25v6.75a2.25 2.25 0 002.25 2.25z"
                />
              </svg>
              <h2 className="text-xl font-semibold text-white mb-2">Connect Wallet</h2>
              <p className="text-black-400 text-sm mb-6 max-w-md mx-auto">
                Connect your wallet to export transaction history and generate tax reports for your VibeSwap activity.
              </p>
              <motion.button
                onClick={connect}
                whileHover={{ scale: 1.02 }}
                whileTap={{ scale: 0.98 }}
                className="px-8 py-3 rounded-xl font-medium text-white border transition-colors"
                style={{
                  backgroundColor: CYAN + '18',
                  borderColor: CYAN + '40',
                }}
              >
                Connect Wallet
              </motion.button>
            </div>
          </GlassCard>
        </motion.div>
      </div>
    )
  }

  // ============ Connected State ============
  return (
    <div className="max-w-4xl mx-auto px-4 pb-12">
      <PageHero
        title="Export & Tax Reporting"
        subtitle="Download transaction history and generate tax reports"
        category="system"
        badge="Beta"
        badgeColor={CYAN}
      />

      {/* ============ Date Range ============ */}
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 1 / PHI, delay: 0.05 }}
      >
        <GlassCard className="p-5 mb-4" glowColor="terminal">
          <div className="flex items-center space-x-2 mb-4">
            <svg className="w-4 h-4 text-black-300" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M6.75 3v2.25M17.25 3v2.25M3 18.75V7.5a2.25 2.25 0 012.25-2.25h13.5A2.25 2.25 0 0121 7.5v11.25m-18 0A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75m-18 0v-7.5A2.25 2.25 0 015.25 9h13.5A2.25 2.25 0 0121 11.25v7.5"
              />
            </svg>
            <span className="text-sm font-medium text-white">Date Range</span>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-mono text-black-400 mb-1.5">Start Date</label>
              <input
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                className="w-full px-3 py-2.5 rounded-xl bg-black-800 border border-black-700 text-white font-mono text-sm outline-none focus:border-cyan-500/40 transition-colors"
              />
            </div>
            <div>
              <label className="block text-xs font-mono text-black-400 mb-1.5">End Date</label>
              <input
                type="date"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
                className="w-full px-3 py-2.5 rounded-xl bg-black-800 border border-black-700 text-white font-mono text-sm outline-none focus:border-cyan-500/40 transition-colors"
              />
            </div>
          </div>
        </GlassCard>
      </motion.div>

      {/* ============ Data Types ============ */}
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 1 / PHI, delay: 0.1 }}
      >
        <GlassCard className="p-5 mb-4" glowColor="terminal">
          <div className="flex items-center space-x-2 mb-4">
            <svg className="w-4 h-4 text-black-300" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M3.75 12h16.5m-16.5 3.75h16.5M3.75 19.5h16.5M5.625 4.5h12.75a1.875 1.875 0 010 3.75H5.625a1.875 1.875 0 010-3.75z"
              />
            </svg>
            <span className="text-sm font-medium text-white">Data Types</span>
          </div>
          <div className="space-y-2">
            {DATA_TYPES.map((dt) => (
              <motion.label
                key={dt.id}
                whileHover={{ x: 2 }}
                transition={{ type: 'spring', stiffness: 400, damping: 25 }}
                className="flex items-center justify-between p-3 rounded-xl bg-black-800/50 border border-black-700/50 cursor-pointer hover:border-black-600/50 transition-colors"
              >
                <div className="flex items-center space-x-3">
                  <div
                    className={`w-5 h-5 rounded-md border-2 flex items-center justify-center transition-colors ${
                      selectedTypes.includes(dt.id)
                        ? 'border-cyan-400 bg-cyan-500/20'
                        : 'border-black-600 bg-black-900'
                    }`}
                    onClick={() => toggleType(dt.id)}
                  >
                    {selectedTypes.includes(dt.id) && (
                      <motion.svg
                        initial={{ scale: 0 }}
                        animate={{ scale: 1 }}
                        transition={{ type: 'spring', stiffness: 500, damping: 20 }}
                        className="w-3 h-3"
                        style={{ color: CYAN }}
                        fill="none"
                        viewBox="0 0 24 24"
                        stroke="currentColor"
                        strokeWidth={3}
                      >
                        <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                      </motion.svg>
                    )}
                  </div>
                  <div>
                    <span className="text-sm font-medium text-white">{dt.label}</span>
                    <span className="text-xs text-black-500 ml-2">{dt.description}</span>
                  </div>
                </div>
                <input
                  type="checkbox"
                  checked={selectedTypes.includes(dt.id)}
                  onChange={() => toggleType(dt.id)}
                  className="sr-only"
                />
              </motion.label>
            ))}
          </div>
        </GlassCard>
      </motion.div>

      {/* ============ Export Formats ============ */}
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 1 / PHI, delay: 0.15 }}
      >
        <GlassCard className="p-5 mb-4" glowColor="terminal">
          <div className="flex items-center space-x-2 mb-4">
            <svg className="w-4 h-4 text-black-300" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5M16.5 12L12 16.5m0 0L7.5 12m4.5 4.5V3"
              />
            </svg>
            <span className="text-sm font-medium text-white">Export Format</span>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            {EXPORT_FORMATS.map((fmt, i) => (
              <motion.div
                key={fmt.id}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 1 / (PHI * PHI), delay: 0.2 + i * (1 / (PHI * PHI * PHI)) }}
              >
                <div className="flex flex-col items-center p-5 rounded-xl bg-black-800/50 border border-black-700/50 hover:border-cyan-500/20 transition-colors group">
                  <div
                    className="mb-3 text-black-400 group-hover:text-cyan-400 transition-colors"
                    style={{ transition: `color ${1 / PHI}s` }}
                  >
                    {fmt.icon}
                  </div>
                  <span className="text-base font-semibold font-mono text-white mb-1">{fmt.name}</span>
                  <p className="text-xs text-black-500 text-center mb-4 leading-relaxed">{fmt.description}</p>
                  <motion.button
                    onClick={() => handleExport(fmt.id)}
                    whileHover={{ scale: 1.03 }}
                    whileTap={{ scale: 0.97 }}
                    disabled={exportingId === fmt.id || selectedTypes.length === 0}
                    className="w-full py-2 rounded-lg font-mono text-sm font-medium transition-colors disabled:opacity-40"
                    style={{
                      backgroundColor: CYAN + '18',
                      borderColor: CYAN + '40',
                      color: CYAN,
                      border: '1px solid',
                    }}
                  >
                    {exportingId === fmt.id ? (
                      <motion.span
                        animate={{ opacity: [1, 0.4, 1] }}
                        transition={{ repeat: Infinity, duration: PHI }}
                      >
                        Exporting...
                      </motion.span>
                    ) : (
                      <>Download {fmt.ext}</>
                    )}
                  </motion.button>
                </div>
              </motion.div>
            ))}
          </div>
        </GlassCard>
      </motion.div>

      {/* ============ Tax Summary ============ */}
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 1 / PHI, delay: 0.2 }}
      >
        <GlassCard className="p-5 mb-4" glowColor="terminal" spotlight>
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center space-x-2">
              <svg className="w-4 h-4 text-black-300" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M2.25 18.75a60.07 60.07 0 0115.797 2.101c.727.198 1.453-.342 1.453-1.096V18.75M3.75 4.5v.75A.75.75 0 013 6h-.75m0 0v-.375c0-.621.504-1.125 1.125-1.125H20.25M2.25 6v9m18-10.5v.75c0 .414.336.75.75.75h.75m-1.5-1.5h.375c.621 0 1.125.504 1.125 1.125v9.75c0 .621-.504 1.125-1.125 1.125h-.375m1.5-1.5H21a.75.75 0 00-.75.75v.75m0 0H3.75m0 0h-.375a1.125 1.125 0 01-1.125-1.125V15m1.5 1.5v-.75A.75.75 0 003 15h-.75M15 10.5a3 3 0 11-6 0 3 3 0 016 0zm3 0h.008v.008H18V10.5zm-12 0h.008v.008H6V10.5z"
                />
              </svg>
              <span className="text-sm font-medium text-white">Tax Year Summary</span>
            </div>
            <span className="text-xs font-mono px-2.5 py-1 rounded-full bg-black-800 border border-black-700 text-black-300">
              {TAX_SUMMARY.year}
            </span>
          </div>

          <div className="grid grid-cols-2 gap-3 mb-4">
            <div className="p-3 rounded-xl bg-black-800/60 border border-black-700/40">
              <div className="text-xs font-mono text-black-500 mb-1">Total Gains</div>
              <div className="text-lg font-semibold font-mono text-green-400">{fmtUsd(TAX_SUMMARY.totalGains)}</div>
            </div>
            <div className="p-3 rounded-xl bg-black-800/60 border border-black-700/40">
              <div className="text-xs font-mono text-black-500 mb-1">Total Losses</div>
              <div className="text-lg font-semibold font-mono text-red-400">{fmtUsd(TAX_SUMMARY.totalLosses)}</div>
            </div>
          </div>

          <div className="p-4 rounded-xl bg-cyan-500/5 border border-cyan-500/15 mb-4">
            <div className="flex items-center justify-between">
              <div>
                <div className="text-xs font-mono text-black-400 mb-0.5">Net Gain/Loss</div>
                <div className="text-2xl font-bold font-mono" style={{ color: CYAN }}>
                  {fmtUsd(TAX_SUMMARY.netGainLoss)}
                </div>
              </div>
              <div className="text-right">
                <div className="text-xs font-mono text-black-500">{TAX_SUMMARY.totalTransactions} transactions</div>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="p-3 rounded-xl bg-black-800/60 border border-black-700/40">
              <div className="text-xs font-mono text-black-500 mb-1">Short-term</div>
              <div className="text-sm font-semibold font-mono text-amber-400">{fmtUsd(TAX_SUMMARY.shortTerm)}</div>
              <div className="text-[10px] font-mono text-black-600 mt-0.5">Held &lt; 1 year</div>
            </div>
            <div className="p-3 rounded-xl bg-black-800/60 border border-black-700/40">
              <div className="text-xs font-mono text-black-500 mb-1">Long-term</div>
              <div className="text-sm font-semibold font-mono text-purple-400">{fmtUsd(TAX_SUMMARY.longTerm)}</div>
              <div className="text-[10px] font-mono text-black-600 mt-0.5">Held &gt; 1 year</div>
            </div>
          </div>
        </GlassCard>
      </motion.div>

      {/* ============ Compatible Tax Services ============ */}
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 1 / PHI, delay: 0.25 }}
      >
        <GlassCard className="p-5 mb-4">
          <div className="flex items-center space-x-2 mb-4">
            <svg className="w-4 h-4 text-black-300" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M13.19 8.688a4.5 4.5 0 011.242 7.244l-4.5 4.5a4.5 4.5 0 01-6.364-6.364l1.757-1.757m9.86-3.06a4.5 4.5 0 00-6.364-6.364L4.5 8.25a4.5 4.5 0 006.364 6.364l4.5-4.5z"
              />
            </svg>
            <span className="text-sm font-medium text-white">Compatible Services</span>
          </div>
          <p className="text-xs text-black-500 mb-4">
            Export files are formatted for direct import into these tax platforms.
          </p>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {TAX_SERVICES.map((svc, i) => (
              <motion.div
                key={svc.name}
                initial={{ opacity: 0, scale: 0.9 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{ duration: 1 / (PHI * PHI), delay: 0.3 + i * 0.06 }}
                className="flex flex-col items-center p-4 rounded-xl bg-black-800/50 border border-black-700/50 hover:border-black-600 transition-colors"
              >
                <div
                  className="w-10 h-10 rounded-xl flex items-center justify-center text-lg font-bold font-mono mb-2"
                  style={{ backgroundColor: svc.color + '22', color: svc.color }}
                >
                  {svc.name.charAt(0)}
                </div>
                <span className="text-xs font-medium text-black-300 text-center">{svc.name}</span>
                <div className="flex items-center space-x-1 mt-1.5">
                  <div className="w-1.5 h-1.5 rounded-full bg-green-400" />
                  <span className="text-[9px] text-green-400 font-mono">Supported</span>
                </div>
              </motion.div>
            ))}
          </div>
        </GlassCard>
      </motion.div>

      {/* ============ Export History ============ */}
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 1 / PHI, delay: 0.3 }}
      >
        <GlassCard className="p-5">
          <div className="flex items-center space-x-2 mb-4">
            <svg className="w-4 h-4 text-black-300" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M12 6v6h4.5m4.5 0a9 9 0 11-18 0 9 9 0 0118 0z"
              />
            </svg>
            <span className="text-sm font-medium text-white">Export History</span>
          </div>
          <div className="space-y-2">
            {MOCK_HISTORY.map((item, i) => (
              <motion.div
                key={item.id}
                initial={{ opacity: 0, x: -8 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ duration: 1 / (PHI * PHI), delay: 0.35 + i * (1 / (PHI * PHI * PHI)) }}
                className="flex items-center justify-between p-3 rounded-xl bg-black-800/50 border border-black-700/50"
              >
                <div className="flex items-center space-x-3">
                  <div
                    className="w-9 h-9 rounded-lg flex items-center justify-center text-xs font-bold font-mono"
                    style={{
                      backgroundColor: CYAN + '15',
                      color: CYAN,
                    }}
                  >
                    {item.format}
                  </div>
                  <div>
                    <div className="text-sm font-mono text-white">{item.filename}</div>
                    <div className="flex items-center space-x-2 text-[10px] text-black-500 font-mono mt-0.5">
                      <span>{item.date}</span>
                      <span className="text-black-700">|</span>
                      <span>{item.size}</span>
                    </div>
                  </div>
                </div>
                <motion.button
                  onClick={() => handleRedownload(item.id)}
                  whileHover={{ scale: 1.05 }}
                  whileTap={{ scale: 0.95 }}
                  disabled={exportingId === 'history-' + item.id}
                  className="px-3 py-1.5 rounded-lg text-xs font-mono font-medium transition-colors disabled:opacity-40"
                  style={{
                    backgroundColor: CYAN + '12',
                    borderColor: CYAN + '30',
                    color: CYAN,
                    border: '1px solid',
                  }}
                >
                  {exportingId === 'history-' + item.id ? (
                    <motion.span
                      animate={{ opacity: [1, 0.4, 1] }}
                      transition={{ repeat: Infinity, duration: PHI }}
                    >
                      ...
                    </motion.span>
                  ) : (
                    'Re-download'
                  )}
                </motion.button>
              </motion.div>
            ))}
          </div>
        </GlassCard>
      </motion.div>
    </div>
  )
}
