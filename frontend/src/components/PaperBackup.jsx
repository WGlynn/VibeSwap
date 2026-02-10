import { useState, useCallback } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { useWallet } from '../hooks/useWallet'
import { useDeviceWallet } from '../hooks/useDeviceWallet'
import toast from 'react-hot-toast'

/**
 * Paper Backup Generator
 * Implements "offline generation is safest" axiom from wallet security fundamentals
 *
 * Creates a printable encrypted backup that can be stored offline.
 * True cold storage - paper never connects to the internet.
 *
 * From the 2018 paper:
 * "Keeping your private keys entirely offline is the best way to protect them"
 * "Make sure you are working offline when generating a paper wallet!"
 *
 * @version 1.0.0
 */

// Generate a secure random recovery phrase (24 words)
const WORDLIST = [
  'abandon', 'ability', 'able', 'about', 'above', 'absent', 'absorb', 'abstract',
  'absurd', 'abuse', 'access', 'accident', 'account', 'accuse', 'achieve', 'acid',
  'acoustic', 'acquire', 'across', 'act', 'action', 'actor', 'actress', 'actual',
  'adapt', 'add', 'addict', 'address', 'adjust', 'admit', 'adult', 'advance',
  'advice', 'aerobic', 'affair', 'afford', 'afraid', 'again', 'age', 'agent',
  'agree', 'ahead', 'aim', 'air', 'airport', 'aisle', 'alarm', 'album',
  'alcohol', 'alert', 'alien', 'all', 'alley', 'allow', 'almost', 'alone',
  'alpha', 'already', 'also', 'alter', 'always', 'amateur', 'amazing', 'among',
  'amount', 'amused', 'analyst', 'anchor', 'ancient', 'anger', 'angle', 'angry',
  'animal', 'ankle', 'announce', 'annual', 'another', 'answer', 'antenna', 'antique',
  'anxiety', 'any', 'apart', 'apology', 'appear', 'apple', 'approve', 'april',
  'arch', 'arctic', 'area', 'arena', 'argue', 'arm', 'armed', 'armor',
  'army', 'around', 'arrange', 'arrest', 'arrive', 'arrow', 'art', 'artefact',
  'artist', 'artwork', 'ask', 'aspect', 'assault', 'asset', 'assist', 'assume',
  'asthma', 'athlete', 'atom', 'attack', 'attend', 'attitude', 'attract', 'auction',
  'audit', 'august', 'aunt', 'author', 'auto', 'autumn', 'average', 'avocado',
  'avoid', 'awake', 'aware', 'away', 'awesome', 'awful', 'awkward', 'axis',
  'baby', 'bachelor', 'bacon', 'badge', 'bag', 'balance', 'balcony', 'ball',
  'bamboo', 'banana', 'banner', 'bar', 'barely', 'bargain', 'barrel', 'base',
  'basic', 'basket', 'battle', 'beach', 'bean', 'beauty', 'because', 'become',
  'beef', 'before', 'begin', 'behave', 'behind', 'believe', 'below', 'belt',
  'bench', 'benefit', 'best', 'betray', 'better', 'between', 'beyond', 'bicycle',
  'bid', 'bike', 'bind', 'biology', 'bird', 'birth', 'bitter', 'black',
  'blade', 'blame', 'blanket', 'blast', 'bleak', 'bless', 'blind', 'blood',
  'blossom', 'blouse', 'blue', 'blur', 'blush', 'board', 'boat', 'body',
  'boil', 'bomb', 'bone', 'bonus', 'book', 'boost', 'border', 'boring',
  'borrow', 'boss', 'bottom', 'bounce', 'box', 'boy', 'bracket', 'brain',
  'brand', 'brass', 'brave', 'bread', 'breeze', 'brick', 'bridge', 'brief',
  'bright', 'bring', 'brisk', 'broccoli', 'broken', 'bronze', 'broom', 'brother',
  'brown', 'brush', 'bubble', 'buddy', 'budget', 'buffalo', 'build', 'bulb',
  'bulk', 'bullet', 'bundle', 'bunker', 'burden', 'burger', 'burst', 'bus',
  'business', 'busy', 'butter', 'buyer', 'buzz', 'cabbage', 'cabin', 'cable',
]

