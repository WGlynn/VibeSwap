// ============ Keeper Module — Off-chain Monitoring & Triggering ============
// The keeper is the heartbeat of the lending protocol. It monitors vault health,
// triggers insurance claims, accrues premiums, and executes graduated de-risking.
//
// In production, a keeper runs as a daemon that:
// 1. Polls the CKB indexer for vault cells
// 2. Calculates health factors using oracle prices
// 3. Triggers appropriate actions based on risk tier
// 4. Submits signed transactions to the network
//
// This module provides the decision logic — the "brain" of the keeper.
// The actual chain interaction (indexer queries, tx submission) is pluggable.

use crate::*;
use vibeswap_types::*;
use ckb_lending_math::{
    PRECISION,
    collateral,
    pool,
    prevention::{self, RiskTier},
    insurance,
};

// ============ Keeper Action Types ============

/// Actions the keeper can recommend for a vault.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum KeeperAction {
    /// Vault is safe, no action needed
    Safe {
        health_factor: u128,
    },
    /// Vault is in warning zone — emit on-chain notification
    Warn {
        health_factor: u128,
        vault_owner: [u8; 32],
    },
    /// Vault needs auto-deleveraging — convert deposit shares to repay debt
    AutoDeleverage {
        health_factor: u128,
        shares_to_redeem: u128,
        debt_to_repay: u128,
    },
    /// Vault needs insurance claim — request payout from insurance pool
    InsuranceClaim {
        health_factor: u128,
        claim_amount: u128,
        estimated_new_hf: u128,
    },
    /// Vault needs soft liquidation — incremental collateral release
    SoftLiquidate {
        health_factor: u128,
        debt_to_repay: u128,
        collateral_to_release: u128,
    },
    /// Vault is underwater — hard liquidation (last resort)
    HardLiquidate {
        health_factor: u128,
        max_repay: u128,
        max_seized: u128,
    },
}

// ============ Vault Assessment ============

/// Full assessment of a vault's current state.
#[derive(Debug, Clone)]
pub struct VaultAssessment {
    /// Current health factor
    pub health_factor: u128,
    /// Risk classification
    pub risk_tier: RiskTier,
    /// Current debt (with interest accrual)
    pub current_debt: u128,
    /// Recommended action
    pub action: KeeperAction,
    /// Collateral value in debt-denomination
    pub collateral_value: u128,
    /// Debt value in debt-denomination
    pub debt_value: u128,
}

