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

  // Lock body scroll on home page (mobile browser fix)
  useEffect(() => {
    if (isHomePage) {
      document.body.classList.add('no-scroll')
    } else {
      document.body.classList.remove('no-scroll')
    }
    return () => document.body.classList.remove('no-scroll')
  }, [isHomePage])

  return (
    <ContributionsProvider>
      <div className={`min-h-screen bg-black-900 ${isHomePage ? 'h-[100dvh] overflow-hidden' : ''}`}>
        {/* Clean. Simple. Black void. */}
        <HeaderMinimal />
        <main className={isHomePage ? 'overflow-hidden' : ''}>
          <AnimatedRoutes />
        </main>
      </div>
    </ContributionsProvider>
  )
}

export default App
