import { useState, useMemo } from 'react'
import { Link } from 'react-router-dom'
import { motion, AnimatePresence } from 'framer-motion'
import GlassCard from './ui/GlassCard'
import PageHero from './ui/PageHero'
import { useWallet } from '../hooks/useWallet'
import { useDeviceWallet } from '../hooks/useDeviceWallet'

// ============ Constants ============

const PHI = 1.618033988749895
const CYAN = '#06b6d4'

function seededRandom(seed) {
  let s = seed
  return () => { s = (s * 16807 + 0) % 2147483647; return s / 2147483647 }
}

// ============ Course Categories ============

const CATEGORIES = [
  { id: 'all', label: 'All Courses', icon: '\u{1F4DA}' },
  { id: 'basics', label: 'DeFi Basics', icon: '\u{1F331}' },
  { id: 'trading', label: 'Advanced Trading', icon: '\u{1F4C8}' },
  { id: 'protocol', label: 'Protocol Deep Dive', icon: '\u{1F52C}' },
  { id: 'security', label: 'Security', icon: '\u{1F6E1}' },
  { id: 'governance', label: 'Governance', icon: '\u{1F3DB}' },
]

// ============ Course Data ============

const COURSES = [
  { id: 1, title: 'DeFi 101', description: 'Learn the fundamentals of decentralized finance — liquidity pools, yield, and trustless trading.', category: 'basics', difficulty: 'Beginner', lessons: 5, reward: 50, duration: '45 min', tags: ['Liquidity', 'Swaps', 'Yield'] },
  { id: 2, title: 'Understanding AMMs', description: 'Deep dive into automated market makers — constant product formula, impermanent loss, and LP strategies.', category: 'trading', difficulty: 'Intermediate', lessons: 4, reward: 75, duration: '60 min', tags: ['AMM', 'x*y=k', 'Impermanent Loss'] },
  { id: 3, title: 'MEV & Frontrunning', description: 'Understand maximal extractable value, sandwich attacks, and how commit-reveal auctions eliminate MEV.', category: 'trading', difficulty: 'Advanced', lessons: 3, reward: 100, duration: '50 min', tags: ['MEV', 'Sandwich', 'Flashbots'] },
  { id: 4, title: 'Commit-Reveal Explained', description: 'Master the cryptographic commit-reveal scheme that powers fair batch auctions on VibeSwap.', category: 'protocol', difficulty: 'Intermediate', lessons: 4, reward: 80, duration: '55 min', tags: ['Commit-Reveal', 'Hashing', 'Batches'] },
  { id: 5, title: 'Game Theory in DeFi', description: 'Explore Nash equilibria, Shapley values, mechanism design, and how incentives shape protocol behavior.', category: 'governance', difficulty: 'Advanced', lessons: 6, reward: 120, duration: '90 min', tags: ['Nash', 'Shapley', 'Mechanism Design'] },
  { id: 6, title: 'Wallet Security', description: 'Protect your assets — cold storage, seed phrases, phishing defense, and hardware wallet best practices.', category: 'security', difficulty: 'Beginner', lessons: 3, reward: 40, duration: '30 min', tags: ['Cold Storage', 'Seeds', 'Phishing'] },
]

// ============ User Progress (demo only) ============

const DEMO_PROGRESS = {
  1: { completed: 3, started: true },
  4: { completed: 4, started: true },
  6: { completed: 3, started: true },
}

// ============ Quiz Data ============

const QUIZ_QUESTION = {
  question: 'In a constant product AMM (x * y = k), what happens to the price of token X when a trader buys a large amount of X?',
  options: [
    { id: 'a', text: 'The price of X decreases because supply increases' },
    { id: 'b', text: 'The price of X increases because the reserve of X decreases' },
    { id: 'c', text: 'The price stays the same due to arbitrage' },
    { id: 'd', text: 'The price is determined by an external oracle' },
  ],
  correct: 'b',
  explanation: 'When a trader buys token X, they remove X from the pool and add Y. Since k must remain constant, reducing the X reserve increases its marginal price (price = y/x).',
}

// ============ Leaderboard — populated by real learners ============

const rng = seededRandom(42)
const LEADERBOARD = [] // Empty until real users complete courses

// ============ Platform Stats ============

