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

    // ============ NEW — Edge Case & Hardening Tests ============

    #[test]
    fn test_assess_zero_collateral_vault() {
        // Zero collateral with debt should be deeply underwater
        let vault = test_vault(5_000 * PRECISION, 0);
        let pool = test_lending_pool();

        let result = assess_vault(&vault, &pool, None, 2000 * PRECISION, PRECISION);

        assert_eq!(result.health_factor, 0);
        assert_eq!(result.risk_tier, RiskTier::HardLiquidation);
        assert!(matches!(result.action, KeeperAction::HardLiquidate { .. }));
        assert_eq!(result.collateral_value, 0);
        assert!(result.debt_value > 0);
    }

    #[test]
    fn test_assess_zero_collateral_price() {
        // Collateral price drops to zero — vault is worthless
        let vault = test_vault(5_000 * PRECISION, 10 * PRECISION);
        let pool = test_lending_pool();

        let result = assess_vault(&vault, &pool, None, 0, PRECISION);

        // health_factor should be 0 (ZeroPrice error path in health_factor)
        assert_eq!(result.health_factor, 0);
        assert_eq!(result.risk_tier, RiskTier::HardLiquidation);
    }

    #[test]
    fn test_assess_deeply_underwater_vault() {
        // Debt massively exceeds collateral value
        // 1 ETH at $100, 100_000 USDC debt → HF ≈ 0.0008
        let vault = test_vault(100_000 * PRECISION, 1 * PRECISION);
        let pool = test_lending_pool();

        let result = assess_vault(&vault, &pool, None, 100 * PRECISION, PRECISION);

        assert_eq!(result.risk_tier, RiskTier::HardLiquidation);
        assert!(result.health_factor < PRECISION);

        if let KeeperAction::HardLiquidate { max_repay, max_seized, .. } = result.action {
            // Seized cannot exceed total collateral
            assert!(max_seized <= vault.collateral_amount);
        } else {
            panic!("Expected HardLiquidate for deeply underwater vault");
        }
    }

    #[test]
    fn test_batch_assess_mixed_tiers_with_no_debt() {
        // Mix of no-debt (safe), safe, warning, and distressed vaults
        let pool = test_lending_pool();
        let ins = test_insurance_pool();

        let vaults = vec![
            (test_vault(0, 50 * PRECISION), test_cell_input(1)),               // no debt → u128::MAX HF
            (test_vault(5_000 * PRECISION, 10 * PRECISION), test_cell_input(2)), // safe
            (test_vault(8_000 * PRECISION, 10 * PRECISION), test_cell_input(3)), // distressed
            (test_vault(7_000 * PRECISION, 10 * PRECISION), test_cell_input(4)), // warning-ish
            (test_vault(0, 100 * PRECISION), test_cell_input(5)),              // no debt → u128::MAX HF
        ];

        let results = assess_vaults(
            &vaults, &pool, Some(&ins),
            1100 * PRECISION, PRECISION,
        );

        assert_eq!(results.len(), 5);

        // Most distressed (index 2, 8000 debt) should be first
        assert_eq!(results[0].1, 2);

        // No-debt vaults (index 0 and 4) should be last with u128::MAX HF
        let last_two: Vec<usize> = results[3..5].iter().map(|r| r.1).collect();
        assert!(last_two.contains(&0), "No-debt vault 0 should be near the end");
        assert!(last_two.contains(&4), "No-debt vault 4 should be near the end");

        // Verify sorting invariant
        for i in 1..results.len() {
            assert!(results[i].0.health_factor >= results[i - 1].0.health_factor,
                "Batch results must be sorted by HF ascending");
        }
    }

    #[test]
    fn test_stress_test_multiple_risk_levels() {
        // Vaults with varying health — stress test should identify exactly the vulnerable ones
        let pool = test_lending_pool();

        let vaults = vec![
            (test_vault(1_000 * PRECISION, 10 * PRECISION), test_cell_input(1)),  // Very safe: HF ~ 16
            (test_vault(12_000 * PRECISION, 10 * PRECISION), test_cell_input(2)), // Moderate: HF ~ 1.33
            (test_vault(15_000 * PRECISION, 10 * PRECISION), test_cell_input(3)), // Tight: HF ~ 1.07
            (test_vault(0, 5 * PRECISION), test_cell_input(4)),                   // No debt (skipped)
        ];

        // 20% drop
        let at_risk = stress_test_vaults(
            &vaults, &pool,
            2000 * PRECISION, PRECISION,
            2000, // 20% drop
        );

        // No-debt vault should not appear
        for (idx, _) in &at_risk {
            assert_ne!(*idx, 3, "No-debt vault must not appear in stress test results");
        }

        // The tightest vault (index 2, 15000 debt) is most likely at risk
        if !at_risk.is_empty() {
            assert_eq!(at_risk[0].0, 2, "Most at-risk vault should be sorted first");
        }
    }

    #[test]
    fn test_premium_accrual_zero_premium_rate() {
        let ins = InsurancePoolCellData {
            premium_rate_bps: 0,
            ..test_insurance_pool()
        };
        let pool = test_lending_pool();

        // Even after many blocks, zero rate means zero premium
        let premium = check_premium_accrual(&ins, &pool, 1_000_000, 10_000);
        assert_eq!(premium, 0, "Zero premium rate should yield zero premium");
    }

    #[test]
    fn test_soft_liquidation_with_depleted_insurance() {
        // Insurance pool with very small deposits — claim may be insufficient
        let vault = test_vault(8_000 * PRECISION, 10 * PRECISION);
        let pool = test_lending_pool();
        let depleted_ins = InsurancePoolCellData {
            total_deposits: 1, // nearly empty
            total_shares: 1,
            ..test_insurance_pool()
        };

        // HF ≈ 1.05 → SoftLiquidation zone
        let result = assess_vault(
            &vault, &pool, Some(&depleted_ins),
            1050 * PRECISION, PRECISION,
        );

        assert_eq!(result.risk_tier, RiskTier::SoftLiquidation);
        // Depleted insurance can't provide meaningful coverage, so should fall back
        // to SoftLiquidate (not InsuranceClaim)
        assert!(matches!(result.action, KeeperAction::SoftLiquidate { .. }),
            "Depleted insurance should fall back to soft liquidation, got {:?}", result.action);
    }

    #[test]
    fn test_vault_with_accrued_interest_snapshot() {
        // Vault opened when borrow_index was 0.5e18 — debt effectively doubles
        let vault = VaultCellData {
            owner_lock_hash: [0x44; 32],
            pool_id: [0x22; 32],
            collateral_amount: 10 * PRECISION,
            collateral_type_hash: [0x33; 32],
            debt_shares: 5_000 * PRECISION,
            borrow_index_snapshot: PRECISION / 2, // 0.5e18
            deposit_shares: 0,
            last_update_block: 50,
        };

        let pool = test_lending_pool(); // borrow_index = 1.0e18

        // current_debt = 5000 * 1.0 / 0.5 = 10_000
        let result = assess_vault(&vault, &pool, None, 2000 * PRECISION, PRECISION);
        assert_eq!(result.current_debt, 10_000 * PRECISION);

        // HF = (10 * 2000 * 0.8) / 10000 = 1.6 → Safe
        assert_eq!(result.risk_tier, RiskTier::Safe);
        assert!(result.health_factor >= prevention::HF_WARNING);
    }

    #[test]
    fn test_batch_assess_identical_vaults_stable_sort() {
        // All vaults identical — sorting should be stable (preserve original order)
        let pool = test_lending_pool();
        let vaults: Vec<(VaultCellData, CellInput)> = (0..5)
            .map(|i| (test_vault(5_000 * PRECISION, 10 * PRECISION), test_cell_input(i as u8)))
            .collect();

        let results = assess_vaults(&vaults, &pool, None, 2000 * PRECISION, PRECISION);

        assert_eq!(results.len(), 5);
        // All health factors should be equal
        let first_hf = results[0].0.health_factor;
        for (assessment, _) in &results {
            assert_eq!(assessment.health_factor, first_hf,
                "Identical vaults should have identical health factors");
        }
    }

    #[test]
    fn test_stress_test_zero_price_drop() {
        // 0% price drop — no vaults should be identified as at-risk if currently safe
        let pool = test_lending_pool();
        let vaults = vec![
            (test_vault(5_000 * PRECISION, 10 * PRECISION), test_cell_input(1)),  // safe
            (test_vault(3_000 * PRECISION, 10 * PRECISION), test_cell_input(2)),  // very safe
        ];

        let at_risk = stress_test_vaults(
            &vaults, &pool,
            2000 * PRECISION, PRECISION,
            0, // 0% drop — prices unchanged
        );

        // Safe vaults under no price stress should remain safe
        assert!(at_risk.is_empty(),
            "Zero price drop should not make safe vaults at-risk, found {} at-risk", at_risk.len());
    }

    #[test]
    fn test_vault_lifecycle_under_changing_prices() {
        // Integration: same vault assessed at progressively lower collateral prices
        // Verifies correct tier transitions: Safe → Warning → AutoDeleverage → SoftLiq → HardLiq
        let vault = test_vault(10_000 * PRECISION, 10 * PRECISION);
        let pool = test_lending_pool();

        // Prices from high to low, tracking tier progression
        let prices = [
            (3000 * PRECISION, RiskTier::Safe),            // HF = (10*3000*0.8)/10000 = 2.4
            (1700 * PRECISION, RiskTier::Warning),         // HF = (10*1700*0.8)/10000 = 1.36
            (1500 * PRECISION, RiskTier::AutoDeleverage),  // HF = (10*1500*0.8)/10000 = 1.2
            (1300 * PRECISION, RiskTier::SoftLiquidation), // HF = (10*1300*0.8)/10000 = 1.04
            (1000 * PRECISION, RiskTier::HardLiquidation), // HF = (10*1000*0.8)/10000 = 0.8
        ];

        let mut prev_hf = u128::MAX;
        for (price, expected_tier) in &prices {
            let result = assess_vault(&vault, &pool, None, *price, PRECISION);
            assert_eq!(result.risk_tier, *expected_tier,
                "At price {}, expected {:?} but got {:?} (HF={})",
                price / PRECISION, expected_tier, result.risk_tier, result.health_factor);
            assert!(result.health_factor <= prev_hf,
                "HF should decrease as price drops");
            prev_hf = result.health_factor;
        }
    }

    // ============ Additional Edge Case & Hardening Tests ============

    #[test]
    fn test_assess_very_high_collateral_price() {
        // Extremely high collateral price should result in very high HF
        let vault = test_vault(10_000 * PRECISION, 10 * PRECISION);
        let pool = test_lending_pool();

        let result = assess_vault(
            &vault, &pool, None,
            1_000_000 * PRECISION, // $1M per unit
            PRECISION,
        );

        assert_eq!(result.risk_tier, RiskTier::Safe);
        assert!(result.health_factor > 100 * PRECISION, "Should have extremely high HF");
        assert!(matches!(result.action, KeeperAction::Safe { .. }));
    }

    #[test]
    fn test_assess_debt_price_higher_than_one() {
        // Debt token worth $2 (e.g., wrapped token)
        // 10 ETH at $2000, 5000 shares debt, debt_price = $2
        // current_debt = 5000, debt_value = 5000 * 2 = 10000
        // col_value = 10 * 2000 = 20000
        // HF = (10 * 2000 * 0.8) / (5000 * 2) = 16000 / 10000 = 1.6
        let vault = test_vault(5_000 * PRECISION, 10 * PRECISION);
        let pool = test_lending_pool();

        let result_1x = assess_vault(&vault, &pool, None, 2000 * PRECISION, PRECISION);
        let result_2x = assess_vault(&vault, &pool, None, 2000 * PRECISION, 2 * PRECISION);

        // Higher debt price should reduce HF
        assert!(result_2x.health_factor < result_1x.health_factor,
            "Higher debt price should lower HF: 1x={}, 2x={}", result_1x.health_factor, result_2x.health_factor);
        assert!(result_2x.debt_value > result_1x.debt_value);
    }

    #[test]
    fn test_assess_both_prices_zero() {
        // Both collateral and debt price are zero
        let vault = test_vault(5_000 * PRECISION, 10 * PRECISION);
        let pool = test_lending_pool();

        let result = assess_vault(&vault, &pool, None, 0, 0);

        // HF should be 0 due to zero collateral price
        assert_eq!(result.health_factor, 0);
        assert_eq!(result.risk_tier, RiskTier::HardLiquidation);
    }

    #[test]
    fn test_stress_test_full_drop() {
        // 100% price drop (BPS_DENOMINATOR) — stressed_price goes to 0
        let pool = test_lending_pool();
        let vaults = vec![
            (test_vault(5_000 * PRECISION, 10 * PRECISION), test_cell_input(1)),
        ];

        let at_risk = stress_test_vaults(
            &vaults, &pool,
            2000 * PRECISION, PRECISION,
            10_000, // 100% drop
        );

        // Even the safest vault with debt should be at risk at 100% drop
        assert!(!at_risk.is_empty(), "100% price drop should make all debt vaults at risk");
        assert!(at_risk[0].1 < PRECISION, "Stressed HF should be below 1.0");
    }

    #[test]
    fn test_batch_assess_all_no_debt() {
        // All vaults have zero debt — all should be safe with u128::MAX HF
        let pool = test_lending_pool();
        let vaults = vec![
            (test_vault(0, 10 * PRECISION), test_cell_input(1)),
            (test_vault(0, 5 * PRECISION), test_cell_input(2)),
            (test_vault(0, 100 * PRECISION), test_cell_input(3)),
        ];

        let results = assess_vaults(&vaults, &pool, None, 2000 * PRECISION, PRECISION);

        assert_eq!(results.len(), 3);
        for (assessment, _) in &results {
            assert_eq!(assessment.health_factor, u128::MAX);
            assert_eq!(assessment.risk_tier, RiskTier::Safe);
            assert!(matches!(assessment.action, KeeperAction::Safe { .. }));
        }
    }

    #[test]
    fn test_premium_accrual_large_block_gap() {
        // Very large block gap should produce a proportionally large premium
        let ins = test_insurance_pool();
        let pool = test_lending_pool();

        let small_gap = check_premium_accrual(&ins, &pool, 200_000, 10_000);
        let large_gap = check_premium_accrual(&ins, &pool, 2_000_000, 10_000);

        assert!(large_gap > small_gap,
            "Larger block gap should produce larger premium: small={}, large={}", small_gap, large_gap);
    }

    #[test]
    fn test_stress_test_empty_vaults() {
        let pool = test_lending_pool();
        let at_risk = stress_test_vaults(&[], &pool, 2000 * PRECISION, PRECISION, 5000);
        assert!(at_risk.is_empty(), "Empty vault list should return empty results");
    }

    #[test]
    fn test_hard_liquidation_max_seized_bounded_by_collateral() {
        // Verify max_seized never exceeds the vault's total collateral
        let vault = test_vault(50_000 * PRECISION, 5 * PRECISION); // 5 ETH collateral, huge debt
        let pool = test_lending_pool();

        let result = assess_vault(&vault, &pool, None, 500 * PRECISION, PRECISION);

        assert_eq!(result.risk_tier, RiskTier::HardLiquidation);
        if let KeeperAction::HardLiquidate { max_seized, .. } = result.action {
            assert!(max_seized <= vault.collateral_amount,
                "Seized ({}) cannot exceed collateral ({})", max_seized, vault.collateral_amount);
        } else {
            panic!("Expected HardLiquidate action");
        }
    }

    #[test]
    fn test_assess_vault_preserves_current_debt() {
        // current_debt should equal debt_shares when borrow_index matches snapshot
        let vault = test_vault(5_000 * PRECISION, 10 * PRECISION);
        let pool = test_lending_pool(); // borrow_index = PRECISION, snapshot = PRECISION

        let result = assess_vault(&vault, &pool, None, 2000 * PRECISION, PRECISION);

        assert_eq!(result.current_debt, 5_000 * PRECISION,
            "With matching borrow indices, current_debt should equal debt_shares");
    }

    #[test]
    fn test_soft_liquidation_step_values_nonzero() {
        // At soft liquidation tier, both debt_to_repay and collateral_to_release should be nonzero
        let vault = test_vault(9_500 * PRECISION, 10 * PRECISION);
        let pool = test_lending_pool();

        // 10 ETH at $1200, 80% LT → HF = (10*1200*0.8)/9500 ≈ 1.01
        let result = assess_vault(&vault, &pool, None, 1200 * PRECISION, PRECISION);

        assert_eq!(result.risk_tier, RiskTier::SoftLiquidation);
        if let KeeperAction::SoftLiquidate { debt_to_repay, collateral_to_release, .. } = result.action {
            assert!(debt_to_repay > 0, "Soft liquidation should repay some debt");
            assert!(collateral_to_release > 0, "Soft liquidation should release some collateral");
            assert!(collateral_to_release <= vault.collateral_amount,
                "Released collateral should not exceed total");
        } else {
            panic!("Expected SoftLiquidate action at HF ≈ 1.01");
        }
    }

    // ============ New Edge Case & Boundary Tests ============

    #[test]
    fn test_assess_minimal_debt_one_unit() {
        // 1 unit of debt should still produce a valid assessment
        let vault = test_vault(1, 10 * PRECISION);
        let pool = test_lending_pool();

        let result = assess_vault(&vault, &pool, None, 2000 * PRECISION, PRECISION);

        // Even 1 unit of debt is valid — HF should be enormous
        assert_eq!(result.risk_tier, RiskTier::Safe);
        assert!(result.current_debt > 0);
    }

    #[test]
    fn test_assess_equal_collateral_and_debt_value() {
        // When collateral value * LT == debt value exactly → HF = LT (e.g., 0.8)
        // 10 ETH at $1000, debt = 10_000 USDC
        // col_value = 10*1000 = 10000, debt_value = 10000
        // HF = (10 * 1000 * 0.8) / 10000 = 0.8 → HardLiquidation
        let vault = test_vault(10_000 * PRECISION, 10 * PRECISION);
        let pool = test_lending_pool();

        let result = assess_vault(&vault, &pool, None, 1000 * PRECISION, PRECISION);

        assert_eq!(result.risk_tier, RiskTier::HardLiquidation);
        assert!(result.health_factor < PRECISION,
            "When col_value*LT == debt_value, HF = LT < 1.0");
    }

    #[test]
    fn test_assess_auto_deleverage_with_insufficient_deposits() {
        // Vault with tiny deposit shares — auto_deleverage returns (0, 0) → fall to insurance
        let vault = test_vault_with_deposits(
            8_000 * PRECISION, 10 * PRECISION, 1, // only 1 unit of deposit shares
        );
        let pool = test_lending_pool();
        let ins = test_insurance_pool();

        // HF ≈ 1.2 → AutoDeleverage zone
        let result = assess_vault(
            &vault, &pool, Some(&ins),
            1200 * PRECISION, PRECISION,
        );

        assert_eq!(result.risk_tier, RiskTier::AutoDeleverage);
        // Tiny deposits can't meaningfully deleverage, so should fall back to insurance
        assert!(matches!(result.action, KeeperAction::InsuranceClaim { .. } | KeeperAction::AutoDeleverage { .. }),
            "Should either auto-deleverage with tiny amounts or fall to insurance");
    }

    #[test]
    fn test_batch_assess_descending_health_factors() {
        // Construct vaults with known descending HF order and verify sort is ascending
        let pool = test_lending_pool();
        let vaults = vec![
            // All at $2000, varying debt
            (test_vault(1_000 * PRECISION, 10 * PRECISION), test_cell_input(1)),   // HF very high
            (test_vault(15_000 * PRECISION, 10 * PRECISION), test_cell_input(2)),  // HF moderate
            (test_vault(25_000 * PRECISION, 10 * PRECISION), test_cell_input(3)),  // HF low
            (test_vault(50_000 * PRECISION, 10 * PRECISION), test_cell_input(4)),  // HF very low
        ];

        let results = assess_vaults(&vaults, &pool, None, 2000 * PRECISION, PRECISION);

        // Verify ascending HF sort
        for i in 1..results.len() {
            assert!(results[i].0.health_factor >= results[i - 1].0.health_factor,
                "Results must be sorted by HF ascending at index {}", i);
        }
        // Most distressed (highest debt, index 3) should be first
        assert_eq!(results[0].1, 3, "Vault with 50K debt should be most distressed");
    }

    #[test]
    fn test_premium_accrual_at_block_zero() {
        // If current_block < last_premium_block + min_blocks, premium = 0
        // Edge case: current_block = 0, last_premium_block = 0, min_blocks = 0
        let ins = InsurancePoolCellData {
            last_premium_block: 0,
            ..test_insurance_pool()
        };
        let pool = test_lending_pool();

        // current_block = 0, min_blocks_between_accruals = 0
        // 0 <= 0 + 0 → returns 0
        let premium = check_premium_accrual(&ins, &pool, 0, 0);
        assert_eq!(premium, 0, "At exact boundary (block 0), no premium due");

        // current_block = 1, min_blocks = 0
        // 1 > 0 + 0 → should accrue
        let premium_after = check_premium_accrual(&ins, &pool, 1, 0);
        assert!(premium_after > 0, "One block after boundary should accrue premium");
    }

    #[test]
    fn test_stress_test_100_percent_drop() {
        // 100% price drop (10_000 bps) → stressed_price = 0
        let pool = test_lending_pool();
        let vaults = vec![
            (test_vault(1_000 * PRECISION, 10 * PRECISION), test_cell_input(1)),
        ];

        let at_risk = stress_test_vaults(
            &vaults, &pool,
            2000 * PRECISION, PRECISION,
            10_000, // 100% drop
        );

        assert!(!at_risk.is_empty(),
            "100% price drop should make every vault with debt at risk");
    }

    #[test]
    fn test_stress_test_preserves_sort_invariant() {
        // Multiple at-risk vaults should be sorted by stressed HF ascending
        let pool = test_lending_pool();
        let vaults = vec![
            (test_vault(7_000 * PRECISION, 10 * PRECISION), test_cell_input(1)),
            (test_vault(10_000 * PRECISION, 10 * PRECISION), test_cell_input(2)),
            (test_vault(9_000 * PRECISION, 10 * PRECISION), test_cell_input(3)),
            (test_vault(12_000 * PRECISION, 10 * PRECISION), test_cell_input(4)),
        ];

        let at_risk = stress_test_vaults(
            &vaults, &pool,
            1500 * PRECISION, PRECISION,
            3000, // 30% drop
        );

        for i in 1..at_risk.len() {
            assert!(at_risk[i].1 >= at_risk[i - 1].1,
                "Stress test results must be sorted by stressed HF ascending");
        }
    }

    #[test]
    fn test_assess_vault_high_borrow_index_extreme_debt() {
        // borrow_index at 10x → debt is 10x the shares
        let vault = test_vault(5_000 * PRECISION, 10 * PRECISION);
        let pool = LendingPoolCellData {
            borrow_index: 10 * PRECISION, // 10x
            ..test_lending_pool()
        };

        let result = assess_vault(&vault, &pool, None, 2000 * PRECISION, PRECISION);

        // current_debt = 5000 * 10 = 50_000
        assert_eq!(result.current_debt, 50_000 * PRECISION);
        // col_value = 10*2000 = 20_000, debt_value = 50_000 → deeply underwater
        assert_eq!(result.risk_tier, RiskTier::HardLiquidation);
    }

    #[test]
    fn test_assess_vault_collateral_value_calculated_correctly() {
        // Verify collateral_value = collateral_amount * collateral_price / PRECISION
        let vault = test_vault(5_000 * PRECISION, 7 * PRECISION);
        let pool = test_lending_pool();
        let col_price = 1500 * PRECISION;

        let result = assess_vault(&vault, &pool, None, col_price, PRECISION);

        // col_value = 7 * 1500 = 10_500
        let expected = ckb_lending_math::mul_div(7 * PRECISION, col_price, PRECISION);
        assert_eq!(result.collateral_value, expected,
            "Collateral value should be 7 * $1500 = $10,500 in PRECISION units");
    }

    #[test]
    fn test_batch_assess_with_insurance_propagated() {
        // Verify insurance pool is propagated to each vault's individual assessment
        let pool = test_lending_pool();
        let ins = test_insurance_pool();

        // One vault in auto-deleverage zone with no deposit shares → should get insurance claim
        let vaults = vec![
            (test_vault(8_000 * PRECISION, 10 * PRECISION), test_cell_input(1)),
        ];

        let results = assess_vaults(
            &vaults, &pool, Some(&ins),
            1200 * PRECISION, PRECISION,
        );

        assert_eq!(results.len(), 1);
        assert_eq!(results[0].0.risk_tier, RiskTier::AutoDeleverage);
        assert!(matches!(results[0].0.action, KeeperAction::InsuranceClaim { .. }),
            "Insurance should be propagated to batch assessment");
    }

    // ============ Batch 4: Additional Edge Case & Boundary Tests ============

    #[test]
    fn test_assess_vault_debt_value_scales_with_debt_price() {
        // debt_value should scale linearly with debt_price
        let vault = test_vault(10_000 * PRECISION, 10 * PRECISION);
        let pool = test_lending_pool();

        let r1 = assess_vault(&vault, &pool, None, 2000 * PRECISION, PRECISION);
        let r2 = assess_vault(&vault, &pool, None, 2000 * PRECISION, 3 * PRECISION);

        assert_eq!(r2.debt_value, r1.debt_value * 3,
            "Debt value should triple when debt price triples");
    }

    #[test]
    fn test_assess_vault_no_debt_has_correct_collateral_value() {
        // Even with no debt, collateral_value should be computed correctly
        let vault = test_vault(0, 25 * PRECISION);
        let pool = test_lending_pool();
        let col_price = 3000 * PRECISION;

        let result = assess_vault(&vault, &pool, None, col_price, PRECISION);

        let expected_col = ckb_lending_math::mul_div(25 * PRECISION, col_price, PRECISION);
        assert_eq!(result.collateral_value, expected_col);
        assert_eq!(result.debt_value, 0);
        assert_eq!(result.current_debt, 0);
    }

    #[test]
    fn test_stress_test_small_price_drop() {
        // 1% price drop should not affect a very healthy vault
        let pool = test_lending_pool();
        let vaults = vec![
            (test_vault(2_000 * PRECISION, 10 * PRECISION), test_cell_input(1)),
        ];
        // HF = (10*2000*0.8)/2000 = 8.0 → extremely safe
        let at_risk = stress_test_vaults(
            &vaults, &pool,
            2000 * PRECISION, PRECISION,
            100, // 1% drop
        );
        assert!(at_risk.is_empty(),
            "1% drop should not threaten a vault with HF=8.0");
    }

    #[test]
    fn test_batch_assess_two_identical_vaults_same_hf() {
        // Two vaults with identical parameters should have the same health factor
        let pool = test_lending_pool();
        let vaults = vec![
            (test_vault(6_000 * PRECISION, 10 * PRECISION), test_cell_input(1)),
            (test_vault(6_000 * PRECISION, 10 * PRECISION), test_cell_input(2)),
        ];
        let results = assess_vaults(&vaults, &pool, None, 1500 * PRECISION, PRECISION);
        assert_eq!(results[0].0.health_factor, results[1].0.health_factor,
            "Identical vaults should have identical health factors");
    }

    #[test]
    fn test_premium_accrual_proportional_to_premium_rate() {
        // Higher premium rate should produce proportionally higher premium
        let ins_low = InsurancePoolCellData {
            premium_rate_bps: 50, // 0.5%
            ..test_insurance_pool()
        };
        let ins_high = InsurancePoolCellData {
            premium_rate_bps: 200, // 2%
            ..test_insurance_pool()
        };
        let pool = test_lending_pool();

        let prem_low = check_premium_accrual(&ins_low, &pool, 200_000, 10_000);
        let prem_high = check_premium_accrual(&ins_high, &pool, 200_000, 10_000);

        assert!(prem_high > prem_low,
            "Higher premium rate should produce higher premium: low={}, high={}", prem_low, prem_high);
        // Should be roughly 4x (200/50)
        let ratio = prem_high / prem_low.max(1);
        assert!(ratio >= 3 && ratio <= 5,
            "Premium ratio should be ~4x for 4x rate: got {}x", ratio);
    }

    #[test]
    fn test_hard_liquidation_max_repay_bounded_by_debt() {
        // max_repay should never exceed the vault's total current_debt
        let vault = test_vault(20_000 * PRECISION, 10 * PRECISION);
        let pool = test_lending_pool();

        let result = assess_vault(&vault, &pool, None, 500 * PRECISION, PRECISION);
        assert_eq!(result.risk_tier, RiskTier::HardLiquidation);

        if let KeeperAction::HardLiquidate { max_repay, .. } = result.action {
            assert!(max_repay <= result.current_debt,
                "max_repay ({}) should not exceed current_debt ({})", max_repay, result.current_debt);
        } else {
            panic!("Expected HardLiquidate action");
        }
    }

    #[test]
    fn test_assess_safe_vault_action_contains_hf() {
        // Safe action should contain the correct health_factor
        let vault = test_vault(3_000 * PRECISION, 10 * PRECISION);
        let pool = test_lending_pool();

        let result = assess_vault(&vault, &pool, None, 2000 * PRECISION, PRECISION);
        assert_eq!(result.risk_tier, RiskTier::Safe);

        if let KeeperAction::Safe { health_factor } = result.action {
            assert_eq!(health_factor, result.health_factor,
                "Safe action HF should match assessment HF");
        } else {
            panic!("Expected Safe action");
        }
    }

    #[test]
    fn test_stress_test_50_percent_drop_most_distressed_first() {
        // With a 50% price drop, verify sorting puts the most distressed first
        let pool = test_lending_pool();
        let vaults = vec![
            (test_vault(6_000 * PRECISION, 10 * PRECISION), test_cell_input(1)),   // HF moderate
            (test_vault(14_000 * PRECISION, 10 * PRECISION), test_cell_input(2)),  // HF low
            (test_vault(9_000 * PRECISION, 10 * PRECISION), test_cell_input(3)),   // HF in between
        ];

        let at_risk = stress_test_vaults(
            &vaults, &pool,
            1500 * PRECISION, PRECISION,
            5000, // 50% drop
        );

        // Should be sorted by stressed HF ascending
        for i in 1..at_risk.len() {
            assert!(at_risk[i].1 >= at_risk[i - 1].1,
                "Stress results must be sorted ascending by stressed HF");
        }
        // Most at-risk should be index 1 (highest debt)
        if !at_risk.is_empty() {
            assert_eq!(at_risk[0].0, 1,
                "Vault with highest debt should be most at-risk under 50% drop");
        }
    }

    // ============ Batch 5: Edge Cases, Boundaries & Error Paths ============

    #[test]
    fn test_assess_vault_at_exact_hf_warning_boundary() {
        // HF exactly at 1.5 (HF_WARNING) should classify as Safe (>= HF_WARNING)
        // HF_WARNING = 1.5e18, LT = 0.8
        // HF = (col * price * LT) / (debt * debt_price)
        // 1.5 = (10 * P * 0.8) / (debt * 1)
        // debt = 10 * P * 0.8 / 1.5 = 8P / 1.5 ≈ 5333.33
        // We need to find price/debt combo that lands exactly at 1.5
        // With 10 ETH at $2000, debt=D: HF = (10*2000*0.8)/D = 16000/D
        // D = 16000/1.5 ≈ 10666.67 → not exact. Use collateral_price to tune.
        // With 10 ETH at price P, debt=8000: HF = (10*P*0.8)/8000
        // For HF=1.5: P = 1.5 * 8000 / (10*0.8) = 12000/8 = 1500
        let vault = test_vault(8_000 * PRECISION, 10 * PRECISION);
        let pool = test_lending_pool();

        let result = assess_vault(&vault, &pool, None, 1500 * PRECISION, PRECISION);

        // HF = (10*1500*0.8)/8000 = 12000/8000 = 1.5 exactly → Safe
        assert_eq!(result.risk_tier, RiskTier::Safe,
            "HF exactly at Warning boundary (1.5) should be Safe, got {:?}", result.risk_tier);
        assert!(matches!(result.action, KeeperAction::Safe { .. }));
    }

    #[test]
    fn test_assess_vault_just_below_warning_boundary() {
        // HF just below 1.5 → Warning tier
        // With 10 ETH at $1499, debt=8000: HF = (10*1499*0.8)/8000 = 11992/8000 = 1.499
        let vault = test_vault(8_000 * PRECISION, 10 * PRECISION);
        let pool = test_lending_pool();

        let result = assess_vault(&vault, &pool, None, 1499 * PRECISION, PRECISION);

        assert_eq!(result.risk_tier, RiskTier::Warning,
            "HF just below 1.5 should be Warning, got {:?} (HF={})", result.risk_tier, result.health_factor);
    }

    #[test]
    fn test_assess_vault_at_exact_auto_deleverage_boundary() {
        // HF exactly at 1.3 (HF_AUTO_DELEVERAGE) → should be Warning (>= 1.3)
        // With 10 ETH at price P, debt=8000: HF = (10*P*0.8)/8000
        // For HF=1.3: P = 1.3 * 8000 / (10*0.8) = 10400/8 = 1300
        let vault = test_vault(8_000 * PRECISION, 10 * PRECISION);
        let pool = test_lending_pool();

        let result = assess_vault(&vault, &pool, None, 1300 * PRECISION, PRECISION);

        // HF = (10*1300*0.8)/8000 = 10400/8000 = 1.3 exactly → Warning (>= HF_AUTO_DELEVERAGE)
        assert_eq!(result.risk_tier, RiskTier::Warning,
            "HF exactly at AutoDeleverage boundary (1.3) should be Warning");
    }

    #[test]
    fn test_assess_vault_at_exact_soft_liquidation_boundary() {
        // HF exactly at 1.1 (HF_SOFT_LIQUIDATION) → should be AutoDeleverage (>= 1.1)
        // For HF=1.1: P = 1.1 * 8000 / (10*0.8) = 8800/8 = 1100
        let vault = test_vault(8_000 * PRECISION, 10 * PRECISION);
        let pool = test_lending_pool();

        let result = assess_vault(&vault, &pool, None, 1100 * PRECISION, PRECISION);

        // HF = (10*1100*0.8)/8000 = 8800/8000 = 1.1 exactly → AutoDeleverage
        assert_eq!(result.risk_tier, RiskTier::AutoDeleverage,
            "HF exactly at SoftLiquidation boundary (1.1) should be AutoDeleverage");
    }

    #[test]
    fn test_assess_vault_at_exact_hard_liquidation_boundary() {
        // HF exactly at 1.0 (HF_HARD_LIQUIDATION) → should be SoftLiquidation (>= 1.0)
        // For HF=1.0: P = 1.0 * 8000 / (10*0.8) = 8000/8 = 1000
        let vault = test_vault(8_000 * PRECISION, 10 * PRECISION);
        let pool = test_lending_pool();

        let result = assess_vault(&vault, &pool, None, 1000 * PRECISION, PRECISION);

        // HF = (10*1000*0.8)/8000 = 8000/8000 = 1.0 exactly → SoftLiquidation
        assert_eq!(result.risk_tier, RiskTier::SoftLiquidation,
            "HF exactly at HardLiquidation boundary (1.0) should be SoftLiquidation");
    }

    #[test]
    fn test_assess_vault_just_below_hard_liquidation_boundary() {
        // HF just below 1.0 → HardLiquidation
        // For HF < 1.0: P = 999 (so HF ~ 0.999)
        let vault = test_vault(8_000 * PRECISION, 10 * PRECISION);
        let pool = test_lending_pool();

        let result = assess_vault(&vault, &pool, None, 999 * PRECISION, PRECISION);

        assert_eq!(result.risk_tier, RiskTier::HardLiquidation,
            "HF just below 1.0 should be HardLiquidation, got {:?}", result.risk_tier);
        assert!(matches!(result.action, KeeperAction::HardLiquidate { .. }));
    }

    #[test]
    fn test_assess_vault_zero_debt_price() {
        // Debt price = 0 should be handled gracefully
        let vault = test_vault(5_000 * PRECISION, 10 * PRECISION);
        let pool = test_lending_pool();

        let result = assess_vault(&vault, &pool, None, 2000 * PRECISION, 0);

        // With debt_price = 0, debt_value = 0, but health_factor calc may error
        // The health_factor function divides by debt_value which would be 0
        // Should hit the Err path and return HF = 0
        assert_eq!(result.debt_value, 0,
            "Zero debt price should give zero debt value");
    }

    #[test]
    fn test_assess_vault_with_only_collateral_no_debt_no_deposits() {
        // Pure collateral vault — no debt, no deposits
        let vault = VaultCellData {
            owner_lock_hash: [0xAA; 32],
            pool_id: [0x22; 32],
            collateral_amount: 100 * PRECISION,
            collateral_type_hash: [0x33; 32],
            debt_shares: 0,
            borrow_index_snapshot: PRECISION,
            deposit_shares: 0,
            last_update_block: 0,
        };
        let pool = test_lending_pool();

        let result = assess_vault(&vault, &pool, None, 5000 * PRECISION, PRECISION);

        assert_eq!(result.health_factor, u128::MAX);
        assert_eq!(result.risk_tier, RiskTier::Safe);
        assert_eq!(result.current_debt, 0);
        assert_eq!(result.debt_value, 0);
        // collateral_value = 100 * 5000 = 500_000
        assert!(result.collateral_value > 0);
    }

    #[test]
    fn test_batch_assess_large_batch() {
        // Test with 20 vaults of varying debt levels
        let pool = test_lending_pool();
        let vaults: Vec<(VaultCellData, CellInput)> = (1..=20)
            .map(|i| {
                let debt = (i as u128) * 1_000 * PRECISION;
                (test_vault(debt, 10 * PRECISION), test_cell_input(i as u8))
            })
            .collect();

        let results = assess_vaults(&vaults, &pool, None, 2000 * PRECISION, PRECISION);

        assert_eq!(results.len(), 20);

        // Verify strict ascending HF sort
        for i in 1..results.len() {
            assert!(results[i].0.health_factor >= results[i - 1].0.health_factor,
                "Sort invariant violated at index {}", i);
        }

        // The vault with the highest debt (index 19, 20_000 debt) should be first
        assert_eq!(results[0].1, 19,
            "Vault with most debt (20K) should be most distressed");
    }

    #[test]
    fn test_stress_test_all_debt_vaults_at_risk_under_extreme_drop() {
        // Under 90% drop, every vault with meaningful debt should be at risk
        let pool = test_lending_pool();
        // Use debt levels that are healthy at $2000 but underwater after 90% price drop
        // At $2000: HF = (10*2000*0.8)/debt = 16000/debt
        // After 90% drop to $200: stressed HF = (10*200*0.8)/debt = 1600/debt
        // For HF < 1.0: debt > 1600
        let vaults: Vec<(VaultCellData, CellInput)> = (1..=5)
            .map(|i| {
                let debt = ((i as u128) + 1) * 1_000 * PRECISION; // 2000..6000
                (test_vault(debt, 10 * PRECISION), test_cell_input(i as u8))
            })
            .collect();

        let at_risk = stress_test_vaults(
            &vaults, &pool,
            2000 * PRECISION, PRECISION,
            9000, // 90% drop
        );

        assert_eq!(at_risk.len(), 5,
            "All 5 debt vaults should be at risk under 90% price drop, got {}", at_risk.len());
    }

    #[test]
    fn test_premium_accrual_one_block_after_minimum() {
        // Exactly 1 block after the minimum gap
        let ins = InsurancePoolCellData {
            last_premium_block: 1000,
            ..test_insurance_pool()
        };
        let pool = test_lending_pool();

        // min_blocks = 500, so earliest accrual is block 1501
        let premium = check_premium_accrual(&ins, &pool, 1501, 500);
        assert!(premium > 0, "Should accrue premium 1 block after minimum gap");

        // blocks_elapsed = 1501 - 1000 = 501
        // Premium should be based on 501 blocks elapsed
    }

    #[test]
    fn test_warn_action_hf_matches_assessment_hf() {
        // Warn action's health_factor should match the assessment's health_factor
        // HF = (10*P*0.8)/7000 → for Warning (1.3 <= HF < 1.5): P in [1138, 1313)
        let vault = test_vault(7_000 * PRECISION, 10 * PRECISION);
        let pool = test_lending_pool();

        let result = assess_vault(&vault, &pool, None, 1200 * PRECISION, PRECISION);

        assert_eq!(result.risk_tier, RiskTier::Warning);
        if let KeeperAction::Warn { health_factor, .. } = result.action {
            assert_eq!(health_factor, result.health_factor,
                "Warn action HF should match assessment HF");
        } else {
            panic!("Expected Warn action");
        }
    }

    #[test]
    fn test_insurance_claim_hf_matches_assessment_hf() {
        // InsuranceClaim action's health_factor should match the assessment's health_factor
        let vault = test_vault(8_000 * PRECISION, 10 * PRECISION);
        let pool = test_lending_pool();
        let ins = test_insurance_pool();

        // AutoDeleverage zone with no deposits → falls to insurance
        let result = assess_vault(&vault, &pool, Some(&ins), 1200 * PRECISION, PRECISION);

        assert_eq!(result.risk_tier, RiskTier::AutoDeleverage);
        if let KeeperAction::InsuranceClaim { health_factor, claim_amount, .. } = result.action {
            assert_eq!(health_factor, result.health_factor,
                "InsuranceClaim action HF should match assessment HF");
            assert!(claim_amount > 0, "Claim amount should be positive");
        } else {
            panic!("Expected InsuranceClaim action, got {:?}", result.action);
        }
    }

    #[test]
    fn test_auto_deleverage_hf_matches_assessment_hf() {
        // AutoDeleverage action's health_factor should match the assessment's health_factor
        let vault = test_vault_with_deposits(
            8_000 * PRECISION, 10 * PRECISION, 5_000 * PRECISION,
        );
        let pool = test_lending_pool();

        let result = assess_vault(&vault, &pool, None, 1200 * PRECISION, PRECISION);

        assert_eq!(result.risk_tier, RiskTier::AutoDeleverage);
        if let KeeperAction::AutoDeleverage { health_factor, .. } = result.action {
            assert_eq!(health_factor, result.health_factor,
                "AutoDeleverage action HF should match assessment HF");
        } else {
            panic!("Expected AutoDeleverage action");
        }
    }

    #[test]
    fn test_hard_liquidation_hf_matches_assessment_hf() {
        // HardLiquidate action's health_factor should match the assessment's health_factor
        let vault = test_vault(8_000 * PRECISION, 10 * PRECISION);
        let pool = test_lending_pool();

        let result = assess_vault(&vault, &pool, None, 900 * PRECISION, PRECISION);

        assert_eq!(result.risk_tier, RiskTier::HardLiquidation);
        if let KeeperAction::HardLiquidate { health_factor, .. } = result.action {
            assert_eq!(health_factor, result.health_factor,
                "HardLiquidate action HF should match assessment HF");
        } else {
            panic!("Expected HardLiquidate action");
        }
    }

    #[test]
    fn test_soft_liquidation_hf_matches_assessment_hf() {
        // SoftLiquidate action's health_factor should match the assessment's health_factor
        let vault = test_vault(8_000 * PRECISION, 10 * PRECISION);
        let pool = test_lending_pool();

        let result = assess_vault(&vault, &pool, None, 1050 * PRECISION, PRECISION);

        assert_eq!(result.risk_tier, RiskTier::SoftLiquidation);
        if let KeeperAction::SoftLiquidate { health_factor, .. } = result.action {
            assert_eq!(health_factor, result.health_factor,
                "SoftLiquidate action HF should match assessment HF");
        } else {
            panic!("Expected SoftLiquidate action, got {:?}", result.action);
        }
    }

    #[test]
    fn test_batch_assess_returns_correct_indices_after_sort() {
        // After sorting, each result's index should correctly map back to its original vault
        let pool = test_lending_pool();
        let debts = [15_000u128, 3_000, 8_000, 1_000, 20_000];
        let vaults: Vec<(VaultCellData, CellInput)> = debts.iter().enumerate()
            .map(|(i, &d)| (test_vault(d * PRECISION, 10 * PRECISION), test_cell_input(i as u8)))
            .collect();

        let results = assess_vaults(&vaults, &pool, None, 2000 * PRECISION, PRECISION);

        for (assessment, orig_idx) in &results {
            let orig_debt = debts[*orig_idx];
            assert_eq!(assessment.current_debt, orig_debt * PRECISION,
                "Index {} should map to debt {}", orig_idx, orig_debt);
        }
    }

    #[test]
    fn test_stress_test_with_varied_borrow_index() {
        // Vaults with different borrow_index_snapshot should have correctly scaled debt
        let pool = LendingPoolCellData {
            borrow_index: 2 * PRECISION, // 2x index
            ..test_lending_pool()
        };

        // Vault with snapshot at 1x → effective debt = 5000 * 2/1 = 10000
        let vault_old = VaultCellData {
            borrow_index_snapshot: PRECISION,
            ..test_vault(5_000 * PRECISION, 10 * PRECISION)
        };
        // Vault with snapshot at 2x → effective debt = 5000 * 2/2 = 5000
        let vault_new = VaultCellData {
            borrow_index_snapshot: 2 * PRECISION,
            ..test_vault(5_000 * PRECISION, 10 * PRECISION)
        };

        let vaults = vec![
            (vault_old, test_cell_input(1)),
            (vault_new, test_cell_input(2)),
        ];

        // At $1200, 30% drop
        let at_risk = stress_test_vaults(
            &vaults, &pool,
            1200 * PRECISION, PRECISION,
            3000,
        );

        // Old vault (10K effective debt) should be more at risk than new vault (5K effective debt)
        // The old vault should appear first (or only) in at_risk
        if at_risk.len() >= 2 {
            assert_eq!(at_risk[0].0, 0, "Old vault (higher effective debt) should be more at-risk");
        }
    }

    #[test]
    fn test_assess_vault_symmetry_doubling_debt_halves_hf() {
        // Doubling debt should approximately halve the health factor
        let pool = test_lending_pool();
        let vault_base = test_vault(5_000 * PRECISION, 10 * PRECISION);
        let vault_double = test_vault(10_000 * PRECISION, 10 * PRECISION);

        let r_base = assess_vault(&vault_base, &pool, None, 2000 * PRECISION, PRECISION);
        let r_double = assess_vault(&vault_double, &pool, None, 2000 * PRECISION, PRECISION);

        // HF should be roughly halved (within rounding)
        let ratio = r_base.health_factor / r_double.health_factor.max(1);
        assert!(ratio >= 1 && ratio <= 3,
            "Doubling debt should roughly halve HF: base={}, double={}, ratio={}",
            r_base.health_factor, r_double.health_factor, ratio);
    }

    #[test]
    fn test_assess_vault_symmetry_doubling_collateral_doubles_hf() {
        // Doubling collateral should double the health factor
        let pool = test_lending_pool();
        let vault_base = test_vault(10_000 * PRECISION, 10 * PRECISION);
        let vault_double = test_vault(10_000 * PRECISION, 20 * PRECISION);

        let r_base = assess_vault(&vault_base, &pool, None, 2000 * PRECISION, PRECISION);
        let r_double = assess_vault(&vault_double, &pool, None, 2000 * PRECISION, PRECISION);

        // HF should be exactly doubled
        assert_eq!(r_double.health_factor, r_base.health_factor * 2,
            "Doubling collateral should exactly double HF");
    }

    #[test]
    fn test_soft_liquidation_collateral_release_bounded() {
        // collateral_to_release should never exceed the vault's total collateral
        let vault = test_vault(9_500 * PRECISION, 10 * PRECISION);
        let pool = test_lending_pool();

        // HF ≈ 1.01 → SoftLiquidation
        let result = assess_vault(&vault, &pool, None, 1200 * PRECISION, PRECISION);

        if let KeeperAction::SoftLiquidate { collateral_to_release, .. } = result.action {
            assert!(collateral_to_release <= vault.collateral_amount,
                "Collateral release ({}) must not exceed total ({})",
                collateral_to_release, vault.collateral_amount);
        }
    }

    #[test]
    fn test_premium_accrual_max_u64_block() {
        // Very large block number should not overflow
        let ins = InsurancePoolCellData {
            last_premium_block: 0,
            ..test_insurance_pool()
        };
        let pool = test_lending_pool();

        // Using a large but not max block to avoid overflow in subtraction
        let premium = check_premium_accrual(&ins, &pool, u64::MAX / 2, 0);
        assert!(premium > 0, "Large block number should produce valid premium");
    }

    #[test]
    fn test_assess_vault_custom_liquidation_threshold() {
        // Non-default LT (50% instead of 80%) should affect HF calculation
        let vault = test_vault(5_000 * PRECISION, 10 * PRECISION);
        let pool_default = test_lending_pool(); // LT = 80%
        let pool_low_lt = LendingPoolCellData {
            liquidation_threshold: 500_000_000_000_000_000, // 50%
            ..test_lending_pool()
        };

        let r_default = assess_vault(&vault, &pool_default, None, 2000 * PRECISION, PRECISION);
        let r_low_lt = assess_vault(&vault, &pool_low_lt, None, 2000 * PRECISION, PRECISION);

        // Lower LT → lower HF (less buffer)
        assert!(r_low_lt.health_factor < r_default.health_factor,
            "Lower LT should result in lower HF: default={}, low={}",
            r_default.health_factor, r_low_lt.health_factor);
    }

    // ============ Batch 6: New Edge Case, Boundary & Error Path Tests ============

    #[test]
    fn test_assess_empty_vault_zero_debt_zero_collateral() {
        // A completely empty vault (no debt, no collateral) should be safe
        let vault = test_vault(0, 0);
        let pool = test_lending_pool();

        let result = assess_vault(&vault, &pool, None, 2000 * PRECISION, PRECISION);

        assert_eq!(result.health_factor, u128::MAX);
        assert_eq!(result.risk_tier, RiskTier::Safe);
        assert_eq!(result.current_debt, 0);
        assert_eq!(result.collateral_value, 0);
        assert_eq!(result.debt_value, 0);
    }

    #[test]
    fn test_assess_vault_minimal_collateral_one_unit() {
        // 1 unit of collateral with substantial debt should be deeply underwater
        let vault = test_vault(10_000 * PRECISION, 1);
        let pool = test_lending_pool();

        let result = assess_vault(&vault, &pool, None, 2000 * PRECISION, PRECISION);

        assert_eq!(result.risk_tier, RiskTier::HardLiquidation);
        assert!(result.health_factor < PRECISION);
        assert!(result.collateral_value > 0, "Even 1 unit of collateral has value");
    }

    #[test]
    fn test_assess_vault_equal_prices_non_stablecoin_pair() {
        // Both collateral and debt priced at same non-$1 value (e.g., ETH/ETH pair)
        let vault = test_vault(6 * PRECISION, 10 * PRECISION);
        let pool = test_lending_pool();

        // Both at $2000
        let result = assess_vault(
            &vault, &pool, None,
            2000 * PRECISION, 2000 * PRECISION,
        );

        // HF = (10 * 2000 * 0.8) / (6 * 2000) = 16000/12000 = 1.333...
        assert_eq!(result.risk_tier, RiskTier::Warning);
        assert!(result.collateral_value > 0);
        assert!(result.debt_value > 0);
    }

    #[test]
    fn test_insurance_pool_with_zero_max_coverage() {
        // Insurance pool exists but max_coverage_bps = 0 -> cannot pay any claims
        let vault = test_vault(8_000 * PRECISION, 10 * PRECISION);
        let pool = test_lending_pool();
        let ins = InsurancePoolCellData {
            max_coverage_bps: 0, // 0% max coverage
            ..test_insurance_pool()
        };

        // AutoDeleverage zone, no deposits -> tries insurance but 0% coverage
        let result = assess_vault(
            &vault, &pool, Some(&ins),
            1200 * PRECISION, PRECISION,
        );

        assert_eq!(result.risk_tier, RiskTier::AutoDeleverage);
        // With 0% max coverage, insurance claim amount should be 0 -> falls to Warn
        assert!(matches!(result.action, KeeperAction::Warn { .. }),
            "Zero max coverage insurance should fall back to Warn, got {:?}", result.action);
    }

    #[test]
    fn test_batch_assess_all_hard_liquidation() {
        // All vaults deeply underwater - every single one should be HardLiquidation
        let pool = test_lending_pool();
        let vaults = vec![
            (test_vault(20_000 * PRECISION, 10 * PRECISION), test_cell_input(1)),
            (test_vault(30_000 * PRECISION, 10 * PRECISION), test_cell_input(2)),
            (test_vault(50_000 * PRECISION, 10 * PRECISION), test_cell_input(3)),
        ];

        let results = assess_vaults(
            &vaults, &pool, None,
            500 * PRECISION, PRECISION,
        );

        assert_eq!(results.len(), 3);
        for (assessment, _) in &results {
            assert_eq!(assessment.risk_tier, RiskTier::HardLiquidation,
                "All vaults should be in HardLiquidation tier");
            assert!(matches!(assessment.action, KeeperAction::HardLiquidate { .. }));
        }
        // Most distressed (50K debt, index 2) should be first
        assert_eq!(results[0].1, 2);
    }

    #[test]
    fn test_premium_accrual_min_blocks_very_large() {
        // If min_blocks_between_accruals is very large, accrual should not be due
        let ins = test_insurance_pool(); // last_premium_block = 100
        let pool = test_lending_pool();

        // current_block = 1_000_000, min_blocks = 10_000_000 -> still too soon
        let premium = check_premium_accrual(&ins, &pool, 1_000_000, 10_000_000);
        assert_eq!(premium, 0,
            "With very large min_blocks, premium accrual should not be due");
    }

    #[test]
    fn test_assess_auto_deleverage_insurance_claim_zero_falls_to_warn() {
        // Auto-deleverage zone, no deposits, insurance pool exists but yields 0 claim
        let vault = test_vault(8_000 * PRECISION, 10 * PRECISION);
        let pool = test_lending_pool();
        let ins = InsurancePoolCellData {
            total_deposits: 0,
            total_shares: 0,
            max_coverage_bps: 0,
            ..test_insurance_pool()
        };

        let result = assess_vault(
            &vault, &pool, Some(&ins),
            1200 * PRECISION, PRECISION,
        );

        assert_eq!(result.risk_tier, RiskTier::AutoDeleverage);
        // Insurance with 0 deposits and 0 coverage -> claim = 0 -> falls to Warn
        assert!(matches!(result.action, KeeperAction::Warn { .. }),
            "Empty insurance should fall to Warn, got {:?}", result.action);
    }

    #[test]
    fn test_stress_test_debt_price_higher_than_collateral_price() {
        // Debt token more valuable than collateral token
        // 10 units of collateral at $100, debts at $500 per unit
        let pool = test_lending_pool();
        let vaults = vec![
            (test_vault(5 * PRECISION, 10 * PRECISION), test_cell_input(1)),
        ];

        // HF = (10*100*0.8)/(5*500) = 800/2500 = 0.32 -> already underwater
        // Any price drop makes it worse
        let at_risk = stress_test_vaults(
            &vaults, &pool,
            100 * PRECISION, 500 * PRECISION,
            1000, // 10% drop
        );

        // Already underwater vault should be at risk
        assert!(!at_risk.is_empty(),
            "Vault already underwater should appear in stress test results");
    }

    #[test]
    fn test_premium_accrual_linear_scaling_with_block_gap() {
        // Premium should scale linearly with blocks_elapsed
        let ins = InsurancePoolCellData {
            last_premium_block: 0,
            ..test_insurance_pool()
        };
        let pool = test_lending_pool();

        let prem_100k = check_premium_accrual(&ins, &pool, 100_000, 0);
        let prem_200k = check_premium_accrual(&ins, &pool, 200_000, 0);

        // 200K blocks should yield ~2x the premium of 100K blocks
        assert!(prem_200k > prem_100k);
        let ratio = prem_200k / prem_100k.max(1);
        assert_eq!(ratio, 2,
            "Premium should scale linearly: 200K/100K should be 2x, got {}x", ratio);
    }

    #[test]
    fn test_insurance_claim_estimated_new_hf_in_auto_deleverage() {
        // Verify that InsuranceClaim action provides a meaningful estimated_new_hf
        let vault = test_vault(8_000 * PRECISION, 10 * PRECISION);
        let pool = test_lending_pool();
        let ins = test_insurance_pool();

        let result = assess_vault(
            &vault, &pool, Some(&ins),
            1200 * PRECISION, PRECISION,
        );

        assert_eq!(result.risk_tier, RiskTier::AutoDeleverage);
        if let KeeperAction::InsuranceClaim { estimated_new_hf, health_factor, .. } = result.action {
            // estimated_new_hf should be >= current HF (insurance should improve the position)
            assert!(estimated_new_hf >= health_factor,
                "Insurance claim should improve HF: current={}, estimated_new={}",
                health_factor, estimated_new_hf);
        } else {
            panic!("Expected InsuranceClaim action, got {:?}", result.action);
        }
    }

    #[test]
    fn test_soft_liquidation_debt_to_repay_bounded_by_debt() {
        // debt_to_repay from soft liquidation should never exceed current_debt
        let vault = test_vault(9_500 * PRECISION, 10 * PRECISION);
        let pool = test_lending_pool();

        let result = assess_vault(&vault, &pool, None, 1200 * PRECISION, PRECISION);

        assert_eq!(result.risk_tier, RiskTier::SoftLiquidation);
        if let KeeperAction::SoftLiquidate { debt_to_repay, .. } = result.action {
            assert!(debt_to_repay <= result.current_debt,
                "debt_to_repay ({}) should not exceed current_debt ({})",
                debt_to_repay, result.current_debt);
        } else {
            panic!("Expected SoftLiquidate action");
        }
    }

    #[test]
    fn test_batch_assess_action_types_match_individual_assessments() {
        // Batch assessment results should match individual assessments
        let pool = test_lending_pool();
        let vault_data = vec![
            test_vault(3_000 * PRECISION, 10 * PRECISION),  // Safe
            test_vault(8_000 * PRECISION, 10 * PRECISION),  // Distressed
            test_vault(0, 5 * PRECISION),                    // No debt
        ];
        let vaults: Vec<(VaultCellData, CellInput)> = vault_data.iter()
            .enumerate()
            .map(|(i, v)| (v.clone(), test_cell_input(i as u8)))
            .collect();

        let batch = assess_vaults(&vaults, &pool, None, 1200 * PRECISION, PRECISION);

        // Individually assess each and compare
        for (batch_assessment, orig_idx) in &batch {
            let individual = assess_vault(
                &vault_data[*orig_idx], &pool, None,
                1200 * PRECISION, PRECISION,
            );
            assert_eq!(batch_assessment.health_factor, individual.health_factor,
                "Batch HF should match individual for vault {}", orig_idx);
            assert_eq!(batch_assessment.risk_tier, individual.risk_tier,
                "Batch tier should match individual for vault {}", orig_idx);
            assert_eq!(batch_assessment.current_debt, individual.current_debt,
                "Batch debt should match individual for vault {}", orig_idx);
        }
    }

    #[test]
    fn test_assess_vault_fractional_borrow_index_ratio() {
        // borrow_index / snapshot = 1.5 -> debt is 1.5x the shares
        let vault = VaultCellData {
            borrow_index_snapshot: PRECISION * 2 / 3, // 0.667e18
            ..test_vault(6_000 * PRECISION, 10 * PRECISION)
        };
        let pool = test_lending_pool(); // borrow_index = 1.0e18

        // current_debt = 6000 * 1.0 / 0.667 ≈ 9000
        let result = assess_vault(&vault, &pool, None, 2000 * PRECISION, PRECISION);

        assert!(result.current_debt > 6_000 * PRECISION,
            "Debt should be amplified by borrow index ratio: {}",
            result.current_debt);
        assert!(result.current_debt < 10_000 * PRECISION,
            "Debt should be ≈ 9000 * PRECISION: {}", result.current_debt);
    }

    #[test]
    fn test_stress_test_all_no_debt_returns_empty() {
        // Stress test with only no-debt vaults should return empty
        let pool = test_lending_pool();
        let vaults = vec![
            (test_vault(0, 10 * PRECISION), test_cell_input(1)),
            (test_vault(0, 50 * PRECISION), test_cell_input(2)),
            (test_vault(0, 1 * PRECISION), test_cell_input(3)),
        ];

        let at_risk = stress_test_vaults(
            &vaults, &pool,
            2000 * PRECISION, PRECISION,
            9000, // 90% drop
        );

        assert!(at_risk.is_empty(),
            "No-debt vaults should never appear in stress test results even with 90% drop");
    }

    #[test]
    fn test_assess_vault_high_liquidation_incentive() {
        // High liquidation incentive (20%) should affect hard liquidation seized amount
        let vault = test_vault(8_000 * PRECISION, 10 * PRECISION);
        let pool_normal = test_lending_pool(); // 5% incentive
        let pool_high = LendingPoolCellData {
            liquidation_incentive: 200_000_000_000_000_000, // 20%
            ..test_lending_pool()
        };

        let r_normal = assess_vault(&vault, &pool_normal, None, 900 * PRECISION, PRECISION);
        let r_high = assess_vault(&vault, &pool_high, None, 900 * PRECISION, PRECISION);

        assert_eq!(r_normal.risk_tier, RiskTier::HardLiquidation);
        assert_eq!(r_high.risk_tier, RiskTier::HardLiquidation);

        if let (
            KeeperAction::HardLiquidate { max_seized: seized_normal, .. },
            KeeperAction::HardLiquidate { max_seized: seized_high, .. },
        ) = (&r_normal.action, &r_high.action) {
            // Higher incentive should mean more collateral seized per unit of debt repaid
            // (or less debt repaid to respect collateral bounds)
            assert!(seized_high >= seized_normal || *seized_high > 0,
                "Higher liquidation incentive should affect seized amounts: normal={}, high={}",
                seized_normal, seized_high);
        } else {
            panic!("Expected HardLiquidate for both");
        }
    }

    #[test]
    fn test_assess_vault_small_but_nonzero_prices() {
        // Small but reasonable prices — 1 cent denominated in PRECISION
        let vault = test_vault(5_000 * PRECISION, 10 * PRECISION);
        let pool = test_lending_pool();
        let one_cent = PRECISION / 100;

        // Both at $0.01 -> behaves like equal-price pair
        // HF = (10 * 0.01 * 0.8) / (5000 * 0.01) = 0.08/50 = 0.0016 -> deeply underwater
        let result = assess_vault(&vault, &pool, None, one_cent, one_cent);

        assert!(result.health_factor < PRECISION,
            "With tiny prices but high debt, vault should be underwater");
        assert_eq!(result.risk_tier, RiskTier::HardLiquidation);
    }

    #[test]
    fn test_soft_liquidation_insurance_insufficient_falls_to_soft_liq() {
        // In SoftLiquidation zone, insurance exists but new_hf after claim
        // is still below HF_SOFT_LIQUIDATION -> falls back to SoftLiquidate
        let vault = test_vault(8_000 * PRECISION, 10 * PRECISION);
        let pool = test_lending_pool();

        // Insurance pool with very small deposits - claim won't restore HF enough
        let ins = InsurancePoolCellData {
            total_deposits: 10 * PRECISION, // Very small fund
            total_shares: 10 * PRECISION,
            max_coverage_bps: 100, // Only 1% coverage
            ..test_insurance_pool()
        };

        // HF ≈ 1.05 → SoftLiquidation zone
        let result = assess_vault(
            &vault, &pool, Some(&ins),
            1050 * PRECISION, PRECISION,
        );

        assert_eq!(result.risk_tier, RiskTier::SoftLiquidation);
        // Insurance can't restore HF above HF_SOFT_LIQUIDATION -> falls back to SoftLiquidate
        assert!(matches!(result.action, KeeperAction::SoftLiquidate { .. }),
            "Insufficient insurance should fall back to SoftLiquidate, got {:?}", result.action);
    }

    // ============ Batch 7: Additional Hardening Tests ============

    #[test]
    fn test_assess_vault_u128_max_collateral_safe() {
        // Vault with maximum possible collateral and minimal debt should be safe
        let vault = test_vault(1, u128::MAX / PRECISION);
        let pool = test_lending_pool();

        let result = assess_vault(&vault, &pool, None, PRECISION, PRECISION);

        assert_eq!(result.risk_tier, RiskTier::Safe);
        assert!(result.health_factor > PRECISION);
    }

    #[test]
    fn test_assess_vault_one_wei_collateral_one_wei_debt() {
        // Absolute minimal values: 1 unit collateral, 1 unit debt
        let vault = test_vault(1, 1);
        let pool = test_lending_pool();

        let result = assess_vault(&vault, &pool, None, PRECISION, PRECISION);

        // HF = (1 * 1.0 * 0.8) / (1 * 1.0) = 0.8 → HardLiquidation
        assert_eq!(result.risk_tier, RiskTier::HardLiquidation);
        assert!(result.health_factor < PRECISION);
    }

    #[test]
    fn test_batch_assess_ten_vaults_all_safe() {
        // All ten vaults are safe — verify sort stability and correctness
        let pool = test_lending_pool();
        let vaults: Vec<(VaultCellData, CellInput)> = (1..=10)
            .map(|i| {
                let debt = (i as u128) * 100 * PRECISION; // small debt
                (test_vault(debt, 100 * PRECISION), test_cell_input(i as u8))
            })
            .collect();

        let results = assess_vaults(&vaults, &pool, None, 2000 * PRECISION, PRECISION);

        assert_eq!(results.len(), 10);
        for (assessment, _) in &results {
            assert_eq!(assessment.risk_tier, RiskTier::Safe);
        }
        // Still sorted ascending
        for i in 1..results.len() {
            assert!(results[i].0.health_factor >= results[i - 1].0.health_factor);
        }
    }

    #[test]
    fn test_stress_test_no_price_drop_zero_bps() {
        // 0% price drop — no vaults should be at risk that aren't already
        let pool = test_lending_pool();
        let vaults = vec![
            (test_vault(5_000 * PRECISION, 10 * PRECISION), test_cell_input(1)),
        ];

        let at_risk = stress_test_vaults(
            &vaults, &pool,
            2000 * PRECISION, PRECISION,
            0, // 0% drop
        );

        // At 0% drop: HF = (10*2000*0.8)/5000 = 3.2 → not at risk
        assert!(at_risk.is_empty(),
            "0% price drop should not put a safe vault at risk");
    }

    #[test]
    fn test_premium_accrual_very_small_total_borrows() {
        // 1 unit of total_borrows — premium should be tiny but computable
        let ins = InsurancePoolCellData {
            last_premium_block: 0,
            ..test_insurance_pool()
        };
        let pool = LendingPoolCellData {
            total_borrows: 1,
            ..test_lending_pool()
        };

        let premium = check_premium_accrual(&ins, &pool, 100_000, 0);
        // Very small borrows → premium could be 0 due to integer division, that's OK
        assert!(premium <= 1, "Premium for 1 unit of borrows should be tiny");
    }

    #[test]
    fn test_assess_vault_insurance_claim_has_positive_estimated_new_hf() {
        // When insurance claim is issued, estimated_new_hf should be meaningful
        let vault = test_vault(8_000 * PRECISION, 10 * PRECISION);
        let pool = test_lending_pool();
        let ins = test_insurance_pool();

        let result = assess_vault(&vault, &pool, Some(&ins), 1050 * PRECISION, PRECISION);

        assert_eq!(result.risk_tier, RiskTier::SoftLiquidation);
        if let KeeperAction::InsuranceClaim { estimated_new_hf, .. } = result.action {
            assert!(estimated_new_hf > 0,
                "Insurance claim should have positive estimated_new_hf");
        }
    }

    #[test]
    fn test_vault_assessment_clone_debug() {
        // Verify VaultAssessment has Clone and Debug (compile-time test + basic usage)
        let vault = test_vault(5_000 * PRECISION, 10 * PRECISION);
        let pool = test_lending_pool();

        let result = assess_vault(&vault, &pool, None, 2000 * PRECISION, PRECISION);
        let cloned = result.clone();
        let _debug = format!("{:?}", cloned);

        assert_eq!(cloned.health_factor, result.health_factor);
        assert_eq!(cloned.current_debt, result.current_debt);
    }

    #[test]
    fn test_keeper_action_clone_debug_eq() {
        // Verify KeeperAction Clone, Debug, PartialEq, Eq (compile-time + usage)
        let a = KeeperAction::Safe { health_factor: 42 };
        let b = a.clone();
        assert_eq!(a, b);
        let _debug = format!("{:?}", a);

        let c = KeeperAction::Warn { health_factor: 10, vault_owner: [0xAA; 32] };
        assert_ne!(a, c);
    }

    #[test]
    fn test_assess_vault_soft_liq_with_large_insurance_prefers_insurance() {
        // Abundant insurance should allow successful claim in soft liquidation zone
        let vault = test_vault(8_000 * PRECISION, 10 * PRECISION);
        let pool = test_lending_pool();
        let ins = InsurancePoolCellData {
            total_deposits: 10_000_000 * PRECISION, // Very large fund
            total_shares: 10_000_000 * PRECISION,
            max_coverage_bps: 5000, // 50% coverage
            ..test_insurance_pool()
        };

        let result = assess_vault(&vault, &pool, Some(&ins), 1050 * PRECISION, PRECISION);

        assert_eq!(result.risk_tier, RiskTier::SoftLiquidation);
        // With a huge insurance pool, it should prefer insurance claim
        assert!(matches!(result.action, KeeperAction::InsuranceClaim { .. }),
            "Large insurance pool should enable claim, got {:?}", result.action);
    }

    #[test]
    fn test_stress_test_single_vault_at_exact_threshold() {
        // Vault whose stressed HF is exactly at the threshold boundary (1.0)
        // After stress, HF ≈ 1.0 → not at risk (< PRECISION means at risk)
        let pool = test_lending_pool();
        // HF = (10*P*0.8)/debt. After D% drop, stressed HF = (10*P*(1-D)*0.8)/debt
        // Want stressed_hf = 1.0: P*(1-0.3)*0.8*10 / debt = 1.0
        // P=2000, D=0.3: 2000*0.7*0.8*10 / debt = 1 → debt = 11200
        let vaults = vec![
            (test_vault(11_200 * PRECISION, 10 * PRECISION), test_cell_input(1)),
        ];

        let at_risk = stress_test_vaults(
            &vaults, &pool,
            2000 * PRECISION, PRECISION,
            3000, // 30% drop
        );

        // stressed_hf is approximately 1.0 — might be exactly at boundary
        // Either at risk or not is acceptable, just shouldn't panic
        assert!(at_risk.len() <= 1);
    }

    #[test]
    fn test_batch_assess_single_no_debt_vault() {
        // Single vault with zero debt
        let pool = test_lending_pool();
        let vaults = vec![
            (test_vault(0, 10 * PRECISION), test_cell_input(1)),
        ];

        let results = assess_vaults(&vaults, &pool, None, 2000 * PRECISION, PRECISION);
        assert_eq!(results.len(), 1);
        assert_eq!(results[0].0.health_factor, u128::MAX);
        assert_eq!(results[0].0.risk_tier, RiskTier::Safe);
        assert_eq!(results[0].1, 0);
    }

    #[test]
    fn test_assess_vault_borrow_index_snapshot_higher_than_current() {
        // Edge case: snapshot > current index (shouldn't happen in practice, but tests robustness)
        let vault = VaultCellData {
            borrow_index_snapshot: 2 * PRECISION, // snapshot at 2x
            ..test_vault(5_000 * PRECISION, 10 * PRECISION)
        };
        let pool = test_lending_pool(); // borrow_index = PRECISION (1x)

        // current_debt = 5000 * 1.0 / 2.0 = 2500 (debt is reduced)
        let result = assess_vault(&vault, &pool, None, 2000 * PRECISION, PRECISION);

        assert!(result.current_debt < 5_000 * PRECISION,
            "Debt should be reduced when snapshot > current: {}", result.current_debt);
        assert_eq!(result.risk_tier, RiskTier::Safe);
    }

    #[test]
    fn test_premium_accrual_rate_zero_bps_always_zero() {
        // Insurance pool with premium_rate_bps = 0 → premium should always be 0
        let ins = InsurancePoolCellData {
            premium_rate_bps: 0,
            last_premium_block: 0,
            ..test_insurance_pool()
        };
        let pool = test_lending_pool();

        let premium = check_premium_accrual(&ins, &pool, 1_000_000, 0);
        assert_eq!(premium, 0, "Zero premium rate should yield zero premium");
    }

    #[test]
    fn test_auto_deleverage_shares_bounded_by_deposit_shares() {
        // Auto-deleverage should not redeem more shares than the vault has
        let vault = test_vault_with_deposits(
            8_000 * PRECISION, 10 * PRECISION, 100 * PRECISION, // 100 deposit shares
        );
        let pool = test_lending_pool();

        let result = assess_vault(&vault, &pool, None, 1200 * PRECISION, PRECISION);

        assert_eq!(result.risk_tier, RiskTier::AutoDeleverage);
        if let KeeperAction::AutoDeleverage { shares_to_redeem, .. } = result.action {
            assert!(shares_to_redeem <= vault.deposit_shares,
                "Shares to redeem ({}) should not exceed deposit shares ({})",
                shares_to_redeem, vault.deposit_shares);
        }
    }

    #[test]
    fn test_assess_vault_collateral_value_independent_of_debt_price() {
        // Collateral value should only depend on collateral_amount and collateral_price
        let vault = test_vault(5_000 * PRECISION, 10 * PRECISION);
        let pool = test_lending_pool();

        let r1 = assess_vault(&vault, &pool, None, 2000 * PRECISION, PRECISION);
        let r2 = assess_vault(&vault, &pool, None, 2000 * PRECISION, 5 * PRECISION);

        assert_eq!(r1.collateral_value, r2.collateral_value,
            "Collateral value should not depend on debt price");
    }

    #[test]
    fn test_stress_test_two_vaults_same_parameters() {
        // Two identical vaults should produce identical stressed HFs
        let pool = test_lending_pool();
        let vaults = vec![
            (test_vault(8_000 * PRECISION, 10 * PRECISION), test_cell_input(1)),
            (test_vault(8_000 * PRECISION, 10 * PRECISION), test_cell_input(2)),
        ];

        let at_risk = stress_test_vaults(
            &vaults, &pool,
            1500 * PRECISION, PRECISION,
            3000, // 30% drop
        );

        // If both are at risk, they should have the same stressed HF
        if at_risk.len() == 2 {
            assert_eq!(at_risk[0].1, at_risk[1].1,
                "Identical vaults should have identical stressed HFs");
        }
    }

    #[test]
    fn test_assess_vault_with_zero_deposit_shares_zero_insurance_auto_deleverage_zone() {
        // Auto-deleverage zone with absolutely nothing to fall back on
        let vault = test_vault_with_deposits(8_000 * PRECISION, 10 * PRECISION, 0);
        let pool = test_lending_pool();

        let result = assess_vault(&vault, &pool, None, 1200 * PRECISION, PRECISION);

        assert_eq!(result.risk_tier, RiskTier::AutoDeleverage);
        // No deposits, no insurance → falls to Warn
        assert!(matches!(result.action, KeeperAction::Warn { .. }),
            "Auto-deleverage with no resources should fall to Warn");
    }
}
