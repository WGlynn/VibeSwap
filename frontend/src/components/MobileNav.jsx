import { Link, useLocation } from 'react-router-dom'
import { motion } from 'framer-motion'

function MobileNav() {
  const location = useLocation()

  const navItems = [
    {
      path: '/',
      label: 'Home',
      icon: (
        <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" />
        </svg>
      ),
    },
    {
      path: '/swap',
      label: 'Swap',
      icon: (
        <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M7 16V4m0 0L3 8m4-4l4 4m6 0v12m0 0l4-4m-4 4l-4-4" />
        </svg>
      ),
    },
    {
      path: '/pool',
      label: 'Pool',
      icon: (
        <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" />
        </svg>
      ),
    },
    {
      path: '/bridge',
      label: 'Bridge',
      icon: (
        <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4" />
        </svg>
      ),
    },
    {
      path: '/rewards',
      label: 'Rewards',
      icon: (
        <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
      ),
    },
    {
      path: '/docs',
      label: 'Docs',
      icon: (
        <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
        </svg>
      ),
    },
  ]

  return (
    <nav className="fixed bottom-0 left-0 right-0 z-50 md:hidden">
      {/* Top gradient border */}
      <div className="h-px bg-gradient-to-r from-transparent via-vibe-500/30 to-transparent" />

      <div className="glass-strong border-t border-void-600/30">
        <div className="flex items-center justify-around py-2 px-2 safe-area-bottom">
          {navItems.map((item) => {
            const isActive = location.pathname === item.path

            return (
              <Link
                key={item.path}
                to={item.path}
                className="relative flex-1"
              >
                <motion.div
                  whileTap={{ scale: 0.9 }}
                  className={`flex flex-col items-center py-2 px-2 rounded-xl transition-all ${
                    isActive
                      ? 'text-vibe-400'
                      : 'text-void-400'
                  }`}
                >
                  {/* Active background */}
                  {isActive && (
                    <motion.div
                      layoutId="mobileNavActive"
                      className="absolute inset-1 bg-vibe-500/10 rounded-xl border border-vibe-500/20"
                      transition={{ type: 'spring', bounce: 0.2, duration: 0.6 }}
                    />
                  )}

                  {/* Glow effect for active */}
                  {isActive && (
                    <div className="absolute inset-0 bg-vibe-500/5 blur-xl rounded-xl" />
                  )}

                  <div className="relative z-10">
                    {item.icon}
                  </div>
                  <span className={`relative z-10 text-[10px] mt-1 font-medium tracking-wide ${
                    isActive ? 'text-vibe-400' : ''
                  }`}>
                    {item.label}
                  </span>
                </motion.div>
              </Link>
            )
          })}
        </div>
      </div>
    </nav>
  )
}

export default MobileNav