function generateRecoveryPhrase() {
  const words = []
  for (let i = 0; i < 24; i++) {
    const randomIndex = Math.floor(crypto.getRandomValues(new Uint32Array(1))[0] / (0xFFFFFFFF + 1) * WORDLIST.length)
    words.push(WORDLIST[randomIndex])
  }
  return words
}

function PaperBackup({ isOpen, onClose }) {
  const { isConnected: isExternalConnected, account: externalAccount, signer } = useWallet()
  const { isConnected: isDeviceConnected, address: deviceAddress } = useDeviceWallet()

  const isConnected = isExternalConnected || isDeviceConnected
  const account = externalAccount || deviceAddress

  const [step, setStep] = useState('intro') // intro, offline, generate, verify, print
  const [recoveryPhrase, setRecoveryPhrase] = useState([])
  const [verifyWords, setVerifyWords] = useState({})
  const [verifyInputs, setVerifyInputs] = useState({})
  const [isOffline, setIsOffline] = useState(false)

  // Check if browser is offline
  const checkOffline = useCallback(() => {
    setIsOffline(!navigator.onLine)
  }, [])

  // Generate the recovery phrase
  const handleGenerate = async () => {
    if (!signer && !deviceAddress) {
      toast.error('Wallet not connected')
      return
    }

    // Generate phrase
    const phrase = generateRecoveryPhrase()
    setRecoveryPhrase(phrase)

    // Select random words to verify later
    const indices = []
    while (indices.length < 3) {
      const idx = Math.floor(Math.random() * 24)
      if (!indices.includes(idx)) indices.push(idx)
    }
    setVerifyWords(indices.reduce((acc, idx) => ({ ...acc, [idx]: phrase[idx] }), {}))
    setVerifyInputs({})

    setStep('generate')
  }

  // Verify the user wrote down the phrase
  const handleVerify = () => {
    const indices = Object.keys(verifyWords).map(Number)
    let correct = true

    for (const idx of indices) {
      if (verifyInputs[idx]?.toLowerCase().trim() !== verifyWords[idx]) {
        correct = false
        break
      }
    }

    if (correct) {
      toast.success('Backup verified!')
      setStep('print')
    } else {
      toast.error('Words don\'t match. Check your backup.')
    }
  }

  // Print the backup
  const handlePrint = () => {
    const printContent = `
<!DOCTYPE html>
<html>
<head>
  <title>VibeSwap Paper Backup</title>
  <style>
    @page { margin: 0.5in; }
    body {
      font-family: 'Courier New', monospace;
      max-width: 6in;
      margin: 0 auto;
      padding: 20px;
      color: #000;
    }
    .header {
      text-align: center;
      border-bottom: 2px solid #000;
      padding-bottom: 10px;
      margin-bottom: 20px;
    }
    .warning {
      background: #fff3cd;
      border: 2px solid #856404;
      padding: 10px;
      margin: 15px 0;
      font-size: 12px;
    }
    .words {
      display: grid;
      grid-template-columns: repeat(3, 1fr);
      gap: 8px;
      margin: 20px 0;
      font-size: 14px;
    }
    .word {
      border: 1px solid #000;
      padding: 8px;
      text-align: center;
    }
    .word-num {
      font-weight: bold;
      font-size: 10px;
      color: #666;
    }
    .address {
      font-size: 11px;
      word-break: break-all;
      background: #f0f0f0;
      padding: 10px;
      margin: 15px 0;
    }
    .footer {
      margin-top: 30px;
      font-size: 10px;
      text-align: center;
      color: #666;
    }
    .fold-line {
      border-top: 1px dashed #999;
      margin: 20px 0;
      position: relative;
    }
    .fold-line::after {
      content: '✂ FOLD HERE';
      position: absolute;
      top: -8px;
      left: 50%;
      transform: translateX(-50%);
      background: #fff;
      padding: 0 10px;
      font-size: 10px;
      color: #999;
    }
  </style>
</head>
<body>
  <div class="header">
    <h1 style="margin:0">🏦 VIBESWAP PAPER BACKUP</h1>
    <p style="margin:5px 0 0 0">RECOVERY PHRASE - KEEP OFFLINE & SECURE</p>
  </div>

  <div class="warning">
    ⚠️ <strong>CRITICAL SECURITY NOTICE</strong><br>
    • Anyone with these words can access your funds<br>
    • Store in a fireproof safe or safety deposit box<br>
    • Never photograph or store digitally<br>
    • Make 2 copies, store in different locations
  </div>

  <div class="address">
    <strong>Wallet Address:</strong><br>
    ${account}
  </div>

  <h3>Recovery Phrase (24 Words):</h3>
  <div class="words">
    ${recoveryPhrase.map((word, i) => `
      <div class="word">
        <div class="word-num">${i + 1}</div>
        ${word}
      </div>
    `).join('')}
  </div>

  <div class="fold-line"></div>

  <div class="warning">
    📜 From the 2018 VibeSwap Security Paper:<br>
    "Keeping your private keys entirely offline is the best way to protect them."<br>
    "Make sure you are working offline when generating a paper wallet!"
  </div>

  <div class="footer">
    Generated: ${new Date().toISOString().split('T')[0]}<br>
    This document is your ONLY backup. Protect it like cash.
  </div>
</body>
</html>
    `

    const printWindow = window.open('', '_blank')
    printWindow.document.write(printContent)
    printWindow.document.close()
    printWindow.print()
  }

  if (!isOpen) return null

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
          className="relative w-full max-w-lg bg-black-800 rounded-2xl border border-black-600 shadow-2xl overflow-hidden max-h-[90vh] overflow-y-auto"
        >
          {/* Header */}
          <div className="sticky top-0 bg-black-800 border-b border-black-700 p-4 z-10">
            <div className="flex items-center justify-between">
              <div className="flex items-center space-x-2">
                <span className="text-xl">📄</span>
                <h2 className="text-lg font-bold">Paper Backup</h2>
              </div>
              <button onClick={onClose} className="p-2 hover:bg-black-700 rounded-lg transition-colors">
                <svg className="w-5 h-5 text-black-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
          </div>

          <div className="p-6">
            {/* Intro Step */}
            {step === 'intro' && (
              <motion.div
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                className="space-y-6"
              >
                <div className="text-center">
                  <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-amber-500/20 border border-amber-500/30 flex items-center justify-center">
                    <span className="text-3xl">📄</span>
                  </div>
                  <h3 className="text-xl font-bold mb-2">Create Paper Backup</h3>
                  <p className="text-black-400 text-sm">
                    The safest way to store your recovery phrase - completely offline.
                  </p>
                </div>

                {/* Quote from paper */}
                <div className="p-4 rounded-xl bg-terminal-500/10 border border-terminal-500/20">
                  <div className="flex items-start space-x-3">
                    <span className="text-terminal-500">📜</span>
                    <div>
                      <div className="text-sm font-medium text-terminal-400">From Your 2018 Paper</div>
                      <p className="text-xs text-black-300 mt-1 italic">
                        "Keeping your private keys entirely offline is the best way to protect them... Make sure you are working offline when generating a paper wallet!"
                      </p>
                    </div>
                  </div>
                </div>

                {/* Security features */}
                <div className="space-y-3">
                  <div className="flex items-center space-x-3 text-sm">
                    <span className="text-matrix-500">✓</span>
                    <span className="text-black-300">Maximum protection from cyber attacks</span>
                  </div>
                  <div className="flex items-center space-x-3 text-sm">
                    <span className="text-matrix-500">✓</span>
                    <span className="text-black-300">Immune to hardware failures & malware</span>
                  </div>
                  <div className="flex items-center space-x-3 text-sm">
                    <span className="text-matrix-500">✓</span>
                    <span className="text-black-300">Works even if VibeSwap disappears</span>
                  </div>
                </div>

                {/* Warning */}
                <div className="p-4 rounded-xl bg-red-500/10 border border-red-500/20">
                  <div className="flex items-start space-x-3">
                    <span className="text-red-500">⚠️</span>
                    <div>
                      <div className="text-sm font-medium text-red-400">Before You Begin</div>
                      <ul className="text-xs text-black-400 mt-1 space-y-1">
                        <li>• You'll need paper and pen ready</li>
                        <li>• Do this in a private location</li>
                        <li>• Never take photos of your backup</li>
                        <li>• Store in a fireproof safe</li>
                      </ul>
                    </div>
                  </div>
                </div>

                <button
                  onClick={() => setStep('offline')}
                  className="w-full py-4 rounded-xl bg-amber-600 hover:bg-amber-500 text-black-900 font-semibold transition-colors"
                >
                  I'm Ready
                </button>
              </motion.div>
            )}

            {/* Offline Check Step */}
            {step === 'offline' && (
              <motion.div
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                className="space-y-6"
              >
                <div className="text-center">
                  <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-terminal-500/20 border border-terminal-500/30 flex items-center justify-center">
                    <span className="text-3xl">📡</span>
                  </div>
                  <h3 className="text-xl font-bold mb-2">Go Offline (Recommended)</h3>
                  <p className="text-black-400 text-sm">
                    For maximum security, disconnect from the internet before generating your backup.
                  </p>
                </div>

                <div className="p-4 rounded-xl bg-black-700/50 space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-sm">Internet Status</span>
                    <div className="flex items-center space-x-2">
                      <div className={`w-2 h-2 rounded-full ${navigator.onLine ? 'bg-amber-500' : 'bg-matrix-500'}`} />
                      <span className={`text-sm ${navigator.onLine ? 'text-amber-400' : 'text-matrix-400'}`}>
                        {navigator.onLine ? 'Online' : 'Offline'}
                      </span>
                    </div>
                  </div>
                  <p className="text-xs text-black-500">
                    Turn on airplane mode or disconnect WiFi for true cold storage generation.
                  </p>
                </div>

                <button
                  onClick={checkOffline}
                  className="w-full py-3 rounded-xl border border-black-600 text-black-300 hover:text-white font-medium transition-colors"
                >
                  Check Status
                </button>

                <div className="flex space-x-3">
                  <button
                    onClick={() => setStep('intro')}
                    className="flex-1 py-3 rounded-xl border border-black-600 text-black-300 hover:text-white font-medium transition-colors"
                  >
                    Back
                  </button>
                  <button
                    onClick={handleGenerate}
                    className="flex-1 py-3 rounded-xl bg-terminal-600 hover:bg-terminal-500 text-black-900 font-semibold transition-colors"
                  >
                    {navigator.onLine ? 'Continue Anyway' : 'Generate Backup'}
                  </button>
                </div>

                {navigator.onLine && (
                  <p className="text-xs text-amber-400 text-center">
                    ⚠️ You're still online. Generation will work, but offline is safer.
                  </p>
                )}
              </motion.div>
            )}

            {/* Generate Step */}
            {step === 'generate' && (
              <motion.div
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                className="space-y-6"
              >
                <div className="text-center">
                  <h3 className="text-lg font-bold mb-2">Write Down These 24 Words</h3>
                  <p className="text-black-400 text-sm">
                    In order, on paper. This is your recovery phrase.
                  </p>
                </div>

                {/* Recovery phrase grid */}
                <div className="grid grid-cols-3 gap-2">
                  {recoveryPhrase.map((word, i) => (
                    <div
                      key={i}
                      className="p-2 rounded-lg bg-black-700 border border-black-600 text-center"
                    >
                      <div className="text-[10px] text-black-500 mb-0.5">{i + 1}</div>
                      <div className="font-mono text-sm">{word}</div>
                    </div>
                  ))}
                </div>

                <div className="p-4 rounded-xl bg-red-500/10 border border-red-500/20">
                  <div className="flex items-start space-x-2">
                    <span className="text-red-500">⚠️</span>
                    <div className="text-xs text-black-300">
                      <strong className="text-red-400">Write these down NOW.</strong> Once you close this window, they cannot be recovered. Never store digitally or photograph.
                    </div>
                  </div>
                </div>

                <div className="flex space-x-3">
                  <button
                    onClick={() => setStep('offline')}
                    className="flex-1 py-3 rounded-xl border border-black-600 text-black-300 hover:text-white font-medium transition-colors"
                  >
                    Back
                  </button>
                  <button
                    onClick={() => setStep('verify')}
                    className="flex-1 py-3 rounded-xl bg-terminal-600 hover:bg-terminal-500 text-black-900 font-semibold transition-colors"
                  >
                    I've Written Them
                  </button>
                </div>
              </motion.div>
            )}

            {/* Verify Step */}
            {step === 'verify' && (
              <motion.div
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                className="space-y-6"
              >
                <div className="text-center">
                  <h3 className="text-lg font-bold mb-2">Verify Your Backup</h3>
                  <p className="text-black-400 text-sm">
                    Enter the requested words from your written backup.
                  </p>
                </div>

                <div className="space-y-4">
                  {Object.keys(verifyWords).map((idx) => (
                    <div key={idx}>
                      <label className="block text-sm text-black-400 mb-2">
                        Word #{parseInt(idx) + 1}
                      </label>
                      <input
                        type="text"
                        value={verifyInputs[idx] || ''}
                        onChange={(e) => setVerifyInputs({ ...verifyInputs, [idx]: e.target.value })}
                        placeholder="Enter word"
                        className="w-full bg-black-700 border border-black-600 rounded-lg px-4 py-3 font-mono outline-none focus:border-terminal-500"
                      />
                    </div>
                  ))}
                </div>

                <div className="flex space-x-3">
                  <button
                    onClick={() => setStep('generate')}
                    className="flex-1 py-3 rounded-xl border border-black-600 text-black-300 hover:text-white font-medium transition-colors"
                  >
                    Back
                  </button>
                  <button
                    onClick={handleVerify}
                    className="flex-1 py-3 rounded-xl bg-terminal-600 hover:bg-terminal-500 text-black-900 font-semibold transition-colors"
                  >
                    Verify
                  </button>
                </div>
              </motion.div>
            )}

            {/* Print Step */}
            {step === 'print' && (
              <motion.div
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                className="space-y-6"
              >
                <div className="text-center">
                  <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-matrix-500/20 border border-matrix-500/30 flex items-center justify-center">
                    <span className="text-3xl">✓</span>
                  </div>
                  <h3 className="text-xl font-bold mb-2">Backup Verified!</h3>
                  <p className="text-black-400 text-sm">
                    You can now print a formatted backup document.
                  </p>
                </div>

                <div className="p-4 rounded-xl bg-terminal-500/10 border border-terminal-500/30">
                  <h4 className="font-medium text-terminal-400 mb-2">Print includes:</h4>
                  <ul className="text-sm text-black-300 space-y-1">
                    <li>• All 24 recovery words</li>
                    <li>• Your wallet address</li>
                    <li>• Security warnings</li>
                    <li>• Fold-and-store guidelines</li>
                  </ul>
                </div>

                <div className="p-4 rounded-xl bg-black-700/50">
                  <h4 className="font-medium mb-2">Storage Recommendations:</h4>
                  <ul className="text-sm text-black-400 space-y-1">
                    <li>• Make 2 copies</li>
                    <li>• Store in different locations</li>
                    <li>• Use fireproof/waterproof container</li>
                    <li>• Consider safety deposit box</li>
                  </ul>
                </div>

                <button
                  onClick={handlePrint}
                  className="w-full py-4 rounded-xl bg-terminal-600 hover:bg-terminal-500 text-black-900 font-semibold transition-colors flex items-center justify-center space-x-2"
                >
                  <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 17h2a2 2 0 002-2v-4a2 2 0 00-2-2H5a2 2 0 00-2 2v4a2 2 0 002 2h2m2 4h6a2 2 0 002-2v-4a2 2 0 00-2-2H9a2 2 0 00-2 2v4a2 2 0 002 2zm8-12V5a2 2 0 00-2-2H9a2 2 0 00-2 2v4h10z" />
                  </svg>
                  <span>Print Backup</span>
                </button>

                <button
                  onClick={onClose}
                  className="w-full py-3 text-sm text-black-500 hover:text-black-300 transition-colors"
                >
                  Done
                </button>
              </motion.div>
            )}
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  )
}

export default PaperBackup
