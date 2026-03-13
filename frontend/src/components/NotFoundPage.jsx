import { motion } from 'framer-motion'
import { Link, useLocation } from 'react-router-dom'

// ============================================================
// 404 Page — Lost in the mesh? We'll guide you back.
// ============================================================

const PHI = 1.618033988749895
const CYAN = '#06b6d4'
const ease = [0.25, 0.1, 1 / PHI, 1]

const SUGGESTIONS = [
  { path: '/', label: 'Swap', desc: 'Trade tokens with MEV protection' },
  { path: '/earn', label: 'Earn', desc: 'Provide liquidity and earn fees' },
  { path: '/send', label: 'Send', desc: 'Bridge assets cross-chain' },
  { path: '/portfolio', label: 'Portfolio', desc: 'Track your positions' },
  { path: '/docs', label: 'Docs', desc: 'Learn how VibeSwap works' },
  { path: '/apps', label: 'Apps', desc: 'Browse the VSOS app store' },
]

function GlitchText({ text }) {
  return (
    <div className="relative inline-block">
      <motion.span
        className="absolute inset-0 text-red-500/30"
        animate={{ x: [0, -2, 2, 0], y: [0, 1, -1, 0] }}
        transition={{ duration: 0.15, repeat: Infinity, repeatDelay: 3 }}
      >
        {text}
      </motion.span>
      <motion.span
        className="absolute inset-0 text-cyan-500/30"
        animate={{ x: [0, 2, -2, 0], y: [0, -1, 1, 0] }}
        transition={{ duration: 0.15, repeat: Infinity, repeatDelay: 3, delay: 0.05 }}
      >
        {text}
      </motion.span>
      <span className="relative">{text}</span>
    </div>
  )
}

export default function NotFoundPage() {
  const location = useLocation()

  return (
    <div className="min-h-screen flex flex-col items-center justify-center px-4 pb-20">
      {/* Background particles */}
      <div className="fixed inset-0 pointer-events-none overflow-hidden z-0">
        {Array.from({ length: 12 }).map((_, i) => (
          <motion.div
            key={i}
            className="absolute w-px h-px rounded-full"
            style={{
              background: i % 2 === 0 ? CYAN : '#ef4444',
              left: `${(i * PHI * 17) % 100}%`,
              top: `${(i * PHI * 23) % 100}%`,
            }}
            animate={{ opacity: [0, 0.4, 0], scale: [0, 2, 0], y: [0, -60] }}
            transition={{ duration: 3 + i * 0.5, repeat: Infinity, delay: i * 0.4, ease: 'easeOut' }}
          />
        ))}
      </div>

      <div className="relative z-10 text-center max-w-xl mx-auto">
        {/* 404 number */}
        <motion.div
          initial={{ opacity: 0, scale: 0.8 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 0.6, ease }}
        >
          <h1
            className="text-8xl sm:text-9xl font-bold font-mono tracking-widest mb-2"
            style={{ textShadow: `0 0 60px ${CYAN}40, 0 0 120px ${CYAN}15` }}
          >
            <GlitchText text="404" />
          </h1>
        </motion.div>

        {/* Message */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.2, duration: 0.5, ease }}
        >
          <p className="text-lg font-mono text-black-300 mb-2">Page not found</p>
          <p className="text-sm font-mono text-black-500 mb-1">
            The route <code className="px-2 py-0.5 rounded bg-black-800 border border-black-700 text-cyan-400">{location.pathname}</code> doesn't exist.
          </p>
          <p className="text-xs font-mono text-black-600 italic">
            Lost in the mesh? Even the best explorers need a compass.
          </p>
        </motion.div>

        {/* Decorative divider */}
        <motion.div
          initial={{ scaleX: 0 }}
          animate={{ scaleX: 1 }}
          transition={{ delay: 0.4, duration: 0.8, ease }}
          className="w-48 h-px mx-auto my-8"
          style={{ background: `linear-gradient(90deg, transparent, ${CYAN}60, transparent)` }}
        />

        {/* Quick links */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.5, duration: 0.5, ease }}
        >
          <p className="text-[10px] font-mono text-black-500 uppercase tracking-widest mb-4">Try one of these</p>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
            {SUGGESTIONS.map((s, i) => (
              <motion.div
                key={s.path}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.6 + i * 0.06, duration: 0.3 }}
              >
                <Link
                  to={s.path}
                  className="block rounded-xl p-3 text-left transition-all duration-200 group"
                  style={{
                    background: 'rgba(0,0,0,0.3)',
                    border: `1px solid rgba(6,182,212,0.1)`,
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.borderColor = `${CYAN}40`
                    e.currentTarget.style.background = `rgba(6,182,212,0.06)`
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.borderColor = `rgba(6,182,212,0.1)`
                    e.currentTarget.style.background = `rgba(0,0,0,0.3)`
                  }}
                >
                  <span className="text-sm font-mono font-bold text-white group-hover:text-cyan-400 transition-colors">
                    {s.label}
                  </span>
                  <p className="text-[10px] font-mono text-black-500 mt-0.5">{s.desc}</p>
                </Link>
              </motion.div>
            ))}
          </div>
        </motion.div>

        {/* Back button */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 1, duration: 0.5 }}
          className="mt-8"
        >
          <button
            onClick={() => window.history.back()}
            className="px-6 py-2 rounded-lg text-sm font-mono font-bold transition-all duration-200"
            style={{
              background: `${CYAN}15`,
              border: `1px solid ${CYAN}30`,
              color: CYAN,
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = `${CYAN}25`
              e.currentTarget.style.borderColor = `${CYAN}50`
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = `${CYAN}15`
              e.currentTarget.style.borderColor = `${CYAN}30`
            }}
          >
            Go Back
          </button>
        </motion.div>

        {/* Footer */}
        <motion.p
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 1.2 }}
          className="mt-12 text-[10px] font-mono text-black-700"
        >
          VibeSwap v0.1.0 — The Everything App
        </motion.p>
      </div>
    </div>
  )
}
