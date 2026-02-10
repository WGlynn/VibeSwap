/**
 * Separation of Powers
 *
 * Inspired by US Constitution's three branches:
 * - Legislative (makes rules)
 * - Executive (enforces rules)
 * - Judicial (interprets rules, resolves disputes)
 *
 * Our system adds a fourth:
 * - Finality (creates irreversible checkpoints)
 *
 * Key principle: No single entity should hold multiple powers.
 * Each branch checks the others.
 *
 * ============================================================
 * COMPATIBILITY GUARANTEE
 * ============================================================
 * This module is ADVISORY ONLY. It NEVER blocks existing mechanisms.
 *
 * - All functions return recommendations, not gates
 * - Existing governance, trust, rewards work unchanged
 * - Separation issues are LOGGED, not ENFORCED
 * - Safe to call from anywhere without breaking flows
 *
 * The system monitors and warns. It does not prevent.
 * Enforcement is opt-in and future-facing.
 * ============================================================
 *
 * @version 1.0.0
 */

// ============================================================
// CONFIGURATION
// ============================================================

export const SEPARATION_CONFIG = {
  // Minimum users required for each branch
  MIN_LEGISLATIVE_MEMBERS: 5,
  MIN_JUDICIAL_JURORS: 7,
  MIN_FINALITY_VALIDATORS: 3,

  // Role rotation
  JUDICIAL_TERM_EPOCHS: 4,        // Jurors rotate every 4 epochs
  FINALITY_ROTATION_CHECKPOINTS: 10,  // Validators rotate every 10 checkpoints

  // Veto thresholds
  LEGISLATIVE_VETO_THRESHOLD: 0.66,   // 66% to pass
  JUDICIAL_VETO_THRESHOLD: 0.71,      // 5/7 jurors to convict
  FINALITY_VETO_THRESHOLD: 0.66,      // 66% validators to checkpoint

  // Conflict of interest cooldown
  RECUSAL_PERIOD_MS: 30 * 24 * 60 * 60 * 1000,  // 30 days
}

// ============================================================
// BRANCH DEFINITIONS
// ============================================================

/**
 * The Four Branches of Power
 *
 * 1. LEGISLATIVE - Proposes and votes on rule changes
 *    - Cannot: Judge disputes, create checkpoints
 *    - Checked by: Judicial can rule proposals unconstitutional
 *
 * 2. EXECUTIVE - The protocol itself (immutable code)
 *    - Cannot: Change rules, judge edge cases
 *    - Checked by: Legislative can update, Judicial interprets
 *
 * 3. JUDICIAL - Resolves disputes, interprets rules
 *    - Cannot: Make new rules, vote on proposals
 *    - Checked by: Random selection, term limits, recusal
 *
 * 4. FINALITY - Creates checkpoints, ensures irreversibility
 *    - Cannot: Change state, only attest to it
 *    - Checked by: Rotation, multi-sig requirement
 */

export const BRANCHES = {
  LEGISLATIVE: {
    name: 'Legislative',
    powers: ['propose_rules', 'vote_on_rules', 'set_parameters'],
    cannot: ['judge_disputes', 'create_checkpoints', 'grant_trust_unilaterally'],
    checkedBy: ['JUDICIAL'],
  },
  EXECUTIVE: {
    name: 'Executive',
    powers: ['enforce_rules', 'distribute_rewards', 'apply_penalties'],
    cannot: ['change_rules', 'interpret_edge_cases', 'make_exceptions'],
    checkedBy: ['LEGISLATIVE', 'JUDICIAL'],
    note: 'This is the protocol code itself - deterministic and neutral',
  },
  JUDICIAL: {
    name: 'Judicial',
    powers: ['resolve_disputes', 'interpret_rules', 'rule_unconstitutional'],
    cannot: ['make_rules', 'vote_on_proposals', 'create_checkpoints'],
    checkedBy: ['random_selection', 'term_limits', 'recusal_requirements'],
  },
  FINALITY: {
    name: 'Finality',
    powers: ['create_checkpoints', 'attest_state', 'anchor_history'],
    cannot: ['modify_state', 'reverse_transactions', 'censor_actions'],
    checkedBy: ['rotation', 'multi_validator', 'transparent_selection'],
  },
}

// ============================================================
// ROLE ASSIGNMENT
// ============================================================

