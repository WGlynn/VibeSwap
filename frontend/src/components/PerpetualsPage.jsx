import { useState } from 'react'
import { motion } from 'framer-motion'
import { useWallet } from '../hooks/useWallet'
import { useDeviceWallet } from '../hooks/useDeviceWallet'
import { usePriceFeed } from '../hooks/usePriceFeed'

// ============================================================
// Perpetuals Page — Perpetual futures with virtual AMM
// Prices from real CoinGecko feed. OI/Volume show -- until live.
// ============================================================

function usePerpMarkets() {
  const { getPrice, getChange } = usePriceFeed(['ETH', 'BTC', 'SOL', 'JUL'])

  const formatPrice = (p) => {
    if (!p) return '--'
    return p >= 1000
      ? `$${p.toLocaleString('en-US', { maximumFractionDigits: 2 })}`
      : `$${p.toFixed(2)}`
  }

  const formatChange = (c) => {
    if (c === undefined || c === null) return '--'
    return `${c >= 0 ? '+' : ''}${c.toFixed(1)}%`
  }

  return [
    { pair: 'ETH/USD',  price: formatPrice(getPrice('ETH')),  change: formatChange(getChange('ETH')),  funding: '--', oi: '--', volume24h: '--', positive: (getChange('ETH') || 0) >= 0 },
    { pair: 'BTC/USD',  price: formatPrice(getPrice('BTC')),  change: formatChange(getChange('BTC')),  funding: '--', oi: '--', volume24h: '--', positive: (getChange('BTC') || 0) >= 0 },
    { pair: 'SOL/USD',  price: formatPrice(getPrice('SOL')),  change: formatChange(getChange('SOL')),  funding: '--', oi: '--', volume24h: '--', positive: (getChange('SOL') || 0) >= 0 },
    { pair: 'JUL/USD',  price: formatPrice(getPrice('JUL')),  change: formatChange(getChange('JUL')),  funding: '--', oi: '--', volume24h: '--', positive: (getChange('JUL') || 0) >= 0 },
  ]
}

const MARKETS_DATA_FALLBACK = [] // Empty — populated by hook

const LEVERAGE_OPTIONS = [1, 2, 5, 10, 20]