/// Assess a vault and determine the appropriate keeper action.
///
/// This is the core decision function. Given current prices and pool state,
/// it calculates the vault's health and recommends the optimal mutualist action.
pub fn assess_vault(
    vault: &VaultCellData,
    lending_pool: &LendingPoolCellData,
    insurance_pool: Option<&InsurancePoolCellData>,
    collateral_price: u128,
    debt_price: u128,
) -> VaultAssessment {
    // Calculate current debt with interest accrual
    let current_debt = pool::current_debt(
        vault.debt_shares,
        vault.borrow_index_snapshot,
        lending_pool.borrow_index,
    );

    // If no debt, vault is perfectly safe
    if current_debt == 0 {
        return VaultAssessment {
            health_factor: u128::MAX,
            risk_tier: RiskTier::Safe,
            current_debt: 0,
            action: KeeperAction::Safe { health_factor: u128::MAX },
            collateral_value: collateral::collateral_value(
                vault.collateral_amount, collateral_price,
            ),
            debt_value: 0,
        };
    }

    let col_value = collateral::collateral_value(vault.collateral_amount, collateral_price);
    let debt_value = collateral::collateral_value(current_debt, debt_price);

    let hf = match collateral::health_factor(
        vault.collateral_amount, collateral_price,
        current_debt, debt_price,
        lending_pool.liquidation_threshold,
    ) {
        Ok(h) => h,
        Err(_) => 0,
    };

    let tier = prevention::classify_risk(hf);

    let action = match tier {
        RiskTier::Safe => {
            KeeperAction::Safe { health_factor: hf }
        }
        RiskTier::Warning => {
            KeeperAction::Warn {
                health_factor: hf,
                vault_owner: vault.owner_lock_hash,
            }
        }
        RiskTier::AutoDeleverage => {
            // Try auto-deleverage first (use deposit shares)
            let (shares, repay) = prevention::auto_deleverage_amount(
                vault.collateral_amount, collateral_price,
                current_debt, debt_price,
                lending_pool.liquidation_threshold,
                vault.deposit_shares,
                lending_pool.total_shares,
                lending_pool.total_deposits,
            );

            if shares > 0 && repay > 0 {
                KeeperAction::AutoDeleverage {
                    health_factor: hf,
                    shares_to_redeem: shares,
                    debt_to_repay: repay,
                }
            } else if let Some(ins) = insurance_pool {
                // Fall back to insurance claim
                let (claim, new_hf) = insurance::calculate_claim(
                    vault.collateral_amount, collateral_price,
                    current_debt, debt_price,
                    lending_pool.liquidation_threshold,
                    prevention::HF_AUTO_DELEVERAGE,
                    ins.total_deposits,
                    ins.max_coverage_bps,
                );
                if claim > 0 {
                    KeeperAction::InsuranceClaim {
                        health_factor: hf,
                        claim_amount: claim,
                        estimated_new_hf: new_hf,
                    }
                } else {
                    KeeperAction::Warn {
                        health_factor: hf,
                        vault_owner: vault.owner_lock_hash,
                    }
                }
            } else {
                KeeperAction::Warn {
                    health_factor: hf,
                    vault_owner: vault.owner_lock_hash,
                }
            }
        }
        RiskTier::SoftLiquidation => {
            // Try insurance first (prevention > punishment)
            if let Some(ins) = insurance_pool {
                let (claim, new_hf) = insurance::calculate_claim(
                    vault.collateral_amount, collateral_price,
                    current_debt, debt_price,
                    lending_pool.liquidation_threshold,
                    prevention::HF_SOFT_LIQUIDATION,
                    ins.total_deposits,
                    ins.max_coverage_bps,
                );
                if claim > 0 && new_hf >= prevention::HF_SOFT_LIQUIDATION {
                    return VaultAssessment {
                        health_factor: hf,
                        risk_tier: tier,
                        current_debt,
                        action: KeeperAction::InsuranceClaim {
                            health_factor: hf,
                            claim_amount: claim,
                            estimated_new_hf: new_hf,
                        },
                        collateral_value: col_value,
                        debt_value,
                    };
                }
            }

            // Fall back to soft liquidation
            let (repay, release) = prevention::soft_liquidation_step(
                vault.collateral_amount, collateral_price,
                current_debt, debt_price,
                lending_pool.liquidation_threshold,
                lending_pool.liquidation_incentive,
                50_000_000_000_000_000, // 5% step factor
            );

            KeeperAction::SoftLiquidate {
                health_factor: hf,
                debt_to_repay: repay,
                collateral_to_release: release,
            }
        }
        RiskTier::HardLiquidation => {
            // Last resort — hard liquidation
            let params = collateral::CollateralParams {
                collateral_factor: lending_pool.collateral_factor,
                liquidation_threshold: lending_pool.liquidation_threshold,
                liquidation_incentive: lending_pool.liquidation_incentive,
                close_factor: 500_000_000_000_000_000, // 50%
            };

            let (max_repay, max_seized) = match collateral::liquidation_amounts(
                vault.collateral_amount, collateral_price,
                current_debt, debt_price,
                &params,
            ) {
                Ok((r, s)) => (r, s),
                Err(_) => (0, 0),
            };

            KeeperAction::HardLiquidate {
                health_factor: hf,
                max_repay,
                max_seized,
            }
        }
    };

    VaultAssessment {
        health_factor: hf,
        risk_tier: tier,
        current_debt,
        action,
        collateral_value: col_value,
        debt_value,
    }
}

