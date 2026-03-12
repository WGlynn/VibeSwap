import { useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import GlassCard from './ui/GlassCard'
import PageHero from './ui/PageHero'
import Sparkline, { generateSparklineData } from './ui/Sparkline'

// ============ Constants ============

const PHI = 1.618033988749895
const PHI_TIMING = {
  fast: 1 / (PHI * PHI * PHI),
  medium: 1 / (PHI * PHI),
  slow: 1 / PHI,
}
const PHI_EASE = [0.25, 0.1, 1 / PHI, 1]
const CHAR_LIMIT = 280
const POSTS_PER_PAGE = 5

const TABS = ['All', 'Trades', 'Governance', 'Alpha', 'Memes']

const TAB_ICONS = {
  All: (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="3" width="7" height="7" /><rect x="14" y="3" width="7" height="7" />
      <rect x="14" y="14" width="7" height="7" /><rect x="3" y="14" width="7" height="7" />
    </svg>
  ),
  Trades: (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="23 6 13.5 15.5 8.5 10.5 1 18" /><polyline points="17 6 23 6 23 12" />
    </svg>
  ),
  Governance: (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 2L2 7l10 5 10-5-10-5z" /><path d="M2 17l10 5 10-5" /><path d="M2 12l10 5 10-5" />
    </svg>
  ),
  Alpha: (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10" /><line x1="12" y1="8" x2="12" y2="12" /><line x1="12" y1="16" x2="12.01" y2="16" />
    </svg>
  ),
  Memes: (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10" /><path d="M8 14s1.5 2 4 2 4-2 4-2" /><line x1="9" y1="9" x2="9.01" y2="9" /><line x1="15" y1="9" x2="15.01" y2="9" />
    </svg>
  ),
}

// ============ Seeded PRNG ============

function seededRandom(seed) {
  let s = seed
  return () => {
    s = (s * 16807 + 0) % 2147483647
    return (s - 1) / 2147483646
  }
}

function seededChoice(rng, arr) {
  return arr[Math.floor(rng() * arr.length)]
}

function seededInt(rng, min, max) {
  return Math.floor(rng() * (max - min + 1)) + min
}

// ============ Mock Data Generation ============

const AVATAR_GRADIENTS = [
  'from-orange-500 to-yellow-500',
  'from-purple-500 to-pink-500',
  'from-blue-500 to-cyan-500',
  'from-green-500 to-emerald-500',
  'from-emerald-500 to-teal-500',
  'from-yellow-500 to-orange-500',
  'from-indigo-500 to-purple-500',
  'from-red-500 to-rose-500',
  'from-teal-500 to-cyan-500',
  'from-pink-500 to-fuchsia-500',
]

const TIME_AGO = ['2m', '8m', '23m', '1h', '2h', '3h', '5h', '7h', '11h', '1d']

function generateMockPosts() {
  const rng = seededRandom(420691337)

  const posts = [
    // Post 1: Trade share with sparkline
    {
      id: 1,
      username: 'whale_hunter',
      displayName: 'Whale Hunter',
      avatar: 'WH',
      avatarGradient: AVATAR_GRADIENTS[2],
      content: 'Just executed a massive batch swap on #VibeSwap. Zero MEV extraction, uniform clearing price. $ETH to $USDC in one clean batch. Front-runners are absolutely cooked.',
      timestamp: TIME_AGO[0],
      likes: seededInt(rng, 80, 200),
      reposts: seededInt(rng, 15, 50),
      comments: seededInt(rng, 8, 30),
      category: 'Trades',
      trade: {
        from: '1.00 ETH',
        to: '2,412.80 USDC',
        sparkSeed: 77201,
      },
    },
    // Post 2: Governance vote
    {
      id: 2,
      username: 'governance_greg',
      displayName: 'Greg | Governance',
      avatar: 'GG',
      avatarGradient: AVATAR_GRADIENTS[6],
      content: 'Conviction voting on VIP-42 just closed. The community has spoken unanimously. This is how DAOs should work -- no backroom deals, no whale domination. #CooperativeCapitalism',
      timestamp: TIME_AGO[1],
      likes: seededInt(rng, 100, 250),
      reposts: seededInt(rng, 25, 60),
      comments: seededInt(rng, 15, 40),
      category: 'Governance',
      vote: {
        proposal: 'VIP-42: Reduce slash rate to 30%',
        choice: 'YES',
        support: 89,
      },
    },
    // Post 3: Alpha call
    {
      id: 3,
      username: 'alpha_leaks',
      displayName: 'Alpha Leaks',
      avatar: 'AL',
      avatarGradient: AVATAR_GRADIENTS[1],
      content: '$VIBE tokenomics are severely underpriced relative to TVL growth. Shapley distributions are compounding for early LPs. This is the most asymmetric play in DeFi right now. NFA. #Alpha',
      timestamp: TIME_AGO[2],
      likes: seededInt(rng, 150, 350),
      reposts: seededInt(rng, 40, 90),
      comments: seededInt(rng, 20, 55),
      category: 'Alpha',
    },
    // Post 4: Meme / general
    {
      id: 4,
      username: 'vibe_maxi',
      displayName: 'VIBE MAXI',
      avatar: 'VM',
      avatarGradient: AVATAR_GRADIENTS[3],
      content: 'other DEXs: "we have incentives"\nVibeSwap: "we have game theory"\n\nShapley values > arbitrary emissions. Every single time. #Memes',
      timestamp: TIME_AGO[3],
      likes: seededInt(rng, 200, 500),
      reposts: seededInt(rng, 50, 120),
      comments: seededInt(rng, 30, 70),
      category: 'Memes',
    },
    // Post 5: Trade share with sparkline
    {
      id: 5,
      username: 'lp_queen',
      displayName: 'LP Queen',
      avatar: 'LQ',
      avatarGradient: AVATAR_GRADIENTS[5],
      content: 'IL protection on #VibeSwap just saved me $2,400 on my $ETH / $USDC position. The insurance pool is working exactly as the whitepaper described. Other DEXs could never.',
      timestamp: TIME_AGO[4],
      likes: seededInt(rng, 180, 300),
      reposts: seededInt(rng, 40, 80),
      comments: seededInt(rng, 18, 45),
      category: 'Trades',
      trade: {
        from: '15.0 ETH',
        to: '36,192.00 USDC',
        sparkSeed: 88302,
      },
    },
    // Post 6: General discussion
    {
      id: 6,
      username: 'satoshi_vibes',
      displayName: 'Satoshi Vibes',
      avatar: 'SV',
      avatarGradient: AVATAR_GRADIENTS[0],
      content: 'The commit-reveal mechanism is mathematically beautiful. 8 seconds to commit, 2 seconds to reveal, Fisher-Yates shuffle for ordering. No one can front-run what they cannot see. #ZeroMEV #BatchAuctions',
      timestamp: TIME_AGO[5],
      likes: seededInt(rng, 90, 180),
      reposts: seededInt(rng, 20, 50),
      comments: seededInt(rng, 10, 30),
      category: 'Alpha',
    },
    // Post 7: Governance
    {
      id: 7,
      username: 'dao_delegate',
      displayName: 'Delegate #7',
      avatar: 'D7',
      avatarGradient: AVATAR_GRADIENTS[8],
      content: 'Treasury allocation proposal is live. 5% to retroactive public goods, 3% to security audits, 2% to community grants. This is #CooperativeCapitalism in action.',
      timestamp: TIME_AGO[6],
      likes: seededInt(rng, 60, 140),
      reposts: seededInt(rng, 15, 40),
      comments: seededInt(rng, 8, 25),
      category: 'Governance',
      vote: {
        proposal: 'VIP-51: Q2 Treasury Allocation',
        choice: 'YES',
        support: 94,
      },
    },
    // Post 8: Meme
    {
      id: 8,
      username: 'anon_builder',
      displayName: 'anon',
      avatar: 'AB',
      avatarGradient: AVATAR_GRADIENTS[7],
      content: 'gm. shipping code. batch auctions go brrrr.\n\nMEV bots: "pls sir, just one sandwich"\nVibeSwap: "no" #Memes',
      timestamp: TIME_AGO[7],
      likes: seededInt(rng, 250, 500),
      reposts: seededInt(rng, 60, 130),
      comments: seededInt(rng, 25, 60),
      category: 'Memes',
    },
    // Post 9: Cross-chain trade
    {
      id: 9,
      username: 'cross_chain_carl',
      displayName: 'Carl | LayerZero',
      avatar: 'CC',
      avatarGradient: AVATAR_GRADIENTS[4],
      content: 'Bridged from Ethereum to Base via #VibeSwap in 12 seconds. Zero protocol fees. The omnichain future is already here. $ETH $USDC #ZeroMEV',
      timestamp: TIME_AGO[8],
      likes: seededInt(rng, 70, 160),
      reposts: seededInt(rng, 18, 45),
      comments: seededInt(rng, 9, 28),
      category: 'Trades',
      trade: {
        from: '5.00 ETH',
        to: '12,064.00 USDC',
        sparkSeed: 99403,
      },
    },
    // Post 10: Shapley alpha
    {
      id: 10,
      username: 'shapley_stan',
      displayName: 'Shapley Maximalist',
      avatar: 'SS',
      avatarGradient: AVATAR_GRADIENTS[9],
      content: 'First $VIBE Shapley distribution just hit. Game-theoretic reward allocation means every contributor receives exactly their marginal value. No more arbitrary emissions. The math does not lie. #ShapleyRewards #Alpha',
      timestamp: TIME_AGO[9],
      likes: seededInt(rng, 120, 280),
      reposts: seededInt(rng, 30, 70),
      comments: seededInt(rng, 15, 40),
      category: 'Alpha',
    },
  ]

  return posts
}

const MOCK_POSTS = generateMockPosts()

const TRENDING_TOPICS = [
  { tag: 'ZeroMEV', count: '2.4K posts' },
  { tag: 'BatchAuctions', count: '1.8K posts' },
  { tag: 'CooperativeCapitalism', count: '1.2K posts' },
  { tag: 'ShapleyRewards', count: '987 posts' },
  { tag: 'VibeSwap', count: '743 posts' },
]

const TOP_CONTRIBUTORS = [
  { name: 'Whale Hunter', handle: '@whale_hunter', gradient: AVATAR_GRADIENTS[2], initials: 'WH', posts: 142 },
  { name: 'LP Queen', handle: '@lp_queen', gradient: AVATAR_GRADIENTS[5], initials: 'LQ', posts: 98 },
  { name: 'Greg | Governance', handle: '@governance_greg', gradient: AVATAR_GRADIENTS[6], initials: 'GG', posts: 87 },
]

// ============ SVG Icons ============

const HeartIcon = ({ filled }) => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill={filled ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" />
  </svg>
)

const RepostIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="17 1 21 5 17 9" /><path d="M3 11V9a4 4 0 0 1 4-4h14" />
    <polyline points="7 23 3 19 7 15" /><path d="M21 13v2a4 4 0 0 1-4 4H3" />
  </svg>
)

const CommentIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
  </svg>
)

const BookmarkIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z" />
  </svg>
)

const ImageIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <rect x="3" y="3" width="18" height="18" rx="2" ry="2" /><circle cx="8.5" cy="8.5" r="1.5" />
    <polyline points="21 15 16 10 5 21" />
  </svg>
)

const ChartIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <line x1="18" y1="20" x2="18" y2="10" /><line x1="12" y1="20" x2="12" y2="4" />
    <line x1="6" y1="20" x2="6" y2="14" />
  </svg>
)

const TokenIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="12" r="10" /><line x1="12" y1="6" x2="12" y2="18" />
    <path d="M8 10h8" /><path d="M8 14h8" />
  </svg>
)

const FireIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" stroke="none">
    <path d="M12 23c-3.866 0-7-2.686-7-6 0-1.946.775-3.705 2.029-4.971C7.862 11.196 9 9.799 9 8c0-.349-.044-.69-.128-1.02C10.39 8.314 12 10.357 12 12c1-1 2-3.5 1.5-6 2.086 1.028 3.5 3.5 3.5 6 0 .828-.168 1.618-.472 2.339C17.456 15.76 19 14.047 19 12c0-.69-.115-1.354-.328-1.974C19.8 11.627 21 13.672 21 16c0 3.866-4.134 7-9 7z"/>
  </svg>
)