export default function PerpetualsPage() {
  const { isConnected: isExternalConnected } = useWallet()
  const { isConnected: isDeviceConnected } = useDeviceWallet()
  const isConnected = isExternalConnected || isDeviceConnected
  const MARKETS_DATA = usePerpMarkets()
  const [selectedMarket, setSelectedMarket] = useState(0)
  const [side, setSide] = useState('long')
  const [leverage, setLeverage] = useState(5)
  const [amount, setAmount] = useState('')

  const market = MARKETS_DATA[selectedMarket]

  return (
    <div className="max-w-4xl mx-auto px-4 py-6">
      <div className="text-center mb-6">
        <h1 className="text-3xl sm:text-4xl font-bold text-white font-display text-5d">
          <span className="text-matrix-500">Perp</span>etuals
        </h1>
        <p className="text-black-400 text-sm mt-2">
          Trade perpetual futures with up to 20x leverage. PID-controlled funding rates.
        </p>
      </div>

      {/* Market selector */}
      <div className="flex gap-2 mb-6 overflow-x-auto pb-2">
        {MARKETS_DATA.map((m, i) => (
          <button
            key={m.pair}
            onClick={() => setSelectedMarket(i)}
            className={`shrink-0 px-4 py-3 rounded-xl border transition-all ${
              selectedMarket === i
                ? 'border-matrix-600 bg-matrix-900/10'
                : 'border-black-700 hover:border-black-600 bg-black-800/60'
            }`}
          >
            <div className="text-white font-bold text-sm">{m.pair}</div>
            <div className="flex items-center gap-2 mt-1">
              <span className="text-xs font-mono text-black-300">{m.price}</span>
              <span className={`text-[10px] font-mono ${m.positive ? 'text-matrix-400' : 'text-red-400'}`}>
                {m.change}
              </span>
            </div>
          </button>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Trading panel */}
        <div className="lg:col-span-1 bg-black-800/60 border border-black-700 rounded-xl p-5">
          <h2 className="text-white font-bold mb-4">{market.pair}</h2>

          {/* Long/Short toggle */}
          <div className="flex gap-1 p-1 bg-black-900/60 rounded-lg mb-4">
            <button
              onClick={() => setSide('long')}
              className={`flex-1 py-2 text-sm font-bold rounded-md transition-colors ${
                side === 'long' ? 'bg-matrix-600 text-black-900' : 'text-black-400'
              }`}
            >
              LONG
            </button>
            <button
              onClick={() => setSide('short')}
              className={`flex-1 py-2 text-sm font-bold rounded-md transition-colors ${
                side === 'short' ? 'bg-red-500 text-white' : 'text-black-400'
              }`}
            >
              SHORT
            </button>
          </div>

          {/* Leverage */}
          <div className="mb-4">
            <div className="text-xs text-black-400 mb-2">Leverage</div>
            <div className="flex gap-1">
              {LEVERAGE_OPTIONS.map((l) => (
                <button
                  key={l}
                  onClick={() => setLeverage(l)}
                  className={`flex-1 py-2 text-xs font-mono rounded-lg border transition-colors ${
                    leverage === l
                      ? 'border-matrix-600 bg-matrix-900/20 text-matrix-400 font-bold'
                      : 'border-black-700 text-black-400 hover:border-black-600'
                  }`}
                >
                  {l}x
                </button>
              ))}
            </div>
          </div>

          {/* Amount input */}
          <div className="mb-4">
            <div className="text-xs text-black-400 mb-2">Collateral (ETH)</div>
            <input
              type="number"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="0.0"
              className="w-full bg-black-900/60 border border-black-700 rounded-lg px-4 py-3 text-white font-mono placeholder-black-500 focus:border-matrix-600 focus:outline-none"
            />
          </div>

          {/* Position size */}
          {amount && (
            <div className="mb-4 p-3 bg-black-900/40 rounded-lg space-y-1">
              <div className="flex justify-between text-xs">
                <span className="text-black-400">Position Size</span>
                <span className="text-white font-mono">{(parseFloat(amount) * leverage).toFixed(4)} ETH</span>
              </div>
              <div className="flex justify-between text-xs">
                <span className="text-black-400">Liq. Price</span>
                <span className="text-red-400 font-mono">
                  ${side === 'long'
                    ? (parseFloat(market.price.replace(/[$,]/g, '')) * (1 - 0.9 / leverage)).toFixed(2)
                    : (parseFloat(market.price.replace(/[$,]/g, '')) * (1 + 0.9 / leverage)).toFixed(2)
                  }
                </span>
              </div>
              <div className="flex justify-between text-xs">
                <span className="text-black-400">Funding Rate</span>
                <span className="text-black-300 font-mono">{market.funding}/8h</span>
              </div>
            </div>
          )}

          <button
            disabled={!isConnected || !amount}
            className={`w-full py-3 rounded-lg font-bold text-sm transition-colors ${
              side === 'long'
                ? 'bg-matrix-600 hover:bg-matrix-500 text-black-900'
                : 'bg-red-500 hover:bg-red-400 text-white'
            } disabled:bg-black-700 disabled:text-black-500`}
          >
            {side === 'long' ? 'Open Long' : 'Open Short'} {leverage}x
          </button>
        </div>

        {/* Market info */}
        <div className="lg:col-span-2 space-y-4">
          {/* Stats grid */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {[
              { label: 'Price', value: market.price },
              { label: '24h Change', value: market.change, color: market.positive ? 'text-matrix-400' : 'text-red-400' },
              { label: 'Open Interest', value: market.oi },
              { label: '24h Volume', value: market.volume24h },
            ].map((s) => (
              <div key={s.label} className="p-3 bg-black-800/60 border border-black-700 rounded-lg text-center">
                <div className={`font-mono font-bold ${s.color || 'text-white'}`}>{s.value}</div>
                <div className="text-[10px] text-black-500 font-mono">{s.label}</div>
              </div>
            ))}
          </div>

          {/* How it works */}
          <div className="bg-black-800/40 border border-black-700/50 rounded-xl p-4">
            <h3 className="text-sm font-bold text-white mb-2">How Perpetuals Work</h3>
            <div className="space-y-1 text-xs text-black-400">
              <p>+ Virtual AMM provides on-chain price discovery without orderbook</p>
              <p>+ PID-controlled funding rates balance long/short interest</p>
              <p>+ Up to 20x leverage with automatic liquidation</p>
              <p>+ Insurance fund backstops liquidation losses</p>
              <p>+ Funding paid every 8 hours based on mark-index spread</p>
            </div>
          </div>

          {/* All markets table */}
          <div className="bg-black-800/60 border border-black-700 rounded-xl overflow-hidden">
            <div className="p-3 border-b border-black-700">
              <h3 className="text-sm font-bold text-white">All Markets</h3>
            </div>
            <div className="divide-y divide-black-800">
              {MARKETS_DATA.map((m, i) => (
                <div
                  key={m.pair}
                  onClick={() => setSelectedMarket(i)}
                  className={`flex items-center justify-between p-3 cursor-pointer transition-colors ${
                    selectedMarket === i ? 'bg-matrix-900/10' : 'hover:bg-black-800/80'
                  }`}
                >
                  <div className="font-bold text-white text-sm">{m.pair}</div>
                  <div className="text-sm font-mono text-black-300">{m.price}</div>
                  <div className={`text-xs font-mono ${m.positive ? 'text-matrix-400' : 'text-red-400'}`}>{m.change}</div>
                  <div className="text-xs font-mono text-black-500">{m.funding}</div>
                  <div className="text-xs font-mono text-black-500 hidden sm:block">{m.volume24h}</div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
