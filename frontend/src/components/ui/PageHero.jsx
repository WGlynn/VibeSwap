import { motion } from 'framer-motion'

/**
 * PageHero — Distinctive gradient header for each page category.
 * Solves the "every page looks the same" problem.
 * Each category gets a unique gradient and visual identity.
 *
 * Props:
 *   title: string — page title
 *   subtitle: string — one-line description
 *   category: 'defi' | 'ecosystem' | 'community' | 'intelligence' | 'knowledge' | 'system' | 'trading'
 *   badge: string — optional badge text (e.g., "Live", "Beta")
 *   badgeColor: string — badge dot color
 *   children: ReactNode — optional right-side content (buttons, etc.)
 */

const CATEGORY_GRADIENTS = {
  defi: 'from-green-500/8 via-emerald-500/4 to-transparent',
  ecosystem: 'from-cyan-500/8 via-teal-500/4 to-transparent',
  community: 'from-purple-500/8 via-violet-500/4 to-transparent',
  intelligence: 'from-blue-500/8 via-indigo-500/4 to-transparent',
  knowledge: 'from-amber-500/8 via-orange-500/4 to-transparent',
  system: 'from-gray-500/8 via-zinc-500/4 to-transparent',
  trading: 'from-green-500/8 via-cyan-500/4 to-transparent',
}

const CATEGORY_ACCENTS = {
  defi: 'text-green-400',
  ecosystem: 'text-cyan-400',
  community: 'text-purple-400',
  intelligence: 'text-blue-400',
  knowledge: 'text-amber-400',
  system: 'text-gray-400',
  trading: 'text-green-400',
}

const CATEGORY_BORDERS = {
  defi: 'border-green-500/10',
  ecosystem: 'border-cyan-500/10',
  community: 'border-purple-500/10',
  intelligence: 'border-blue-500/10',
  knowledge: 'border-amber-500/10',
  system: 'border-gray-500/10',
  trading: 'border-green-500/10',
}

const PHI = 1.618033988749895

function PageHero({
  title,
  subtitle,
  category = 'defi',
  badge,
  badgeColor,
  children,
}) {
  const gradient = CATEGORY_GRADIENTS[category] || CATEGORY_GRADIENTS.defi
  const accent = CATEGORY_ACCENTS[category] || CATEGORY_ACCENTS.defi
  const border = CATEGORY_BORDERS[category] || CATEGORY_BORDERS.defi

  return (
    <motion.div
      initial={{ opacity: 0, y: -8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 1 / (PHI * PHI * PHI), ease: [0.25, 0.1, 1 / PHI, 1] }}
      className={`relative mb-6 pb-6 border-b ${border}`}
    >
      {/* Background gradient */}
      <div className={`absolute inset-0 bg-gradient-to-b ${gradient} rounded-b-xl pointer-events-none`} />

      <div className="relative max-w-7xl mx-auto px-4 pt-6">
        <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-3">
          <div>
            {/* Category label */}
            <div className={`text-[10px] font-mono uppercase tracking-wider ${accent} mb-1 opacity-70`}>
              {category}
            </div>
            {/* Title */}
            <h1 className="text-2xl sm:text-3xl font-bold tracking-tight">
              {title}
            </h1>
            {/* Subtitle */}
            {subtitle && (
              <p className="text-sm text-black-400 mt-1 max-w-xl">{subtitle}</p>
            )}
          </div>

          <div className="flex items-center gap-3">
            {/* Badge */}
            {badge && (
              <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-mono bg-black-800/60 border border-black-700/50">
                <div className="w-1.5 h-1.5 rounded-full animate-pulse" style={{ backgroundColor: badgeColor || '#22c55e' }} />
                {badge}
              </div>
            )}
            {/* Right-side content */}
            {children}
          </div>
        </div>
      </div>
    </motion.div>
  )
}

export default PageHero
