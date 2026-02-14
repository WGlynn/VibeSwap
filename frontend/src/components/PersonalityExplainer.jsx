import { useState, useMemo } from 'react'
import { motion, AnimatePresence } from 'framer-motion'

// ============================================
// ICONS
// ============================================

const Icons = {
  casual: (
    <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
      <circle cx="12" cy="12" r="9" />
      <path d="M9 12l2 2 4-4" />
    </svg>
  ),
  active: (
    <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
      <path d="M3 17l6-6 4 4 8-8M15 7h6v6" />
    </svg>
  ),
  saver: (
    <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
      <path d="M12 2v20M17 5H9.5a3.5 3.5 0 000 7h5a3.5 3.5 0 010 7H6" />
    </svg>
  ),
  curious: (
    <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
      <circle cx="12" cy="12" r="9" />
      <path d="M12 8v4l2 2" />
    </svg>
  ),
  lens: (
    <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
      <circle cx="12" cy="12" r="3" />
      <path d="M12 5v2M12 17v2M5 12h2M17 12h2" />
    </svg>
  ),
}

// ============================================
// USER PROFILES
// ============================================

const profiles = {
  casual: {
    id: 'casual',
    label: 'just trying it out',
    icon: 'casual',
    description: 'I want to swap some tokens',
  },
  active: {
    id: 'active',
    label: 'I trade regularly',
    icon: 'active',
    description: 'I want better prices on my trades',
  },
  saver: {
    id: 'saver',
    label: 'I want to save money',
    icon: 'saver',
    description: 'Show me the savings',
  },
  curious: {
    id: 'curious',
    label: 'I want to understand how it works',
    icon: 'curious',
    description: 'Tell me the details',
  },
}

// ============================================
// QUESTIONS - Including crypto comprehension
// ============================================

const questions = [
  // Crypto comprehension questions (score 0-2 each, total 0-6)
  {
    id: 'crypto1',
    type: 'crypto',
    text: 'have you used a crypto wallet before?',
    options: [
      { text: "no, I'm completely new to this", score: 0 },
      { text: "yes, I've done a few transactions", score: 1 },
      { text: 'yes, I use wallets regularly', score: 2 },
    ],
  },
  {
    id: 'crypto2',
    type: 'crypto',
    text: 'how familiar are you with token swapping?',
    options: [
      { text: "I don't know what that means", score: 0 },
      { text: "I've heard of it but haven't done it much", score: 1 },
      { text: "I swap tokens often on exchanges like Uniswap", score: 2 },
    ],
  },
  {
    id: 'crypto3',
    type: 'crypto',
    text: 'do you know what happens when you trade on a decentralized exchange?',
    options: [
      { text: 'not really, I just want my tokens', score: 0 },
      { text: 'I know there are fees and sometimes slippage', score: 1 },
      { text: 'I understand liquidity pools, AMMs, and gas fees', score: 2 },
    ],
  },
  // Personality dimension questions
  // E/I: Social vs Independent
  {
    id: 'p1',
    type: 'personality',
    dimension: 'EI',
    text: 'when making money decisions, you usually:',
    options: [
      { text: 'talk it through with others', value: 'E' },
      { text: 'research on your own', value: 'I' },
    ],
  },
  // S/N: Practical vs Theoretical
  {
    id: 'p2',
    type: 'personality',
    dimension: 'SN',
    text: 'when learning about a new tool, you prefer:',
    options: [
      { text: 'step-by-step instructions to get started', value: 'S' },
      { text: 'understanding how it works first', value: 'N' },
    ],
  },
  // T/F: Logic vs Values
  {
    id: 'p3',
    type: 'personality',
    dimension: 'TF',
    text: 'unfair fees bother you because:',
    options: [
      { text: "it's money I should keep", value: 'T' },
      { text: "it's wrong to take advantage of people", value: 'F' },
    ],
  },
  // J/P: Planned vs Flexible
  {
    id: 'p4',
    type: 'personality',
    dimension: 'JP',
    text: 'when trading, you prefer to:',
    options: [
      { text: 'have a clear plan before you start', value: 'J' },
      { text: 'stay flexible and adapt as you go', value: 'P' },
    ],
  },
  // ============================================
  // RSP COGNITIVE PROFILE DIMENSIONS
  // Rosetta Stone Protocol — cognitive fingerprint
  // ============================================
  // Technical depth tolerance (general, not crypto-specific)
  {
    id: 'rsp1',
    type: 'rsp',
    dimension: 'technicalDepth',
    text: 'when you hit a concept you don\'t know:',
    options: [
      { text: 'just tell me what it does, skip the details', value: 1 },
      { text: 'give me enough to get the gist', value: 2 },
      { text: 'I want to understand the mechanism', value: 4 },
      { text: 'show me the math, code, or proof', value: 5 },
    ],
  },
  // Preferred analogy domain
  {
    id: 'rsp2',
    type: 'rsp',
    dimension: 'analogyDomain',
    text: 'which comparison clicks fastest for you?',
    options: [
      { text: '"it\'s like a machine with parts"', value: 'mechanical' },
      { text: '"it\'s like a team working together"', value: 'social' },
      { text: '"it\'s like a market or economy"', value: 'financial' },
      { text: '"it\'s like a living organism"', value: 'biological' },
    ],
  },
  // Humor modality
  {
    id: 'rsp3',
    type: 'rsp',
    dimension: 'humorMode',
    text: 'what actually makes you laugh?',
    options: [
      { text: 'deadpan, understated delivery', value: 'dry' },
      { text: 'the weirder the better', value: 'absurdist' },
      { text: 'sharp references and callbacks', value: 'referential' },
      { text: 'honestly, just give me the info straight', value: 'none' },
    ],
  },
  // Attention architecture
  {
    id: 'rsp4',
    type: 'rsp',
    dimension: 'attentionStyle',
    text: 'when you open a long document:',
    options: [
      { text: 'I read front to back, give me the full picture', value: 'deep-dive' },
      { text: 'I skip to the summary, then decide if I need more', value: 'executive' },
    ],
  },
  // Trust signals
  {
    id: 'rsp5',
    type: 'rsp',
    dimension: 'trustSignal',
    text: 'what convinces you something is legit?',
    options: [
      { text: 'show me the numbers and data', value: 'data' },
      { text: 'who built it and what\'s their track record?', value: 'credentials' },
      { text: 'tell me the story — why it exists', value: 'narrative' },
      { text: 'show me who else is using it', value: 'social-proof' },
    ],
  },
]

