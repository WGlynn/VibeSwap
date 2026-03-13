import { useState } from 'react'
import { motion } from 'framer-motion'
import GlassCard from './ui/GlassCard'
import PageHero from './ui/PageHero'

// ============ Constants ============

const PHI = 1.618033988749895
const CYAN = '#06b6d4'
const STAGGER_DELAY = 1 / (PHI * PHI * PHI * PHI)

const fadeUp = {
  hidden: { opacity: 0, y: 12 },
  visible: (i = 0) => ({
    opacity: 1,
    y: 0,
    transition: {
      delay: i * STAGGER_DELAY,
      duration: 1 / (PHI * PHI),
      ease: [0.25, 0.1, 1 / PHI, 1],
    },
  }),
}

// ============ Method Badge Colors ============

const METHOD_STYLES = {
  GET: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/25',
  POST: 'bg-amber-500/15 text-amber-400 border-amber-500/25',
  WS: 'bg-purple-500/15 text-purple-400 border-purple-500/25',
}

function MethodBadge({ method }) {
  return (
    <span className={`text-[11px] font-mono font-bold px-2.5 py-0.5 rounded border ${METHOD_STYLES[method] || METHOD_STYLES.GET}`}>
      {method}
    </span>
  )
}

// ============ Code Block Component ============

function CodeBlock({ children, title }) {
  const [copied, setCopied] = useState(false)

  const handleCopy = () => {
    navigator.clipboard.writeText(
      typeof children === 'string' ? children : ''
    )
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <div className="mt-3 rounded-lg overflow-hidden border border-zinc-800/60">
      {title && (
        <div className="flex items-center justify-between px-4 py-2 bg-zinc-900/80 border-b border-zinc-800/40">
          <span className="text-[10px] font-mono text-zinc-500 uppercase tracking-wider">{title}</span>
          <button
            onClick={handleCopy}
            className="text-[10px] font-mono text-zinc-600 hover:text-zinc-400 transition-colors"
          >
            {copied ? 'Copied' : 'Copy'}
          </button>
        </div>
      )}
      <pre className="p-4 bg-zinc-950/80 overflow-x-auto text-[12px] leading-relaxed font-mono">
        {children}
      </pre>
    </div>
  )
}

// ============ Syntax-Colored JSON Renderer ============

function JsonSyntax({ json }) {
  const lines = JSON.stringify(json, null, 2).split('\n')

  return lines.map((line, i) => {
    const parts = []
    let remaining = line

    // Match key-value patterns
    const keyMatch = remaining.match(/^(\s*)"([^"]+)"(:)/)
    if (keyMatch) {
      parts.push(<span key={`indent-${i}`}>{keyMatch[1]}</span>)
      parts.push(<span key={`key-${i}`} style={{ color: CYAN }}>"{keyMatch[2]}"</span>)
      parts.push(<span key={`colon-${i}`} className="text-zinc-500">{keyMatch[3]}</span>)
      remaining = remaining.slice(keyMatch[0].length)
    }

    // Match string values
    const strMatch = remaining.match(/^(\s*)"([^"]*)"(.*)/)
    if (strMatch) {
      parts.push(<span key={`sp-${i}`}>{strMatch[1]}</span>)
      parts.push(<span key={`str-${i}`} className="text-green-400">"{strMatch[2]}"</span>)
      parts.push(<span key={`rest-${i}`} className="text-zinc-500">{strMatch[3]}</span>)
    } else {
      // Numbers, booleans, brackets
      const numMatch = remaining.match(/(\s*)([\d.]+)(.*)/)
      if (numMatch) {
        parts.push(<span key={`sp2-${i}`}>{numMatch[1]}</span>)
        parts.push(<span key={`num-${i}`} className="text-amber-300">{numMatch[2]}</span>)
        parts.push(<span key={`rest2-${i}`} className="text-zinc-500">{numMatch[3]}</span>)
      } else {
        parts.push(<span key={`raw-${i}`} className="text-zinc-500">{remaining}</span>)
      }
    }

    return (
      <span key={i}>
        {parts}
        {i < lines.length - 1 ? '\n' : ''}
      </span>
    )
  })
}