/**
 * Assign users to branches based on eligibility
 * Key rule: Cannot hold multiple branch roles simultaneously
 */
export function assignBranchRoles(users, trustScores, currentEpoch) {
  const assignments = {
    legislative: [],
    judicial: [],
    finality: [],
    ineligible: [],
  }

  // Sort by trust score for fair distribution
  const eligible = users
    .filter(u => trustScores[u]?.score >= 0.3)  // Minimum trust
    .sort((a, b) => trustScores[b].score - trustScores[a].score)

  if (eligible.length < 15) {
    // Not enough users for full separation - bootstrap mode
    return {
      ...assignments,
      bootstrapMode: true,
      reason: 'Insufficient trusted users for full separation',
    }
  }

  // Deterministic but rotating assignment based on epoch
  eligible.forEach((user, index) => {
    // Rotate assignment based on epoch to prevent entrenchment
    const rotatedIndex = (index + currentEpoch) % eligible.length
    const branch = rotatedIndex % 3

    if (branch === 0 && assignments.legislative.length < Math.ceil(eligible.length / 3)) {
      assignments.legislative.push(user)
    } else if (branch === 1 && assignments.judicial.length < Math.ceil(eligible.length / 3)) {
      assignments.judicial.push(user)
    } else if (assignments.finality.length < Math.ceil(eligible.length / 3)) {
      assignments.finality.push(user)
    } else {
      // Overflow goes to largest branch
      assignments.legislative.push(user)
    }
  })

  return {
    ...assignments,
    bootstrapMode: false,
    epoch: currentEpoch,
  }
}

// ============================================================
// JUDICIAL: Random Jury Selection
// ============================================================

/**
 * Select random jury for a dispute
 * Excludes parties involved and their direct vouchers
 */
export function selectJury(dispute, judicialPool, trustGraph) {
  const { plaintiff, defendant } = dispute

  // Build exclusion list (conflict of interest)
  const excluded = new Set([plaintiff, defendant])

  // Exclude direct vouchers of both parties
  Object.entries(trustGraph.vouches || {}).forEach(([voucher, vouchees]) => {
    if (vouchees[plaintiff] || vouchees[defendant]) {
      excluded.add(voucher)
    }
  })

  // Exclude anyone vouched BY either party
  const plaintiffVouches = Object.keys(trustGraph.vouches?.[plaintiff] || {})
  const defendantVouches = Object.keys(trustGraph.vouches?.[defendant] || {})
  plaintiffVouches.forEach(v => excluded.add(v))
  defendantVouches.forEach(v => excluded.add(v))

  // Filter eligible jurors
  const eligibleJurors = judicialPool.filter(j => !excluded.has(j))

  if (eligibleJurors.length < SEPARATION_CONFIG.MIN_JUDICIAL_JURORS) {
    return {
      success: false,
      reason: 'Insufficient eligible jurors after recusals',
      eligible: eligibleJurors.length,
      required: SEPARATION_CONFIG.MIN_JUDICIAL_JURORS,
    }
  }

  // Random selection using dispute ID as seed for determinism
  const seed = hashString(dispute.id)
  const shuffled = seededShuffle(eligibleJurors, seed)
  const jury = shuffled.slice(0, SEPARATION_CONFIG.MIN_JUDICIAL_JURORS)

  return {
    success: true,
    jury,
    excluded: [...excluded],
    selectionSeed: seed,
  }
}

/**
 * Simple deterministic hash for seeding
 */
function hashString(str) {
  let hash = 0
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i)
    hash = ((hash << 5) - hash) + char
    hash = hash & hash
  }
  return Math.abs(hash)
}

/**
 * Seeded shuffle (Fisher-Yates with seed)
 */
function seededShuffle(array, seed) {
  const result = [...array]
  let currentSeed = seed

  const random = () => {
    currentSeed = (currentSeed * 1103515245 + 12345) & 0x7fffffff
    return currentSeed / 0x7fffffff
  }

  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1))
    ;[result[i], result[j]] = [result[j], result[i]]
  }

  return result
}

// ============================================================
// FINALITY: Rotating Validators
// ============================================================

/**
 * Select validators for next checkpoint
 * Rotates to prevent capture
 */
