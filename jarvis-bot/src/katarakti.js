// ============ KATARAKTI — Crypto Strategy Templates for Limni ============
//
// Katarakti is Freedom's crypto-only automated trading strategy, available in
// three versions with progressively simpler entry rules:
//   v1: Original (complex entry conditions)
//   v2 (Lite): Same strategy, simpler entry rules
//   v3: Simplest — minimal conditions
//
// These are TEMPLATE definitions. Freedom fills in the actual entry/exit rules
// via Limni. This module provides:
//   1. Strategy template scaffolding for all 3 versions
//   2. Default risk management parameters
//   3. Pre-built monitoring rules for trade verification
//   4. Helper functions for crypto-specific validation
//
// Will monitors Katarakti; Freedom monitors Universal.
// Both use the same Limni integration layer (limni.js).
// ============

import { registerStrategy } from './limni.js';

// ============ Shared Risk Parameters ============

const CRYPTO_DEFAULTS = {
  type: 'crypto',
  allowedOrderTypes: ['market', 'limit', 'stop_limit'],
  maxDrawdownPct: 15,            // Max 15% drawdown before alert
  maxOpenPositions: 3,           // Max concurrent positions
  maxDailyTrades: 20,            // Prevent overtrading
  trailingStopPct: null,         // Set per-strategy
};

// ============ Katarakti v1 — Original (Complex Entry Rules) ============

export const KATARAKTI_V1 = {
  id: 'katarakti-v1',
  name: 'Katarakti v1 — Original',
  version: 'v1',
  description: 'Full Katarakti strategy with complex multi-indicator entry conditions. Freedom\'s original design.',
  operator: 'will',
  ...CRYPTO_DEFAULTS,
  // Crypto pairs — Freedom configures actual list via Limni
  allowedPairs: null,            // null = any crypto pair (Limni manages the whitelist)
  maxPositionSize: null,         // Set based on capital allocated
  // Entry conditions: complex, multi-indicator
  // Freedom defines these in Limni — these are monitoring rules for verification
  entryConditions: [
    // Placeholder: Freedom's proprietary entry logic
    // Poseidon/Jarvis verifies trades match these conditions
    // Example structure (Freedom fills in actual values):
    // { field: 'change_pct', operator: '>', value: 2.0 },
    // { field: 'volume', operator: '>', value: 100000 },
  ],
  exitConditions: [
    // Default: stop loss and take profit (overridden by Limni config)
  ],
  stopLossPct: 5,               // 5% stop loss
  takeProfitPct: 10,            // 10% take profit
  trailingStopPct: 3,           // 3% trailing stop
};

// ============ Katarakti v2 (Lite) — Simpler Entry Rules ============

export const KATARAKTI_V2 = {
  id: 'katarakti-v2',
  name: 'Katarakti v2 — Lite',
  version: 'v2',
  description: 'Same core strategy as v1 but with simplified entry conditions. Fewer indicators, faster decisions.',
  operator: 'will',
  ...CRYPTO_DEFAULTS,
  allowedPairs: null,
  maxPositionSize: null,
  entryConditions: [
    // Simplified entry — fewer conditions than v1
    // Freedom's Limni configures the actual rules
  ],
  exitConditions: [],
  stopLossPct: 5,
  takeProfitPct: 8,
  trailingStopPct: 3,
};

// ============ Katarakti v3 — Simplest ============

export const KATARAKTI_V3 = {
  id: 'katarakti-v3',
  name: 'Katarakti v3 — Simple',
  version: 'v3',
  description: 'Minimal conditions, fastest execution. Designed for maximum autonomy with least tinkering.',
  operator: 'will',
  ...CRYPTO_DEFAULTS,
  allowedPairs: null,
  maxPositionSize: null,
  maxDailyTrades: 30,           // More lenient for simpler strategy
  entryConditions: [
    // Minimal — Freedom configures via Limni
  ],
  exitConditions: [],
  stopLossPct: 4,
  takeProfitPct: 6,
  trailingStopPct: 2,
};

