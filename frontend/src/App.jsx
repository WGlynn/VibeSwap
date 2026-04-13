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
import SafariGuide from './components/SafariGuide'
import CommandPalette from './components/CommandPalette'
import { ToastProvider } from './contexts/ToastContext'
import PageSkeleton from './components/ui/PageSkeleton'
import BackToTop from './components/ui/BackToTop'
import NetworkBanner from './components/ui/NetworkBanner'
import Footer from './components/ui/Footer'
import { useSynaptic } from './hooks/useSynaptic'
import { usePageTitle } from './hooks/usePageTitle'
import { FavoritesProvider } from './contexts/FavoritesContext'
import { InfinityStonesProvider } from './hooks/useInfinityStones'
import { GasProvider } from './contexts/GasContext'
import MobileNav from './components/ui/MobileNav'
import DemoBanner from './components/ui/DemoBanner'
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
const TrinityPage = lazy(() => import('./components/TrinityPage'))
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
const MemehunterPage = lazy(() => import('./components/MemehunterPage'))
const CommitRevealPage = lazy(() => import('./components/CommitRevealPage'))
const CRPCPage = lazy(() => import('./components/CRPCPage'))
const TradingPage = lazy(() => import('./components/TradingPage'))
const OptionsPage = lazy(() => import('./components/OptionsPage'))
const YieldPage = lazy(() => import('./components/YieldPage'))
const LaunchpadPage = lazy(() => import('./components/LaunchpadPage'))
const IntentMarketPage = lazy(() => import('./components/IntentMarketPage'))
const DCAPage = lazy(() => import('./components/DCAPage'))
const InsurancePage = lazy(() => import('./components/InsurancePage'))
const AggregatorPage = lazy(() => import('./components/AggregatorPage'))
const BondsPage = lazy(() => import('./components/BondsPage'))
const NFTPage = lazy(() => import('./components/NFTPage'))
const CircuitBreakerPage = lazy(() => import('./components/CircuitBreakerPage'))
const CrossChainPage = lazy(() => import('./components/CrossChainPage'))
const AnalyticsPage = lazy(() => import('./components/AnalyticsPage'))
const GameSwapPage = lazy(() => import('./components/GameSwapPage'))
const OraclePage = lazy(() => import('./components/OraclePage'))
const TokenomicsPage = lazy(() => import('./components/TokenomicsPage'))
const RoadmapPage = lazy(() => import('./components/RoadmapPage'))
const WhitepaperPage = lazy(() => import('./components/WhitepaperPage'))
const SecurityPage = lazy(() => import('./components/SecurityPage'))
const X402Page = lazy(() => import('./components/X402Page'))
const PoePage = lazy(() => import('./components/PoePage'))
const ShapleyPage = lazy(() => import('./components/ShapleyPage'))
const EmissionsPage = lazy(() => import('./components/EmissionsPage'))
const TeamPage = lazy(() => import('./components/TeamPage'))
const FAQPage = lazy(() => import('./components/FAQPage'))
const ChangelogPage = lazy(() => import('./components/ChangelogPage'))
const NotFoundPage = lazy(() => import('./components/NotFoundPage'))
const WalletPage = lazy(() => import('./components/WalletPage'))
const SettingsPage = lazy(() => import('./components/SettingsPage'))
const NotificationsPage = lazy(() => import('./components/NotificationsPage'))
const GasPage = lazy(() => import('./components/GasPage'))
const LeaderboardPage = lazy(() => import('./components/LeaderboardPage'))
const ReferralPage = lazy(() => import('./components/ReferralPage'))
const ProfilePage = lazy(() => import('./components/ProfilePage'))
const TutorialPage = lazy(() => import('./components/TutorialPage'))
const APIDocsPage = lazy(() => import('./components/APIDocsPage'))
const ContactPage = lazy(() => import('./components/ContactPage'))
const EcosystemPage = lazy(() => import('./components/EcosystemPage'))
const BrandAssetsPage = lazy(() => import('./components/BrandAssetsPage'))
const PartnersPage = lazy(() => import('./components/PartnersPage'))
const ProposalDetailPage = lazy(() => import('./components/ProposalDetailPage'))
const LegalPage = lazy(() => import('./components/LegalPage'))
const CareersPage = lazy(() => import('./components/CareersPage'))
const BadgesPage = lazy(() => import('./components/BadgesPage'))
const AlertsPage = lazy(() => import('./components/AlertsPage'))
const ExportPage = lazy(() => import('./components/ExportPage'))
const MultiSendPage = lazy(() => import('./components/MultiSendPage'))
const LimitOrderPage = lazy(() => import('./components/LimitOrderPage'))
const AirdropPage = lazy(() => import('./components/AirdropPage'))
const StakingRewardsPage = lazy(() => import('./components/StakingRewardsPage'))
const WatchlistPage = lazy(() => import('./components/WatchlistPage'))
const TransakPage = lazy(() => import('./components/TransakPage'))
const GovernanceProposalsPage = lazy(() => import('./components/GovernanceProposalsPage'))
const LiquidityMiningPage = lazy(() => import('./components/LiquidityMiningPage'))
const PortfolioAnalyticsPage = lazy(() => import('./components/PortfolioAnalyticsPage'))
const BridgeHistoryPage = lazy(() => import('./components/BridgeHistoryPage'))
const TokenDetailsPage = lazy(() => import('./components/TokenDetailsPage'))
const PoolDetailsPage = lazy(() => import('./components/PoolDetailsPage'))
const TreasuryPage = lazy(() => import('./components/TreasuryPage'))
const OTCPage = lazy(() => import('./components/OTCPage'))
const FeeTierPage = lazy(() => import('./components/FeeTierPage'))
const SocialTradingPage = lazy(() => import('./components/SocialTradingPage'))
const AchievementsPage = lazy(() => import('./components/AchievementsPage'))
const SwapHistoryPage = lazy(() => import('./components/SwapHistoryPage'))
const GrantsPage = lazy(() => import('./components/GrantsPage'))
const LPPositionsPage = lazy(() => import('./components/LPPositionsPage'))
const NetworkSelectorPage = lazy(() => import('./components/NetworkSelectorPage'))
const ApprovalManagerPage = lazy(() => import('./components/ApprovalManagerPage'))
const MarketOverviewPage = lazy(() => import('./components/MarketOverviewPage'))
const TokenCreatorPage = lazy(() => import('./components/TokenCreatorPage'))
const DerivativesPage = lazy(() => import('./components/DerivativesPage'))
const DAOToolsPage = lazy(() => import('./components/DAOToolsPage'))
const MarginTradingPage = lazy(() => import('./components/MarginTradingPage'))
const SocialProfilePage = lazy(() => import('./components/SocialProfilePage'))
const AutomationPage = lazy(() => import('./components/AutomationPage'))
const RevenueSharePage = lazy(() => import('./components/RevenueSharePage'))
const VestingPage = lazy(() => import('./components/VestingPage'))
const LiquidationPage = lazy(() => import('./components/LiquidationPage'))
const GovernanceDelegatePage = lazy(() => import('./components/GovernanceDelegatePage'))
const MigrationPage = lazy(() => import('./components/MigrationPage'))
const CompetitionsPage = lazy(() => import('./components/CompetitionsPage'))
const StreakTrackerPage = lazy(() => import('./components/StreakTrackerPage'))
const ProtocolHealthPage = lazy(() => import('./components/ProtocolHealthPage'))
const FeeCalculatorPage = lazy(() => import('./components/FeeCalculatorPage'))
const MEVDashboardPage = lazy(() => import('./components/MEVDashboardPage'))
const ContributorsPage = lazy(() => import('./components/ContributorsPage'))
const MultiChainPage = lazy(() => import('./components/MultiChainPage'))
const EducationPage = lazy(() => import('./components/EducationPage'))
const PriceImpactPage = lazy(() => import('./components/PriceImpactPage'))
const BacktestPage = lazy(() => import('./components/BacktestPage'))
const SnapshotPage = lazy(() => import('./components/SnapshotPage'))
const TaxReportPage = lazy(() => import('./components/TaxReportPage'))
const ReferralDashboardPage = lazy(() => import('./components/ReferralDashboardPage'))
const DEXScreenerPage = lazy(() => import('./components/DEXScreenerPage'))
const FiatOffRampPage = lazy(() => import('./components/FiatOffRampPage'))
const WhaleWatcherPage = lazy(() => import('./components/WhaleWatcherPage'))
const PortfolioRebalancerPage = lazy(() => import('./components/PortfolioRebalancerPage'))
const LPOptimizerPage = lazy(() => import('./components/LPOptimizerPage'))
const AirdropClaimsPage = lazy(() => import('./components/AirdropClaimsPage'))
const SentimentPage = lazy(() => import('./components/SentimentPage'))
const GasBidderPage = lazy(() => import('./components/GasBidderPage'))
const ProtocolComparisonPage = lazy(() => import('./components/ProtocolComparisonPage'))
const ArbitragePage = lazy(() => import('./components/ArbitragePage'))
const SmartContractPage = lazy(() => import('./components/SmartContractPage'))
const TokenUnlockPage = lazy(() => import('./components/TokenUnlockPage'))
const VibeNamesPage = lazy(() => import('./components/VibeNamesPage'))
const PsiNetPage = lazy(() => import('./components/PsiNetPage'))
const VisionPage = lazy(() => import('./components/VisionPage'))
const GauntletPage = lazy(() => import('./components/GauntletPage'))
const IdeaPage = lazy(() => import('./components/IdeaPage'))

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
          <Suspense fallback={<PageSkeleton />}>
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
            <Route path="/trinity" element={<TrinityPage />} />
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
            <Route path="/memehunter" element={<MemehunterPage />} />
            <Route path="/commit-reveal" element={<CommitRevealPage />} />
            <Route path="/crpc" element={<CRPCPage />} />
            <Route path="/trade" element={<TradingPage />} />
            {/* New DeFi primitives */}
            <Route path="/options" element={<OptionsPage />} />
            <Route path="/yield" element={<YieldPage />} />
            <Route path="/launchpad" element={<LaunchpadPage />} />
            <Route path="/intent-market" element={<IntentMarketPage />} />
            <Route path="/dca" element={<DCAPage />} />
            <Route path="/insurance" element={<InsurancePage />} />
            <Route path="/aggregator" element={<AggregatorPage />} />
            <Route path="/bonds" element={<BondsPage />} />
            <Route path="/nft" element={<NFTPage />} />
            {/* Protocol infrastructure */}
            <Route path="/circuit-breaker" element={<CircuitBreakerPage />} />
            <Route path="/crosschain" element={<CrossChainPage />} />
            <Route path="/analytics" element={<AnalyticsPage />} />
            <Route path="/oracle" element={<OraclePage />} />
            <Route path="/tokenomics" element={<TokenomicsPage />} />
            <Route path="/gameswap" element={<GameSwapPage />} />
            {/* Info & meta */}
            <Route path="/roadmap" element={<RoadmapPage />} />
            <Route path="/whitepaper" element={<WhitepaperPage />} />
            <Route path="/security" element={<SecurityPage />} />
            <Route path="/x402" element={<X402Page />} />
            <Route path="/poe" element={<PoePage />} />
            <Route path="/shapley" element={<ShapleyPage />} />
            <Route path="/emissions" element={<EmissionsPage />} />
            <Route path="/team" element={<TeamPage />} />
            <Route path="/faq" element={<FAQPage />} />
            <Route path="/changelog" element={<ChangelogPage />} />
            {/* Account */}
            <Route path="/wallet" element={<WalletPage />} />
            <Route path="/settings" element={<SettingsPage />} />
            <Route path="/notifications" element={<NotificationsPage />} />
            <Route path="/gas" element={<GasPage />} />
            <Route path="/leaderboard" element={<LeaderboardPage />} />
            <Route path="/referral" element={<ReferralPage />} />
            <Route path="/profile" element={<ProfilePage />} />
            <Route path="/tutorial" element={<TutorialPage />} />
            <Route path="/api" element={<APIDocsPage />} />
            <Route path="/contact" element={<ContactPage />} />
            <Route path="/ecosystem" element={<EcosystemPage />} />
            <Route path="/brand" element={<BrandAssetsPage />} />
            <Route path="/partners" element={<PartnersPage />} />
            <Route path="/proposal" element={<ProposalDetailPage />} />
            <Route path="/legal" element={<LegalPage />} />
            <Route path="/careers" element={<CareersPage />} />
            <Route path="/badges" element={<BadgesPage />} />
            <Route path="/alerts" element={<AlertsPage />} />
            <Route path="/export" element={<ExportPage />} />
            <Route path="/multisend" element={<MultiSendPage />} />
            <Route path="/limit" element={<LimitOrderPage />} />
            <Route path="/airdrop" element={<AirdropPage />} />
            <Route path="/staking-rewards" element={<StakingRewardsPage />} />
            <Route path="/watchlist" element={<WatchlistPage />} />
            <Route path="/onramp" element={<TransakPage />} />
            <Route path="/proposals" element={<GovernanceProposalsPage />} />
            <Route path="/farming" element={<LiquidityMiningPage />} />
            <Route path="/portfolio-analytics" element={<PortfolioAnalyticsPage />} />
            <Route path="/bridge-history" element={<BridgeHistoryPage />} />
            <Route path="/token/:symbol" element={<TokenDetailsPage />} />
            <Route path="/pool/:id" element={<PoolDetailsPage />} />
            <Route path="/treasury" element={<TreasuryPage />} />
            <Route path="/otc" element={<OTCPage />} />
            <Route path="/fees" element={<FeeTierPage />} />
            <Route path="/social" element={<SocialTradingPage />} />
            <Route path="/achievements" element={<AchievementsPage />} />
            <Route path="/swap-history" element={<SwapHistoryPage />} />
            <Route path="/grants" element={<GrantsPage />} />
            <Route path="/lp-positions" element={<LPPositionsPage />} />
            <Route path="/networks" element={<NetworkSelectorPage />} />
            <Route path="/approvals" element={<ApprovalManagerPage />} />
            <Route path="/markets" element={<MarketOverviewPage />} />
            <Route path="/create-token" element={<TokenCreatorPage />} />
            <Route path="/derivatives" element={<DerivativesPage />} />
            <Route path="/dao-tools" element={<DAOToolsPage />} />
            <Route path="/margin" element={<MarginTradingPage />} />
            <Route path="/user/:address" element={<SocialProfilePage />} />
            <Route path="/automation" element={<AutomationPage />} />
            <Route path="/revenue" element={<RevenueSharePage />} />
            <Route path="/vesting" element={<VestingPage />} />
            <Route path="/liquidations" element={<LiquidationPage />} />
            <Route path="/delegate" element={<GovernanceDelegatePage />} />
            <Route path="/migrate" element={<MigrationPage />} />
            <Route path="/competitions" element={<CompetitionsPage />} />
            <Route path="/streaks" element={<StreakTrackerPage />} />
            <Route path="/health" element={<ProtocolHealthPage />} />
            <Route path="/fee-calculator" element={<FeeCalculatorPage />} />
            <Route path="/mev" element={<MEVDashboardPage />} />
            <Route path="/contributors" element={<ContributorsPage />} />
            <Route path="/multichain" element={<MultiChainPage />} />
            <Route path="/education" element={<EducationPage />} />
            <Route path="/price-impact" element={<PriceImpactPage />} />
            <Route path="/backtest" element={<BacktestPage />} />
            <Route path="/snapshot" element={<SnapshotPage />} />
            <Route path="/tax" element={<TaxReportPage />} />
            <Route path="/referral-dashboard" element={<ReferralDashboardPage />} />
            <Route path="/screener" element={<DEXScreenerPage />} />
            <Route path="/offramp" element={<FiatOffRampPage />} />
            <Route path="/whales" element={<WhaleWatcherPage />} />
            <Route path="/rebalance" element={<PortfolioRebalancerPage />} />
            <Route path="/lp-optimizer" element={<LPOptimizerPage />} />
            <Route path="/claims" element={<AirdropClaimsPage />} />
            <Route path="/sentiment" element={<SentimentPage />} />
            <Route path="/priority" element={<GasBidderPage />} />
            <Route path="/compare" element={<ProtocolComparisonPage />} />
            <Route path="/arbitrage" element={<ArbitragePage />} />
            <Route path="/contracts" element={<SmartContractPage />} />
            <Route path="/unlocks" element={<TokenUnlockPage />} />
            <Route path="/names" element={<VibeNamesPage />} />
            <Route path="/psinet" element={<PsiNetPage />} />
            <Route path="/vision" element={<VisionPage />} />
            <Route path="/gauntlet" element={<GauntletPage />} />
            <Route path="/ideas" element={<IdeaPage />} />
            {/* Admin routes */}
            <Route path="/admin/sybil" element={<AdminSybilDetection />} />
            {/* 404 catch-all */}
            <Route path="*" element={<NotFoundPage />} />
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
  usePageTitle() // Auto-set document title from route

  // Synaptic plasticity — strengthen pathways on navigation
  useEffect(() => {
    fire(location.pathname)
    remember('success', { page: location.pathname, action: 'navigate' })
  }, [location.pathname, fire])

  return (
    <ToastProvider>
    <GasProvider>
    <FavoritesProvider>
    <InfinityStonesProvider>
    <MessagingProvider>
    <ContributionsProvider>
      <AmbientBackground />
      <div className="noise-overlay" />
      <CommandPalette />
      <NetworkBanner />
      {isVoicePage ? (
        // Voice page: full screen, no header, no nav
        <div className="fixed inset-0 flex flex-col" style={{ zIndex: 1 }}>
          <DemoBanner />
          <main className="flex-1 overflow-hidden">
            <AnimatedRoutes />
          </main>
        </div>
      ) : isHomePage ? (
        // Home page: completely fixed layout, no scroll possible
        <div className="fixed inset-0 flex flex-col" style={{ zIndex: 1 }}>
          <DemoBanner />
          <HeaderMinimal />
          <main className="flex-1 overflow-hidden">
            <AnimatedRoutes />
          </main>
        </div>
      ) : (
        // Other pages: allow scrolling with .allow-scroll class
        <div className="fixed inset-0 flex flex-col allow-scroll" style={{ zIndex: 1 }}>
          <DemoBanner />
          <HeaderMinimal />
          <main className="flex-1 overflow-y-auto allow-scroll">
            <AnimatedRoutes />
            <Footer />
          </main>
        </div>
      )}
    <VibePlayer />
    {location.pathname !== '/jarvis' && location.pathname !== '/voice' && <JarvisBubble />}
    <OnboardingTour />
    <SafariGuide />
    <BackToTop />
    <MobileNav onOpenMenu={() => window.dispatchEvent(new CustomEvent('vibeswap:open-drawer'))} />
    </ContributionsProvider>
    </MessagingProvider>
    </InfinityStonesProvider>
    </FavoritesProvider>
    </GasProvider>
    </ToastProvider>
  )
}

export default App
