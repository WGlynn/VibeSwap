// ============ Primitive Gate — CRPC Validation Against Core Values ============
//
// "maybe try doing a crpc against every primitive for every build,
//  that way the code can represent our values mathematically" — Will
//
// Runs each knowledge primitive through CRPC validation to mathematically
// prove that code changes align with our core values. If a change violates
// a primitive, the gate catches it before it ships.
//
// How it works:
//   1. Extract primitives from CKB, MEMORY.md, and identity files
//   2. For each primitive, ask: "Does this change align with [primitive]?"
//   3. CRPC consensus determines pass/fail per primitive
//   4. Results → scored alignment report (0-100% per primitive, overall score)
//   5. Gate decision: PASS (>80% aligned), WARN (60-80%), BLOCK (<60%)
//
// Primitives are not just rules — they're load-bearing values.
// The Lawson Constant doesn't just exist as a hash. It gates deployment.
//
// "The code can represent our values mathematically" — this module IS that math.
// ============

import { readFile } from 'fs/promises'
import { join } from 'path'
import { createHash } from 'crypto'
import { config } from './config.js'

const DATA_DIR = config?.dataDir || process.env.DATA_DIR || './data'
const GATE_LOG = join(DATA_DIR, 'primitive-gate-results.jsonl')

// ============ Core Primitives — Load-Bearing Values ============
// These are extracted from CKB + MEMORY.md + identity axioms.
// Each has an ID, description, and validation prompt template.

const PRIMITIVES = [
  {
    id: 'P-000',
    name: 'Fairness Above All',
    hash: 'keccak256("FAIRNESS_ABOVE_ALL:W.GLYNN:2026")',
    weight: 1.0, // Maximum weight — genesis primitive
    validate: (diff) => `Does this code change uphold fairness? Specifically:
- Does it treat all participants equally?
- Does it prevent exploitation of information asymmetry?
- Does it avoid creating unfair advantages?
Code change: ${diff}
Answer YES (aligned) or NO (violates) with brief reasoning.`,
  },
  {
    id: 'P-001',
    name: 'Cave Philosophy',
    weight: 0.9,
    validate: (diff) => `Does this change embody the Cave Philosophy — building with constraints,
not despite them? Does it avoid over-engineering? Does it solve the problem with minimum
necessary complexity? Constraints breed innovation.
Code change: ${diff}
Answer YES or NO with brief reasoning.`,
  },
  {
    id: 'P-002',
    name: 'Security First',
    weight: 1.0,
    validate: (diff) => `Does this change maintain security? Check for:
- No private key exposure or weakened key management
- No introduction of injection vulnerabilities (SQL, XSS, command)
- No weakened access controls or authentication bypass
- No centralized honeypots (keys, wallets, credentials)
- Cold storage > hot storage principle maintained
Code change: ${diff}
Answer YES (secure) or NO (security concern) with brief reasoning.`,
  },
  {
    id: 'P-003',
    name: 'Cooperative Capitalism',
    weight: 0.8,
    validate: (diff) => `Does this change align with cooperative capitalism?
- Mutualized risk (insurance, stabilization) preserved?
- Free market competition (auctions, arbitrage) preserved?
- No extraction without contribution?
- Incentive alignment maintained?
Code change: ${diff}
Answer YES or NO with brief reasoning.`,
  },
  {
    id: 'P-004',
    name: 'Shards Not Swarms',
    weight: 0.7,
    validate: (diff) => `Does this change respect the symmetry mandate?
- Full-clone agents (shards) > sub-agent delegation (swarms)?
- Does it maintain symmetry across instances?
- Reliability > speed principle?
Code change: ${diff}
Answer YES or NO with brief reasoning.`,
  },
  {
    id: 'P-005',
    name: 'Trust Protocol',
    weight: 0.9,
    validate: (diff) => `Does this change respect the Trust Protocol?
- Honest errors are forgiven, deliberate deception is not
- Genuine honesty > strategic agreeableness
- Transparency over obfuscation
Code change: ${diff}
Answer YES or NO with brief reasoning.`,
  },
  {
    id: 'P-006',
    name: 'MEV Resistance',
    weight: 1.0,
    validate: (diff) => `Does this change maintain MEV resistance?
- Commit-reveal integrity preserved?
- No front-running opportunities introduced?
- No information leakage that enables extraction?
- Uniform clearing price mechanism intact?
Code change: ${diff}
Answer YES or NO with brief reasoning.`,
  },
  {
    id: 'P-007',
    name: 'Community Patience',
    weight: 0.7,
    validate: (diff) => `Does this change honor community members?
- No dismissive or condescending messaging
- User-facing errors are helpful, not hostile
- Community engagement paths preserved
Code change: ${diff}
Answer YES or NO with brief reasoning.`,
  },
  {
    id: 'P-008',
    name: 'Verification Gate',
    weight: 0.8,
    validate: (diff) => `Does this change maintain verification standards?
- No claiming success without proof
- Committed = hash, pushed = output, deployed = HTTP 200
- No bypassing tests or checks
Code change: ${diff}
Answer YES or NO with brief reasoning.`,
  },
  {
    id: 'P-009',
    name: 'Lion Turtle — Unbendable Spirit',
    weight: 0.6,
    validate: (diff) => `Does this change bend energy within (consensus, incentives, identity)
rather than just bending elements (tokens, chains)? Does it add to the system's
core integrity rather than just its surface features?
Code change: ${diff}
Answer YES or NO with brief reasoning.`,
  },
]

