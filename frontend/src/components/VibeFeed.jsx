import { useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { useWallet } from '../hooks/useWallet'
import { useDeviceWallet } from '../hooks/useDeviceWallet'

// ============ Mock Data ============

const MOCK_POSTS = [
  {
    id: 1,
    username: 'satoshi_vibes',
    displayName: 'Satoshi Vibes',
    avatar: 'SV',
    avatarColor: 'from-orange-500 to-yellow-500',
    content: "Just discovered VibeSwap's zero-MEV auction mechanism. This is what DeFi was supposed to be. \u{1F525}",
    timestamp: '2m',
    likes: 42,
    reposts: 12,
    replies: 7,
    shares: 3,
  },
  {
    id: 2,
    username: 'defi_alice',
    displayName: 'Alice in DeFi Land',
    avatar: 'AL',
    avatarColor: 'from-purple-500 to-pink-500',
    content: 'The Mind Mesh is fully interlinked today. 3/3 nodes green. The trinity holds. \u{1F33F}',
    timestamp: '15m',
    likes: 28,
    reposts: 5,
    replies: 3,
    shares: 1,
  },
  {
    id: 3,
    username: 'whale_hunter',
    displayName: 'Whale Hunter \u{1F40B}',
    avatar: 'WH',
    avatarColor: 'from-blue-500 to-cyan-500',
    content: 'Committed 50 ETH to the next batch auction. Let\'s see that uniform clearing price work its magic.',
    timestamp: '1h',
    likes: 89,
    reposts: 23,
    replies: 14,
    shares: 8,
  },
  {
    id: 4,
    username: 'vibe_maxi',
    displayName: 'VIBE MAXI',
    avatar: 'VM',
    avatarColor: 'from-green-500 to-emerald-500',
    content: "Hot take: VibeSwap's cooperative capitalism model will eat every other DEX within 2 years",
    timestamp: '2h',
    likes: 156,
    reposts: 41,
    replies: 33,
    shares: 19,
  },
  {
    id: 5,
    username: 'nervos_dev',
    displayName: 'CKB Builder',
    avatar: 'CB',
    avatarColor: 'from-emerald-500 to-teal-500',
    content: 'Just deployed a Wardenclyffe knowledge cell on CKB testnet. RISC-V scripts are surprisingly elegant. The Cell model > Account model for composability.',
    timestamp: '3h',
    likes: 67,
    reposts: 18,
    replies: 9,
    shares: 5,
  },
  {
    id: 6,
    username: 'lp_queen',
    displayName: 'LP Queen \u{1F451}',
    avatar: 'LQ',
    avatarColor: 'from-yellow-500 to-orange-500',
    content: 'IL protection on VibeSwap just saved me $2,400 on my ETH/USDC position. The insurance pool actually works. Other DEXs could never.',
    timestamp: '4h',
    likes: 203,
    reposts: 56,
    replies: 22,
    shares: 14,
  },
  {
    id: 7,
    username: 'governance_greg',
    displayName: 'Greg | Governance',
    avatar: 'GG',
    avatarColor: 'from-indigo-500 to-purple-500',
    content: 'Conviction voting proposal #47 just passed with 89% support. Treasury allocating 5% to retroactive public goods funding. This is how DAOs should work.',
    timestamp: '5h',
    likes: 112,
    reposts: 31,
    replies: 18,
    shares: 7,
  },
  {
    id: 8,
    username: 'anon_builder',
    displayName: 'anon',
    avatar: 'AB',
    avatarColor: 'from-gray-500 to-gray-600',
    content: 'gm. shipping code. the commit-reveal mechanism is mathematically beautiful. front-runners in shambles. \u{1F9F1}\u{1F9F1}\u{1F9F1}',
    timestamp: '6h',
    likes: 94,
    reposts: 15,
    replies: 8,
    shares: 4,
  },
  {
    id: 9,
    username: 'cross_chain_carl',
    displayName: 'Carl \u{26D3}\uFE0F LayerZero',
    avatar: 'CC',
    avatarColor: 'from-red-500 to-rose-500',
    content: 'Bridged assets from Ethereum to Base via VibeSwap in 12 seconds flat. Zero protocol fees. The omnichain future is already here, you just have to look.',
    timestamp: '8h',
    likes: 74,
    reposts: 20,
    replies: 11,
    shares: 6,
  },
  {
    id: 10,
    username: 'shapley_stan',
    displayName: 'Shapley Maximalist',
    avatar: 'SS',
    avatarColor: 'from-teal-500 to-cyan-500',
    content: 'Received my first Shapley distribution today. Game theory-based reward allocation > arbitrary token emissions. Every contributor gets exactly their marginal value. \u{1F4CA}',
    timestamp: '12h',
    likes: 138,
    reposts: 37,
    replies: 26,
    shares: 11,
  },
]

const TRENDING_TOPICS = [
  { tag: 'ZeroMEV', posts: '2.4K' },
  { tag: 'BatchAuctions', posts: '1.8K' },
  { tag: 'CooperativeCapitalism', posts: '1.2K' },
  { tag: 'MindMesh', posts: '987' },
  { tag: 'ShapleyRewards', posts: '743' },
]

const TABS = ['For You', 'Following', 'Trending']

// ============ SVG Icons ============

const HeartIcon = ({ filled }) => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill={filled ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" />
  </svg>
)

const RepostIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="17 1 21 5 17 9" />
    <path d="M3 11V9a4 4 0 0 1 4-4h14" />
    <polyline points="7 23 3 19 7 15" />
    <path d="M21 13v2a4 4 0 0 1-4 4H3" />
  </svg>
)

const ReplyIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
  </svg>
)

const ShareIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8" />
    <polyline points="16 6 12 2 8 6" />
    <line x1="12" y1="2" x2="12" y2="15" />
  </svg>
)

const TrendingIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="23 6 13.5 15.5 8.5 10.5 1 18" />
    <polyline points="17 6 23 6 23 12" />
  </svg>
)

// ============ Sub-Components ============

function ComposeBox({ isConnected, onPost }) {
  const [content, setContent] = useState('')
  const charCount = content.length
  const isOverLimit = charCount > 280
  const isEmpty = content.trim().length === 0

  const handlePost = () => {
    if (!isEmpty && !isOverLimit) {
      onPost(content)
      setContent('')
    }
  }

  if (!isConnected) {
    return (
      <div className="border-b border-black-700/50 p-4">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-full bg-black-700 flex items-center justify-center flex-shrink-0">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-black-500">
              <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
              <circle cx="12" cy="7" r="4" />
            </svg>
          </div>
          <p className="text-black-500 text-sm">Sign in to post to the VibeFeed</p>
        </div>
      </div>
    )
  }

  return (
    <div className="border-b border-black-700/50 p-4">
      <div className="flex gap-3">
        <div className="w-10 h-10 rounded-full bg-gradient-to-br from-matrix-500 to-emerald-500 flex items-center justify-center flex-shrink-0 text-black font-bold text-sm">
          You
        </div>
        <div className="flex-1 min-w-0">
          <textarea
            value={content}
            onChange={(e) => setContent(e.target.value)}
            placeholder="What's vibing?"
            rows={3}
            className="w-full bg-transparent text-white placeholder-black-500 resize-none outline-none text-base leading-relaxed"
          />
          <div className="flex items-center justify-between mt-2 pt-2 border-t border-black-700/30">
            <div className="flex items-center gap-2">
              <span className={`text-xs ${isOverLimit ? 'text-red-500' : charCount > 250 ? 'text-yellow-500' : 'text-black-500'}`}>
                {charCount}/280
              </span>
              {isOverLimit && (
                <span className="text-xs text-red-500">Too long</span>
              )}
            </div>
            <motion.button
              whileHover={{ scale: 1.05 }}
              whileTap={{ scale: 0.95 }}
              onClick={handlePost}
              disabled={isEmpty || isOverLimit}
              className={`px-5 py-1.5 rounded-full text-sm font-semibold transition-all ${
                isEmpty || isOverLimit
                  ? 'bg-matrix-600/30 text-matrix-500/50 cursor-not-allowed'
                  : 'bg-matrix-600 text-black hover:bg-matrix-500 shadow-lg shadow-matrix-600/20'
              }`}
            >
              Post
            </motion.button>
          </div>
        </div>
      </div>
    </div>
  )
}

function PostCard({ post, onLike, onRepost }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      className="border-b border-black-700/50 p-4 hover:bg-black-800/50 transition-colors cursor-pointer"
    >
      <div className="flex gap-3">
        {/* Avatar */}
        <div className={`w-10 h-10 rounded-full bg-gradient-to-br ${post.avatarColor} flex items-center justify-center flex-shrink-0 text-white font-bold text-xs`}>
          {post.avatar}
        </div>

        {/* Content */}
        <div className="flex-1 min-w-0">
          {/* Header */}
          <div className="flex items-center gap-2 mb-0.5">
            <span className="font-semibold text-white text-sm truncate">{post.displayName}</span>
            <span className="text-black-500 text-sm truncate">@{post.username}</span>
            <span className="text-black-500 text-sm flex-shrink-0">&middot;</span>
            <span className="text-black-500 text-sm flex-shrink-0">{post.timestamp}</span>
          </div>

          {/* Post text */}
          <p className="text-white text-sm leading-relaxed mb-3 whitespace-pre-wrap break-words">
            {post.content}
          </p>

          {/* Action bar */}
          <div className="flex items-center justify-between max-w-xs -ml-2">
            {/* Reply */}
            <button className="flex items-center gap-1.5 text-black-500 hover:text-blue-400 transition-colors group p-2 rounded-full hover:bg-blue-400/10">
              <ReplyIcon />
              <span className="text-xs">{post.replies}</span>
            </button>

            {/* Repost */}
            <button
              onClick={() => onRepost(post.id)}
              className={`flex items-center gap-1.5 transition-colors group p-2 rounded-full hover:bg-green-400/10 ${
                post.reposted ? 'text-green-400' : 'text-black-500 hover:text-green-400'
              }`}
            >
              <RepostIcon />
              <span className="text-xs">{post.reposts}</span>
            </button>

            {/* Like */}
            <button
              onClick={() => onLike(post.id)}
              className={`flex items-center gap-1.5 transition-colors group p-2 rounded-full hover:bg-pink-400/10 ${
                post.liked ? 'text-pink-500' : 'text-black-500 hover:text-pink-500'
              }`}
            >
              <HeartIcon filled={post.liked} />
              <span className="text-xs">{post.likes}</span>
            </button>

            {/* Share */}
            <button className="flex items-center gap-1.5 text-black-500 hover:text-matrix-500 transition-colors group p-2 rounded-full hover:bg-matrix-500/10">
              <ShareIcon />
              <span className="text-xs">{post.shares}</span>
            </button>
          </div>
        </div>
      </div>
    </motion.div>
  )
}

