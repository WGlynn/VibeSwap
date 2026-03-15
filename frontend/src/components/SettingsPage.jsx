import { motion } from 'framer-motion'
import { useWallet } from '../hooks/useWallet'
import { useDeviceWallet } from '../hooks/useDeviceWallet'
import { usePreferences } from '../hooks/usePreferences'
import GlassCard from './ui/GlassCard'
import PageHero from './ui/PageHero'

// ============================================================
// Settings Page — Persistent, personalized, yours
// All settings survive page reload via localStorage
// ============================================================

const PHI = 1.618033988749895
const ease = [0.25, 0.1, 0.25, 1]
const sectionV = {
  hidden: { opacity: 0, y: 40, scale: 0.97 },
  visible: (i) => ({ opacity: 1, y: 0, scale: 1, transition: { duration: 0.5, delay: 0.15 + i * (0.1 * PHI), ease } }),
}

function Toggle({ enabled, onChange, label, desc }) {
  const { accent } = usePreferences()
  return (
    <div className="flex items-center justify-between py-3">
      <div className="flex-1 min-w-0 mr-4">
        <p className="text-xs font-mono text-white font-bold">{label}</p>
        {desc && <p className="text-[10px] font-mono text-black-500 mt-0.5">{desc}</p>}
      </div>
      <button
        onClick={() => onChange(!enabled)}
        className="relative w-10 h-5 rounded-full transition-all duration-300 flex-shrink-0"
        style={{
          background: enabled ? `${accent.value}30` : 'rgba(255,255,255,0.06)',
          border: `1px solid ${enabled ? `${accent.value}50` : 'rgba(255,255,255,0.1)'}`,
        }}
      >
        <motion.div
          className="absolute top-0.5 w-4 h-4 rounded-full"
          animate={{ left: enabled ? '1.25rem' : '0.125rem' }}
          transition={{ type: 'spring', stiffness: 500, damping: 30 }}
          style={{ background: enabled ? accent.value : 'rgba(255,255,255,0.3)' }}
        />
      </button>
    </div>
  )
}

function Section({ index, title, subtitle, children }) {
  const { accent } = usePreferences()
  return (
    <motion.div custom={index} variants={sectionV} initial="hidden" animate="visible">
      <GlassCard glowColor="terminal" spotlight hover={false} className="p-5 md:p-6">
        <div className="mb-4">
          <h2 className="text-sm font-mono font-bold tracking-wider uppercase" style={{ color: accent.value }}>{title}</h2>
          {subtitle && <p className="text-[11px] font-mono text-black-400 mt-1 italic">{subtitle}</p>}
          <div className="h-px mt-3" style={{ background: `linear-gradient(90deg, ${accent.value}40, transparent)` }} />
        </div>
        {children}
      </GlassCard>
    </motion.div>
  )
}

function SelectOption({ label, desc, value, options, onChange }) {
  return (
    <div className="flex items-center justify-between py-3">
      <div className="flex-1 min-w-0 mr-4">
        <p className="text-xs font-mono text-white font-bold">{label}</p>
        {desc && <p className="text-[10px] font-mono text-black-500 mt-0.5">{desc}</p>}
      </div>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="bg-black-900 border border-black-700 rounded-lg px-2 py-1.5 text-[11px] font-mono text-white focus:outline-none focus:border-cyan-500 flex-shrink-0"
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>{o.label}</option>
        ))}
      </select>
    </div>
  )
}