// ============ REST Endpoints Data ============

const REST_ENDPOINTS = [
  {
    method: 'GET',
    path: '/api/v1/pairs',
    description: 'List all available trading pairs with current metadata, 24h volume, and liquidity depth.',
    response: {
      pairs: [
        {
          id: "eth-usdc",
          base: "ETH",
          quote: "USDC",
          price: "3245.67",
          volume_24h: "12450000.00",
          liquidity: "89000000.00",
          fee_tier: "0.003"
        }
      ],
      count: 42,
      timestamp: 1710288000
    },
  },
  {
    method: 'GET',
    path: '/api/v1/pair/:id/price',
    description: 'Current mid-market price for a trading pair. Derived from the Kalman-filtered oracle feed, not the AMM spot price.',
    response: {
      pair: "eth-usdc",
      price: "3245.67",
      oracle_price: "3244.92",
      spread: "0.023",
      confidence: "0.997",
      timestamp: 1710288042
    },
  },
  {
    method: 'GET',
    path: '/api/v1/pair/:id/ohlcv',
    description: 'OHLCV candle data for charting. Supports 1m, 5m, 15m, 1h, 4h, 1d intervals. Query params: interval, from, to, limit.',
    response: {
      pair: "eth-usdc",
      interval: "1h",
      candles: [
        {
          t: 1710284400,
          o: "3240.10",
          h: "3258.44",
          l: "3235.02",
          c: "3245.67",
          v: "518200.00"
        }
      ]
    },
  },
  {
    method: 'POST',
    path: '/api/v1/batch/commit',
    description: 'Submit a commit hash for the current batch auction. The hash is keccak256(order || secret). Requires a valid deposit.',
    response: {
      batch_id: "batch-0x7a3f",
      commit_hash: "0xabc123...def456",
      phase: "commit",
      expires_in: 6,
      deposit_required: "0.01",
      status: "accepted"
    },
  },
  {
    method: 'POST',
    path: '/api/v1/batch/reveal',
    description: 'Reveal your order and secret for a previously committed batch. Must be submitted during the 2-second reveal window.',
    response: {
      batch_id: "batch-0x7a3f",
      reveal_status: "valid",
      order: {
        side: "buy",
        amount: "1.5",
        pair: "eth-usdc"
      },
      position_in_queue: 12,
      settlement_eta: 2
    },
  },
  {
    method: 'GET',
    path: '/api/v1/batch/:id',
    description: 'Get the status of a specific batch auction. Returns phase, participant count, and settlement results if completed.',
    response: {
      batch_id: "batch-0x7a3f",
      phase: "settled",
      participants: 47,
      clearing_price: "3244.50",
      total_volume: "892340.00",
      settlement_tx: "0xdef789...abc012",
      settled_at: 1710288050
    },
  },
  {
    method: 'GET',
    path: '/api/v1/pool/:id',
    description: 'Detailed information about a liquidity pool including reserves, APR, fee earnings, and impermanent loss metrics.',
    response: {
      pool_id: "eth-usdc-001",
      token_a: { symbol: "ETH", reserve: "14520.45" },
      token_b: { symbol: "USDC", reserve: "47125000.00" },
      tvl: "94250000.00",
      apr: "12.45",
      fee_apr: "8.20",
      reward_apr: "4.25",
      il_protection: true
    },
  },
  {
    method: 'GET',
    path: '/api/v1/portfolio/:address',
    description: 'Full portfolio summary for a wallet address. Includes token balances, LP positions, pending rewards, and historical PnL.',
    response: {
      address: "0x742d35Cc6634C0532925a3b844Bc9e7595f2bD18",
      total_value_usd: "125430.67",
      tokens: [
        { symbol: "ETH", balance: "32.5", value_usd: "105484.25" }
      ],
      lp_positions: 3,
      pending_rewards: "1245.30",
      pnl_30d: "+8.42"
    },
  },
  {
    method: 'GET',
    path: '/api/v1/gas',
    description: 'Current gas estimates for common VibeSwap operations across all supported chains. Updated every block.',
    response: {
      chain: "ethereum",
      block: 19420150,
      estimates: {
        commit: { gas: 85000, cost_usd: "4.25" },
        reveal: { gas: 120000, cost_usd: "6.00" },
        add_liquidity: { gas: 180000, cost_usd: "9.00" },
        remove_liquidity: { gas: 150000, cost_usd: "7.50" }
      },
      base_fee_gwei: "25.4",
      priority_fee_gwei: "1.2"
    },
  },
  {
    method: 'GET',
    path: '/api/v1/oracle/price',
    description: 'Kalman-filtered oracle price feed. Returns the true price estimate, confidence interval, and raw source prices used in the filter.',
    response: {
      pair: "eth-usdc",
      kalman_price: "3244.92",
      confidence_interval: ["3242.10", "3247.74"],
      sources: {
        chainlink: "3245.00",
        uniswap_twap: "3244.80",
        pyth: "3244.96"
      },
      filter_gain: "0.034",
      last_updated: 1710288040
    },
  },
]