function TrendingSidebar() {
  return (
    <div className="max-w-xs w-full hidden lg:block">
      <div
        className="rounded-2xl border border-black-700/50 overflow-hidden sticky top-20"
        style={{ background: 'rgba(15,15,15,0.8)' }}
      >
        <h2 className="font-bold text-white text-lg px-4 pt-4 pb-3">Trending on VSOS</h2>
        {TRENDING_TOPICS.map((topic, i) => (
          <motion.div
            key={topic.tag}
            whileHover={{ backgroundColor: 'rgba(0,255,65,0.04)' }}
            className="px-4 py-3 cursor-pointer transition-colors"
          >
            <div className="flex items-center gap-2 mb-0.5">
              <TrendingIcon />
              <span className="text-black-500 text-xs">Trending in DeFi</span>
            </div>
            <p className="font-semibold text-white text-sm">#{topic.tag}</p>
            <p className="text-black-500 text-xs mt-0.5">{topic.posts} posts</p>
          </motion.div>
        ))}
        <div className="px-4 py-3">
          <button className="text-matrix-500 text-sm hover:underline">Show more</button>
        </div>
      </div>
    </div>
  )
}

// ============ Main Component ============

function VibeFeed() {
  const { isConnected: isExternalConnected } = useWallet()
  const { isConnected: isDeviceConnected } = useDeviceWallet()
  const isConnected = isExternalConnected || isDeviceConnected

  const [activeTab, setActiveTab] = useState('For You')
  const [posts, setPosts] = useState(MOCK_POSTS)

  const handlePost = (content) => {
    const newPost = {
      id: Date.now(),
      username: 'you',
      displayName: 'You',
      avatar: 'YO',
      avatarColor: 'from-matrix-500 to-emerald-500',
      content,
      timestamp: 'now',
      likes: 0,
      reposts: 0,
      replies: 0,
      shares: 0,
    }
    setPosts([newPost, ...posts])
  }

  const handleLike = (postId) => {
    setPosts(posts.map(p => {
      if (p.id !== postId) return p
      return {
        ...p,
        liked: !p.liked,
        likes: p.liked ? p.likes - 1 : p.likes + 1,
      }
    }))
  }

  const handleRepost = (postId) => {
    setPosts(posts.map(p => {
      if (p.id !== postId) return p
      return {
        ...p,
        reposted: !p.reposted,
        reposts: p.reposted ? p.reposts - 1 : p.reposts + 1,
      }
    }))
  }

  return (
    <div className="min-h-screen">
      <div className="max-w-5xl mx-auto flex gap-6 px-4">
        {/* Main Feed Column */}
        <div className="flex-1 max-w-2xl w-full mx-auto lg:mx-0">
          {/* Header */}
          <div
            className="sticky top-0 z-30 backdrop-blur-xl border-b border-black-700/50"
            style={{ background: 'rgba(0,0,0,0.8)' }}
          >
            <h1 className="text-lg font-bold text-white px-4 pt-3 pb-2">VibeFeed</h1>

            {/* Tabs */}
            <div className="flex">
              {TABS.map((tab) => (
                <button
                  key={tab}
                  onClick={() => setActiveTab(tab)}
                  className="flex-1 relative py-3 text-sm font-medium transition-colors hover:bg-black-800/50"
                >
                  <span className={activeTab === tab ? 'text-white' : 'text-black-500'}>
                    {tab}
                  </span>
                  {activeTab === tab && (
                    <motion.div
                      layoutId="feedTab"
                      className="absolute bottom-0 left-1/2 -translate-x-1/2 w-12 h-1 rounded-full bg-matrix-500"
                    />
                  )}
                </button>
              ))}
            </div>
          </div>

          {/* Compose Box */}
          <ComposeBox isConnected={isConnected} onPost={handlePost} />

          {/* Feed */}
          <div>
            <AnimatePresence>
              {posts.map((post) => (
                <PostCard
                  key={post.id}
                  post={post}
                  onLike={handleLike}
                  onRepost={handleRepost}
                />
              ))}
            </AnimatePresence>
          </div>
        </div>

        {/* Trending Sidebar */}
        <TrendingSidebar />
      </div>
    </div>
  )
}

export default VibeFeed
