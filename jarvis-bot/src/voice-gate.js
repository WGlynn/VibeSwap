// ============ Voice Gate — Post-Draft Filter for TG Jarvis ============
//
// Deterministic filter that catches six failure classes identified on 2026-04-15:
//   1. Inbound/outbound confusion (bot responds to outbound drafts)
//   2. Will-idiom misread (e.g., "run through" parsed as "forward")
//   3. Triumphalist single-primitive collapse
//   4. Posture reversal (audit-useful → audit-unnecessary)
//   5. Sycophancy / tip-farming                          [standard persona only]
//   6. Confidence inflation past source certainty
//
// Persona scoping:
//   - Structural rules (1, 2, 3, 4, 6) apply to ALL personas.
//   - Voice rules (5) apply only to 'standard'. Degen/analyst/sensei have
//     intentional voice deviations and are exempted.
//
// Usage:
//   import { voiceGate } from './voice-gate.js';
//   const result = voiceGate({ userMsg, draft, sourceDoc, persona: 'standard' });
//   if (!result.ok) {
//     const outbound = result.violations.find(v => v.code === 'OUTBOUND_RESPONSE_INTERCEPT');
//     if (outbound) return outbound.fallback;   // send disambiguation question
//     // else: regenerate with error context, or log + send cleaned draft
//   }
//   send(result.cleaned);
//
// Pure JS. No deps. Fail-open on errors — a broken gate must never block the bot
// entirely; it only catches specific misses.
// ============

const SYCOPHANCY_TOKENS = [
  /\byou (touched|nailed|hit) (on )?the real (issue|point|thing)\b/gi,
  /\bthe real issue\b/gi,
  /\bperfect analogy\b/gi,
  /\bexcellent point\b/gi,
  /\bgreat (insight|point|question|observation)\b/gi,
  /\bbeautifully (put|said)\b/gi,
  /\bspot on\b/gi,
  /\bthe rest is noise\b/gi,
  /\babsolutely\b/gi,
  /\bbrilliant (observation|insight|point)\b/gi,
];

