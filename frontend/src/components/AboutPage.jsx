import { useState, useEffect } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Link } from 'react-router-dom'

// Thesis content - In a Cave, With a Box of Scraps
const thesisSections = [
  {
    title: "The Cave",
    quote: '"Tony Stark was able to build this in a cave! With a box of scraps!"',
    quoteAuthor: "— Obadiah Stane, Iron Man (2008)",
    content: `The line is meant as an insult. But embedded within it is a profound truth about innovation: sometimes the most transformative technologies are born not in pristine laboratories with unlimited resources, but in caves, with scraps, under pressure, by those stubborn enough to believe that constraints are merely suggestions.

In 2025, those of us building with AI-assisted development tools—what has come to be known as "vibe coding"—find ourselves in our own cave. The scraps we work with are large language models that hallucinate, lose context, and occasionally produce code that would make a junior developer wince. Our cave is the gap between what AI could be and what it currently is: a brilliant but unreliable partner prone to confident mistakes.

And yet, we build anyway.`
  },
  {
    title: "The Limitations",
    content: `Current LLMs operate within fixed context windows—a limited amount of text they can "remember" at once. The result is an AI that forgets. It forgets the patterns you established. It forgets the bug you just fixed three messages ago.

LLMs do not know what they do not know. They confidently generate plausible-looking code that uses functions that don't exist, parameters that were deprecated, or patterns that are subtly wrong in ways that only manifest at runtime.

The most frustrating pattern is the loop: the AI makes a mistake, you correct it, it overcorrects, you correct again, it reverts to the original mistake. You're four messages deep in a circular argument with a machine that has lost the thread.`
  },
  {
    title: "The Jarvis Thesis",
    content: `The capabilities of large language models have improved at an exponential rate. The pattern is unmistakable: what is frustratingly limited today will be remarkably capable tomorrow.

Within the foreseeable future, AI development assistants will achieve a level of capability where they can autonomously handle complex software engineering tasks with minimal human oversight—understanding entire codebases, maintaining perfect context, making zero hallucination errors, and anticipating developer needs before they are expressed.

This is not science fiction. It is the obvious extrapolation of current trends. The question is not if but when.

Those who learn to work with AI tools in their primitive state develop skills that will be invaluable when the tools mature: prompt engineering intuition, AI output evaluation, human-AI workflow design, context management, and pattern recognition for common AI failure modes.`
  },
  {
    title: "The Philosophy of Constraint",
    content: `Tony Stark didn't build the Mark I because a cave was the ideal workshop. He built it because he had no choice, and the pressure of mortality focused his genius. The resulting design—crude, improvised, barely functional—contained the conceptual seeds of every Iron Man suit that followed.

The patterns we develop for managing AI limitations today may become foundational for AI-augmented development tomorrow. We are not just building software. We are building the practices, patterns, and mental models that will define the future of development.

Not everyone can build in a cave. The frustration, the setbacks, the constant debugging—these are filters. They select for patience, persistence, precision, adaptability, and vision. The cave selects for those who see past what is to what could be.`
  },
  {
    title: "The First Suit",
    content: `VibeSwap is my Mark I.

It is crude in places. The debugging sessions were painful. There are scars in the codebase where the AI and I fought and compromised. But it works. It trades. It bridges. It protects users from MEV. It runs.

The day will come—perhaps sooner than we think—when AI development assistants are so capable that solo developers can build systems that would today require teams of dozens. On that day, those who dismissed vibe coding as "not ready" will scramble to learn what we already know.

Until then, we continue. We debug. We persist. We believe.

Because greatness can overcome limitation.`,
    closingQuotes: [
      { text: '"I am Iron Man."', author: '— Tony Stark' },
      { text: '"I am a vibe coder."', author: '— Solo builders everywhere, 2025' },
    ]
  },
]

/**
 * About page with scrolling slogans marquee + cycling blurbs
 * Moved from the old homepage design before the Steve Jobs minimalist redesign
 */

// Cycling blurbs - rotate through these with animation
const manifestos = [
  {
    headline: ["no bank", "required."],
    blurb: "just a phone and an internet connection. no credit check, no paperwork, no waiting for approval.",
  },
  {
    headline: ["your money.", "your rules."],
    blurb: "no one can freeze your account or tell you what you can buy. you're in control.",
  },
  {
    headline: ["works", "everywhere."],
    blurb: "from Lagos to Lima. if you have internet, you have access to the same financial tools as everyone else.",
  },
  {
    headline: ["send money", "in seconds."],
    blurb: "no 3-5 business days. no wire fees. send to anyone, anywhere, anytime.",
  },
  {
    headline: ["beat", "inflation."],
    blurb: "convert local currency to stable dollars. protect your savings when prices are rising.",
  },
  {
    headline: ["fair prices,", "always."],
    blurb: "everyone pays the same rate. no hidden fees, no tricks, no getting taken advantage of.",
  },
  {
    headline: ["keep more", "of your money."],
    blurb: "we protect you from hidden costs that other platforms charge. more money stays with you.",
  },
  {
    headline: ["simple", "and safe."],
    blurb: "easy enough for anyone to use. secure enough to trust with your savings.",
  },
]