const PLATFORM_STATS = [
  { label: 'Total Courses', value: String(COURSES.length), icon: '\u{1F4DA}', delta: 'More coming soon' },
  { label: 'Topics Covered', value: String([...new Set(COURSES.flatMap(c => c.tags))].length), icon: '\u{1F393}', delta: 'DeFi fundamentals' },
  { label: 'JUL Per Course', value: '40-120', icon: '\u{1FA99}', delta: 'Earn while you learn' },
  { label: 'Difficulty Levels', value: '3', icon: '\u{1F4CA}', delta: 'Beginner to Advanced' },
]

// ============ Helpers ============

const DIFFICULTY_COLORS = {
  Beginner: { bg: 'bg-green-500/15', text: 'text-green-400', border: 'border-green-500/30' },
  Intermediate: { bg: 'bg-amber-500/15', text: 'text-amber-400', border: 'border-amber-500/30' },
  Advanced: { bg: 'bg-red-500/15', text: 'text-red-400', border: 'border-red-500/30' },
}

function difficultyGlow(d) {
  return d === 'Beginner' ? 'matrix' : d === 'Intermediate' ? 'warning' : 'none'
}

function fmtNum(n) {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M'
  if (n >= 1_000) return (n / 1_000).toFixed(1) + 'K'
  return n.toString()
}

// ============ Category Filter ============

function CategoryFilter({ active, onChange }) {
  return (
    <div className="flex flex-wrap gap-2 mb-6">
      {CATEGORIES.map((cat) => (
        <button
          key={cat.id}
          onClick={() => onChange(cat.id)}
          className={`px-3 py-1.5 rounded-full text-xs font-mono transition-all duration-200 border ${
            active === cat.id
              ? 'bg-amber-500/20 text-amber-400 border-amber-500/40'
              : 'bg-black-800/40 text-black-400 border-black-700/50 hover:border-black-600 hover:text-black-300'
          }`}
        >
          <span className="mr-1.5">{cat.icon}</span>{cat.label}
        </button>
      ))}
    </div>
  )
}

// ============ Progress Bar ============

function ProgressBar({ current, total, color = CYAN }) {
  const pct = total > 0 ? (current / total) * 100 : 0
  return (
    <div className="w-full h-1.5 bg-black-800 rounded-full overflow-hidden">
      <motion.div
        className="h-full rounded-full"
        style={{ backgroundColor: color }}
        initial={{ width: 0 }}
        animate={{ width: `${pct}%` }}
        transition={{ duration: 0.8, ease: 'easeOut' }}
      />
    </div>
  )
}

// ============ Course Card ============

function CourseCard({ course, progress }) {
  const dc = DIFFICULTY_COLORS[course.difficulty]
  const isStarted = progress?.started
  const isComplete = progress && progress.completed >= course.lessons
  const done = progress?.completed || 0

  return (
    <GlassCard className="p-5" glowColor={difficultyGlow(course.difficulty)} spotlight>
      <div className="flex items-start justify-between mb-3">
        <div className={`px-2 py-0.5 rounded text-[10px] font-mono uppercase tracking-wider border ${dc.bg} ${dc.text} ${dc.border}`}>
          {course.difficulty}
        </div>
        <div className="text-amber-400 font-mono text-sm font-bold">+{course.reward} JUL</div>
      </div>
      <h3 className="text-lg font-bold mb-1.5">{course.title}</h3>
      <p className="text-xs text-black-400 mb-4 leading-relaxed line-clamp-2">{course.description}</p>
      <div className="flex items-center gap-3 text-[10px] text-black-500 font-mono mb-4">
        <span>{course.lessons} lessons</span>
        <span className="text-black-700">|</span>
        <span>{course.duration}</span>
        <span className="text-black-700">|</span>
        <span>+{course.reward} JUL reward</span>
      </div>
      <div className="flex flex-wrap gap-1.5 mb-4">
        {course.tags.map((tag) => (
          <span key={tag} className="px-1.5 py-0.5 rounded text-[9px] font-mono bg-black-800/60 text-black-500 border border-black-700/30">{tag}</span>
        ))}
      </div>
      <div className="mb-3">
        <div className="flex justify-between text-[10px] font-mono text-black-500 mb-1">
          <span>{isComplete ? 'Completed' : `${done}/${course.lessons} lessons`}</span>
          <span>{Math.round((done / course.lessons) * 100)}%</span>
        </div>
        <ProgressBar current={done} total={course.lessons} color={isComplete ? '#22c55e' : CYAN} />
      </div>
      <motion.button
        whileHover={{ scale: 1.02 }}
        whileTap={{ scale: 0.98 }}
        disabled={isComplete}
        className={`w-full py-2 rounded-lg text-sm font-semibold transition-all duration-200 ${
          isComplete
            ? 'bg-green-500/15 text-green-400 border border-green-500/30 cursor-default'
            : isStarted
            ? 'bg-amber-500/15 text-amber-300 border border-amber-500/30 hover:bg-amber-500/25'
            : 'bg-cyan-500/15 text-cyan-300 border border-cyan-500/30 hover:bg-cyan-500/25'
        }`}
      >
        {isComplete ? 'Completed' : isStarted ? 'Continue' : 'Start Course'}
      </motion.button>
    </GlassCard>
  )
}

