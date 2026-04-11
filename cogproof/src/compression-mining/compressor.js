/**
 * Symbolic Compression Engine
 *
 * Compresses knowledge corpora into dense symbolic representations.
 * The compression ratio serves as proof-of-work difficulty.
 *
 * Coglex operates at token-level (4096 tokens → 12-bit IDs).
 * This operates at semantic-level (knowledge → glyphs).
 * They're complementary layers.
 */

const crypto = require('crypto');

// Glyph vocabulary — semantic primitives that compress meaning
const GLYPH_MAP = {
  // Structural glyphs
  '→': 'leads_to',
  '←': 'derived_from',
  '↔': 'bidirectional',
  '∧': 'and',
  '∨': 'or',
  '¬': 'not',
  '∀': 'for_all',
  '∃': 'exists',
  '∅': 'empty',
  '∞': 'unbounded',
  '≈': 'approximately',
  '≡': 'equivalent',
  '⊂': 'subset_of',
  '⊃': 'superset_of',
  '∈': 'member_of',
  '∉': 'not_member_of',

  // Domain glyphs (crypto/DeFi)
  'Σ': 'sum_aggregate',
  'Δ': 'change_delta',
  'λ': 'floor_constant',
  'φ': 'marginal_contribution',
  'π': 'protocol',
  'μ': 'mean_average',
  'σ': 'standard_deviation',
  'ε': 'epsilon_tolerance',
  'τ': 'time_period',
  'ω': 'weight',
};

class SymbolicCompressor {
  constructor() {
    this.dictionary = new Map();
    this.reverseDict = new Map();
    this.nextId = 0;
  }

  /**
   * Compress a knowledge corpus into symbolic form.
   * Returns { compressed, hash, ratio, density }
   */
  compress(corpus) {
    if (!corpus || corpus.length === 0) {
      throw new Error('Empty corpus');
    }

    const originalBytes = Buffer.byteLength(corpus, 'utf8');

    // Phase 1: Semantic extraction — identify repeated patterns
    const patterns = this._extractPatterns(corpus);

    // Phase 2: Glyph assignment — map patterns to symbols
    const glyphAssignments = this._assignGlyphs(patterns);

    // Phase 3: Compress — replace patterns with glyphs
    let compressed = corpus;
    for (const [pattern, glyph] of glyphAssignments) {
      compressed = compressed.replaceAll(pattern, glyph);
    }

    // Phase 4: Dictionary encoding — further compress repeated tokens
    const tokens = compressed.split(/\s+/);
    const freqMap = new Map();
    for (const token of tokens) {
      freqMap.set(token, (freqMap.get(token) || 0) + 1);
    }

    // Only dictionary-encode tokens that appear 3+ times
    const dictTokens = [...freqMap.entries()]
      .filter(([_, count]) => count >= 3)
      .sort((a, b) => b[1] - a[1]);

    for (const [token] of dictTokens) {
      const id = this._getDictId(token);
      compressed = compressed.replaceAll(token, `§${id}`);
    }

    const compressedBytes = Buffer.byteLength(compressed, 'utf8');
    const ratio = 1 - (compressedBytes / originalBytes);
    const density = ratio > 0 ? Math.min(ratio / 0.99, 1.0) : 0;

    // Hash for verification
    const originalHash = crypto.createHash('sha256').update(corpus).digest('hex');

    return {
      compressed,
      dictionary: Object.fromEntries(this.dictionary),
      glyphAssignments: Object.fromEntries(glyphAssignments),
      originalHash,
      originalBytes,
      compressedBytes,
      ratio: Math.round(ratio * 10000) / 10000,
      density: Math.round(density * 10000) / 10000,
    };
  }

  /**
   * Decompress back to original form for verification.
   */
  decompress(compressed, dictionary, glyphAssignments) {
    let decompressed = compressed;

    // Reverse dictionary encoding
    const reverseDict = new Map();
    for (const [token, id] of Object.entries(dictionary)) {
      reverseDict.set(`§${id}`, token);
    }
    for (const [dictRef, original] of reverseDict) {
      decompressed = decompressed.replaceAll(dictRef, original);
    }

    // Reverse glyph assignments
    for (const [pattern, glyph] of Object.entries(glyphAssignments)) {
      decompressed = decompressed.replaceAll(glyph, pattern);
    }

    return decompressed;
  }

  /**
   * Verify compression is lossless.
   * Returns true if decompressed output matches original hash.
   */
  verify(decompressed, originalHash) {
    const hash = crypto.createHash('sha256').update(decompressed).digest('hex');
    return hash === originalHash;
  }

  _extractPatterns(text) {
    const patterns = new Map();
    const words = text.split(/\s+/);

    // Extract 2-gram and 3-gram patterns
    for (let n = 2; n <= 3; n++) {
      for (let i = 0; i <= words.length - n; i++) {
        const pattern = words.slice(i, i + n).join(' ');
        patterns.set(pattern, (patterns.get(pattern) || 0) + 1);
      }
    }

    // Only keep patterns that appear 2+ times and save space
    return new Map(
      [...patterns.entries()]
        .filter(([pattern, count]) => count >= 2 && pattern.length > 4)
        .sort((a, b) => (b[1] * b[0].length) - (a[1] * a[0].length))
    );
  }

  _assignGlyphs(patterns) {
    const assignments = new Map();
    const availableGlyphs = Object.keys(GLYPH_MAP);
    let glyphIdx = 0;

    for (const [pattern] of patterns) {
      if (glyphIdx >= availableGlyphs.length) break;

      // Only assign if the glyph is shorter than the pattern
      const glyph = availableGlyphs[glyphIdx];
      if (glyph.length < pattern.length) {
        assignments.set(pattern, glyph);
        glyphIdx++;
      }
    }

    return assignments;
  }

  _getDictId(token) {
    if (!this.dictionary.has(token)) {
      this.dictionary.set(token, this.nextId++);
    }
    return this.dictionary.get(token);
  }
}

module.exports = { SymbolicCompressor, GLYPH_MAP };