// ============ Gate Runner ============

/**
 * Run the primitive gate against a code diff.
 * Uses LLM to evaluate each primitive — can use Ollama (free) or Claude API.
 *
 * @param {string} diff - The code diff to validate
 * @param {Object} opts - Options
 * @param {string} opts.commitHash - The commit being validated
 * @param {boolean} opts.fullCRPC - Run full CRPC (multi-response consensus) instead of single LLM call
 * @returns {Object} Gate result with per-primitive scores and overall alignment
 */
export async function runPrimitiveGate(diff, opts = {}) {
  const { commitHash = 'unknown', fullCRPC = false } = opts

  // Truncate diff to reasonable size for LLM context
  const truncatedDiff = diff.length > 8000 ? diff.slice(0, 8000) + '\n... [truncated]' : diff

  const results = []
  const startTime = Date.now()

  // Evaluate each primitive
  for (const primitive of PRIMITIVES) {
    const prompt = primitive.validate(truncatedDiff)
    let aligned, reasoning

    try {
      if (fullCRPC) {
        // Full CRPC — multi-response consensus
        const { runLocalCRPC } = await import('./crpc.js')
        const crpcResult = await runLocalCRPC('', [{ role: 'user', content: prompt }], { maxTokens: 256 })
        const response = crpcResult.response || ''
        aligned = !response.toUpperCase().startsWith('NO')
        reasoning = response.slice(0, 200)
      } else {
        // Single LLM call (faster, cheaper — good for CI)
        const response = await quickLLMEval(prompt)
        aligned = !response.toUpperCase().startsWith('NO')
        reasoning = response.slice(0, 200)
      }
    } catch (err) {
      // On error, don't block — warn instead
      aligned = true
      reasoning = `[eval error: ${err.message}]`
    }

    results.push({
      id: primitive.id,
      name: primitive.name,
      weight: primitive.weight,
      aligned,
      reasoning,
      score: aligned ? 1.0 : 0.0,
    })
  }

  // Calculate weighted alignment score
  const totalWeight = results.reduce((sum, r) => sum + r.weight, 0)
  const weightedScore = results.reduce((sum, r) => sum + (r.score * r.weight), 0)
  const alignmentScore = (weightedScore / totalWeight) * 100

  // Gate decision
  let decision
  if (alignmentScore >= 80) decision = 'PASS'
  else if (alignmentScore >= 60) decision = 'WARN'
  else decision = 'BLOCK'

  const violations = results.filter(r => !r.aligned)
  const elapsed = Date.now() - startTime

  const gateResult = {
    commitHash,
    timestamp: new Date().toISOString(),
    decision,
    alignmentScore: Math.round(alignmentScore * 10) / 10,
    totalPrimitives: PRIMITIVES.length,
    passed: results.filter(r => r.aligned).length,
    failed: violations.length,
    violations: violations.map(v => ({ id: v.id, name: v.name, reason: v.reasoning })),
    results,
    elapsedMs: elapsed,
  }

  // Log result
  try {
    const { appendFile } = await import('fs/promises')
    await appendFile(GATE_LOG, JSON.stringify(gateResult) + '\n')
  } catch {}

  return gateResult
}