// ============ User Progress ============

function UserProgress() {
  const completedCourses = Object.entries(MOCK_PROGRESS).filter(
    ([id, p]) => p.completed >= (COURSES.find((c) => c.id === Number(id))?.lessons || Infinity)
  ).length
  const totalJul = Object.entries(MOCK_PROGRESS).reduce((sum, [id, p]) => {
    const c = COURSES.find((c) => c.id === Number(id))
    return c && p.completed >= c.lessons ? sum + c.reward : sum
  }, 0)

  const stats = [
    { label: 'Courses Completed', value: completedCourses, icon: '\u{2705}' },
    { label: 'JUL Earned', value: `${totalJul} JUL`, icon: '\u{1FA99}' },
    { label: 'Certificates', value: completedCourses, icon: '\u{1F4DC}' },
    { label: 'Current Streak', value: '7 days', icon: '\u{1F525}' },
  ]

  return (
    <div className="mb-8">
      <h2 className="text-lg font-bold mb-4 flex items-center gap-2">
        <span className="text-amber-400">{'\u{1F4CA}'}</span> Your Progress
      </h2>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {stats.map((s) => (
          <GlassCard key={s.label} className="p-4 text-center" hover={false}>
            <div className="text-2xl mb-1">{s.icon}</div>
            <div className="text-lg font-bold font-mono" style={{ color: CYAN }}>{s.value}</div>
            <div className="text-[10px] text-black-500 font-mono mt-0.5">{s.label}</div>
          </GlassCard>
        ))}
      </div>
      <div className="mt-4">
        <h3 className="text-xs font-mono text-black-500 uppercase tracking-wider mb-2">In Progress</h3>
        <div className="flex flex-wrap gap-2">
          {Object.entries(MOCK_PROGRESS).map(([id, prog]) => {
            const course = COURSES.find((c) => c.id === Number(id))
            if (!course || prog.completed >= course.lessons) return null
            return (
              <div key={id} className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-black-800/40 border border-black-700/40 text-xs">
                <span className="text-amber-400 font-semibold">{course.title}</span>
                <span className="text-black-500 font-mono">{prog.completed}/{course.lessons}</span>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}

// ============ Quiz Section ============

function QuizSection() {
  const [selected, setSelected] = useState(null)
  const [revealed, setRevealed] = useState(false)

  const handleSelect = (id) => { if (!revealed) setSelected(id) }
  const handleCheck = () => { if (selected) setRevealed(true) }
  const handleReset = () => { setSelected(null); setRevealed(false) }

  return (
    <div className="mb-8">
      <h2 className="text-lg font-bold mb-4 flex items-center gap-2">
        <span className="text-amber-400">{'\u{1F9E9}'}</span> Quick Quiz
      </h2>
      <GlassCard className="p-6" glowColor="warning">
        <div className="flex items-center gap-2 mb-1">
          <span className="px-2 py-0.5 rounded text-[10px] font-mono uppercase bg-amber-500/15 text-amber-400 border border-amber-500/30">
            AMM Fundamentals
          </span>
          <span className="text-[10px] font-mono text-black-500">+5 XP</span>
        </div>
        <p className="text-sm font-semibold mb-4 mt-3">{QUIZ_QUESTION.question}</p>

        <div className="space-y-2 mb-4">
          {QUIZ_QUESTION.options.map((opt) => {
            let style = 'bg-black-800/40 border-black-700/50 hover:border-black-600 text-black-300'
            if (selected === opt.id && !revealed) style = 'bg-cyan-500/10 border-cyan-500/40 text-cyan-300'
            if (revealed && opt.id === QUIZ_QUESTION.correct) style = 'bg-green-500/10 border-green-500/40 text-green-300'
            if (revealed && selected === opt.id && opt.id !== QUIZ_QUESTION.correct) style = 'bg-red-500/10 border-red-500/40 text-red-300'
            return (
              <motion.button
                key={opt.id}
                whileHover={!revealed ? { scale: 1.01 } : undefined}
                whileTap={!revealed ? { scale: 0.99 } : undefined}
                onClick={() => handleSelect(opt.id)}
                className={`w-full text-left px-4 py-3 rounded-lg border text-sm transition-all duration-200 ${style}`}
              >
                <span className="font-mono text-black-500 mr-2">{opt.id.toUpperCase()}.</span>
                {opt.text}
              </motion.button>
            )
          })}
        </div>

        <AnimatePresence>
          {revealed && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              exit={{ opacity: 0, height: 0 }}
              className="mb-4 p-3 rounded-lg bg-black-800/40 border border-black-700/40"
            >
              <p className="text-xs text-black-400 leading-relaxed">
                <span className={`font-bold ${selected === QUIZ_QUESTION.correct ? 'text-green-400' : 'text-red-400'}`}>
                  {selected === QUIZ_QUESTION.correct ? 'Correct!' : 'Not quite.'}
                </span>{' '}
                {QUIZ_QUESTION.explanation}
              </p>
            </motion.div>
          )}
        </AnimatePresence>

        <div className="flex gap-2">
          {!revealed ? (
            <motion.button
              whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.98 }}
              onClick={handleCheck} disabled={!selected}
              className={`px-6 py-2 rounded-lg text-sm font-semibold transition-all duration-200 ${
                selected
                  ? 'bg-amber-500/20 text-amber-300 border border-amber-500/40 hover:bg-amber-500/30'
                  : 'bg-black-800/40 text-black-600 border border-black-700/30 cursor-not-allowed'
              }`}
            >
              Check Answer
            </motion.button>
          ) : (
            <motion.button
              whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.98 }}
              onClick={handleReset}
              className="px-6 py-2 rounded-lg text-sm font-semibold bg-cyan-500/15 text-cyan-300 border border-cyan-500/30 hover:bg-cyan-500/25 transition-all duration-200"
            >
              Try Another
            </motion.button>
          )}
        </div>
      </GlassCard>
    </div>
  )
}

