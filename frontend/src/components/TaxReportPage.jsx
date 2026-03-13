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

// ============ Seeded PRNG ============

function seededRandom(seed) {
  let s = seed
  return () => {
    s = (s * 16807 + 0) % 2147483647
    return s / 2147483647
  }
}

// ============ Animation Variants ============

const sectionVariants = {
  hidden: () => ({ opacity: 0, y: 24, filter: 'blur(4px)' }),
  visible: (i) => ({
    opacity: 1, y: 0, filter: 'blur(0px)',
    transition: { delay: i * 0.12 / PHI, duration: 0.5, ease: 'easeOut' },
  }),
}

// ============ Transaction Types ============

const TX_TYPES = {
  trade: { label: 'Trade', color: '#06b6d4' },
  stake: { label: 'Stake', color: '#8b5cf6' },
  farm: { label: 'Farm', color: '#22c55e' },
  airdrop: { label: 'Airdrop', color: '#f59e0b' },
  bridge: { label: 'Bridge', color: '#3b82f6' },
  lp_entry: { label: 'LP Entry', color: '#14b8a6' },
  lp_exit: { label: 'LP Exit', color: '#f97316' },
  liquidation: { label: 'Liquidation', color: '#ef4444' },
}

// ============ Mock Data Generators ============

function generateMockTransactions(year, rng) {
  const pairs = ['ETH/USDC', 'BTC/USDC', 'JUL/ETH', 'ETH/DAI', 'MATIC/USDC', 'ARB/ETH', 'OP/USDC', 'JUL/USDC', 'SOL/USDC', 'AVAX/ETH']
  const types = ['trade', 'trade', 'trade', 'stake', 'farm', 'airdrop', 'bridge', 'trade', 'trade', 'lp_entry']
  const txs = []
  for (let i = 0; i < 24; i++) {
    const month = Math.floor(rng() * 12) + 1, day = Math.floor(rng() * 28) + 1
    const type = types[Math.floor(rng() * types.length)]
    const costBasis = +(rng() * 5000 + 200).toFixed(2)
    const proceeds = +(costBasis * (1 + (rng() - 0.4) * 0.6)).toFixed(2)
    const holdingDays = Math.floor(rng() * 500) + 1
    txs.push({
      id: i + 1,
      date: `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`,
      type, pair: pairs[Math.floor(rng() * pairs.length)],
      amount: +(rng() * 10 + 0.1).toFixed(4), costBasis, proceeds,
      gainLoss: +(proceeds - costBasis).toFixed(2), holdingDays,
      holdingPeriod: holdingDays > 365 ? 'Long-term' : 'Short-term',
    })
  }
  return txs.sort((a, b) => a.date.localeCompare(b.date))
}

function generateDefiActivity() {
  return {
    lpEntries: [
      { pool: 'ETH/USDC', date: '2025-02-14', valueIn: 8_420, currentValue: 9_105, fees: 312.40, il: -87.20 },
      { pool: 'JUL/ETH', date: '2025-04-22', valueIn: 3_200, currentValue: 3_680, fees: 145.80, il: -42.10 },
      { pool: 'BTC/USDC', date: '2025-07-08', valueIn: 12_600, currentValue: 14_220, fees: 528.90, il: -156.30 },
    ],
    lpExits: [
      { pool: 'MATIC/USDC', date: '2025-09-03', valueIn: 2_100, valueOut: 2_480, fees: 89.40, il: -31.20, gainLoss: 380 },
      { pool: 'ARB/ETH', date: '2025-11-17', valueIn: 4_800, valueOut: 4_320, fees: 201.60, il: -112.50, gainLoss: -480 },
    ],
    farmingRewards: [
      { token: 'JUL', amount: 2_450, value: 1_837.50, source: 'ETH/USDC LP Staking' },
      { token: 'VIBE', amount: 890, value: 445.00, source: 'Governance Staking' },
      { token: 'JUL', amount: 1_200, value: 900.00, source: 'JUL/ETH LP Farming' },
    ],
    liquidations: [
      { date: '2025-06-12', asset: 'ETH', collateral: 5_200, debt: 3_800, penalty: 520, lossRealized: -1_920 },
    ],
    airdrops: [
      { date: '2025-03-01', token: 'JUL', amount: 5_000, valueAtReceipt: 3_750, source: 'Early Adopter Airdrop' },
      { date: '2025-08-15', token: 'VIBE', amount: 1_200, valueAtReceipt: 600, source: 'Governance Participation' },
    ],
  }
}

// ============ Config Arrays ============

const COST_BASIS_METHODS = [
  { value: 'fifo', label: 'FIFO', desc: 'First-In, First-Out' },
  { value: 'lifo', label: 'LIFO', desc: 'Last-In, First-Out' },
  { value: 'hifo', label: 'HIFO', desc: 'Highest-In, First-Out' },
  { value: 'acb', label: 'ACB', desc: 'Average Cost Basis' },
]

