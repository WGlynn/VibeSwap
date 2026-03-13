import { useState } from 'react'
import { motion } from 'framer-motion'
import GlassCard from './ui/GlassCard'
import PageHero from './ui/PageHero'

const PHI = 1.618033988749895
const CYAN = '#06b6d4'

// ============ Constants ============
const CATEGORIES = [
  { value: '', label: 'Select a category...' },
  { value: 'bug', label: 'Bug Report' },
  { value: 'feature', label: 'Feature Request' },
  { value: 'support', label: 'Support' },
  { value: 'partnership', label: 'Partnership' },
  { value: 'security', label: 'Security' },
]

const QUICK_LINKS = [
  {
    title: 'Discord',
    icon: '◆',
    color: '#5865F2',
    description: 'Join the community for real-time discussion and support.',
    href: 'https://discord.gg/vibeswap',
  },
  {
    title: 'Telegram',
    icon: '◇',
    color: '#26A5E4',
    description: 'Chat with the team and fellow traders in our Telegram group.',
    href: 'https://t.me/+3uHbNxyZH-tiOGY8',
  },
  {
    title: 'GitHub Issues',
    icon: '⬡',
    color: '#8B949E',
    description: 'Report bugs or request features directly on our public repo.',
    href: 'https://github.com/wglynn/vibeswap/issues',
  },
  {
    title: 'Email',
    icon: '◈',
    color: CYAN,
    description: 'Reach us at contact@vibeswap.io for formal inquiries.',
    href: 'mailto:contact@vibeswap.io',
  },
]

const FAQ_SHORTCUTS = [
  {
    question: 'My transaction is stuck — what do I do?',
    answer: 'Check the batch timer on the Swap page. VibeSwap settles in 10-second batches. If your commit has not been revealed, wait for the current batch cycle to complete.',
  },
  {
    question: 'How do I connect my wallet?',
    answer: 'Click "Sign In" in the header. You can use an external wallet (MetaMask, WalletConnect) or create a device wallet using your biometrics (WebAuthn/passkey).',
  },
  {
    question: 'Why was my order slashed 50%?',
    answer: 'VibeSwap uses a commit-reveal mechanism. If you commit but fail to reveal your order within the 2-second reveal window, 50% of your deposit is slashed to prevent griefing.',
  },
  {
    question: 'What chains does VibeSwap support?',
    answer: 'Currently Ethereum, Arbitrum, Base, Optimism, and Polygon via LayerZero V2. Solana and Nervos CKB support is coming soon.',
  },
  {
    question: 'How does the batch auction prevent MEV?',
    answer: 'Orders are committed as hashes during the 8-second commit phase, then revealed simultaneously. A uniform clearing price is applied to all orders in the batch, eliminating front-running and sandwich attacks.',
  },
]

// ============ Email Validation ============
function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
}

// ============ Animation Variants ============
const staggerContainer = {
  hidden: { opacity: 0 },
  visible: {
    opacity: 1,
    transition: {
      staggerChildren: 1 / (PHI * PHI),
      delayChildren: 1 / (PHI * PHI * PHI),
    },
  },
}

const fadeUp = {
  hidden: { opacity: 0, y: 12 },
  visible: {
    opacity: 1,
    y: 0,
    transition: {
      duration: 1 / PHI,
      ease: [0.25, 0.1, 1 / PHI, 1],
    },
  },
}

// ============ Quick Link Card ============
function QuickLinkCard({ link, index }) {
  return (
    <motion.a
      href={link.href}
      target="_blank"
      rel="noopener noreferrer"
      variants={fadeUp}
      custom={index}
      className="block"
    >
      <GlassCard glowColor="terminal" spotlight hover className="p-5 h-full cursor-pointer">
        <div className="flex items-start gap-3">
          <div
            className="w-10 h-10 rounded-xl flex items-center justify-center text-lg font-bold shrink-0"
            style={{ backgroundColor: link.color + '18', color: link.color }}
          >
            {link.icon}
          </div>
          <div className="min-w-0">
            <h3 className="text-sm font-mono font-semibold text-white mb-1">
              {link.title}
            </h3>
            <p className="text-xs text-neutral-400 leading-relaxed">
              {link.description}
            </p>
          </div>
        </div>
      </GlassCard>
    </motion.a>
  )
}