// ============================================
// ARCHETYPES - Personality type names
// ============================================

const archetypes = {
  // 16 possible combinations with protocol alignment scores
  // Alignment based on: cooperative values (F), understanding mechanisms (N), community (E), structure (J)
  'ESTJ': { name: 'The Executive', desc: 'practical, organized, results-driven', alignment: 55 },
  'ESTP': { name: 'The Operator', desc: 'action-oriented, adaptable, quick to execute', alignment: 50 },
  'ESFJ': { name: 'The Advocate', desc: 'community-minded, supportive, values fairness', alignment: 85 },
  'ESFP': { name: 'The Explorer', desc: 'curious, spontaneous, enjoys the journey', alignment: 60 },
  'ENTJ': { name: 'The Strategist', desc: 'visionary, decisive, big-picture thinker', alignment: 70 },
  'ENTP': { name: 'The Innovator', desc: 'inventive, debates ideas, seeks new angles', alignment: 75 },
  'ENFJ': { name: 'The Mentor', desc: 'inspiring, principled, helps others grow', alignment: 95 },
  'ENFP': { name: 'The Catalyst', desc: 'enthusiastic, values-driven, sees possibilities', alignment: 90 },
  'ISTJ': { name: 'The Analyst', desc: 'thorough, methodical, trusts the data', alignment: 60 },
  'ISTP': { name: 'The Mechanic', desc: 'logical, hands-on, figures things out', alignment: 55 },
  'ISFJ': { name: 'The Guardian', desc: 'careful, reliable, protects what matters', alignment: 75 },
  'ISFP': { name: 'The Artisan', desc: 'authentic, flexible, follows personal values', alignment: 70 },
  'INTJ': { name: 'The Architect', desc: 'strategic, independent, builds systems', alignment: 65 },
  'INTP': { name: 'The Theorist', desc: 'analytical, curious, loves understanding why', alignment: 70 },
  'INFJ': { name: 'The Visionary', desc: 'insightful, principled, seeks deeper meaning', alignment: 85 },
  'INFP': { name: 'The Idealist', desc: 'empathetic, authentic, guided by values', alignment: 80 },
}

// ============================================
// XP & LEVELING SYSTEM
// Protocol alignment = XP multiplier for all earnings
// Behavior score = Shapley counterfactual (can go negative)
// ============================================

const BASE_XP_PER_CRYPTO_LEVEL = 100 // Base XP per crypto level
const BASE_XP_PER_STRENGTH = 5 // Base XP per % dimension strength above 50

// Behavior score explanation for UI
const BEHAVIOR_SCORES = {
  cooperative: { min: 80, label: 'Highly Cooperative', color: 'text-matrix-500', modifier: 1.2 },
  positive: { min: 50, label: 'Positive Contributor', color: 'text-green-400', modifier: 1.0 },
  neutral: { min: 0, label: 'Neutral', color: 'text-black-400', modifier: 0.8 },
  extractive: { min: -50, label: 'Extractive Tendency', color: 'text-orange-400', modifier: 0.5 },
  harmful: { min: -Infinity, label: 'Shapley Debt', color: 'text-red-400', modifier: 0 },
}

function getBehaviorTier(score) {
  if (score >= 80) return BEHAVIOR_SCORES.cooperative
  if (score >= 50) return BEHAVIOR_SCORES.positive
  if (score >= 0) return BEHAVIOR_SCORES.neutral
  if (score >= -50) return BEHAVIOR_SCORES.extractive
  return BEHAVIOR_SCORES.harmful
}

const levels = [
  { level: 1, xpRequired: 0, title: 'Newcomer', color: 'text-black-400' },
  { level: 2, xpRequired: 150, title: 'Curious', color: 'text-black-300' },
  { level: 3, xpRequired: 350, title: 'Initiate', color: 'text-blue-400' },
  { level: 4, xpRequired: 600, title: 'Contributor', color: 'text-green-400' },
  { level: 5, xpRequired: 900, title: 'Cooperator', color: 'text-teal-400' },
  { level: 6, xpRequired: 1250, title: 'Aligned', color: 'text-cyan-400' },
  { level: 7, xpRequired: 1650, title: 'Vibe Keeper', color: 'text-matrix-400' },
  { level: 8, xpRequired: 2100, title: 'Protocol Native', color: 'text-matrix-500' },
  { level: 9, xpRequired: 2600, title: 'Collective Mind', color: 'text-purple-400' },
  { level: 10, xpRequired: 3150, title: 'Vibe Master', color: 'text-yellow-400' },
]

// Convert alignment % to multiplier (50% = 1.0x, 100% = 2.0x)
function getAlignmentMultiplier(alignment) {
  // 50% alignment = 1.0x, 75% = 1.5x, 100% = 2.0x
  return 0.5 + (alignment / 100)
}

