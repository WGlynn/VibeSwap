#!/usr/bin/env bash
# mint-attestation.sh — canonical minter for the Chat-to-DAG Traceability loop.
#
# Wraps `cast send ContributionAttestor.submitClaim` with the canonical argument
# construction (evidenceHash from keccak256(issueNumber, commitSHA, sourceTimestamp),
# ContributionType derived from issue labels, value derived from issue type).
#
# Usage:
#   scripts/mint-attestation.sh <issue-number> <commit-sha>
#   scripts/mint-attestation.sh --backfill <issue-number> <commit-sha>
#   scripts/mint-attestation.sh --backfill-annotation <issue-number>   # no mint, just the closing-comment markdown
#   scripts/mint-attestation.sh --dry-run <issue-number> <commit-sha>
#
# Env:
#   CONTRIBUTION_ATTESTOR_ADDRESS   (required unless --dry-run / --backfill-annotation)
#   RPC_URL                          (required unless --dry-run / --backfill-annotation)
#   MINTER_PRIVATE_KEY               (required unless --dry-run / --backfill-annotation)
#   DEFAULT_CONTRIBUTOR_ADDRESS      (fallback when the issue's Source.Contributor is not chain-bound)
#   EXPLORER_BASE                    (optional — e.g., https://etherscan.io/tx/)
#
# Dependencies: gh, jq, cast (foundry), git
#
# Output:
#   - Prints the claimId to stdout (or "pending" for --backfill-annotation).
#   - Writes .traceability/closing-comment-<N>.md for copy-paste into the issue.
#   - Writes .traceability/mint-log.jsonl — one JSON line per mint for audit trail.

set -euo pipefail

# ============ Argument parsing ============

MODE="mint"
DRY_RUN=0
while [[ $# -gt 0 ]]; do
    case "$1" in
        --backfill)
            MODE="backfill"
            shift
            ;;
        --backfill-annotation)
            MODE="annotation"
            shift
            ;;
        --dry-run)
            DRY_RUN=1
            shift
            ;;
        -h|--help)
            sed -n '2,25p' "$0"
            exit 0
            ;;
        *)
            break
            ;;
    esac
done