// ============ Content Renderer (Hashtags & Token Mentions) ============

function renderContent(text) {
  const parts = text.split(/(#\w+|\$\w+)/g)
  return parts.map((part, i) => {
    if (part.startsWith('#')) {
      return (
        <span key={i} className="text-purple-400 hover:text-purple-300 cursor-pointer transition-colors">
          {part}
        </span>
      )
    }
    if (part.startsWith('$')) {
      return (
        <span key={i} className="text-cyan-400 hover:text-cyan-300 cursor-pointer font-medium transition-colors">
          {part}
        </span>
      )
    }
    return part
  })
}

// ============ Compose Box ============

function ComposeBox({ onPost }) {
  const [content, setContent] = useState('')
  const [showAttachments, setShowAttachments] = useState(false)
  const charCount = content.length
  const isOverLimit = charCount > CHAR_LIMIT
  const isEmpty = content.trim().length === 0

  const handlePost = () => {
    if (!isEmpty && !isOverLimit) {
      onPost(content)
      setContent('')
    }
  }

  const charRatio = charCount / CHAR_LIMIT
  const ringColor = isOverLimit
    ? 'text-red-500'
    : charRatio > 0.9
      ? 'text-yellow-500'
      : 'text-black-500'

  return (
    <GlassCard glowColor="none" hover={false} className="mb-4">
      <div className="p-4">
        <div className="flex gap-3">
          {/* User avatar */}
          <div className="w-10 h-10 rounded-full bg-gradient-to-br from-purple-500 to-violet-500 flex items-center justify-center flex-shrink-0 text-white font-bold text-xs shadow-lg shadow-purple-500/20">
            You
          </div>

          <div className="flex-1 min-w-0">
            <textarea
              value={content}
              onChange={(e) => setContent(e.target.value)}
              placeholder="What's vibing?"
              rows={3}
              className="w-full bg-transparent text-white placeholder-black-500 resize-none outline-none text-sm leading-relaxed"
            />

            {/* Attachment bar */}
            <div className="flex items-center justify-between mt-2 pt-3 border-t border-white/5">
              <div className="flex items-center gap-1">
                <button
                  onClick={() => setShowAttachments(!showAttachments)}
                  className="p-2 rounded-lg text-black-500 hover:text-purple-400 hover:bg-purple-400/10 transition-colors"
                  title="Attach image"
                >
                  <ImageIcon />
                </button>
                <button className="p-2 rounded-lg text-black-500 hover:text-cyan-400 hover:bg-cyan-400/10 transition-colors" title="Attach chart">
                  <ChartIcon />
                </button>
                <button className="p-2 rounded-lg text-black-500 hover:text-green-400 hover:bg-green-400/10 transition-colors" title="Mention token">
                  <TokenIcon />
                </button>

                {/* Character count ring */}
                <div className="ml-2 flex items-center gap-1.5">
                  <svg width="20" height="20" viewBox="0 0 20 20" className={ringColor}>
                    <circle cx="10" cy="10" r="8" fill="none" stroke="currentColor" strokeWidth="2" opacity="0.2" />
                    <circle
                      cx="10" cy="10" r="8" fill="none" stroke="currentColor" strokeWidth="2"
                      strokeDasharray={`${Math.min(charRatio, 1) * 50.27} 50.27`}
                      strokeLinecap="round"
                      transform="rotate(-90 10 10)"
                    />
                  </svg>
                  {charCount > 0 && (
                    <span className={`text-xs font-mono ${ringColor}`}>
                      {CHAR_LIMIT - charCount}
                    </span>
                  )}
                </div>
              </div>

              <motion.button
                whileHover={{ scale: 1.05 }}
                whileTap={{ scale: 0.95 }}
                onClick={handlePost}
                disabled={isEmpty || isOverLimit}
                className={`px-5 py-1.5 rounded-full text-sm font-semibold transition-all ${
                  isEmpty || isOverLimit
                    ? 'bg-purple-600/20 text-purple-500/40 cursor-not-allowed'
                    : 'bg-gradient-to-r from-purple-600 to-violet-600 text-white hover:from-purple-500 hover:to-violet-500 shadow-lg shadow-purple-600/20'
                }`}
              >
                Post
              </motion.button>
            </div>
          </div>
        </div>
      </div>
    </GlassCard>
  )
}

// ============ Embedded Trade Card ============

function TradeEmbed({ trade }) {
  const sparkData = generateSparklineData(trade.sparkSeed, 24, 0.04)

  return (
    <div className="mt-3 rounded-xl border border-white/5 bg-white/[0.02] p-3 hover:border-white/10 transition-colors">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="w-6 h-6 rounded-full bg-gradient-to-br from-green-500 to-emerald-500 flex items-center justify-center">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="7 13 12 18 17 13" /><polyline points="7 6 12 11 17 6" />
            </svg>
          </div>
          <div>
            <p className="text-xs text-black-400">Swapped on VibeSwap</p>
            <p className="text-sm font-medium text-white">
              {trade.from} <span className="text-black-500 mx-1">-&gt;</span> {trade.to}
            </p>
          </div>
        </div>
        <Sparkline data={sparkData} width={64} height={24} fill={true} strokeWidth={1.5} />
      </div>
    </div>
  )
}

// ============ Embedded Governance Vote ============

function VoteEmbed({ vote }) {
  return (
    <div className="mt-3 rounded-xl border border-white/5 bg-white/[0.02] p-3 hover:border-white/10 transition-colors">
      <div className="flex items-center gap-2 mb-2">
        <div className={`px-2 py-0.5 rounded text-xs font-bold ${
          vote.choice === 'YES' ? 'bg-green-500/20 text-green-400' : 'bg-red-500/20 text-red-400'
        }`}>
          {vote.choice}
        </div>
        <span className="text-xs text-black-400">Voted on</span>
      </div>
      <p className="text-sm font-medium text-white mb-2">{vote.proposal}</p>
      <div className="w-full h-1.5 rounded-full bg-white/5 overflow-hidden">
        <motion.div
          initial={{ width: 0 }}
          animate={{ width: `${vote.support}%` }}
          transition={{ duration: PHI_TIMING.slow, ease: PHI_EASE, delay: 0.2 }}
          className="h-full rounded-full bg-gradient-to-r from-green-500 to-emerald-500"
        />
      </div>
      <p className="text-xs text-black-500 mt-1">{vote.support}% approval</p>
    </div>
  )
}

// ============ Post Card ============

function PostCard({ post, index, onLike, onRepost }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{
        duration: PHI_TIMING.medium,
        ease: PHI_EASE,
        delay: index * (PHI_TIMING.fast * 0.3),
      }}
    >
      <GlassCard glowColor="none" hover={true} spotlight={true} className="mb-3">
        <div className="p-4">
          <div className="flex gap-3">
            {/* Avatar */}
            <div
              className={`w-10 h-10 rounded-full bg-gradient-to-br ${post.avatarGradient} flex items-center justify-center flex-shrink-0 text-white font-bold text-xs shadow-md`}
            >
              {post.avatar}
            </div>

            {/* Content */}
            <div className="flex-1 min-w-0">
              {/* Header row */}
              <div className="flex items-center gap-2 mb-1">
                <span className="font-semibold text-white text-sm truncate">{post.displayName}</span>
                <span className="text-black-500 text-xs truncate">@{post.username}</span>
                <span className="text-black-600 text-xs">&middot;</span>
                <span className="text-black-500 text-xs flex-shrink-0">{post.timestamp}</span>
              </div>

              {/* Post body */}
              <p className="text-sm text-white/90 leading-relaxed whitespace-pre-wrap break-words">
                {renderContent(post.content)}
              </p>

              {/* Embedded trade card */}
              {post.trade && <TradeEmbed trade={post.trade} />}

              {/* Embedded governance vote */}
              {post.vote && <VoteEmbed vote={post.vote} />}

              {/* Engagement bar */}
              <div className="flex items-center gap-1 mt-3 -ml-2">
                {/* Comments */}
                <button className="flex items-center gap-1.5 text-black-500 hover:text-purple-400 transition-colors p-2 rounded-full hover:bg-purple-400/10">
                  <CommentIcon />
                  <span className="text-xs">{post.comments}</span>
                </button>

                {/* Repost */}
                <button
                  onClick={() => onRepost(post.id)}
                  className={`flex items-center gap-1.5 transition-colors p-2 rounded-full hover:bg-green-400/10 ${
                    post.reposted ? 'text-green-400' : 'text-black-500 hover:text-green-400'
                  }`}
                >
                  <RepostIcon />
                  <span className="text-xs">{post.reposts + (post.reposted ? 1 : 0)}</span>
                </button>

                {/* Like */}
                <button
                  onClick={() => onLike(post.id)}
                  className={`flex items-center gap-1.5 transition-colors p-2 rounded-full hover:bg-pink-400/10 ${
                    post.liked ? 'text-pink-500' : 'text-black-500 hover:text-pink-500'
                  }`}
                >
                  <HeartIcon filled={post.liked} />
                  <span className="text-xs">{post.likes + (post.liked ? 1 : 0)}</span>
                </button>

                {/* Bookmark */}
                <button className="flex items-center gap-1.5 text-black-500 hover:text-cyan-400 transition-colors p-2 rounded-full hover:bg-cyan-400/10 ml-auto">
                  <BookmarkIcon />
                </button>
              </div>
            </div>
          </div>
        </div>
      </GlassCard>
    </motion.div>
  )
}

