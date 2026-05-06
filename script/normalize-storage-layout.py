#!/usr/bin/env python3
"""
normalize-storage-layout.py
Read forge inspect storageLayout --json from stdin.
Output stable JSON (stripped of unstable astId and numeric AST type suffixes).
Used by check-storage-layout.sh.
"""
import json
import sys
import re


def normalize_type(t: str) -> str:
    # t_struct(Foo)12345_storage  -> t_struct(Foo)_storage
    # t_contract(IFoo)99           -> t_contract(IFoo)
    return re.sub(r"\)(\d+)(_|$)", r")\2", t)


def main() -> None:
    raw = sys.stdin.read().strip()
    if not raw:
        # Contract has no storage (valid — e.g. pure-logic contracts)
        print(json.dumps({"storage": []}, indent=2))
        return

    try:
        data = json.loads(raw)
    except json.JSONDecodeError as e:
        print(f"ERROR: could not parse forge inspect output: {e}", file=sys.stderr)
        sys.exit(1)

    normalized = []
    for s in data.get("storage", []):
        normalized.append(
            {
                "label": s["label"],
                "slot": s["slot"],
                "offset": s["offset"],
                "type": normalize_type(s["type"]),
            }
        )

    print(json.dumps({"storage": normalized}, indent=2))


if __name__ == "__main__":
    main()