const slogans = [
  { text: "no bank required", highlight: true },
  { text: "your keys, your money", highlight: false },
  { text: "works everywhere", highlight: true },
  { text: "fair prices always", highlight: false },
  { text: "send money in seconds", highlight: true },
  { text: "beat inflation", highlight: false },
  { text: "no credit check", highlight: true },
  { text: "no paperwork", highlight: false },
  { text: "no waiting for approval", highlight: true },
  { text: "you stay in control", highlight: false },
  { text: "from Lagos to Lima", highlight: true },
  { text: "no hidden fees", highlight: false },
  { text: "MEV protected", highlight: true },
  { text: "community owned", highlight: false },
]

const values = [
  {
    title: "Fair by Design",
    description: "Everyone pays the same price. No front-running, no sandwich attacks, no hidden fees. Our batch auction system ensures nobody gets an unfair advantage.",
    icon: (
      <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M3 6l3 1m0 0l-3 9a5.002 5.002 0 006.001 0M6 7l3 9M6 7l6-2m6 2l3-1m-3 1l-3 9a5.002 5.002 0 006.001 0M18 7l3 9m-3-9l-6-2m0-2v2m0 16V5m0 16H9m3 0h3" />
      </svg>
    ),
  },
  {
    title: "Your Keys, Your Coins",
    description: "We never hold your funds. Your wallet, your keys, your money. We just facilitate the trades - you stay in control at all times.",
    icon: (
      <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 5.25a3 3 0 013 3m3 0a6 6 0 01-7.029 5.912c-.563-.097-1.159.026-1.563.43L10.5 17.25H8.25v2.25H6v2.25H2.25v-2.818c0-.597.237-1.17.659-1.591l6.499-6.499c.404-.404.527-1 .43-1.563A6 6 0 1121.75 8.25z" />
      </svg>
    ),
  },
  {
    title: "Global Access",
    description: "If you have internet, you have access to the same financial tools as everyone else. No borders, no discrimination, no gatekeepers.",
    icon: (
      <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M12 21a9.004 9.004 0 008.716-6.747M12 21a9.004 9.004 0 01-8.716-6.747M12 21c2.485 0 4.5-4.03 4.5-9S14.485 3 12 3m0 18c-2.485 0-4.5-4.03-4.5-9S9.515 3 12 3m0 0a8.997 8.997 0 017.843 4.582M12 3a8.997 8.997 0 00-7.843 4.582m15.686 0A11.953 11.953 0 0112 10.5c-2.998 0-5.74-1.1-7.843-2.918m15.686 0A8.959 8.959 0 0121 12c0 .778-.099 1.533-.284 2.253m0 0A17.919 17.919 0 0112 16.5c-3.162 0-6.133-.815-8.716-2.247m0 0A9.015 9.015 0 013 12c0-1.605.42-3.113 1.157-4.418" />
      </svg>
    ),
  },
  {
    title: "Community Owned",
    description: "Built by users, for users. No venture capital calling the shots. Governance is decentralized and rewards go back to the community.",
    icon: (
      <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M18 18.72a9.094 9.094 0 003.741-.479 3 3 0 00-4.682-2.72m.94 3.198l.001.031c0 .225-.012.447-.037.666A11.944 11.944 0 0112 21c-2.17 0-4.207-.576-5.963-1.584A6.062 6.062 0 016 18.719m12 0a5.971 5.971 0 00-.941-3.197m0 0A5.995 5.995 0 0012 12.75a5.995 5.995 0 00-5.058 2.772m0 0a3 3 0 00-4.681 2.72 8.986 8.986 0 003.74.477m.94-3.197a5.971 5.971 0 00-.94 3.197M15 6.75a3 3 0 11-6 0 3 3 0 016 0zm6 3a2.25 2.25 0 11-4.5 0 2.25 2.25 0 014.5 0zm-13.5 0a2.25 2.25 0 11-4.5 0 2.25 2.25 0 014.5 0z" />
      </svg>
    ),
  },
]

const team = [
  { name: "Faraday1", role: "Founder", contribution: "Protocol design & smart contracts" },
  { name: "Matt", role: "Early Contributor", contribution: "UX simplification for newcomers" },
  { name: "Bill", role: "Advisor", contribution: "Recovery system inspiration" },
  { name: "Jayme Lawson", role: "Cultural Inspiration", contribution: "Embodiment of cooperative fairness — the Lawson Fairness Floor is named in her honor" },
]