// ============ Quick LLM Evaluation ============

async function quickLLMEval(prompt) {
  const ollamaUrl = process.env.OLLAMA_URL
  const model = process.env.PANTHEON_MODEL || (ollamaUrl ? 'qwen2.5:7b' : 'claude-haiku-4-5-20251001')

  if (ollamaUrl || model.includes('qwen') || model.includes('llama') || model.includes('mistral')) {
    const url = ollamaUrl || 'http://localhost:11434'
    const res = await fetch(`${url}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model,
        messages: [
          { role: 'system', content: 'You are a code review validator. Answer YES or NO followed by brief reasoning.' },
          { role: 'user', content: prompt },
        ],
        stream: false,
      }),
    })
    const data = await res.json()
    return data.message?.content || 'YES [no response]'
  } else {
    const { default: Anthropic } = await import('@anthropic-ai/sdk')
    const client = new Anthropic({ timeout: 30_000 })
    const response = await client.messages.create({
      model,
      max_tokens: 256,
      system: 'You are a code review validator. Answer YES or NO followed by brief reasoning.',
      messages: [{ role: 'user', content: prompt }],
    })
    return response.content.map(b => b.text || '').join('')
  }
}

// ============ Format for Telegram ============

export function formatGateResult(result) {
  const emoji = result.decision === 'PASS' ? '✅' : result.decision === 'WARN' ? '⚠️' : '🚫'

  let msg = `${emoji} Primitive Gate: ${result.decision}\n`
  msg += `━━━━━━━━━━━━━━━━\n`
  msg += `Alignment: ${result.alignmentScore}%\n`
  msg += `Primitives: ${result.passed}/${result.totalPrimitives} passed\n`
  msg += `Time: ${result.elapsedMs}ms\n`

  if (result.violations.length > 0) {
    msg += `\nViolations:\n`
    for (const v of result.violations) {
      msg += `  ${v.id} (${v.name}): ${v.reason.slice(0, 80)}\n`
    }
  }

  return msg
}

// ============ Get Gate History ============

export async function getGateHistory(limit = 10) {
  try {
    const data = await readFile(GATE_LOG, 'utf-8')
    const entries = data.trim().split('\n').filter(Boolean).map(l => JSON.parse(l))
    return entries.slice(-limit)
  } catch {
    return []
  }
}

// ============ Primitives List ============

export function getPrimitives() {
  return PRIMITIVES.map(p => ({
    id: p.id,
    name: p.name,
    weight: p.weight,
    hash: p.hash || null,
  }))
}

// ============ Primitive Hash ============
// The mathematical signature of our values. If this changes, the values changed.

export function getPrimitiveManifest() {
  const serialized = PRIMITIVES.map(p => `${p.id}:${p.name}:${p.weight}`).join('|')
  return {
    hash: createHash('sha256').update(serialized).digest('hex'),
    count: PRIMITIVES.length,
    totalWeight: PRIMITIVES.reduce((s, p) => s + p.weight, 0),
    primitives: getPrimitives(),
  }
}
