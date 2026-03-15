import { Link, useLocation } from 'react-router-dom'
import { motion } from 'framer-motion'

const CYAN = '#06b6d4'

const navItems = [
  {
    label: 'Swap',
    path: '/',
    icon: (
      <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M13 10V3L4 14h7v7l9-11h-7z" />
      </svg>
    ),
  },
  {
    label: 'Trade',
    path: '/trade',
    icon: (
      <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M3 13h2v8H3zM9 9h2v12H9zM15 5h2v16h-2zM21 1h2v20h-2z" />
      </svg>
    ),
  },
  {
    label: 'Portfolio',
    path: '/portfolio',
    icon: (
      <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M4 5a1 1 0 011-1h4a1 1 0 011 1v4a1 1 0 01-1 1H5a1 1 0 01-1-1V5zM14 5a1 1 0 011-1h4a1 1 0 011 1v4a1 1 0 01-1 1h-4a1 1 0 01-1-1V5zM4 15a1 1 0 011-1h4a1 1 0 011 1v4a1 1 0 01-1 1H5a1 1 0 01-1-1v-4zM14 15a1 1 0 011-1h4a1 1 0 011 1v4a1 1 0 01-1 1h-4a1 1 0 01-1-1v-4z" />
      </svg>
    ),
  },
  {
    label: 'Earn',
    path: '/earn',
    icon: (
      <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" />
      </svg>
    ),
  },
  {
    label: 'More',
    path: null,
    icon: (
      <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M12 6h.01M12 12h.01M12 18h.01" />
      </svg>
    ),
  },
]

export default function MobileNav({ onOpenMenu }) {
  const location = useLocation()

  return (
    <nav
      aria-label="Main navigation"
      className="fixed bottom-0 left-0 right-0 z-50 sm:hidden"
      style={{
        background: 'rgba(0, 0, 0, 0.8)',
        backdropFilter: 'blur(16px)',
        WebkitBackdropFilter: 'blur(16px)',
        borderTop: '1px solid rgba(255, 255, 255, 0.06)',
        paddingBottom: 'env(safe-area-inset-bottom, 0px)',
      }}
    >
      <div className="flex items-center justify-around px-2 py-1.5">
        {navItems.map((item) => {
          const isActive = item.path !== null && location.pathname === item.path
          const isMore = item.path === null

          const content = (
            <div className="flex flex-col items-center gap-0.5 py-1 relative">
              <div
                className="transition-colors duration-150"
                style={{ color: isActive ? CYAN : 'rgba(255, 255, 255, 0.45)' }}
              >
                {item.icon}
              </div>
              <span
                className="font-mono text-[10px] leading-none transition-colors duration-150"
                style={{ color: isActive ? CYAN : 'rgba(255, 255, 255, 0.35)' }}
              >
                {item.label}
              </span>
              {isActive && (
                <motion.div
                  layoutId="mobile-nav-dot"
                  className="absolute -bottom-0.5 rounded-full"
                  style={{
                    width: 3,
                    height: 3,
                    backgroundColor: CYAN,
                  }}
                  transition={{ type: 'spring', stiffness: 500, damping: 30 }}
                />
              )}
            </div>
          )

          if (isMore) {
            return (
              <button
                key="more"
                onClick={onOpenMenu}
                aria-label="Open menu"
                className="flex-1 flex justify-center outline-none border-none bg-transparent cursor-pointer"
              >
                {content}
              </button>
            )
          }

          return (
            <Link
              key={item.path}
              to={item.path}
              className="flex-1 flex justify-center no-underline"
            >
              {content}
            </Link>
          )
        })}
      </div>
    </nav>
  )
}