function AboutPage() {
  const [currentIndex, setCurrentIndex] = useState(0)
  const [isHovering, setIsHovering] = useState(false)

  // Rotate through manifestos - slower when hovering
  useEffect(() => {
    const duration = isHovering ? 12000 : 6000 // 2x slower on hover
    const interval = setInterval(() => {
      setCurrentIndex((prev) => (prev + 1) % manifestos.length)
    }, duration)
    return () => clearInterval(interval)
  }, [isHovering])

  const current = manifestos[currentIndex]

  return (
    <div className="min-h-screen">
      {/* Scrolling Slogans Marquee */}
      <div className="relative overflow-hidden border-b border-black-600 bg-black-800/50">
        {/* Top row - scrolls left */}
        <div className="marquee-container py-4">
          <div className="marquee-content">
            {[...slogans, ...slogans].map((slogan, i) => (
              <div
                key={i}
                className="flex-shrink-0 px-8 flex items-center"
              >
                <span className={`text-lg md:text-xl font-bold whitespace-nowrap ${
                  slogan.highlight ? 'text-matrix-500' : 'text-black-200'
                }`}>
                  {slogan.text}
                </span>
                <span className="mx-8 text-black-500">/</span>
              </div>
            ))}
          </div>
        </div>

        {/* Bottom row - scrolls right (reverse) */}
        <div className="marquee-container py-4 border-t border-black-700">
          <div className="marquee-content-reverse">
            {[...slogans, ...slogans].reverse().map((slogan, i) => (
              <div
                key={i}
                className="flex-shrink-0 px-8 flex items-center"
              >
                <span className={`text-lg md:text-xl font-bold whitespace-nowrap ${
                  slogan.highlight ? 'text-terminal-500' : 'text-black-200'
                }`}>
                  {slogan.text}
                </span>
                <span className="mx-8 text-black-500">/</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Cycling Blurbs Section */}
      <div className="py-12 md:py-16 border-b border-black-600">
        <div className="max-w-4xl mx-auto px-4">
          {/* Rotating Headline */}
          <div
            className="h-[120px] md:h-[140px] flex items-center justify-center mb-4 cursor-default"
            onMouseEnter={() => setIsHovering(true)}
            onMouseLeave={() => setIsHovering(false)}
          >
            <AnimatePresence mode="wait">
              <motion.h1
                key={currentIndex}
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -20 }}
                transition={{ duration: 0.5 }}
                className="text-3xl md:text-4xl lg:text-5xl font-bold leading-tight text-center"
              >
                {current.headline.map((line, i) => (
                  <span key={i} className="block">
                    <span className={i === 0 ? 'text-matrix-500' : 'text-white'}>
                      {line}
                    </span>
                  </span>
                ))}
              </motion.h1>
            </AnimatePresence>
          </div>

          {/* Rotating Blurb */}
          <div
            className="relative h-[80px] md:h-[60px] mb-6"
            onMouseEnter={() => setIsHovering(true)}
            onMouseLeave={() => setIsHovering(false)}
          >
            <AnimatePresence mode="wait">
              <motion.p
                key={currentIndex}
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.3, delay: 0.2 }}
                className="absolute inset-x-0 top-0 text-base md:text-lg text-black-300 max-w-2xl mx-auto leading-relaxed text-center px-4"
              >
                {current.blurb}
              </motion.p>
            </AnimatePresence>
          </div>

          {/* Progress Dots */}
          <div className="flex items-center justify-center space-x-1.5">
            {manifestos.map((_, i) => (
              <button
                key={i}
                onClick={() => setCurrentIndex(i)}
                className={`h-1.5 rounded-full transition-all duration-300 ${
                  i === currentIndex
                    ? 'w-6 bg-matrix-500'
                    : 'w-1.5 bg-black-500 hover:bg-black-400'
                }`}
              />
            ))}
          </div>
        </div>
      </div>

      {/* Main Content */}
      <div className="max-w-4xl mx-auto px-4 py-12 md:py-16">
        {/* Hero */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="text-center mb-16"
        >
          <h1 className="text-3xl md:text-4xl font-bold mb-4">
            Banking for <span className="text-matrix-500">Everyone</span>
          </h1>
          <p className="text-black-300 text-lg max-w-2xl mx-auto">
            VibeSwap is a decentralized exchange built for people who need an alternative to traditional banking.
            No account required. No credit check. Just a phone and internet.
          </p>
        </motion.div>

        {/* Values */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.2 }}
          className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-16"
        >
          {values.map((value, i) => (
            <motion.div
              key={value.title}
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.2 + i * 0.1 }}
              className="p-6 rounded-lg bg-black-800 border border-black-600 hover:border-black-500 transition-colors"
            >
              <div className="w-12 h-12 rounded-lg bg-black-700 border border-black-500 flex items-center justify-center text-matrix-500 mb-4">
                {value.icon}
              </div>
              <h3 className="text-lg font-bold mb-2">{value.title}</h3>
              <p className="text-sm text-black-300">{value.description}</p>
            </motion.div>
          ))}
        </motion.div>

        {/* The Problem We Solve */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.4 }}
          className="mb-16 p-6 md:p-8 rounded-lg bg-black-800 border border-black-600"
        >
          <h2 className="text-2xl font-bold mb-4 text-center">
            Why <span className="text-matrix-500">VibeSwap</span>?
          </h2>
          <div className="space-y-4 text-black-300">
            <p>
              <span className="text-white font-semibold">1.7 billion adults</span> worldwide don't have access to a bank account.
              Many more are underserved by a system designed to extract fees and exclude people.
            </p>
            <p>
              Traditional exchanges are no better. They front-run your trades, sandwich your transactions,
              and charge hidden fees. The house always wins.
            </p>
            <p>
              <span className="text-matrix-500 font-semibold">We built something different.</span> A fair exchange where
              everyone pays the same price. Where your money is always yours. Where the only requirement is an internet connection.
            </p>
          </div>
        </motion.div>

        {/* Team */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.5 }}
          className="mb-16"
        >
          <h2 className="text-2xl font-bold mb-6 text-center">
            Built by <span className="text-matrix-500">Real People</span>
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {team.map((member, i) => (
              <motion.div
                key={member.name}
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.5 + i * 0.1 }}
                className="p-4 rounded-lg bg-black-800 border border-black-600 text-center"
              >
                <div className="w-12 h-12 mx-auto rounded-full bg-matrix-500/20 border border-matrix-500/30 flex items-center justify-center text-matrix-500 font-bold text-lg mb-3">
                  {member.name[0]}
                </div>
                <div className="font-bold">{member.name}</div>
                <div className="text-xs text-matrix-500 mb-2">{member.role}</div>
                <div className="text-xs text-black-400">{member.contribution}</div>
              </motion.div>
            ))}
          </div>
        </motion.div>

        {/* Thesis: In a Cave, With a Box of Scraps */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.6 }}
          className="mb-16"
        >
          <div className="border-t border-black-600 pt-12 mb-8">
            <h2 className="text-2xl md:text-3xl font-bold text-center mb-2">
              In a Cave, With a <span className="text-matrix-500">Box of Scraps</span>
            </h2>
            <p className="text-sm text-black-400 text-center mb-8">
              A Thesis on Solo Building with Vibe Coding in the Pre-Jarvis Era
            </p>
          </div>

          <div className="space-y-8">
            {thesisSections.map((section, i) => (
              <motion.div
                key={section.title}
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.7 + i * 0.1 }}
                className="p-6 rounded-lg bg-black-800 border border-black-600"
              >
                <h3 className="text-lg font-bold mb-4 text-matrix-500">
                  {i + 1}. {section.title}
                </h3>

                {section.quote && (
                  <div className="mb-4 pl-4 border-l-2 border-matrix-500/30">
                    <p className="text-black-300 italic">{section.quote}</p>
                    <p className="text-xs text-black-500 mt-1">{section.quoteAuthor}</p>
                  </div>
                )}

                <div className="space-y-3 text-sm text-black-300 leading-relaxed">
                  {section.content.split('\n\n').map((paragraph, j) => (
                    <p key={j}>{paragraph}</p>
                  ))}
                </div>

                {section.closingQuotes && (
                  <div className="mt-6 pt-4 border-t border-black-600 text-center space-y-3">
                    {section.closingQuotes.map((q, j) => (
                      <div key={j}>
                        <p className="text-white italic">{q.text}</p>
                        <p className="text-xs text-black-500">{q.author}</p>
                      </div>
                    ))}
                  </div>
                )}
              </motion.div>
            ))}
          </div>

          <p className="text-xs text-black-500 text-center mt-6 italic">
            Written with Claude Code, in a cave, with a box of scraps.
          </p>
        </motion.div>

        {/* CTA */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 1.2 }}
          className="text-center"
        >
          <Link to="/">
            <motion.button
              whileHover={{ scale: 1.02 }}
              whileTap={{ scale: 0.98 }}
              className="px-8 py-3 rounded-lg font-semibold bg-matrix-600 hover:bg-matrix-500 text-black-900 transition-colors"
            >
              Start Trading
            </motion.button>
          </Link>
          <p className="text-xs text-black-500 mt-3">No account needed. Try the demo first.</p>
        </motion.div>
      </div>
    </div>
  )
}

export default AboutPage
