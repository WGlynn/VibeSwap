import { useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { useWallet } from '../hooks/useWallet'
import { useDeviceWallet } from '../hooks/useDeviceWallet'
import { useBalances } from '../hooks/useBalances'
import { useVault } from '../hooks/useVault'
import toast from 'react-hot-toast'
import GlassCard from './ui/GlassCard'
import InteractiveButton from './ui/InteractiveButton'
import { StaggerContainer, StaggerItem } from './ui/StaggerContainer'

/**
 * Savings Vault Page
 * Implements "separation of concerns" - different wallets for different purposes
 *
 * Vault vs Spending:
 * - Spending: instant access, lower security, for daily use
 * - Vault: 30-day timelock, higher security, for savings
 *
 * @version 1.0.0
 */

const TOKENS = [
  { symbol: 'ETH', name: 'Ethereum', logo: '⟠', price: 3250 },
  { symbol: 'USDC', name: 'USD Coin', logo: '💵', price: 1 },
  { symbol: 'USDT', name: 'Tether', logo: '💲', price: 1 },
  { symbol: 'WBTC', name: 'Wrapped Bitcoin', logo: '₿', price: 65000 },
]

function VaultPage() {
  const { isConnected: isExternalConnected, connect } = useWallet()
  const { isConnected: isDeviceConnected } = useDeviceWallet()
  const { getFormattedBalance, getBalance, simulateSend } = useBalances()
  const {
    isVaultSetup,
    vaultBalances,
    pendingWithdrawals,
    vaultConfig,
    getFormattedVaultBalance,
    getTotalVaultValue,
    shouldRecommendHardwareWallet,
    getWithdrawalTimeRemaining,
    initializeVault,
    depositToVault,
    initiateWithdrawal,
    cancelWithdrawal,
    completeWithdrawal,
    VAULT_CONFIG,
    HARDWARE_WALLET_THRESHOLD,
  } = useVault()

  const isConnected = isExternalConnected || isDeviceConnected

  const [showDepositModal, setShowDepositModal] = useState(false)
  const [showWithdrawModal, setShowWithdrawModal] = useState(false)
  const [selectedToken, setSelectedToken] = useState(TOKENS[0])
  const [amount, setAmount] = useState('')

  // Setup vault if not initialized
  const handleSetupVault = () => {
    initializeVault()
    toast.success('Savings Vault created!')
  }

  // Deposit to vault
  const handleDeposit = () => {
    if (!amount || parseFloat(amount) <= 0) {
      toast.error('Enter an amount')
      return
    }

    const spendingBal = getBalance(selectedToken.symbol)
    if (parseFloat(amount) > spendingBal) {
      toast.error('Insufficient spending balance')
      return
    }

    // Simulate moving from spending to vault
    simulateSend(selectedToken.symbol, amount)
    depositToVault(selectedToken.symbol, amount)

    toast.success(`Moved ${amount} ${selectedToken.symbol} to vault`)
    setAmount('')
    setShowDepositModal(false)
  }

  // Initiate withdrawal
  const handleInitiateWithdrawal = () => {
    if (!amount || parseFloat(amount) <= 0) {
      toast.error('Enter an amount')
      return
    }

    const vaultBal = vaultBalances[selectedToken.symbol] || 0
    if (parseFloat(amount) > vaultBal) {
      toast.error('Insufficient vault balance')
      return
    }

    const withdrawal = initiateWithdrawal(selectedToken.symbol, amount)
    if (withdrawal) {
      toast.success(`Withdrawal initiated. Available in ${VAULT_CONFIG.timelockDays} days.`)
      setAmount('')
      setShowWithdrawModal(false)
    }
  }

  // Format time remaining
  const formatTimeRemaining = (withdrawalId) => {
    const time = getWithdrawalTimeRemaining(withdrawalId)
    if (!time) return ''
    if (time.ready) return 'Ready'
    if (time.days > 0) return `${time.days}d ${time.hours}h`
    if (time.hours > 0) return `${time.hours}h ${time.minutes}m`
    return `${time.minutes}m`
  }

  // Calculate total spending balance value
  const getTotalSpendingValue = () => {
    let total = 0
    for (const token of TOKENS) {
      total += getBalance(token.symbol) * token.price
    }
    return total
  }

  if (!isConnected) {
    return (
      <div className="max-w-lg mx-auto px-4 py-12">
        <div className="text-center">
          <div className="w-20 h-20 mx-auto mb-6 rounded-full bg-terminal-500/20 border border-terminal-500/30 flex items-center justify-center">
            <span className="text-4xl">🏦</span>
          </div>
          <h1 className="text-2xl font-bold mb-2">Savings Vault</h1>
          <p className="text-black-400 mb-6">
            Separate your savings from spending money for better security.
          </p>
          <button
            onClick={connect}
            className="px-6 py-3 rounded-xl bg-matrix-600 hover:bg-matrix-500 text-black-900 font-semibold transition-colors"
          >
            Connect Wallet
          </button>
        </div>
      </div>
    )
  }

  if (!isVaultSetup) {
    return (
      <div className="max-w-lg mx-auto px-4 py-8">
        <div className="bg-black-800 border border-black-700 rounded-2xl p-6">
          <div className="text-center mb-6">
            <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-terminal-500/20 border border-terminal-500/30 flex items-center justify-center">
              <span className="text-3xl">🏦</span>
            </div>
            <h1 className="text-xl font-bold mb-2">Create Your Savings Vault</h1>
            <p className="text-black-400 text-sm">
              Separate your spending from your savings. Different wallets for different purposes.
            </p>
          </div>

          {/* Security comparison */}
          <div className="grid grid-cols-2 gap-4 mb-6">
            <div className="p-4 rounded-xl bg-black-700/50 border border-black-600">
              <div className="text-sm font-medium mb-2">Spending Wallet</div>
              <ul className="text-xs text-black-400 space-y-1">
                <li>Instant access</li>
                <li>7-day recovery timelock</li>
                <li>3 of 5 guardians</li>
                <li>For daily transactions</li>
              </ul>
            </div>
            <div className="p-4 rounded-xl bg-terminal-500/10 border border-terminal-500/30">
              <div className="text-sm font-medium text-terminal-400 mb-2">Savings Vault</div>
              <ul className="text-xs text-black-300 space-y-1">
                <li>30-day withdrawal delay</li>
                <li>30-day recovery timelock</li>
                <li>4 of 5 guardians</li>
                <li>For long-term savings</li>
              </ul>
            </div>
          </div>

          {/* Axiom callout */}
          <div className="p-4 rounded-xl bg-amber-500/10 border border-amber-500/20 mb-6">
            <div className="flex items-start space-x-3">
              <span className="text-amber-500">📜</span>
              <div>
                <div className="text-sm font-medium text-amber-400">From Your 2018 Paper</div>
                <p className="text-xs text-black-400 mt-1">
                  "Generate a different wallet for expenses that you pay using bitcoins, and use different ones for long term storage of bitcoins."
                </p>
              </div>
            </div>
          </div>

          <button
            onClick={handleSetupVault}
            className="w-full py-4 rounded-xl bg-terminal-600 hover:bg-terminal-500 text-black-900 font-semibold text-lg transition-colors"
          >
            Create Savings Vault
          </button>
        </div>
      </div>
    )
  }

  const totalVaultValue = getTotalVaultValue()
  const totalSpendingValue = getTotalSpendingValue()

  return (
    <div className="max-w-2xl mx-auto px-4 py-6">
      {/* Header */}
      <div className="mb-6">
        <h1 className="text-2xl font-bold">Savings Vault</h1>
        <p className="text-black-400 mt-1">Long-term storage with extra security</p>
      </div>

      {/* Hardware wallet recommendation */}
      {shouldRecommendHardwareWallet() && (
        <div className="mb-6 p-4 rounded-xl bg-amber-500/10 border border-amber-500/20">
          <div className="flex items-start space-x-3">
            <span className="text-xl">⚠️</span>
            <div>
              <div className="font-medium text-amber-400">Hardware Wallet Recommended</div>
              <p className="text-sm text-black-400 mt-1">
                Your vault holds over ${HARDWARE_WALLET_THRESHOLD.toLocaleString()}. For maximum security, consider moving large holdings to a hardware wallet (Ledger, Trezor) for true cold storage.
              </p>
              <p className="text-xs text-black-500 mt-2">
                "Keeping your private keys entirely offline is the best way to protect them" - Your 2018 Paper
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Balance overview */}
      <StaggerContainer className="grid grid-cols-2 gap-4 mb-6">
        <StaggerItem>
          <GlassCard className="p-4">
            <div className="text-sm text-black-400 mb-1">Spending Balance</div>
            <div className="text-2xl font-bold">${totalSpendingValue.toLocaleString()}</div>
            <div className="text-xs text-black-500 mt-1">Instant access</div>
          </GlassCard>
        </StaggerItem>
        <StaggerItem>
          <GlassCard glowColor="terminal" className="p-4">
            <div className="text-sm text-terminal-400 mb-1">Vault Balance</div>
            <div className="text-2xl font-bold text-terminal-400">${totalVaultValue.toLocaleString()}</div>
            <div className="text-xs text-black-400 mt-1">{VAULT_CONFIG.timelockDays}-day timelock</div>
          </GlassCard>
        </StaggerItem>
      </StaggerContainer>

      {/* Actions */}
      <div className="flex gap-3 mb-6">
        <InteractiveButton
          variant="primary"
          onClick={() => setShowDepositModal(true)}
          className="flex-1 py-3"
        >
          Deposit to Vault
        </InteractiveButton>
        <InteractiveButton
          variant="secondary"
          onClick={() => setShowWithdrawModal(true)}
          className="flex-1 py-3"
        >
          Withdraw
        </InteractiveButton>
      </div>

      {/* Vault assets */}
      <GlassCard className="overflow-hidden mb-6">
        <div className="p-4 border-b border-black-700">
          <h2 className="font-semibold">Vault Assets</h2>
        </div>
        <div className="divide-y divide-black-700">
          {TOKENS.map((token) => {
            const vaultBal = vaultBalances[token.symbol] || 0
            const spendingBal = getBalance(token.symbol)
            const vaultValue = vaultBal * token.price

            return (
              <div key={token.symbol} className="p-4 flex items-center justify-between">
                <div className="flex items-center space-x-3">
                  <span className="text-2xl">{token.logo}</span>
                  <div>
                    <div className="font-medium">{token.symbol}</div>
                    <div className="text-xs text-black-500">{token.name}</div>
                  </div>
                </div>
                <div className="text-right">
                  <div className="flex items-center space-x-4">
                    <div className="text-right">
                      <div className="text-xs text-black-500">Spending</div>
                      <div className="text-sm text-black-300">{spendingBal.toFixed(4)}</div>
                    </div>
                    <div className="text-right">
                      <div className="text-xs text-terminal-500">Vault</div>
                      <div className="font-medium text-terminal-400">{vaultBal.toFixed(4)}</div>
                    </div>
                  </div>
                  {vaultValue > 0 && (
                    <div className="text-xs text-black-500 mt-1">
                      ${vaultValue.toLocaleString()}
                    </div>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      </GlassCard>

      {/* Pending withdrawals */}
      {pendingWithdrawals.length > 0 && (
        <GlassCard className="overflow-hidden mb-6">
          <div className="p-4 border-b border-black-700">
            <h2 className="font-semibold">Pending Withdrawals</h2>
          </div>
          <div className="divide-y divide-black-700">
            {pendingWithdrawals.map((w) => {
              const time = getWithdrawalTimeRemaining(w.id)
              const isReady = time?.ready

              return (
                <div key={w.id} className="p-4 flex items-center justify-between">
                  <div>
                    <div className="font-medium">{w.amount} {w.symbol}</div>
                    <div className="text-xs text-black-500">
                      Initiated {new Date(w.initiatedAt).toLocaleDateString()}
                    </div>
                  </div>
                  <div className="flex items-center space-x-3">
                    {isReady ? (
                      <button
                        onClick={() => {
                          completeWithdrawal(w.id)
                          toast.success(`${w.amount} ${w.symbol} moved to spending`)
                        }}
                        className="px-4 py-2 rounded-lg bg-matrix-600 hover:bg-matrix-500 text-black-900 font-medium text-sm transition-colors"
                      >
                        Complete
                      </button>
                    ) : (
                      <div className="text-right">
                        <div className="text-sm font-medium text-amber-400">{formatTimeRemaining(w.id)}</div>
                        <div className="text-xs text-black-500">remaining</div>
                      </div>
                    )}
                    <button
                      onClick={() => {
                        cancelWithdrawal(w.id)
                        toast.success('Withdrawal cancelled')
                      }}
                      className="p-2 rounded-lg hover:bg-black-700 text-black-400 hover:text-white transition-colors"
                    >
                      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                      </svg>
                    </button>
                  </div>
                </div>
              )
            })}
          </div>
        </GlassCard>
      )}

      {/* Security info */}
      <div className="p-4 rounded-xl bg-black-800/50 border border-black-700">
        <div className="flex items-center space-x-2 mb-3">
          <svg className="w-5 h-5 text-terminal-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
          </svg>
          <span className="font-medium">Vault Security</span>
        </div>
        <ul className="text-sm text-black-400 space-y-2">
          <li className="flex items-center space-x-2">
            <span className="text-terminal-500">•</span>
            <span>{VAULT_CONFIG.timelockDays}-day timelock on all withdrawals</span>
          </li>
          <li className="flex items-center space-x-2">
            <span className="text-terminal-500">•</span>
            <span>Requires {VAULT_CONFIG.guardianThreshold} of {VAULT_CONFIG.minGuardians} guardians for recovery</span>
          </li>
          <li className="flex items-center space-x-2">
            <span className="text-terminal-500">•</span>
            <span>Cancel any withdrawal during timelock period</span>
          </li>
        </ul>
      </div>

      {/* Deposit Modal */}
      <AnimatePresence>
        {showDepositModal && (
          <Modal
            title="Deposit to Vault"
            onClose={() => setShowDepositModal(false)}
          >
            <div className="space-y-4">
              <div>
                <label className="block text-sm text-black-400 mb-2">Token</label>
                <div className="grid grid-cols-4 gap-2">
                  {TOKENS.map((token) => (
                    <button
                      key={token.symbol}
                      onClick={() => setSelectedToken(token)}
                      className={`p-3 rounded-lg text-center transition-colors ${
                        selectedToken.symbol === token.symbol
                          ? 'bg-terminal-500/20 border-2 border-terminal-500'
                          : 'bg-black-700 border-2 border-transparent hover:border-black-500'
                      }`}
                    >
                      <span className="text-xl">{token.logo}</span>
                      <div className="text-xs mt-1">{token.symbol}</div>
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <div className="flex items-center justify-between mb-2">
                  <label className="text-sm text-black-400">Amount</label>
                  <span className="text-xs text-black-500">
                    Available: {getFormattedBalance(selectedToken.symbol)} {selectedToken.symbol}
                  </span>
                </div>
                <div className="flex items-center space-x-2">
                  <input
                    type="number"
                    value={amount}
                    onChange={(e) => setAmount(e.target.value)}
                    placeholder="0.00"
                    className="flex-1 bg-black-700 border border-black-600 rounded-lg px-4 py-3 text-lg font-medium outline-none focus:border-terminal-500"
                  />
                  <button
                    onClick={() => setAmount(getBalance(selectedToken.symbol).toString())}
                    className="px-3 py-3 rounded-lg bg-black-600 hover:bg-black-500 text-sm font-medium transition-colors"
                  >
                    MAX
                  </button>
                </div>
              </div>

              <div className="p-3 rounded-lg bg-terminal-500/10 border border-terminal-500/20">
                <p className="text-xs text-black-300">
                  Deposits are instant. Withdrawals require a {VAULT_CONFIG.timelockDays}-day waiting period.
                </p>
              </div>

              <button
                onClick={handleDeposit}
                disabled={!amount || parseFloat(amount) <= 0}
                className="w-full py-4 rounded-xl bg-terminal-600 hover:bg-terminal-500 disabled:bg-black-600 disabled:text-black-500 text-black-900 font-semibold transition-colors"
              >
                Move to Vault
              </button>
            </div>
          </Modal>
        )}
      </AnimatePresence>

      {/* Withdraw Modal */}
      <AnimatePresence>
        {showWithdrawModal && (
          <Modal
            title="Withdraw from Vault"
            onClose={() => setShowWithdrawModal(false)}
          >
            <div className="space-y-4">
              <div className="p-4 rounded-lg bg-amber-500/10 border border-amber-500/20">
                <div className="flex items-start space-x-2">
                  <span className="text-amber-500">⏰</span>
                  <div>
                    <div className="font-medium text-amber-400 text-sm">{VAULT_CONFIG.timelockDays}-Day Waiting Period</div>
                    <p className="text-xs text-black-400 mt-1">
                      Withdrawals take {VAULT_CONFIG.timelockDays} days. You can cancel anytime during this period.
                    </p>
                  </div>
                </div>
              </div>

              <div>
                <label className="block text-sm text-black-400 mb-2">Token</label>
                <div className="grid grid-cols-4 gap-2">
                  {TOKENS.map((token) => (
                    <button
                      key={token.symbol}
                      onClick={() => setSelectedToken(token)}
                      className={`p-3 rounded-lg text-center transition-colors ${
                        selectedToken.symbol === token.symbol
                          ? 'bg-terminal-500/20 border-2 border-terminal-500'
                          : 'bg-black-700 border-2 border-transparent hover:border-black-500'
                      }`}
                    >
                      <span className="text-xl">{token.logo}</span>
                      <div className="text-xs mt-1">{token.symbol}</div>
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <div className="flex items-center justify-between mb-2">
                  <label className="text-sm text-black-400">Amount</label>
                  <span className="text-xs text-black-500">
                    In vault: {getFormattedVaultBalance(selectedToken.symbol)} {selectedToken.symbol}
                  </span>
                </div>
                <div className="flex items-center space-x-2">
                  <input
                    type="number"
                    value={amount}
                    onChange={(e) => setAmount(e.target.value)}
                    placeholder="0.00"
                    className="flex-1 bg-black-700 border border-black-600 rounded-lg px-4 py-3 text-lg font-medium outline-none focus:border-terminal-500"
                  />
                  <button
                    onClick={() => setAmount((vaultBalances[selectedToken.symbol] || 0).toString())}
                    className="px-3 py-3 rounded-lg bg-black-600 hover:bg-black-500 text-sm font-medium transition-colors"
                  >
                    MAX
                  </button>
                </div>
              </div>

              <button
                onClick={handleInitiateWithdrawal}
                disabled={!amount || parseFloat(amount) <= 0}
                className="w-full py-4 rounded-xl bg-amber-600 hover:bg-amber-500 disabled:bg-black-600 disabled:text-black-500 text-black-900 font-semibold transition-colors"
              >
                Start {VAULT_CONFIG.timelockDays}-Day Withdrawal
              </button>
            </div>
          </Modal>
        )}
      </AnimatePresence>
    </div>
  )
}

function Modal({ title, children, onClose }) {
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
    >
      <div className="absolute inset-0 bg-black/80 backdrop-blur-sm" onClick={onClose} />
      <motion.div
        initial={{ scale: 0.95, opacity: 0, y: 20, filter: 'blur(4px)' }}
        animate={{ scale: 1, opacity: 1, y: 0, filter: 'blur(0px)' }}
        exit={{ scale: 0.95, opacity: 0, y: 20, filter: 'blur(4px)' }}
        className="relative w-full max-w-md glass-card rounded-2xl shadow-2xl overflow-hidden"
      >
        <div className="flex items-center justify-between p-4 border-b border-black-700">
          <h3 className="font-semibold">{title}</h3>
          <button onClick={onClose} className="p-2 hover:bg-black-700 rounded-lg transition-colors">
            <svg className="w-5 h-5 text-black-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
        <div className="p-4">
          {children}
        </div>
      </motion.div>
    </motion.div>
  )
}

export default VaultPage
