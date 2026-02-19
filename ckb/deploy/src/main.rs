// ============ VibeSwap CKB Deployment Tool ============
// Computes blake2b-256 code hashes from built RISC-V binaries
// and generates deployment configuration for CKB.
//
// Usage:
//   cargo run -p vibeswap-deploy
//   cargo run -p vibeswap-deploy -- --build-dir ./build --output deploy.json
//
// The output JSON contains all code_hash values needed by the SDK's
// DeploymentInfo struct. After deploying binaries on-chain, fill in
// the tx_hash and index fields.

use blake2b_simd::Params;
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use std::fs;
use std::path::PathBuf;

// ============ CKB Constants ============

/// CKB uses blake2b with personalization "ckb-default-hash" and 32-byte output
const CKB_HASH_PERSONALIZATION: &[u8] = b"ckb-default-hash";

// ============ Script Definitions ============

/// All 8 VibeSwap CKB scripts in deployment order
const SCRIPTS: &[(&str, &str)] = &[
    ("pow-lock",            "Lock script: PoW-gated shared cell access"),
    ("batch-auction-type",  "Type script: commit-reveal batch auction state machine"),
    ("commit-type",         "Type script: commit cell format validation"),
    ("amm-pool-type",       "Type script: constant product AMM pool validation"),
    ("lp-position-type",    "Type script: LP position cell tracking"),
    ("compliance-type",     "Type script: compliance registry management"),
    ("config-type",         "Type script: protocol configuration singleton"),
    ("oracle-type",         "Type script: oracle price feed validation"),
];

// ============ Deployment Config ============

#[derive(Serialize, Deserialize, Debug)]
struct DeploymentConfig {
    /// Network identifier
    network: String,
    /// Deployment timestamp
    deployed_at: String,
    /// Script deployment info
    scripts: BTreeMap<String, ScriptDeployment>,
    /// Dep group info (filled after on-chain deployment)
    dep_group: Option<DepGroupInfo>,
    /// Genesis cells (config, compliance, oracle — filled after creation)
    genesis_cells: Option<GenesisCells>,
}

#[derive(Serialize, Deserialize, Debug)]
struct ScriptDeployment {
    /// Human-readable description
    description: String,
    /// blake2b-256 hash of binary (CKB code_hash with HashType::Data1)
    code_hash: String,
    /// Binary size in bytes
    binary_size: usize,
    /// Hash type for script references
    hash_type: String,
    /// On-chain cell location (filled after deployment)
    cell_tx_hash: Option<String>,
    /// Output index in the deployment transaction
    cell_index: Option<u32>,
}

#[derive(Serialize, Deserialize, Debug)]
struct DepGroupInfo {
    /// Transaction hash of dep group cell
    tx_hash: String,
    /// Output index
    index: u32,
}

#[derive(Serialize, Deserialize, Debug)]
struct GenesisCells {
    /// Config singleton cell
    config: Option<CellLocation>,
    /// Compliance singleton cell
    compliance: Option<CellLocation>,
    /// Oracle cell (per trading pair)
    oracles: BTreeMap<String, CellLocation>,
}

#[derive(Serialize, Deserialize, Debug)]
struct CellLocation {
    tx_hash: String,
    index: u32,
}

// ============ Blake2b Hashing ============

fn ckb_blake2b(data: &[u8]) -> [u8; 32] {
    let result = Params::new()
        .hash_length(32)
        .personal(CKB_HASH_PERSONALIZATION)
        .hash(data);
    let mut hash = [0u8; 32];
    hash.copy_from_slice(result.as_bytes());
    hash
}

// ============ Main ============

fn main() {
    let args: Vec<String> = std::env::args().collect();

    // Parse arguments
    let build_dir = args
        .iter()
        .position(|a| a == "--build-dir")
        .and_then(|i| args.get(i + 1))
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from("build"));

    let output_file = args
        .iter()
        .position(|a| a == "--output")
        .and_then(|i| args.get(i + 1))
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from("deploy.json"));

    let network = args
        .iter()
        .position(|a| a == "--network")
        .and_then(|i| args.get(i + 1))
        .cloned()
        .unwrap_or_else(|| "devnet".to_string());

    println!("=== VibeSwap CKB Deployment Tool ===");
    println!("Build dir: {}", build_dir.display());
    println!("Network:   {}", network);
    println!("Output:    {}", output_file.display());
    println!();

    // Process each script
    let mut scripts = BTreeMap::new();
    let mut all_found = true;

    for (name, description) in SCRIPTS {
        let binary_path = build_dir.join(name);

        if !binary_path.exists() {
            eprintln!("  MISSING: {} — run 'make build' first", name);
            all_found = false;
            continue;
        }

        let binary_data = fs::read(&binary_path).expect("Failed to read binary");
        let code_hash = ckb_blake2b(&binary_data);
        let hash_hex = hex::encode(code_hash);

        println!(
            "  {:<25} {:>8} bytes  0x{}",
            name,
            binary_data.len(),
            &hash_hex[..16]
        );

        scripts.insert(
            name.to_string(),
            ScriptDeployment {
                description: description.to_string(),
                code_hash: format!("0x{}", hash_hex),
                binary_size: binary_data.len(),
                hash_type: "data1".to_string(),
                cell_tx_hash: None,
                cell_index: None,
            },
        );
    }

    if !all_found {
        eprintln!("\nSome binaries missing. Run 'make build' first.");
        std::process::exit(1);
    }

    // Build deployment config
    let config = DeploymentConfig {
        network,
        deployed_at: String::new(), // Filled during actual deployment
        scripts,
        dep_group: None,
        genesis_cells: None,
    };

    // Write JSON
    let json = serde_json::to_string_pretty(&config).expect("JSON serialization failed");
    fs::write(&output_file, &json).expect("Failed to write output file");

    println!();
    println!("Deployment config written to: {}", output_file.display());
    println!();
    println!("Next steps:");
    println!("  1. Start OffCKB devnet:  offckb node");
    println!("  2. Deploy binaries:      ckb-cli deploy gen-txs \\");
    println!("       --from-address <addr> \\");
    println!("       --info-file deploy.json \\");
    println!("       --migration-dir migrations \\");
    println!("       --deployment-config deploy.json");
    println!("  3. Sign & send:          ckb-cli deploy sign-txs / apply-txs");
    println!("  4. Update deploy.json with on-chain tx hashes");
    println!("  5. Create genesis cells:  config, compliance, oracle");

    // Also output Rust code for DeploymentInfo
    print_rust_deployment_info(&config);
}

fn print_rust_deployment_info(config: &DeploymentConfig) {
    println!();
    println!("=== SDK DeploymentInfo (paste into your app) ===");
    println!("let deployment = DeploymentInfo {{");

    let field_map = [
        ("pow-lock", "pow_lock_code_hash"),
        ("batch-auction-type", "batch_auction_type_code_hash"),
        ("commit-type", "commit_type_code_hash"),
        ("amm-pool-type", "amm_pool_type_code_hash"),
        ("lp-position-type", "lp_position_type_code_hash"),
        ("compliance-type", "compliance_type_code_hash"),
        ("config-type", "config_type_code_hash"),
        ("oracle-type", "oracle_type_code_hash"),
    ];

    for (script_name, field_name) in &field_map {
        if let Some(script) = config.scripts.get(*script_name) {
            let hash = &script.code_hash[2..]; // Strip 0x
            println!(
                "    {}: hex_to_hash(\"{}\"),",
                field_name, hash
            );
        }
    }

    println!("    script_dep_tx_hash: [0u8; 32], // Fill after dep group creation");
    println!("    script_dep_index: 0,");
    println!("}};");
}