// ============ WebSocket Feeds Data ============

const WS_FEEDS = [
  {
    name: 'Price Feed',
    description: 'Real-time price updates for any trading pair. Pushes on every oracle update (approximately every 2 seconds).',
    subscribe: {
      type: "subscribe",
      channel: "price",
      pair: "eth-usdc"
    },
    message: {
      type: "price_update",
      pair: "eth-usdc",
      price: "3245.67",
      change_24h: "-1.23",
      volume_24h: "12450000.00",
      timestamp: 1710288042
    },
  },
  {
    name: 'Batch Feed',
    description: 'Live batch auction lifecycle events. Receive phase transitions, commit counts, and settlement notifications.',
    subscribe: {
      type: "subscribe",
      channel: "batch",
      pair: "eth-usdc"
    },
    message: {
      type: "batch_event",
      batch_id: "batch-0x7a3f",
      event: "phase_change",
      from: "commit",
      to: "reveal",
      commits: 47,
      time_remaining: 2,
      timestamp: 1710288048
    },
  },
  {
    name: 'Orderbook Feed',
    description: 'Aggregated orderbook depth updates. Shows demand distribution without revealing individual orders (preserving commit-reveal privacy).',
    subscribe: {
      type: "subscribe",
      channel: "orderbook",
      pair: "eth-usdc",
      depth: 20
    },
    message: {
      type: "orderbook_snapshot",
      pair: "eth-usdc",
      bids: [
        { price: "3244.00", depth: "45.2" },
        { price: "3243.00", depth: "120.8" }
      ],
      asks: [
        { price: "3246.00", depth: "38.7" },
        { price: "3247.00", depth: "95.3" }
      ],
      spread: "2.00",
      timestamp: 1710288042
    },
  },
]

// ============ SDK Code Example ============

const SDK_INSTALL = 'npm install vibeswap-sdk'

const SDK_USAGE = `import { VibeSwap } from 'vibeswap-sdk'

// Initialize client
const vibe = new VibeSwap({
  apiKey: 'your-api-key',
  network: 'ethereum',
  rpcUrl: 'https://eth.llamarpc.com'
})

// Get current price
const price = await vibe.getPrice('eth-usdc')
console.log(price.kalman_price) // "3244.92"

// Submit a batch commit
const secret = vibe.generateSecret()
const commit = await vibe.batchCommit({
  pair: 'eth-usdc',
  side: 'buy',
  amount: '1.5',
  secret,
  deposit: '0.01'
})

// Reveal during reveal phase
const reveal = await vibe.batchReveal({
  batchId: commit.batch_id,
  secret
})

// Listen to price updates via WebSocket
vibe.ws.subscribe('price', 'eth-usdc', (update) => {
  console.log(\`Price: \${update.price}\`)
})

// Provide liquidity
const lp = await vibe.addLiquidity({
  pair: 'eth-usdc',
  amountA: '10',
  amountB: '32450',
  slippage: 0.005
})`

// ============ Sidebar Categories ============