// ============ FAQ Item ============
function FAQItem({ item, index }) {
  const [open, setOpen] = useState(false)

  return (
    <motion.div variants={fadeUp} custom={index}>
      <button
        onClick={() => setOpen(!open)}
        className="w-full text-left px-4 py-3 rounded-xl border transition-all duration-200"
        style={{
          backgroundColor: open ? 'rgba(6,182,212,0.04)' : 'rgba(255,255,255,0.02)',
          borderColor: open ? 'rgba(6,182,212,0.15)' : 'rgba(255,255,255,0.06)',
        }}
      >
        <div className="flex items-center justify-between gap-3">
          <span className="text-sm font-mono text-neutral-200">{item.question}</span>
          <span
            className="text-xs shrink-0 transition-transform duration-200"
            style={{
              color: CYAN,
              transform: open ? 'rotate(45deg)' : 'rotate(0deg)',
            }}
          >
            +
          </span>
        </div>
        {open && (
          <motion.p
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 1 / (PHI * PHI) }}
            className="text-xs text-neutral-400 mt-2 leading-relaxed pr-6"
          >
            {item.answer}
          </motion.p>
        )}
      </button>
    </motion.div>
  )
}

// ============ Main Component ============
export default function ContactPage() {
  const [formData, setFormData] = useState({
    name: '',
    email: '',
    category: '',
    message: '',
  })
  const [errors, setErrors] = useState({})
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [submitted, setSubmitted] = useState(false)

  // ============ Validation ============
  function validate() {
    const newErrors = {}
    if (!formData.name.trim()) newErrors.name = 'Name is required'
    if (!formData.email.trim()) {
      newErrors.email = 'Email is required'
    } else if (!isValidEmail(formData.email)) {
      newErrors.email = 'Please enter a valid email address'
    }
    if (!formData.category) newErrors.category = 'Please select a category'
    if (!formData.message.trim()) {
      newErrors.message = 'Message is required'
    } else if (formData.message.trim().length < 10) {
      newErrors.message = 'Message must be at least 10 characters'
    }
    setErrors(newErrors)
    return Object.keys(newErrors).length === 0
  }

  // ============ Form Handlers ============
  function handleChange(field, value) {
    setFormData(prev => ({ ...prev, [field]: value }))
    if (errors[field]) {
      setErrors(prev => {
        const next = { ...prev }
        delete next[field]
        return next
      })
    }
  }

  async function handleSubmit(e) {
    e.preventDefault()
    if (!validate()) return

    setIsSubmitting(true)
    // Simulate submission latency
    await new Promise(r => setTimeout(r, PHI * 1000))
    setIsSubmitting(false)
    setSubmitted(true)
  }

  function handleReset() {
    setFormData({ name: '', email: '', category: '', message: '' })
    setErrors({})
    setSubmitted(false)
  }

  // ============ Shared Input Styles ============
  const inputBase =
    'w-full bg-white/[0.03] border rounded-xl px-4 py-2.5 text-sm font-mono text-white ' +
    'placeholder:text-neutral-500 outline-none transition-all duration-200 ' +
    'focus:border-cyan-500/40 focus:ring-1 focus:ring-cyan-500/20'

  function inputBorder(field) {
    return errors[field] ? 'border-red-500/40' : 'border-white/[0.08]'
  }

  // ============ Render ============
  return (
    <div className="min-h-screen pb-24">
      <PageHero
        title="Contact & Support"
        subtitle="Get help, report issues, or connect with the VibeSwap team."
        category="community"
        badge="24-48h"
        badgeColor={CYAN}
      />

      <div className="max-w-7xl mx-auto px-4">
        <motion.div
          variants={staggerContainer}
          initial="hidden"
          animate="visible"
          className="grid grid-cols-1 lg:grid-cols-5 gap-6"
        >
          {/* ============ Left Column: Contact Form ============ */}
          <motion.div variants={fadeUp} className="lg:col-span-3">
            <GlassCard glowColor="terminal" spotlight className="p-6">
              {submitted ? (
                <motion.div
                  initial={{ opacity: 0, scale: 0.95 }}
                  animate={{ opacity: 1, scale: 1 }}
                  transition={{ duration: 1 / PHI, ease: [0.25, 0.1, 1 / PHI, 1] }}
                  className="text-center py-12"
                >
                  <div
                    className="w-16 h-16 rounded-2xl mx-auto mb-4 flex items-center justify-center text-2xl"
                    style={{ backgroundColor: CYAN + '18', color: CYAN }}
                  >
                    ✓
                  </div>
                  <h3 className="text-lg font-mono font-bold text-white mb-2">
                    Message Sent
                  </h3>
                  <p className="text-sm text-neutral-400 mb-6 max-w-sm mx-auto">
                    We typically respond within 24-48 hours. For urgent security
                    issues, please use the bug bounty program below.
                  </p>
                  <button
                    onClick={handleReset}
                    className="px-5 py-2 rounded-xl text-sm font-mono border transition-colors duration-200"
                    style={{
                      borderColor: CYAN + '30',
                      color: CYAN,
                    }}
                  >
                    Send another message
                  </button>
                </motion.div>
              ) : (
                <>
                  <h2 className="text-base font-mono font-semibold text-white mb-1">
                    Send us a message
                  </h2>
                  <p className="text-xs text-neutral-400 mb-5">
                    Fields marked with <span className="text-red-400">*</span> are required.
                  </p>

                  <form onSubmit={handleSubmit} className="space-y-4">
                    {/* Name */}
                    <div>
                      <label className="block text-xs font-mono text-neutral-300 mb-1.5">
                        Name <span className="text-red-400">*</span>
                      </label>
                      <input
                        type="text"
                        value={formData.name}
                        onChange={e => handleChange('name', e.target.value)}
                        placeholder="Your name"
                        className={`${inputBase} ${inputBorder('name')}`}
                      />
                      {errors.name && (
                        <p className="text-xs text-red-400 mt-1 font-mono">{errors.name}</p>
                      )}
                    </div>

                    {/* Email */}
                    <div>
                      <label className="block text-xs font-mono text-neutral-300 mb-1.5">
                        Email <span className="text-red-400">*</span>
                      </label>
                      <input
                        type="email"
                        value={formData.email}
                        onChange={e => handleChange('email', e.target.value)}
                        placeholder="you@example.com"
                        className={`${inputBase} ${inputBorder('email')}`}
                      />
                      {errors.email && (
                        <p className="text-xs text-red-400 mt-1 font-mono">{errors.email}</p>
                      )}
                    </div>

                    {/* Category */}
                    <div>
                      <label className="block text-xs font-mono text-neutral-300 mb-1.5">
                        Category <span className="text-red-400">*</span>
                      </label>
                      <select
                        value={formData.category}
                        onChange={e => handleChange('category', e.target.value)}
                        className={`${inputBase} ${inputBorder('category')} appearance-none cursor-pointer`}
                        style={{ backgroundImage: 'none' }}
                      >
                        {CATEGORIES.map(cat => (
                          <option
                            key={cat.value}
                            value={cat.value}
                            className="bg-neutral-900 text-white"
                          >
                            {cat.label}
                          </option>
                        ))}
                      </select>
                      {errors.category && (
                        <p className="text-xs text-red-400 mt-1 font-mono">{errors.category}</p>
                      )}
                    </div>

                    {/* Message */}
                    <div>
                      <label className="block text-xs font-mono text-neutral-300 mb-1.5">
                        Message <span className="text-red-400">*</span>
                      </label>
                      <textarea
                        value={formData.message}
                        onChange={e => handleChange('message', e.target.value)}
                        placeholder="Describe your issue or question in detail..."
                        rows={5}
                        className={`${inputBase} ${inputBorder('message')} resize-none`}
                      />
                      <div className="flex items-center justify-between mt-1">
                        {errors.message ? (
                          <p className="text-xs text-red-400 font-mono">{errors.message}</p>
                        ) : (
                          <span />
                        )}
                        <span className="text-[10px] text-neutral-500 font-mono">
                          {formData.message.length} chars
                        </span>
                      </div>
                    </div>

                    {/* Security notice for security category */}
                    {formData.category === 'security' && (
                      <motion.div
                        initial={{ opacity: 0, height: 0 }}
                        animate={{ opacity: 1, height: 'auto' }}
                        transition={{ duration: 1 / (PHI * PHI) }}
                        className="px-4 py-3 rounded-xl border"
                        style={{
                          backgroundColor: 'rgba(239,68,68,0.04)',
                          borderColor: 'rgba(239,68,68,0.15)',
                        }}
                      >
                        <p className="text-xs text-red-300 font-mono leading-relaxed">
                          For critical vulnerabilities, please use our bug bounty program
                          for responsible disclosure. Do not include exploit details in
                          this form — use encrypted channels instead.
                        </p>
                      </motion.div>
                    )}

                    {/* Submit */}
                    <motion.button
                      type="submit"
                      disabled={isSubmitting}
                      whileHover={{ scale: isSubmitting ? 1 : 1.01 }}
                      whileTap={{ scale: isSubmitting ? 1 : 0.98 }}
                      transition={{ duration: 1 / (PHI * PHI * PHI) }}
                      className="w-full py-3 rounded-xl text-sm font-mono font-semibold transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed"
                      style={{
                        background: isSubmitting
                          ? 'rgba(6,182,212,0.1)'
                          : `linear-gradient(135deg, ${CYAN}22 0%, ${CYAN}08 100%)`,
                        border: `1px solid ${CYAN}30`,
                        color: CYAN,
                      }}
                    >
                      {isSubmitting ? (
                        <span className="flex items-center justify-center gap-2">
                          <motion.span
                            animate={{ rotate: 360 }}
                            transition={{ duration: PHI, repeat: Infinity, ease: 'linear' }}
                            className="inline-block w-4 h-4 border-2 rounded-full"
                            style={{ borderColor: `${CYAN}40`, borderTopColor: CYAN }}
                          />
                          Sending...
                        </span>
                      ) : (
                        'Send Message'
                      )}
                    </motion.button>
                  </form>
                </>
              )}
            </GlassCard>
          </motion.div>

          {/* ============ Right Column: Info Panels ============ */}
          <div className="lg:col-span-2 space-y-6">
            {/* Quick Links */}
            <motion.div variants={fadeUp}>
              <h2 className="text-xs font-mono uppercase tracking-wider text-neutral-500 mb-3 px-1">
                Quick Links
              </h2>
              <motion.div
                variants={staggerContainer}
                initial="hidden"
                animate="visible"
                className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-1 gap-3"
              >
                {QUICK_LINKS.map((link, i) => (
                  <QuickLinkCard key={link.title} link={link} index={i} />
                ))}
              </motion.div>
            </motion.div>

            {/* Response Time */}
            <motion.div variants={fadeUp}>
              <GlassCard glowColor="none" className="p-5">
                <div className="flex items-start gap-3">
                  <div
                    className="w-9 h-9 rounded-lg flex items-center justify-center text-sm shrink-0"
                    style={{ backgroundColor: CYAN + '12', color: CYAN }}
                  >
                    ⏱
                  </div>
                  <div>
                    <h3 className="text-sm font-mono font-semibold text-white mb-1">
                      Response Time
                    </h3>
                    <p className="text-xs text-neutral-400 leading-relaxed">
                      We typically respond within <span style={{ color: CYAN }}>24-48 hours</span>.
                      Community channels (Discord, Telegram) are fastest for general questions.
                    </p>
                  </div>
                </div>
              </GlassCard>
            </motion.div>

            {/* Bug Bounty */}
            <motion.div variants={fadeUp}>
              <GlassCard glowColor="warning" className="p-5">
                <div className="flex items-start gap-3">
                  <div
                    className="w-9 h-9 rounded-lg flex items-center justify-center text-sm shrink-0"
                    style={{ backgroundColor: 'rgba(255,170,0,0.1)', color: '#ffaa00' }}
                  >
                    ⚡
                  </div>
                  <div>
                    <h3 className="text-sm font-mono font-semibold text-white mb-1">
                      Bug Bounty Program
                    </h3>
                    <p className="text-xs text-neutral-400 leading-relaxed mb-3">
                      Found a security vulnerability? We offer rewards for responsible
                      disclosure. Critical issues may qualify for up to{' '}
                      <span className="text-amber-400 font-semibold">$50,000</span>.
                    </p>
                    <div className="space-y-1.5">
                      <div className="flex items-center gap-2 text-[11px] font-mono text-neutral-400">
                        <span className="text-amber-400">{'>'}</span>
                        Smart contract exploits
                      </div>
                      <div className="flex items-center gap-2 text-[11px] font-mono text-neutral-400">
                        <span className="text-amber-400">{'>'}</span>
                        Cross-chain messaging flaws
                      </div>
                      <div className="flex items-center gap-2 text-[11px] font-mono text-neutral-400">
                        <span className="text-amber-400">{'>'}</span>
                        Commit-reveal bypass vectors
                      </div>
                      <div className="flex items-center gap-2 text-[11px] font-mono text-neutral-400">
                        <span className="text-amber-400">{'>'}</span>
                        Oracle manipulation attacks
                      </div>
                    </div>
                    <a
                      href="https://github.com/wglynn/vibeswap/security"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-block mt-3 text-xs font-mono transition-colors duration-200"
                      style={{ color: '#ffaa00' }}
                    >
                      View bounty details →
                    </a>
                  </div>
                </div>
              </GlassCard>
            </motion.div>
          </div>
        </motion.div>

        {/* ============ FAQ Section ============ */}
        <motion.div
          variants={fadeUp}
          initial="hidden"
          animate="visible"
          className="mt-10"
        >
          <h2 className="text-xs font-mono uppercase tracking-wider text-neutral-500 mb-4 px-1">
            Common Questions
          </h2>
          <motion.div
            variants={staggerContainer}
            initial="hidden"
            animate="visible"
            className="space-y-2 max-w-3xl"
          >
            {FAQ_SHORTCUTS.map((item, i) => (
              <FAQItem key={i} item={item} index={i} />
            ))}
          </motion.div>

          {/* Full FAQ link */}
          <motion.div variants={fadeUp} className="mt-4 px-1">
            <p className="text-xs text-neutral-500 font-mono">
              Looking for more?{' '}
              <a
                href="/faq"
                className="transition-colors duration-200"
                style={{ color: CYAN }}
              >
                View the full FAQ →
              </a>
            </p>
          </motion.div>
        </motion.div>
      </div>
    </div>
  )
}
