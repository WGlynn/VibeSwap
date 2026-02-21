import { lazy, Suspense, Component } from 'react'
import { Routes, Route, useLocation } from 'react-router-dom'
import { AnimatePresence, motion } from 'framer-motion'
import HeaderMinimal from './components/HeaderMinimal'
import AmbientBackground from './components/ui/AmbientBackground'
import { ContributionsProvider } from './contexts/ContributionsContext'
import { MessagingProvider } from './contexts/MessagingContext'

// Error boundary to catch React errors
class ErrorBoundary extends Component {
  constructor(props) {
    super(props)
    this.state = { hasError: false, error: null }
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error }
  }

  componentDidCatch(error, errorInfo) {
    console.error('React Error:', error, errorInfo)
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="flex-1 flex items-center justify-center p-8">
          <div className="text-center max-w-md">
            <h2 className="text-xl font-bold text-red-500 mb-4">Something went wrong</h2>
            <p className="text-black-400 text-sm mb-4">{this.state.error?.message || 'Unknown error'}</p>
            <button
              onClick={() => window.location.reload()}
              className="px-4 py-2 bg-matrix-500 text-black rounded"
            >
              Reload Page
            </button>
          </div>
        </div>
      )
    }
    return this.props.children
  }
}

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
const MessageBoard = lazy(() => import('./components/MessageBoard'))
const PromptsPage = lazy(() => import('./components/PromptsPage'))
const JarvisPage = lazy(() => import('./components/JarvisPage'))
const MinePage = lazy(() => import('./components/MinePage'))

// Rocketship page transitions — blur + slide + opacity
const pageVariants = {
  initial: { opacity: 0, y: 8, filter: 'blur(4px)' },
  in: { opacity: 1, y: 0, filter: 'blur(0px)' },
  out: { opacity: 0, y: -4, filter: 'blur(2px)' },
}

const pageTransition = {
  duration: 0.25,
  ease: [0.25, 0.1, 0.25, 1],
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
        <ErrorBoundary>
          <Suspense fallback={<div className="flex-1 flex items-center justify-center"><div className="text-matrix-500">Loading...</div></div>}>
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
            <Route path="/board" element={<MessageBoard />} />
            <Route path="/docs" element={<DocsPage />} />
            <Route path="/about" element={<AboutPage />} />
            <Route path="/personality" element={<PersonalityPage />} />
            <Route path="/prompts" element={<PromptsPage />} />
            <Route path="/jarvis" element={<JarvisPage />} />
            <Route path="/mine" element={<MinePage />} />
            {/* Admin routes */}
            <Route path="/admin/sybil" element={<AdminSybilDetection />} />
            </Routes>
          </Suspense>
        </ErrorBoundary>
      </motion.div>
    </AnimatePresence>
  )
}

function App() {
  const location = useLocation()
  const isHomePage = location.pathname === '/'

  // Scroll is now prevented globally in index.html for native iOS feel

  return (
    <MessagingProvider>
    <ContributionsProvider>
      <AmbientBackground />
      <div className="noise-overlay" />
      {isHomePage ? (
        // Home page: completely fixed layout, no scroll possible
        <div className="fixed inset-0 flex flex-col" style={{ zIndex: 1 }}>
          <HeaderMinimal />
          <main className="flex-1 overflow-hidden">
            <AnimatedRoutes />
          </main>
        </div>
      ) : (
        // Other pages: allow scrolling with .allow-scroll class
        <div className="fixed inset-0 flex flex-col allow-scroll" style={{ zIndex: 1 }}>
          <HeaderMinimal />
          <main className="flex-1 overflow-y-auto allow-scroll">
            <AnimatedRoutes />
          </main>
        </div>
      )}
    </ContributionsProvider>
    </MessagingProvider>
  )
}

export default App