if [[ "$MODE" == "annotation" ]]; then
    if [[ $# -lt 1 ]]; then
        echo "ERROR: --backfill-annotation requires <issue-number>" >&2
        exit 2
    fi
    ISSUE_NUMBER="$1"
    COMMIT_SHA=""
else
    if [[ $# -lt 2 ]]; then
        echo "ERROR: need <issue-number> <commit-sha>" >&2
        sed -n '2,25p' "$0" >&2
        exit 2
    fi
    ISSUE_NUMBER="$1"
    COMMIT_SHA="$2"
fi

# ============ Deps ============

for cmd in gh jq git; do
    if ! command -v "$cmd" >/dev/null 2>&1; then
        echo "ERROR: missing dependency: $cmd" >&2
        exit 3
    fi
done

if [[ "$MODE" != "annotation" ]] && [[ "$DRY_RUN" -eq 0 ]]; then
    if ! command -v cast >/dev/null 2>&1; then
        echo "ERROR: missing dependency: cast (foundry). Install via 'foundryup'." >&2
        exit 3
    fi
    : "${CONTRIBUTION_ATTESTOR_ADDRESS:?env var required — deployed ContributionAttestor address}"
    : "${RPC_URL:?env var required}"
    : "${MINTER_PRIVATE_KEY:?env var required — keeper or project-account private key}"
fi

mkdir -p .traceability

# ============ Fetch issue metadata ============

echo "→ Fetching issue #${ISSUE_NUMBER} metadata..." >&2
ISSUE_JSON=$(gh issue view "$ISSUE_NUMBER" --json number,title,body,labels,createdAt,closedAt,author 2>/dev/null || {
    echo "ERROR: gh issue view #${ISSUE_NUMBER} failed. Is gh authenticated? Is the issue number valid?" >&2
    exit 4
})

ISSUE_TITLE=$(echo "$ISSUE_JSON" | jq -r '.title')
ISSUE_BODY=$(echo "$ISSUE_JSON" | jq -r '.body // ""')
ISSUE_CREATED_AT=$(echo "$ISSUE_JSON" | jq -r '.createdAt')
ISSUE_LABELS=$(echo "$ISSUE_JSON" | jq -r '[.labels[].name] | join(",")')

# Parse the Source block from the issue body (best-effort regex).
SOURCE_CHANNEL=$(echo "$ISSUE_BODY" | grep -oE '\*\*Channel\*\*:[[:space:]]*[^[:cntrl:]]+' | head -1 | sed 's/\*\*Channel\*\*:[[:space:]]*//' | xargs || true)
SOURCE_CONTRIBUTOR=$(echo "$ISSUE_BODY" | grep -oE '\*\*Contributor\*\*:[[:space:]]*[^[:cntrl:]]+' | head -1 | sed 's/\*\*Contributor\*\*:[[:space:]]*//' | xargs || true)
SOURCE_DATE=$(echo "$ISSUE_BODY" | grep -oE '\*\*Date\*\*:[[:space:]]*[0-9]{4}-[0-9]{2}-[0-9]{2}' | head -1 | awk '{print $NF}' || true)

# Fall back to issue createdAt if Source.Date missing.
if [[ -z "${SOURCE_DATE:-}" ]]; then
    SOURCE_DATE=$(echo "$ISSUE_CREATED_AT" | cut -c1-10)
fi

# Map SOURCE_DATE (YYYY-MM-DD) to unix seconds. Portable between GNU date and BSD date.
if date -d "${SOURCE_DATE}" +%s >/dev/null 2>&1; then
    SOURCE_TIMESTAMP=$(date -d "${SOURCE_DATE}" +%s)
else
    SOURCE_TIMESTAMP=$(date -j -f "%Y-%m-%d" "${SOURCE_DATE}" +%s 2>/dev/null || echo "0")
fi

if [[ "$SOURCE_TIMESTAMP" -eq 0 ]]; then
    echo "WARN: failed to parse SOURCE_DATE=${SOURCE_DATE}; using issue createdAt unix-seconds" >&2
    SOURCE_TIMESTAMP=$(date -d "${ISSUE_CREATED_AT}" +%s 2>/dev/null || date -j -f "%Y-%m-%dT%H:%M:%SZ" "${ISSUE_CREATED_AT}" +%s 2>/dev/null || echo "0")
fi

# ============ Map labels → ContributionType enum int ============

CONTRIB_TYPE_INT=7  # Inspiration is the default (Dialogue issues lean here)
case "$ISSUE_LABELS" in
    *type:code*)        CONTRIB_TYPE_INT=0 ;;
    *type:design*)      CONTRIB_TYPE_INT=1 ;;
    *type:research*)    CONTRIB_TYPE_INT=2 ;;
    *type:community*)   CONTRIB_TYPE_INT=3 ;;
    *type:marketing*)   CONTRIB_TYPE_INT=4 ;;
    *type:security*)    CONTRIB_TYPE_INT=5 ;;
    *type:governance*)  CONTRIB_TYPE_INT=6 ;;
    *type:inspiration*) CONTRIB_TYPE_INT=7 ;;
    *type:other*)       CONTRIB_TYPE_INT=8 ;;
esac

# ============ Derive initial value from issue title prefix ============

case "$ISSUE_TITLE" in
    \[Audit\]*|\[Design\]*)  INITIAL_VALUE="5000000000000000000" ;;   # 5e18
    \[Feat\]*)               INITIAL_VALUE="3000000000000000000" ;;   # 3e18
    \[Bug\]*|\[Meta\]*)      INITIAL_VALUE="2000000000000000000" ;;   # 2e18
    *)                       INITIAL_VALUE="1000000000000000000" ;;   # 1e18 (Dialogue default)
esac

# ============ Resolve Contributor address ============