export default function SettingsPage() {
  const { isConnected: isExternalConnected } = useWallet()
  const { isConnected: isDeviceConnected } = useDeviceWallet()
  const isConnected = isExternalConnected || isDeviceConnected
  const prefs = usePreferences()

  return (
    <div className="min-h-screen pb-20">
      <div className="fixed inset-0 pointer-events-none overflow-hidden z-0">
        {Array.from({ length: 6 }).map((_, i) => (
          <motion.div key={i} className="absolute w-px h-px rounded-full"
            style={{ background: prefs.accent.value, left: `${(i * PHI * 19) % 100}%`, top: `${(i * PHI * 29) % 100}%` }}
            animate={{ opacity: [0, 0.15, 0], scale: [0, 1.5, 0], y: [0, -40] }}
            transition={{ duration: 4, repeat: Infinity, delay: i * 0.8, ease: 'easeOut' }} />
        ))}
      </div>

      <div className="relative z-10">
        <PageHero title="Settings" category="system" subtitle="Customize your VibeSwap experience" />
        <div className="max-w-3xl mx-auto px-4 space-y-6">

          {/* ============ Accent Color ============ */}
          <Section index={0} title="Accent Color" subtitle="Pick your vibe">
            <div className="grid grid-cols-4 sm:grid-cols-8 gap-2">
              {Object.entries(prefs.ACCENT_COLORS).map(([key, color]) => (
                <button
                  key={key}
                  onClick={() => prefs.setPref('accentColor', key)}
                  className="relative group flex flex-col items-center gap-1.5 p-2 rounded-xl transition-all"
                  style={{
                    background: prefs.accentColor === key ? `${color.value}15` : 'transparent',
                    border: `2px solid ${prefs.accentColor === key ? color.value : 'rgba(255,255,255,0.06)'}`,
                  }}
                >
                  <div
                    className="w-8 h-8 rounded-full transition-transform group-hover:scale-110"
                    style={{
                      backgroundColor: color.value,
                      boxShadow: prefs.accentColor === key ? `0 0 12px ${color.value}60` : 'none',
                    }}
                  />
                  <span className="text-[8px] font-mono text-black-400 truncate w-full text-center">
                    {color.label.split(' ')[0]}
                  </span>
                  {prefs.accentColor === key && (
                    <motion.div
                      layoutId="accent-check"
                      className="absolute -top-1 -right-1 w-4 h-4 rounded-full flex items-center justify-center text-[8px]"
                      style={{ backgroundColor: color.value, color: '#000' }}
                    >
                      ✓
                    </motion.div>
                  )}
                </button>
              ))}
            </div>
          </Section>

          {/* ============ Layout Density ============ */}
          <Section index={1} title="Layout Density" subtitle="How much space between elements">
            <div className="flex gap-2">
              {Object.entries(prefs.DENSITIES).map(([key, d]) => (
                <button
                  key={key}
                  onClick={() => prefs.setPref('density', key)}
                  className="flex-1 py-3 rounded-xl text-xs font-mono font-bold transition-all"
                  style={{
                    background: prefs.density === key ? `${prefs.accent.value}15` : 'rgba(0,0,0,0.3)',
                    border: `1px solid ${prefs.density === key ? `${prefs.accent.value}40` : 'rgba(255,255,255,0.06)'}`,
                    color: prefs.density === key ? prefs.accent.value : 'rgba(255,255,255,0.5)',
                  }}
                >
                  {d.label}
                </button>
              ))}
            </div>
          </Section>

          {/* ============ Trading ============ */}
          <Section index={2} title="Trading" subtitle="Slippage, deadlines, and gas preferences">
            <div className="divide-y divide-white/[0.04]">
              <div className="py-3">
                <div className="flex items-center justify-between mb-2">
                  <div>
                    <p className="text-xs font-mono text-white font-bold">Slippage Tolerance</p>
                    <p className="text-[10px] font-mono text-black-500">Maximum price movement you accept</p>
                  </div>
                </div>
                <div className="flex gap-1.5">
                  {['0.1', '0.5', '1.0', '3.0'].map((v) => (
                    <button key={v} onClick={() => prefs.setPref('slippage', v)}
                      className="px-3 py-1.5 rounded-lg text-[11px] font-mono font-bold transition-colors"
                      style={{
                        background: prefs.slippage === v ? `${prefs.accent.value}20` : 'rgba(0,0,0,0.3)',
                        border: `1px solid ${prefs.slippage === v ? `${prefs.accent.value}40` : 'rgba(255,255,255,0.06)'}`,
                        color: prefs.slippage === v ? prefs.accent.value : 'rgba(255,255,255,0.5)',
                      }}>
                      {v}%
                    </button>
                  ))}
                  <div className="relative flex-1">
                    <input
                      type="text"
                      value={prefs.slippage}
                      onChange={(e) => prefs.setPref('slippage', e.target.value.replace(/[^0-9.]/g, ''))}
                      className="w-full bg-black-900 border border-black-700 rounded-lg px-2 py-1.5 text-[11px] font-mono text-white text-right focus:outline-none focus:border-cyan-500"
                      placeholder="Custom"
                    />
                    <span className="absolute right-2 top-1/2 -translate-y-1/2 text-[10px] font-mono text-black-500">%</span>
                  </div>
                </div>
                {parseFloat(prefs.slippage) > 5 && (
                  <p className="text-[10px] font-mono text-amber-400 mt-1.5">High slippage increases risk of unfavorable execution</p>
                )}
              </div>

              <SelectOption label="Transaction Deadline" desc="Auto-cancel if not confirmed in time"
                value={prefs.deadline} onChange={(v) => prefs.setPref('deadline', v)}
                options={[
                  { value: '10', label: '10 minutes' },
                  { value: '30', label: '30 minutes' },
                  { value: '60', label: '1 hour' },
                  { value: '120', label: '2 hours' },
                ]} />

              <SelectOption label="Gas Preset" desc="Preferred gas speed for transactions"
                value={prefs.gasPreset} onChange={(v) => prefs.setPref('gasPreset', v)}
                options={[
                  { value: 'slow', label: 'Slow (cheapest)' },
                  { value: 'standard', label: 'Standard' },
                  { value: 'fast', label: 'Fast' },
                  { value: 'instant', label: 'Instant (most expensive)' },
                ]} />
            </div>
          </Section>

          {/* ============ Display ============ */}
          <Section index={3} title="Display" subtitle="Visual preferences and currency formatting">
            <div className="divide-y divide-white/[0.04]">
              <SelectOption label="Currency" desc="Display prices in your preferred currency"
                value={prefs.currency} onChange={(v) => prefs.setPref('currency', v)}
                options={[
                  { value: 'USD', label: 'US Dollar (USD)' },
                  { value: 'EUR', label: 'Euro (EUR)' },
                  { value: 'GBP', label: 'British Pound (GBP)' },
                  { value: 'BTC', label: 'Bitcoin (BTC)' },
                  { value: 'ETH', label: 'Ether (ETH)' },
                ]} />
              <Toggle enabled={prefs.compactNumbers} onChange={(v) => prefs.setPref('compactNumbers', v)}
                label="Compact Numbers" desc="Show $1.2M instead of $1,200,000" />
              <Toggle enabled={prefs.showTestnets} onChange={(v) => prefs.setPref('showTestnets', v)}
                label="Show Testnets" desc="Include testnet chains in selection" />
              <Toggle enabled={prefs.hideBalances} onChange={(v) => prefs.setPref('hideBalances', v)}
                label="Hide Balances" desc="Replace balance amounts with ****" />
              <Toggle enabled={prefs.animationsEnabled} onChange={(v) => prefs.setPref('animationsEnabled', v)}
                label="Animations" desc="Enable UI animations and transitions" />
              <Toggle enabled={prefs.reducedMotion} onChange={(v) => prefs.setPref('reducedMotion', v)}
                label="Reduced Motion" desc="Minimize movement for accessibility" />
            </div>
          </Section>

          {/* ============ Notifications ============ */}
          <Section index={4} title="Notifications" subtitle="Control what alerts you receive">
            <div className="divide-y divide-white/[0.04]">
              <Toggle enabled={prefs.txNotifs} onChange={(v) => prefs.setPref('txNotifs', v)}
                label="Transaction Updates" desc="Notify when transactions confirm or fail" />
              <Toggle enabled={prefs.priceAlerts} onChange={(v) => prefs.setPref('priceAlerts', v)}
                label="Price Alerts" desc="Get notified when tokens hit your target price" />
              <Toggle enabled={prefs.batchNotifs} onChange={(v) => prefs.setPref('batchNotifs', v)}
                label="Batch Cycle Alerts" desc="Notify when commit/reveal phases change" />
              <Toggle enabled={prefs.soundEnabled} onChange={(v) => prefs.setPref('soundEnabled', v)}
                label="Sound Effects" desc="Play sounds for confirmations and alerts" />
            </div>
          </Section>

          {/* ============ Privacy ============ */}
          <Section index={5} title="Privacy" subtitle="Data sharing and tracking preferences">
            <div className="divide-y divide-white/[0.04]">
              <Toggle enabled={prefs.analytics} onChange={(v) => prefs.setPref('analytics', v)}
                label="Anonymous Analytics" desc="Help improve VibeSwap with anonymous usage data" />
            </div>
            <div className="mt-3 rounded-lg p-3" style={{ background: `${prefs.accent.value}04`, border: `1px solid ${prefs.accent.value}10` }}>
              <p className="text-[10px] font-mono text-black-400">
                <span className="text-white font-bold">Privacy first:</span> VibeSwap never collects personal data.
                Anonymous analytics only track page views and feature usage — never addresses, balances, or transactions.
              </p>
            </div>
          </Section>

          {/* ============ Advanced ============ */}
          <Section index={6} title="Advanced" subtitle="Expert settings for power users">
            <div className="divide-y divide-white/[0.04]">
              <Toggle enabled={prefs.expertMode} onChange={(v) => prefs.setPref('expertMode', v)}
                label="Expert Mode" desc="Skip confirmation dialogs for experienced traders" />
              <Toggle enabled={prefs.mevProtection} onChange={(v) => prefs.setPref('mevProtection', v)}
                label="MEV Protection" desc="Route swaps through commit-reveal batch auctions" />
              <Toggle enabled={prefs.autoRouter} onChange={(v) => prefs.setPref('autoRouter', v)}
                label="Auto Router" desc="Find best prices across multiple liquidity sources" />
            </div>
            {!prefs.mevProtection && (
              <div className="mt-3 rounded-lg p-3" style={{ background: 'rgba(239,68,68,0.06)', border: '1px solid rgba(239,68,68,0.15)' }}>
                <p className="text-[10px] font-mono text-red-400">
                  <span className="font-bold">Warning:</span> Disabling MEV protection exposes your swaps to frontrunning and sandwich attacks.
                </p>
              </div>
            )}
          </Section>

          {/* ============ Keyboard Shortcuts ============ */}
          <Section index={7} title="Keyboard Shortcuts" subtitle="Navigate faster with key commands">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {[
                { keys: 'Ctrl+Shift+K', action: 'Command Palette' },
                { keys: 'Ctrl+K', action: 'Quick Swap' },
                { keys: 'Ctrl+J', action: 'Ask Jarvis' },
                { keys: 'Ctrl+M', action: 'Mind Mesh' },
                { keys: 'Ctrl+B', action: 'Bridge / Send' },
                { keys: 'Ctrl+P', action: 'Portfolio' },
                { keys: 'Esc', action: 'Close overlay' },
                { keys: 'G then H', action: 'Go Home' },
              ].map((s) => (
                <div key={s.keys} className="flex items-center justify-between rounded-lg p-2.5"
                  style={{ background: 'rgba(0,0,0,0.3)', border: '1px solid rgba(255,255,255,0.04)' }}>
                  <span className="text-[10px] font-mono text-black-400">{s.action}</span>
                  <kbd className="text-[10px] font-mono px-2 py-0.5 rounded bg-black-800 border border-black-700 text-black-300">
                    {s.keys}
                  </kbd>
                </div>
              ))}
            </div>
          </Section>

          {/* ============ Reset ============ */}
          <motion.div custom={8} variants={sectionV} initial="hidden" animate="visible">
            <button
              onClick={prefs.resetAll}
              className="w-full py-3 rounded-xl text-xs font-mono text-black-500 hover:text-red-400 border border-black-700/50 hover:border-red-500/30 transition-all"
            >
              Reset All Settings to Defaults
            </button>
          </motion.div>
        </div>

        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 1.5 }} className="mt-12 mb-8 text-center">
          <div className="w-16 h-px mx-auto mb-4" style={{ background: `linear-gradient(90deg, transparent, ${prefs.accent.value}40, transparent)` }} />
          <p className="text-[10px] font-mono text-black-600 tracking-widest uppercase">All settings persist locally</p>
        </motion.div>
      </div>
    </div>
  )
}
