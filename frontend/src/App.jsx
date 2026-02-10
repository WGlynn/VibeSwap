import { Routes, Route, useLocation } from 'react-router-dom'
import { AnimatePresence, motion } from 'framer-motion'
import Header from './components/Header'
import HomePage from './components/HomePage'
import SwapPage from './components/SwapPage'
import GameSwapPage from './components/GameSwapPage'
import PoolPage from './components/PoolPage'
import BridgePage from './components/BridgePage'
import AnalyticsPage from './components/AnalyticsPage'
import RewardsPage from './components/RewardsPage'
import DocsPage from './components/DocsPage'
import PersonalityPage from './components/PersonalityPage'
import ForumPage from './components/ForumPage'
import MobileNav from './components/MobileNav'
import { GameModeProvider, useGameMode } from './contexts/GameModeContext'
import { ContributionsProvider } from './contexts/ContributionsContext'

// Mode transition variants
const modeVariants = {
  initial: { opacity: 0, scale: 0.95, filter: 'blur(4px)' },
  animate: { opacity: 1, scale: 1, filter: 'blur(0px)' },
  exit: { opacity: 0, scale: 1.02, filter: 'blur(4px)' }
}

const modeTransition = {
  type: 'spring',
  stiffness: 300,
  damping: 30
}

// Wrapper component that switches between normal and gamer mode with animation
function TradeInterface() {
  const { isGamerMode } = useGameMode()

  return (
    <AnimatePresence mode="wait">
      <motion.div
        key={isGamerMode ? 'gamer' : 'pro'}
        variants={modeVariants}
        initial="initial"
        animate="animate"
        exit="exit"
        transition={modeTransition}
      >
        {isGamerMode ? <GameSwapPage /> : <SwapPage />}
      </motion.div>
    </AnimatePresence>
  )
}

// Page transition variants
const pageVariants = {
  initial: {
    opacity: 0,
    y: 20,
    scale: 0.98,
  },
  in: {
    opacity: 1,
    y: 0,
    scale: 1,
  },
  out: {
    opacity: 0,
    y: -20,
    scale: 0.98,
  },
}

const pageTransition = {
  type: 'tween',
  ease: [0.4, 0, 0.2, 1],
  duration: 0.3,
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
          <Route path="/" element={<HomePage />} />
          <Route path="/swap" element={<TradeInterface />} />
          <Route path="/pool" element={<PoolPage />} />
          <Route path="/bridge" element={<BridgePage />} />
          <Route path="/rewards" element={<RewardsPage />} />
          <Route path="/analytics" element={<AnalyticsPage />} />
          <Route path="/docs" element={<DocsPage />} />
          <Route path="/personality" element={<PersonalityPage />} />
          <Route path="/forum" element={<ForumPage />} />
        </Routes>
      </motion.div>
    </AnimatePresence>
  )
}

function App() {
  return (
    <GameModeProvider>
    <ContributionsProvider>
    <div className="min-h-screen cosmic-bg relative overflow-hidden">
      {/* Noise texture for depth */}
      <div className="noise-overlay" />

      {/* Floating orbs - creates depth and movement */}
      <div className="fixed inset-0 overflow-hidden pointer-events-none">
        <div className="orb orb-1" />
        <div className="orb orb-2" />
        <div className="orb orb-3" />
      </div>

      {/* Subtle grid pattern */}
      <div className="fixed inset-0 grid-pattern pointer-events-none opacity-30" />

      {/* Radial gradient vignette */}
      <div className="fixed inset-0 pointer-events-none bg-[radial-gradient(ellipse_at_center,transparent_0%,rgba(7,8,21,0.4)_70%,rgba(7,8,21,0.8)_100%)]" />

      {/* Main content */}
      <div className="relative z-10 pb-20 md:pb-0">
        <Header />
        <main className="pt-4 md:pt-8 pb-8 md:pb-16">
          <AnimatedRoutes />
        </main>
      </div>

      {/* Mobile Navigation */}
      <MobileNav />

      {/* Bottom glow accent */}
      <div className="fixed bottom-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-vibe-500/50 to-transparent pointer-events-none" />
    </div>
    </ContributionsProvider>
    </GameModeProvider>
  )
}

export default App
