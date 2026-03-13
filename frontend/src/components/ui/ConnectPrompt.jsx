import { motion } from 'framer-motion'
import GlassCard from './GlassCard'

// ============================================================
// ConnectPrompt — CTA for connecting wallet
// Used on pages that require wallet connection
// ============================================================

const CYAN = '#06b6d4'
const PHI = 1.618033988749895

export default function ConnectPrompt({
  title = 'Connect Your Wallet',
  description = 'Connect a wallet to access this feature.',
  action = 'Sign In',
  onConnect,
  className = '',
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 1 / (PHI * PHI), ease: 'easeOut' }}
      className={`max-w-sm mx-auto ${className}`}
    >
      <GlassCard glowColor={CYAN} className="text-center p-8">
        {/* Wallet icon */}
        <div className="w-16 h-16 mx-auto mb-4 rounded-2xl flex items-center justify-center"
          style={{ background: `${CYAN}10`, border: `1px solid ${CYAN}20` }}
        >
          <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke={CYAN} strokeWidth="1.5">
            <rect x="2" y="6" width="20" height="14" rx="2" />
            <path d="M2 10h20" />
            <circle cx="17" cy="14" r="1.5" />
            <path d="M6 6V4a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v2" />
          </svg>
        </div>

        <h3 className="text-sm font-mono font-bold text-white mb-2">
          {title}
        </h3>
        <p className="text-xs font-mono text-black-400 mb-6 leading-relaxed">
          {description}
        </p>

        <button
          onClick={onConnect}
          className="w-full py-3 rounded-xl text-sm font-mono font-bold text-black transition-all duration-200"
          style={{
            background: `linear-gradient(135deg, ${CYAN}, ${CYAN}cc)`,
            boxShadow: `0 4px 20px ${CYAN}30`,
          }}
        >
          {action}
        </button>
      </GlassCard>
    </motion.div>
  )
}
