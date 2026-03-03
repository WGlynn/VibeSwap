// ============ Data Economy — Ocean Protocol Inspired ============
//
// Knowledge as data assets with economic access control.
//
// Every piece of knowledge has an economic identity:
//   - A cost to store (token occupation)
//   - A value from access (utility signal)
//   - A price for computation (access pricing)
//
// This extends the CKB token budget model with Ocean Protocol's
// compute-to-data primitives.
//
// This does NOT gate access (JARVIS always uses its own knowledge).
// It creates an economic audit trail and scoring system that:
//   1. Values user data contributions (corrections improve JARVIS for everyone)
//   2. Tracks knowledge flow (which facts get promoted, which decay)
//   3. Creates a foundation for future data tokenization
//
// Access Pricing Model:
//   base_price = token cost of fact
//   demand_multiplier = access count / time window
//   scarcity_multiplier = budget utilization (high = higher price to displace)
//   privacy_premium = knowledge class bonus (private costs more)
// ============

import { appendFile } from 'fs/promises';
import { join } from 'path';
import { config } from './config.js';

const AUDIT_LOG = join(config.dataDir, 'knowledge', 'access-audit.jsonl');

// ============ Constants ============

const PRICING = {
  // Demand window: access count over this period affects price
  DEMAND_WINDOW_MS: 24 * 60 * 60 * 1000, // 24 hours

  // Privacy premiums by knowledge class
  PRIVACY_PREMIUM: {
    private: 5.0,
    shared: 1.0,
    mutual: 1.2,
    common: 1.5,
    network: 0.5,  // Network knowledge is cheap — shared across all
    public: 0.0,
  },

  // Scarcity curve: maps utilization (0-1) to price multiplier
  // At 90% utilization, price is 3x. At 99%, price is 10x.
  SCARCITY_BASE: 1.0,
  SCARCITY_EXPONENT: 3.0,
};

// ============ Access Pricing ============

export function computeAccessPrice(fact, budgetUtilization) {
  // Base price = token cost
  const basePrice = fact.tokenCost || 12;

  // Demand multiplier — how often was this fact accessed recently?
  const now = Date.now();
  const lastAccessed = new Date(fact.lastAccessed || fact.created).getTime();
  const recency = Math.max(0, 1 - (now - lastAccessed) / PRICING.DEMAND_WINDOW_MS);
  const demandMultiplier = 1 + (fact.accessCount || 0) * 0.1 * recency;

  // Scarcity multiplier — how full is the CKB?
  const utilization = Math.min(budgetUtilization || 0, 0.99);
  const scarcityMultiplier = PRICING.SCARCITY_BASE + Math.pow(utilization, PRICING.SCARCITY_EXPONENT) * 9;

  // Privacy premium
  const privacyPremium = PRICING.PRIVACY_PREMIUM[fact.knowledgeClass] || 1.0;

  const totalPrice = basePrice * demandMultiplier * scarcityMultiplier * privacyPremium;

  return {
    basePrice,
    demandMultiplier: Math.round(demandMultiplier * 100) / 100,
    scarcityMultiplier: Math.round(scarcityMultiplier * 100) / 100,
    privacyPremium,
    totalPrice: Math.round(totalPrice * 100) / 100,
  };
}

// ============ Knowledge Asset Metadata ============

export function getKnowledgeAsset(fact, budgetUtilization) {
  const price = computeAccessPrice(fact, budgetUtilization);
  const now = Date.now();
  const age = now - new Date(fact.created).getTime();
  const ageHours = Math.round(age / 3600000);

  return {
    id: fact.id,
    category: fact.category,
    knowledgeClass: fact.knowledgeClass,
    tokenCost: fact.tokenCost,
    accessCount: fact.accessCount || 0,
    confirmed: fact.confirmed || 1,
    ageHours,
    pricing: price,
    // Value metrics
    totalUtilityGenerated: (fact.accessCount || 0) * (fact.confirmed || 1),
    costEfficiency: ((fact.accessCount || 0) * (fact.confirmed || 1)) / (fact.tokenCost || 1),
  };
}

