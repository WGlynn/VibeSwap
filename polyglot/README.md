# polyglot — VibeSwap's diversity signature

VibeSwap is built to be **neutral and agnostic**: omnichain by design, beholden to no single
stack. This directory makes that literal. Every file here is the same message —

> **A coordination primitive, not a casino.**

— written in a different programming language. It is a *diversity signature*: a standing reminder
that the protocol belongs to no one ecosystem, and a quiet bet that breadth is its own kind of
strength. Who knows what might happen.

## How it grows

This is **Wave 1**. The goal is "every language in existence," approached incrementally. Adding a
language is one row in [`generate.py`](./generate.py):

```python
("rust", "main.rs", 'fn main() { println!("{}", MSG); }'),
```

Run `python generate.py` to (re)emit every file from the table. The table is the source of truth;
the files are generated artifacts.

## Why it's not just decoration

- GitHub's Linguist counts every file, so the repo's language breakdown reflects the intent.
- Each file is a real, runnable program (where the language is executable), not a stub.
- The set is append-only and PR-friendly: contributors add their language, the signature widens.

*Coverage is intentionally incomplete and always will be — that's the point. The frontier is open.*
