import { useState } from 'react'
import { motion } from 'framer-motion'
import GlassCard from './ui/GlassCard'
import PageHero from './ui/PageHero'

// ============================================================
// LegalPage — Terms, Privacy, Risk Disclosure, Cookies
// Privacy-first, non-custodial. We don't collect personal data.
// ============================================================

const PHI = 1.618033988749895
const CYAN = '#06b6d4'

// ============ Tab Definitions ============
const TABS = [
  { id: 'terms', label: 'Terms of Use' },
  { id: 'privacy', label: 'Privacy Policy' },
  { id: 'risk', label: 'Risk Disclosure' },
  { id: 'cookies', label: 'Cookies' },
]

// ============ Terms of Use Content ============
const TERMS_SECTIONS = [
  {
    id: 'acceptance',
    title: '1. Acceptance of Terms',
    paragraphs: [
      '1.1. By accessing, browsing, or using the VibeSwap protocol interface (the "Interface"), you acknowledge that you have read, understood, and agree to be bound by these Terms of Use ("Terms"). If you do not agree with any part of these Terms, you must immediately discontinue use of the Interface.',
      '1.2. VibeSwap is a decentralized protocol deployed on public blockchain networks. The Interface is merely a convenience tool that allows users to interact with the on-chain smart contracts directly. Your use of the underlying protocol is governed by the immutable smart contract code, not by these Terms.',
      '1.3. We reserve the right to modify these Terms at any time. Continued use of the Interface after any such modifications constitutes your acceptance of the revised Terms. It is your responsibility to review these Terms periodically for changes.',
      '1.4. These Terms constitute a legally binding agreement between you and the VibeSwap DAO ("we," "us," or "our"). No agency, partnership, joint venture, or employment relationship is created as a result of these Terms.',
    ],
  },
  {
    id: 'eligibility',
    title: '2. Eligibility',
    paragraphs: [
      '2.1. You must be at least 18 years of age, or the age of legal majority in your jurisdiction (whichever is greater), to use the Interface. By using the Interface, you represent and warrant that you meet this eligibility requirement.',
      '2.2. You represent that you are not a citizen, resident, or organized in any jurisdiction where the use of decentralized finance protocols is prohibited or restricted by applicable law, regulation, or governmental order.',
      '2.3. You represent that you are not subject to economic or trade sanctions administered or enforced by any governmental authority, including without limitation the U.S. Office of Foreign Assets Control (OFAC), the United Nations Security Council, or the European Union.',
      '2.4. You represent that your use of the Interface does not violate any applicable law or regulation, and that you will not use the Interface for any unlawful purpose, including but not limited to money laundering, terrorist financing, or sanctions evasion.',
    ],
  },
  {
    id: 'service',
    title: '3. Description of Service',
    paragraphs: [
      '3.1. VibeSwap is a non-custodial, decentralized exchange protocol that facilitates peer-to-peer token swaps through commit-reveal batch auctions with uniform clearing prices. The protocol is designed to eliminate Maximal Extractable Value (MEV) through cryptographic ordering.',
      '3.2. The Interface provides a graphical user interface for interacting with the VibeSwap smart contracts deployed on supported blockchain networks. All transactions are executed entirely on-chain. We do not at any time have custody, control, or access to your digital assets.',
      '3.3. The protocol operates autonomously through immutable smart contracts. Once deployed, we cannot modify, pause, or reverse transactions processed by the protocol, except through governance mechanisms controlled by the VibeSwap DAO.',
      '3.4. We do not act as a broker, financial institution, creditor, exchange, or custodian. The Interface is a software tool, and all trading decisions are made solely by the user interacting with the decentralized protocol.',
    ],
  },
  {
    id: 'prohibited',
    title: '4. Prohibited Uses',
    paragraphs: [
      '4.1. You agree not to use the Interface to conduct or facilitate any activity that is illegal, fraudulent, or harmful, including but not limited to: (a) market manipulation, wash trading, or front-running; (b) money laundering, terrorist financing, or sanctions evasion; (c) intellectual property infringement; or (d) distribution of malicious software.',
      '4.2. You agree not to attempt to exploit, disrupt, or interfere with the operation of the protocol or Interface, including through denial-of-service attacks, smart contract exploits, oracle manipulation, or any other technical attack vector.',
      '4.3. You agree not to use automated systems, bots, or scripts to interact with the Interface in a manner that degrades performance for other users, except through the protocol\'s official API endpoints and within documented rate limits.',
      '4.4. You agree not to circumvent or attempt to circumvent any security measures, access controls, or rate limiting mechanisms implemented by the protocol or Interface.',
    ],
  },
  {
    id: 'disclaimers',
    title: '5. Disclaimers',
    paragraphs: [
      '5.1. THE INTERFACE AND PROTOCOL ARE PROVIDED "AS IS" AND "AS AVAILABLE" WITHOUT WARRANTIES OF ANY KIND, EITHER EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE, TITLE, AND NON-INFRINGEMENT.',
      '5.2. We do not warrant that the Interface will be uninterrupted, error-free, secure, or free from viruses or other harmful components. We do not warrant that the smart contracts will function as intended under all conditions, including network congestion, chain reorganizations, or protocol upgrades.',
      '5.3. We make no representations regarding the accuracy, reliability, or completeness of any information displayed on the Interface, including but not limited to token prices, liquidity depths, estimated slippage, or gas fee estimates.',
      '5.4. Digital asset markets are highly volatile and subject to rapid price fluctuations. Past performance is not indicative of future results. You acknowledge that you may lose some or all of your invested capital.',
    ],
  },
  {
    id: 'liability',
    title: '6. Limitation of Liability',
    paragraphs: [
      '6.1. TO THE MAXIMUM EXTENT PERMITTED BY APPLICABLE LAW, IN NO EVENT SHALL VIBESWAP, ITS CONTRIBUTORS, DEVELOPERS, OR DAO MEMBERS BE LIABLE FOR ANY INDIRECT, INCIDENTAL, SPECIAL, CONSEQUENTIAL, OR PUNITIVE DAMAGES, INCLUDING WITHOUT LIMITATION LOSS OF PROFITS, DATA, USE, GOODWILL, OR OTHER INTANGIBLE LOSSES.',
      '6.2. IN NO EVENT SHALL OUR TOTAL LIABILITY TO YOU FOR ALL CLAIMS ARISING OUT OF OR RELATING TO THESE TERMS OR YOUR USE OF THE INTERFACE EXCEED THE AMOUNT OF FEES PAID BY YOU TO US IN THE TWELVE (12) MONTH PERIOD PRECEDING THE CLAIM.',
      '6.3. We shall not be liable for any losses arising from: (a) smart contract vulnerabilities or exploits; (b) blockchain network failures or congestion; (c) oracle manipulation or data feed errors; (d) impermanent loss or other automated market maker risks; (e) front-running, sandwich attacks, or other MEV extraction by third parties; or (f) regulatory actions affecting the protocol or your access to it.',
      '6.4. You acknowledge and agree that the limitations of liability set forth in this section are fundamental elements of the basis of the bargain between you and us.',
    ],
  },
  {
    id: 'indemnification',
    title: '7. Indemnification',
    paragraphs: [
      '7.1. You agree to indemnify, defend, and hold harmless VibeSwap, its contributors, developers, DAO members, and their respective officers, directors, employees, agents, and successors from and against any and all claims, damages, losses, liabilities, costs, and expenses (including reasonable attorneys\' fees) arising out of or relating to: (a) your use of the Interface or protocol; (b) your violation of these Terms; (c) your violation of any applicable law or regulation; or (d) your violation of any rights of a third party.',
      '7.2. We reserve the right, at your expense, to assume the exclusive defense and control of any matter for which you are required to indemnify us, and you agree to cooperate with our defense of such claims. You agree not to settle any matter without our prior written consent.',
      '7.3. This indemnification obligation shall survive the termination of these Terms and your use of the Interface.',
    ],
  },
  {
    id: 'governing',
    title: '8. Governing Law & Dispute Resolution',
    paragraphs: [
      '8.1. These Terms shall be governed by and construed in accordance with the laws of the jurisdiction in which the VibeSwap DAO is organized, without regard to its conflict of law provisions.',
      '8.2. Any dispute, controversy, or claim arising out of or relating to these Terms, or the breach, termination, or invalidity thereof, shall first be subject to good-faith negotiation between the parties for a period of thirty (30) days.',
      '8.3. If the dispute cannot be resolved through negotiation, it shall be submitted to binding arbitration in accordance with the rules of the relevant arbitration authority. The arbitration shall be conducted in the English language, and the arbitral award shall be final and binding.',
      '8.4. Notwithstanding the foregoing, nothing in this section shall prevent either party from seeking injunctive or other equitable relief in any court of competent jurisdiction to prevent the actual or threatened infringement, misappropriation, or violation of a party\'s intellectual property rights.',
    ],
  },
]

