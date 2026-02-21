import { useState, useEffect, useRef, useCallback } from 'react'
import { motion } from 'framer-motion'
import { useWallet } from '../hooks/useWallet'
import { useDeviceWallet } from '../hooks/useDeviceWallet'
import toast from 'react-hot-toast'
import GlassCard from './ui/GlassCard'
import InteractiveButton from './ui/InteractiveButton'
import AnimatedNumber from './ui/AnimatedNumber'
import { StaggerContainer, StaggerItem } from './ui/StaggerContainer'

// ============ SHA-256 Mining Worker (inline) ============

const WORKER_CODE = `
  // SHA-256 mining in Web Worker
  let mining = false
  let hashCount = 0
  let startTime = 0

  async function sha256(data) {
    const encoded = new TextEncoder().encode(data)
    const hashBuffer = await crypto.subtle.digest('SHA-256', encoded)
    const hashArray = Array.from(new Uint8Array(hashBuffer))
    return hashArray.map(b => b.toString(16).padStart(2, '0')).join('')
  }

  function meetsTarget(hash, difficulty) {
    // Count leading zeros needed based on difficulty
    const target = Math.floor(Math.log2(difficulty))
    const leadingZeros = Math.floor(target / 4)
    const prefix = '0'.repeat(leadingZeros)
    return hash.startsWith(prefix)
  }

  async function mineBlock(challenge, difficulty, batchSize) {
    for (let i = 0; i < batchSize; i++) {
      if (!mining) return null

      // Generate random nonce
      const nonce = crypto.getRandomValues(new Uint8Array(32))
      const nonceHex = Array.from(nonce).map(b => b.toString(16).padStart(2, '0')).join('')

      // Hash: SHA-256(challenge + nonce)
      const hash = await sha256(challenge + nonceHex)
      hashCount++

      if (meetsTarget(hash, difficulty)) {
        return { nonce: '0x' + nonceHex, hash: '0x' + hash }
      }
    }
    return undefined // batch complete, no solution
  }

  self.onmessage = async (e) => {
    const { type, challenge, difficulty } = e.data

    if (type === 'start') {
      mining = true
      hashCount = 0
      startTime = Date.now()

      // Report hashrate every second
      const reporter = setInterval(() => {
        if (!mining) { clearInterval(reporter); return }
        const elapsed = (Date.now() - startTime) / 1000
        const hashrate = elapsed > 0 ? hashCount / elapsed : 0
        self.postMessage({ type: 'hashrate', hashrate, totalHashes: hashCount })
      }, 1000)

      // Mine in batches
      while (mining) {
        const result = await mineBlock(challenge, difficulty, 100)
        if (result === null) break // stopped
        if (result) {
          mining = false
          clearInterval(reporter)
          self.postMessage({ type: 'found', ...result, totalHashes: hashCount })
          return
        }
      }

      clearInterval(reporter)
      self.postMessage({ type: 'stopped' })
    }

    if (type === 'stop') {
      mining = false
    }
  }
`

