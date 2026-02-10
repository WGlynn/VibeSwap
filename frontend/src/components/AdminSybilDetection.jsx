import { useState, useEffect } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { useContributions } from '../contexts/ContributionsContext'
import { useWallet } from '../hooks/useWallet'
import { runSybilDetection, SYBIL_CONFIG } from '../utils/sybilDetection'

/**
 * Admin Sybil Detection Dashboard
 *
 * Displays real-time analysis of potential Sybil attacks
 * with actionable recommendations.
 *
 * @version 1.0.0
 */

// Severity badge colors
const SEVERITY_COLORS = {
  CRITICAL: 'bg-red-500/20 text-red-400 border-red-500/30',
  HIGH: 'bg-orange-500/20 text-orange-400 border-orange-500/30',
  MEDIUM: 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30',
  LOW: 'bg-green-500/20 text-green-400 border-green-500/30',
}

const RISK_LEVEL_COLORS = {
  CRITICAL: 'text-red-400',
  HIGH: 'text-orange-400',
  MEDIUM: 'text-yellow-400',
  LOW: 'text-green-400',
}

function AdminSybilDetection({ isOpen, onClose }) {
  const { contributions } = useContributions()
  const { provider } = useWallet()

  const [report, setReport] = useState(null)
  const [isLoading, setIsLoading] = useState(false)
  const [activeTab, setActiveTab] = useState('summary')
  const [expandedDetection, setExpandedDetection] = useState(null)

  // Mock identities for testing (in production, fetch from identity registry)
  const [identities, setIdentities] = useState([])

  useEffect(() => {
    // Build identities from contributions authors
    const authors = [...new Set(contributions.map(c => c.author))]
    const mockIdentities = authors.map((author, i) => ({
      username: author,
      address: `0x${i.toString(16).padStart(40, '0')}`, // Mock addresses
      createdAt: Date.now() - Math.random() * 86400000 * 30, // Random creation in last 30 days
    }))
    setIdentities(mockIdentities)
  }, [contributions])

  const runDetection = async () => {
    setIsLoading(true)
    try {
      // Run full Sybil detection
      const result = await runSybilDetection(
        contributions,
        identities,
        null, // upvoteGraph - TODO: implement
        provider
      )
      setReport(result)
    } catch (err) {
      console.error('Sybil detection failed:', err)
    }
    setIsLoading(false)
  }

  useEffect(() => {
    if (isOpen && contributions.length > 0) {
      runDetection()
    }
  }, [isOpen, contributions.length])

  if (!isOpen) return null

  const tabs = [
    { id: 'summary', label: 'Summary', icon: '📊' },
    { id: 'upvoteRings', label: 'Upvote Rings', icon: '🔄' },
    { id: 'burstCreation', label: 'Burst Creation', icon: '⚡' },
    { id: 'newAccountSpam', label: 'New Account Spam', icon: '🆕' },
    { id: 'sequentialUsernames', label: 'Username Patterns', icon: '🤖' },
    { id: 'similarContent', label: 'Duplicate Content', icon: '📝' },
    { id: 'timingCorrelation', label: 'Timing Sync', icon: '⏱️' },
    { id: 'walletClustering', label: 'Wallet Clusters', icon: '💰' },
    { id: 'recommendations', label: 'Actions', icon: '⚠️' },
  ]

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 z-50 flex items-center justify-center p-4"
      >
        <div className="absolute inset-0 bg-black/80 backdrop-blur-sm" onClick={onClose} />
        <motion.div
          initial={{ scale: 0.95, opacity: 0, y: 20 }}
          animate={{ scale: 1, opacity: 1, y: 0 }}
          exit={{ scale: 0.95, opacity: 0, y: 20 }}
          className="relative w-full max-w-4xl bg-black-800 rounded-2xl border border-black-600 shadow-2xl max-h-[90vh] overflow-hidden flex flex-col"
        >
          {/* Header */}
          <div className="flex items-center justify-between p-4 border-b border-black-700">
            <div className="flex items-center space-x-3">
              <span className="text-2xl">🛡️</span>
              <div>
                <h2 className="text-lg font-bold">Sybil Detection Dashboard</h2>
                <p className="text-sm text-black-400">Real-time attack vector analysis</p>
              </div>
            </div>
            <div className="flex items-center space-x-3">
              <button
                onClick={runDetection}
                disabled={isLoading}
                className="px-3 py-1.5 rounded-lg bg-terminal-500/20 text-terminal-400 text-sm font-medium hover:bg-terminal-500/30 disabled:opacity-50"
              >
                {isLoading ? 'Scanning...' : '🔄 Refresh'}
              </button>
              <button onClick={onClose} className="p-2 hover:bg-black-700 rounded-lg">
                <svg className="w-5 h-5 text-black-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
          </div>

          {/* Risk Score Banner */}
          {report && (
            <div className={`px-4 py-3 border-b border-black-700 ${
              report.summary.riskLevel === 'CRITICAL' ? 'bg-red-500/10' :
              report.summary.riskLevel === 'HIGH' ? 'bg-orange-500/10' :
              report.summary.riskLevel === 'MEDIUM' ? 'bg-yellow-500/10' :
              'bg-green-500/10'
            }`}>
              <div className="flex items-center justify-between">
                <div className="flex items-center space-x-4">
                  <div>
                    <div className="text-sm text-black-400">Risk Score</div>
                    <div className={`text-3xl font-bold ${RISK_LEVEL_COLORS[report.summary.riskLevel]}`}>
                      {report.summary.riskScore}/100
                    </div>
                  </div>
                  <div className={`px-3 py-1 rounded-full text-sm font-semibold ${SEVERITY_COLORS[report.summary.riskLevel]}`}>
                    {report.summary.riskLevel} RISK
                  </div>
                </div>
                <div className="flex items-center space-x-6 text-sm">
                  <div>
                    <span className="text-red-400 font-bold">{report.summary.criticalIssues}</span>
                    <span className="text-black-400 ml-1">Critical</span>
                  </div>
                  <div>
                    <span className="text-orange-400 font-bold">{report.summary.highIssues}</span>
                    <span className="text-black-400 ml-1">High</span>
                  </div>
                  <div>
                    <span className="text-yellow-400 font-bold">{report.summary.mediumIssues}</span>
                    <span className="text-black-400 ml-1">Medium</span>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Tabs */}
          <div className="flex overflow-x-auto border-b border-black-700 px-2">
            {tabs.map(tab => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`flex items-center space-x-1.5 px-3 py-2.5 text-sm font-medium whitespace-nowrap border-b-2 transition-colors ${
                  activeTab === tab.id
                    ? 'border-terminal-500 text-terminal-400'
                    : 'border-transparent text-black-400 hover:text-black-200'
                }`}
              >
                <span>{tab.icon}</span>
                <span>{tab.label}</span>
                {report && tab.id !== 'summary' && tab.id !== 'recommendations' && report.detections[tab.id]?.length > 0 && (
                  <span className="ml-1 px-1.5 py-0.5 rounded-full bg-red-500/20 text-red-400 text-xs">
                    {report.detections[tab.id].length}
                  </span>
                )}
              </button>
            ))}
          </div>

          {/* Content */}
          <div className="flex-1 overflow-y-auto p-4">
            {isLoading ? (
              <div className="flex items-center justify-center h-64">
                <div className="text-center">
                  <div className="animate-spin w-8 h-8 border-2 border-terminal-500 border-t-transparent rounded-full mx-auto mb-3" />
                  <div className="text-black-400">Analyzing {contributions.length} contributions...</div>
                </div>
              </div>
            ) : !report ? (
              <div className="flex items-center justify-center h-64">
                <div className="text-center text-black-400">
                  <p>No data to analyze</p>
                </div>
              </div>
            ) : (
              <>
                {/* Summary Tab */}
                {activeTab === 'summary' && (
                  <div className="space-y-4">
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                      <StatCard label="Contributions" value={contributions.length} icon="📝" />
                      <StatCard label="Identities" value={identities.length} icon="👤" />
                      <StatCard label="Issues Found" value={report.summary.totalIssues} icon="⚠️" color="text-orange-400" />
                      <StatCard label="Heuristics Run" value="8" icon="🔍" />
                    </div>

                    <div className="mt-6">
                      <h3 className="text-sm font-semibold text-black-300 mb-3">Detection Results</h3>
                      <div className="space-y-2">
                        {Object.entries(report.detections).map(([key, results]) => (
                          <div key={key} className="flex items-center justify-between p-3 rounded-lg bg-black-700/50">
                            <div className="flex items-center space-x-3">
                              <span className="text-lg">{tabs.find(t => t.id === key)?.icon || '📊'}</span>
                              <span className="text-sm">{tabs.find(t => t.id === key)?.label || key}</span>
                            </div>
                            <div className={`px-2 py-0.5 rounded text-xs font-medium ${
                              results.length === 0 ? 'bg-green-500/20 text-green-400' : 'bg-red-500/20 text-red-400'
                            }`}>
                              {results.length === 0 ? 'Clear' : `${results.length} issues`}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>

                    {/* Config Display */}
                    <div className="mt-6 p-4 rounded-lg bg-black-700/30 border border-black-600">
                      <h3 className="text-sm font-semibold text-black-300 mb-3">Detection Thresholds (Immutable)</h3>
                      <div className="grid grid-cols-2 gap-2 text-xs font-mono">
                        <div className="text-black-400">Upvote Ring: <span className="text-terminal-400">{SYBIL_CONFIG.UPVOTE_RING_THRESHOLD * 100}%</span></div>
                        <div className="text-black-400">Burst Window: <span className="text-terminal-400">{SYBIL_CONFIG.BURST_WINDOW_MS / 3600000}h</span></div>
                        <div className="text-black-400">Burst Threshold: <span className="text-terminal-400">{SYBIL_CONFIG.BURST_ACCOUNT_THRESHOLD} accounts</span></div>
                        <div className="text-black-400">New Account Age: <span className="text-terminal-400">{SYBIL_CONFIG.NEW_ACCOUNT_AGE_MS / 86400000}d</span></div>
                        <div className="text-black-400">Content Similarity: <span className="text-terminal-400">{SYBIL_CONFIG.SIMILARITY_THRESHOLD * 100}%</span></div>
                        <div className="text-black-400">Timing Window: <span className="text-terminal-400">{SYBIL_CONFIG.TIMING_WINDOW_MS / 1000}s</span></div>
                      </div>
                    </div>
                  </div>
                )}

                {/* Recommendations Tab */}
                {activeTab === 'recommendations' && (
                  <div className="space-y-3">
                    {report.recommendations.length === 0 ? (
                      <div className="text-center py-12 text-black-400">
                        <span className="text-4xl mb-3 block">✅</span>
                        <p>No actionable recommendations</p>
                        <p className="text-sm mt-1">System appears healthy</p>
                      </div>
                    ) : (
                      report.recommendations.map((rec, i) => (
                        <div key={i} className={`p-4 rounded-lg border ${SEVERITY_COLORS[rec.priority]}`}>
                          <div className="flex items-start justify-between">
                            <div>
                              <div className="flex items-center space-x-2">
                                <span className={`px-2 py-0.5 rounded text-xs font-bold ${SEVERITY_COLORS[rec.priority]}`}>
                                  {rec.priority}
                                </span>
                                <span className="font-semibold">{rec.action}</span>
                              </div>
                              <p className="text-sm text-black-300 mt-1">{rec.description}</p>
                            </div>
                          </div>
                          {rec.affectedAccounts && rec.affectedAccounts.length > 0 && (
                            <div className="mt-3 pt-3 border-t border-black-600">
                              <div className="text-xs text-black-400 mb-1">Affected accounts ({rec.affectedAccounts.length}):</div>
                              <div className="flex flex-wrap gap-1">
                                {rec.affectedAccounts.slice(0, 10).map((acc, j) => (
                                  <span key={j} className="px-2 py-0.5 rounded bg-black-600 text-xs font-mono">
                                    {acc}
                                  </span>
                                ))}
                                {rec.affectedAccounts.length > 10 && (
                                  <span className="px-2 py-0.5 rounded bg-black-600 text-xs">
                                    +{rec.affectedAccounts.length - 10} more
                                  </span>
                                )}
                              </div>
                            </div>
                          )}
                        </div>
                      ))
                    )}
                  </div>
                )}

                {/* Detection Detail Tabs */}
                {activeTab !== 'summary' && activeTab !== 'recommendations' && (
                  <DetectionList
                    detections={report.detections[activeTab] || []}
                    type={activeTab}
                    expandedDetection={expandedDetection}
                    setExpandedDetection={setExpandedDetection}
                  />
                )}
              </>
            )}
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  )
}

function StatCard({ label, value, icon, color = 'text-white' }) {
  return (
    <div className="p-4 rounded-lg bg-black-700/50 border border-black-600">
      <div className="flex items-center justify-between">
        <span className="text-2xl">{icon}</span>
        <span className={`text-2xl font-bold ${color}`}>{value}</span>
      </div>
      <div className="text-xs text-black-400 mt-1">{label}</div>
    </div>
  )
}

function DetectionList({ detections, type, expandedDetection, setExpandedDetection }) {
  if (detections.length === 0) {
    return (
      <div className="text-center py-12 text-black-400">
        <span className="text-4xl mb-3 block">✅</span>
        <p>No issues detected</p>
        <p className="text-sm mt-1">This heuristic found no suspicious patterns</p>
      </div>
    )
  }

  return (
    <div className="space-y-3">
      {detections.map((detection, i) => (
        <div
          key={i}
          className={`rounded-lg border ${SEVERITY_COLORS[detection.severity]} overflow-hidden`}
        >
          <button
            onClick={() => setExpandedDetection(expandedDetection === i ? null : i)}
            className="w-full p-4 text-left flex items-center justify-between"
          >
            <div className="flex items-center space-x-3">
              <span className={`px-2 py-0.5 rounded text-xs font-bold ${SEVERITY_COLORS[detection.severity]}`}>
                {detection.severity}
              </span>
              <span className="font-medium">{detection.evidence}</span>
            </div>
            <svg
              className={`w-5 h-5 transition-transform ${expandedDetection === i ? 'rotate-180' : ''}`}
              fill="none" viewBox="0 0 24 24" stroke="currentColor"
            >
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
            </svg>
          </button>

          {expandedDetection === i && (
            <div className="px-4 pb-4 border-t border-black-600 pt-3">
              {/* Accounts */}
              {detection.accounts && (
                <div className="mb-3">
                  <div className="text-xs text-black-400 mb-1">Accounts ({detection.accounts.length}):</div>
                  <div className="flex flex-wrap gap-1">
                    {detection.accounts.map((acc, j) => (
                      <span key={j} className="px-2 py-0.5 rounded bg-black-600 text-xs font-mono">
                        {acc}
                      </span>
                    ))}
                  </div>
                </div>
              )}

              {/* Addresses */}
              {detection.addresses && (
                <div className="mb-3">
                  <div className="text-xs text-black-400 mb-1">Wallet Addresses:</div>
                  <div className="space-y-1">
                    {detection.addresses.slice(0, 5).map((addr, j) => (
                      <div key={j} className="font-mono text-xs text-black-300">
                        {addr}
                      </div>
                    ))}
                    {detection.addresses.length > 5 && (
                      <div className="text-xs text-black-500">+{detection.addresses.length - 5} more</div>
                    )}
                  </div>
                </div>
              )}

              {/* Funding Source */}
              {detection.fundingSource && (
                <div className="mb-3">
                  <div className="text-xs text-black-400 mb-1">Funding Source:</div>
                  <div className="font-mono text-xs text-terminal-400">{detection.fundingSource}</div>
                </div>
              )}

              {/* Ring Score */}
              {detection.ringScore && (
                <div className="mb-3">
                  <div className="text-xs text-black-400 mb-1">Ring Score:</div>
                  <div className="text-sm text-red-400 font-bold">{detection.ringScore}% internal upvotes</div>
                </div>
              )}

              {/* Content Similarity */}
              {detection.similarity && (
                <div className="mb-3">
                  <div className="text-xs text-black-400 mb-1">Content Similarity:</div>
                  <div className="text-sm text-yellow-400 font-bold">{detection.similarity}%</div>
                  <div className="text-xs text-black-400 mt-1">
                    Between: {detection.contrib1?.title} ↔ {detection.contrib2?.title}
                  </div>
                </div>
              )}

              {/* Timing Info */}
              {detection.windowTime && (
                <div className="mb-3">
                  <div className="text-xs text-black-400 mb-1">Time Window:</div>
                  <div className="text-sm">{new Date(detection.windowTime).toLocaleString()}</div>
                </div>
              )}

              {/* Additional Details */}
              <div className="mt-3 pt-3 border-t border-black-600">
                <pre className="text-xs text-black-400 overflow-x-auto">
                  {JSON.stringify(detection, null, 2)}
                </pre>
              </div>
            </div>
          )}
        </div>
      ))}
    </div>
  )
}

export default AdminSybilDetection