export function selectValidators(finalityPool, checkpointHeight) {
  if (finalityPool.length < SEPARATION_CONFIG.MIN_FINALITY_VALIDATORS) {
    return {
      success: false,
      reason: 'Insufficient finality validators',
    }
  }

  // Rotate based on checkpoint height
  const offset = checkpointHeight % finalityPool.length
  const validators = []

  for (let i = 0; i < SEPARATION_CONFIG.MIN_FINALITY_VALIDATORS; i++) {
    const index = (offset + i) % finalityPool.length
    validators.push(finalityPool[index])
  }

  return {
    success: true,
    validators,
    checkpointHeight,
    nextRotation: checkpointHeight + SEPARATION_CONFIG.FINALITY_ROTATION_CHECKPOINTS,
  }
}

/**
 * Validate checkpoint requires threshold of validators
 */
export function validateCheckpoint(checkpoint, validatorSignatures, validators) {
  const validSignatures = validatorSignatures.filter(sig =>
    validators.includes(sig.validator)
  )

  const ratio = validSignatures.length / validators.length
  const valid = ratio >= SEPARATION_CONFIG.FINALITY_VETO_THRESHOLD

  return {
    valid,
    signatures: validSignatures.length,
    required: Math.ceil(validators.length * SEPARATION_CONFIG.FINALITY_VETO_THRESHOLD),
    validators: validators.length,
  }
}

// ============================================================
// CHECKS AND BALANCES
// ============================================================

/**
 * Legislative proposal must pass judicial review
 */
export function judicialReview(proposal, jury) {
  // Jury votes on constitutionality
  // Returns whether proposal violates core principles

  const coreViolations = []

  // Check for separation violations
  if (proposal.grantsMultipleBranches) {
    coreViolations.push('Violates separation of powers')
  }

  // Check for retroactive punishment
  if (proposal.retroactive && proposal.punitive) {
    coreViolations.push('Ex post facto - retroactive punishment forbidden')
  }

  // Check for targeted legislation
  if (proposal.targetedUsers && proposal.targetedUsers.length < 10) {
    coreViolations.push('Bill of attainder - cannot target specific individuals')
  }

  return {
    constitutional: coreViolations.length === 0,
    violations: coreViolations,
    requiresJuryVote: coreViolations.length > 0,
  }
}

/**
 * Check if action violates separation of powers
 */
export function checkSeparationViolation(actor, action, branchAssignments) {
  const actorBranch = getBranch(actor, branchAssignments)

  if (!actorBranch) {
    return { violation: false, reason: 'Actor not in any branch' }
  }

  const branchDef = BRANCHES[actorBranch]
  const actionType = categorizeAction(action)

  if (branchDef.cannot.includes(actionType)) {
    return {
      violation: true,
      actor,
      actorBranch,
      attemptedAction: actionType,
      reason: `${branchDef.name} branch cannot ${actionType}`,
    }
  }

  return { violation: false }
}

function getBranch(user, assignments) {
  if (!assignments) return null
  if (assignments.legislative?.includes(user)) return 'LEGISLATIVE'
  if (assignments.judicial?.includes(user)) return 'JUDICIAL'
  if (assignments.finality?.includes(user)) return 'FINALITY'
  return null
}

function categorizeAction(action) {
  const actionMap = {
    'propose_rule': 'propose_rules',
    'vote_proposal': 'vote_on_rules',
    'judge_dispute': 'judge_disputes',
    'create_checkpoint': 'create_checkpoints',
    'grant_trust': 'grant_trust_unilaterally',
  }
  return actionMap[action.type] || action.type
}

// ============================================================
// IMPEACHMENT / REMOVAL
// ============================================================

/**
 * Any branch can initiate removal of member from another branch
 * Requires supermajority from TWO branches
 */
export function initiateRemoval(target, initiatingBranch, reason, branchAssignments) {
  const targetBranch = getBranch(target, branchAssignments)

  if (targetBranch === initiatingBranch) {
    return {
      success: false,
      reason: 'Cannot remove member of own branch - requires external check',
    }
  }

  return {
    success: true,
    removalProposal: {
      id: `removal-${Date.now()}`,
      target,
      targetBranch,
      initiatingBranch,
      reason,
      requiredVotes: {
        // Needs supermajority from two OTHER branches
        branches: Object.keys(BRANCHES).filter(b =>
          b !== targetBranch && b !== 'EXECUTIVE'  // Executive is code, can't vote
        ),
        threshold: SEPARATION_CONFIG.LEGISLATIVE_VETO_THRESHOLD,
      },
      votes: {},
      status: 'PENDING',
    },
  }
}