// ============ Leaderboard ============

function LeaderboardSection() {
  if (LEADERBOARD.length === 0) {
    return (
      <div className="mb-8">
        <h2 className="text-lg font-bold mb-4 flex items-center gap-2">
          <span className="text-amber-400">{'\u{1F3C6}'}</span> Leaderboard
        </h2>
        <GlassCard className="p-8 text-center" hover={false}>
          <div className="text-3xl mb-3">{'\u{1F3C6}'}</div>
          <p className="text-sm text-black-300 font-medium mb-1">Be the first on the leaderboard</p>
          <p className="text-xs text-black-500 font-mono">Complete a course to earn XP and claim your spot</p>
        </GlassCard>
      </div>
    )
  }

  const maxXp = LEADERBOARD[0].xp
  return (
    <div className="mb-8">
      <h2 className="text-lg font-bold mb-4 flex items-center gap-2">
        <span className="text-amber-400">{'\u{1F3C6}'}</span> Leaderboard
      </h2>
      <GlassCard className="p-0 overflow-hidden" hover={false}>
        <div className="grid grid-cols-12 gap-2 px-4 py-2.5 text-[10px] font-mono uppercase tracking-wider text-black-500 border-b border-black-800">
          <div className="col-span-1">#</div>
          <div className="col-span-4">Learner</div>
          <div className="col-span-3 text-right">XP</div>
          <div className="col-span-2 text-right">Courses</div>
          <div className="col-span-2 text-right">Streak</div>
        </div>
        {LEADERBOARD.map((entry, i) => {
          const barPct = (entry.xp / maxXp) * 100
          const medal = i === 0 ? '\u{1F947}' : i === 1 ? '\u{1F948}' : i === 2 ? '\u{1F949}' : null
          const medalColor = i === 0 ? '#fbbf24' : i === 1 ? '#94a3b8' : i === 2 ? '#d97706' : null
          return (
            <motion.div
              key={entry.rank}
              initial={{ opacity: 0, x: -10 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: i * 0.05, duration: 0.3 }}
              className={`grid grid-cols-12 gap-2 px-4 py-3 items-center text-sm border-b border-black-800/50 last:border-b-0 ${
                i < 3 ? 'bg-amber-500/[0.03]' : ''
              } hover:bg-white/[0.02] transition-colors`}
            >
              <div className="col-span-1 font-mono text-xs" style={medalColor ? { color: medalColor } : {}}>
                {medal || entry.rank}
              </div>
              <div className="col-span-4 flex items-center gap-2">
                <span className="text-base">{entry.avatar}</span>
                <span className="font-semibold text-xs truncate">{entry.name}</span>
              </div>
              <div className="col-span-3 text-right">
                <div className="flex items-center justify-end gap-2">
                  <div className="hidden sm:block w-16 h-1 bg-black-800 rounded-full overflow-hidden">
                    <div className="h-full rounded-full bg-amber-500/60" style={{ width: `${barPct}%` }} />
                  </div>
                  <span className="font-mono text-xs text-amber-400">{fmtNum(entry.xp)}</span>
                </div>
              </div>
              <div className="col-span-2 text-right font-mono text-xs text-black-400">{entry.courses}</div>
              <div className="col-span-2 text-right font-mono text-xs text-orange-400">{entry.streak}d {'\u{1F525}'}</div>
            </motion.div>
          )
        })}
      </GlassCard>
    </div>
  )
}