/// Batch assess multiple vaults and sort by urgency (most distressed first).
pub fn assess_vaults(
    vaults: &[(VaultCellData, CellInput)],
    lending_pool: &LendingPoolCellData,
    insurance_pool: Option<&InsurancePoolCellData>,
    collateral_price: u128,
    debt_price: u128,
) -> Vec<(VaultAssessment, usize)> {
    let mut assessments: Vec<(VaultAssessment, usize)> = vaults
        .iter()
        .enumerate()
        .map(|(i, (vault, _))| {
            let assessment = assess_vault(
                vault, lending_pool, insurance_pool,
                collateral_price, debt_price,
            );
            (assessment, i)
        })
        .collect();

    // Sort by health factor ascending (most distressed first)
    assessments.sort_by(|a, b| a.0.health_factor.cmp(&b.0.health_factor));

    assessments
}

/// Check if an insurance pool needs premium accrual.
///
/// Returns the premium amount if accrual is due, 0 otherwise.
pub fn check_premium_accrual(
    insurance_pool: &InsurancePoolCellData,
    lending_pool: &LendingPoolCellData,
    current_block: u64,
    min_blocks_between_accruals: u64,
) -> u128 {
    if current_block <= insurance_pool.last_premium_block + min_blocks_between_accruals {
        return 0;
    }

    let blocks_elapsed = current_block - insurance_pool.last_premium_block;
    insurance::calculate_premium(
        lending_pool.total_borrows,
        insurance_pool.premium_rate_bps,
        blocks_elapsed,
    )
}

/// Stress test an entire set of vaults against a price drop scenario.
///
/// Returns list of vaults that would become liquidatable under the stressed price.
pub fn stress_test_vaults(
    vaults: &[(VaultCellData, CellInput)],
    lending_pool: &LendingPoolCellData,
    collateral_price: u128,
    debt_price: u128,
    price_drop_bps: u128,
) -> Vec<(usize, u128)> {
    let stressed_price = ckb_lending_math::mul_div(
        collateral_price,
        ckb_lending_math::BPS_DENOMINATOR - price_drop_bps,
        ckb_lending_math::BPS_DENOMINATOR,
    );

    let mut at_risk = Vec::new();
    for (i, (vault, _)) in vaults.iter().enumerate() {
        let current_debt = pool::current_debt(
            vault.debt_shares,
            vault.borrow_index_snapshot,
            lending_pool.borrow_index,
        );
        if current_debt == 0 { continue; }

        let stressed_hf = prevention::stress_test(
            vault.collateral_amount, collateral_price,
            current_debt, debt_price,
            lending_pool.liquidation_threshold,
            price_drop_bps,
        );

        if stressed_hf < PRECISION {
            at_risk.push((i, stressed_hf));
        }
    }

    // Sort by stressed HF ascending (most at-risk first)
    at_risk.sort_by(|a, b| a.1.cmp(&b.1));
    at_risk
}

// ============ Tests ============

#[cfg(test)]
mod tests {
    use super::*;

    fn test_vault(debt: u128, collateral: u128) -> VaultCellData {
        VaultCellData {
            owner_lock_hash: [0x11; 32],
            pool_id: [0x22; 32],
            collateral_amount: collateral,
            collateral_type_hash: [0x33; 32],
            debt_shares: debt,
            borrow_index_snapshot: PRECISION,
            deposit_shares: 0,
            last_update_block: 100,
        }
    }

    fn test_vault_with_deposits(debt: u128, collateral: u128, deposits: u128) -> VaultCellData {
        VaultCellData {
            deposit_shares: deposits,
            ..test_vault(debt, collateral)
        }
    }

    fn test_lending_pool() -> LendingPoolCellData {
        LendingPoolCellData {
            total_deposits: 1_000_000 * PRECISION,
            total_borrows: 500_000 * PRECISION,
            total_shares: 1_000_000 * PRECISION,
            total_reserves: 0,
            borrow_index: PRECISION,
            last_accrual_block: 100,
            asset_type_hash: [0xBB; 32],
            pool_id: [0x22; 32],
            base_rate: DEFAULT_BASE_RATE,
            slope1: DEFAULT_SLOPE1,
            slope2: DEFAULT_SLOPE2,
            optimal_utilization: DEFAULT_OPTIMAL_UTILIZATION,
            reserve_factor: DEFAULT_RESERVE_FACTOR,
            collateral_factor: DEFAULT_COLLATERAL_FACTOR,
            liquidation_threshold: DEFAULT_LIQUIDATION_THRESHOLD,
            liquidation_incentive: DEFAULT_LIQUIDATION_INCENTIVE,
        }
    }