// ============ Privacy Policy Content ============
const PRIVACY_SECTIONS = [
  {
    id: 'collect',
    title: '1. What We Collect',
    icon: '\u2713',
    iconColor: 'rgb(34,197,94)',
    paragraphs: [
      'We collect absolutely nothing. VibeSwap is a non-custodial, decentralized protocol. We do not require account creation, email addresses, phone numbers, names, or any form of personal identification to use the Interface.',
      'There are no user accounts, no login credentials, and no personal data stored on our servers. Your wallet address is the only identifier, and it is generated and controlled entirely by you through your own wallet software or hardware device.',
      'We do not use tracking pixels, fingerprinting, or any other method to identify individual users across sessions. We fundamentally believe that privacy is a right, not a feature.',
    ],
  },
  {
    id: 'onchain',
    title: '2. On-Chain Data',
    icon: '\u26d3',
    iconColor: CYAN,
    paragraphs: [
      'All transactions executed through the VibeSwap protocol are recorded on public blockchain networks. This data is inherently public, immutable, and transparent. It includes wallet addresses, transaction amounts, token types, timestamps, and gas fees.',
      'On-chain data is not controlled by VibeSwap. It is a fundamental property of the blockchain networks on which the protocol operates. We have no ability to delete, modify, or restrict access to on-chain transaction data.',
      'If you wish to enhance your privacy for on-chain transactions, we recommend using the VibeSwap Privacy Pools feature, which leverages zero-knowledge proofs and association sets to provide compliant privacy for your transactions.',
    ],
  },
  {
    id: 'analytics',
    title: '3. Analytics',
    icon: '\u2261',
    iconColor: 'rgb(168,85,247)',
    paragraphs: [
      'The Interface may use minimal, privacy-respecting analytics to understand aggregate usage patterns (e.g., total page views, popular trading pairs). Any analytics tooling used will be self-hosted and will not share data with third parties.',
      'We do not use Google Analytics, Facebook Pixel, or any third-party analytics service that tracks individual users. Any analytics data collected is aggregated and cannot be used to identify individual users.',
      'You may block any analytics requests through your browser settings or ad blocker without any impact on the functionality of the Interface.',
    ],
  },
  {
    id: 'thirdparty',
    title: '4. Third-Party Services',
    icon: '\u21c4',
    iconColor: 'rgb(234,179,8)',
    paragraphs: [
      'The Interface interacts with third-party blockchain RPC providers (e.g., Infura, Alchemy, or self-hosted nodes) to read blockchain state and submit transactions. These providers may log IP addresses and request metadata according to their own privacy policies.',
      'We recommend using a VPN or connecting through your own Ethereum node to minimize data exposure to third-party RPC providers. The Interface supports custom RPC endpoints for users who prefer maximum privacy.',
      'The Interface may display token prices sourced from third-party APIs (e.g., CoinGecko, on-chain oracles). These services are queried server-side where possible to avoid exposing your IP address directly.',
    ],
  },
  {
    id: 'rights',
    title: '5. Your Rights',
    icon: '\u2694',
    iconColor: 'rgb(239,68,68)',
    paragraphs: [
      'Since we do not collect personal data, there is nothing to delete, export, or rectify. You have full control over your on-chain identity and assets at all times. You can stop using the Interface at any time without losing access to your funds, which remain on-chain.',
      'If you believe that any personal data has been inadvertently collected, you may contact the VibeSwap DAO governance forum to request an investigation and remediation.',
      'We fully support your right to privacy under GDPR, CCPA, and all other applicable data protection regulations. Our architecture is designed so that compliance is inherent — we cannot violate your privacy because we never have your data in the first place.',
    ],
  },
]

