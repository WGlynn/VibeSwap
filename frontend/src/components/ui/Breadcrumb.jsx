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
  api: 'API Docs',
  contact: 'Contact',
  ecosystem: 'Ecosystem',
  brand: 'Brand Assets',
  partners: 'Partners',
  proposal: 'Proposal',
  legal: 'Legal',
  careers: 'Careers',
  badges: 'Badges',
  alerts: 'Price Alerts',
  export: 'Export',
  multisend: 'Multi-Send',
  limit: 'Limit Orders',
  airdrop: 'Airdrop',
  'staking-rewards': 'Staking Rewards',
  watchlist: 'Watchlist',
  onramp: 'On-Ramp',
  proposals: 'Proposals',
  farming: 'Liquidity Mining',
  'portfolio-analytics': 'Portfolio Analytics',
  'bridge-history': 'Bridge History',
  token: 'Token',
  pool: 'Pool',
  treasury: 'Treasury',
  otc: 'OTC Desk',
  fees: 'Fee Structure',
  social: 'Social Trading',
  achievements: 'Achievements',
  'swap-history': 'Swap History',
  grants: 'Grants',
  'lp-positions': 'LP Positions',
  networks: 'Networks',
  approvals: 'Approvals',
  markets: 'Markets',
  'create-token': 'Token Creator',
  derivatives: 'Derivatives',
  'dao-tools': 'DAO Tools',
  margin: 'Margin Trading',
  user: 'Profile',
  automation: 'Automation',
  revenue: 'Revenue Share',
  vesting: 'Vesting',
  liquidations: 'Liquidations',
  delegate: 'Delegate',
  migrate: 'Migration',
  competitions: 'Competitions',
  streaks: 'Streaks',
  health: 'Protocol Health',
  'fee-calculator': 'Fee Calculator',
  mev: 'MEV Dashboard',
  contributors: 'Contributors',
  multichain: 'Multi-Chain',
  education: 'Education',
  'price-impact': 'Price Impact',
  backtest: 'Backtester',
  snapshot: 'Snapshots',
  tax: 'Tax Reports',
  'referral-dashboard': 'Referral Dashboard',
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