const SIDEBAR_TABS = [
  { id: 'rest', label: 'REST API', icon: 'M6.75 7.5l3 2.25-3 2.25m4.5 0h3m-9 8.25h13.5A2.25 2.25 0 0021 18V6a2.25 2.25 0 00-2.25-2.25H5.25A2.25 2.25 0 003 6v12a2.25 2.25 0 002.25 2.25z' },
  { id: 'websocket', label: 'WebSocket', icon: 'M7.5 21L3 16.5m0 0L7.5 12M3 16.5h13.5m0-13.5L21 7.5m0 0L16.5 12M21 7.5H7.5' },
  { id: 'sdk', label: 'SDK', icon: 'M21 7.5l-2.25-1.313M21 7.5v2.25m0-2.25l-2.25 1.313M3 7.5l2.25-1.313M3 7.5l2.25 1.313M3 7.5v2.25m9 3l2.25-1.313M12 12.75l-2.25-1.313M12 12.75V15m0 6.75l2.25-1.313M12 21.75V19.5m0 2.25l-2.25-1.313m0-16.875L12 2.25l2.25 1.313M21 14.25v2.25l-2.25 1.313m-13.5 0L3 16.5v-2.25' },
]

// ============ Sub-Components ============

function Sidebar({ activeTab, onTabChange }) {
  return (
    <div className="flex flex-col gap-1">
      {SIDEBAR_TABS.map((tab) => {
        const isActive = activeTab === tab.id
        return (
          <button
            key={tab.id}
            onClick={() => onTabChange(tab.id)}
            className={`flex items-center gap-3 px-4 py-3 rounded-xl text-left text-sm font-mono transition-all duration-200 ${
              isActive
                ? 'bg-cyan-500/10 text-cyan-400 border border-cyan-500/20'
                : 'text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800/40 border border-transparent'
            }`}
          >
            <svg className="w-4 h-4 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d={tab.icon} />
            </svg>
            {tab.label}
          </button>
        )
      })}
    </div>
  )
}

function EndpointCard({ endpoint, index }) {
  const [expanded, setExpanded] = useState(false)

  return (
    <motion.div
      variants={fadeUp}
      initial="hidden"
      animate="visible"
      custom={index}
    >
      <GlassCard className="overflow-visible">
        <button
          onClick={() => setExpanded(!expanded)}
          className="w-full flex items-start gap-3 p-5 text-left group"
        >
          <MethodBadge method={endpoint.method} />
          <div className="flex-1 min-w-0">
            <div className="font-mono text-sm text-zinc-200 group-hover:text-white transition-colors truncate">
              {endpoint.path}
            </div>
            <p className="text-xs text-zinc-500 mt-1.5 leading-relaxed">
              {endpoint.description}
            </p>
          </div>
          <motion.div
            animate={{ rotate: expanded ? 180 : 0 }}
            transition={{ duration: 1 / (PHI * PHI * PHI * PHI), ease: [0.25, 0.1, 1 / PHI, 1] }}
            className="flex-shrink-0 mt-1"
          >
            <svg className="w-4 h-4 text-zinc-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 8.25l-7.5 7.5-7.5-7.5" />
            </svg>
          </motion.div>
        </button>

        {expanded && (
          <div className="px-5 pb-5 pt-0">
            <div className="border-t border-zinc-800/60 pt-3">
              <CodeBlock title="Response">
                <JsonSyntax json={endpoint.response} />
              </CodeBlock>
            </div>
          </div>
        )}
      </GlassCard>
    </motion.div>
  )
}