// ============================================================
// POWER AUDIT
// ============================================================

/**
 * Audit current power distribution
 * Flags concentration risks
 */
export function auditPowerDistribution(branchAssignments, trustGraph) {
  const issues = []

  // Check for users in multiple branches
  const allAssigned = [
    ...branchAssignments.legislative,
    ...branchAssignments.judicial,
    ...branchAssignments.finality,
  ]
  const duplicates = allAssigned.filter((user, i) => allAssigned.indexOf(user) !== i)

  if (duplicates.length > 0) {
    issues.push({
      severity: 'CRITICAL',
      type: 'MULTI_BRANCH',
      message: `Users in multiple branches: ${duplicates.join(', ')}`,
      users: duplicates,
    })
  }

  // Check for small branches (capture risk)
  Object.entries(branchAssignments).forEach(([branch, members]) => {
    if (Array.isArray(members) && members.length < 3 && members.length > 0) {
      issues.push({
        severity: 'HIGH',
        type: 'SMALL_BRANCH',
        message: `${branch} has only ${members.length} members - capture risk`,
        branch,
        members,
      })
    }
  })

  // Check for trust concentration in any branch
  const founders = ['Faraday1']  // From trust config
  founders.forEach(founder => {
    const founderBranch = getBranch(founder, branchAssignments)
    if (founderBranch) {
      issues.push({
        severity: 'MEDIUM',
        type: 'FOUNDER_IN_BRANCH',
        message: `Founder ${founder} is in ${founderBranch} - consider recusal from sensitive votes`,
        founder,
        branch: founderBranch,
      })
    }
  })

  return {
    healthy: issues.filter(i => i.severity === 'CRITICAL').length === 0,
    issues,
    summary: {
      legislative: branchAssignments.legislative?.length || 0,
      judicial: branchAssignments.judicial?.length || 0,
      finality: branchAssignments.finality?.length || 0,
      criticalIssues: issues.filter(i => i.severity === 'CRITICAL').length,
      highIssues: issues.filter(i => i.severity === 'HIGH').length,
    },
  }
}

// ============================================================
// COMPATIBILITY WRAPPERS
// ============================================================
//
// These wrappers ensure separation NEVER breaks existing mechanisms.
// They return { allowed: true } always, plus advisory info.
// Existing code can safely ignore the advisory info.

/**
 * SAFE wrapper for any governance action
 * ALWAYS returns allowed: true - never blocks
 * Adds advisory warnings if separation issues detected
 */
export function wrapGovernanceAction(action, actor, branchAssignments, trustGraph) {
  const result = {
    allowed: true,  // ALWAYS TRUE - never blocks existing mechanisms
    action,
    actor,
    advisory: {
      separationWarnings: [],
      recommendations: [],
    },
  }

  try {
    // Check separation - but only for warnings
    if (branchAssignments && !branchAssignments.bootstrapMode) {
      const violation = checkSeparationViolation(actor, action, branchAssignments)
      if (violation.violation) {
        result.advisory.separationWarnings.push(violation)
        result.advisory.recommendations.push(
          `Consider: ${violation.reason}. Action proceeds regardless.`
        )
      }
    }

    // Audit power distribution - but only for warnings
    if (branchAssignments && trustGraph) {
      const audit = auditPowerDistribution(branchAssignments, trustGraph)
      if (!audit.healthy) {
        result.advisory.separationWarnings.push(...audit.issues)
      }
    }
  } catch (err) {
    // Even if separation check fails, action is STILL allowed
    result.advisory.error = `Separation check failed: ${err.message}. Action proceeds.`
  }

  return result
}

/**
 * SAFE wrapper for dispute resolution
 * ALWAYS allows existing governance resolution
 * Optionally suggests jury if separation is active
 */
export function wrapDisputeResolution(dispute, existingResolver, branchAssignments, trustGraph) {
  const result = {
    allowed: true,  // ALWAYS TRUE
    useExistingResolver: true,  // Default to existing mechanism
    dispute,
    advisory: {
      juryAvailable: false,
      suggestedJury: null,
    },
  }

  try {
    // If we have enough users for separation, SUGGEST jury (don't require)
    if (branchAssignments && !branchAssignments.bootstrapMode && branchAssignments.judicial?.length >= 7) {
      const juryResult = selectJury(dispute, branchAssignments.judicial, trustGraph)
      if (juryResult.success) {
        result.advisory.juryAvailable = true
        result.advisory.suggestedJury = juryResult.jury
        result.advisory.recommendation = 'Jury available if desired. Existing resolution also valid.'
      }
    }
  } catch (err) {
    // Jury selection failed - no problem, use existing resolver
    result.advisory.error = `Jury selection failed: ${err.message}. Using existing resolver.`
  }

  return result
}