function calculateXP(alignment, cryptoLevel, dimensionStrengths) {
  // Calculate base XP from activities
  let baseXP = 0

  // XP from crypto knowledge (main source)
  baseXP += cryptoLevel * BASE_XP_PER_CRYPTO_LEVEL

  // XP from dimension clarity (conviction bonus)
  const strengths = Object.values(dimensionStrengths)
  if (strengths.length > 0) {
    const avgStrength = strengths.reduce((a, b) => a + b, 0) / strengths.length
    baseXP += Math.max(0, (avgStrength - 50)) * BASE_XP_PER_STRENGTH
  }

  // Apply alignment multiplier
  const multiplier = getAlignmentMultiplier(alignment)

  // Calculate behavior score (Shapley counterfactual simulation)
  // For new users, this starts positive based on alignment
  // In a real system, this would track actual on-chain behavior
  const behaviorScore = Math.floor(alignment * 0.8 + (cryptoLevel * 5))
  const behaviorTier = getBehaviorTier(behaviorScore)

  // Behavior modifier affects final XP
  const behaviorModifier = behaviorTier.modifier

  // If in Shapley debt (negative behavior), XP is frozen until repaid
  const totalXP = behaviorScore < 0
    ? 0 // Frozen - must repay debt first
    : Math.floor(baseXP * multiplier * behaviorModifier)

  return {
    baseXP,
    multiplier,
    behaviorScore,
    behaviorTier,
    behaviorModifier,
    totalXP: Math.min(totalXP, 3500), // Cap at 3500
  }
}

function getLevel(xp) {
  let currentLevel = levels[0]
  for (const level of levels) {
    if (xp >= level.xpRequired) {
      currentLevel = level
    } else {
      break
    }
  }
  return currentLevel
}

function getNextLevel(xp) {
  for (const level of levels) {
    if (xp < level.xpRequired) {
      return level
    }
  }
  return null // Max level
}

function getXPProgress(xp) {
  const current = getLevel(xp)
  const next = getNextLevel(xp)
  if (!next) return 100 // Max level

  const xpInCurrentLevel = xp - current.xpRequired
  const xpNeededForNext = next.xpRequired - current.xpRequired
  return Math.floor((xpInCurrentLevel / xpNeededForNext) * 100)
}

// ============================================
// ADAPTIVE CONTENT BY COMPREHENSION LEVEL
// Level 1-2: Complete beginner
// Level 3-4: Some knowledge
// Level 5-6: Advanced user
// ============================================