// ============ Registration ============

/**
 * Register all Katarakti strategy templates.
 * Call this during Limni init. Freedom fills in actual entry/exit
 * conditions via the Limni terminal API.
 */
export function registerKataraktiStrategies() {
  registerStrategy(KATARAKTI_V1.id, KATARAKTI_V1);
  registerStrategy(KATARAKTI_V2.id, KATARAKTI_V2);
  registerStrategy(KATARAKTI_V3.id, KATARAKTI_V3);
  console.log('[katarakti] Registered v1, v2 (Lite), v3 (Simple) strategy templates');
}

// ============ Crypto-Specific Validation Helpers ============

/**
 * Validate a crypto trade against Katarakti rules.
 * Extends the base Limni trade verification with crypto-specific checks.
 */
export function validateCryptoTrade(trade) {
  const issues = [];

  // Basic sanity checks
  if (!trade.pair || typeof trade.pair !== 'string') {
    issues.push('Missing or invalid trading pair');
  }

  if (trade.size <= 0) {
    issues.push('Invalid position size (must be > 0)');
  }

  if (!trade.timestamp) {
    issues.push('Missing timestamp');
  }

  // Slippage check (if entry price and expected price are provided)
  if (trade.expectedPrice && trade.executedPrice) {
    const slippage = Math.abs(trade.executedPrice - trade.expectedPrice) / trade.expectedPrice * 100;
    if (slippage > 2.0) {
      issues.push(`High slippage: ${slippage.toFixed(2)}% (expected ${trade.expectedPrice}, got ${trade.executedPrice})`);
    }
  }

  // Check for suspicious patterns
  if (trade.side === 'buy' && trade.orderType === 'market') {
    // Market buys on thin books can get front-run — flag if large
    if (trade.size > 10000) { // Threshold configurable
      issues.push('Large market buy — check for front-running / slippage');
    }
  }

  return {
    valid: issues.length === 0,
    issues,
    trade,
  };
}

/**
 * Calculate position sizing based on Kelly criterion (simplified).
 * @param {number} capital - Available capital
 * @param {number} winRate - Historical win rate (0-1)
 * @param {number} avgWin - Average win amount
 * @param {number} avgLoss - Average loss amount
 * @param {number} fraction - Kelly fraction (0.5 = half-Kelly, safer)
 */
export function kellyPositionSize(capital, winRate, avgWin, avgLoss, fraction = 0.25) {
  if (avgLoss === 0) return 0;
  const b = avgWin / Math.abs(avgLoss);  // Win/loss ratio
  const kelly = (b * winRate - (1 - winRate)) / b;
  const size = Math.max(0, capital * kelly * fraction);
  return Math.round(size * 100) / 100;
}

/**
 * Generate a performance summary suitable for Telegram/Discord alerts.
 */
export function formatPerformanceSummary(backtestResult) {
  if (!backtestResult?.performance) return 'No backtest data available.';

  const p = backtestResult.performance;
  const lines = [
    `Strategy: ${backtestResult.strategyName || backtestResult.strategyId}`,
    `Period: ${new Date(backtestResult.period?.start).toLocaleDateString()} — ${new Date(backtestResult.period?.end).toLocaleDateString()}`,
    '',
    `Return: ${p.totalReturnPct >= 0 ? '+' : ''}${p.totalReturnPct}%`,
    `Win Rate: ${p.winRate}% (${p.winningTrades}W / ${p.losingTrades}L)`,
    `Max Drawdown: ${p.maxDrawdownPct}%`,
    `Profit Factor: ${p.profitFactor === Infinity ? 'INF' : p.profitFactor}`,
    `Sharpe: ${p.sharpeRatio}`,
    `Trades: ${p.totalTrades} | Fees: $${p.totalFees}`,
    `Capital: $${p.initialCapital} → $${p.finalCapital}`,
  ];

  return lines.join('\n');
}
