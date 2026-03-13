import { Link, useLocation } from 'react-router-dom'

// ============================================================
// Breadcrumb — Shows current navigation path
// Auto-generates from route, can be customized with labels
// ============================================================

const ROUTE_LABELS = {
  '': 'Home',
  buy: 'Buy / Sell',
  earn: 'Pools',
  vault: 'Vaults',
  send: 'Bridge',
  history: 'Activity',
  rewards: 'Rewards',
  forum: 'Forum',
  board: 'Board',
  docs: 'Docs',
  about: 'About',
  personality: 'Identity',
  prompts: 'Prompts',
  jarvis: 'Jarvis',
  voice: 'Voice',
  bounties: 'Bounties',
  mine: 'Mine',
  fairness: 'Fairness',
  mesh: 'Mind Mesh',
  predict: 'Predictions',
  portfolio: 'Portfolio',
  status: 'Status',
  wheel: 'Medicine Wheel',
  abstraction: 'Abstraction',
  economics: 'Economics',
  research: 'Research',
  apps: 'Apps',
  feed: 'Feed',
  wiki: 'Wiki',
  depin: 'DePIN',
  agents: 'Agents',
  rwa: 'RWA Hub',
  lend: 'Lending',
  stake: 'Staking',
  govern: 'Governance',
  infofi: 'InfoFi',
  perps: 'Perpetuals',
  privacy: 'Privacy',
  live: 'Live',
  covenants: 'Covenants',
  rosetta: 'Rosetta',
  jul: 'JUL',
  philosophy: 'Philosophy',
  trust: 'Trust',
  gametheory: 'Game Theory',
  agentic: 'Agentic Economy',
  inversion: 'Graceful Inversion',
  memehunter: 'Memehunter',
  'commit-reveal': 'Commit-Reveal',
  trade: 'Trading',
  options: 'Options',
  yield: 'Yield',
  launchpad: 'Launchpad',
  dca: 'DCA',
  insurance: 'Insurance',
  aggregator: 'Aggregator',
  bonds: 'Bonds',
  nft: 'NFTs',
  'circuit-breaker': 'Circuit Breaker',
  crosschain: 'Cross-Chain',
  analytics: 'Analytics',
  oracle: 'Oracle',
  tokenomics: 'Tokenomics',
  gameswap: 'GameSwap',
  roadmap: 'Roadmap',
  whitepaper: 'Whitepaper',
  security: 'Security',
  team: 'Team',
  faq: 'FAQ',
  changelog: 'Changelog',
  wallet: 'Wallet',
  settings: 'Settings',
  notifications: 'Notifications',
  gas: 'Gas Tracker',
  leaderboard: 'Leaderboard',
  referral: 'Referrals',
  profile: 'Profile',
  tutorial: 'Getting Started',
}

export default function Breadcrumb({ className = '' }) {
  const location = useLocation()
  const segments = location.pathname.split('/').filter(Boolean)

  if (segments.length === 0) return null

  return (
    <nav className={`flex items-center gap-1.5 text-[10px] font-mono ${className}`} aria-label="Breadcrumb">
      <Link to="/" className="text-black-500 hover:text-cyan-400 transition-colors">
        Home
      </Link>
      {segments.map((seg, i) => {
        const path = '/' + segments.slice(0, i + 1).join('/')
        const label = ROUTE_LABELS[seg] || seg.charAt(0).toUpperCase() + seg.slice(1)
        const isLast = i === segments.length - 1

        return (
          <span key={path} className="flex items-center gap-1.5">
            <span className="text-black-700">/</span>
            {isLast ? (
              <span className="text-black-300">{label}</span>
            ) : (
              <Link to={path} className="text-black-500 hover:text-cyan-400 transition-colors">
                {label}
              </Link>
            )}
          </span>
        )
      })}
    </nav>
  )
}