// ============ Stats Bar ============

function StatsBar() {
  return (
    <div className="mb-8">
      <h2 className="text-lg font-bold mb-4 flex items-center gap-2">
        <span className="text-amber-400">{'\u{1F4E1}'}</span> Platform Stats
      </h2>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {PLATFORM_STATS.map((stat, i) => (
          <motion.div
            key={stat.label}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: i * 0.08, duration: 0.4 }}
          >
            <GlassCard className="p-4 text-center" hover={false}>
              <div className="text-2xl mb-1.5">{stat.icon}</div>
              <div className="text-xl font-bold font-mono" style={{ color: CYAN }}>{stat.value}</div>
              <div className="text-[10px] text-black-500 font-mono mt-0.5 mb-1">{stat.label}</div>
              <div className="text-[9px] text-green-500/70 font-mono">{stat.delta}</div>
            </GlassCard>
          </motion.div>
        ))}
      </div>
    </div>
  )
}

// ============ Learning Path ============

function LearningPath() {
  const steps = [
    { label: 'DeFi Basics', icon: '\u{1F331}', status: 'complete' },
    { label: 'Wallet Security', icon: '\u{1F6E1}', status: 'complete' },
    { label: 'AMM Mastery', icon: '\u{1F4C8}', status: 'active' },
    { label: 'MEV Defense', icon: '\u{1F6AB}', status: 'locked' },
    { label: 'Game Theory', icon: '\u{1F3B2}', status: 'locked' },
    { label: 'Governance Pro', icon: '\u{1F3DB}', status: 'locked' },
  ]

  return (
    <div className="mb-8">
      <h2 className="text-lg font-bold mb-4 flex items-center gap-2">
        <span className="text-amber-400">{'\u{1F5FA}'}</span> Learning Path
      </h2>
      <GlassCard className="p-5" glowColor="warning" hover={false}>
        <div className="flex items-center overflow-x-auto gap-0 pb-2">
          {steps.map((step, i) => {
            const done = step.status === 'complete'
            const active = step.status === 'active'
            const locked = step.status === 'locked'
            return (
              <div key={step.label} className="flex items-center flex-shrink-0">
                <motion.div
                  initial={{ scale: 0.8, opacity: 0 }}
                  animate={{ scale: 1, opacity: 1 }}
                  transition={{ delay: i * 0.1, duration: 0.3 }}
                  className={`flex flex-col items-center gap-1.5 px-3 ${locked ? 'opacity-40' : ''}`}
                >
                  <div className={`w-10 h-10 rounded-full flex items-center justify-center text-lg border-2 transition-all ${
                    done ? 'border-green-500/60 bg-green-500/10'
                      : active ? 'border-amber-500/60 bg-amber-500/10 animate-pulse'
                      : 'border-black-700/40 bg-black-800/40'
                  }`}>
                    {done ? '\u{2705}' : step.icon}
                  </div>
                  <span className={`text-[9px] font-mono text-center whitespace-nowrap ${
                    active ? 'text-amber-400' : done ? 'text-green-400' : 'text-black-600'
                  }`}>
                    {step.label}
                  </span>
                </motion.div>
                {i < steps.length - 1 && (
                  <div className={`w-8 h-0.5 flex-shrink-0 ${done ? 'bg-green-500/40' : 'bg-black-800'}`} />
                )}
              </div>
            )
          })}
        </div>
      </GlassCard>
    </div>
  )
}

