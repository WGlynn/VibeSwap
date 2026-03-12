import { lazy, Suspense, Component, useEffect } from 'react'
import { Routes, Route, useLocation } from 'react-router-dom'
import { AnimatePresence, motion } from 'framer-motion'
import HeaderMinimal from './components/HeaderMinimal'
import AmbientBackground from './components/ui/AmbientBackground'
import VibePlayer from './components/VibePlayer'
import { ContributionsProvider } from './contexts/ContributionsContext'
import { MessagingProvider } from './contexts/MessagingContext'
import { useKeyboardNav } from './hooks/useKeyboardNav'
import JarvisBubble from './components/JarvisBubble'
import OnboardingTour from './components/OnboardingTour'
import { useSynaptic } from './hooks/useSynaptic'
import { remember } from './utils/sankofa'

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
const VoiceChat = lazy(() => import('./components/VoiceChat'))
const JobMarket = lazy(() => import('./components/JobMarket'))
const MinePage = lazy(() => import('./components/MinePage'))
const FairnessRace = lazy(() => import('./components/FairnessRace'))
const MindMesh = lazy(() => import('./components/MindMesh'))
const PredictionMarket = lazy(() => import('./components/PredictionMarket'))
const PortfolioDashboard = lazy(() => import('./components/PortfolioDashboard'))
const StatusDashboard = lazy(() => import('./components/StatusDashboard'))
const MedicineWheel = lazy(() => import('./components/MedicineWheel'))
const AbstractionLadder = lazy(() => import('./components/AbstractionLadder'))
const EconomicsPage = lazy(() => import('./components/EconomicsPage'))
const ResearchPage = lazy(() => import('./components/ResearchPage'))
const AppStore = lazy(() => import('./components/AppStore'))
const VibeFeed = lazy(() => import('./components/VibeFeed'))
const VibeWiki = lazy(() => import('./components/VibeWiki'))
const DePINHub = lazy(() => import('./components/DePINHub'))
const AgentHub = lazy(() => import('./components/AgentHub'))
const RWAHub = lazy(() => import('./components/RWAHub'))
const LendingPage = lazy(() => import('./components/LendingPage'))
const StakingPage = lazy(() => import('./components/StakingPage'))
const GovernancePage = lazy(() => import('./components/GovernancePage'))
const InfoFiPage = lazy(() => import('./components/InfoFiPage'))
const PerpetualsPage = lazy(() => import('./components/PerpetualsPage'))
const PrivacyPage = lazy(() => import('./components/PrivacyPage'))
const LiveStream = lazy(() => import('./components/LiveStream'))
const CovenantPage = lazy(() => import('./components/CovenantPage'))
const RosettaPage = lazy(() => import('./components/RosettaPage'))
const JulPage = lazy(() => import('./components/JulPage'))
const PhilosophyPage = lazy(() => import('./components/PhilosophyPage'))
const TrustTimelinePage = lazy(() => import('./components/TrustTimelinePage'))
const GameTheoryPage = lazy(() => import('./components/GameTheoryPage'))
const AgenticEconomyPage = lazy(() => import('./components/AgenticEconomyPage'))
const GracefulInversionPage = lazy(() => import('./components/GracefulInversionPage'))

// Sacred Geometry page transitions
// Phi (golden ratio) = 1.618... — appears in nautilus shells, galaxies, and markets
// Duration scaled to 1/phi^3 ~= 0.236s. Easing follows the golden spiral.
const PHI = 1.618033988749895

const pageVariants = {
  initial: { opacity: 0, y: 8, filter: 'blur(4px)' },
  in: { opacity: 1, y: 0, filter: 'blur(0px)' },
  out: { opacity: 0, y: -4, filter: 'blur(2px)' },
}

const pageTransition = {
  duration: 1 / (PHI * PHI * PHI), // ~0.236s — golden ratio timing
  ease: [0.25, 0.1, 1 / PHI, 1],   // golden spiral easing
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
            <Route path="/voice" element={<VoiceChat />} />
            <Route path="/bounties" element={<JobMarket />} />
            <Route path="/mine" element={<MinePage />} />
            <Route path="/fairness" element={<FairnessRace />} />
            <Route path="/mesh" element={<MindMesh />} />
            <Route path="/predict" element={<PredictionMarket />} />
            <Route path="/portfolio" element={<PortfolioDashboard />} />
            <Route path="/status" element={<StatusDashboard />} />
            <Route path="/wheel" element={<MedicineWheel />} />
            <Route path="/abstraction" element={<AbstractionLadder />} />
            <Route path="/economics" element={<EconomicsPage />} />
            <Route path="/research" element={<ResearchPage />} />
            {/* VSOS Apps */}
            <Route path="/apps" element={<AppStore />} />
            <Route path="/feed" element={<VibeFeed />} />
            <Route path="/wiki" element={<VibeWiki />} />
            {/* New protocol hubs */}
            <Route path="/depin" element={<DePINHub />} />
            <Route path="/agents" element={<AgentHub />} />
            <Route path="/rwa" element={<RWAHub />} />
            <Route path="/lend" element={<LendingPage />} />
            <Route path="/stake" element={<StakingPage />} />
            <Route path="/govern" element={<GovernancePage />} />
            <Route path="/infofi" element={<InfoFiPage />} />
            <Route path="/perps" element={<PerpetualsPage />} />
            <Route path="/privacy" element={<PrivacyPage />} />
            {/* Live stream */}
            <Route path="/live" element={<LiveStream />} />
            {/* Pantheon governance */}
            <Route path="/covenants" element={<CovenantPage />} />
            <Route path="/rosetta" element={<RosettaPage />} />
            <Route path="/jul" element={<JulPage />} />
            <Route path="/philosophy" element={<PhilosophyPage />} />
            <Route path="/trust" element={<TrustTimelinePage />} />
            <Route path="/gametheory" element={<GameTheoryPage />} />
            <Route path="/agentic" element={<AgenticEconomyPage />} />
            <Route path="/inversion" element={<GracefulInversionPage />} />
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
  const isVoicePage = location.pathname === '/voice'
  const { fire } = useSynaptic()
  useKeyboardNav() // Ctrl+K swap, Ctrl+J jarvis, Ctrl+M mesh, etc.

  // Synaptic plasticity — strengthen pathways on navigation
  useEffect(() => {
    fire(location.pathname)
    remember('success', { page: location.pathname, action: 'navigate' })
  }, [location.pathname, fire])

  return (
    <MessagingProvider>
    <ContributionsProvider>
      <AmbientBackground />
      <div className="noise-overlay" />
      {isVoicePage ? (
        // Voice page: full screen, no header, no nav
        <div className="fixed inset-0 flex flex-col" style={{ zIndex: 1 }}>
          <main className="flex-1 overflow-hidden">
            <AnimatedRoutes />
          </main>
        </div>
      ) : isHomePage ? (
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
    <VibePlayer />
    {location.pathname !== '/jarvis' && location.pathname !== '/voice' && <JarvisBubble />}
    <OnboardingTour />
    </ContributionsProvider>
    </MessagingProvider>
  )
}

export default App