// ============ Risk Disclosure Content ============
const RISK_SECTIONS = [
  {
    id: 'smartcontract',
    title: 'Smart Contract Risk',
    severity: 'HIGH',
    severityColor: 'rgb(239,68,68)',
    paragraphs: [
      'Smart contracts are experimental technology. Despite rigorous testing, formal verification, and security audits, there is always a non-zero risk that a vulnerability exists in the VibeSwap smart contracts that could result in partial or total loss of funds.',
      'The VibeSwap protocol includes circuit breakers, rate limiters, and emergency pause mechanisms as defense-in-depth measures. However, these safeguards cannot guarantee protection against all possible attack vectors, including novel exploits or zero-day vulnerabilities in the underlying EVM implementation.',
      'Users should never deposit more than they can afford to lose. Consider the VibeSwap insurance pools and impermanent loss protection features as additional risk mitigation, but do not treat them as guarantees.',
    ],
  },
  {
    id: 'market',
    title: 'Market Risk',
    severity: 'HIGH',
    severityColor: 'rgb(239,68,68)',
    paragraphs: [
      'Digital asset markets are extremely volatile and can experience rapid, significant price movements. Token values can decline substantially in short periods, and there is no guarantee that any token will maintain its value or liquidity.',
      'Liquidity providers face the risk of impermanent loss, which occurs when the relative price of deposited tokens changes after deposit. In extreme market conditions, impermanent loss can exceed the trading fees earned, resulting in a net loss compared to simply holding the tokens.',
      'The commit-reveal batch auction mechanism reduces MEV extraction but does not eliminate all forms of market risk, including black swan events, cascading liquidations on other protocols, or coordinated market manipulation.',
    ],
  },
  {
    id: 'regulatory',
    title: 'Regulatory Risk',
    severity: 'MEDIUM',
    severityColor: 'rgb(234,179,8)',
    paragraphs: [
      'The regulatory landscape for decentralized finance is evolving rapidly and varies significantly across jurisdictions. There is a risk that new laws, regulations, or governmental actions could restrict or prohibit the use of DeFi protocols, including VibeSwap, in your jurisdiction.',
      'Regulatory changes could affect the availability of the Interface, the legality of certain token swaps, or the tax treatment of DeFi transactions. You are solely responsible for understanding and complying with all applicable laws and regulations in your jurisdiction.',
      'VibeSwap is designed to be censorship-resistant. Even if the Interface becomes unavailable in certain jurisdictions, the underlying smart contracts remain accessible through alternative interfaces, direct contract interaction, or self-hosted frontends.',
    ],
  },
  {
    id: 'impermanent',
    title: 'Impermanent Loss',
    severity: 'MEDIUM',
    severityColor: 'rgb(234,179,8)',
    paragraphs: [
      'Impermanent loss (IL) is a fundamental risk of providing liquidity to automated market makers. It occurs when the price ratio of your deposited tokens changes relative to when you deposited them. The larger the price divergence, the greater the impermanent loss.',
      'VibeSwap provides IL protection through the ShapleyDistributor mechanism, which compensates liquidity providers based on their marginal contribution to the protocol. However, IL protection is funded by protocol fees and insurance pools, which may not be sufficient to fully compensate all losses in extreme market conditions.',
      'You should thoroughly understand impermanent loss mechanics before providing liquidity. Resources on IL calculation and risk assessment are available in the VibeSwap documentation.',
    ],
  },
]