const JURISDICTIONS = [
  { value: 'us', label: 'United States', flag: 'US' },
  { value: 'uk', label: 'United Kingdom', flag: 'UK' },
  { value: 'eu', label: 'European Union', flag: 'EU' },
  { value: 'au', label: 'Australia', flag: 'AU' },
]

const EXPORT_FORMATS = [
  { value: 'csv', label: 'CSV', desc: 'Spreadsheet format' },
  { value: 'pdf', label: 'PDF', desc: 'Printable report' },
  { value: 'turbotax', label: 'TurboTax', desc: 'Form 8949 import' },
  { value: 'koinly', label: 'Koinly', desc: 'Koinly-compatible' },
]

const OPTIMIZATION_TIPS = [
  { title: 'Tax-Loss Harvesting', description: 'Sell underperforming assets before year-end to offset gains. Repurchase after 30 days to avoid wash sale rules (US). Can offset up to $3,000 in ordinary income annually.', impact: 'high', tag: 'strategy' },
  { title: 'Hold for Long-Term Rates', description: 'Assets held over 365 days qualify for long-term capital gains rates (0%, 15%, or 20% vs ordinary income rates). Consider delaying sales if near the threshold.', impact: 'high', tag: 'timing' },
  { title: 'HIFO Cost Basis Method', description: 'Highest-In-First-Out minimizes realized gains by selling highest cost-basis lots first. Switch from FIFO to reduce current year tax liability.', impact: 'medium', tag: 'method' },
  { title: 'Charitable Donations', description: 'Donate appreciated crypto directly to qualified charities. Deduct full fair market value without paying capital gains tax on the appreciation.', impact: 'medium', tag: 'strategy' },
  { title: 'Harvest Impermanent Loss', description: 'Exit LP positions with significant IL to realize the loss for tax purposes. Re-enter after the wash sale window if desired.', impact: 'medium', tag: 'defi' },
  { title: 'Track DeFi Cost Basis', description: 'LP deposits, staking entries, and farming harvests each create taxable events. Accurate tracking of cost basis at time of each event prevents overpaying.', impact: 'low', tag: 'tracking' },
]

// ============ Utility Functions ============

function fmt(n) {
  if (n >= 1_000_000) return '$' + (n / 1_000_000).toFixed(2) + 'M'
  if (n >= 1_000) return '$' + (n / 1_000).toFixed(1) + 'K'
  return '$' + n.toFixed(2)
}
function fmtSigned(n) { return (n >= 0 ? '+' : '') + fmt(Math.abs(n)) }

// ============ Sub-Components ============

function Section({ index, title, tag, children, glowColor = 'terminal' }) {
  return (
    <motion.div custom={index} variants={sectionVariants} initial="hidden" animate="visible">
      <GlassCard glowColor={glowColor} spotlight hover={false} className="p-5 md:p-6">
        <div className="mb-5">
          <span className="text-[10px] font-mono text-cyan-400/70 uppercase tracking-wider">{tag}</span>
          <h2 className="text-sm md:text-base font-bold font-mono tracking-wider uppercase mt-1" style={{ color: CYAN }}>{title}</h2>
          <div className="h-px mt-3" style={{ background: `linear-gradient(90deg, ${CYAN}40, transparent)` }} />
        </div>
        {children}
      </GlassCard>
    </motion.div>
  )
}

function StatBox({ label, value, color }) {
  return (
    <div className="rounded-xl bg-black-800/40 border border-black-700/30 p-4">
      <div className="text-[10px] font-mono text-black-500 uppercase tracking-wider mb-1">{label}</div>
      <div className={`text-lg font-bold font-mono ${color || 'text-black-200'}`}>{value}</div>
    </div>
  )
}

function ImpactBadge({ level }) {
  const m = { high: 'bg-green-500/15 text-green-400 border-green-500/30', medium: 'bg-cyan-500/15 text-cyan-400 border-cyan-500/30', low: 'bg-gray-500/15 text-gray-400 border-gray-500/30' }
  return <span className={`px-2 py-0.5 rounded-full text-[10px] font-mono uppercase border ${m[level] || m.low}`}>{level}</span>
}

function OptionButton({ selected, onClick, label, desc, children }) {
  return (
    <button onClick={onClick} className={`px-3 py-2.5 rounded-lg text-left border transition-all ${selected ? 'border-cyan-500/50 bg-cyan-500/10' : 'border-black-700/50 bg-black-800/40 hover:border-black-600'}`}>
      <div className={`text-xs font-mono font-bold ${selected ? 'text-cyan-400' : 'text-black-300'}`}>{label}</div>
      {desc && <div className="text-[10px] font-mono text-black-500 mt-0.5">{desc}</div>}
      {children}
    </button>
  )
}

