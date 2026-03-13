import { motion } from 'framer-motion'

// ============================================================
// NotificationBell — Bell icon with unread count badge
// Used in header, nav, alert indicators
// ============================================================

const CYAN = '#06b6d4'

export default function NotificationBell({
  count = 0,
  onClick,
  size = 20,
  className = '',
}) {
  const hasUnread = count > 0
  const displayCount = count > 99 ? '99+' : String(count)

  return (
    <button
      onClick={onClick}
      className={`relative inline-flex items-center justify-center p-1.5 rounded-lg transition-colors hover:bg-white/5 ${className}`}
      aria-label={`Notifications${hasUnread ? ` (${count} unread)` : ''}`}
    >
      <motion.svg
        width={size}
        height={size}
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        className="text-black-400"
        animate={hasUnread ? { rotate: [0, -8, 8, -4, 4, 0] } : {}}
        transition={{ duration: 0.5, delay: 1, repeat: hasUnread ? Infinity : 0, repeatDelay: 5 }}
      >
        <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
        <path d="M13.73 21a2 2 0 0 1-3.46 0" />
      </motion.svg>

      {hasUnread && (
        <span
          className="absolute -top-0.5 -right-0.5 min-w-[16px] h-4 flex items-center justify-center rounded-full text-[9px] font-mono font-bold text-white px-1"
          style={{ background: '#ef4444' }}
        >
          {displayCount}
        </span>
      )}
    </button>
  )
}