// ============ Cookies Content ============
const COOKIES_CONTENT = {
  intro: 'VibeSwap takes a minimal approach to cookies and local storage. We believe your browser belongs to you.',
  sections: [
    {
      title: 'Essential Local Storage',
      description: 'The Interface uses browser local storage for the following strictly functional purposes:',
      items: [
        'Wallet connection preferences (which wallet provider you last connected with)',
        'UI theme and display settings',
        'Pending transaction hashes (so you can track transactions across page refreshes)',
        'Slippage tolerance and other trading preferences',
      ],
    },
    {
      title: 'What We Do NOT Use',
      description: 'The following tracking mechanisms are never used:',
      items: [
        'Third-party advertising cookies',
        'Cross-site tracking cookies',
        'Browser fingerprinting techniques',
        'Persistent identifiers or session tokens',
        'Social media tracking pixels',
        'Google Analytics or similar third-party analytics',
      ],
    },
    {
      title: 'Clearing Your Data',
      description: 'You can clear all VibeSwap-related data at any time by:',
      items: [
        'Clearing your browser\'s local storage for the VibeSwap domain',
        'Using your browser\'s "Clear Site Data" feature',
        'Using the "Reset Preferences" option in the Interface settings',
      ],
    },
  ],
}

// ============ Section Wrapper ============
function Section({ title, delay = 0, children }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, delay }}
      className="mb-6"
    >
      {title && (
        <h3 className="text-base font-bold text-white font-mono tracking-wide mb-3">{title}</h3>
      )}
      {children}
    </motion.div>
  )
}

