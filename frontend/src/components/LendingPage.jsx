import { useState } from 'react'
import { motion } from 'framer-motion'
import { useWallet } from '../hooks/useWallet'
import { useDeviceWallet } from '../hooks/useDeviceWallet'

// ============================================================
// Lending Page — Aave-style lending with utilization kink model
// ============================================================

const MARKETS = [
  { asset: 'ETH',  icon: 'E',  supplyAPY: '3.2%', borrowAPY: '4.8%', totalSupply: '4,200 ETH', totalBorrow: '2,100 ETH', utilization: '50%', ltv: '80%' },
  { asset: 'USDC', icon: '$',  supplyAPY: '5.1%', borrowAPY: '7.2%', totalSupply: '2.8M USDC', totalBorrow: '1.9M USDC', utilization: '68%', ltv: '85%' },
  { asset: 'WBTC', icon: 'B',  supplyAPY: '1.8%', borrowAPY: '3.4%', totalSupply: '120 WBTC',  totalBorrow: '45 WBTC',   utilization: '38%', ltv: '75%' },
  { asset: 'DAI',  icon: 'D',  supplyAPY: '4.9%', borrowAPY: '6.8%', totalSupply: '1.5M DAI',  totalBorrow: '980K DAI',  utilization: '65%', ltv: '85%' },
  { asset: 'JUL',  icon: 'J',  supplyAPY: '8.4%', borrowAPY: '12.1%', totalSupply: '890K JUL', totalBorrow: '340K JUL', utilization: '38%', ltv: '60%' },
]

function MarketRow({ market }) {
  const [showAction, setShowAction] = useState(false)

  return (
    <motion.div
      initial={{ opacity: 0, y: 5 }}
      animate={{ opacity: 1, y: 0 }}
      className="bg-black-800/60 border border-black-700 rounded-xl p-4 hover:border-black-600 transition-colors"
    >
      <div className="flex items-center gap-4 cursor-pointer" onClick={() => setShowAction(!showAction)}>
        {/* Asset */}
        <div className="w-10 h-10 rounded-full bg-black-900/60 border border-black-700 flex items-center justify-center text-lg font-mono font-bold text-matrix-400">
          {market.icon}
        </div>
        <div className="flex-1">
          <div className="text-white font-bold">{market.asset}</div>
          <div className="text-[10px] font-mono text-black-500">LTV {market.ltv}</div>
        </div>

        {/* APYs */}
        <div className="text-center">
          <div className="text-matrix-400 font-mono font-bold text-sm">{market.supplyAPY}</div>
          <div className="text-[10px] text-black-500">Supply</div>
        </div>
        <div className="text-center">
          <div className="text-amber-400 font-mono font-bold text-sm">{market.borrowAPY}</div>
          <div className="text-[10px] text-black-500">Borrow</div>
        </div>
        <div className="text-center hidden sm:block">
          <div className="text-white font-mono text-sm">{market.utilization}</div>
          <div className="text-[10px] text-black-500">Util.</div>
        </div>
      </div>

      {showAction && (
        <motion.div
          initial={{ opacity: 0, height: 0 }}
          animate={{ opacity: 1, height: 'auto' }}
          className="mt-4 pt-4 border-t border-black-700 grid grid-cols-2 gap-3"
        >
          <div>
            <div className="text-xs text-black-400 mb-1">Total Supply</div>
            <div className="text-sm font-mono text-white">{market.totalSupply}</div>
          </div>
          <div>
            <div className="text-xs text-black-400 mb-1">Total Borrow</div>
            <div className="text-sm font-mono text-white">{market.totalBorrow}</div>
          </div>
          <button className="py-2 rounded-lg bg-matrix-600 hover:bg-matrix-500 text-black-900 font-bold text-sm transition-colors">
            Supply
          </button>
          <button className="py-2 rounded-lg bg-amber-600/80 hover:bg-amber-500/80 text-black-900 font-bold text-sm transition-colors">
            Borrow
          </button>
        </motion.div>
      )}
    </motion.div>
  )
}

export default function LendingPage() {
  const { isConnected: isExternalConnected } = useWallet()
  const { isConnected: isDeviceConnected } = useDeviceWallet()
  const isConnected = isExternalConnected || isDeviceConnected

  return (
    <div className="max-w-3xl mx-auto px-4 py-6">
      <div className="text-center mb-6">
        <h1 className="text-3xl sm:text-4xl font-bold text-white font-display text-5d">
          Lend & <span className="text-matrix-500">Borrow</span>
        </h1>
        <p className="text-black-400 text-sm mt-2">
          Supply assets to earn interest. Borrow against your collateral.
        </p>
      </div>

      {/* Protocol stats */}
      <div className="grid grid-cols-3 gap-3 mb-6">
        {[
          { label: 'Total Supply', value: '$12.4M' },
          { label: 'Total Borrow', value: '$5.3M' },
          { label: 'Flash Loans', value: 'EIP-3156' },
        ].map((s) => (
          <div key={s.label} className="text-center p-3 bg-black-800/40 border border-black-700/50 rounded-lg">
            <div className="text-white font-mono font-bold">{s.value}</div>
            <div className="text-black-500 text-[10px] font-mono">{s.label}</div>
          </div>
        ))}
      </div>

      {/* Markets */}
      <div className="space-y-3">
        {MARKETS.map((m) => (
          <MarketRow key={m.asset} market={m} />
        ))}
      </div>

      {/* Info */}
      <div className="mt-6 p-4 bg-black-800/30 border border-black-700/50 rounded-xl">
        <h3 className="text-sm font-bold text-white mb-2">How it works</h3>
        <div className="space-y-1 text-xs text-black-400">
          <p>+ Supply assets to earn variable interest based on utilization</p>
          <p>+ Borrow up to your LTV ratio against supplied collateral</p>
          <p>+ Interest rates follow a kink model — low rates under 80% utilization, steep above</p>
          <p>+ Liquidation at 5% bonus protects lenders</p>
          <p>+ EIP-3156 flash loans available for arbitrage and liquidations</p>
        </div>
      </div>

      {!isConnected && (
        <div className="mt-6 text-center text-black-500 text-xs font-mono">
          Connect wallet to supply and borrow
        </div>
      )}
    </div>
  )
}
