import { useState, useMemo, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { motion, AnimatePresence } from 'framer-motion'
import { useWallet } from '../hooks/useWallet'
import { useDeviceWallet } from '../hooks/useDeviceWallet'
import GlassCard from './ui/GlassCard'
import PageHero from './ui/PageHero'

// ============ Constants ============
const PHI = 1.618033988749895
const CYAN = '#06b6d4'
const Section = ({ children, className = '' }) => (
  <div className={`max-w-7xl mx-auto px-4 ${className}`}>{children}</div>
)

// ============ App Registry ============
const APPS = [
  { id: 'memehunter', icon: '🐸', name: 'Memehunter',          tagline: 'Snipe new meme tokens before they pump',           category: 'Tools',      route: '/memehunter', status: 'installed', rating: 4.9, installs: '156K', featured: true },
  { id: 'exchange',   icon: '💱', name: 'Exchange',             tagline: 'Swap tokens with zero MEV',                         category: 'DeFi',       route: '/',           status: 'installed', rating: 4.9, installs: '142K', featured: false },
  { id: 'mine',       icon: '⛏️', name: 'JUL Miner',            tagline: 'Earn Joule tokens through proof-of-contribution',   category: 'DeFi',       route: '/mine',       status: 'installed', rating: 4.7, installs: '83K',  featured: false },
  { id: 'bridge',     icon: '🌉', name: 'Bridge',               tagline: 'Cross-chain transfers via LayerZero V2',            category: 'DeFi',       route: '/bridge',     status: 'installed', rating: 4.8, installs: '120K', featured: false },
  { id: 'vault',      icon: '💰', name: 'Vault',                tagline: 'Secure savings vault with auto-compound',           category: 'DeFi',       route: '/vault',      status: 'installed', rating: 4.6, installs: '91K',  featured: false },
  { id: 'portfolio',  icon: '📊', name: 'Portfolio Tracker',    tagline: 'Track your holdings across all chains',             category: 'Tools',      route: '/portfolio',  status: 'installed', rating: 4.8, installs: '104K', featured: false },
  { id: 'predict',    icon: '🔮', name: 'Prediction Market',    tagline: 'Permissionless prediction markets with Shapley',    category: 'DeFi',       route: '/predict',    status: 'installed', rating: 4.5, installs: '55K',  featured: false },
  { id: 'vibechat',   icon: '💬', name: 'Voice Chat',           tagline: 'Encrypted group messaging and audio rooms',         category: 'Social',     route: '/board',      status: 'installed', rating: 4.6, installs: '78K',  featured: false },
  { id: 'vibefeed',   icon: '📡', name: 'VibeFeed',             tagline: 'Decentralized microblogging with Shapley revenue',  category: 'Social',     route: '/feed',       status: 'new',       rating: 4.4, installs: '41K',  featured: false },
  { id: 'vibewiki',   icon: '📚', name: 'VibeWiki',             tagline: 'Community knowledge base with edit rewards',        category: 'Tools',      route: '/wiki',       status: 'new',       rating: 4.4, installs: '27K',  featured: false },
  { id: 'dca',        icon: '🔄', name: 'DCA Bot',              tagline: 'Dollar-cost average into any token automatically',  category: 'DeFi',       route: '/dca',        status: 'new',       rating: 4.5, installs: '36K',  featured: false },
  { id: 'yield',      icon: '🌾', name: 'Yield Optimizer',      tagline: 'Auto-compound yield across DeFi protocols',         category: 'DeFi',       route: '/yield',      status: 'new',       rating: 4.6, installs: '44K',  featured: false },
  { id: 'privacy',    icon: '🛡️', name: 'Privacy Mixer',        tagline: 'Compliant privacy via association sets',            category: 'DeFi',       route: '/privacy',    status: 'new',       rating: 4.3, installs: '18K',  featured: false },
  { id: 'lending',    icon: '🏦', name: 'Lend & Borrow',        tagline: 'Aave-style lending with kink model',                category: 'DeFi',       route: '/lend',       status: 'new',       rating: 4.7, installs: '38K',  featured: false },
  { id: 'staking',    icon: '🔒', name: 'Staking',              tagline: 'Multi-pool staking with lock tiers',                category: 'DeFi',       route: '/stake',      status: 'new',       rating: 4.8, installs: '67K',  featured: false },
  { id: 'jarvis',     icon: '🧠', name: 'JARVIS',               tagline: 'Your AI assistant — smarter every session',         category: 'AI',         route: '/jarvis',     status: 'installed', rating: 4.9, installs: '198K', featured: false },
  { id: 'agents',     icon: '🤖', name: 'AI Agents',            tagline: 'Deploy, hire, and orchestrate autonomous agents',   category: 'AI',         route: '/agents',     status: 'new',       rating: 4.6, installs: '47K',  featured: false },
  { id: 'govern',     icon: '🗳️', name: 'Governance',           tagline: 'veVIBE voting, proposals, and gauge weights',      category: 'Governance', route: '/govern',     status: 'new',       rating: 4.5, installs: '34K',  featured: false },
  { id: 'launchpad',  icon: '🚀', name: 'Launchpad',            tagline: 'Fair-launch token sales with batch auctions',       category: 'DeFi',       route: '/launch',     status: 'coming_soon', rating: 0, installs: '0',   featured: false },
  { id: 'arcade',     icon: '🎮', name: 'VibeArcade',           tagline: 'On-chain mini-games with fair Shapley rewards',     category: 'Games',      route: '/arcade',     status: 'coming_soon', rating: 0, installs: '0',   featured: false },
  { id: 'treasury',   icon: '🏛️', name: 'Treasury',             tagline: 'DAO treasury dashboard and allocations',           category: 'Governance', route: '/treasury',   status: 'coming_soon', rating: 0, installs: '0',   featured: false },
  { id: 'perps',      icon: '📈', name: 'Perpetuals',           tagline: 'Trade perps with up to 20x leverage',              category: 'DeFi',       route: '/perps',      status: 'new',       rating: 4.4, installs: '29K',  featured: false },
  { id: 'vibeforum',  icon: '🗨️', name: 'VibeForum',            tagline: 'Community discussions and governance debates',     category: 'Social',     route: '/forum',      status: 'installed', rating: 4.5, installs: '62K',  featured: false },
  { id: 'mindmesh',   icon: '🌐', name: 'Mind Mesh',             tagline: 'Network topology visualizer',                      category: 'Tools',      route: '/mesh',       status: 'installed', rating: 4.2, installs: '22K',  featured: false },
  { id: 'vibeplayer', icon: '🎵', name: 'VibePlayer',            tagline: 'Community playlist — vibe while you trade',        category: 'Tools',      route: null,          status: 'builtin',   rating: 4.7, installs: '89K',  featured: false },
  { id: 'ideas',      icon: '💡', name: 'Ideas',                 tagline: 'Submit and vote on what VibeSwap builds next',     category: 'Community',  route: '/ideas',      status: 'new',       rating: 4.8, installs: '0',    featured: false },
]

const CATEGORIES = ['All', 'DeFi', 'Social', 'Community', 'Tools', 'Games', 'AI', 'Governance']
const STATUS_CONFIG = {
  installed:   { label: 'Installed',   color: 'text-matrix-400', bg: 'bg-matrix-600/15', border: 'border-matrix-600/30' },
  new:         { label: 'New',         color: 'text-cyan-400',   bg: 'bg-cyan-600/15',   border: 'border-cyan-600/30' },
  coming_soon: { label: 'Coming Soon', color: 'text-amber-400',  bg: 'bg-amber-600/15',  border: 'border-amber-600/30' },
  builtin:     { label: 'Built-in',    color: 'text-matrix-500', bg: 'bg-matrix-900/20', border: 'border-matrix-800/30' },
}
const stagger = {
  container: { hidden: {}, visible: { transition: { staggerChildren: 1 / (PHI * PHI * 10) } } },
  item: { hidden: { opacity: 0, y: 16 }, visible: { opacity: 1, y: 0, transition: { duration: 1 / (PHI * PHI) } } },
}

// ============ Star Rating ============
function StarRating({ rating }) {
  if (!rating) return null
  const full = Math.floor(rating)
  const half = rating - full >= 0.5
  return (
    <div className="flex items-center gap-0.5">
      {Array.from({ length: 5 }, (_, i) => (
        <svg key={i} className={`w-3 h-3 ${i < full ? 'text-amber-400' : (i === full && half ? 'text-amber-400/50' : 'text-gray-700')}`} fill="currentColor" viewBox="0 0 20 20">
          <path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z" />
        </svg>
      ))}
      <span className="text-xs text-gray-500 ml-1 font-mono">{rating.toFixed(1)}</span>
    </div>
  )
}

// ============ Install Button (Animated with Checkmark) ============
function InstallButton({ app, onOpen, size = 'sm' }) {
  const [installing, setInstalling] = useState(false)
  const [done, setDone] = useState(false)
  const isDisabled = app.status === 'coming_soon'
  const isInstalled = app.status === 'installed' || app.status === 'builtin'

  const handleInstall = useCallback((e) => {
    e.stopPropagation()
    if (isDisabled) return
    if (isInstalled) { onOpen(app.route); return }
    setInstalling(true)
    setTimeout(() => {
      setInstalling(false)
      setDone(true)
      setTimeout(() => { setDone(false); onOpen(app.route) }, 800)
    }, 1200)
  }, [app, isDisabled, isInstalled, onOpen])

  const sz = size === 'lg' ? 'px-6 py-2.5 text-sm' : 'px-4 py-1.5 text-xs'

  if (isDisabled) return <span className={`${sz} font-medium rounded-lg bg-black-900/40 text-gray-600 border border-black-700/50`}>Coming Soon</span>

  if (done) return (
    <motion.span initial={{ scale: 0.8 }} animate={{ scale: 1 }} className={`${sz} font-bold rounded-lg bg-matrix-600/20 text-matrix-400 border border-matrix-600/30 inline-flex items-center gap-1.5`}>
      <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <motion.path initial={{ pathLength: 0 }} animate={{ pathLength: 1 }} transition={{ duration: 0.4 }} strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
      </svg>
      Done
    </motion.span>
  )

  if (installing) return (
    <span className={`${sz} font-bold rounded-lg bg-cyan-600/20 text-cyan-400 border border-cyan-600/30 inline-flex items-center gap-1.5`}>
      <motion.div className="w-3 h-3 border-2 border-cyan-400 border-t-transparent rounded-full" animate={{ rotate: 360 }} transition={{ repeat: Infinity, duration: 0.6, ease: 'linear' }} />
      Installing...
    </span>
  )

  return (
    <motion.button whileHover={{ scale: 1.05 }} whileTap={{ scale: 0.95 }} onClick={handleInstall}
      className={`${sz} font-bold rounded-lg transition-colors duration-150 ${isInstalled ? 'bg-matrix-600/20 text-matrix-400 border border-matrix-600/30 hover:bg-matrix-600/30' : 'bg-cyan-600 hover:bg-cyan-500 text-black'}`}>
      {isInstalled ? 'Open' : 'Install'}
    </motion.button>
  )
}

// ============ Status Badge ============
function StatusBadge({ status }) {
  const config = STATUS_CONFIG[status]
  if (!config || status === 'installed') return null
  return (
    <span className={`absolute top-3 right-3 px-2 py-0.5 text-[10px] font-bold rounded-full ${config.bg} ${config.color} ${config.border} border uppercase tracking-wider`}>
      {status === 'coming_soon' ? 'Soon' : config.label}
    </span>
  )
}

// ============ App Card ============
function AppCard({ app, onOpen }) {
  const isDisabled = app.status === 'coming_soon'
  return (
    <motion.div variants={stagger.item} layout>
      <GlassCard glowColor="terminal" spotlight hover={!isDisabled}
        className={`relative p-5 flex flex-col gap-3 h-full ${isDisabled ? 'opacity-50' : 'cursor-pointer'}`}
        onClick={() => { if (!isDisabled && app.route) onOpen(app.route) }}>
        <StatusBadge status={app.status} />
        <div className="text-3xl w-12 h-12 flex items-center justify-center rounded-xl bg-black-900/60 border border-black-700/50">{app.icon}</div>
        <div className="flex-1 min-h-0">
          <h3 className="text-base font-display font-bold text-white leading-tight">{app.name}</h3>
          <p className="text-sm text-gray-400 mt-1 leading-relaxed line-clamp-2">{app.tagline}</p>
        </div>
        <div className="flex items-center gap-3">
          <StarRating rating={app.rating} />
          {app.installs !== '0' && <span className="text-[10px] text-gray-500 font-mono">{app.installs}</span>}
        </div>
        <div className="flex items-center justify-between mt-1">
          <span className="text-[10px] text-gray-500 bg-black-900/40 px-2 py-0.5 rounded-full uppercase tracking-wider">{app.category}</span>
          <InstallButton app={app} onOpen={onOpen} />
        </div>
      </GlassCard>
    </motion.div>
  )
}

// ============ Featured Hero Card ============
function FeaturedHero({ app, onOpen }) {
  if (!app) return null
  return (
    <Section className="mb-8">
      <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 1 / PHI, delay: 0.1 }}>
        <GlassCard glowColor="terminal" spotlight className="relative overflow-hidden">
          <div className="flex flex-col md:flex-row gap-6 p-6 md:p-8">
            <div className="flex-1 flex flex-col justify-center gap-4">
              <span className="text-xs font-mono uppercase tracking-wider px-2 py-0.5 rounded-full bg-cyan-600/15 border border-cyan-600/30 w-fit" style={{ color: CYAN }}>Featured App</span>
              <div className="flex items-center gap-4">
                <div className="text-5xl w-16 h-16 flex items-center justify-center rounded-2xl bg-black-900/60 border border-black-700/50">{app.icon}</div>
                <div>
                  <h2 className="text-2xl md:text-3xl font-display font-bold text-white">{app.name}</h2>
                  <p className="text-gray-400 mt-1">{app.tagline}</p>
                </div>
              </div>
              <div className="flex items-center gap-4 mt-1">
                <StarRating rating={app.rating} />
                <span className="text-xs text-gray-500 font-mono">{app.installs} installs</span>
                <span className="text-xs text-gray-500 bg-black-900/40 px-2 py-0.5 rounded-full uppercase tracking-wider">{app.category}</span>
              </div>
              <InstallButton app={app} onOpen={onOpen} size="lg" />
            </div>
            <div className="flex-1 flex items-center justify-center">
              <div className="w-full h-48 md:h-56 rounded-xl border border-black-700/50 bg-black-900/40 flex items-center justify-center">
                <div className="flex flex-col items-center gap-3 text-gray-600">
                  <svg className="w-12 h-12 opacity-30" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                  </svg>
                  <span className="text-xs font-mono">App Preview</span>
                </div>
              </div>
            </div>
          </div>
        </GlassCard>
      </motion.div>
    </Section>
  )
}