/**
 * SAFE wrapper for checkpoint creation
 * ALWAYS allows existing checkpoint mechanism
 * Optionally validates with rotating validators if available
 */
export function wrapCheckpointCreation(checkpoint, creator, branchAssignments) {
  const result = {
    allowed: true,  // ALWAYS TRUE
    checkpoint,
    creator,
    advisory: {
      validatorsAvailable: false,
      suggestedValidators: null,
    },
  }

  try {
    // If we have finality branch, SUGGEST validators (don't require)
    if (branchAssignments && !branchAssignments.bootstrapMode && branchAssignments.finality?.length >= 3) {
      const validatorResult = selectValidators(branchAssignments.finality, checkpoint.height || 0)
      if (validatorResult.success) {
        result.advisory.validatorsAvailable = true
        result.advisory.suggestedValidators = validatorResult.validators
        result.advisory.recommendation = 'Multi-validator signing available if desired.'
      }
    }
  } catch (err) {
    // Validator selection failed - no problem, checkpoint proceeds
    result.advisory.error = `Validator selection failed: ${err.message}. Checkpoint proceeds.`
  }

  return result
}

/**
 * SAFE wrapper for trust/vouch operations
 * ALWAYS allows existing trust mechanism
 * Logs if vouch creates separation concerns
 */
export function wrapTrustOperation(operation, actor, target, branchAssignments) {
  const result = {
    allowed: true,  // ALWAYS TRUE
    operation,
    actor,
    target,
    advisory: {
      warnings: [],
    },
  }

  try {
    // Check if both actor and target are in same branch (potential collusion)
    if (branchAssignments && !branchAssignments.bootstrapMode) {
      const actorBranch = getBranch(actor, branchAssignments)
      const targetBranch = getBranch(target, branchAssignments)

      if (actorBranch && targetBranch && actorBranch === targetBranch) {
        result.advisory.warnings.push({
          type: 'SAME_BRANCH_VOUCH',
          message: `Both parties in ${actorBranch} branch. Consider diversifying trust.`,
          severity: 'LOW',  // Just informational
        })
      }
    }
  } catch (err) {
    // Check failed - vouch proceeds anyway
    result.advisory.error = `Trust check failed: ${err.message}. Operation proceeds.`
  }

  return result
}

/**
 * Get separation status without affecting anything
 * Pure read-only audit
 */
export function getSeparationStatus(branchAssignments, trustGraph) {
  const status = {
    active: false,
    bootstrapMode: true,
    healthy: true,
    warnings: [],
    branches: {
      legislative: 0,
      judicial: 0,
      finality: 0,
    },
  }

  try {
    if (branchAssignments) {
      status.bootstrapMode = branchAssignments.bootstrapMode || false
      status.active = !status.bootstrapMode
      status.branches = {
        legislative: branchAssignments.legislative?.length || 0,
        judicial: branchAssignments.judicial?.length || 0,
        finality: branchAssignments.finality?.length || 0,
      }

      if (trustGraph && !status.bootstrapMode) {
        const audit = auditPowerDistribution(branchAssignments, trustGraph)
        status.healthy = audit.healthy
        status.warnings = audit.issues || []
      }
    }
  } catch (err) {
    status.error = err.message
  }

  return status
}

// Note: getBranch is defined earlier in the file

// ============================================================
// EXPORT
// ============================================================

export default {
  SEPARATION_CONFIG,
  BRANCHES,
  assignBranchRoles,
  selectJury,
  selectValidators,
  validateCheckpoint,
  judicialReview,
  checkSeparationViolation,
  initiateRemoval,
  auditPowerDistribution,
  // SAFE WRAPPERS - use these to integrate without breaking anything
  wrapGovernanceAction,
  wrapDisputeResolution,
  wrapCheckpointCreation,
  wrapTrustOperation,
  getSeparationStatus,
}
