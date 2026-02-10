import { useEffect } from 'react'
import { Routes, Route, useLocation } from 'react-router-dom'
import { AnimatePresence, motion } from 'framer-motion'
import HeaderMinimal from './components/HeaderMinimal'
import SwapCore from './components/SwapCore'
import PoolPage from './components/PoolPage'
import BridgePage from './components/BridgePage'
import RewardsPage from './components/RewardsPage'
import DocsPage from './components/DocsPage'
import ForumPage from './components/ForumPage'
import { ContributionsProvider } from './contexts/ContributionsContext'

// Minimal page transitions - subtle, fast
const pageVariants = {
  initial: { opacity: 0 },
  in: { opacity: 1 },
  out: { opacity: 0 },
}

const pageTransition = {
  duration: 0.15,
}

function AnimatedRoutes() {
  const location = useLocation()

  return (
    <AnimatePresence mode="wait">
      <motion.div
        key={location.pathname}
        initial="initial"
        animate="in"
        exit="out"
        variants={pageVariants}
        transition={pageTransition}
      >
        <Routes location={location}>
          {/* Landing IS the swap - Steve's vision */}
          <Route path="/" element={<SwapCore />} />
          <Route path="/earn" element={<PoolPage />} />
          <Route path="/send" element={<BridgePage />} />
          <Route path="/history" element={<div className="text-center py-20 text-black-400">Transaction history coming soon</div>} />
          <Route path="/rewards" element={<RewardsPage />} />
          <Route path="/forum" element={<ForumPage />} />
          <Route path="/docs" element={<DocsPage />} />
        </Routes>
      </motion.div>
    </AnimatePresence>
  )
}

function App() {
  const location = useLocation()
  const isHomePage = location.pathname === '/'

  // Lock scroll on home page (Safari iOS fix) - Build v2
  useEffect(() => {
    if (isHomePage) {
      // CSS classes
      document.documentElement.classList.add('no-scroll')
      document.body.classList.add('no-scroll')

      // JavaScript touch prevention for iOS Safari
      const preventScroll = (e) => {
        e.preventDefault()
        e.stopPropagation()
        return false
      }

      const preventTouchMove = (e) => {
        // Allow scrolling inside modals/token selectors
        if (e.target.closest('.allow-scroll')) return
        e.preventDefault()
      }

      // Prevent all scroll events
      document.addEventListener('touchmove', preventTouchMove, { passive: false })
      document.addEventListener('scroll', preventScroll, { passive: false })
      window.addEventListener('scroll', preventScroll, { passive: false })

      // Set body style directly
      document.body.style.cssText = 'overflow:hidden!important;position:fixed!important;width:100%!important;height:100%!important;'
      document.documentElement.style.cssText = 'overflow:hidden!important;'

      return () => {
        document.removeEventListener('touchmove', preventTouchMove)
        document.removeEventListener('scroll', preventScroll)
        window.removeEventListener('scroll', preventScroll)
        document.body.style.cssText = ''
        document.documentElement.style.cssText = ''
        document.documentElement.classList.remove('no-scroll')
        document.body.classList.remove('no-scroll')
      }
    } else {
      document.documentElement.classList.remove('no-scroll')
      document.body.classList.remove('no-scroll')
      document.body.style.cssText = ''
      document.documentElement.style.cssText = ''
    }
  }, [isHomePage])

  return (
    <ContributionsProvider>
      {isHomePage ? (
        // Home page: completely fixed layout, no scroll possible
        <div className="fixed inset-0 bg-black-900 flex flex-col">
          <HeaderMinimal />
          <main className="flex-1 overflow-hidden">
            <AnimatedRoutes />
          </main>
        </div>
      ) : (
        // Other pages: normal scrolling
        <div className="min-h-screen bg-black-900">
          <HeaderMinimal />
          <main>
            <AnimatedRoutes />
          </main>
        </div>
      )}
    </ContributionsProvider>
  )
}

export default App