// ============ Access Audit Trail ============

export async function logAccess(userId, factId, purpose, pricing) {
  const entry = {
    timestamp: new Date().toISOString(),
    userId: String(userId),
    factId,
    purpose,
    pricing: pricing?.totalPrice || 0,
  };

  try {
    await appendFile(AUDIT_LOG, JSON.stringify(entry) + '\n');
  } catch {
    // First write or audit log dir doesn't exist yet — non-fatal
  }
}

// ============ Data Economy Stats ============

export function getDataEconomyStats(facts, budget) {
  const now = Date.now();
  const totalTokens = facts.reduce((sum, f) => sum + (f.tokenCost || 0), 0);
  const utilization = totalTokens / (budget || 1);

  // Aggregate access stats
  let totalAccesses = 0;
  let totalConfirmations = 0;
  let mostAccessed = null;
  let mostValuable = null;
  let highestPrice = 0;

  for (const fact of facts) {
    totalAccesses += fact.accessCount || 0;
    totalConfirmations += fact.confirmed || 1;

    if (!mostAccessed || (fact.accessCount || 0) > (mostAccessed.accessCount || 0)) {
      mostAccessed = fact;
    }

    const price = computeAccessPrice(fact, utilization);
    if (price.totalPrice > highestPrice) {
      highestPrice = price.totalPrice;
      mostValuable = fact;
    }
  }

  return {
    totalFacts: facts.length,
    totalTokens,
    budget,
    utilization: Math.round(utilization * 100),
    totalAccesses,
    totalConfirmations,
    avgAccessesPerFact: facts.length > 0 ? Math.round(totalAccesses / facts.length * 10) / 10 : 0,
    mostAccessed: mostAccessed ? { id: mostAccessed.id, content: mostAccessed.content?.slice(0, 50), accesses: mostAccessed.accessCount } : null,
    mostValuable: mostValuable ? { id: mostValuable.id, content: mostValuable.content?.slice(0, 50), price: highestPrice } : null,
    // Knowledge class distribution
    classCounts: facts.reduce((acc, f) => {
      const cls = f.knowledgeClass || 'shared';
      acc[cls] = (acc[cls] || 0) + 1;
      return acc;
    }, {}),
  };
}

// ============ Knowledge Marketplace View ============

export function getKnowledgeMarketplace(facts, budget) {
  const totalTokens = facts.reduce((sum, f) => sum + (f.tokenCost || 0), 0);
  const utilization = totalTokens / (budget || 1);

  const assets = facts.map(f => getKnowledgeAsset(f, utilization));

  // Sort by cost efficiency (most valuable first)
  assets.sort((a, b) => b.costEfficiency - a.costEfficiency);

  return {
    totalAssets: assets.length,
    utilization: Math.round(utilization * 100),
    assets: assets.slice(0, 20), // Top 20
    // Aggregate pricing
    totalMarketValue: Math.round(assets.reduce((sum, a) => sum + a.pricing.totalPrice, 0) * 100) / 100,
    avgPrice: assets.length > 0 ? Math.round(assets.reduce((sum, a) => sum + a.pricing.totalPrice, 0) / assets.length * 100) / 100 : 0,
  };
}

// ============ Contribution Valuation ============
// Values user data contributions (corrections, facts).
// Used for future Shapley-based reward distribution.

export function valueContribution(fact, isCorrection) {
  // Corrections are worth more — they improve JARVIS for everyone
  const correctionBonus = isCorrection ? 2.0 : 1.0;

  // Generalizable knowledge is worth more
  const generalizableBonus = fact.knowledgeClass === 'network' ? 3.0 : 1.0;

  // Confirmed knowledge is worth more
  const confirmationBonus = Math.log2(1 + (fact.confirmed || 1));

  // Access count indicates demand
  const demandBonus = Math.log2(1 + (fact.accessCount || 0));

  return Math.round(
    (fact.tokenCost || 12) * correctionBonus * generalizableBonus * confirmationBonus * demandBonus * 100
  ) / 100;
}