    fn test_insurance_pool() -> InsurancePoolCellData {
        InsurancePoolCellData {
            pool_id: [0xAA; 32],
            asset_type_hash: [0xBB; 32],
            total_deposits: 100_000 * PRECISION,
            total_shares: 100_000 * PRECISION,
            total_premiums_earned: 0,
            total_claims_paid: 0,
            premium_rate_bps: DEFAULT_PREMIUM_RATE_BPS,
            max_coverage_bps: DEFAULT_MAX_COVERAGE_BPS,
            cooldown_blocks: DEFAULT_COOLDOWN_BLOCKS,
            last_premium_block: 100,
        }
    }

    fn test_cell_input(id: u8) -> CellInput {
        CellInput { tx_hash: [id; 32], index: 0, since: 0 }
    }

    // ============ Assessment Tests ============

    #[test]
    fn test_assess_safe_vault() {
        let vault = test_vault(5_000 * PRECISION, 10 * PRECISION);
        let pool = test_lending_pool();

        let result = assess_vault(
            &vault, &pool, None,
            2000 * PRECISION, // ETH at $2000
            PRECISION,        // USDC at $1
        );

        assert_eq!(result.risk_tier, RiskTier::Safe);
        assert!(matches!(result.action, KeeperAction::Safe { .. }));
        assert!(result.health_factor > prevention::HF_WARNING);
    }

    #[test]
    fn test_assess_warning_vault() {
        // 10 ETH at $1200, 7000 USDC debt, 80% LT
        // HF = (10*1200*0.8)/7000 = 9600/7000 ≈ 1.37
        let vault = test_vault(7_000 * PRECISION, 10 * PRECISION);
        let pool = test_lending_pool();

        let result = assess_vault(
            &vault, &pool, None,
            1200 * PRECISION,
            PRECISION,
        );

        assert_eq!(result.risk_tier, RiskTier::Warning);
        assert!(matches!(result.action, KeeperAction::Warn { .. }));
    }

    #[test]
    fn test_assess_auto_deleverage_with_deposits() {
        // Vault with deposit shares that can be used for auto-deleverage
        let vault = test_vault_with_deposits(
            8_000 * PRECISION, 10 * PRECISION, 5_000 * PRECISION,
        );
        let pool = test_lending_pool();

        // 10 ETH at $1200, 80% LT → HF = (10*1200*0.8)/8000 = 1.2
        let result = assess_vault(
            &vault, &pool, None,
            1200 * PRECISION,
            PRECISION,
        );

        assert_eq!(result.risk_tier, RiskTier::AutoDeleverage);
        assert!(matches!(result.action, KeeperAction::AutoDeleverage { .. }));

        if let KeeperAction::AutoDeleverage { shares_to_redeem, debt_to_repay, .. } = result.action {
            assert!(shares_to_redeem > 0);
            assert!(debt_to_repay > 0);
        }
    }

    #[test]
    fn test_assess_auto_deleverage_no_deposits_falls_to_insurance() {
        let vault = test_vault(8_000 * PRECISION, 10 * PRECISION); // no deposit shares
        let pool = test_lending_pool();
        let ins = test_insurance_pool();

        let result = assess_vault(
            &vault, &pool, Some(&ins),
            1200 * PRECISION,
            PRECISION,
        );

        assert_eq!(result.risk_tier, RiskTier::AutoDeleverage);
        assert!(matches!(result.action, KeeperAction::InsuranceClaim { .. }));
    }