// ============ Main Component ============

export default function EducationPage() {
  const { isConnected: isExternalConnected } = useWallet()
  const { isConnected: isDeviceConnected } = useDeviceWallet()
  const isConnected = isExternalConnected || isDeviceConnected

  const [activeCategory, setActiveCategory] = useState('all')

  const filteredCourses = useMemo(() => {
    if (activeCategory === 'all') return COURSES
    return COURSES.filter((c) => c.category === activeCategory)
  }, [activeCategory])

  return (
    <div className="min-h-screen pb-24">
      <PageHero
        title="Learn & Earn"
        subtitle="Complete interactive courses to earn JUL tokens — knowledge is the first trade"
        category="knowledge"
        badge="Live"
        badgeColor="#f59e0b"
      />

      <div className="max-w-7xl mx-auto px-4">
        {/* ============ Stats Bar ============ */}
        <StatsBar />

        {/* ============ Learning Path (connected) ============ */}
        {isConnected && <LearningPath />}

        {/* ============ Your Progress (connected) ============ */}
        {isConnected && <UserProgress />}

        {/* ============ Course Catalogue ============ */}
        <div className="mb-8">
          <h2 className="text-lg font-bold mb-4 flex items-center gap-2">
            <span className="text-amber-400">{'\u{1F4DA}'}</span> Featured Courses
          </h2>

          <CategoryFilter active={activeCategory} onChange={setActiveCategory} />

          <AnimatePresence mode="wait">
            <motion.div
              key={activeCategory}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              transition={{ duration: 1 / (PHI * PHI * PHI) }}
              className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4"
            >
              {filteredCourses.map((course) => (
                <CourseCard
                  key={course.id}
                  course={course}
                  progress={isConnected ? null : DEMO_PROGRESS[course.id]}
                />
              ))}
              {filteredCourses.length === 0 && (
                <div className="col-span-full text-center py-12 text-black-500 text-sm font-mono">
                  No courses in this category yet. Check back soon.
                </div>
              )}
            </motion.div>
          </AnimatePresence>
        </div>

        {/* ============ Quiz Section ============ */}
        <QuizSection />

        {/* ============ Leaderboard ============ */}
        <LeaderboardSection />

        {/* ============ CTA Banner ============ */}
        {!isConnected && (
          <motion.div
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.3, duration: 0.5 }}
            className="mb-8"
          >
            <GlassCard className="p-6 text-center" glowColor="warning">
              <div className="text-3xl mb-3">{'\u{1F393}'}</div>
              <h3 className="text-lg font-bold mb-2">Connect to Track Progress</h3>
              <p className="text-sm text-black-400 mb-4 max-w-md mx-auto">
                Sign in to save your progress, earn JUL rewards, and compete on the leaderboard.
                Your learning journey awaits.
              </p>
              <Link
                to="/"
                className="inline-block px-6 py-2.5 rounded-lg text-sm font-semibold bg-amber-500/20 text-amber-300 border border-amber-500/40 hover:bg-amber-500/30 transition-all duration-200"
              >
                Sign In to Start
              </Link>
            </GlassCard>
          </motion.div>
        )}
      </div>
    </div>
  )
}