const getAdaptiveContent = (profile, cryptoLevel) => {
  // Level 1-2: Simplest explanations
  if (cryptoLevel <= 2) {
    const content = {
      casual: {
        title: 'the basics',
        sections: [
          {
            heading: 'what is this?',
            content: 'VibeSwap is a place to exchange one type of digital money for another. Like exchanging dollars for euros, but for crypto.',
          },
          {
            heading: 'why is it better?',
            content: 'You keep more of your money. Other places have hidden costs that take from your trades. Here, everyone pays the same fair price.',
          },
          {
            heading: 'is it safe?',
            content: "Your money stays in your control the whole time. No account needed, no personal information required.",
          },
        ],
      },
      active: {
        title: 'better trades',
        sections: [
          {
            heading: 'fairer prices',
            content: 'Your trade stays private until it happens. This stops others from taking advantage of your order.',
          },
          {
            heading: 'save money',
            content: 'You could save $2-10 for every $1,000 you trade compared to other places.',
          },
          {
            heading: 'how it works',
            content: 'Trades happen every 10 seconds. Everyone who trades in that window gets the same fair price.',
          },
        ],
      },
      saver: {
        title: 'more money for you',
        sections: [
          {
            heading: 'the problem elsewhere',
            content: 'On other exchanges, computer programs can see your trade and jump ahead of you to make money off your order.',
          },
          {
            heading: 'our solution',
            content: "Your trade is kept secret until everyone's trades happen together. No one can take advantage.",
          },
          {
            heading: 'your savings',
            content: 'Trade $1,000 and keep an extra $2-10. Trade regularly and it adds up to hundreds saved per year.',
          },
        ],
      },
      curious: {
        title: 'how it works',
        sections: [
          {
            heading: 'group trades',
            content: 'Instead of trading one at a time, orders are collected for 10 seconds and processed together.',
          },
          {
            heading: 'private orders',
            content: 'Your order is hidden until trading time. No one can see what you want to trade.',
          },
          {
            heading: 'same price for all',
            content: 'Everyone trading in the same 10-second window gets the exact same price. No advantage for being faster.',
          },
        ],
        note: 'Want more technical details? The docs section has everything.',
      },
    }
    return content[profile] || content.casual
  }

  // Level 3-4: Intermediate explanations
  if (cryptoLevel <= 4) {
    const content = {
      casual: {
        title: 'the basics',
        sections: [
          {
            heading: 'what is VibeSwap?',
            content: 'A decentralized exchange where trades are batched together. You get fair prices because no one can front-run your order.',
          },
          {
            heading: 'why use it?',
            content: 'No MEV extraction. Your orders are hidden until execution, so bots can\'t sandwich you or front-run your trades.',
          },
          {
            heading: 'how safe is it?',
            content: 'Non-custodial - tokens stay in your wallet until the swap executes. Standard smart contract security.',
          },
        ],
      },
      active: {
        title: 'better execution',
        sections: [
          {
            heading: 'no front-running',
            content: 'Commit-reveal mechanism hides your order until the batch settles. MEV bots can\'t see your pending trades.',
          },
          {
            heading: 'uniform clearing price',
            content: 'All orders in a batch execute at one price. No slippage from order sequence.',
          },
          {
            heading: 'batch timing',
            content: '10-second batches. 8 seconds to commit, 2 seconds to reveal. Predictable execution.',
          },
        ],
      },
      saver: {
        title: 'keep your alpha',
        sections: [
          {
            heading: 'the MEV problem',
            content: 'On Uniswap, searchers extract value from your trades via sandwich attacks and front-running. This costs retail traders millions yearly.',
          },
          {
            heading: 'commit-reveal protection',
            content: 'Your order is hashed until reveal. No one sees trade details until execution. Sandwich attacks become impossible.',
          },
          {
            heading: 'real savings',
            content: 'Typical savings: 0.1-0.5% per trade. Active traders save hundreds to thousands per year.',
          },
        ],
      },
      curious: {
        title: 'the mechanism',
        sections: [
          {
            heading: 'batch auctions',
            content: 'Orders collected over 10 seconds, executed at uniform clearing price. Eliminates timing games and sequence-dependent MEV.',
          },
          {
            heading: 'commit-reveal',
            content: 'Commit phase: submit hash(order || secret). Reveal phase: submit order + secret. Invalid reveals forfeit 50% collateral.',
          },
          {
            heading: 'fair ordering',
            content: 'Fisher-Yates shuffle using XORed trader secrets. Deterministic but unpredictable ordering.',
          },
        ],
        note: 'Check the docs for smart contract details and integration guides.',
      },
    }
    return content[profile] || content.casual
  }

  // Level 5-6: Advanced/technical explanations
  const advancedContent = {
    casual: {
      title: 'MEV-protected trading',
      sections: [
        {
          heading: 'architecture',
          content: 'Commit-reveal batch auctions with uniform clearing prices. UUPS upgradeable contracts on OpenZeppelin v5.0.1.',
        },
        {
          heading: 'MEV elimination',
          content: 'Cryptographic hiding eliminates information asymmetry. Sandwich attacks, front-running, and JIT liquidity are structurally impossible.',
        },
        {
          heading: 'cross-chain',
          content: 'LayerZero V2 OApp protocol for unified liquidity across ETH, ARB, OP, BASE, POLYGON.',
        },
      ],
    },
    active: {
      title: 'execution quality',
      sections: [
        {
          heading: 'batch mechanics',
          content: '10s batches: 8s commit, 2s reveal. 5% collateral, 50% slashing for invalid reveals. Priority bidding for execution order.',
        },
        {
          heading: 'price discovery',
          content: 'Uniform clearing price computed via batch-optimal matching. TWAP validation with 5% deviation limits prevents oracle manipulation.',
        },
        {
          heading: 'LP dynamics',
          content: 'Constant product AMM (x*y=k). IL protection via mutualized insurance pools. Shapley value distribution for fair reward allocation.',
        },
      ],
    },
    saver: {
      title: 'value capture',
      sections: [
        {
          heading: 'MEV landscape',
          content: 'Commit-reveal eliminates intra-batch MEV. Cross-batch arbitrage remains but is non-extractive (aligns prices with external markets).',
        },
        {
          heading: 'fee structure',
          content: '~0.05% LP fees. No protocol extraction. Shapley-based rewards ensure fees flow to value-adding participants.',
        },
        {
          heading: 'quantified savings',
          content: 'Typical MEV cost on Uniswap: 0.1-1% per trade. VibeSwap: 0%. For $100K annual volume, that\'s $100-1000 saved.',
        },
      ],
    },
    curious: {
      title: 'mechanism design',
      sections: [
        {
          heading: 'game theory',
          content: 'IIA (Intrinsically Incentivized Altruism): Nash equilibrium is honest participation. Extraction strategies are undefined in the action space.',
        },
        {
          heading: 'cryptographic primitives',
          content: 'Commitments: keccak256(abi.encodePacked(order, secret)). Shuffle: Fisher-Yates with seed = XOR(all_secrets). Deterministic, manipulation-resistant.',
        },
        {
          heading: 'welfare properties',
          content: 'Uniform clearing achieves Pareto efficiency. Shapley distribution ensures marginal contribution = reward. Multilevel selection favors cooperative pools.',
        },
      ],
      note: 'Full mechanism spec in the whitepaper. Contract source verified on Etherscan.',
    },
  }
  return advancedContent[profile] || advancedContent.casual
}

// ============================================
// ADAPTIVE TIPS BY COMPREHENSION LEVEL
// ============================================

const getAdaptiveTips = (cryptoLevel) => {
  if (cryptoLevel <= 2) {
    return [
      {
        hook: 'new to crypto?',
        message: "That's okay! VibeSwap works the same for everyone. Just connect your wallet, pick your tokens, and trade.",
      },
      {
        hook: 'worried about mistakes?',
        message: "You can always start with a small amount to get comfortable. Your tokens stay safe in your wallet until the trade happens.",
      },
    ]
  }

  if (cryptoLevel <= 4) {
    return [
      {
        hook: 'familiar with DEXs?',
        message: "VibeSwap works like Uniswap, but your orders are hidden until execution. No more watching your trade get sandwiched.",
      },
      {
        hook: 'active trader?',
        message: 'Batch auctions mean you can submit anytime in the 10-second window. No racing, no priority gas auctions.',
      },
    ]
  }

  // Level 5-6
  return [
    {
      hook: 'power user?',
      message: 'Priority bidding available for execution order preference. Check the docs for integration APIs and contract ABIs.',
    },
    {
      hook: 'LP opportunities',
      message: 'Provide liquidity without toxic flow. Batch auctions filter informed order flow that typically causes IL.',
    },
  ]
}

// ============================================
// COMPONENT
// ============================================