    #[test]
    fn test_assess_soft_liquidation_with_insurance() {
        let vault = test_vault(8_000 * PRECISION, 10 * PRECISION);
        let pool = test_lending_pool();
        let ins = test_insurance_pool();

        // 10 ETH at $1050, 80% LT → HF = (10*1050*0.8)/8000 = 1.05
        let result = assess_vault(
            &vault, &pool, Some(&ins),
            1050 * PRECISION,
            PRECISION,
        );

        assert_eq!(result.risk_tier, RiskTier::SoftLiquidation);
        // Should prefer insurance over soft liquidation
        assert!(matches!(result.action, KeeperAction::InsuranceClaim { .. }));
    }

    #[test]
    fn test_assess_soft_liquidation_no_insurance() {
        let vault = test_vault(8_000 * PRECISION, 10 * PRECISION);
        let pool = test_lending_pool();

        let result = assess_vault(
            &vault, &pool, None,
            1050 * PRECISION,
            PRECISION,
        );

        assert_eq!(result.risk_tier, RiskTier::SoftLiquidation);
        assert!(matches!(result.action, KeeperAction::SoftLiquidate { .. }));

        if let KeeperAction::SoftLiquidate { debt_to_repay, collateral_to_release, .. } = result.action {
            assert!(debt_to_repay > 0);
            assert!(collateral_to_release > 0);
        }
    }

    #[test]
    fn test_assess_hard_liquidation() {
        let vault = test_vault(8_000 * PRECISION, 10 * PRECISION);
        let pool = test_lending_pool();

        // 10 ETH at $900 → HF = (10*900*0.8)/8000 = 0.9
        let result = assess_vault(
            &vault, &pool, None,
            900 * PRECISION,
            PRECISION,
        );

        assert_eq!(result.risk_tier, RiskTier::HardLiquidation);
        assert!(matches!(result.action, KeeperAction::HardLiquidate { .. }));

        if let KeeperAction::HardLiquidate { max_repay, max_seized, .. } = result.action {
            assert!(max_repay > 0);
            assert!(max_seized > 0);
        }
    }

    #[test]
    fn test_assess_no_debt_vault() {
        let vault = test_vault(0, 10 * PRECISION);
        let pool = test_lending_pool();

        let result = assess_vault(&vault, &pool, None, 2000 * PRECISION, PRECISION);
        assert_eq!(result.risk_tier, RiskTier::Safe);
        assert_eq!(result.health_factor, u128::MAX);
    }

    // ============ Batch Assessment Tests ============

    #[test]
    fn test_batch_assess_sorted_by_urgency() {
        let pool = test_lending_pool();
        let vaults = vec![
            (test_vault(5_000 * PRECISION, 10 * PRECISION), test_cell_input(1)), // safe
            (test_vault(8_000 * PRECISION, 10 * PRECISION), test_cell_input(2)), // distressed
            (test_vault(6_000 * PRECISION, 10 * PRECISION), test_cell_input(3)), // warning
        ];

        let results = assess_vaults(
            &vaults, &pool, None,
            1050 * PRECISION, PRECISION,
        );

        // Should be sorted by HF ascending (most distressed first)
        assert!(results[0].0.health_factor <= results[1].0.health_factor);
        assert!(results[1].0.health_factor <= results[2].0.health_factor);

        // Most distressed vault is index 1 (8000 debt)
        assert_eq!(results[0].1, 1);
    }

    // ============ Premium Accrual Tests ============

    #[test]
    fn test_check_premium_accrual_due() {
        let ins = test_insurance_pool();
        let pool = test_lending_pool();

        let premium = check_premium_accrual(
            &ins, &pool,
            100 + 100_000, // 100K blocks since last accrual
            10_000, // min 10K blocks between accruals
        );

        assert!(premium > 0);
    }

    #[test]
    fn test_check_premium_accrual_too_soon() {
        let ins = test_insurance_pool();
        let pool = test_lending_pool();

        let premium = check_premium_accrual(
            &ins, &pool,
            150, // only 50 blocks since last (at 100)
            10_000, // min 10K blocks
        );

        assert_eq!(premium, 0);
    }

    // ============ Stress Test Tests ============