# Accept either @handle or 0x... in Source.Contributor; extract 0x if present.
CONTRIBUTOR_ADDR=$(echo "$SOURCE_CONTRIBUTOR" | grep -oE '0x[a-fA-F0-9]{40}' | head -1 || true)
if [[ -z "${CONTRIBUTOR_ADDR:-}" ]]; then
    CONTRIBUTOR_ADDR="${DEFAULT_CONTRIBUTOR_ADDRESS:-0x0000000000000000000000000000000000000000}"
    CONTRIBUTOR_NOTE="(fallback to DEFAULT_CONTRIBUTOR_ADDRESS — no 0x-address in Source.Contributor)"
else
    CONTRIBUTOR_NOTE=""
fi

# ============ Compute evidenceHash ============

if [[ -n "$COMMIT_SHA" ]]; then
    # Validate commit SHA and pad to bytes32.
    FULL_SHA=$(git rev-parse --verify "${COMMIT_SHA}" 2>/dev/null || true)
    if [[ -z "$FULL_SHA" ]]; then
        echo "WARN: commit SHA '${COMMIT_SHA}' not found in local git; using as-is" >&2
        FULL_SHA="$COMMIT_SHA"
    fi
    # Strip 0x if present, pad to 64 hex chars (bytes32 = 32 bytes = 64 hex).
    SHA_HEX=$(echo "$FULL_SHA" | sed 's/^0x//' | head -c 40)
    SHA_BYTES32="0x${SHA_HEX}$(printf '0%.0s' {1..24})"  # right-pad to 32 bytes (SHA-1 is 20 bytes)
else
    SHA_BYTES32="0x0000000000000000000000000000000000000000000000000000000000000000"
fi

if [[ "$DRY_RUN" -eq 0 ]] && [[ "$MODE" != "annotation" ]]; then
    EVIDENCE_HASH=$(cast keccak "$(cast abi-encode 'f(uint256,bytes32,uint64)' "$ISSUE_NUMBER" "$SHA_BYTES32" "$SOURCE_TIMESTAMP")")
else
    EVIDENCE_HASH="0xDRYRUN-$(printf '%016x' "$ISSUE_NUMBER")-${SHA_HEX:0:16}-${SOURCE_TIMESTAMP}"
fi

# ============ Describe ============

DESCRIPTION="Issue #${ISSUE_NUMBER} — ${ISSUE_TITLE}"

echo "" >&2
echo "════════ Mint request ════════" >&2
echo "  Issue         : #${ISSUE_NUMBER} — ${ISSUE_TITLE}" >&2
echo "  Contributor   : ${CONTRIBUTOR_ADDR} ${CONTRIBUTOR_NOTE}" >&2
echo "  ContribType   : ${CONTRIB_TYPE_INT} (from labels: ${ISSUE_LABELS})" >&2
echo "  EvidenceHash  : ${EVIDENCE_HASH}" >&2
echo "  Description   : ${DESCRIPTION}" >&2
echo "  Value         : ${INITIAL_VALUE} (wei)" >&2
echo "  SourceTS      : ${SOURCE_TIMESTAMP} (${SOURCE_DATE})" >&2
echo "  CommitSHA     : ${COMMIT_SHA:-<none>}" >&2
echo "  Mode          : ${MODE}${DRY_RUN:+ (DRY-RUN)}" >&2
echo "══════════════════════════════" >&2
echo "" >&2

# ============ Execute ============

CLAIM_ID="pending"
TX_HASH=""

if [[ "$MODE" == "annotation" ]] || [[ "$DRY_RUN" -eq 1 ]]; then
    # Annotation-only or dry-run path — no on-chain call.
    CLAIM_ID="pending"
    TX_HASH="(no tx — ${MODE}${DRY_RUN:+ dry-run})"
