import { Link } from 'react-router-dom'
import { motion } from 'framer-motion'

// ============================================================
// Footer — Site-wide navigation footer with links and status
// ============================================================

const CYAN = '#06b6d4'

const COLUMNS = [
  {
    title: 'Trade',
    links: [
      { to: '/', label: 'Swap' },
      { to: '/buy', label: 'Buy / Sell' },
      { to: '/trade', label: 'Trading' },
      { to: '/perps', label: 'Perpetuals' },
      { to: '/options', label: 'Options' },
      { to: '/dca', label: 'DCA' },
      { to: '/aggregator', label: 'Aggregator' },
      { to: '/limit', label: 'Limit Orders' },
      { to: '/multisend', label: 'Multi-Send' },
    ],
  },
  {
    title: 'Earn',
    links: [
      { to: '/earn', label: 'Pools' },
      { to: '/vault', label: 'Vaults' },
      { to: '/stake', label: 'Staking' },
      { to: '/yield', label: 'Yield' },
      { to: '/lend', label: 'Lending' },
      { to: '/bonds', label: 'Bonds' },
      { to: '/rewards', label: 'Rewards' },
      { to: '/farming', label: 'Farming' },
      { to: '/revenue', label: 'Revenue Share' },
      { to: '/vesting', label: 'Vesting' },
    ],
  },
  {
    title: 'Explore',
    links: [
      { to: '/send', label: 'Bridge' },
      { to: '/crosschain', label: 'Cross-Chain' },
      { to: '/predict', label: 'Predictions' },
      { to: '/nft', label: 'NFTs' },
      { to: '/launchpad', label: 'Launchpad' },
      { to: '/rwa', label: 'RWA Hub' },
      { to: '/depin', label: 'DePIN' },
      { to: '/otc', label: 'OTC Desk' },
      { to: '/derivatives', label: 'Derivatives' },
      { to: '/create-token', label: 'Token Creator' },
      { to: '/markets', label: 'Markets' },
      { to: '/margin', label: 'Margin Trading' },
      { to: '/liquidations', label: 'Liquidations' },
      { to: '/automation', label: 'Automation' },
    ],
  },
  {
    title: 'Learn',
    links: [
      { to: '/docs', label: 'Documentation' },
      { to: '/whitepaper', label: 'Whitepaper' },
      { to: '/commit-reveal', label: 'Commit-Reveal' },
      { to: '/gametheory', label: 'Game Theory' },
      { to: '/philosophy', label: 'Philosophy' },
      { to: '/faq', label: 'FAQ' },
      { to: '/research', label: 'Research' },
      { to: '/api', label: 'API Docs' },
    ],
  },
  {
    title: 'Community',
    links: [
      { to: '/forum', label: 'Forum' },
      { to: '/feed', label: 'VibeFeed' },
      { to: '/govern', label: 'Governance' },
      { to: '/leaderboard', label: 'Leaderboard' },
      { to: '/referral', label: 'Referrals' },
      { to: '/bounties', label: 'Bounties' },
      { to: '/badges', label: 'Badges' },
      { to: '/airdrop', label: 'Airdrop' },
      { to: '/social', label: 'Social Trading' },
      { to: '/dao-tools', label: 'DAO Tools' },
      { to: '/grants', label: 'Grants' },
      { to: '/treasury', label: 'Treasury' },
      { to: '/delegate', label: 'Delegate' },
      { to: '/competitions', label: 'Competitions' },
      { to: '/team', label: 'Team' },
    ],
  },
]

export default function Footer() {
  return (
    <footer className="relative mt-16 border-t" style={{ borderColor: `${CYAN}10` }}>
      <div className="max-w-6xl mx-auto px-4 py-12">
        {/* Link columns */}
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-8 mb-10">
          {COLUMNS.map((col) => (
            <div key={col.title}>
              <h4 className="text-[10px] font-mono font-bold uppercase tracking-widest mb-3" style={{ color: CYAN }}>
                {col.title}
              </h4>
              <ul className="space-y-1.5">
                {col.links.map((link) => (
                  <li key={link.to}>
                    <Link
                      to={link.to}
                      className="text-xs font-mono text-black-500 hover:text-white transition-colors duration-200"
                    >
                      {link.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>

        {/* Divider */}
        <div className="h-px mb-6" style={{ background: `linear-gradient(90deg, transparent, ${CYAN}20, transparent)` }} />

        {/* Bottom bar */}
        <div className="flex flex-col sm:flex-row items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <span className="text-sm font-bold font-mono text-white">VIBESWAP</span>
            <span className="text-[10px] font-mono text-black-600">v0.1.0</span>
            <div className="flex items-center gap-1.5">
              <motion.div
                className="w-1.5 h-1.5 rounded-full"
                style={{ background: '#22c55e' }}
                animate={{ opacity: [0.4, 1, 0.4] }}
                transition={{ duration: 2, repeat: Infinity }}
              />
              <span className="text-[9px] font-mono text-black-500">Mainnet</span>
            </div>
          </div>

          <div className="flex items-center gap-4">
            <a href="https://github.com/wglynn/vibeswap" target="_blank" rel="noopener noreferrer"
              className="text-[10px] font-mono text-black-500 hover:text-white transition-colors">GitHub</a>
            <a href="https://t.me/+3uHbNxyZH-tiOGY8" target="_blank" rel="noopener noreferrer"
              className="text-[10px] font-mono text-black-500 hover:text-white transition-colors">Telegram</a>
            <Link to="/about" className="text-[10px] font-mono text-black-500 hover:text-white transition-colors">About</Link>
            <Link to="/changelog" className="text-[10px] font-mono text-black-500 hover:text-white transition-colors">Changelog</Link>
            <Link to="/legal" className="text-[10px] font-mono text-black-500 hover:text-white transition-colors">Legal</Link>
            <Link to="/careers" className="text-[10px] font-mono text-black-500 hover:text-white transition-colors">Careers</Link>
          </div>

          <p className="text-[9px] font-mono text-black-700">
            Built in the cave. Cooperative capitalism.
          </p>
        </div>
      </div>
    </footer>
  )
}