    #[test]
    fn test_stress_test_identifies_at_risk_vaults() {
        let pool = test_lending_pool();
        let vaults = vec![
            (test_vault(5_000 * PRECISION, 10 * PRECISION), test_cell_input(1)),
            (test_vault(8_000 * PRECISION, 10 * PRECISION), test_cell_input(2)),
        ];

        // 30% price drop
        let at_risk = stress_test_vaults(
            &vaults, &pool,
            1100 * PRECISION, PRECISION,
            3000, // 30% drop
        );

        // The 8000 debt vault should be at risk
        assert!(!at_risk.is_empty());
        assert_eq!(at_risk[0].0, 1); // index 1
    }

    #[test]
    fn test_stress_test_no_risk() {
        let pool = test_lending_pool();
        let vaults = vec![
            (test_vault(1_000 * PRECISION, 10 * PRECISION), test_cell_input(1)),
        ];

        // 10% price drop — very safe vault should survive
        let at_risk = stress_test_vaults(
            &vaults, &pool,
            2000 * PRECISION, PRECISION,
            1000, // 10% drop
        );

        assert!(at_risk.is_empty());
    }

    // ============ Integration: Mutualist Priority Test ============

    #[test]
    fn test_mutualist_priority_insurance_over_liquidation() {
        // This test verifies the core P-105 philosophy:
        // Insurance is ALWAYS preferred over liquidation when available.

        let vault = test_vault(8_000 * PRECISION, 10 * PRECISION);
        let pool = test_lending_pool();
        let ins = test_insurance_pool();

        // At HF = 1.05 (soft liquidation zone)
        let with_insurance = assess_vault(
            &vault, &pool, Some(&ins),
            1050 * PRECISION, PRECISION,
        );
        let without_insurance = assess_vault(
            &vault, &pool, None,
            1050 * PRECISION, PRECISION,
        );

        // With insurance: should prefer insurance claim
        assert!(matches!(with_insurance.action, KeeperAction::InsuranceClaim { .. }),
            "Should prefer insurance over liquidation");
        // Without insurance: falls back to soft liquidation
        assert!(matches!(without_insurance.action, KeeperAction::SoftLiquidate { .. }),
            "Should fall back to soft liquidation without insurance");
    }

    #[test]
    fn test_mutualist_priority_deleverage_over_insurance() {
        // Auto-deleverage (user's own deposits) > insurance (communal pool)
        // Using your own resources first is more mutualist than taking from the pool.

        let vault = test_vault_with_deposits(
            8_000 * PRECISION, 10 * PRECISION, 5_000 * PRECISION,
        );
        let pool = test_lending_pool();
        let ins = test_insurance_pool();

        // At HF = 1.2 (auto-deleverage zone)
        let result = assess_vault(
            &vault, &pool, Some(&ins),
            1200 * PRECISION, PRECISION,
        );

        // Should prefer auto-deleverage over insurance
        assert!(matches!(result.action, KeeperAction::AutoDeleverage { .. }),
            "Should prefer auto-deleverage when user has deposit shares");
    }

    // ============ HF Calculation Accuracy ============

    #[test]
    fn test_health_factor_scales_with_price() {
        let vault = test_vault(10_000 * PRECISION, 10 * PRECISION);
        let pool = test_lending_pool();

        // At $2000: HF = (10*2000*0.8)/10000 = 1.6
        let high = assess_vault(&vault, &pool, None, 2000 * PRECISION, PRECISION);
        // At $1000: HF = (10*1000*0.8)/10000 = 0.8
        let low = assess_vault(&vault, &pool, None, 1000 * PRECISION, PRECISION);

        assert!(high.health_factor > low.health_factor);
        assert!(high.health_factor > PRECISION); // Safe at $2000
        assert!(low.health_factor < PRECISION);  // Underwater at $1000
    }

    #[test]
    fn test_health_factor_scales_with_collateral() {
        let pool = test_lending_pool();

        let big = assess_vault(
            &test_vault(10_000 * PRECISION, 20 * PRECISION),
            &pool, None, 1000 * PRECISION, PRECISION,
        );
        let small = assess_vault(
            &test_vault(10_000 * PRECISION, 5 * PRECISION),
            &pool, None, 1000 * PRECISION, PRECISION,
        );

        assert!(big.health_factor > small.health_factor);
    }

