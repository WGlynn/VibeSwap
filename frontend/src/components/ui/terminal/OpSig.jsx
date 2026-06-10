import { motion } from 'framer-motion'
import BreathingDot from './BreathingDot'

// ============ OpSig — canonical section header ============
// Every major section opens with an op-signature: <scope>.<op>(args) → <return>
// (locked aesthetic, vibeswap/CLAUDE.md). Renders the mono signature line, an
// optional human title/subtitle, and the animated gradient divider.
//
// Props:
//   sig:      string  — e.g. "swap.commit(order, secret) → hash"  (required)
//   title:    string  — optional human-readable heading rendered below the sig
//   subtitle: string  — optional one-line description
//   live:     bool    — show breathing status dot before the sig
//   as:       string  — heading tag for the title (default 'h2')
//   divider:  bool    — render the gradient divider line (default true)
//   className: string

function OpSig({ sig, title, subtitle, live = false, as = 'h2', divider = true, className = '' }) {
  const Heading = as

  return (
    <div className={className}>
      <div className="flex items-center gap-2">
        {live && <BreathingDot />}
        <span className="font-mono text-[10px] uppercase tracking-[0.22em] text-matrix-600">
          {sig}
        </span>
      </div>
      {title && (
        <Heading className="mt-2 font-display font-bold text-white tracking-[-0.02em] text-xl sm:text-2xl">
          {title}
        </Heading>
      )}
      {subtitle && (
        <p className="mt-1 text-sm text-black-300 max-w-xl">{subtitle}</p>
      )}
      {divider && (
        <motion.div
          aria-hidden="true"
          className="mt-3 h-px w-full origin-left"
          style={{ background: 'linear-gradient(90deg, rgba(0,255,65,0.18), transparent)' }}
          initial={{ scaleX: 0 }}
          whileInView={{ scaleX: 1 }}
          viewport={{ once: true, margin: '-40px' }}
          transition={{ duration: 0.6, ease: 'easeOut' }}
        />
      )}
    </div>
  )
}

export default OpSig