const WILL_IDIOM_FORWARD_MISREAD = [
  {
    userPattern: /\brun (?:\w+(?:\s+\w+){0,3}) through\b/i,
    draftPattern: /\b(?:I(?:'ll| will)\s+(?:forward|send|relay|route|pass)\s+(?:it|this|that)|run (?:it|this|that)\s+through\s+[A-Z][a-z]+)\b/,
    reason: 'WILL_IDIOM_MISREAD: "run through" means stress-test adversarially, not forward-to-person',
  },
];

const CONCESSION_MARKERS = [
  /\bconcede\b/gi,
  /\btable stakes\b/gi,
  /\bgenuine hole\b/gi,
  /\baudit (?:is|was) right\b/gi,
  /\bwe'?re (?:wrong|not arguing)\b/gi,
  /\b(?:clean hits?|landed hits?)\b/gi,
  /\b(?:real risk|real concern)\b/gi,
  /\bneeds (?:a )?(?:named |structural )?defense\b/gi,
];

const CERTAINTY_DOWNGRADE_MARKERS = [
  /\bneeds (?:a )?(?:named |structural )?defense\b/gi,
  /\breal risk\b/gi,
  /\bopen question\b/gi,
  /\bgenuine hole\b/gi,
  /\bnot solved\b/gi,
  /\brequires (?:further|more) (?:work|research|audit)\b/gi,
];

const CERTAINTY_INFLATION_MARKERS = [
  /\balready (?:solved|in the repo|eliminated|addressed|fixed)\b/gi,
  /\bno need (?:to wait|for further|to audit)\b/gi,
  /\bfully (?:solved|addressed|eliminated)\b/gi,
  /\b(?:already|simply) solves? (?:it|the problem|the issue)\b/gi,
  /\bthe rest is (?:noise|trivial|detail)\b/gi,
];

const TRIUMPHALIST_COLLAPSE = [
  /\bcommit-reveal (?:batch auctions? )?(?:already )?solves?\b/gi,
  /\b(?:the|our) (?:mechanism|primitive) (?:already )?solves?\b/gi,
];

const OUTBOUND_SIGNALS = {
  thirdPartyTag: /@[\w_]+/,
  markdownFormatting: /(?:^#{1,3} |^---$|\*\*[^*]+\*\*)/m,
  filepathCitation: /\b(?:[A-Z_]+\.md|[A-Z][a-zA-Z]+\.sol|docs\/papers\/[-\w]+\.md|DOCUMENTATION\/[-_A-Z]+\.md)\b/,
  commitHash: /\bcommit\s+`?[0-9a-f]{7,40}`?\b/i,
  sectionedResponse: /^(?:#+\s|\*\*[A-Z])/m,
};

function isOutboundDraft(userMsg) {
  if (!userMsg) return false;
  const hasTag = OUTBOUND_SIGNALS.thirdPartyTag.test(userMsg);
  const hasMarkdown = OUTBOUND_SIGNALS.markdownFormatting.test(userMsg);
  const hasFilepath = OUTBOUND_SIGNALS.filepathCitation.test(userMsg);
  const hasCommit = OUTBOUND_SIGNALS.commitHash.test(userMsg);
  const sectioned = OUTBOUND_SIGNALS.sectionedResponse.test(userMsg);
  const longEnough = userMsg.length > 400;

  if (hasTag && (hasMarkdown || hasFilepath || sectioned)) return true;
  const structuralCount = [hasMarkdown, hasFilepath, hasCommit, sectioned].filter(Boolean).length;
  if (structuralCount >= 2 && longEnough) return true;

  return false;
}

function countMatches(text, patterns) {
  if (!text) return 0;
  let total = 0;
  for (const p of patterns) {
    const m = text.match(p);
    if (m) total += m.length;
  }
  return total;
}

function stripSycophancy(draft) {
  let cleaned = draft;
  const removed = [];
  for (const p of SYCOPHANCY_TOKENS) {
    const matches = cleaned.match(p);
    if (matches) removed.push(...matches);
    cleaned = cleaned.replace(p, '');
  }
  cleaned = cleaned.replace(/\s+([.,;:!?])/g, '$1').replace(/\s{2,}/g, ' ').trim();
  return { cleaned, removed };
}

export function voiceGate({ userMsg = '', draft = '', sourceDoc = '', persona = 'standard', prevMessages = [] } = {}) {
  try {
    const violations = [];
    const voiceRulesApply = persona === 'standard';

    // ---- Rule 1 (universal): Outbound-response intercept ----
    if (isOutboundDraft(userMsg)) {
      const draftEngagesSubstantively = draft.length > 80 && !/^(?:ready|want me to|which of|stress-test|compress|send as-is)/i.test(draft.trim());
      if (draftEngagesSubstantively) {
        violations.push({
          code: 'OUTBOUND_RESPONSE_INTERCEPT',
          detail: 'User pasted outbound draft (@tagged third party or formatted content). Bot drafted substantive response. Should ask disambiguation question instead.',
          fallback: 'Ready — want me to (a) stress-test this against the audit, (b) compress for TG, or (c) send as-is?',
        });
      }
    }

    // ---- Rule 2 (universal): Will-idiom misread ----
    for (const rule of WILL_IDIOM_FORWARD_MISREAD) {
      if (rule.userPattern.test(userMsg) && rule.draftPattern.test(draft)) {
        violations.push({ code: 'WILL_IDIOM_MISREAD', detail: rule.reason });
      }
    }

    // ---- Rule 3 (universal): Triumphalist single-primitive collapse ----
    if (TRIUMPHALIST_COLLAPSE.some(p => p.test(draft))) {
      const sourcePrimitiveCount = sourceDoc
        ? (sourceDoc.match(/\b(?:commit-reveal|peer challenge-response|streaming shapley|stake-bonded pseudonym|two-phase market|merkle.{0,20}dispute|shapley|bonded challenge)\b/gi) || []).length
        : 0;
      if (sourcePrimitiveCount >= 3) {
        violations.push({
          code: 'TRIUMPHALIST_COLLAPSE',
          detail: `Draft uses single-primitive triumphalism ("X solves it"); source cites ${sourcePrimitiveCount} primitives. List the tuple.`,
        });
      }
    }

    // ---- Rule 4 (universal): Certainty inflation past source ----
    const sourceDowngrades = countMatches(sourceDoc, CERTAINTY_DOWNGRADE_MARKERS);
    const draftInflations = countMatches(draft, CERTAINTY_INFLATION_MARKERS);
    if (sourceDowngrades > 0 && draftInflations > 0) {
      violations.push({
        code: 'CERTAINTY_INFLATION',
        detail: `Source has ${sourceDowngrades} uncertainty marker(s); draft has ${draftInflations} "already solved" marker(s). Inherit source epistemic state.`,
      });
    }

    // ---- Rule 5 (universal): Concession erasure ----
    const sourceConcessions = countMatches(sourceDoc, CONCESSION_MARKERS);
    const draftConcessions = countMatches(draft, CONCESSION_MARKERS);
    if (sourceConcessions >= 2 && draftConcessions === 0 && draft.length > 100) {
      violations.push({
        code: 'CONCESSION_ERASURE',
        detail: `Source has ${sourceConcessions} concession(s); draft has 0. Summary must preserve concessions.`,
      });
    }

    // ---- Rule 6 (standard persona only): Sycophancy tokens (auto-strip) ----
    let cleaned = draft;
    if (voiceRulesApply) {
      const result = stripSycophancy(draft);
      cleaned = result.cleaned;
      if (result.removed.length > 0) {
        violations.push({
          code: 'SYCOPHANCY_STRIPPED',
          detail: `Stripped ${result.removed.length} sycophancy token(s): ${result.removed.slice(0, 3).join(', ')}${result.removed.length > 3 ? '...' : ''}`,
          severity: 'auto-fix',
        });
      }
    }

    const blocking = violations.filter(v => v.severity !== 'auto-fix');
    return {
      ok: blocking.length === 0,
      violations,
      cleaned,
      original: draft,
      persona,
    };
  } catch (err) {
    return { ok: true, violations: [], cleaned: draft, original: draft, error: String(err) };
  }
}

export const _internals = {
  isOutboundDraft,
  stripSycophancy,
  SYCOPHANCY_TOKENS,
  WILL_IDIOM_FORWARD_MISREAD,
  OUTBOUND_SIGNALS,
};