function PersonalityExplainer({ onComplete }) {
  const [stage, setStage] = useState('intro')
  const [currentQuestion, setCurrentQuestion] = useState(0)
  const [answers, setAnswers] = useState({})
  const [selectedProfile, setSelectedProfile] = useState(null)
  const [dimensionStrengths, setDimensionStrengths] = useState({})
  // RSP Cognitive Profile state
  const [cognitiveProfile, setCognitiveProfile] = useState({})

  // Calculate crypto comprehension score (0-6)
  const cryptoScore = useMemo(() => {
    let score = 0
    Object.entries(answers).forEach(([qId, value]) => {
      const question = questions.find(q => q.id === qId)
      if (question?.type === 'crypto') {
        score += value
      }
    })
    return score
  }, [answers])

  // Map 0-6 score to 1-6 level
  const cryptoLevel = Math.max(1, cryptoScore)

  // Calculate personality type code (e.g., "INTJ")
  const personalityCode = useMemo(() => {
    const dimensions = { EI: null, SN: null, TF: null, JP: null }

    Object.entries(answers).forEach(([qId, value]) => {
      const question = questions.find(q => q.id === qId)
      if (question?.type === 'personality' && question.dimension) {
        dimensions[question.dimension] = value
      }
    })

    // Build the 4-letter code
    const code = [
      dimensions.EI || 'I',
      dimensions.SN || 'N',
      dimensions.TF || 'T',
      dimensions.JP || 'J',
    ].join('')

    return code
  }, [answers])

  // Get archetype for the personality code
  const archetype = archetypes[personalityCode] || archetypes['INTJ']

  const result = useMemo(() => {
    if (stage !== 'result') return null

    const adaptiveContent = getAdaptiveContent(selectedProfile, cryptoLevel)
    const adaptiveTips = getAdaptiveTips(cryptoLevel)

    const dims = {
      EI: { letter: personalityCode[0], label: personalityCode[0] === 'E' ? 'Social' : 'Independent', strength: dimensionStrengths.EI || 70 },
      SN: { letter: personalityCode[1], label: personalityCode[1] === 'S' ? 'Practical' : 'Theoretical', strength: dimensionStrengths.SN || 70 },
      TF: { letter: personalityCode[2], label: personalityCode[2] === 'T' ? 'Logical' : 'Values-driven', strength: dimensionStrengths.TF || 70 },
      JP: { letter: personalityCode[3], label: personalityCode[3] === 'J' ? 'Planned' : 'Flexible', strength: dimensionStrengths.JP || 70 },
    }

    // Calculate XP and level
    const alignment = archetype.alignment
    const xpData = calculateXP(alignment, cryptoLevel, dimensionStrengths)
    const level = getLevel(xpData.totalXP)
    const nextLevel = getNextLevel(xpData.totalXP)
    const xpProgress = getXPProgress(xpData.totalXP)

    // Build RSP Cognitive Profile vector
    const cp = {
      technicalDepth: cognitiveProfile.technicalDepth || (cryptoLevel <= 2 ? 1 : cryptoLevel <= 4 ? 3 : 5),
      analogyDomain: cognitiveProfile.analogyDomain || 'financial',
      humorMode: cognitiveProfile.humorMode || 'none',
      abstractionComfort: personalityCode[1] === 'N' ? 'principles-first' : 'concrete-first',
      attentionStyle: cognitiveProfile.attentionStyle || 'executive',
      trustSignal: cognitiveProfile.trustSignal || 'data',
      domainFamiliarity: {
        crypto: cryptoLevel,
        finance: cryptoLevel >= 3 ? 'familiar' : 'basic',
      },
    }

    return {
      profile: selectedProfile,
      cryptoLevel,
      personalityCode,
      archetype,
      dimensions: dims,
      alignment,
      baseXP: xpData.baseXP,
      multiplier: xpData.multiplier,
      behaviorScore: xpData.behaviorScore,
      behaviorTier: xpData.behaviorTier,
      behaviorModifier: xpData.behaviorModifier,
      xp: xpData.totalXP,
      level,
      nextLevel,
      xpProgress,
      cognitiveProfile: cp,
      ...adaptiveContent,
      tips: adaptiveTips,
    }
  }, [stage, selectedProfile, cryptoLevel, personalityCode, archetype, dimensionStrengths, cognitiveProfile])

  const handleAnswer = (value, optionIndex) => {
    const question = questions[currentQuestion]

    // For crypto questions, value is the score number
    // For personality questions, value is the letter (E, I, S, N, etc.)
    // For RSP questions, value is the dimension value
    const newAnswers = { ...answers, [question.id]: value }
    setAnswers(newAnswers)

    // For personality questions, generate a "strength" (how clearly they lean that way)
    // In a real app this would come from more nuanced questions
    if (question.type === 'personality' && question.dimension) {
      const baseStrength = 60 + Math.floor(Math.random() * 35) // 60-95%
      setDimensionStrengths(prev => ({
        ...prev,
        [question.dimension]: baseStrength,
      }))
    }

    // For RSP cognitive dimension questions, store in cognitive profile
    if (question.type === 'rsp' && question.dimension) {
      setCognitiveProfile(prev => ({
        ...prev,
        [question.dimension]: value,
      }))
    }

    if (currentQuestion < questions.length - 1) {
      setCurrentQuestion(prev => prev + 1)
    } else {
      setStage('result')
    }
  }

  const handleProfileSelect = (profileId) => {
    setSelectedProfile(profileId)
    setStage('questions')
  }

  const reset = () => {
    setStage('intro')
    setCurrentQuestion(0)
    setAnswers({})
    setSelectedProfile(null)
    setCognitiveProfile({})
  }

  const cryptoQuestions = questions.filter(q => q.type === 'crypto')
  const personalityQuestions = questions.filter(q => q.type === 'personality')
  const currentQ = questions[currentQuestion]
  const isCryptoQuestion = currentQ?.type === 'crypto'

  return (
    <div className="w-full max-w-2xl mx-auto">
      <AnimatePresence mode="wait">
        {/* INTRO */}
        {stage === 'intro' && (
          <motion.div
            key="intro"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -20 }}
            className="text-center"
          >
            <div className="w-16 h-16 mx-auto mb-6 rounded-lg bg-black-700 border border-matrix-500/30 flex items-center justify-center text-matrix-500">
              {Icons.lens}
            </div>
            <h2 className="text-2xl font-bold mb-3">
              see VibeSwap <span className="text-matrix-500">your way</span>
            </h2>
            <p className="text-sm text-black-400 mb-6 max-w-md mx-auto">
              Answer a few quick questions. We'll explain VibeSwap at the right level for you.
            </p>
            <motion.button
              whileHover={{ scale: 1.02 }}
              whileTap={{ scale: 0.98 }}
              onClick={() => setStage('profile')}
              className="px-6 py-3 rounded-lg font-semibold bg-matrix-600 hover:bg-matrix-500 text-black-900 border border-matrix-500 transition-colors"
            >
              get started
            </motion.button>
            <p className="text-[10px] text-black-500 mt-4">
              takes less than a minute
            </p>
          </motion.div>
        )}

        {/* PROFILE SELECTION */}
        {stage === 'profile' && (
          <motion.div
            key="profile"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -20 }}
          >
            <div className="text-center mb-6">
              <p className="text-xs text-black-500 mb-2">step 1 of 2</p>
              <h3 className="text-xl font-bold mb-2">what brings you here?</h3>
              <p className="text-sm text-black-400">pick what fits best</p>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {Object.values(profiles).map((profile) => (
                <motion.button
                  key={profile.id}
                  whileHover={{ scale: 1.02 }}
                  whileTap={{ scale: 0.98 }}
                  onClick={() => handleProfileSelect(profile.id)}
                  className="p-4 rounded-lg bg-black-800 border border-black-500 hover:border-matrix-500/50 text-left transition-colors group"
                >
                  <div className="flex items-start space-x-3">
                    <span className="text-matrix-500 mt-0.5">{Icons[profile.icon]}</span>
                    <div>
                      <div className="text-sm font-medium group-hover:text-matrix-500 transition-colors">
                        {profile.label}
                      </div>
                      <div className="text-xs text-black-500">{profile.description}</div>
                    </div>
                  </div>
                </motion.button>
              ))}
            </div>

            <div className="mt-6 text-center">
              <button
                onClick={() => setStage('intro')}
                className="text-xs text-black-500 hover:text-black-300 transition-colors"
              >
                back
              </button>
            </div>
          </motion.div>
        )}

        {/* QUESTIONS */}
        {stage === 'questions' && currentQ && (
          <motion.div
            key={`question-${currentQuestion}`}
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -20 }}
            className="text-center"
          >
            <p className="text-xs text-black-500 mb-2">
              step 2 of 2
            </p>
            <p className="text-[10px] text-black-600 mb-4">
              {isCryptoQuestion ? 'understanding your experience' : currentQ?.type === 'rsp' ? 'building your cognitive profile' : 'understanding your style'}
            </p>

            {/* Progress */}
            <div className="flex items-center justify-center space-x-1 mb-8">
              {questions.map((_, i) => (
                <div
                  key={i}
                  className={`h-1 rounded-full transition-all duration-300 ${
                    i === currentQuestion
                      ? 'w-6 bg-matrix-500'
                      : i < currentQuestion
                      ? 'w-2 bg-matrix-500/50'
                      : 'w-2 bg-black-600'
                  }`}
                />
              ))}
            </div>

            {/* Question */}
            <h3 className="text-xl font-bold mb-8">
              {currentQ.text}
            </h3>

            {/* Options */}
            <div className="space-y-3">
              {currentQ.options.map((option, i) => (
                <motion.button
                  key={i}
                  whileHover={{ scale: 1.01 }}
                  whileTap={{ scale: 0.99 }}
                  onClick={() => handleAnswer(option.score ?? option.value, i)}
                  className="w-full p-4 rounded-lg bg-black-800 border border-black-500 hover:border-matrix-500/50 text-left transition-colors"
                >
                  <span className="text-sm">{option.text}</span>
                </motion.button>
              ))}
            </div>

            <div className="mt-6 flex justify-center space-x-4">
              {currentQuestion > 0 && (
                <button
                  onClick={() => setCurrentQuestion(prev => prev - 1)}
                  className="text-xs text-black-500 hover:text-black-300 transition-colors"
                >
                  back
                </button>
              )}
            </div>
          </motion.div>
        )}

        {/* RESULT */}
        {stage === 'result' && result && (
          <motion.div
            key="result"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -20 }}
          >
            {/* Level & XP Header */}
            <motion.div
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              className="mb-6 p-4 rounded-lg bg-gradient-to-br from-black-800 to-black-900 border border-matrix-500/30"
            >
              {/* Level Badge */}
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center space-x-3">
                  <div className="w-12 h-12 rounded-lg bg-matrix-500/20 border border-matrix-500/50 flex items-center justify-center">
                    <span className="text-xl font-bold text-matrix-500">{result.level.level}</span>
                  </div>
                  <div>
                    <div className={`text-sm font-bold ${result.level.color}`}>
                      {result.level.title}
                    </div>
                    <div className="text-xs text-black-500">
                      {result.xp.toLocaleString()} XP total
                    </div>
                  </div>
                </div>
                {/* Multiplier Badge */}
                <div className="text-right">
                  <div className="inline-flex items-center space-x-1 px-2 py-1 rounded bg-matrix-500/20 border border-matrix-500/40">
                    <span className="text-lg font-bold text-matrix-400">{result.multiplier.toFixed(1)}x</span>
                  </div>
                  <div className="text-[10px] text-black-500 mt-1">XP multiplier</div>
                </div>
              </div>

              {/* XP Breakdown */}
              <div className="mb-3 p-2 rounded bg-black-900/50 border border-black-700">
                <div className="flex items-center justify-between text-xs">
                  <span className="text-black-500">base XP earned</span>
                  <span className="text-black-300 font-mono">{result.baseXP}</span>
                </div>
                <div className="flex items-center justify-between text-xs mt-1">
                  <span className="text-black-500">alignment bonus ({result.alignment}%)</span>
                  <span className="text-matrix-500 font-mono">× {result.multiplier.toFixed(1)}</span>
                </div>
                <div className="flex items-center justify-between text-xs mt-1">
                  <span className="text-black-500">behavior modifier</span>
                  <span className={`font-mono ${result.behaviorTier.color}`}>× {result.behaviorModifier.toFixed(1)}</span>
                </div>
                <div className="border-t border-black-700 mt-2 pt-2 flex items-center justify-between text-sm">
                  <span className="text-black-400 font-medium">total XP</span>
                  <span className="text-matrix-400 font-bold font-mono">{result.xp.toLocaleString()}</span>
                </div>
              </div>

              {/* Behavior Score (Shapley Counterfactual) */}
              <div className="mb-2 p-2 rounded bg-black-900/50 border border-black-700">
                <div className="flex items-center justify-between">
                  <div className="flex items-center space-x-2">
                    <span className="text-xs text-black-500">behavior score</span>
                    <span className="text-[10px] text-black-600">(shapley counterfactual)</span>
                  </div>
                  <div className="flex items-center space-x-2">
                    <span className={`text-sm font-bold font-mono ${result.behaviorTier.color}`}>
                      {result.behaviorScore > 0 ? '+' : ''}{result.behaviorScore}
                    </span>
                    <span className={`text-[10px] px-1.5 py-0.5 rounded ${result.behaviorTier.color} bg-black-800`}>
                      {result.behaviorTier.label}
                    </span>
                  </div>
                </div>
                {result.behaviorScore < 0 && (
                  <p className="text-[10px] text-red-400 mt-1">
                    ⚠️ Shapley debt detected. XP frozen until behavior improves.
                  </p>
                )}
              </div>

              {/* XP Progress Bar */}
              <div className="mb-2">
                <div className="flex items-center justify-between text-xs text-black-500 mb-1">
                  <span>Level {result.level.level}</span>
                  {result.nextLevel ? (
                    <span>Level {result.nextLevel.level} · {result.nextLevel.xpRequired - result.xp} XP to go</span>
                  ) : (
                    <span>MAX LEVEL</span>
                  )}
                </div>
                <div className="h-3 bg-black-700 rounded-full overflow-hidden">
                  <motion.div
                    initial={{ width: 0 }}
                    animate={{ width: `${result.xpProgress}%` }}
                    transition={{ delay: 0.2, duration: 0.8, ease: 'easeOut' }}
                    className="h-full bg-gradient-to-r from-matrix-600 via-matrix-500 to-cyan-400 rounded-full relative"
                  >
                    <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/20 to-transparent animate-pulse" />
                  </motion.div>
                </div>
              </div>

              {/* Alignment explanation */}
              <p className="text-[10px] text-black-600 text-center">
                {result.multiplier >= 1.8
                  ? "maximum alignment bonus — you earn XP almost 2x faster"
                  : result.multiplier >= 1.5
                  ? "strong alignment — your XP earnings are boosted significantly"
                  : result.multiplier >= 1.2
                  ? "good alignment — you earn bonus XP on all activities"
                  : "base rate — increase alignment to boost your XP multiplier"}
              </p>
            </motion.div>

            {/* Archetype Header */}
            <div className="text-center mb-6">
              <motion.div
                initial={{ scale: 0.9, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                transition={{ delay: 0.1 }}
              >
                <div className="text-3xl font-bold font-mono text-matrix-500 mb-2">
                  {result.personalityCode}
                </div>
                <h2 className="text-xl font-bold text-white mb-1">
                  {result.archetype.name}
                </h2>
                <p className="text-sm text-black-400">
                  {result.archetype.desc}
                </p>
              </motion.div>
            </div>

            {/* Dimension Bars */}
            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.2 }}
              className="mb-6 p-4 rounded-lg bg-black-800 border border-black-600"
            >
              <div className="space-y-3">
                {Object.entries(result.dimensions).map(([key, dim], i) => (
                  <div key={key} className="flex items-center space-x-3">
                    <div className="w-8 h-8 rounded bg-matrix-500/20 flex items-center justify-center">
                      <span className="text-sm font-bold font-mono text-matrix-500">{dim.letter}</span>
                    </div>
                    <div className="flex-1">
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-xs text-black-400">{dim.label}</span>
                        <span className="text-xs font-mono text-black-500">{dim.strength}%</span>
                      </div>
                      <div className="h-2 bg-black-700 rounded-full overflow-hidden">
                        <motion.div
                          initial={{ width: 0 }}
                          animate={{ width: `${dim.strength}%` }}
                          transition={{ delay: 0.3 + i * 0.1, duration: 0.5 }}
                          className="h-full bg-gradient-to-r from-matrix-600 to-matrix-400 rounded-full"
                        />
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </motion.div>

            {/* Crypto Level Indicator */}
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 0.4 }}
              className="text-center mb-6"
            >
              <div className="inline-flex items-center space-x-2 px-3 py-1.5 rounded-full bg-black-800 border border-black-600">
                <span className="text-xs text-black-500">crypto level:</span>
                <div className="flex space-x-1">
                  {[1, 2, 3, 4, 5, 6].map((level) => (
                    <div
                      key={level}
                      className={`w-2 h-2 rounded-full transition-colors ${
                        level <= result.cryptoLevel ? 'bg-matrix-500' : 'bg-black-600'
                      }`}
                    />
                  ))}
                </div>
                <span className="text-xs text-matrix-500 font-medium">
                  {result.cryptoLevel <= 2 ? 'beginner' : result.cryptoLevel <= 4 ? 'intermediate' : 'advanced'}
                </span>
              </div>
            </motion.div>

            {/* RSP Cognitive Profile */}
            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.45 }}
              className="mb-6 p-4 rounded-lg bg-black-800 border border-cyan-500/30"
            >
              <div className="flex items-center space-x-2 mb-3">
                <div className="w-5 h-5 rounded bg-cyan-500/20 flex items-center justify-center">
                  <svg className="w-3 h-3 text-cyan-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2z" />
                    <path d="M12 6v6l4 2" />
                  </svg>
                </div>
                <span className="text-xs font-bold text-cyan-400">cognitive profile</span>
                <span className="text-[9px] text-black-600 ml-auto">RSP v0.1 — stored locally only</span>
              </div>
              <div className="grid grid-cols-2 gap-2">
                {[
                  { label: 'depth', value: result.cognitiveProfile.technicalDepth + '/5' },
                  { label: 'analogy', value: result.cognitiveProfile.analogyDomain },
                  { label: 'humor', value: result.cognitiveProfile.humorMode },
                  { label: 'abstraction', value: result.cognitiveProfile.abstractionComfort === 'principles-first' ? 'principles' : 'concrete' },
                  { label: 'attention', value: result.cognitiveProfile.attentionStyle === 'deep-dive' ? 'deep dive' : 'executive' },
                  { label: 'trust', value: result.cognitiveProfile.trustSignal === 'social-proof' ? 'social proof' : result.cognitiveProfile.trustSignal },
                ].map((item) => (
                  <div key={item.label} className="flex items-center justify-between px-2 py-1.5 rounded bg-black-900/50">
                    <span className="text-[10px] text-black-500">{item.label}</span>
                    <span className="text-[10px] font-mono text-cyan-400">{item.value}</span>
                  </div>
                ))}
              </div>
              <p className="text-[9px] text-black-600 mt-2 text-center">
                this profile never leaves your device — your cognitive fingerprint belongs to you
              </p>
            </motion.div>

            {/* Main Content */}
            <div className="mb-8">
              <div className="flex items-center space-x-2 mb-4">
                <div className="w-6 h-6 rounded bg-matrix-500/20 flex items-center justify-center text-matrix-500">
                  {Icons[result.profile]}
                </div>
                <h3 className="text-lg font-bold">
                  {result.title}
                </h3>
              </div>
              <div className="space-y-3">
                {result.sections.map((section, i) => (
                  <motion.div
                    key={`section-${i}`}
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: 0.5 + i * 0.1 }}
                    className="p-4 rounded-lg bg-black-800 border border-black-600"
                  >
                    <h4 className="text-sm font-medium text-matrix-500 mb-2">
                      {section.heading}
                    </h4>
                    <p className="text-sm text-black-300 leading-relaxed">
                      {section.content}
                    </p>
                  </motion.div>
                ))}
              </div>

              {result.note && (
                <p className="mt-4 text-xs text-black-500 italic">
                  {result.note}
                </p>
              )}
            </div>

            {/* Tips */}
            <div className="mb-8">
              <h3 className="text-sm font-bold text-black-400 mb-4">
                tips for you
              </h3>
              <div className="space-y-2">
                {result.tips.map((tip, i) => (
                  <motion.div
                    key={`tip-${i}`}
                    initial={{ opacity: 0, x: -10 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ delay: 0.3 + i * 0.1 }}
                    className="p-3 rounded-lg bg-black-900 border border-black-600"
                  >
                    <p className="text-xs text-black-500 mb-1">{tip.hook}</p>
                    <p className="text-sm text-black-300">{tip.message}</p>
                  </motion.div>
                ))}
              </div>
            </div>

            {/* Bottom Line */}
            <div className="mb-8 p-4 rounded-lg bg-matrix-500/10 border border-matrix-500/30">
              <h4 className="text-sm font-bold text-matrix-500 mb-2">bottom line</h4>
              <p className="text-sm text-black-300">
                {result.cryptoLevel <= 2
                  ? 'VibeSwap helps you trade tokens while keeping more of your money. Simple, safe, and fair.'
                  : result.cryptoLevel <= 4
                  ? 'VibeSwap eliminates MEV through batch auctions. Your trades execute fairly without front-running or sandwich attacks.'
                  : 'VibeSwap implements IIA via commit-reveal batch auctions. Cryptographic hiding eliminates information asymmetry, making extraction strategies undefined.'}
              </p>
            </div>

            {/* Actions */}
            <div className="flex flex-col sm:flex-row items-center justify-center gap-3">
              <motion.button
                whileHover={{ scale: 1.02 }}
                whileTap={{ scale: 0.98 }}
                onClick={() => onComplete?.({
                  profile: result.profile,
                  cryptoLevel: result.cryptoLevel,
                  personalityCode: result.personalityCode,
                  archetype: result.archetype,
                  dimensions: result.dimensions,
                  alignment: result.alignment,
                  multiplier: result.multiplier,
                  behaviorScore: result.behaviorScore,
                  behaviorTier: result.behaviorTier,
                  baseXP: result.baseXP,
                  xp: result.xp,
                  level: result.level,
                  cognitiveProfile: result.cognitiveProfile,
                })}
                className="px-6 py-3 rounded-lg font-semibold bg-matrix-600 hover:bg-matrix-500 text-black-900 border border-matrix-500 transition-colors"
              >
                try VibeSwap
              </motion.button>
              <button
                onClick={reset}
                className="text-sm text-black-400 hover:text-matrix-500 transition-colors"
              >
                start over
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

export default PersonalityExplainer
