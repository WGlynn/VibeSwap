import { motion } from 'framer-motion'
import { Link } from 'react-router-dom'

// ============================================================
// Empty State — Consistent empty/zero state across all pages
// Shows when there's no data, no positions, no activity, etc.
// ============================================================

const PHI = 1.618033988749895
const CYAN = '#06b6d4'

const PRESETS = {
  noWallet: {
    icon: (
      <svg className="w-8 h-8" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M21 12a2.25 2.25 0 00-2.25-2.25H15a3 3 0 11-6 0H5.25A2.25 2.25 0 003 12m18 0v6a2.25 2.25 0 01-2.25 2.25H5.25A2.25 2.25 0 013 18v-6m18 0V9M3 12V9m18 0a2.25 2.25 0 00-2.25-2.25H5.25A2.25 2.25 0 003 9m18 0V6a2.25 2.25 0 00-2.25-2.25H5.25A2.25 2.25 0 003 6v3" />
      </svg>
    ),
    title: 'Connect Wallet',
    description: 'Connect your wallet to get started',
    action: { label: 'Go to Exchange', path: '/' },
  },
  noPositions: {
    icon: (
      <svg className="w-8 h-8" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M20.25 6.375c0 2.278-3.694 4.125-8.25 4.125S3.75 8.653 3.75 6.375m16.5 0c0-2.278-3.694-4.125-8.25-4.125S3.75 4.097 3.75 6.375m16.5 0v11.25c0 2.278-3.694 4.125-8.25 4.125s-8.25-1.847-8.25-4.125V6.375" />
      </svg>
    ),
    title: 'No Positions Yet',
    description: 'Open your first position to start earning',
    action: { label: 'Explore Pools', path: '/earn' },
  },
  noActivity: {
    icon: (
      <svg className="w-8 h-8" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6h4.5m4.5 0a9 9 0 11-18 0 9 9 0 0118 0z" />
      </svg>
    ),
    title: 'No Activity',
    description: 'Your transaction history will appear here',
    action: { label: 'Make a Trade', path: '/' },
  },
  noResults: {
    icon: (
      <svg className="w-8 h-8" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607z" />
      </svg>
    ),
    title: 'No Results',
    description: 'Try a different search term',
  },
  comingSoon: {
    icon: (
      <svg className="w-8 h-8" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09zM18.259 8.715L18 9.75l-.259-1.035a3.375 3.375 0 00-2.455-2.456L14.25 6l1.036-.259a3.375 3.375 0 002.455-2.456L18 2.25l.259 1.035a3.375 3.375 0 002.455 2.456L21.75 6l-1.036.259a3.375 3.375 0 00-2.455 2.456z" />
      </svg>
    ),
    title: 'Coming Soon',
    description: 'This feature is under development',
  },
}

export default function EmptyState({
  preset,
  icon,
  title,
  description,
  action,
  className = '',
}) {
  const p = preset ? PRESETS[preset] : {}
  const finalIcon = icon || p.icon
  const finalTitle = title || p.title || 'Nothing Here'
  const finalDesc = description || p.description
  const finalAction = action || p.action

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 1 / (PHI * PHI), ease: 'easeOut' }}
      className={`flex flex-col items-center justify-center py-12 px-4 text-center ${className}`}
    >
      {finalIcon && (
        <motion.div
          initial={{ scale: 0.8 }}
          animate={{ scale: 1 }}
          transition={{ duration: 0.4, delay: 0.1 }}
          className="w-16 h-16 rounded-2xl flex items-center justify-center mb-4"
          style={{
            backgroundColor: `${CYAN}10`,
            border: `1px solid ${CYAN}20`,
            color: `${CYAN}80`,
          }}
        >
          {finalIcon}
        </motion.div>
      )}

      <h3 className="text-sm font-mono font-bold text-white mb-1.5">{finalTitle}</h3>

      {finalDesc && (
        <p className="text-xs font-mono text-black-500 max-w-xs mb-4">{finalDesc}</p>
      )}

      {finalAction && (
        <Link
          to={finalAction.path}
          className="text-xs font-mono font-medium px-4 py-2 rounded-xl transition-all"
          style={{
            color: CYAN,
            border: `1px solid ${CYAN}30`,
            background: `${CYAN}08`,
          }}
        >
          {finalAction.label}
        </Link>
      )}
    </motion.div>
  )
}