    #[test]
    fn test_collateral_and_debt_values_populated() {
        let vault = test_vault(5_000 * PRECISION, 10 * PRECISION);
        let pool = test_lending_pool();

        let result = assess_vault(&vault, &pool, None, 2000 * PRECISION, PRECISION);

        // Collateral value = 10 * 2000 * PRECISION / PRECISION = 20000 * PRECISION
        assert!(result.collateral_value > 0);
        assert!(result.debt_value > 0);
        assert!(result.current_debt > 0);
    }

    // ============ Interest Accrual in Assessment ============

    #[test]
    fn test_debt_increases_with_borrow_index() {
        let vault = test_vault(10_000 * PRECISION, 10 * PRECISION);

        // Pool with 1.0x borrow index → debt = shares
        let pool_no_interest = test_lending_pool();

        // Pool with 1.1x borrow index → debt = shares * 1.1
        let pool_with_interest = LendingPoolCellData {
            borrow_index: PRECISION * 110 / 100,
            ..test_lending_pool()
        };

        let r1 = assess_vault(&vault, &pool_no_interest, None, 2000 * PRECISION, PRECISION);
        let r2 = assess_vault(&vault, &pool_with_interest, None, 2000 * PRECISION, PRECISION);

        // Higher borrow index means more debt, lower HF
        assert!(r2.current_debt > r1.current_debt);
        assert!(r2.health_factor < r1.health_factor);
    }

    // ============ Batch Assessment Edge Cases ============

    #[test]
    fn test_batch_assess_empty() {
        let pool = test_lending_pool();
        let results = assess_vaults(&[], &pool, None, 2000 * PRECISION, PRECISION);
        assert!(results.is_empty());
    }

    #[test]
    fn test_batch_assess_single_vault() {
        let pool = test_lending_pool();
        let vaults = vec![
            (test_vault(5_000 * PRECISION, 10 * PRECISION), test_cell_input(1)),
        ];

        let results = assess_vaults(&vaults, &pool, None, 2000 * PRECISION, PRECISION);
        assert_eq!(results.len(), 1);
        assert_eq!(results[0].1, 0); // index preserved
    }

    #[test]
    fn test_batch_assess_preserves_index() {
        let pool = test_lending_pool();
        let vaults = vec![
            (test_vault(1_000 * PRECISION, 10 * PRECISION), test_cell_input(1)),  // HF high
            (test_vault(20_000 * PRECISION, 10 * PRECISION), test_cell_input(2)), // HF low
            (test_vault(10_000 * PRECISION, 10 * PRECISION), test_cell_input(3)), // HF middle
        ];

        let results = assess_vaults(&vaults, &pool, None, 2000 * PRECISION, PRECISION);

        // After sorting by HF, original indices should be preserved
        for (assessment, orig_idx) in &results {
            assert!(*orig_idx < 3);
            // Verify the assessment matches the vault at that index
            let expected_debt = vaults[*orig_idx].0.debt_shares;
            assert_eq!(assessment.current_debt, expected_debt);
        }
    }

    // ============ Premium Accrual Edge Cases ============

    #[test]
    fn test_premium_accrual_at_exact_boundary() {
        let ins = test_insurance_pool(); // last_premium_block = 100
        let pool = test_lending_pool();

        // Exactly at min_blocks (100 + 10000 = 10100)
        let at_boundary = check_premium_accrual(&ins, &pool, 10100, 10_000);
        assert_eq!(at_boundary, 0); // <= not <, so exactly at boundary = too soon

        // One block after
        let after = check_premium_accrual(&ins, &pool, 10101, 10_000);
        assert!(after > 0);
    }

    #[test]
    fn test_premium_scales_with_borrows() {
        let ins = test_insurance_pool();
        let pool_low = LendingPoolCellData {
            total_borrows: 100_000 * PRECISION,
            ..test_lending_pool()
        };
        let pool_high = LendingPoolCellData {
            total_borrows: 500_000 * PRECISION,
            ..test_lending_pool()
        };

        let prem_low = check_premium_accrual(&ins, &pool_low, 200_000, 10_000);
        let prem_high = check_premium_accrual(&ins, &pool_high, 200_000, 10_000);

        assert!(prem_high > prem_low);
    }