function DefiCard({ children, variant, className = '' }) {
  const border = variant === 'danger' ? 'border-red-500/20 bg-red-500/5' : 'border-black-700/30 bg-black-800/40'
  return <div className={`rounded-lg ${border} p-3 ${className}`}>{children}</div>
}

function KVRow({ label, value, color = 'text-black-400' }) {
  return (
    <div className="flex justify-between text-[11px] font-mono">
      <span className="text-black-500">{label}</span>
      <span className={color}>{value}</span>
    </div>
  )
}

// ============ Main Component ============

export default function TaxReportPage() {
  const { isConnected: isExternalConnected } = useWallet()
  const { isConnected: isDeviceConnected } = useDeviceWallet()
  const isConnected = isExternalConnected || isDeviceConnected

  const [selectedYear, setSelectedYear] = useState(2025)
  const [costBasisMethod, setCostBasisMethod] = useState('fifo')
  const [jurisdiction, setJurisdiction] = useState('us')
  const [exportFormat, setExportFormat] = useState('csv')
  const [isGenerating, setIsGenerating] = useState(false)
  const [reportGenerated, setReportGenerated] = useState(false)
  const [expandedTip, setExpandedTip] = useState(null)
  const [txFilter, setTxFilter] = useState('all')

  const rng = useMemo(() => seededRandom(selectedYear * 1000 + 42), [selectedYear])
  const transactions = useMemo(() => generateMockTransactions(selectedYear, rng), [selectedYear])
  const defiActivity = useMemo(() => generateDefiActivity(), [selectedYear])
  const filteredTxs = useMemo(() => txFilter === 'all' ? transactions : transactions.filter(tx => tx.type === txFilter), [transactions, txFilter])

  // ============ Tax Summary ============

  const summary = useMemo(() => {
    const gains = transactions.filter(t => t.gainLoss > 0).reduce((s, t) => s + t.gainLoss, 0)
    const losses = transactions.filter(t => t.gainLoss < 0).reduce((s, t) => s + t.gainLoss, 0)
    const stGains = transactions.filter(t => t.holdingPeriod === 'Short-term' && t.gainLoss > 0).reduce((s, t) => s + t.gainLoss, 0)
    const stLosses = transactions.filter(t => t.holdingPeriod === 'Short-term' && t.gainLoss < 0).reduce((s, t) => s + t.gainLoss, 0)
    const ltGains = transactions.filter(t => t.holdingPeriod === 'Long-term' && t.gainLoss > 0).reduce((s, t) => s + t.gainLoss, 0)
    const ltLosses = transactions.filter(t => t.holdingPeriod === 'Long-term' && t.gainLoss < 0).reduce((s, t) => s + t.gainLoss, 0)
    const farmIncome = defiActivity.farmingRewards.reduce((s, r) => s + r.value, 0)
    const airdropIncome = defiActivity.airdrops.reduce((s, a) => s + a.valueAtReceipt, 0)
    const net = gains + losses
    const totalIncome = farmIncome + airdropIncome
    const events = transactions.length + defiActivity.farmingRewards.length + defiActivity.airdrops.length + defiActivity.lpExits.length + defiActivity.liquidations.length
    const rate = { us: 0.24, uk: 0.20, eu: 0.25, au: 0.235 }[jurisdiction] || 0.24
    const tax = Math.max(0, net + totalIncome) * rate
    return { gains, losses, net, stGains, stLosses, ltGains, ltLosses, farmIncome, airdropIncome, totalIncome, events, tax, effectiveRate: (net + totalIncome) > 0 ? (tax / (net + totalIncome) * 100).toFixed(1) : '0.0' }
  }, [transactions, defiActivity, jurisdiction])

  const handleGenerate = () => {
    setIsGenerating(true); setReportGenerated(false)
    setTimeout(() => { setIsGenerating(false); setReportGenerated(true) }, 2000)
  }

  const YearTabs = ({ className = '' }) => (
    <div className={`flex gap-2 ${className}`}>
      {[2024, 2025, 2026].map(y => (
        <button key={y} onClick={() => { setSelectedYear(y); setReportGenerated(false) }}
          className={`px-4 py-1.5 rounded-lg text-xs font-mono border transition-all ${selectedYear === y ? 'border-cyan-500/50 bg-cyan-500/10 text-cyan-400' : 'border-black-700/50 bg-black-800/40 text-black-400 hover:border-black-600'}`}>{y}</button>
      ))}
    </div>
  )

  return (
    <div className="min-h-screen pb-20 font-mono">
      {/* ============ Hero ============ */}
      <PageHero title="Tax Reports" subtitle="Generate compliant crypto tax reports" category="defi" badge="Beta" badgeColor="#22c55e">
        <Link to="/activity" className="px-3 py-1.5 rounded-lg text-xs font-mono border border-black-700/50 bg-black-800/60 hover:border-cyan-500/30 transition-colors">
          View Activity
        </Link>
      </PageHero>

      <div className="max-w-7xl mx-auto px-4 space-y-6">
        {/* ============ 1. Tax Year Summary ============ */}
        <Section index={0} tag="overview" title="Tax Year Summary" glowColor="matrix">
          <YearTabs className="mb-5" />
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-5">
            <StatBox label="Net Gain/Loss" value={`${summary.net >= 0 ? '+' : ''}${fmt(Math.abs(summary.net))}`} color={summary.net >= 0 ? 'text-green-400' : 'text-red-400'} />
            <StatBox label="Total Gains" value={`+${fmt(summary.gains)}`} color="text-green-400" />
            <StatBox label="Total Losses" value={fmt(Math.abs(summary.losses))} color="text-red-400" />
            <StatBox label="Taxable Events" value={summary.events} color={`text-[${CYAN}]`} />
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            {/* Short-term */}
            <div className="rounded-xl bg-black-800/40 border border-black-700/30 p-4">
              <div className="text-[10px] font-mono text-black-500 uppercase tracking-wider mb-2">Short-term Capital</div>
              <KVRow label="Gains" value={`+${fmt(summary.stGains)}`} color="text-green-400" />
              <KVRow label="Losses" value={fmt(Math.abs(summary.stLosses))} color="text-red-400" />
              <div className="h-px my-2 bg-black-700/50" />
              <KVRow label="Net" value={fmtSigned(summary.stGains + summary.stLosses)} color={(summary.stGains + summary.stLosses) >= 0 ? 'text-green-400 font-bold' : 'text-red-400 font-bold'} />
            </div>
            {/* Long-term */}
            <div className="rounded-xl bg-black-800/40 border border-black-700/30 p-4">
              <div className="text-[10px] font-mono text-black-500 uppercase tracking-wider mb-2">Long-term Capital</div>
              <KVRow label="Gains" value={`+${fmt(summary.ltGains)}`} color="text-green-400" />
              <KVRow label="Losses" value={fmt(Math.abs(summary.ltLosses))} color="text-red-400" />
              <div className="h-px my-2 bg-black-700/50" />
              <KVRow label="Net" value={fmtSigned(summary.ltGains + summary.ltLosses)} color={(summary.ltGains + summary.ltLosses) >= 0 ? 'text-green-400 font-bold' : 'text-red-400 font-bold'} />
            </div>
            {/* Income */}
            <div className="rounded-xl bg-black-800/40 border border-black-700/30 p-4">
              <div className="text-[10px] font-mono text-black-500 uppercase tracking-wider mb-2">Income (Ordinary)</div>
              <KVRow label="Staking/Farming" value={`+${fmt(summary.farmIncome)}`} color="text-green-400" />
              <KVRow label="Airdrops" value={`+${fmt(summary.airdropIncome)}`} color="text-green-400" />
              <div className="h-px my-2 bg-black-700/50" />
              <KVRow label="Total Income" value={`+${fmt(summary.totalIncome)}`} color="text-green-400 font-bold" />
            </div>
          </div>

          {/* Estimated tax */}
          <div className="mt-4 rounded-xl bg-black-800/40 border border-black-700/30 p-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
            <div>
              <div className="text-[10px] font-mono text-black-500 uppercase tracking-wider mb-1">Estimated Tax Liability</div>
              <div className="text-xl font-bold font-mono" style={{ color: CYAN }}>{fmt(summary.tax)}</div>
            </div>
            <div className="flex items-center gap-4 text-right">
              <div>
                <div className="text-[10px] font-mono text-black-500 uppercase tracking-wider">Effective Rate</div>
                <div className="text-sm font-mono text-black-300">{summary.effectiveRate}%</div>
              </div>
              <div>
                <div className="text-[10px] font-mono text-black-500 uppercase tracking-wider">Jurisdiction</div>
                <div className="text-sm font-mono text-black-300">{JURISDICTIONS.find(j => j.value === jurisdiction)?.flag}</div>
              </div>
            </div>
          </div>
        </Section>

        {/* ============ 2. Transaction Classification ============ */}
        <Section index={1} tag="transactions" title="Transaction Classification">
          <div className="flex flex-wrap gap-1.5 mb-4">
            <button onClick={() => setTxFilter('all')} className={`px-3 py-1 rounded-lg text-[11px] font-mono border transition-all ${txFilter === 'all' ? 'border-cyan-500/50 bg-cyan-500/10 text-cyan-400' : 'border-black-700/40 bg-black-800/30 text-black-500 hover:text-black-300'}`}>All ({transactions.length})</button>
            {Object.entries(TX_TYPES).slice(0, 5).map(([key, { label }]) => {
              const count = transactions.filter(tx => tx.type === key).length
              return count > 0 ? (
                <button key={key} onClick={() => setTxFilter(key)} className={`px-3 py-1 rounded-lg text-[11px] font-mono border transition-all ${txFilter === key ? 'border-cyan-500/50 bg-cyan-500/10 text-cyan-400' : 'border-black-700/40 bg-black-800/30 text-black-500 hover:text-black-300'}`}>{label} ({count})</button>
              ) : null
            })}
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-xs font-mono">
              <thead>
                <tr className="border-b border-black-700/50">
                  {['Date', 'Type', 'Pair', 'Amount', 'Cost Basis', 'Proceeds', 'Gain/Loss', 'Holding'].map((h, i) => (
                    <th key={h} className={`py-2 px-2 text-black-500 font-normal uppercase tracking-wider text-[10px] ${i >= 4 && i <= 5 ? 'hidden sm:table-cell' : ''} ${i === 7 ? 'hidden md:table-cell' : ''} ${i >= 3 ? 'text-right' : 'text-left'}`}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filteredTxs.map((tx, idx) => (
                  <motion.tr key={tx.id} initial={{ opacity: 0, x: -8 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: idx * 0.03, duration: 0.25 }}
                    className="border-b border-black-800/50 hover:bg-black-800/30 transition-colors">
                    <td className="py-2.5 px-2 text-black-400">{tx.date}</td>
                    <td className="py-2.5 px-2">
                      <span className="px-2 py-0.5 rounded-full text-[10px] uppercase" style={{ color: TX_TYPES[tx.type]?.color, backgroundColor: (TX_TYPES[tx.type]?.color || CYAN) + '15', border: `1px solid ${TX_TYPES[tx.type]?.color || CYAN}30` }}>
                        {TX_TYPES[tx.type]?.label}
                      </span>
                    </td>
                    <td className="py-2.5 px-2 text-black-300">{tx.pair}</td>
                    <td className="py-2.5 px-2 text-right text-black-300">{tx.amount}</td>
                    <td className="py-2.5 px-2 text-right text-black-400 hidden sm:table-cell">${tx.costBasis.toLocaleString()}</td>
                    <td className="py-2.5 px-2 text-right text-black-400 hidden sm:table-cell">${tx.proceeds.toLocaleString()}</td>
                    <td className={`py-2.5 px-2 text-right font-bold ${tx.gainLoss >= 0 ? 'text-green-400' : 'text-red-400'}`}>{tx.gainLoss >= 0 ? '+' : ''}{fmt(Math.abs(tx.gainLoss))}</td>
                    <td className="py-2.5 px-2 text-right hidden md:table-cell"><span className={tx.holdingPeriod === 'Long-term' ? 'text-green-400/60' : 'text-amber-400/60'}>{tx.holdingDays}d</span></td>
                  </motion.tr>
                ))}
              </tbody>
            </table>
          </div>
          {filteredTxs.length === 0 && <div className="text-center py-8 text-black-500 text-xs font-mono">No transactions found for this filter.</div>}
        </Section>

        {/* ============ 3. Report Generator ============ */}
        <Section index={2} tag="generate" title="Report Generator" glowColor="matrix">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
            <div className="space-y-4">
              <div>
                <label className="text-[10px] font-mono text-black-500 uppercase tracking-wider block mb-2">Tax Year</label>
                <YearTabs />
              </div>
              <div>
                <label className="text-[10px] font-mono text-black-500 uppercase tracking-wider block mb-2">Cost Basis Method</label>
                <div className="grid grid-cols-2 gap-2">
                  {COST_BASIS_METHODS.map(m => <OptionButton key={m.value} selected={costBasisMethod === m.value} onClick={() => setCostBasisMethod(m.value)} label={m.label} desc={m.desc} />)}
                </div>
              </div>
              <div>
                <label className="text-[10px] font-mono text-black-500 uppercase tracking-wider block mb-2">Jurisdiction</label>
                <div className="grid grid-cols-2 gap-2">
                  {JURISDICTIONS.map(j => <OptionButton key={j.value} selected={jurisdiction === j.value} onClick={() => setJurisdiction(j.value)} label={j.flag} desc={j.label} />)}
                </div>
              </div>
            </div>

            <div className="space-y-4">
              <div>
                <label className="text-[10px] font-mono text-black-500 uppercase tracking-wider block mb-2">Export Format</label>
                <div className="space-y-2">
                  {EXPORT_FORMATS.map(ef => (
                    <OptionButton key={ef.value} selected={exportFormat === ef.value} onClick={() => setExportFormat(ef.value)} label={ef.label} desc={ef.desc}>
                      {exportFormat === ef.value && <div className="absolute right-3 top-1/2 -translate-y-1/2 w-2 h-2 rounded-full bg-cyan-400" />}
                    </OptionButton>
                  ))}
                </div>
              </div>

              <motion.button onClick={handleGenerate} disabled={isGenerating || !isConnected} whileHover={{ scale: isConnected ? 1.02 : 1 }} whileTap={{ scale: isConnected ? 0.98 : 1 }}
                className={`w-full py-3.5 rounded-xl text-sm font-mono font-bold border transition-all ${isConnected ? 'border-cyan-500/50 bg-gradient-to-r from-cyan-500/20 to-green-500/20 text-cyan-400 hover:from-cyan-500/30 hover:to-green-500/30' : 'border-black-700/50 bg-black-800/40 text-black-500 cursor-not-allowed'}`}>
                {!isConnected ? 'Connect Wallet to Generate' : isGenerating ? 'Generating Report...' : reportGenerated ? 'Regenerate Report' : 'Generate Tax Report'}
              </motion.button>

              {isGenerating && (
                <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="rounded-xl bg-black-800/40 border border-black-700/30 p-4">
                  <div className="flex items-center gap-3">
                    <div className="w-4 h-4 border-2 border-cyan-400 border-t-transparent rounded-full animate-spin" />
                    <span className="text-xs font-mono text-black-400">Analyzing {summary.events} taxable events...</span>
                  </div>
                  <div className="mt-3 h-1 rounded-full bg-black-700/50 overflow-hidden">
                    <motion.div initial={{ width: '0%' }} animate={{ width: '100%' }} transition={{ duration: 2, ease: 'easeInOut' }} className="h-full rounded-full" style={{ background: `linear-gradient(90deg, ${CYAN}, #22c55e)` }} />
                  </div>
                </motion.div>
              )}

              {reportGenerated && !isGenerating && (
                <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 1 / (PHI * PHI) }} className="rounded-xl bg-green-500/10 border border-green-500/30 p-4">
                  <div className="flex items-center gap-2 mb-2">
                    <div className="w-2 h-2 rounded-full bg-green-400" />
                    <span className="text-xs font-mono text-green-400 font-bold">Report Ready</span>
                  </div>
                  <div className="text-[11px] font-mono text-black-400 space-y-1">
                    <KVRow label="Format" value={EXPORT_FORMATS.find(e => e.value === exportFormat)?.label} color="text-black-300" />
                    <KVRow label="Method" value={COST_BASIS_METHODS.find(m => m.value === costBasisMethod)?.label} color="text-black-300" />
                    <KVRow label="Year" value={selectedYear} color="text-black-300" />
                    <KVRow label="Events" value={summary.events} color="text-black-300" />
                  </div>
                  <button className="w-full mt-3 py-2 rounded-lg text-xs font-mono font-bold border border-green-500/30 bg-green-500/10 text-green-400 hover:bg-green-500/20 transition-all">
                    Download {EXPORT_FORMATS.find(e => e.value === exportFormat)?.label}
                  </button>
                </motion.div>
              )}
            </div>
          </div>
        </Section>

        {/* ============ 4. DeFi Activity ============ */}
        <Section index={3} tag="defi" title="DeFi Activity Breakdown">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
            {/* LP Positions */}
            <div>
              <span className="text-[10px] font-mono text-cyan-400/70 uppercase tracking-wider">Active LP Positions</span>
              <div className="space-y-2 mt-3">
                {defiActivity.lpEntries.map((lp, i) => (
                  <motion.div key={i} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.08 / PHI, duration: 0.3 }}>
                    <DefiCard>
                      <div className="flex justify-between items-center mb-2">
                        <span className="text-xs font-mono text-black-300 font-bold">{lp.pool}</span>
                        <span className="text-[10px] font-mono text-black-500">{lp.date}</span>
                      </div>
                      <div className="grid grid-cols-2 gap-1">
                        <KVRow label="Deposited" value={fmt(lp.valueIn)} />
                        <KVRow label="Current" value={fmt(lp.currentValue)} color="text-green-400" />
                        <KVRow label="Fees Earned" value={`+${fmt(lp.fees)}`} color="text-green-400" />
                        <KVRow label="IL" value={fmt(Math.abs(lp.il))} color="text-red-400" />
                      </div>
                    </DefiCard>
                  </motion.div>
                ))}
              </div>
            </div>

            {/* LP Exits */}
            <div>
              <span className="text-[10px] font-mono text-cyan-400/70 uppercase tracking-wider">LP Exits (Realized)</span>
              <div className="space-y-2 mt-3">
                {defiActivity.lpExits.map((lp, i) => (
                  <motion.div key={i} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.08 / PHI, duration: 0.3 }}>
                    <DefiCard>
                      <div className="flex justify-between items-center mb-2">
                        <span className="text-xs font-mono text-black-300 font-bold">{lp.pool}</span>
                        <span className={`text-xs font-mono font-bold ${lp.gainLoss >= 0 ? 'text-green-400' : 'text-red-400'}`}>{lp.gainLoss >= 0 ? '+' : ''}{fmt(Math.abs(lp.gainLoss))}</span>
                      </div>
                      <div className="grid grid-cols-2 gap-1">
                        <KVRow label="Value In" value={fmt(lp.valueIn)} />
                        <KVRow label="Value Out" value={fmt(lp.valueOut)} />
                        <KVRow label="Fees" value={`+${fmt(lp.fees)}`} color="text-green-400" />
                        <KVRow label="IL" value={fmt(Math.abs(lp.il))} color="text-red-400" />
                      </div>
                      <div className="text-[10px] font-mono text-black-500 mt-2">{lp.date}</div>
                    </DefiCard>
                  </motion.div>
                ))}
              </div>
            </div>

            {/* Farming Rewards */}
            <div>
              <span className="text-[10px] font-mono text-cyan-400/70 uppercase tracking-wider">Yield Farming Rewards</span>
              <div className="space-y-2 mt-3">
                {defiActivity.farmingRewards.map((r, i) => (
                  <motion.div key={i} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.08 / PHI, duration: 0.3 }}>
                    <DefiCard className="flex items-center justify-between">
                      <div>
                        <div className="text-xs font-mono text-black-300 font-bold">{r.amount.toLocaleString()} {r.token}</div>
                        <div className="text-[10px] font-mono text-black-500 mt-0.5">{r.source}</div>
                      </div>
                      <div className="text-right">
                        <div className="text-xs font-mono text-green-400 font-bold">{fmt(r.value)}</div>
                        <div className="text-[10px] font-mono text-black-500">taxable income</div>
                      </div>
                    </DefiCard>
                  </motion.div>
                ))}
                <div className="rounded-lg border border-dashed border-green-500/20 p-2 mt-1">
                  <KVRow label="Total Farming Income" value={`+${fmt(defiActivity.farmingRewards.reduce((s, r) => s + r.value, 0))}`} color="text-green-400 font-bold" />
                </div>
              </div>
            </div>

            {/* Airdrops & Liquidations */}
            <div className="space-y-5">
              <div>
                <span className="text-[10px] font-mono text-cyan-400/70 uppercase tracking-wider">Airdrops</span>
                <div className="space-y-2 mt-3">
                  {defiActivity.airdrops.map((d, i) => (
                    <motion.div key={i} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.08 / PHI, duration: 0.3 }}>
                      <DefiCard>
                        <div className="flex justify-between items-center mb-1">
                          <span className="text-xs font-mono text-black-300 font-bold">{d.amount.toLocaleString()} {d.token}</span>
                          <span className="text-xs font-mono text-green-400 font-bold">{fmt(d.valueAtReceipt)}</span>
                        </div>
                        <KVRow label={d.source} value={d.date} />
                      </DefiCard>
                    </motion.div>
                  ))}
                </div>
              </div>
              <div>
                <span className="text-[10px] font-mono text-cyan-400/70 uppercase tracking-wider">Liquidations</span>
                <div className="space-y-2 mt-3">
                  {defiActivity.liquidations.map((liq, i) => (
                    <motion.div key={i} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.08 / PHI, duration: 0.3 }}>
                      <DefiCard variant="danger">
                        <div className="flex justify-between items-center mb-2">
                          <span className="text-xs font-mono text-red-400 font-bold">{liq.asset} Liquidation</span>
                          <span className="text-xs font-mono text-red-400 font-bold">{fmt(Math.abs(liq.lossRealized))}</span>
                        </div>
                        <div className="grid grid-cols-2 gap-1">
                          <KVRow label="Collateral" value={fmt(liq.collateral)} />
                          <KVRow label="Debt" value={fmt(liq.debt)} />
                          <KVRow label="Penalty" value={fmt(liq.penalty)} color="text-red-400" />
                          <KVRow label="Date" value={liq.date} />
                        </div>
                      </DefiCard>
                    </motion.div>
                  ))}
                </div>
              </div>
            </div>
          </div>

          {/* DeFi summary */}
          <div className="mt-5 rounded-xl bg-black-800/40 border border-black-700/30 p-4">
            <span className="text-[10px] font-mono text-cyan-400/70 uppercase tracking-wider">DeFi Tax Summary</span>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mt-3">
              {[
                { label: 'LP Fees Earned', value: `+${fmt(defiActivity.lpEntries.reduce((s, l) => s + l.fees, 0) + defiActivity.lpExits.reduce((s, l) => s + l.fees, 0))}`, color: 'text-green-400' },
                { label: 'Total IL', value: fmt(Math.abs(defiActivity.lpEntries.reduce((s, l) => s + l.il, 0) + defiActivity.lpExits.reduce((s, l) => s + l.il, 0))), color: 'text-red-400' },
                { label: 'Farming Income', value: `+${fmt(summary.farmIncome)}`, color: 'text-green-400' },
                { label: 'Airdrop Income', value: `+${fmt(summary.airdropIncome)}`, color: 'text-green-400' },
              ].map(({ label, value, color }) => (
                <div key={label}>
                  <div className="text-black-500 text-[11px] font-mono mb-0.5">{label}</div>
                  <div className={`${color} font-bold text-[11px] font-mono`}>{value}</div>
                </div>
              ))}
            </div>
          </div>
        </Section>

        {/* ============ 5. Optimization Tips ============ */}
        <Section index={4} tag="optimize" title="Tax Optimization Tips" glowColor="matrix">
          <div className="space-y-3">
            {OPTIMIZATION_TIPS.map((tip, idx) => (
              <motion.div key={idx} initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: idx * 0.06 / PHI, duration: 0.35 }}>
                <button onClick={() => setExpandedTip(expandedTip === idx ? null : idx)} className="w-full text-left">
                  <div className={`rounded-xl border transition-all p-4 ${expandedTip === idx ? 'border-cyan-500/30 bg-cyan-500/5' : 'border-black-700/30 bg-black-800/40 hover:border-black-600/50'}`}>
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <ImpactBadge level={tip.impact} />
                        <span className="text-xs font-mono text-black-200 font-bold">{tip.title}</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="px-2 py-0.5 rounded-full text-[10px] font-mono uppercase bg-black-800/60 text-cyan-400/60 border border-black-700/50">{tip.tag}</span>
                        <motion.span animate={{ rotate: expandedTip === idx ? 180 : 0 }} transition={{ duration: 0.2 }} className="text-black-500 text-xs">v</motion.span>
                      </div>
                    </div>
                    {expandedTip === idx && (
                      <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} transition={{ duration: 1 / (PHI * PHI * PHI) }} className="mt-3 pt-3 border-t border-black-700/30">
                        <p className="text-[11px] font-mono text-black-400 leading-relaxed">{tip.description}</p>
                      </motion.div>
                    )}
                  </div>
                </button>
              </motion.div>
            ))}
          </div>

          <div className="mt-5 rounded-xl bg-amber-500/5 border border-amber-500/20 p-4">
            <div className="flex items-start gap-2">
              <span className="text-amber-400 text-xs mt-0.5">!</span>
              <div>
                <div className="text-[10px] font-mono text-amber-400/80 uppercase tracking-wider mb-1">Disclaimer</div>
                <p className="text-[11px] font-mono text-black-400 leading-relaxed">
                  Tax optimization suggestions are for informational purposes only and do not constitute tax advice.
                  Consult a qualified tax professional for advice specific to your situation. VibeSwap is not responsible for any tax filing decisions.
                </p>
              </div>
            </div>
          </div>
        </Section>

        {/* ============ Not Connected Banner ============ */}
        {!isConnected && (
          <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.5, duration: 1 / (PHI * PHI) }}>
            <GlassCard glowColor="terminal" hover={false} className="p-6">
              <div className="text-center">
                <span className="text-[10px] font-mono text-cyan-400/70 uppercase tracking-wider">wallet required</span>
                <h3 className="text-lg font-bold font-mono text-black-200 mb-2 mt-2">Connect to Generate Reports</h3>
                <p className="text-xs font-mono text-black-400 max-w-md mx-auto mb-4">
                  Connect your wallet to generate personalized tax reports based on your on-chain transaction history. All data stays client-side.
                </p>
                <Link to="/" className="inline-flex px-5 py-2.5 rounded-xl text-xs font-mono font-bold border border-cyan-500/50 bg-cyan-500/10 text-cyan-400 hover:bg-cyan-500/20 transition-all">
                  Connect Wallet
                </Link>
              </div>
            </GlassCard>
          </motion.div>
        )}

        {/* ============ Footer ============ */}
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 1.2, duration: 0.5 }} className="text-center pt-4">
          <p className="text-[10px] font-mono text-black-600">Data shown is for demonstration purposes. Connect wallet for real transaction analysis.</p>
          <p className="text-[10px] font-mono text-black-700 mt-1">Powered by VibeSwap on-chain indexer &bull; {COST_BASIS_METHODS.find(m => m.value === costBasisMethod)?.label} method</p>
        </motion.div>
      </div>
    </div>
  )
}
