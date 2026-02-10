import { Routes, Route, useLocation } from 'react-router-dom'
import { AnimatePresence, motion } from 'framer-motion'
import HeaderMinimal from './components/HeaderMinimal'
import SwapCore from './components/SwapCore'
import PoolPage from './components/PoolPage'
import BridgePage from './components/BridgePage'
import BuySellPage from './components/BuySellPage'
import VaultPage from './components/VaultPage'
import RewardsPage from './components/RewardsPage'
import DocsPage from './components/DocsPage'
import ForumPage from './components/ForumPage'
import ActivityPage from './components/ActivityPage'
import AdminSybilDetection from './components/AdminSybilDetection'
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
          <Route path="/buy" element={<BuySellPage />} />
          <Route path="/earn" element={<PoolPage />} />
          <Route path="/vault" element={<VaultPage />} />
          <Route path="/send" element={<BridgePage />} />
          <Route path="/history" element={<ActivityPage />} />
          <Route path="/rewards" element={<RewardsPage />} />
          <Route path="/forum" element={<ForumPage />} />
          <Route path="/docs" element={<DocsPage />} />
          {/* Admin routes */}
          <Route path="/admin/sybil" element={<AdminSybilDetection />} />
        </Routes>
      </motion.div>
    </AnimatePresence>
  )
}

function App() {
  const location = useLocation()
  const isHomePage = location.pathname === '/'

  // Scroll is now prevented globally in index.html for native iOS feel

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
        // Other pages: allow scrolling with .allow-scroll class
        <div className="fixed inset-0 bg-black-900 flex flex-col allow-scroll">
          <HeaderMinimal />
          <main className="flex-1 overflow-y-auto allow-scroll">
            <AnimatedRoutes />
          </main>
        </div>
      )}
    </ContributionsProvider>
  )
}

export default App