function WebSocketFeedCard({ feed, index }) {
  const [expanded, setExpanded] = useState(false)

  return (
    <motion.div
      variants={fadeUp}
      initial="hidden"
      animate="visible"
      custom={index}
    >
      <GlassCard className="overflow-visible">
        <button
          onClick={() => setExpanded(!expanded)}
          className="w-full flex items-start gap-3 p-5 text-left group"
        >
          <MethodBadge method="WS" />
          <div className="flex-1 min-w-0">
            <div className="font-mono text-sm text-zinc-200 group-hover:text-white transition-colors">
              {feed.name}
            </div>
            <p className="text-xs text-zinc-500 mt-1.5 leading-relaxed">
              {feed.description}
            </p>
          </div>
          <motion.div
            animate={{ rotate: expanded ? 180 : 0 }}
            transition={{ duration: 1 / (PHI * PHI * PHI * PHI), ease: [0.25, 0.1, 1 / PHI, 1] }}
            className="flex-shrink-0 mt-1"
          >
            <svg className="w-4 h-4 text-zinc-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 8.25l-7.5 7.5-7.5-7.5" />
            </svg>
          </motion.div>
        </button>

        {expanded && (
          <div className="px-5 pb-5 pt-0">
            <div className="border-t border-zinc-800/60 pt-3 space-y-3">
              <CodeBlock title="Subscribe">
                <JsonSyntax json={feed.subscribe} />
              </CodeBlock>
              <CodeBlock title="Message">
                <JsonSyntax json={feed.message} />
              </CodeBlock>
            </div>
          </div>
        )}
      </GlassCard>
    </motion.div>
  )
}

function AuthenticationSection() {
  return (
    <motion.div
      variants={fadeUp}
      initial="hidden"
      animate="visible"
      custom={0}
    >
      <GlassCard glowColor="terminal" spotlight className="p-6">
        <div className="flex items-start gap-4">
          <div className="flex-shrink-0 w-8 h-8 rounded-lg bg-cyan-500/10 border border-cyan-500/20 flex items-center justify-center">
            <svg className="w-4 h-4 text-cyan-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 5.25a3 3 0 013 3m3 0a6 6 0 01-7.029 5.912c-.563-.097-1.159.026-1.563.43L10.5 17.25H8.25v2.25H6v2.25H2.25v-2.818c0-.597.237-1.17.659-1.591l6.499-6.499c.404-.404.527-1 .43-1.563A6 6 0 1121.75 8.25z" />
            </svg>
          </div>
          <div className="flex-1">
            <h3 className="text-sm font-semibold text-zinc-100 mb-2">Authentication</h3>
            <p className="text-xs text-zinc-400 leading-relaxed mb-4">
              All API requests require an API key passed via the <span className="font-mono text-cyan-400">X-API-Key</span> header.
              Keys are free to generate from your dashboard. WebSocket connections authenticate on the initial handshake.
            </p>
            <CodeBlock title="Header">
              <span style={{ color: CYAN }}>X-API-Key</span><span className="text-zinc-500">: </span><span className="text-green-400">vibe_sk_live_a1b2c3d4e5f6...</span>
            </CodeBlock>
            <div className="mt-4 flex flex-wrap gap-4">
              <div className="flex items-center gap-2">
                <div className="w-1.5 h-1.5 rounded-full bg-amber-400" />
                <span className="text-[11px] font-mono text-zinc-500">
                  Rate limit: <span className="text-zinc-300">100 req/min</span>
                </span>
              </div>
              <div className="flex items-center gap-2">
                <div className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
                <span className="text-[11px] font-mono text-zinc-500">
                  WebSocket: <span className="text-zinc-300">5 connections/key</span>
                </span>
              </div>
              <div className="flex items-center gap-2">
                <div className="w-1.5 h-1.5 rounded-full bg-red-400" />
                <span className="text-[11px] font-mono text-zinc-500">
                  Burst: <span className="text-zinc-300">10 req/sec max</span>
                </span>
              </div>
            </div>
          </div>
        </div>
      </GlassCard>
    </motion.div>
  )
}