function MinePage() {
  const { isConnected: isExternalConnected, connect, address } = useWallet()
  const { isConnected: isDeviceConnected } = useDeviceWallet()
  const isConnected = isExternalConnected || isDeviceConnected

  // Mining state
  const [isMining, setIsMining] = useState(false)
  const [hashrate, setHashrate] = useState(0)
  const [totalHashes, setTotalHashes] = useState(0)
  const [blocksFound, setBlocksFound] = useState(0)
  const [totalReward, setTotalReward] = useState(0)
  const [miningLog, setMiningLog] = useState([])
  const [workerCount, setWorkerCount] = useState(
    Math.max(1, Math.min(navigator.hardwareConcurrency || 4, 8))
  )

  // Contract state (mock for now, replaced with real contract reads on mainnet)
  const [difficulty, setDifficulty] = useState(65536)
  const [currentReward, setCurrentReward] = useState(1.0)
  const [epochNumber, setEpochNumber] = useState(1)
  const [totalBlocksMined, setTotalBlocksMined] = useState(0)
  const [challenge, setChallenge] = useState('0x' + '0'.repeat(64))

  const workersRef = useRef([])
  const miningStartRef = useRef(null)

  // Generate a mock challenge (in production, read from Joule contract)
  useEffect(() => {
    const mockChallenge = '0x' + Array.from(
      crypto.getRandomValues(new Uint8Array(32))
    ).map(b => b.toString(16).padStart(2, '0')).join('')
    setChallenge(mockChallenge)
  }, [])

  const addLog = useCallback((message, type = 'info') => {
    const timestamp = new Date().toLocaleTimeString()
    setMiningLog(prev => [{timestamp, message, type}, ...prev.slice(0, 49)])
  }, [])

  const startMining = useCallback(() => {
    if (!isConnected) {
      connect()
      return
    }

    setIsMining(true)
    setHashrate(0)
    setTotalHashes(0)
    miningStartRef.current = Date.now()
    addLog(`Starting ${workerCount} mining threads...`, 'system')
    addLog(`Challenge: ${challenge.slice(0, 18)}...`, 'system')
    addLog(`Difficulty: ${difficulty.toLocaleString()}`, 'system')

    const blob = new Blob([WORKER_CODE], { type: 'application/javascript' })
    const workerUrl = URL.createObjectURL(blob)
    const workers = []

    for (let i = 0; i < workerCount; i++) {
      const worker = new Worker(workerUrl)

      worker.onmessage = (e) => {
        const { type, hashrate: hr, totalHashes: th, nonce, hash } = e.data

        if (type === 'hashrate') {
          setHashrate(prev => {
            // Aggregate from all workers — this worker reports its rate
            return hr * workerCount // approximate total
          })
          setTotalHashes(prev => prev + 100)
        }

        if (type === 'found') {
          const reward = currentReward
          setBlocksFound(prev => prev + 1)
          setTotalReward(prev => prev + reward)
          setTotalBlocksMined(prev => prev + 1)
          addLog(`BLOCK FOUND! Nonce: ${nonce.slice(0, 18)}...`, 'success')
          addLog(`Hash: ${hash.slice(0, 18)}...`, 'success')
          addLog(`Reward: ${reward.toFixed(6)} JUL`, 'success')
          toast.success(`Block mined! +${reward.toFixed(4)} JUL`)

          // Restart this worker with new challenge
          const newChallenge = '0x' + Array.from(
            crypto.getRandomValues(new Uint8Array(32))
          ).map(b => b.toString(16).padStart(2, '0')).join('')
          setChallenge(newChallenge)
          worker.postMessage({ type: 'start', challenge: newChallenge, difficulty })
        }
      }

      worker.postMessage({ type: 'start', challenge, difficulty })
      workers.push(worker)
    }

    workersRef.current = workers
    URL.revokeObjectURL(workerUrl)
  }, [isConnected, connect, workerCount, challenge, difficulty, currentReward, addLog])

  const stopMining = useCallback(() => {
    workersRef.current.forEach(w => {
      w.postMessage({ type: 'stop' })
      w.terminate()
    })
    workersRef.current = []
    setIsMining(false)
    setHashrate(0)
    addLog('Mining stopped', 'system')
  }, [addLog])

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      workersRef.current.forEach(w => {
        w.postMessage({ type: 'stop' })
        w.terminate()
      })
    }
  }, [])

  // Format hashrate for display
  const formatHashrate = (h) => {
    if (h >= 1e9) return `${(h / 1e9).toFixed(2)} GH/s`
    if (h >= 1e6) return `${(h / 1e6).toFixed(2)} MH/s`
    if (h >= 1e3) return `${(h / 1e3).toFixed(2)} KH/s`
    return `${Math.round(h)} H/s`
  }

  const uptime = isMining && miningStartRef.current
    ? Math.floor((Date.now() - miningStartRef.current) / 1000)
    : 0

  const formatUptime = (s) => {
    const h = Math.floor(s / 3600)
    const m = Math.floor((s % 3600) / 60)
    const sec = s % 60
    if (h > 0) return `${h}h ${m}m ${sec}s`
    if (m > 0) return `${m}m ${sec}s`
    return `${sec}s`
  }

  // Force re-render every second for uptime counter
  const [, setTick] = useState(0)
  useEffect(() => {
    if (!isMining) return
    const interval = setInterval(() => setTick(t => t + 1), 1000)
    return () => clearInterval(interval)
  }, [isMining])

  if (!isConnected) {
    return (
      <div className="max-w-4xl mx-auto px-4 py-20">
        <GlassCard className="max-w-md mx-auto p-8 text-center">
          <div className="w-20 h-20 mx-auto mb-6 rounded-full bg-amber-500/20 flex items-center justify-center">
            <svg className="w-10 h-10 text-amber-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M20.25 6.375c0 2.278-3.694 4.125-8.25 4.125S3.75 8.653 3.75 6.375m16.5 0c0-2.278-3.694-4.125-8.25-4.125S3.75 4.097 3.75 6.375m16.5 0v11.25c0 2.278-3.694 4.125-8.25 4.125s-8.25-1.847-8.25-4.125V6.375m16.5 0v3.75m-16.5-3.75v3.75m16.5 0v3.75C20.25 16.153 16.556 18 12 18s-8.25-1.847-8.25-4.125v-3.75m16.5 0c0 2.278-3.694 4.125-8.25 4.125s-8.25-1.847-8.25-4.125" />
            </svg>
          </div>
          <h2 className="text-2xl font-display font-bold mb-3">Mine Joule (JUL)</h2>
          <p className="text-void-400 mb-6 max-w-md mx-auto">
            Mine JUL tokens using SHA-256 proof-of-work directly in your browser.
            Rewards are proportional to difficulty — the harder the work, the greater the reward.
          </p>
          <InteractiveButton variant="primary" onClick={connect} className="px-6 py-3">
            Sign In to Mine
          </InteractiveButton>
        </GlassCard>
      </div>
    )
  }

  return (
    <div className="max-w-6xl mx-auto px-4 pb-8">
      {/* Header */}
      <div className="mb-6">
        <h1 className="text-2xl font-display font-bold">Mine JUL</h1>
        <p className="text-void-400 mt-1">SHA-256 proof-of-work mining — earn Joule tokens</p>
      </div>

      <StaggerContainer>
        {/* Mining Controls */}
        <StaggerItem>
          <GlassCard className="p-6 mb-4">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-3">
                <div className={`w-3 h-3 rounded-full ${isMining ? 'bg-green-400 animate-pulse' : 'bg-void-500'}`} />
                <span className="text-lg font-semibold">
                  {isMining ? 'Mining Active' : 'Miner Idle'}
                </span>
              </div>
              <InteractiveButton
                variant={isMining ? 'danger' : 'primary'}
                onClick={isMining ? stopMining : startMining}
                className="px-6 py-2.5"
              >
                {isMining ? 'Stop Mining' : 'Start Mining'}
              </InteractiveButton>
            </div>

            {/* Thread Count Selector */}
            <div className="flex items-center gap-4 mb-4">
              <span className="text-void-400 text-sm">Threads:</span>
              <div className="flex gap-1">
                {[1, 2, 4, 6, 8].filter(n => n <= (navigator.hardwareConcurrency || 4) * 2).map(n => (
                  <button
                    key={n}
                    onClick={() => !isMining && setWorkerCount(n)}
                    disabled={isMining}
                    className={`px-3 py-1 rounded text-sm font-mono transition-colors ${
                      workerCount === n
                        ? 'bg-amber-500/30 text-amber-300 border border-amber-500/50'
                        : 'bg-void-800/50 text-void-400 border border-void-700/50 hover:text-void-200'
                    } ${isMining ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}`}
                  >
                    {n}
                  </button>
                ))}
              </div>
              <span className="text-void-500 text-xs">
                ({navigator.hardwareConcurrency || '?'} CPU cores detected)
              </span>
            </div>

            {/* Hashrate Bar */}
            {isMining && (
              <motion.div
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: 'auto' }}
                className="mt-4"
              >
                <div className="flex justify-between text-sm mb-1">
                  <span className="text-void-400">Hashrate</span>
                  <span className="text-amber-300 font-mono">{formatHashrate(hashrate)}</span>
                </div>
                <div className="w-full h-2 bg-void-800 rounded-full overflow-hidden">
                  <motion.div
                    className="h-full bg-gradient-to-r from-amber-500 to-orange-500 rounded-full"
                    animate={{ width: `${Math.min((hashrate / 10000) * 100, 100)}%` }}
                    transition={{ duration: 0.5 }}
                  />
                </div>
              </motion.div>
            )}
          </GlassCard>
        </StaggerItem>

        {/* Stats Grid */}
        <StaggerItem>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
            <GlassCard className="p-4 text-center">
              <div className="text-void-400 text-xs mb-1">Uptime</div>
              <div className="text-lg font-mono font-bold">{formatUptime(uptime)}</div>
            </GlassCard>
            <GlassCard className="p-4 text-center">
              <div className="text-void-400 text-xs mb-1">Blocks Found</div>
              <div className="text-lg font-mono font-bold text-green-400">
                <AnimatedNumber value={blocksFound} />
              </div>
            </GlassCard>
            <GlassCard className="p-4 text-center">
              <div className="text-void-400 text-xs mb-1">JUL Earned</div>
              <div className="text-lg font-mono font-bold text-amber-400">
                <AnimatedNumber value={totalReward} decimals={4} />
              </div>
            </GlassCard>
            <GlassCard className="p-4 text-center">
              <div className="text-void-400 text-xs mb-1">Total Hashes</div>
              <div className="text-lg font-mono font-bold">
                {totalHashes >= 1e6 ? `${(totalHashes / 1e6).toFixed(1)}M` :
                 totalHashes >= 1e3 ? `${(totalHashes / 1e3).toFixed(1)}K` :
                 totalHashes}
              </div>
            </GlassCard>
          </div>
        </StaggerItem>

        {/* Network Info */}
        <StaggerItem>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-4">
            <GlassCard className="p-5">
              <h3 className="text-sm font-semibold text-void-300 mb-3">Network Stats</h3>
              <div className="space-y-2">
                <div className="flex justify-between">
                  <span className="text-void-400 text-sm">Difficulty</span>
                  <span className="font-mono text-sm">{difficulty.toLocaleString()}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-void-400 text-sm">Block Reward</span>
                  <span className="font-mono text-sm text-amber-400">{currentReward.toFixed(6)} JUL</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-void-400 text-sm">Epoch</span>
                  <span className="font-mono text-sm">{epochNumber}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-void-400 text-sm">Total Blocks Mined</span>
                  <span className="font-mono text-sm">{totalBlocksMined.toLocaleString()}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-void-400 text-sm">Target Block Time</span>
                  <span className="font-mono text-sm">10 minutes</span>
                </div>
              </div>
            </GlassCard>

            <GlassCard className="p-5">
              <h3 className="text-sm font-semibold text-void-300 mb-3">Mining Info</h3>
              <div className="space-y-2">
                <div className="flex justify-between">
                  <span className="text-void-400 text-sm">Algorithm</span>
                  <span className="font-mono text-sm">SHA-256</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-void-400 text-sm">Reward Model</span>
                  <span className="font-mono text-sm">Proportional to Difficulty</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-void-400 text-sm">Supply</span>
                  <span className="font-mono text-sm text-void-300">No cap (elastic rebase)</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-void-400 text-sm">Rebase</span>
                  <span className="font-mono text-sm">AMPL-style elastic</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-void-400 text-sm">Stability</span>
                  <span className="font-mono text-sm">PI Controller + PoW + Rebase</span>
                </div>
              </div>
            </GlassCard>
          </div>
        </StaggerItem>

        {/* Current Challenge */}
        <StaggerItem>
          <GlassCard className="p-5 mb-4">
            <h3 className="text-sm font-semibold text-void-300 mb-3">Current Challenge</h3>
            <div className="bg-void-900/60 rounded-lg p-3 font-mono text-xs text-void-400 break-all select-all">
              {challenge}
            </div>
            <p className="text-void-500 text-xs mt-2">
              Find a nonce where SHA-256(challenge + nonce) meets the difficulty target.
              Compatible with Bitcoin ASICs.
            </p>
          </GlassCard>
        </StaggerItem>

        {/* Mining Log */}
        <StaggerItem>
          <GlassCard className="p-5">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-semibold text-void-300">Mining Log</h3>
              {miningLog.length > 0 && (
                <button
                  onClick={() => setMiningLog([])}
                  className="text-void-500 text-xs hover:text-void-300 transition-colors"
                >
                  Clear
                </button>
              )}
            </div>
            <div className="bg-void-900/60 rounded-lg p-3 max-h-48 overflow-y-auto font-mono text-xs space-y-1">
              {miningLog.length === 0 ? (
                <div className="text-void-600">Waiting for mining activity...</div>
              ) : (
                miningLog.map((entry, i) => (
                  <div key={i} className="flex gap-2">
                    <span className="text-void-600 shrink-0">[{entry.timestamp}]</span>
                    <span className={
                      entry.type === 'success' ? 'text-green-400' :
                      entry.type === 'system' ? 'text-amber-400/70' :
                      'text-void-400'
                    }>
                      {entry.message}
                    </span>
                  </div>
                ))
              )}
            </div>
          </GlassCard>
        </StaggerItem>
      </StaggerContainer>
    </div>
  )
}

export default MinePage
