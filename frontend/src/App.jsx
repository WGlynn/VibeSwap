import { lazy, Suspense } from 'react'
import { Routes, Route, useLocation } from 'react-router-dom'
import { AnimatePresence, motion } from 'framer-motion'
import HeaderMinimal from './components/HeaderMinimal'
import { ContributionsProvider } from './contexts/ContributionsContext'

// Lazy-load route components - each becomes its own chunk
const SwapCore = lazy(() => import('./components/SwapCore'))
const PoolPage = lazy(() => import('./components/PoolPage'))
const BridgePage = lazy(() => import('./components/BridgePage'))
const BuySellPage = lazy(() => import('./components/BuySellPage'))
const VaultPage = lazy(() => import('./components/VaultPage'))
const RewardsPage = lazy(() => import('./components/RewardsPage'))
const DocsPage = lazy(() => import('./components/DocsPage'))
const ForumPage = lazy(() => import('./components/ForumPage'))
const ActivityPage = lazy(() => import('./components/ActivityPage'))
const AdminSybilDetection = lazy(() => import('./components/AdminSybilDetection'))
const AboutPage = lazy(() => import('./components/AboutPage'))
const PersonalityPage = lazy(() => import('./components/PersonalityPage'))

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
        <Suspense fallback={<div className="flex-1" />}>
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
            <Route path="/about" element={<AboutPage />} />
            <Route path="/personality" element={<PersonalityPage />} />
            {/* Admin routes */}
            <Route path="/admin/sybil" element={<AdminSybilDetection />} />
          </Routes>
        </Suspense>
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
