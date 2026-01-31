import { Link, useLocation } from 'react-router-dom'

function MobileNav() {
  const location = useLocation()

  const navItems = [
    {
      path: '/swap',
      label: 'Swap',
      icon: (
        <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16V4m0 0L3 8m4-4l4 4m6 0v12m0 0l4-4m-4 4l-4-4" />
        </svg>
      ),
    },
    {
      path: '/pool',
      label: 'Pool',
      icon: (
        <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" />
        </svg>
      ),
    },
    {
      path: '/bridge',
      label: 'Bridge',
      icon: (
        <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4" />
        </svg>
      ),
    },
  ]

  return (
    <nav className="fixed bottom-0 left-0 right-0 z-50 md:hidden glass border-t border-dark-700">
      <div className="flex items-center justify-around py-2 px-4 safe-area-bottom">
        {navItems.map((item) => {
          const isActive = location.pathname === item.path ||
            (item.path === '/swap' && location.pathname === '/')

          return (
            <Link
              key={item.path}
              to={item.path}
              className={`flex flex-col items-center py-2 px-4 rounded-xl transition-colors ${
                isActive
                  ? 'text-vibe-400'
                  : 'text-dark-400 hover:text-white'
              }`}
            >
              {item.icon}
              <span className="text-xs mt-1 font-medium">{item.label}</span>
            </Link>
          )
        })}
      </div>
    </nav>
  )
}

export default MobileNav