    #[test]
    fn test_premium_zero_borrows() {
        let ins = test_insurance_pool();
        let pool = LendingPoolCellData {
            total_borrows: 0,
            ..test_lending_pool()
        };

        let premium = check_premium_accrual(&ins, &pool, 200_000, 10_000);
        assert_eq!(premium, 0);
    }

    // ============ Stress Test Edge Cases ============

    #[test]
    fn test_stress_test_no_debt_vaults_ignored() {
        let pool = test_lending_pool();
        let vaults = vec![
            (test_vault(0, 10 * PRECISION), test_cell_input(1)),
        ];

        let at_risk = stress_test_vaults(&vaults, &pool, 2000 * PRECISION, PRECISION, 5000);
        assert!(at_risk.is_empty(), "No-debt vaults should not be at risk");
    }

    #[test]
    fn test_stress_test_sorted_by_severity() {
        let pool = test_lending_pool();
        let vaults = vec![
            (test_vault(5_000 * PRECISION, 10 * PRECISION), test_cell_input(1)),
            (test_vault(15_000 * PRECISION, 10 * PRECISION), test_cell_input(2)),
            (test_vault(10_000 * PRECISION, 10 * PRECISION), test_cell_input(3)),
        ];

        let at_risk = stress_test_vaults(&vaults, &pool, 2000 * PRECISION, PRECISION, 4000);

        // Should be sorted by stressed HF ascending
        for i in 1..at_risk.len() {
            assert!(at_risk[i].1 >= at_risk[i - 1].1,
                "Stress results should be sorted by HF ascending");
        }
    }

    // ============ Auto-Deleverage Fallback Chain ============

    #[test]
    fn test_auto_deleverage_no_deposits_no_insurance_falls_to_warn() {
        let vault = test_vault(8_000 * PRECISION, 10 * PRECISION); // no deposit shares
        let pool = test_lending_pool();

        // At HF ≈ 1.2 (auto-deleverage zone), no insurance
        let result = assess_vault(&vault, &pool, None, 1200 * PRECISION, PRECISION);

        assert_eq!(result.risk_tier, RiskTier::AutoDeleverage);
        // With no deposits AND no insurance, falls back to Warn
        assert!(matches!(result.action, KeeperAction::Warn { .. }),
            "Should fall back to Warn without deposits or insurance");
    }

    // ============ Hard Liquidation Properties ============

    #[test]
    fn test_hard_liquidation_seized_exceeds_repay_value() {
        // Incentive means liquidator gets more collateral than debt repaid
        let vault = test_vault(8_000 * PRECISION, 10 * PRECISION);
        let pool = test_lending_pool();

        let result = assess_vault(&vault, &pool, None, 900 * PRECISION, PRECISION);

        if let KeeperAction::HardLiquidate { max_repay, max_seized, .. } = result.action {
            // Seized collateral value should be > repaid debt (liquidation incentive)
            let seized_value = ckb_lending_math::mul_div(max_seized, 900 * PRECISION, PRECISION);
            let repay_value = ckb_lending_math::mul_div(max_repay, PRECISION, PRECISION);
            assert!(seized_value >= repay_value,
                "Liquidation incentive: seized value ({}) should exceed repay ({})",
                seized_value, repay_value);
        } else {
            panic!("Expected HardLiquidate action");
        }
    }

    // ============ Owner Lock Hash Preserved ============

    #[test]
    fn test_warn_action_preserves_owner() {
        let mut vault = test_vault(7_000 * PRECISION, 10 * PRECISION);
        vault.owner_lock_hash = [0xDE; 32];
        let pool = test_lending_pool();

        let result = assess_vault(&vault, &pool, None, 1200 * PRECISION, PRECISION);

        if let KeeperAction::Warn { vault_owner, .. } = result.action {
            assert_eq!(vault_owner, [0xDE; 32]);
        } else {
            panic!("Expected Warn action");
        }
    }
}
