"""
Generate test vectors for Foundry replay.

Produces JSON files in test/vectors/ that the Solidity replay test reads.
Each vector = one cooperative game with inputs and expected outputs.

Run: python -m oracle.backtest.generate_vectors
"""

import json
import os
from pathlib import Path

from .shapley_reference import ShapleyReference, Participant, PRECISION, BPS_PRECISION


def generate_all():
    """Generate all test vector files."""
    ref = ShapleyReference(use_quality_weights=True)
    vectors_dir = Path(__file__).parent.parent.parent / "test" / "vectors"
    vectors_dir.mkdir(parents=True, exist_ok=True)

    vectors = []

    # ============ Vector 1: Two Equal Participants ============
    vectors.append(("two_equal", 100 * PRECISION, [
        Participant("alice", 10 * PRECISION, 30 * 86400, 5000, 5000),
        Participant("bob",   10 * PRECISION, 30 * 86400, 5000, 5000),
    ]))

    # ============ Vector 2: Three Unequal ============
    vectors.append(("three_unequal", 1000 * PRECISION, [
        Participant("alice",   100 * PRECISION, 365 * 86400, 9000, 9000),
        Participant("bob",     1 * PRECISION,   1 * 86400,   1000, 1000),
        Participant("charlie", 50 * PRECISION,  90 * 86400,  5000, 5000),
    ]))

    # ============ Vector 3: Whale + Minnow (Lawson Floor) ============
    vectors.append(("lawson_floor", 100 * PRECISION, [
        Participant("whale",  10000 * PRECISION, 365 * 86400, 10000, 10000),
        Participant("minnow", 1 * PRECISION,     1 * 86400,   100,   100),
    ]))

    # ============ Vector 4: Five Participants (Dust Stress) ============
    vectors.append(("five_dust_stress", 999_999_999_999_999_997, [
        Participant("a", 7 * PRECISION,  30 * 86400,  3000, 7000),
        Participant("b", 3 * PRECISION,  14 * 86400,  7000, 3000),
        Participant("c", 1 * PRECISION,  1 * 86400,   1000, 1000),
        Participant("d", 15 * PRECISION, 180 * 86400, 8000, 8000),
        Participant("e", 5 * PRECISION,  7 * 86400,   5000, 5000),
    ]))

    # ============ Vector 5: Pioneer Bonus ============
    vectors.append(("pioneer_bonus", 100 * PRECISION, [
        Participant("pioneer", 10 * PRECISION, 30 * 86400, 5000, 5000, pioneer_score=10000),
        Participant("normal",  10 * PRECISION, 30 * 86400, 5000, 5000, pioneer_score=0),
    ]))

    # ============ Vector 6: Quality Weights ============
    vectors.append(("quality_weights", 100 * PRECISION, [
        Participant("high_q", 10 * PRECISION, 30 * 86400, 5000, 5000,
                   quality_activity=9000, quality_reputation=8000,
                   quality_economic=7000, quality_set=True),
        Participant("low_q", 10 * PRECISION, 30 * 86400, 5000, 5000,
                   quality_activity=2000, quality_reputation=2000,
                   quality_economic=2000, quality_set=True),
    ]))

    # ============ Vector 7: 20 Participants (Rounding Drift) ============
    vectors.append(("twenty_rounding_drift", 10_000 * PRECISION, [
        Participant(f"p{i}", (i + 1) * PRECISION, (i + 1) * 86400, (i * 500) % 10001, (i * 700) % 10001)
        for i in range(20)
    ]))

    # ============ Vector 8: Extreme Ratio ============
    vectors.append(("extreme_ratio", 1_000_000 * PRECISION, [
        Participant("whale",  1_000_000 * PRECISION, 365 * 86400, 10000, 10000),
        Participant("dust",   1,                      86400,       100,   100),
    ]))

    # ============ Vector 9: All Zero Scarcity/Stability ============
    vectors.append(("zero_scores", 100 * PRECISION, [
        Participant("a", 10 * PRECISION, 30 * 86400, 0, 0),
        Participant("b", 20 * PRECISION, 60 * 86400, 0, 0),
    ]))

    # ============ Vector 10: Null Player Mixed ============
    vectors.append(("null_player", 100 * PRECISION, [
        Participant("null", 0, 0, 0, 0),
        Participant("real1", 10 * PRECISION, 30 * 86400, 5000, 5000),
        Participant("real2", 5 * PRECISION,  7 * 86400,  3000, 8000),
    ]))

    # ============ Vector 11: Null Player at Last Position (Regression) ============
    vectors.append(("null_player_last", 100 * PRECISION, [
        Participant("real1", 10 * PRECISION, 30 * 86400, 5000, 5000),
        Participant("real2", 5 * PRECISION,  7 * 86400,  3000, 8000),
        Participant("null",  0,              0,          0,    0),  # Last = dust position
    ]))

    # Generate all vectors
    manifest = []
    for name, total_value, participants in vectors:
        output_path = str(vectors_dir / f"{name}.json")
        vec = ref.export_test_vectors(total_value, participants, output_path)
        manifest.append({
            "name": name,
            "file": f"{name}.json",
            "num_participants": len(participants),
            "total_value": str(total_value),
        })
        print(f"  Generated: {name} ({len(participants)} participants)")

    # Write manifest
    manifest_path = vectors_dir / "manifest.json"
    with open(manifest_path, "w") as f:
        json.dump(manifest, f, indent=2)

    print(f"\n{len(vectors)} vectors generated in {vectors_dir}")
    return vectors_dir


if __name__ == "__main__":
    generate_all()
