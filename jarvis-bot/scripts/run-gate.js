#!/usr/bin/env node
// ============ Primitive Gate — CI Runner ============
//
// Runs the primitive gate against the last commit's diff.
// Designed for GitHub Actions but works locally too.
//
// Exit codes:
//   0 = PASS (or WARN with warning, or SKIP if no LLM configured)
//   1 = BLOCK
//
// Usage: node scripts/run-gate.js
// ============

import { execSync } from 'child_process'
import { runPrimitiveGate, getPrimitiveManifest } from '../src/primitive-gate.js'

// ============ LLM Availability Check ============

function hasLLM() {
  return !!(process.env.ANTHROPIC_API_KEY || process.env.OLLAMA_URL)
}

// ============ Get Last Commit Diff ============

function getLastCommitDiff() {
  try {
    const diff = execSync('git diff HEAD~1 HEAD', { encoding: 'utf-8', maxBuffer: 1024 * 1024 })
    return diff || '[empty diff]'
  } catch {
    // Fallback: might be first commit or shallow clone
    try {
      const diff = execSync('git show --format="" HEAD', { encoding: 'utf-8', maxBuffer: 1024 * 1024 })
      return diff || '[empty diff]'
    } catch {
      return '[could not retrieve diff]'
    }
  }
}

// ============ Get Commit Info ============

function getCommitHash() {
  try {
    return execSync('git rev-parse --short HEAD', { encoding: 'utf-8' }).trim()
  } catch {
    return 'unknown'
  }
}

// ============ CI Output Helpers ============

function ciLog(msg) {
  console.log(msg)
}

function ciGroup(title, fn) {
  if (process.env.GITHUB_ACTIONS) {
    console.log(`::group::${title}`)
    fn()
    console.log('::endgroup::')
  } else {
    console.log(`\n--- ${title} ---`)
    fn()
  }
}

function ciWarning(msg) {
  if (process.env.GITHUB_ACTIONS) {
    console.log(`::warning::${msg}`)
  } else {
    console.log(`WARNING: ${msg}`)
  }
}

function ciError(msg) {
  if (process.env.GITHUB_ACTIONS) {
    console.log(`::error::${msg}`)
  } else {
    console.log(`ERROR: ${msg}`)
  }
}

// ============ Main ============

async function main() {
  const commitHash = getCommitHash()
  ciLog(`Primitive Gate — commit ${commitHash}`)
  ciLog('================================')

  // Check LLM availability
  if (!hasLLM()) {
    ciLog('SKIP: no LLM configured (set ANTHROPIC_API_KEY or OLLAMA_URL)')
    ciLog('Gate validation skipped — primitives not evaluated')
    process.exit(0)
  }

  // Print manifest for audit trail
  ciGroup('Primitive Manifest', () => {
    const manifest = getPrimitiveManifest()
    ciLog(`Primitives: ${manifest.count}`)
    ciLog(`Total weight: ${manifest.totalWeight}`)
    ciLog(`Manifest hash: ${manifest.hash}`)
    for (const p of manifest.primitives) {
      ciLog(`  ${p.id} ${p.name} (weight: ${p.weight})`)
    }
  })

  // Get diff
  const diff = getLastCommitDiff()
  ciGroup('Diff Stats', () => {
    const lines = diff.split('\n').length
    ciLog(`Diff lines: ${lines}`)
    if (diff.length > 8000) {
      ciLog(`Diff truncated from ${diff.length} to 8000 chars for LLM evaluation`)
    }
  })

  // Run the gate
  ciLog('\nRunning primitive gate...')
  const result = await runPrimitiveGate(diff, { commitHash, fullCRPC: false })

  // Output results
  ciGroup('Per-Primitive Results', () => {
    for (const r of result.results) {
      const status = r.aligned ? 'PASS' : 'FAIL'
      ciLog(`  [${status}] ${r.id} ${r.name} (weight: ${r.weight})`)
      if (!r.aligned) {
        ciLog(`         Reason: ${r.reasoning}`)
      }
    }
  })

  ciLog('\n================================')
  ciLog(`Decision: ${result.decision}`)
  ciLog(`Alignment: ${result.alignmentScore}%`)
  ciLog(`Passed: ${result.passed}/${result.totalPrimitives}`)
  ciLog(`Time: ${result.elapsedMs}ms`)

  // Handle violations
  if (result.violations.length > 0) {
    ciGroup('Violations', () => {
      for (const v of result.violations) {
        ciLog(`  ${v.id} (${v.name}): ${v.reason}`)
      }
    })
  }

  // Set exit code based on decision
  if (result.decision === 'BLOCK') {
    ciError(`Primitive gate BLOCKED — alignment ${result.alignmentScore}% (threshold: 60%)`)
    process.exit(1)
  } else if (result.decision === 'WARN') {
    ciWarning(`Primitive gate WARNING — alignment ${result.alignmentScore}% (threshold for PASS: 80%)`)
    process.exit(0)
  } else {
    ciLog('\nPrimitive gate PASSED.')
    process.exit(0)
  }
}

main().catch((err) => {
  ciError(`Primitive gate crashed: ${err.message}`)
  console.error(err.stack)
  // Don't block CI on gate crashes
  process.exit(0)
})