else
    echo "→ Submitting claim via cast send..." >&2
    CAST_OUTPUT=$(cast send "$CONTRIBUTION_ATTESTOR_ADDRESS" \
        "submitClaim(address,uint8,bytes32,string,uint256)" \
        "$CONTRIBUTOR_ADDR" \
        "$CONTRIB_TYPE_INT" \
        "$EVIDENCE_HASH" \
        "$DESCRIPTION" \
        "$INITIAL_VALUE" \
        --rpc-url "$RPC_URL" \
        --private-key "$MINTER_PRIVATE_KEY" \
        --json 2>&1 || {
            echo "ERROR: cast send failed. Output:" >&2
            echo "$CAST_OUTPUT" >&2
            exit 5
        })

    TX_HASH=$(echo "$CAST_OUTPUT" | jq -r '.transactionHash // empty')
    if [[ -z "$TX_HASH" ]]; then
        echo "ERROR: no transactionHash in cast output:" >&2
        echo "$CAST_OUTPUT" >&2
        exit 5
    fi

    # Extract claimId from the ClaimSubmitted event.
    # event ClaimSubmitted(bytes32 indexed claimId, address indexed contributor,
    #                      address indexed claimant, ContributionType contribType, uint256 value);
    # submitClaim emits only this event, so logs[0].topics[1] is the claimId.
    SUBMIT_EVENT_SIG=$(cast keccak "ClaimSubmitted(bytes32,address,address,uint8,uint256)")
    CLAIM_ID=$(echo "$CAST_OUTPUT" | jq -r --arg sig "$SUBMIT_EVENT_SIG" '.logs[] | select(.topics[0] == $sig) | .topics[1]' | head -1 || true)
    if [[ -z "$CLAIM_ID" ]] || [[ "$CLAIM_ID" == "null" ]]; then
        CLAIM_ID=$(echo "$CAST_OUTPUT" | jq -r '.logs[0].topics[1] // "pending"')
    fi

    echo "✓ Mint successful." >&2
    echo "  tx      : ${TX_HASH}" >&2
    echo "  claimId : ${CLAIM_ID}" >&2
fi

# ============ Write closing-comment markdown ============

EXPLORER_LINK=""
if [[ -n "${EXPLORER_BASE:-}" ]] && [[ -n "$TX_HASH" ]] && [[ "$TX_HASH" != "(no tx"* ]]; then
    EXPLORER_LINK=" ([tx](${EXPLORER_BASE}${TX_HASH}))"
fi

SOLUTION_LINES=""
if [[ -n "$COMMIT_SHA" ]]; then
    SOLUTION_LINES="- Commit: \`${COMMIT_SHA:0:12}\`"
else
    SOLUTION_LINES="- (solution artifacts: fill in)"
fi

CLOSING_FILE=".traceability/closing-comment-${ISSUE_NUMBER}.md"
cat > "$CLOSING_FILE" <<EOF
Closing — ${ISSUE_TITLE#\[*\] } (auto-generated by scripts/mint-attestation.sh).

**Solution**:
${SOLUTION_LINES}

**DAG Attribution**: \`${CLAIM_ID}\`${EXPLORER_LINK}
**Source**: ${SOURCE_CHANNEL:-<unknown>} / ${SOURCE_CONTRIBUTOR:-<unknown>} / ${SOURCE_DATE}
**Lineage**: (fill in parent claimIds if any)

<sub>Traceability chain per DOCUMENTATION/CONTRIBUTION_TRACEABILITY.md.</sub>
EOF

echo "→ Closing-comment markdown written to ${CLOSING_FILE}" >&2

# ============ Append to mint-log.jsonl ============

jq -n \
    --arg issue "$ISSUE_NUMBER" \
    --arg title "$ISSUE_TITLE" \
    --arg contributor "$CONTRIBUTOR_ADDR" \
    --argjson contribType "$CONTRIB_TYPE_INT" \
    --arg evidenceHash "$EVIDENCE_HASH" \
    --arg value "$INITIAL_VALUE" \
    --arg sourceTimestamp "$SOURCE_TIMESTAMP" \
    --arg commitSha "${COMMIT_SHA:-}" \
    --arg claimId "$CLAIM_ID" \
    --arg txHash "$TX_HASH" \
    --arg mode "$MODE" \
    --arg mintedAt "$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
    '{issue:$issue, title:$title, contributor:$contributor, contribType:$contribType, evidenceHash:$evidenceHash, value:$value, sourceTimestamp:$sourceTimestamp, commitSha:$commitSha, claimId:$claimId, txHash:$txHash, mode:$mode, mintedAt:$mintedAt}' \
    >> .traceability/mint-log.jsonl

# ============ Emit the claimId to stdout for scripting ============

echo "$CLAIM_ID"