// ============ App Detail Modal ============
function AppDetailModal({ app, onClose, onOpen }) {
  if (!app) return null
  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm" onClick={onClose}>
      <motion.div initial={{ scale: 0.9, y: 20 }} animate={{ scale: 1, y: 0 }} exit={{ scale: 0.9, y: 20 }}
        transition={{ type: 'spring', stiffness: 300, damping: 25 }}
        className="w-full max-w-lg max-h-[85vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <GlassCard glowColor="terminal" spotlight className="p-6">
          <button onClick={onClose} className="absolute top-4 right-4 w-8 h-8 rounded-full bg-black-800/80 border border-black-700 flex items-center justify-center text-gray-400 hover:text-white z-20">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
          </button>
          {/* Header */}
          <div className="flex items-center gap-4 mb-6">
            <div className="text-5xl w-16 h-16 flex items-center justify-center rounded-2xl bg-black-900/60 border border-black-700/50">{app.icon}</div>
            <div>
              <h2 className="text-xl font-display font-bold text-white">{app.name}</h2>
              <p className="text-sm text-gray-400 mt-0.5">{app.tagline}</p>
            </div>
          </div>
          {/* Stats */}
          <div className="flex items-center gap-4 mb-6 pb-4 border-b border-black-700/50">
            <StarRating rating={app.rating} />
            <span className="text-xs text-gray-500 font-mono">{app.installs} installs</span>
            <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${STATUS_CONFIG[app.status]?.bg} ${STATUS_CONFIG[app.status]?.color} ${STATUS_CONFIG[app.status]?.border} border`}>
              {STATUS_CONFIG[app.status]?.label}
            </span>
          </div>
          {/* Description */}
          <div className="mb-6">
            <h3 className="text-sm font-bold text-gray-300 uppercase tracking-wider mb-2">About</h3>
            <p className="text-sm text-gray-400 leading-relaxed">
              {app.tagline}. Built on the VSOS framework with full Shapley Value compliance.
              All revenue is distributed fairly through the cooperative capitalism model.
              This app is part of the VibeSwap Operating System ecosystem.
            </p>
          </div>
          {/* Screenshots */}
          <div className="mb-6">
            <h3 className="text-sm font-bold text-gray-300 uppercase tracking-wider mb-2">Screenshots</h3>
            <div className="flex gap-3 overflow-x-auto pb-2">
              {[1, 2, 3].map((i) => (
                <div key={i} className="min-w-[160px] h-24 rounded-lg border border-black-700/50 bg-black-900/40 flex items-center justify-center">
                  <span className="text-[10px] text-gray-600 font-mono">Preview {i}</span>
                </div>
              ))}
            </div>
          </div>
          {/* Reviews */}
          <div className="mb-6">
            <h3 className="text-sm font-bold text-gray-300 uppercase tracking-wider mb-2">Reviews</h3>
            <div className="space-y-3">
              {[
                { user: '0xAlice', comment: 'Works flawlessly. Love the Shapley integration.', stars: 5 },
                { user: '0xBob', comment: 'Great UX, fast settlement. Will use again.', stars: 4 },
              ].map((review, i) => (
                <div key={i} className="p-3 rounded-lg bg-black-900/40 border border-black-700/30">
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-xs font-mono" style={{ color: CYAN }}>{review.user}</span>
                    <StarRating rating={review.stars} />
                  </div>
                  <p className="text-xs text-gray-400">{review.comment}</p>
                </div>
              ))}
            </div>
          </div>
          <div className="flex justify-end"><InstallButton app={app} onOpen={onOpen} size="lg" /></div>
        </GlassCard>
      </motion.div>
    </motion.div>
  )
}

// ============ Horizontal App Row (Trending / Popular / New) ============
function AppRow({ title, apps, onOpen, onDetail }) {
  if (!apps.length) return null
  return (
    <Section className="mb-8">
      <h2 className="text-lg font-display font-bold text-white mb-4">{title}</h2>
      <div className="flex gap-4 overflow-x-auto pb-2 scrollbar-thin scrollbar-thumb-black-700">
        {apps.map((app) => (
          <motion.div key={app.id} whileHover={{ scale: 1.03 }} className="min-w-[200px] max-w-[200px] flex-shrink-0 cursor-pointer" onClick={() => onDetail(app)}>
            <GlassCard glowColor="terminal" className="p-4 h-full flex flex-col gap-2">
              <div className="flex items-center gap-3">
                <div className="text-2xl w-10 h-10 flex items-center justify-center rounded-xl bg-black-900/60 border border-black-700/50">{app.icon}</div>
                <div className="flex-1 min-w-0">
                  <h4 className="text-sm font-bold text-white truncate">{app.name}</h4>
                  <p className="text-[10px] text-gray-500 truncate">{app.category}</p>
                </div>
              </div>
              <StarRating rating={app.rating} />
              <div className="mt-auto pt-1"><InstallButton app={app} onOpen={onOpen} /></div>
            </GlassCard>
          </motion.div>
        ))}
      </div>
    </Section>
  )
}

// ============ Submit Your App ============
function SubmitAppSection() {
  return (
    <Section className="mb-8">
      <GlassCard glowColor="terminal" className="p-6 md:p-8">
        <div className="flex flex-col md:flex-row items-center gap-6">
          <div className="flex-1">
            <h2 className="text-xl font-display font-bold text-white mb-2">Submit Your App</h2>
            <p className="text-sm text-gray-400 leading-relaxed mb-4">
              Built something on VSOS? Submit your micro-app to the App Store.
              All apps must be Shapley Value Compliant. Revenue is distributed fairly
              through the cooperative capitalism model.
            </p>
            <ul className="text-xs text-gray-500 space-y-1 mb-4">
              {['Automatic Shapley revenue distribution', 'Featured placement for top-rated apps', 'Access to VSOS SDK and component library', 'Cross-chain deployment via LayerZero V2'].map((t) => (
                <li key={t} className="flex items-center gap-2"><span style={{ color: CYAN }}>&#x2713;</span> {t}</li>
              ))}
            </ul>
          </div>
          <div className="flex flex-col gap-3 items-center">
            <motion.button whileHover={{ scale: 1.05 }} whileTap={{ scale: 0.95 }} className="px-6 py-3 rounded-xl font-bold text-sm text-black" style={{ backgroundColor: CYAN }}>
              Submit App
            </motion.button>
            <span className="text-[10px] text-gray-600 font-mono">Review takes ~48h</span>
          </div>
        </div>
      </GlassCard>
    </Section>
  )
}

// ============ Developer SDK Promotion ============
function SDKSection() {
  return (
    <Section className="mb-8">
      <GlassCard glowColor="terminal" className="p-6 md:p-8 text-center">
        <div className="max-w-2xl mx-auto">
          <div className="text-4xl mb-4">&#x1F6E0;&#xFE0F;</div>
          <h2 className="text-xl font-display font-bold text-white mb-2">VSOS Developer SDK</h2>
          <p className="text-sm text-gray-400 leading-relaxed mb-6">
            Build micro-apps that plug directly into the VibeSwap Operating System.
            GlassCard components, wallet hooks, Shapley integration, and cross-chain
            messaging out of the box. One SDK, every chain.
          </p>
          <div className="flex flex-wrap items-center justify-center gap-3 mb-6">
            {['React 18', 'Tailwind CSS', 'ethers.js v6', 'LayerZero V2', 'Shapley SDK', 'Framer Motion'].map((tech) => (
              <span key={tech} className="text-[10px] font-mono px-3 py-1 rounded-full bg-black-900/60 border border-black-700/50 text-gray-400">{tech}</span>
            ))}
          </div>
          <div className="bg-black-900/60 border border-black-700/50 rounded-lg p-4 text-left mb-4 font-mono text-xs">
            <span className="text-gray-500">$</span> <span style={{ color: CYAN }}>npm install</span> <span className="text-white">@vibeswap/vsos-sdk</span>
          </div>
          <motion.button whileHover={{ scale: 1.05 }} whileTap={{ scale: 0.95 }}
            className="px-6 py-2.5 rounded-xl font-bold text-sm border transition-colors hover:bg-cyan-600/10"
            style={{ borderColor: CYAN, color: CYAN }}>
            Read the Docs
          </motion.button>
        </div>
      </GlassCard>
    </Section>
  )
}

// ============ App Store Page ============
export default function AppStore() {
  const navigate = useNavigate()
  const { isConnected: isExternalConnected } = useWallet()
  const { isConnected: isDeviceConnected } = useDeviceWallet()
  const isConnected = isExternalConnected || isDeviceConnected

  const [activeCategory, setActiveCategory] = useState('All')
  const [search, setSearch] = useState('')
  const [detailApp, setDetailApp] = useState(null)

  // ============ Derived Data ============
  const featuredApp = useMemo(() => APPS.find(a => a.featured), [])

  const filteredApps = useMemo(() => {
    return APPS.filter(app => {
      const matchesCategory = activeCategory === 'All' || app.category === activeCategory
      const q = search.toLowerCase()
      const matchesSearch = !search || app.name.toLowerCase().includes(q) || app.tagline.toLowerCase().includes(q) || app.category.toLowerCase().includes(q)
      return matchesCategory && matchesSearch
    })
  }, [activeCategory, search])

  const popularApps = useMemo(() =>
    [...APPS].filter(a => a.status !== 'coming_soon').sort((a, b) => {
      const p = (s) => parseFloat(s.replace('K', '')) * 1000
      return p(b.installs) - p(a.installs)
    }).slice(0, 6), [])

  const trendingApps = useMemo(() => APPS.filter(a => a.status === 'new').slice(0, 6), [])
  const newApps = useMemo(() => APPS.filter(a => a.status === 'new' && a.rating >= 4.5).slice(0, 6), [])

  const handleOpen = useCallback((route) => { if (route) navigate(route) }, [navigate])
  const handleDetail = useCallback((app) => { setDetailApp(app) }, [])

  const totalApps = APPS.length
  const installedCount = APPS.filter(a => a.status === 'installed').length
  const newCount = APPS.filter(a => a.status === 'new').length
  const comingSoonCount = APPS.filter(a => a.status === 'coming_soon').length

  // ============ Render ============

  return (
    <div className="min-h-screen pb-16">

      {/* ============ Page Hero ============ */}
      <PageHero
        title="App Store"
        subtitle="VSOS — The VibeSwap Operating System"
        category="ecosystem"
        badge={isConnected ? 'Connected' : undefined}
        badgeColor={CYAN}
      >
        <div className="flex items-center gap-3 text-xs text-gray-500 font-mono">
          <span>{totalApps} apps</span>
          <span className="text-black-700">|</span>
          <span className="text-matrix-400">{installedCount} installed</span>
          <span className="text-black-700">|</span>
          <span style={{ color: CYAN }}>{newCount} new</span>
        </div>
      </PageHero>

      {/* ============ Featured App Hero ============ */}
      <FeaturedHero app={featuredApp} onOpen={handleOpen} />

      {/* ============ Search Bar with Live Filter ============ */}
      <Section className="mb-6">
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.1 }}
          className="max-w-lg mx-auto"
        >
          <div className="relative">
            <svg className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
            <input
              type="text"
              placeholder="Search VSOS apps..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full pl-11 pr-10 py-3 bg-black-800/60 border border-black-700 rounded-xl text-white placeholder-gray-500 focus:outline-none focus:border-cyan-600/50 focus:ring-1 focus:ring-cyan-600/20 transition-colors font-mono text-sm"
            />
            {search && (
              <button
                onClick={() => setSearch('')}
                className="absolute right-3 top-1/2 -translate-y-1/2 w-5 h-5 rounded-full bg-black-700 flex items-center justify-center text-gray-400 hover:text-white"
              >
                <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            )}
          </div>
        </motion.div>
      </Section>

      {/* ============ Category Tabs ============ */}
      <Section className="mb-8">
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.15 }}
          className="flex items-center justify-center gap-2 flex-wrap"
        >
          {CATEGORIES.map((cat) => (
            <motion.button
              key={cat}
              whileHover={{ scale: 1.05 }}
              whileTap={{ scale: 0.95 }}
              onClick={() => setActiveCategory(cat)}
              className={`px-4 py-2 rounded-lg text-sm font-medium transition-all duration-200 ${
                activeCategory === cat
                  ? 'text-black font-bold'
                  : 'bg-black-800/60 text-gray-400 border border-black-700 hover:border-cyan-600/30 hover:text-white'
              }`}
              style={activeCategory === cat ? { backgroundColor: CYAN } : {}}
            >
              {cat}
            </motion.button>
          ))}
        </motion.div>
      </Section>

      {/* ============ Curated Rows (Most Popular / Trending / New) ============ */}
      {activeCategory === 'All' && !search && (
        <>
          <AppRow title="Most Popular" apps={popularApps} onOpen={handleOpen} onDetail={handleDetail} />
          <AppRow title="Trending" apps={trendingApps} onOpen={handleOpen} onDetail={handleDetail} />
          <AppRow title="New & Noteworthy" apps={newApps} onOpen={handleOpen} onDetail={handleDetail} />
        </>
      )}

      {/* ============ Main App Grid ============ */}
      <Section className="mb-10">
        <h2 className="text-lg font-display font-bold text-white mb-4">
          {activeCategory === 'All' && !search
            ? 'All Apps'
            : search
              ? `Results for "${search}"`
              : activeCategory}
        </h2>

        <motion.div
          variants={stagger.container}
          initial="hidden"
          animate="visible"
          className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4"
        >
          <AnimatePresence mode="popLayout">
            {filteredApps.map((app) => (
              <AppCard key={app.id} app={app} onOpen={handleOpen} />
            ))}
          </AnimatePresence>
        </motion.div>

        {/* Empty State */}
        {filteredApps.length === 0 && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="text-center py-16"
          >
            <div className="text-4xl mb-3 opacity-30">&#x1F50D;</div>
            <p className="text-gray-500 text-lg">No apps match your search.</p>
            <button
              onClick={() => { setSearch(''); setActiveCategory('All') }}
              className="mt-3 text-sm underline hover:text-cyan-300"
              style={{ color: CYAN }}
            >
              Clear filters
            </button>
          </motion.div>
        )}
      </Section>

      {/* ============ Submit Your App ============ */}
      <SubmitAppSection />

      {/* ============ Developer SDK Promotion ============ */}
      <SDKSection />

      {/* ============ Footer Stats ============ */}
      <Section>
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.3 }}
          className="text-center text-gray-600 text-xs font-mono py-4 border-t border-black-700/30"
        >
          {totalApps} apps &middot; {installedCount} installed &middot; {newCount} new &middot; {comingSoonCount} coming soon &middot; Shapley Value Compliant
        </motion.div>
      </Section>

      {/* ============ App Detail Modal ============ */}
      <AnimatePresence>
        {detailApp && (
          <AppDetailModal
            app={detailApp}
            onClose={() => setDetailApp(null)}
            onOpen={handleOpen}
          />
        )}
      </AnimatePresence>

    </div>
  )
}
