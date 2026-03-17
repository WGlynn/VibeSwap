import { useState, useEffect, useMemo, useRef, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { motion, AnimatePresence } from 'framer-motion'

// ============================================================
// Command Palette — Global search & navigation overlay
// Opens with Ctrl+Shift+K or "/" when not typing
// Searchable list of every page, action, and shortcut
// ============================================================

const PHI = 1.618033988749895

const COMMANDS = [
  // DeFi
  { id: 'swap', label: 'Swap', description: 'Trade tokens with zero MEV', path: '/', category: 'DeFi', shortcut: 'Ctrl+K' },
  { id: 'buy', label: 'Buy / Sell', description: 'Fiat onramp & order book', path: '/buy', category: 'DeFi', shortcut: 'Ctrl+B' },
  { id: 'earn', label: 'Earn (Pools)', description: 'Provide liquidity, earn fees', path: '/earn', category: 'DeFi', shortcut: 'Ctrl+N' },
  { id: 'trade', label: 'Trading', description: 'Advanced trading interface', path: '/trade', category: 'DeFi' },
  { id: 'perps', label: 'Perpetuals', description: 'Leveraged perpetual futures', path: '/perps', category: 'DeFi' },
  { id: 'options', label: 'Options', description: 'On-chain options trading', path: '/options', category: 'DeFi' },
  { id: 'lend', label: 'Lending', description: 'Supply & borrow assets', path: '/lend', category: 'DeFi' },
  { id: 'stake', label: 'Staking', description: 'Stake JUL, earn rewards', path: '/stake', category: 'DeFi' },
  { id: 'vault', label: 'Vaults', description: 'Automated yield strategies', path: '/vault', category: 'DeFi' },
  { id: 'yield', label: 'Yield', description: 'Yield farming opportunities', path: '/yield', category: 'DeFi' },
  { id: 'dca', label: 'DCA', description: 'Dollar cost averaging', path: '/dca', category: 'DeFi' },
  { id: 'insurance', label: 'Insurance', description: 'Protocol insurance pools', path: '/insurance', category: 'DeFi' },
  { id: 'bonds', label: 'Bonds', description: 'Protocol-owned liquidity bonds', path: '/bonds', category: 'DeFi' },
  { id: 'launchpad', label: 'Launchpad', description: 'Fair token launches', path: '/launchpad', category: 'DeFi' },
  { id: 'aggregator', label: 'Aggregator', description: 'Best price routing', path: '/aggregator', category: 'DeFi' },
  { id: 'nft', label: 'NFT Market', description: 'Soulbound badges & auctions', path: '/nft', category: 'DeFi' },

  // Protocol
  { id: 'commit-reveal', label: 'Commit-Reveal', description: 'Batch auction mechanism', path: '/commit-reveal', category: 'Protocol' },
  { id: 'fairness', label: 'Fairness Race', description: 'Fisher-Yates shuffle demo', path: '/fairness', category: 'Protocol' },
  { id: 'gametheory', label: 'Game Theory', description: 'Nash, Shapley, Prisoner\'s Dilemma', path: '/gametheory', category: 'Protocol' },
  { id: 'gameswap', label: 'GameSwap', description: 'Gamified trading experience', path: '/gameswap', category: 'Protocol' },
  { id: 'oracle', label: 'Oracle', description: 'Kalman filter price feeds', path: '/oracle', category: 'Protocol' },
  { id: 'circuit-breaker', label: 'Circuit Breaker', description: 'Emergency safety systems', path: '/circuit-breaker', category: 'Protocol' },
  { id: 'crosschain', label: 'Cross-Chain', description: 'LayerZero omnichain bridge', path: '/crosschain', category: 'Protocol' },
  { id: 'send', label: 'Send / Bridge', description: 'Transfer across chains', path: '/send', category: 'Protocol' },

  // Intelligence
  { id: 'jarvis', label: 'JARVIS', description: 'AI assistant & protocol brain', path: '/jarvis', category: 'Intelligence', shortcut: 'Ctrl+J' },
  { id: 'voice', label: 'Voice Chat', description: 'Talk to JARVIS', path: '/voice', category: 'Intelligence' },
  { id: 'mesh', label: 'Mind Mesh', description: 'Neural network visualization', path: '/mesh', category: 'Intelligence', shortcut: 'Ctrl+M' },
  { id: 'agents', label: 'Agent Hub', description: 'AI agent marketplace', path: '/agents', category: 'Intelligence' },
  { id: 'predict', label: 'Prediction Market', description: 'Bet on outcomes', path: '/predict', category: 'Intelligence' },
  { id: 'memehunter', label: 'Memehunter', description: 'AI-powered meme token scanner', path: '/memehunter', category: 'Intelligence' },

  // Community
  { id: 'feed', label: 'Vibe Feed', description: 'Social trading feed', path: '/feed', category: 'Community' },
  { id: 'forum', label: 'Forum', description: 'Community discussions', path: '/forum', category: 'Community' },
  { id: 'board', label: 'Message Board', description: 'Bulletin board', path: '/board', category: 'Community' },
  { id: 'bounties', label: 'Bounties', description: 'Job market & bounties', path: '/bounties', category: 'Community' },
  { id: 'live', label: 'Live Stream', description: 'Live protocol activity', path: '/live', category: 'Community' },
  { id: 'govern', label: 'Governance', description: 'Vote on proposals', path: '/govern', category: 'Community' },

  // Ecosystem
  { id: 'apps', label: 'App Store', description: 'VSOS applications', path: '/apps', category: 'Ecosystem' },
  { id: 'depin', label: 'DePIN Hub', description: 'Physical infrastructure networks', path: '/depin', category: 'Ecosystem' },
  { id: 'rwa', label: 'RWA Hub', description: 'Real world assets', path: '/rwa', category: 'Ecosystem' },
  { id: 'infofi', label: 'InfoFi', description: 'Information finance', path: '/infofi', category: 'Ecosystem' },

  // Knowledge
  { id: 'wiki', label: 'Wiki', description: 'Knowledge base & docs', path: '/wiki', category: 'Knowledge' },
  { id: 'docs', label: 'Docs', description: 'Developer documentation', path: '/docs', category: 'Knowledge' },
  { id: 'research', label: 'Research', description: 'Academic foundations', path: '/research', category: 'Knowledge', shortcut: 'Ctrl+R' },
  { id: 'whitepaper', label: 'Whitepaper', description: 'Technical whitepaper', path: '/whitepaper', category: 'Knowledge' },
  { id: 'philosophy', label: 'Philosophy', description: 'Protocol philosophy', path: '/philosophy', category: 'Knowledge' },
  { id: 'economics', label: 'Economics', description: 'Cooperative capitalism model', path: '/economics', category: 'Knowledge', shortcut: 'Ctrl+E' },
  { id: 'tokenomics', label: 'Tokenomics', description: 'JUL token economics', path: '/tokenomics', category: 'Knowledge' },

  // Account
  { id: 'portfolio', label: 'Portfolio', description: 'Your holdings & PnL', path: '/portfolio', category: 'Account', shortcut: 'Ctrl+P' },
  { id: 'history', label: 'History', description: 'Transaction history', path: '/history', category: 'Account', shortcut: 'Ctrl+H' },
  { id: 'rewards', label: 'Rewards', description: 'Shapley rewards & claims', path: '/rewards', category: 'Account' },
  { id: 'mine', label: 'Mine', description: 'Proof-of-participation mining', path: '/mine', category: 'Account' },
  { id: 'personality', label: 'Personality', description: 'Your trading personality', path: '/personality', category: 'Account' },
  { id: 'wallet', label: 'Wallet', description: 'Token balances & approvals', path: '/wallet', category: 'Account' },
  { id: 'notifications', label: 'Notifications', description: 'Activity feed & alerts', path: '/notifications', category: 'Account' },
  { id: 'settings', label: 'Settings', description: 'Preferences & config', path: '/settings', category: 'Account' },
  { id: 'profile', label: 'Profile', description: 'Your account & achievements', path: '/profile', category: 'Account' },
  { id: 'leaderboard', label: 'Leaderboard', description: 'Top traders & LPs', path: '/leaderboard', category: 'Account' },
  { id: 'referral', label: 'Referrals', description: 'Invite friends, earn rewards', path: '/referral', category: 'Account' },
  { id: 'tutorial', label: 'Getting Started', description: 'Step-by-step tutorial', path: '/tutorial', category: 'Account' },

  // System
  { id: 'gas', label: 'Gas Tracker', description: 'Live gas prices & estimator', path: '/gas', category: 'System' },
  { id: 'analytics', label: 'Analytics', description: 'Protocol dashboard', path: '/analytics', category: 'System' },
  { id: 'status', label: 'Status', description: 'System health', path: '/status', category: 'System' },
  { id: 'security', label: 'Security', description: 'Security overview', path: '/security', category: 'System' },
  { id: 'roadmap', label: 'Roadmap', description: 'Development roadmap', path: '/roadmap', category: 'System' },
  { id: 'team', label: 'Team', description: 'Core builders', path: '/team', category: 'System' },
  { id: 'faq', label: 'FAQ', description: 'Frequently asked questions', path: '/faq', category: 'System' },
  { id: 'changelog', label: 'Changelog', description: 'Release notes', path: '/changelog', category: 'System' },
  { id: 'about', label: 'About', description: 'About VibeSwap', path: '/about', category: 'System' },
  { id: 'covenants', label: 'Covenants', description: 'The Ten Covenants', path: '/covenants', category: 'System' },
  { id: 'api', label: 'API Docs', description: 'REST, WebSocket, SDK docs', path: '/api', category: 'System' },
  { id: 'contact', label: 'Contact', description: 'Support & feedback', path: '/contact', category: 'System' },
  { id: 'ecosystem', label: 'Ecosystem', description: 'Protocol overview & partners', path: '/ecosystem', category: 'Ecosystem' },
  { id: 'brand', label: 'Brand Assets', description: 'Logo, colors, guidelines', path: '/brand', category: 'System' },
  { id: 'partners', label: 'Partners', description: 'Integration partners', path: '/partners', category: 'System' },
  { id: 'legal', label: 'Legal', description: 'Terms, privacy, disclosures', path: '/legal', category: 'System' },
  { id: 'careers', label: 'Careers', description: 'Join the team', path: '/careers', category: 'System' },

  // Tools
  { id: 'multisend', label: 'Multi-Send', description: 'Batch transfers to multiple recipients', path: '/multisend', category: 'DeFi' },
  { id: 'limit', label: 'Limit Orders', description: 'Price-triggered orders', path: '/limit', category: 'DeFi' },
  { id: 'airdrop', label: 'Airdrop', description: 'Check VIBE allocation & eligibility', path: '/airdrop', category: 'Account' },
  { id: 'badges', label: 'Badges', description: 'Soulbound achievement badges', path: '/badges', category: 'Account' },
  { id: 'alerts', label: 'Price Alerts', description: 'Set price & volume alerts', path: '/alerts', category: 'Account' },
  { id: 'export', label: 'Export Data', description: 'CSV, JSON, PDF exports & tax', path: '/export', category: 'Account' },
  { id: 'watchlist', label: 'Watchlist', description: 'Track favorite tokens & prices', path: '/watchlist', category: 'Account' },
  { id: 'staking-rewards', label: 'Staking Rewards', description: 'Calculator & reward dashboard', path: '/staking-rewards', category: 'DeFi' },
  { id: 'onramp', label: 'On-Ramp', description: 'Buy crypto with fiat currency', path: '/onramp', category: 'DeFi' },
  { id: 'proposals', label: 'Proposals', description: 'Governance proposals & voting', path: '/proposals', category: 'Community' },
  { id: 'farming', label: 'Liquidity Mining', description: 'Farm rewards in liquidity pools', path: '/farming', category: 'DeFi' },
  { id: 'portfolio-analytics', label: 'Portfolio Analytics', description: 'Advanced portfolio metrics & PnL', path: '/portfolio-analytics', category: 'Account' },
  { id: 'bridge-history', label: 'Bridge History', description: 'Cross-chain transfer history', path: '/bridge-history', category: 'Protocol' },
  { id: 'token-vibe', label: 'VIBE Token', description: 'Token details & analytics', path: '/token/VIBE', category: 'DeFi' },
  { id: 'treasury', label: 'Treasury', description: 'DAO treasury dashboard & assets', path: '/treasury', category: 'Community' },
  { id: 'otc', label: 'OTC Desk', description: 'Large block trades & RFQs', path: '/otc', category: 'DeFi' },
  { id: 'fees', label: 'Fee Structure', description: 'Fee tiers, volume discounts', path: '/fees', category: 'Protocol' },
  { id: 'social', label: 'Social Trading', description: 'Copy trade top traders', path: '/social', category: 'Community' },
  { id: 'achievements', label: 'Achievements', description: 'Quests, XP, daily challenges', path: '/achievements', category: 'Account' },
  { id: 'swap-history', label: 'Swap History', description: 'Detailed swap transaction log', path: '/swap-history', category: 'Account' },
  { id: 'grants', label: 'Grants', description: 'Ecosystem grants program', path: '/grants', category: 'Community' },
  { id: 'lp-positions', label: 'LP Positions', description: 'Manage liquidity positions', path: '/lp-positions', category: 'DeFi' },
  { id: 'networks', label: 'Networks', description: 'Chain status & switching', path: '/networks', category: 'Protocol' },
  { id: 'approvals', label: 'Approvals', description: 'Manage token approvals & revoke', path: '/approvals', category: 'System' },
  { id: 'markets', label: 'Markets', description: 'Market overview, heatmap, trending', path: '/markets', category: 'DeFi' },
  { id: 'create-token', label: 'Token Creator', description: 'Launch your own token with fair distribution', path: '/create-token', category: 'DeFi' },
  { id: 'derivatives', label: 'Derivatives', description: 'Structured products and exotic options', path: '/derivatives', category: 'DeFi' },
  { id: 'dao-tools', label: 'DAO Tools', description: 'Multi-sig, treasury, payroll, governance', path: '/dao-tools', category: 'Community' },
  { id: 'margin', label: 'Margin Trading', description: 'Isolated margin with up to 10x leverage', path: '/margin', category: 'DeFi' },
  { id: 'automation', label: 'Automation', description: 'Automated strategies and conditional orders', path: '/automation', category: 'Intelligence' },
  { id: 'revenue', label: 'Revenue Share', description: 'Revenue distribution to stakers and LPs', path: '/revenue', category: 'DeFi' },
  { id: 'vesting', label: 'Token Vesting', description: 'Vesting schedules, cliffs, and unlock timelines', path: '/vesting', category: 'Account' },
  { id: 'liquidations', label: 'Liquidations', description: 'At-risk positions and liquidation auctions', path: '/liquidations', category: 'Protocol' },
  { id: 'delegate', label: 'Delegate', description: 'Delegate voting power to representatives', path: '/delegate', category: 'Community' },
  { id: 'migrate', label: 'Migration', description: 'Upgrade tokens from V1 to V2', path: '/migrate', category: 'System' },
  { id: 'competitions', label: 'Competitions', description: 'Trading tournaments with prizes', path: '/competitions', category: 'Community' },
  { id: 'streaks', label: 'Streaks', description: 'Daily activity streaks and rewards', path: '/streaks', category: 'Account' },
  { id: 'health', label: 'Protocol Health', description: 'Safety systems and risk metrics', path: '/health', category: 'Protocol' },
  { id: 'fee-calculator', label: 'Fee Calculator', description: 'Estimate costs before you execute', path: '/fee-calculator', category: 'Protocol' },
  { id: 'mev', label: 'MEV Dashboard', description: 'MEV protection savings and attack prevention', path: '/mev', category: 'Protocol' },
  { id: 'contributors', label: 'Contributors', description: 'Shapley value contributor leaderboard', path: '/contributors', category: 'Community' },
  { id: 'multichain', label: 'Multi-Chain', description: 'Unified portfolio across all chains', path: '/multichain', category: 'Account' },
  { id: 'education', label: 'Education', description: 'Learn-to-earn DeFi courses', path: '/education', category: 'Knowledge' },
  { id: 'price-impact', label: 'Price Impact', description: 'Simulate trade price impact', path: '/price-impact', category: 'DeFi' },
  { id: 'backtest', label: 'Backtester', description: 'Backtest trading strategies', path: '/backtest', category: 'Intelligence' },
  { id: 'snapshot', label: 'Snapshots', description: 'Off-chain governance voting', path: '/snapshot', category: 'Community' },
  { id: 'tax', label: 'Tax Reports', description: 'Generate crypto tax reports', path: '/tax', category: 'Account' },
  { id: 'referral-dashboard', label: 'Referral Dashboard', description: 'Detailed referral analytics', path: '/referral-dashboard', category: 'Account' },
  { id: 'screener', label: 'DEX Screener', description: 'Token analytics and screening', path: '/screener', category: 'DeFi' },
  { id: 'offramp', label: 'Off-Ramp', description: 'Sell crypto to fiat', path: '/offramp', category: 'DeFi' },
  { id: 'whales', label: 'Whale Watcher', description: 'Track large wallet movements', path: '/whales', category: 'Intelligence' },
  { id: 'rebalance', label: 'Rebalancer', description: 'Auto-rebalance portfolio allocations', path: '/rebalance', category: 'DeFi' },
  { id: 'lp-optimizer', label: 'LP Optimizer', description: 'Maximize liquidity provision returns', path: '/lp-optimizer', category: 'DeFi' },
  { id: 'claims', label: 'Airdrop Claims', description: 'Claim all pending airdrop rewards', path: '/claims', category: 'Account' },
  { id: 'sentiment', label: 'Market Sentiment', description: 'Fear & greed index, social signals', path: '/sentiment', category: 'Intelligence' },
  { id: 'priority', label: 'Priority Auction', description: 'Bid for batch execution priority', path: '/priority', category: 'Protocol' },
  { id: 'compare', label: 'Protocol Comparison', description: 'Compare VibeSwap vs other DEXs', path: '/compare', category: 'Knowledge' },
  { id: 'arbitrage', label: 'Arbitrage Scanner', description: 'Cross-chain arbitrage opportunities', path: '/arbitrage', category: 'Intelligence' },
  { id: 'contracts', label: 'Smart Contracts', description: 'Contract explorer & interaction', path: '/contracts', category: 'Protocol' },
  { id: 'unlocks', label: 'Token Unlocks', description: 'Vesting schedules & unlock calendar', path: '/unlocks', category: 'DeFi' },
  { id: 'names', label: '.vibe Names', description: 'Harberger tax naming system — own your identity', path: '/names', category: 'DeFi' },
  { id: 'jul', label: 'JUL Token', description: 'JUL token info, staking & utility', path: '/jul', category: 'DeFi' },
  { id: 'trust', label: 'Trust Timeline', description: 'Protocol trust history', path: '/trust', category: 'Knowledge' },
  { id: 'agentic', label: 'Agentic Economy', description: 'AI-native economic systems', path: '/agentic', category: 'Intelligence' },
  { id: 'inversion', label: 'Graceful Inversion', description: 'Positive-sum liquidity absorption', path: '/inversion', category: 'Knowledge' },
  { id: 'rosetta', label: 'Rosetta Protocol', description: 'Universal agent translation', path: '/rosetta', category: 'Protocol' },
  { id: 'prompts', label: 'Prompt Feed', description: 'Community prompts & responses', path: '/prompts', category: 'Community' },
  { id: 'abstraction', label: 'Abstraction Ladder', description: 'Protocol complexity layers', path: '/abstraction', category: 'Knowledge' },
  { id: 'wheel', label: 'Medicine Wheel', description: 'Balanced protocol design', path: '/wheel', category: 'Knowledge' },
  { id: 'privacy', label: 'Privacy', description: 'Privacy policy', path: '/privacy', category: 'System' },
  { id: 'proposal', label: 'Proposal Detail', description: 'View a specific governance proposal', path: '/proposal', category: 'Community' },
]

const CATEGORY_COLORS = {
  DeFi: 'text-emerald-400',
  Protocol: 'text-cyan-400',
  Intelligence: 'text-blue-400',
  Community: 'text-purple-400',
  Ecosystem: 'text-amber-400',
  Knowledge: 'text-yellow-400',
  Account: 'text-orange-400',
  System: 'text-black-400',
}

export default function CommandPalette() {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [selectedIndex, setSelectedIndex] = useState(0)
  const inputRef = useRef(null)
  const listRef = useRef(null)
  const navigate = useNavigate()

  const filtered = useMemo(() => {
    if (!query.trim()) return COMMANDS
    const q = query.toLowerCase()
    return COMMANDS.filter(
      (cmd) =>
        cmd.label.toLowerCase().includes(q) ||
        cmd.description.toLowerCase().includes(q) ||
        cmd.category.toLowerCase().includes(q) ||
        cmd.path.toLowerCase().includes(q)
    )
  }, [query])

  const grouped = useMemo(() => {
    const groups = {}
    filtered.forEach((cmd) => {
      if (!groups[cmd.category]) groups[cmd.category] = []
      groups[cmd.category].push(cmd)
    })
    return groups
  }, [filtered])

  // Flatten for keyboard navigation
  const flatList = useMemo(() => {
    const result = []
    Object.values(grouped).forEach((cmds) => result.push(...cmds))
    return result
  }, [grouped])

  const execute = useCallback((cmd) => {
    setOpen(false)
    setQuery('')
    navigate(cmd.path)
  }, [navigate])

  // Keyboard handler
  useEffect(() => {
    function handleKeyDown(e) {
      // Open: Ctrl+Shift+K or "/" when not in input
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        setOpen((prev) => !prev)
        return
      }

      if (!open) return

      if (e.key === 'Escape') {
        e.preventDefault()
        setOpen(false)
        setQuery('')
      } else if (e.key === 'ArrowDown') {
        e.preventDefault()
        setSelectedIndex((prev) => Math.min(prev + 1, flatList.length - 1))
      } else if (e.key === 'ArrowUp') {
        e.preventDefault()
        setSelectedIndex((prev) => Math.max(prev - 1, 0))
      } else if (e.key === 'Enter' && flatList[selectedIndex]) {
        e.preventDefault()
        execute(flatList[selectedIndex])
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [open, flatList, selectedIndex, execute])

  // Reset selection on query change
  useEffect(() => {
    setSelectedIndex(0)
  }, [query])

  // Focus input on open
  useEffect(() => {
    if (open) {
      setTimeout(() => inputRef.current?.focus(), 50)
    }
  }, [open])

  // Scroll selected into view
  useEffect(() => {
    if (!listRef.current) return
    const selected = listRef.current.querySelector('[data-selected="true"]')
    if (selected) selected.scrollIntoView({ block: 'nearest' })
  }, [selectedIndex])

  let flatIndex = -1

  return (
    <AnimatePresence>
      {open && (
        <>
          {/* Backdrop */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.15 }}
            className="fixed inset-0 z-[200] bg-black/60 backdrop-blur-sm"
            onClick={() => { setOpen(false); setQuery('') }}
          />

          {/* Palette */}
          <motion.div
            initial={{ opacity: 0, y: -20, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -10, scale: 0.98 }}
            transition={{ duration: 1 / (PHI * PHI * PHI), ease: [0.25, 0.1, 1 / PHI, 1] }}
            className="fixed top-[15vh] left-1/2 -translate-x-1/2 z-[201] w-full max-w-lg"
          >
            <div
              className="rounded-2xl border border-black-600 overflow-hidden"
              style={{
                background: 'rgba(8,8,12,0.95)',
                boxShadow: '0 0 60px rgba(0,0,0,0.5), 0 0 30px rgba(6,182,212,0.08)',
              }}
            >
              {/* Search input */}
              <div className="flex items-center gap-3 px-4 py-3 border-b border-black-700">
                <svg className="w-4 h-4 text-black-400 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                </svg>
                <input
                  ref={inputRef}
                  type="text"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Search pages, actions, shortcuts..."
                  className="flex-1 bg-transparent text-sm text-white placeholder:text-black-500 focus:outline-none font-mono"
                />
                <kbd className="hidden sm:inline-flex px-1.5 py-0.5 rounded text-[10px] font-mono text-black-500 bg-black-800 border border-black-600">
                  ESC
                </kbd>
              </div>

              {/* Results */}
              <div ref={listRef} className="max-h-[50vh] overflow-y-auto py-2">
                {flatList.length === 0 ? (
                  <div className="px-4 py-8 text-center">
                    <p className="text-sm text-black-500 font-mono">No results for "{query}"</p>
                  </div>
                ) : (
                  Object.entries(grouped).map(([category, cmds]) => (
                    <div key={category}>
                      <div className="px-4 py-1.5">
                        <span className={`text-[10px] font-mono font-bold uppercase tracking-widest ${CATEGORY_COLORS[category] || 'text-black-400'}`}>
                          {category}
                        </span>
                      </div>
                      {cmds.map((cmd) => {
                        flatIndex++
                        const idx = flatIndex
                        const isSelected = idx === selectedIndex
                        return (
                          <button
                            key={cmd.id}
                            data-selected={isSelected}
                            onClick={() => execute(cmd)}
                            onMouseEnter={() => setSelectedIndex(idx)}
                            className={`w-full flex items-center justify-between px-4 py-2 text-left transition-colors ${
                              isSelected
                                ? 'bg-black-700/60 text-white'
                                : 'text-black-300 hover:bg-black-800/60'
                            }`}
                          >
                            <div className="flex items-center gap-3 min-w-0">
                              <span className="text-sm font-medium truncate">{cmd.label}</span>
                              <span className="text-xs text-black-500 truncate hidden sm:inline">{cmd.description}</span>
                            </div>
                            {cmd.shortcut && (
                              <kbd className="shrink-0 ml-2 px-1.5 py-0.5 rounded text-[10px] font-mono text-black-500 bg-black-800 border border-black-700">
                                {cmd.shortcut}
                              </kbd>
                            )}
                          </button>
                        )
                      })}
                    </div>
                  ))
                )}
              </div>

              {/* Footer */}
              <div className="flex items-center justify-between px-4 py-2 border-t border-black-700 text-[10px] font-mono text-black-500">
                <div className="flex items-center gap-3">
                  <span><kbd className="px-1 py-0.5 rounded bg-black-800 border border-black-700">↑↓</kbd> navigate</span>
                  <span><kbd className="px-1 py-0.5 rounded bg-black-800 border border-black-700">↵</kbd> open</span>
                  <span><kbd className="px-1 py-0.5 rounded bg-black-800 border border-black-700">esc</kbd> close</span>
                </div>
                <span>{flatList.length} results</span>
              </div>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  )
}