// ============ Paragraph Block ============
function LegalParagraphs({ paragraphs }) {
  return (
    <div className="space-y-3">
      {paragraphs.map((p, i) => (
        <p key={i} className="text-sm font-mono text-gray-400 leading-relaxed">{p}</p>
      ))}
    </div>
  )
}

// ============ Table of Contents ============
function TableOfContents({ sections, onSelect }) {
  return (
    <GlassCard glowColor="terminal" className="p-4 mb-6">
      <h3 className="text-xs font-mono font-bold text-gray-500 uppercase tracking-wider mb-3">
        Table of Contents
      </h3>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
        {sections.map((s, i) => (
          <button
            key={s.id}
            onClick={() => onSelect(s.id)}
            className="text-left text-sm font-mono text-gray-400 hover:text-cyan-400 transition-colors py-1 px-2 rounded hover:bg-cyan-500/5"
          >
            <span className="text-gray-600 mr-2">{String(i + 1).padStart(2, '0')}.</span>
            {s.title.replace(/^\d+\.\s*/, '')}
          </button>
        ))}
      </div>
    </GlassCard>
  )
}

// ============ Terms Tab ============
function TermsTab() {
  const scrollTo = (id) => {
    const el = document.getElementById(`terms-${id}`)
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  return (
    <div>
      <TableOfContents sections={TERMS_SECTIONS} onSelect={scrollTo} />
      <div className="space-y-6">
        {TERMS_SECTIONS.map((section, i) => (
          <div key={section.id} id={`terms-${section.id}`}>
            <Section title={section.title} delay={0.05 + i * 0.03 * PHI}>
              <GlassCard glowColor="none" className="p-5">
                <LegalParagraphs paragraphs={section.paragraphs} />
              </GlassCard>
            </Section>
          </div>
        ))}
      </div>
    </div>
  )
}

// ============ Privacy Tab ============
function PrivacyTab() {
  const scrollTo = (id) => {
    const el = document.getElementById(`privacy-${id}`)
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  return (
    <div>
      {/* Privacy-first banner */}
      <GlassCard glowColor="terminal" className="p-5 mb-6">
        <div className="flex items-center gap-3 mb-3">
          <div
            className="w-10 h-10 rounded-full flex items-center justify-center text-lg font-bold border border-cyan-500/30"
            style={{ backgroundColor: 'rgba(6,182,212,0.1)', color: CYAN }}
          >
            {'\u26e8'}
          </div>
          <div>
            <h3 className="text-sm font-mono font-bold text-white">Privacy by Design</h3>
            <p className="text-xs font-mono text-gray-500">
              We don't collect your data because we never built systems to collect it.
            </p>
          </div>
        </div>
        <p className="text-xs font-mono text-gray-400 leading-relaxed">
          VibeSwap is architecturally incapable of collecting personal data. There are no user accounts,
          no databases of personal information, and no tracking infrastructure. Your wallet, your keys,
          your privacy.
        </p>
      </GlassCard>

      <TableOfContents sections={PRIVACY_SECTIONS} onSelect={scrollTo} />

      <div className="space-y-6">
        {PRIVACY_SECTIONS.map((section, i) => (
          <div key={section.id} id={`privacy-${section.id}`}>
            <Section delay={0.05 + i * 0.04 * PHI}>
              <GlassCard glowColor="none" className="p-5">
                <div className="flex items-center gap-2.5 mb-4">
                  <span
                    className="text-base font-bold"
                    style={{ color: section.iconColor }}
                  >
                    {section.icon}
                  </span>
                  <h3 className="text-base font-mono font-bold text-white">{section.title}</h3>
                </div>
                <LegalParagraphs paragraphs={section.paragraphs} />
              </GlassCard>
            </Section>
          </div>
        ))}
      </div>
    </div>
  )
}

// ============ Risk Tab ============
function RiskTab() {
  const scrollTo = (id) => {
    const el = document.getElementById(`risk-${id}`)
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  return (
    <div>
      {/* Risk warning banner */}
      <GlassCard glowColor="warning" className="p-5 mb-6">
        <div className="flex items-center gap-3 mb-3">
          <div
            className="w-10 h-10 rounded-full flex items-center justify-center text-lg font-bold border border-yellow-500/30"
            style={{ backgroundColor: 'rgba(234,179,8,0.1)', color: 'rgb(234,179,8)' }}
          >
            {'\u26a0'}
          </div>
          <div>
            <h3 className="text-sm font-mono font-bold text-white">Risk Warning</h3>
            <p className="text-xs font-mono text-gray-500">
              DeFi carries inherent risks. Please read carefully before using the protocol.
            </p>
          </div>
        </div>
        <p className="text-xs font-mono text-gray-400 leading-relaxed">
          The following disclosures are intended to help you understand the risks associated with
          using decentralized finance protocols. This is not financial advice. Always do your own
          research and never invest more than you can afford to lose.
        </p>
      </GlassCard>

      <TableOfContents sections={RISK_SECTIONS} onSelect={scrollTo} />

      <div className="space-y-6">
        {RISK_SECTIONS.map((section, i) => (
          <div key={section.id} id={`risk-${section.id}`}>
            <Section delay={0.05 + i * 0.04 * PHI}>
              <GlassCard glowColor="none" className="p-5">
                <div className="flex items-center justify-between mb-4">
                  <h3 className="text-base font-mono font-bold text-white">{section.title}</h3>
                  <span
                    className="text-[10px] font-mono font-bold px-2 py-0.5 rounded-full border"
                    style={{
                      color: section.severityColor,
                      borderColor: `${section.severityColor}40`,
                      backgroundColor: `${section.severityColor}10`,
                    }}
                  >
                    {section.severity}
                  </span>
                </div>
                <LegalParagraphs paragraphs={section.paragraphs} />
              </GlassCard>
            </Section>
          </div>
        ))}
      </div>
    </div>
  )
}

// ============ Cookies Tab ============
function CookiesTab() {
  return (
    <div>
      <GlassCard glowColor="terminal" className="p-5 mb-6">
        <p className="text-sm font-mono text-gray-400 leading-relaxed">
          {COOKIES_CONTENT.intro}
        </p>
      </GlassCard>

      <div className="space-y-6">
        {COOKIES_CONTENT.sections.map((section, i) => (
          <Section key={section.title} title={section.title} delay={0.05 + i * 0.05 * PHI}>
            <GlassCard glowColor="none" className="p-5">
              <p className="text-sm font-mono text-gray-400 mb-4">{section.description}</p>
              <ul className="space-y-2">
                {section.items.map((item, j) => (
                  <li key={j} className="flex items-start gap-2.5 text-sm font-mono text-gray-400">
                    <span
                      className="shrink-0 mt-1 w-1.5 h-1.5 rounded-full"
                      style={{ backgroundColor: CYAN }}
                    />
                    {item}
                  </li>
                ))}
              </ul>
            </GlassCard>
          </Section>
        ))}
      </div>
    </div>
  )
}

// ============ Tab Content Map ============
const TAB_CONTENT = {
  terms: TermsTab,
  privacy: PrivacyTab,
  risk: RiskTab,
  cookies: CookiesTab,
}

// ============================================================
// Main Component
// ============================================================
export default function LegalPage() {
  const [activeTab, setActiveTab] = useState('terms')

  const ActiveContent = TAB_CONTENT[activeTab]

  return (
    <div className="max-w-3xl mx-auto px-4 py-6 space-y-6">
      {/* ============ HERO ============ */}
      <PageHero
        title="Legal"
        subtitle="Terms, privacy, risk disclosures, and cookie policy"
        category="system"
      />

      {/* ============ TAB NAVIGATION ============ */}
      <div className="flex gap-1 p-1 rounded-xl bg-black/30 border border-gray-800/40">
        {TABS.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`flex-1 py-2.5 px-3 rounded-lg text-xs font-mono font-bold transition-all ${
              activeTab === tab.id
                ? 'text-cyan-400 bg-cyan-500/10 border border-cyan-500/30'
                : 'text-gray-500 border border-transparent hover:text-white hover:bg-white/3'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* ============ LAST UPDATED ============ */}
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.1 }}
        className="flex items-center justify-between"
      >
        <p className="text-[10px] font-mono text-gray-600 uppercase tracking-wider">
          Last updated: March 1, 2026
        </p>
        <p className="text-[10px] font-mono text-gray-600">
          VibeSwap Protocol v2.0
        </p>
      </motion.div>

      {/* ============ TAB CONTENT ============ */}
      <motion.div
        key={activeTab}
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 1 / (PHI * PHI), ease: [0.25, 0.1, 1 / PHI, 1] }}
      >
        <ActiveContent />
      </motion.div>

      {/* ============ FOOTER NOTE ============ */}
      <GlassCard glowColor="none" className="p-5">
        <div className="text-center space-y-2">
          <p className="text-xs font-mono text-gray-500">
            Questions about these terms? Reach out through the{' '}
            <span style={{ color: CYAN }}>VibeSwap governance forum</span>{' '}
            or community channels.
          </p>
          <p className="text-[10px] font-mono text-gray-600">
            These documents are provided for informational purposes and do not constitute legal advice.
            Consult a qualified attorney for legal guidance specific to your jurisdiction.
          </p>
        </div>
      </GlassCard>

      {/* Bottom spacing */}
      <div className="h-8" />
    </div>
  )
}