// ============ Feed Filters ============

function FeedFilters({ activeTab, setActiveTab }) {
  return (
    <div className="flex items-center gap-1 mb-4 overflow-x-auto scrollbar-none pb-1">
      {TABS.map((tab) => (
        <motion.button
          key={tab}
          onClick={() => setActiveTab(tab)}
          whileHover={{ scale: 1.04 }}
          whileTap={{ scale: 0.96 }}
          className={`relative flex items-center gap-1.5 px-4 py-2 rounded-full text-xs font-medium transition-all whitespace-nowrap ${
            activeTab === tab
              ? 'bg-purple-500/20 text-purple-300 border border-purple-500/30'
              : 'text-black-400 hover:text-white hover:bg-white/5 border border-transparent'
          }`}
        >
          {TAB_ICONS[tab]}
          {tab}
          {activeTab === tab && (
            <motion.div
              layoutId="activeFilter"
              className="absolute inset-0 rounded-full border border-purple-500/30 bg-purple-500/10"
              transition={{ type: 'spring', stiffness: 500, damping: 30 }}
              style={{ zIndex: -1 }}
            />
          )}
        </motion.button>
      ))}
    </div>
  )
}

// ============ Trending Sidebar ============

function TrendingSidebar() {
  return (
    <div className="w-80 flex-shrink-0 hidden xl:block">
      <div className="sticky top-24 space-y-4">
        {/* Trending Topics */}
        <GlassCard glowColor="none" hover={false} className="">
          <div className="p-4">
            <h3 className="text-sm font-bold text-white flex items-center gap-2 mb-3">
              <span className="text-orange-400"><FireIcon /></span>
              Trending on VibeSwap
            </h3>
            <div className="space-y-3">
              {TRENDING_TOPICS.map((topic, i) => (
                <motion.div
                  key={topic.tag}
                  initial={{ opacity: 0, x: 8 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{
                    duration: PHI_TIMING.medium,
                    ease: PHI_EASE,
                    delay: i * 0.06,
                  }}
                  className="group cursor-pointer"
                >
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-sm font-medium text-white group-hover:text-purple-400 transition-colors">
                        #{topic.tag}
                      </p>
                      <p className="text-xs text-black-500">{topic.count}</p>
                    </div>
                    <span className="text-xs text-black-600 font-mono">#{i + 1}</span>
                  </div>
                </motion.div>
              ))}
            </div>
          </div>
        </GlassCard>

        {/* Top Contributors */}
        <GlassCard glowColor="none" hover={false} className="">
          <div className="p-4">
            <h3 className="text-sm font-bold text-white mb-3">Top Contributors</h3>
            <div className="space-y-3">
              {TOP_CONTRIBUTORS.map((user, i) => (
                <motion.div
                  key={user.handle}
                  initial={{ opacity: 0, x: 8 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{
                    duration: PHI_TIMING.medium,
                    ease: PHI_EASE,
                    delay: 0.2 + i * 0.06,
                  }}
                  className="flex items-center gap-3 group cursor-pointer"
                >
                  <div className={`w-8 h-8 rounded-full bg-gradient-to-br ${user.gradient} flex items-center justify-center text-white text-xs font-bold flex-shrink-0`}>
                    {user.initials}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-white truncate group-hover:text-purple-400 transition-colors">
                      {user.name}
                    </p>
                    <p className="text-xs text-black-500 truncate">{user.handle}</p>
                  </div>
                  <span className="text-xs text-black-500 font-mono">{user.posts}</span>
                </motion.div>
              ))}
            </div>
          </div>
        </GlassCard>

        {/* Footer links */}
        <div className="px-2 text-xs text-black-600 space-x-2">
          <span className="hover:text-black-400 cursor-pointer transition-colors">Terms</span>
          <span>&middot;</span>
          <span className="hover:text-black-400 cursor-pointer transition-colors">Privacy</span>
          <span>&middot;</span>
          <span className="hover:text-black-400 cursor-pointer transition-colors">Docs</span>
          <span>&middot;</span>
          <span>VibeSwap 2026</span>
        </div>
      </div>
    </div>
  )
}

// ============ Main Component ============

function VibeFeed() {
  const [activeTab, setActiveTab] = useState('All')
  const [posts, setPosts] = useState(MOCK_POSTS)
  const [visibleCount, setVisibleCount] = useState(POSTS_PER_PAGE)

  // Filter posts by category
  const filteredPosts = activeTab === 'All'
    ? posts
    : posts.filter((p) => p.category === activeTab)

  const visiblePosts = filteredPosts.slice(0, visibleCount)
  const hasMore = visibleCount < filteredPosts.length

  const handlePost = (content) => {
    const newPost = {
      id: Date.now(),
      username: 'you',
      displayName: 'You',
      avatar: 'YO',
      avatarGradient: 'from-purple-500 to-violet-500',
      content,
      timestamp: 'now',
      likes: 0,
      reposts: 0,
      comments: 0,
      category: 'All',
    }
    setPosts([newPost, ...posts])
  }

  const handleLike = (postId) => {
    setPosts(
      posts.map((p) =>
        p.id === postId ? { ...p, liked: !p.liked } : p
      )
    )
  }

  const handleRepost = (postId) => {
    setPosts(
      posts.map((p) =>
        p.id === postId ? { ...p, reposted: !p.reposted } : p
      )
    )
  }

  const handleLoadMore = () => {
    setVisibleCount((prev) => prev + POSTS_PER_PAGE)
  }

  return (
    <div className="min-h-screen">
      {/* Page Hero */}
      <PageHero
        category="community"
        title="VibeFeed"
        subtitle="The pulse of the VibeSwap community"
        badge="Live"
        badgeColor="#a855f7"
      />

      {/* Main Layout */}
      <div className="max-w-7xl mx-auto px-4 flex gap-6">
        {/* Feed Column */}
        <div className="flex-1 min-w-0 max-w-2xl mx-auto xl:mx-0">
          {/* Compose Box */}
          <ComposeBox onPost={handlePost} />

          {/* Feed Filters */}
          <FeedFilters activeTab={activeTab} setActiveTab={setActiveTab} />

          {/* Posts */}
          <AnimatePresence mode="popLayout">
            {visiblePosts.map((post, i) => (
              <PostCard
                key={post.id}
                post={post}
                index={i}
                onLike={handleLike}
                onRepost={handleRepost}
              />
            ))}
          </AnimatePresence>

          {/* Empty state */}
          {visiblePosts.length === 0 && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="text-center py-16"
            >
              <p className="text-black-500 text-sm">No posts in this category yet.</p>
              <p className="text-black-600 text-xs mt-1">Be the first to share something.</p>
            </motion.div>
          )}

          {/* Load More */}
          {hasMore && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 0.3 }}
              className="flex justify-center py-6"
            >
              <motion.button
                whileHover={{ scale: 1.04 }}
                whileTap={{ scale: 0.96 }}
                onClick={handleLoadMore}
                className="px-6 py-2.5 rounded-full text-sm font-medium text-purple-400 border border-purple-500/30 hover:bg-purple-500/10 transition-all"
              >
                Load more
              </motion.button>
            </motion.div>
          )}

          {/* End of feed */}
          {!hasMore && visiblePosts.length > 0 && (
            <div className="text-center py-8 border-t border-white/5">
              <p className="text-xs text-black-600">You have reached the end of the feed.</p>
            </div>
          )}
        </div>

        {/* Trending Sidebar (desktop) */}
        <TrendingSidebar />
      </div>
    </div>
  )
}

export default VibeFeed
