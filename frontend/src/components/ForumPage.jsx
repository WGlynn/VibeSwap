import { useState, useMemo } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Link } from 'react-router-dom'
import { useContributions, CONTRIBUTION_TYPES, RESERVED_USERNAMES } from '../contexts/ContributionsContext'
import { useWallet } from '../hooks/useWallet'
import { useDeviceWallet } from '../hooks/useDeviceWallet'
import { useIdentity } from '../hooks/useIdentity'
import SoulboundAvatar from './SoulboundAvatar'
import CreateIdentityModal from './CreateIdentityModal'
import ContributionGraph from './ContributionGraph'

function ForumPage() {
  const { isConnected: isExternalConnected, connect } = useWallet()
  const { isConnected: isDeviceConnected } = useDeviceWallet()

  // Combined wallet state - connected if EITHER wallet type is connected
  const isConnected = isExternalConnected || isDeviceConnected
  const { identity, hasIdentity, isLoading: identityLoading, getLevelTitle, getLevelColor, addContribution: addIdentityContribution } = useIdentity()

  const {
    contributions,
    addContribution,
    upvoteContribution,
    getLeaderboard,
    getAllTags,
    getKnowledgeGraph,
  } = useContributions()

  const [activeTab, setActiveTab] = useState('feed')
  const [filterType, setFilterType] = useState('all')
  const [filterTag, setFilterTag] = useState(null)
  const [showNewPost, setShowNewPost] = useState(false)
  const [showIdentityModal, setShowIdentityModal] = useState(false)
  const [showContribGraph, setShowContribGraph] = useState(false)

  const leaderboard = useMemo(() => getLeaderboard(), [contributions])
  const allTags = useMemo(() => getAllTags(), [contributions])
  const knowledgeGraph = useMemo(() => getKnowledgeGraph(), [contributions])

  const filteredContributions = useMemo(() => {
    return contributions.filter(c => {
      if (filterType !== 'all' && c.type !== filterType) return false
      if (filterTag && !c.tags?.includes(filterTag)) return false
      return true
    })
  }, [contributions, filterType, filterTag])

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      {/* Header with Identity */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="mb-8"
      >
        <div className="flex items-start justify-between">
          <div className="text-center flex-1">
            <h1 className="text-4xl md:text-5xl font-display font-bold text-white mb-3">
              Build <span className="text-matrix-500">Together</span>
            </h1>
            <p className="text-lg text-black-400 max-w-2xl mx-auto">
              Contribute context, ideas, and feedback. Earn rewards when your contributions get implemented.
            </p>
          </div>

          {/* Identity Card */}
          {isConnected && hasIdentity && identity && (
            <button
              onClick={() => setShowContribGraph(true)}
              className="hidden lg:flex surface rounded-lg p-3 items-center space-x-3 hover:border-matrix-500/50 transition-colors"
            >
              <SoulboundAvatar identity={identity} size={48} />
              <div className="text-left">
                <div className="font-semibold">{identity.username}</div>
                <div className="flex items-center space-x-2 text-xs">
                  <span
                    className="px-1.5 py-0.5 rounded"
                    style={{ backgroundColor: getLevelColor(identity.level) + '30', color: getLevelColor(identity.level) }}
                  >
                    Lv.{identity.level}
                  </span>
                  <span className="text-black-400">{identity.xp} XP</span>
                </div>
              </div>
            </button>
          )}

          {/* Create Identity CTA */}
          {isConnected && !hasIdentity && !identityLoading && (
            <button
              onClick={() => setShowIdentityModal(true)}
              className="hidden lg:flex items-center space-x-2 px-4 py-2 rounded-lg bg-matrix-600 hover:bg-matrix-500 text-black-900 font-semibold transition-colors"
            >
              <span>Create Identity</span>
            </button>
          )}
        </div>

        {/* Mobile identity prompt */}
        {isConnected && !hasIdentity && !identityLoading && (
          <div className="lg:hidden mt-4 p-4 rounded-lg bg-matrix-500/10 border border-matrix-500/20">
            <div className="flex items-center justify-between">
              <div>
                <div className="font-medium text-sm">Claim Your Identity</div>
                <div className="text-xs text-black-400">Mint a soulbound NFT to track contributions</div>
              </div>
              <button
                onClick={() => setShowIdentityModal(true)}
                className="px-3 py-1.5 rounded-lg bg-matrix-600 hover:bg-matrix-500 text-black-900 font-semibold text-sm transition-colors"
              >
                Create
              </button>
            </div>
          </div>
        )}
      </motion.div>

      {/* Tabs */}
      <div className="flex items-center justify-center space-x-2 mb-8">
        {[
          { id: 'feed', label: 'Feed', icon: '📝' },
          { id: 'graph', label: 'Knowledge Graph', icon: '🔗' },
          { id: 'leaderboard', label: 'Leaderboard', icon: '🏆' },
        ].map(tab => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
              activeTab === tab.id
                ? 'bg-matrix-500/20 text-matrix-400 border border-matrix-500/30'
                : 'text-black-400 hover:text-white hover:bg-black-800'
            }`}
          >
            <span className="mr-2">{tab.icon}</span>
            {tab.label}
          </button>
        ))}
      </div>

      <AnimatePresence mode="wait">
        {/* Feed Tab */}
        {activeTab === 'feed' && (
          <motion.div
            key="feed"
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            className="grid lg:grid-cols-4 gap-6"
          >
            {/* Sidebar */}
            <div className="lg:col-span-1 space-y-4">
              {/* New Post Button */}
              <button
                onClick={() => setShowNewPost(true)}
                className="w-full px-4 py-3 rounded-lg bg-matrix-600 hover:bg-matrix-500 text-black-900 font-semibold transition-colors"
              >
                + New Contribution
              </button>

              {/* Filter by Type */}
              <div className="p-4 rounded-lg bg-black-800 border border-black-600">
                <h3 className="text-sm font-semibold text-black-400 mb-3">Filter by Type</h3>
                <div className="space-y-2">
                  <button
                    onClick={() => setFilterType('all')}
                    className={`w-full text-left px-3 py-2 rounded text-sm transition-colors ${
                      filterType === 'all' ? 'bg-black-700 text-white' : 'text-black-400 hover:text-white'
                    }`}
                  >
                    All
                  </button>
                  {Object.entries(CONTRIBUTION_TYPES).map(([key, type]) => (
                    <button
                      key={key}
                      onClick={() => setFilterType(key)}
                      className={`w-full text-left px-3 py-2 rounded text-sm transition-colors flex items-center space-x-2 ${
                        filterType === key ? 'bg-black-700 text-white' : 'text-black-400 hover:text-white'
                      }`}
                    >
                      <span>{type.icon}</span>
                      <span>{type.label}</span>
                    </button>
                  ))}
                </div>
              </div>

              {/* Tags */}
              <div className="p-4 rounded-lg bg-black-800 border border-black-600">
                <h3 className="text-sm font-semibold text-black-400 mb-3">Tags</h3>
                <div className="flex flex-wrap gap-2">
                  {allTags.map(tag => (
                    <button
                      key={tag}
                      onClick={() => setFilterTag(filterTag === tag ? null : tag)}
                      className={`px-2 py-1 rounded text-xs transition-colors ${
                        filterTag === tag
                          ? 'bg-matrix-500/30 text-matrix-400 border border-matrix-500/50'
                          : 'bg-black-700 text-black-400 hover:text-white'
                      }`}
                    >
                      #{tag}
                    </button>
                  ))}
                </div>
              </div>

              {/* Stats */}
              <div className="p-4 rounded-lg bg-black-800 border border-black-600">
                <h3 className="text-sm font-semibold text-black-400 mb-3">Stats</h3>
                <div className="space-y-2 text-sm">
                  <div className="flex justify-between">
                    <span className="text-black-500">Total Contributions</span>
                    <span className="text-white font-mono">{contributions.length}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-black-500">Implemented</span>
                    <span className="text-matrix-500 font-mono">
                      {contributions.filter(c => c.implemented).length}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-black-500">Contributors</span>
                    <span className="text-white font-mono">{leaderboard.length}</span>
                  </div>
                </div>
              </div>
            </div>

            {/* Main Feed */}
            <div className="lg:col-span-3 space-y-4">
              {filteredContributions.length === 0 ? (
                <div className="text-center py-12 text-black-500">
                  No contributions found. Be the first!
                </div>
              ) : (
                (() => {
                  // Group by threads
                  const threads = {}
                  const standalone = []

                  filteredContributions.forEach(contrib => {
                    if (contrib.threadId) {
                      if (!threads[contrib.threadId]) {
                        threads[contrib.threadId] = []
                      }
                      threads[contrib.threadId].push(contrib)
                    } else {
                      standalone.push(contrib)
                    }
                  })

                  // Sort threads by threadOrder
                  Object.keys(threads).forEach(threadId => {
                    threads[threadId].sort((a, b) => a.threadOrder - b.threadOrder)
                  })

                  // Render threads first, then standalone
                  const renderedThreads = Object.entries(threads).map(([threadId, threadContribs]) => (
                    <div key={threadId} className="space-y-2">
                      <div className="flex items-center space-x-2 mb-2">
                        <span className="text-xs text-blue-400 font-medium">💬 Conversation Thread</span>
                        <span className="text-xs text-black-600">({threadContribs.length} messages)</span>
                      </div>
                      {threadContribs.map((contrib, idx) => (
                        <ContributionCard
                          key={contrib.id}
                          contribution={contrib}
                          onUpvote={() => upvoteContribution(contrib.id)}
                          isThreaded={idx > 0}
                          isLastInThread={idx === threadContribs.length - 1}
                        />
                      ))}
                    </div>
                  ))

                  const renderedStandalone = standalone.map(contrib => (
                    <ContributionCard
                      key={contrib.id}
                      contribution={contrib}
                      onUpvote={() => upvoteContribution(contrib.id)}
                    />
                  ))

                  return [...renderedStandalone, ...renderedThreads]
                })()
              )}
            </div>
          </motion.div>
        )}

        {/* Knowledge Graph Tab */}
        {activeTab === 'graph' && (
          <motion.div
            key="graph"
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
          >
            <KnowledgeGraphView graph={knowledgeGraph} contributions={contributions} />
          </motion.div>
        )}

        {/* Leaderboard Tab */}
        {activeTab === 'leaderboard' && (
          <motion.div
            key="leaderboard"
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            className="max-w-2xl mx-auto"
          >
            <LeaderboardView leaderboard={leaderboard} />
          </motion.div>
        )}
      </AnimatePresence>

      {/* New Post Modal */}
      <AnimatePresence>
        {showNewPost && (
          <NewContributionModal
            onClose={() => setShowNewPost(false)}
            onSubmit={(contrib) => {
              addContribution(contrib)
              // Also track in identity if user has one
              if (hasIdentity) {
                addIdentityContribution('post')
              }
              setShowNewPost(false)
            }}
            identity={identity}
            hasIdentity={hasIdentity}
          />
        )}
      </AnimatePresence>

      {/* Create Identity Modal */}
      <CreateIdentityModal
        isOpen={showIdentityModal}
        onClose={() => setShowIdentityModal(false)}
      />

      {/* Contribution Graph Modal */}
      <AnimatePresence>
        {showContribGraph && identity && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center p-4"
          >
            <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={() => setShowContribGraph(false)} />
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              className="relative w-full max-w-2xl bg-black-800 rounded-2xl border border-black-600 shadow-2xl max-h-[90vh] overflow-y-auto"
            >
              <div className="sticky top-0 flex items-center justify-between p-4 border-b border-black-700 bg-black-800">
                <div className="flex items-center space-x-3">
                  <SoulboundAvatar identity={identity} size={40} />
                  <div>
                    <h3 className="font-semibold">{identity.username}</h3>
                    <div className="text-xs text-black-400">Soulbound Identity #{identity.tokenId || 1}</div>
                  </div>
                </div>
                <button
                  onClick={() => setShowContribGraph(false)}
                  className="p-2 rounded-lg hover:bg-black-700"
                >
                  <svg className="w-5 h-5 text-black-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>
              <div className="p-4">
                <ContributionGraph identity={identity} />
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

function ContributionCard({ contribution, onUpvote, isThreaded = false, isLastInThread = false }) {
  const type = CONTRIBUTION_TYPES[contribution.type] || CONTRIBUTION_TYPES.feedback
  const timeAgo = getTimeAgo(contribution.timestamp)
  const isReservedUser = RESERVED_USERNAMES[contribution.author]
  const isSignature = contribution.isSignature
  const isKeyInsight = contribution.isKeyInsight

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      className={`p-5 rounded-lg bg-black-800 border ${
        isKeyInsight ? 'border-yellow-500/50 bg-yellow-500/5' :
        isSignature ? 'border-purple-500/50 bg-purple-500/5' :
        contribution.implemented ? 'border-matrix-500/50' : 'border-black-600'
      } hover:border-black-500 transition-colors ${isThreaded ? 'ml-6 border-l-2 border-l-black-600' : ''}`}
    >
      <div className="flex items-start space-x-4">
        {/* Upvote */}
        <div className="flex flex-col items-center space-y-1">
          <button
            onClick={onUpvote}
            className="p-2 rounded hover:bg-black-700 transition-colors text-black-400 hover:text-matrix-500"
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 15l7-7 7 7" />
            </svg>
          </button>
          <span className="text-sm font-bold text-matrix-500">{contribution.upvotes}</span>
        </div>

        {/* Content */}
        <div className="flex-1 min-w-0">
          {/* Header */}
          <div className="flex items-center flex-wrap gap-2 mb-2">
            <span className="text-lg">{type.icon}</span>
            <span className={`px-2 py-0.5 rounded text-xs bg-${type.color}-500/20 text-${type.color}-400`}>
              {type.label}
            </span>
            {contribution.threadId && (
              <span className="px-2 py-0.5 rounded text-xs bg-blue-500/20 text-blue-400 flex items-center space-x-1">
                <span>💬</span>
                <span>Thread</span>
              </span>
            )}
            {isKeyInsight && (
              <span className="px-2 py-0.5 rounded text-xs bg-yellow-500/20 text-yellow-400 flex items-center space-x-1">
                <span>⭐</span>
                <span>Key Insight</span>
              </span>
            )}
            {isSignature && (
              <span className="px-2 py-0.5 rounded text-xs bg-purple-500/20 text-purple-400 flex items-center space-x-1">
                <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M18 8a6 6 0 01-7.743 5.743L10 14l-1 1-1 1H6v2H2v-4l4.257-4.257A6 6 0 1118 8zm-6-4a1 1 0 100 2 2 2 0 012 2 1 1 0 102 0 4 4 0 00-4-4z" clipRule="evenodd" />
                </svg>
                <span>Signature</span>
              </span>
            )}
            {contribution.implemented && (
              <span className="px-2 py-0.5 rounded text-xs bg-matrix-500/20 text-matrix-400 flex items-center space-x-1">
                <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                </svg>
                <span>Implemented</span>
              </span>
            )}
          </div>

          {/* Title */}
          <h3 className="text-lg font-semibold text-white mb-2">
            {contribution.title}
          </h3>

          {/* Content */}
          <p className="text-black-300 text-sm mb-3">
            {contribution.content}
          </p>

          {/* Tags */}
          <div className="flex flex-wrap gap-2 mb-3">
            {contribution.tags?.map(tag => (
              <span key={tag} className="px-2 py-0.5 rounded text-xs bg-black-700 text-black-400">
                #{tag}
              </span>
            ))}
          </div>

          {/* Footer */}
          <div className="flex items-center justify-between text-xs text-black-500">
            <div className="flex items-center space-x-3">
              <span className="font-medium text-black-300 flex items-center space-x-1">
                <span>@{contribution.author}</span>
                {isReservedUser && (
                  <span className="px-1.5 py-0.5 rounded text-[10px] bg-yellow-500/20 text-yellow-400" title={`Reserved by ${isReservedUser.reservedBy}`}>
                    RESERVED
                  </span>
                )}
                {contribution.author === 'Faraday1' && (
                  <span className="px-1.5 py-0.5 rounded text-[10px] bg-matrix-500/20 text-matrix-400">
                    FOUNDER
                  </span>
                )}
              </span>
              <span>{timeAgo}</span>
            </div>
            {contribution.rewardPoints > 0 && (
              <span className="text-matrix-500 font-medium">
                +{contribution.rewardPoints} reward points
              </span>
            )}
          </div>
        </div>
      </div>
    </motion.div>
  )
}

function KnowledgeGraphView({ graph, contributions }) {
  const [selectedContribution, setSelectedContribution] = useState(null)

  return (
    <div className="p-6 rounded-lg bg-black-800 border border-black-600">
      <h2 className="text-xl font-bold text-white mb-4">Knowledge Graph</h2>
      <p className="text-sm text-black-400 mb-6">
        Contributions connected by shared tags and concepts. Click a bubble to view details.
      </p>

      {/* Simple visual representation */}
      <div className="relative min-h-[400px] bg-black-900 rounded-lg p-6">
        {/* Nodes */}
        <div className="flex flex-wrap gap-4 justify-center">
          {graph.nodes.map((node, i) => {
            const contrib = contributions.find(c => c.id === node.id)
            const type = CONTRIBUTION_TYPES[node.type] || CONTRIBUTION_TYPES.feedback
            const angle = (i / graph.nodes.length) * 2 * Math.PI
            const radius = 120 + (i % 3) * 40

            // Truncate title for tooltip
            const shortTitle = contrib?.title?.length > 25
              ? contrib.title.slice(0, 25) + '...'
              : contrib?.title

            return (
              <motion.div
                key={node.id}
                initial={{ scale: 0, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                transition={{ delay: i * 0.1 }}
                className="relative group"
                style={{
                  transform: `translate(${Math.cos(angle) * radius}px, ${Math.sin(angle) * radius}px)`,
                }}
              >
                <div
                  onClick={() => setSelectedContribution(contrib)}
                  className={`min-w-12 min-h-12 rounded-full flex items-center justify-center cursor-pointer hover:scale-110 transition-all hover:ring-2 hover:ring-matrix-500`}
                  style={{
                    width: Math.max(48, node.size * 2),
                    height: Math.max(48, node.size * 2),
                    backgroundColor: type.color === 'matrix' ? 'rgba(0, 255, 65, 0.2)' :
                                    type.color === 'terminal' ? 'rgba(0, 212, 255, 0.2)' :
                                    type.color === 'amber' ? 'rgba(245, 158, 11, 0.2)' :
                                    type.color === 'purple' ? 'rgba(168, 85, 247, 0.2)' : 'rgba(100, 100, 100, 0.2)',
                    borderWidth: 2,
                    borderStyle: 'solid',
                    borderColor: type.color === 'matrix' ? 'rgba(0, 255, 65, 0.5)' :
                                type.color === 'terminal' ? 'rgba(0, 212, 255, 0.5)' :
                                type.color === 'amber' ? 'rgba(245, 158, 11, 0.5)' :
                                type.color === 'purple' ? 'rgba(168, 85, 247, 0.5)' : 'rgba(100, 100, 100, 0.5)',
                  }}
                >
                  <span className="text-xl">{type.icon}</span>
                </div>

                {/* Tooltip - condensed and properly positioned */}
                <div className="absolute left-1/2 -translate-x-1/2 bottom-full mb-2 px-2 py-1.5 bg-black-700 border border-black-500 rounded text-xs text-white opacity-0 group-hover:opacity-100 transition-opacity z-50 pointer-events-none max-w-[150px]">
                  <div className="font-medium truncate">{shortTitle}</div>
                  <div className="text-black-400 text-[10px]">@{node.author}</div>
                </div>
              </motion.div>
            )
          })}
        </div>

        {/* Legend */}
        <div className="absolute bottom-4 left-4 flex flex-wrap gap-3">
          {Object.entries(CONTRIBUTION_TYPES).map(([key, type]) => (
            <div key={key} className="flex items-center space-x-1 text-xs text-black-400">
              <span>{type.icon}</span>
              <span>{type.label}</span>
            </div>
          ))}
        </div>

        {/* Connection count */}
        <div className="absolute bottom-4 right-4 text-xs text-black-500">
          {graph.edges.length} connections
        </div>
      </div>

      {/* Connections list */}
      {graph.edges.length > 0 && (
        <div className="mt-6">
          <h3 className="text-sm font-semibold text-black-400 mb-3">Connections</h3>
          <div className="space-y-2">
            {graph.edges.slice(0, 5).map((edge, i) => {
              const source = contributions.find(c => c.id === edge.source)
              const target = contributions.find(c => c.id === edge.target)
              return (
                <div key={i} className="flex items-center text-xs text-black-400">
                  <span className="text-white">{source?.title?.slice(0, 30)}</span>
                  <span className="mx-2">—</span>
                  <span className="text-matrix-500">#{edge.tags.join(', #')}</span>
                  <span className="mx-2">—</span>
                  <span className="text-white">{target?.title?.slice(0, 30)}</span>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* Contribution Detail Modal */}
      <AnimatePresence>
        {selectedContribution && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center p-4"
            onClick={() => setSelectedContribution(null)}
          >
            <div className="absolute inset-0 bg-black/80 backdrop-blur-sm" />
            <motion.div
              initial={{ scale: 0.95, opacity: 0, y: 20 }}
              animate={{ scale: 1, opacity: 1, y: 0 }}
              exit={{ scale: 0.95, opacity: 0, y: 20 }}
              onClick={(e) => e.stopPropagation()}
              className="relative w-full max-w-lg bg-black-800 rounded-2xl border border-black-600 shadow-2xl max-h-[80vh] overflow-y-auto"
            >
              {/* Header */}
              <div className="sticky top-0 flex items-center justify-between p-4 border-b border-black-700 bg-black-800">
                <div className="flex items-center space-x-2">
                  <span className="text-xl">{CONTRIBUTION_TYPES[selectedContribution.type]?.icon || '📝'}</span>
                  <span className="px-2 py-0.5 rounded text-xs bg-matrix-500/20 text-matrix-400">
                    {CONTRIBUTION_TYPES[selectedContribution.type]?.label || 'Contribution'}
                  </span>
                  {selectedContribution.implemented && (
                    <span className="px-2 py-0.5 rounded text-xs bg-green-500/20 text-green-400">
                      ✓ Implemented
                    </span>
                  )}
                </div>
                <button
                  onClick={() => setSelectedContribution(null)}
                  className="p-2 rounded-lg hover:bg-black-700"
                >
                  <svg className="w-5 h-5 text-black-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>

              {/* Content */}
              <div className="p-6">
                <h2 className="text-xl font-bold text-white mb-2">{selectedContribution.title}</h2>
                <p className="text-black-300 mb-6 leading-relaxed">{selectedContribution.content}</p>

                {/* Metadata */}
                <div className="space-y-4">
                  {/* Author & Time */}
                  <div className="flex items-center justify-between text-sm">
                    <div className="flex items-center space-x-2">
                      <span className="text-black-500">Author:</span>
                      <span className="text-white font-medium">@{selectedContribution.author}</span>
                      {selectedContribution.author === 'Faraday1' && (
                        <span className="px-1.5 py-0.5 rounded text-[10px] bg-matrix-500/20 text-matrix-400">FOUNDER</span>
                      )}
                    </div>
                    <span className="text-black-500">{getTimeAgo(selectedContribution.timestamp)}</span>
                  </div>

                  {/* Tags */}
                  {selectedContribution.tags?.length > 0 && (
                    <div>
                      <span className="text-xs text-black-500 block mb-2">Tags</span>
                      <div className="flex flex-wrap gap-2">
                        {selectedContribution.tags.map(tag => (
                          <span key={tag} className="px-2 py-1 rounded text-xs bg-black-700 text-black-300">
                            #{tag}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Stats */}
                  <div className="grid grid-cols-2 gap-4 pt-4 border-t border-black-700">
                    <div className="text-center p-3 rounded-lg bg-black-900">
                      <div className="text-xl font-bold text-matrix-500">{selectedContribution.upvotes || 0}</div>
                      <div className="text-xs text-black-500">Upvotes</div>
                    </div>
                    <div className="text-center p-3 rounded-lg bg-black-900">
                      <div className="text-xl font-bold text-terminal-500">{selectedContribution.rewardPoints || 0}</div>
                      <div className="text-xs text-black-500">Reward Points</div>
                    </div>
                  </div>

                  {/* ID */}
                  <div className="pt-4 border-t border-black-700">
                    <span className="text-xs text-black-600 font-mono">ID: {selectedContribution.id}</span>
                  </div>
                </div>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

function LeaderboardView({ leaderboard }) {
  return (
    <div className="p-6 rounded-lg bg-black-800 border border-black-600">
      <h2 className="text-xl font-bold text-white mb-2">Top Contributors</h2>
      <p className="text-sm text-black-400 mb-6">
        Earn rewards when your contributions get implemented
      </p>

      <div className="space-y-3">
        {leaderboard.map((user, i) => (
          <motion.div
            key={user.username}
            initial={{ opacity: 0, x: -20 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: i * 0.1 }}
            className={`p-4 rounded-lg border transition-colors ${
              i === 0 ? 'bg-matrix-500/10 border-matrix-500/30' : 'bg-black-900 border-black-700'
            }`}
          >
            <div className="flex items-center justify-between">
              <div className="flex items-center space-x-4">
                {/* Rank */}
                <div className={`w-8 h-8 rounded-full flex items-center justify-center font-bold ${
                  i === 0 ? 'bg-yellow-500/20 text-yellow-400' :
                  i === 1 ? 'bg-gray-400/20 text-gray-400' :
                  i === 2 ? 'bg-orange-500/20 text-orange-400' :
                  'bg-black-700 text-black-400'
                }`}>
                  {i + 1}
                </div>

                {/* User info */}
                <div>
                  <div className="flex items-center flex-wrap gap-2">
                    <span className="font-semibold text-white">@{user.username}</span>
                    {user.username === 'Faraday1' && (
                      <span className="px-1.5 py-0.5 rounded text-[10px] bg-matrix-500/20 text-matrix-400">
                        FOUNDER
                      </span>
                    )}
                    {RESERVED_USERNAMES[user.username] && (
                      <span className="px-1.5 py-0.5 rounded text-[10px] bg-yellow-500/20 text-yellow-400">
                        RESERVED
                      </span>
                    )}
                    <span className={`text-xs ${user.rank.color}`}>{user.rank.title}</span>
                  </div>
                  <div className="text-xs text-black-500">
                    {user.contributionCount} contributions · {user.implementedCount} implemented
                  </div>
                </div>
              </div>

              {/* Points */}
              <div className="text-right">
                <div className="text-lg font-bold text-matrix-500">{user.totalPoints}</div>
                <div className="text-xs text-black-500">reward points</div>
              </div>
            </div>
          </motion.div>
        ))}
      </div>

      {/* How it works */}
      <div className="mt-6 p-4 rounded-lg bg-black-900 border border-black-700">
        <h3 className="text-sm font-semibold text-black-300 mb-2">How Rewards Work</h3>
        <ul className="text-xs text-black-400 space-y-1">
          <li>• Submit context, features, or feedback</li>
          <li>• Community upvotes quality contributions</li>
          <li>• When implemented, you earn reward points</li>
          <li>• Points convert to token rewards at launch</li>
        </ul>
      </div>
    </div>
  )
}

function NewContributionModal({ onClose, onSubmit, identity, hasIdentity }) {
  const [title, setTitle] = useState('')
  const [content, setContent] = useState('')
  const [type, setType] = useState('context')
  const [tags, setTags] = useState('')
  const [author, setAuthor] = useState(() => {
    // Use soulbound identity username if available
    if (hasIdentity && identity?.username) {
      return identity.username
    }
    const saved = localStorage.getItem('vibeswap_personality')
    if (saved) {
      try {
        const data = JSON.parse(saved)
        return data.username || ''
      } catch (e) {}
    }
    return ''
  })

  const handleSubmit = (e) => {
    e.preventDefault()
    if (!title.trim() || !content.trim() || !author.trim()) return

    onSubmit({
      title: title.trim(),
      content: content.trim(),
      type,
      author: author.trim(),
      tags: tags.split(',').map(t => t.trim().toLowerCase()).filter(Boolean),
    })
  }

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80"
      onClick={onClose}
    >
      <motion.div
        initial={{ scale: 0.9, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        exit={{ scale: 0.9, opacity: 0 }}
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-lg p-6 rounded-lg bg-black-800 border border-black-600"
      >
        <h2 className="text-xl font-bold text-white mb-4">New Contribution</h2>

        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Author */}
          <div>
            <label className="block text-sm text-black-400 mb-1">Username</label>
            {hasIdentity && identity ? (
              <div className="flex items-center space-x-3 px-3 py-2 rounded-lg bg-black-900 border border-matrix-500/30">
                <SoulboundAvatar identity={identity} size={24} showLevel={false} />
                <span className="text-matrix-500 font-medium">{identity.username}</span>
                <span className="text-xs text-black-500 px-1.5 py-0.5 rounded bg-matrix-500/10">Verified</span>
              </div>
            ) : (
              <input
                type="text"
                value={author}
                onChange={(e) => setAuthor(e.target.value)}
                placeholder="your username"
                className="w-full px-3 py-2 rounded-lg bg-black-900 border border-black-600 text-white placeholder-black-500 focus:border-matrix-500 focus:outline-none"
              />
            )}
          </div>

          {/* Type */}
          <div>
            <label className="block text-sm text-black-400 mb-1">Type</label>
            <div className="flex flex-wrap gap-2">
              {Object.entries(CONTRIBUTION_TYPES).map(([key, t]) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => setType(key)}
                  className={`px-3 py-1.5 rounded text-sm transition-colors ${
                    type === key
                      ? 'bg-matrix-500/20 text-matrix-400 border border-matrix-500/50'
                      : 'bg-black-700 text-black-400 hover:text-white'
                  }`}
                >
                  {t.icon} {t.label}
                </button>
              ))}
            </div>
          </div>

          {/* Title */}
          <div>
            <label className="block text-sm text-black-400 mb-1">Title</label>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Brief title for your contribution"
              className="w-full px-3 py-2 rounded-lg bg-black-900 border border-black-600 text-white placeholder-black-500 focus:border-matrix-500 focus:outline-none"
            />
          </div>

          {/* Content */}
          <div>
            <label className="block text-sm text-black-400 mb-1">Content</label>
            <textarea
              value={content}
              onChange={(e) => setContent(e.target.value)}
              placeholder="Describe your idea, feedback, or context..."
              rows={4}
              className="w-full px-3 py-2 rounded-lg bg-black-900 border border-black-600 text-white placeholder-black-500 focus:border-matrix-500 focus:outline-none resize-none"
            />
          </div>

          {/* Tags */}
          <div>
            <label className="block text-sm text-black-400 mb-1">Tags (comma separated)</label>
            <input
              type="text"
              value={tags}
              onChange={(e) => setTags(e.target.value)}
              placeholder="rewards, xp-system, community"
              className="w-full px-3 py-2 rounded-lg bg-black-900 border border-black-600 text-white placeholder-black-500 focus:border-matrix-500 focus:outline-none"
            />
          </div>

          {/* Actions */}
          <div className="flex justify-end space-x-3 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 rounded-lg text-black-400 hover:text-white transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={!title.trim() || !content.trim() || !author.trim()}
              className="px-4 py-2 rounded-lg bg-matrix-600 hover:bg-matrix-500 text-black-900 font-semibold transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Submit Contribution
            </button>
          </div>
        </form>
      </motion.div>
    </motion.div>
  )
}

function getTimeAgo(timestamp) {
  const seconds = Math.floor((Date.now() - timestamp) / 1000)
  if (seconds < 60) return 'just now'
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`
  return `${Math.floor(seconds / 86400)}d ago`
}

export default ForumPage
