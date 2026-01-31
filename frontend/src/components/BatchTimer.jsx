import { useState, useEffect } from 'react'

function BatchTimer() {
  const [phase, setPhase] = useState('commit')
  const [timeLeft, setTimeLeft] = useState(8)
  const [batchId, setBatchId] = useState(1247)

  useEffect(() => {
    const interval = setInterval(() => {
      setTimeLeft((prev) => {
        if (prev <= 1) {
          if (phase === 'commit') {
            setPhase('reveal')
            return 2
          } else if (phase === 'reveal') {
            setPhase('settling')
            return 1
          } else {
            setPhase('commit')
            setBatchId((b) => b + 1)
            return 8
          }
        }
        return prev - 1
      })
    }, 1000)

    return () => clearInterval(interval)
  }, [phase])

  const getPhaseColor = () => {
    switch (phase) {
      case 'commit':
        return 'from-green-500 to-emerald-600'
      case 'reveal':
        return 'from-yellow-500 to-orange-500'
      case 'settling':
        return 'from-vibe-500 to-purple-600'
      default:
        return 'from-dark-500 to-dark-600'
    }
  }

  const getPhaseLabel = () => {
    switch (phase) {
      case 'commit':
        return 'Commit Phase'
      case 'reveal':
        return 'Reveal Phase'
      case 'settling':
        return 'Settling...'
      default:
        return 'Unknown'
    }
  }

  const totalTime = phase === 'commit' ? 8 : phase === 'reveal' ? 2 : 1
  const progress = ((totalTime - timeLeft) / totalTime) * 100

  return (
    <div className="mb-6 p-4 rounded-2xl bg-dark-800/50 border border-dark-700">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center space-x-3">
          <div className={`w-3 h-3 rounded-full bg-gradient-to-r ${getPhaseColor()} batch-pulse`} />
          <span className="font-medium">{getPhaseLabel()}</span>
        </div>
        <div className="flex items-center space-x-4 text-sm text-dark-400">
          <span>Batch #{batchId}</span>
          <span className="font-mono text-lg text-white">{timeLeft}s</span>
        </div>
      </div>

      {/* Progress bar */}
      <div className="h-1.5 bg-dark-700 rounded-full overflow-hidden">
        <div
          className={`h-full bg-gradient-to-r ${getPhaseColor()} transition-all duration-1000 ease-linear`}
          style={{ width: `${progress}%` }}
        />
      </div>

      {/* Phase indicators */}
      <div className="flex items-center justify-between mt-3 text-xs text-dark-400">
        <div className="flex items-center space-x-1">
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
          </svg>
          <span>Orders are hidden until reveal</span>
        </div>
        <div className="flex items-center space-x-1">
          <svg className="w-4 h-4 text-green-500" fill="currentColor" viewBox="0 0 20 20">
            <path fillRule="evenodd" d="M2.166 4.999A11.954 11.954 0 0010 1.944 11.954 11.954 0 0017.834 5c.11.65.166 1.32.166 2.001 0 5.225-3.34 9.67-8 11.317C5.34 16.67 2 12.225 2 7c0-.682.057-1.35.166-2.001zm11.541 3.708a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
          </svg>
          <span>MEV Protected</span>
        </div>
      </div>
    </div>
  )
}

export default BatchTimer