function SDKSection() {
  return (
    <div className="space-y-4">
      <motion.div
        variants={fadeUp}
        initial="hidden"
        animate="visible"
        custom={0}
      >
        <GlassCard glowColor="terminal" spotlight className="p-6">
          <div className="flex items-start gap-4">
            <div className="flex-shrink-0 w-8 h-8 rounded-lg bg-cyan-500/10 border border-cyan-500/20 flex items-center justify-center">
              <svg className="w-4 h-4 text-cyan-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M21 7.5l-2.25-1.313M21 7.5v2.25m0-2.25l-2.25 1.313M3 7.5l2.25-1.313M3 7.5l2.25 1.313M3 7.5v2.25m9 3l2.25-1.313M12 12.75l-2.25-1.313M12 12.75V15m0 6.75l2.25-1.313M12 21.75V19.5m0 2.25l-2.25-1.313m0-16.875L12 2.25l2.25 1.313M21 14.25v2.25l-2.25 1.313m-13.5 0L3 16.5v-2.25" />
              </svg>
            </div>
            <div className="flex-1">
              <h3 className="text-sm font-semibold text-zinc-100 mb-1">Installation</h3>
              <p className="text-xs text-zinc-400 leading-relaxed mb-3">
                The official VibeSwap SDK for JavaScript and TypeScript. Supports Node.js 18+ and modern browsers.
              </p>
              <CodeBlock title="Terminal">
                <span className="text-zinc-500">$ </span><span className="text-green-400">{SDK_INSTALL}</span>
              </CodeBlock>
            </div>
          </div>
        </GlassCard>
      </motion.div>

      <motion.div
        variants={fadeUp}
        initial="hidden"
        animate="visible"
        custom={1}
      >
        <GlassCard className="p-6">
          <h3 className="text-sm font-semibold text-zinc-100 mb-1">Usage Example</h3>
          <p className="text-xs text-zinc-400 leading-relaxed mb-3">
            Complete workflow: initialize the client, fetch prices, submit a batch commit-reveal swap, subscribe to live updates, and provide liquidity.
          </p>
          <CodeBlock title="JavaScript">
            {SDK_USAGE.split('\n').map((line, i) => {
              const parts = []
              let rest = line

              // Comments
              if (rest.trimStart().startsWith('//')) {
                return (
                  <span key={i}>
                    <span className="text-zinc-600">{rest}</span>
                    {i < SDK_USAGE.split('\n').length - 1 ? '\n' : ''}
                  </span>
                )
              }

              // Keywords
              const keywords = ['import', 'from', 'const', 'await', 'new', 'async', 'console']
              keywords.forEach((kw) => {
                const regex = new RegExp(`\\b${kw}\\b`, 'g')
                rest = rest // keywords handled in render
              })

              // Render line with basic coloring
              const colored = rest
                .replace(/(import|from|const|await|new|async)\b/g, '\x01$1\x02')
                .replace(/'([^']*)'/g, '\x03$1\x04')
                .replace(/"([^"]*)"/g, '\x03$1\x04')
                .replace(/`([^`]*)`/g, '\x03$1\x04')
                .replace(/(console)\.(log)/g, '\x05$1\x06.\x05$2\x06')

              const tokens = colored.split(/(\x01[^\x02]*\x02|\x03[^\x04]*\x04|\x05[^\x06]*\x06)/g)

              tokens.forEach((token, j) => {
                if (token.startsWith('\x01')) {
                  parts.push(<span key={`${i}-${j}`} className="text-purple-400">{token.slice(1, -1)}</span>)
                } else if (token.startsWith('\x03')) {
                  parts.push(<span key={`${i}-${j}`} className="text-green-400">'{token.slice(1, -1)}'</span>)
                } else if (token.startsWith('\x05')) {
                  parts.push(<span key={`${i}-${j}`} style={{ color: CYAN }}>{token.slice(1, -1)}</span>)
                } else {
                  parts.push(<span key={`${i}-${j}`} className="text-zinc-300">{token}</span>)
                }
              })

              return (
                <span key={i}>
                  {parts}
                  {i < SDK_USAGE.split('\n').length - 1 ? '\n' : ''}
                </span>
              )
            })}
          </CodeBlock>
        </GlassCard>
      </motion.div>

      <motion.div
        variants={fadeUp}
        initial="hidden"
        animate="visible"
        custom={2}
      >
        <GlassCard className="p-6">
          <h3 className="text-sm font-semibold text-zinc-100 mb-3">SDK Methods</h3>
          <div className="space-y-2">
            {[
              { method: 'getPrice(pair)', returns: 'PriceResponse', desc: 'Kalman-filtered oracle price' },
              { method: 'getPairs()', returns: 'PairInfo[]', desc: 'All available trading pairs' },
              { method: 'batchCommit(params)', returns: 'CommitResponse', desc: 'Submit a batch commit hash' },
              { method: 'batchReveal(params)', returns: 'RevealResponse', desc: 'Reveal order during reveal phase' },
              { method: 'getBatch(id)', returns: 'BatchStatus', desc: 'Query batch auction status' },
              { method: 'getPool(id)', returns: 'PoolInfo', desc: 'Pool reserves, APR, and metrics' },
              { method: 'addLiquidity(params)', returns: 'LPReceipt', desc: 'Provide liquidity to a pool' },
              { method: 'removeLiquidity(params)', returns: 'WithdrawReceipt', desc: 'Withdraw liquidity from a pool' },
              { method: 'getPortfolio(address)', returns: 'Portfolio', desc: 'Full portfolio summary' },
              { method: 'ws.subscribe(channel, pair, cb)', returns: 'Unsubscribe', desc: 'Subscribe to WebSocket feed' },
            ].map((item, i) => (
              <div
                key={i}
                className="flex items-center justify-between py-2.5 px-3 -mx-3 rounded-lg hover:bg-zinc-800/40 transition-colors group"
              >
                <div className="flex items-center gap-3 min-w-0">
                  <span className="font-mono text-xs text-cyan-400 flex-shrink-0">{item.method}</span>
                  <span className="text-[11px] text-zinc-600 hidden sm:inline truncate">{item.desc}</span>
                </div>
                <span className="font-mono text-[10px] text-zinc-600 flex-shrink-0 ml-2">
                  {item.returns}
                </span>
              </div>
            ))}
          </div>
        </GlassCard>
      </motion.div>
    </div>
  )
}

// ============ Base URL Banner ============

function BaseURLBanner() {
  return (
    <motion.div
      variants={fadeUp}
      initial="hidden"
      animate="visible"
      custom={0}
      className="mb-6"
    >
      <div className="flex items-center gap-3 px-4 py-3 rounded-xl bg-zinc-900/40 border border-zinc-800/40">
        <div className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
        <span className="text-[11px] font-mono text-zinc-500">Base URL</span>
        <code className="text-[12px] font-mono text-cyan-400">https://api.vibeswap.io/v1</code>
      </div>
    </motion.div>
  )
}

// ============ Main Component ============

function APIDocsPage() {
  const [activeTab, setActiveTab] = useState('rest')

  return (
    <div className="min-h-screen pb-20">
      {/* ============ Hero ============ */}
      <PageHero
        category="intelligence"
        title="API Documentation"
        subtitle="REST, WebSocket, and SDK reference for building on VibeSwap"
        badge="v1.0"
        badgeColor={CYAN}
      />

      <div className="max-w-6xl mx-auto px-4">
        <div className="flex flex-col lg:flex-row gap-8">
          {/* ============ Sidebar ============ */}
          <motion.div
            variants={fadeUp}
            initial="hidden"
            animate="visible"
            custom={0}
            className="lg:w-52 flex-shrink-0"
          >
            <div className="lg:sticky lg:top-6">
              <div className="text-[10px] font-mono uppercase tracking-wider text-zinc-600 mb-3 px-4">
                Endpoints
              </div>
              <Sidebar activeTab={activeTab} onTabChange={setActiveTab} />

              {/* Quick stats */}
              <div className="mt-6 px-4 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-[10px] font-mono text-zinc-600">Endpoints</span>
                  <span className="text-[10px] font-mono text-zinc-400">10</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-[10px] font-mono text-zinc-600">WS Feeds</span>
                  <span className="text-[10px] font-mono text-zinc-400">3</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-[10px] font-mono text-zinc-600">Rate Limit</span>
                  <span className="text-[10px] font-mono text-zinc-400">100/min</span>
                </div>
              </div>
            </div>
          </motion.div>

          {/* ============ Main Content ============ */}
          <div className="flex-1 min-w-0">
            {/* ============ Authentication (always visible) ============ */}
            <div className="mb-8">
              <div className="flex items-center gap-2 mb-4">
                <div className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: CYAN }} />
                <h2 className="text-lg font-semibold text-zinc-100 tracking-tight">Authentication</h2>
              </div>
              <AuthenticationSection />
            </div>

            {/* ============ REST Tab ============ */}
            {activeTab === 'rest' && (
              <div>
                <div className="flex items-center gap-2 mb-4">
                  <div className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
                  <h2 className="text-lg font-semibold text-zinc-100 tracking-tight">REST Endpoints</h2>
                  <span className="text-[10px] font-mono text-zinc-600 ml-2">10 endpoints</span>
                </div>
                <BaseURLBanner />
                <div className="space-y-3">
                  {REST_ENDPOINTS.map((endpoint, i) => (
                    <EndpointCard key={endpoint.path} endpoint={endpoint} index={i} />
                  ))}
                </div>
              </div>
            )}

            {/* ============ WebSocket Tab ============ */}
            {activeTab === 'websocket' && (
              <div>
                <div className="flex items-center gap-2 mb-4">
                  <div className="w-1.5 h-1.5 rounded-full bg-purple-400" />
                  <h2 className="text-lg font-semibold text-zinc-100 tracking-tight">WebSocket Feeds</h2>
                  <span className="text-[10px] font-mono text-zinc-600 ml-2">3 feeds</span>
                </div>
                <motion.div
                  variants={fadeUp}
                  initial="hidden"
                  animate="visible"
                  custom={0}
                  className="mb-6"
                >
                  <div className="flex items-center gap-3 px-4 py-3 rounded-xl bg-zinc-900/40 border border-zinc-800/40">
                    <div className="w-1.5 h-1.5 rounded-full bg-purple-400 animate-pulse" />
                    <span className="text-[11px] font-mono text-zinc-500">Endpoint</span>
                    <code className="text-[12px] font-mono text-purple-400">wss://ws.vibeswap.io/v1</code>
                  </div>
                </motion.div>
                <div className="space-y-3">
                  {WS_FEEDS.map((feed, i) => (
                    <WebSocketFeedCard key={feed.name} feed={feed} index={i + 1} />
                  ))}
                </div>
              </div>
            )}

            {/* ============ SDK Tab ============ */}
            {activeTab === 'sdk' && (
              <div>
                <div className="flex items-center gap-2 mb-4">
                  <div className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: CYAN }} />
                  <h2 className="text-lg font-semibold text-zinc-100 tracking-tight">SDK Reference</h2>
                  <span className="text-[10px] font-mono text-zinc-600 ml-2">vibeswap-sdk</span>
                </div>
                <SDKSection />
              </div>
            )}
          </div>
        </div>

        {/* ============ Footer ============ */}
        <motion.div
          variants={fadeUp}
          initial="hidden"
          animate="visible"
          custom={12}
          className="text-center border-t border-zinc-800/40 pt-8 mt-16"
        >
          <p className="text-xs text-zinc-600 font-mono tracking-wide">
            Need help? Reach out on Telegram or open a GitHub issue.
          </p>
          <div className="flex items-center justify-center gap-4 mt-4">
            <a
              href="https://github.com/wglynn/vibeswap"
              target="_blank"
              rel="noopener noreferrer"
              className="text-[11px] font-mono text-zinc-600 hover:text-zinc-400 transition-colors"
            >
              GitHub
            </a>
            <span className="text-zinc-800">|</span>
            <a
              href="https://t.me/+3uHbNxyZH-tiOGY8"
              target="_blank"
              rel="noopener noreferrer"
              className="text-[11px] font-mono text-zinc-600 hover:text-zinc-400 transition-colors"
            >
              Telegram
            </a>
            <span className="text-zinc-800">|</span>
            <span className="text-[11px] font-mono text-zinc-700">
              API v1.0
            </span>
          </div>
        </motion.div>
      </div>
    </div>
  )
}

export default APIDocsPage
