import { motion } from 'framer-motion'

// ============================================================
// FeatureCard — Highlight card for features, benefits, stats
// Used for landing sections, about page, feature showcases
// ============================================================

const GLOW_COLORS = {
  cyan: { border: 'rgba(6,182,212,0.15)', glow: 'rgba(6,182,212,0.08)' },
  green: { border: 'rgba(34,197,94,0.15)', glow: 'rgba(34,197,94,0.08)' },
  amber: { border: 'rgba(245,158,11,0.15)', glow: 'rgba(245,158,11,0.08)' },
  purple: { border: 'rgba(168,85,247,0.15)', glow: 'rgba(168,85,247,0.08)' },
}

export default function FeatureCard({
  icon,
  title,
  description,
  color = 'cyan',
  children,
  className = '',
}) {
  const c = GLOW_COLORS[color] || GLOW_COLORS.cyan

  return (
    <motion.div
      className={`rounded-xl border p-5 ${className}`}
      style={{
        borderColor: c.border,
        background: `linear-gradient(135deg, ${c.glow}, transparent)`,
      }}
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4 }}
      whileHover={{ y: -2, transition: { duration: 0.2 } }}
    >
      {icon && <span className="text-2xl mb-3 block">{icon}</span>}
      <h3 className="text-sm font-mono font-bold text-white mb-1.5">{title}</h3>
      {description && (
        <p className="text-xs font-mono text-black-400 leading-relaxed">{description}</p>
      )}
      {children && <div className="mt-3">{children}</div>}
    </motion.div>
  )
}
