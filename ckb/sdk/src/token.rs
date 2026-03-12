// ============ xUDT Token Operations ============
// SDK functions for issuing, transferring, and burning xUDT tokens on CKB.
//
// xUDT (extensible User-Defined Token) is CKB's standard fungible token:
// - Token identity = owner's lock_script_hash in type script args
// - Amount = first 16 bytes of cell data (u128, little-endian)
// - Owner mode = skip amount validation (allows mint/burn)
// - Flags (4 bytes after lock_hash): 0x00000000 = no extensions (sUDT-compatible)
//
// VibeSwap references tokens by `token_type_hash` everywhere.
// This module creates and manages the actual xUDT cells those hashes point to.

use sha2::{Digest, Sha256};

// ============ xUDT Constants ============

/// xUDT flags: no extensions (backward compatible with sUDT)
pub const XUDT_FLAGS_PLAIN: [u8; 4] = [0x00, 0x00, 0x00, 0x00];

/// Minimum CKB capacity for a token cell (covers data + scripts)
/// ~142 CKB = 14_200_000_000 shannons (conservative, covers type+lock+data)
pub const TOKEN_CELL_CAPACITY: u64 = 14_200_000_000;

/// Minimum CKB capacity for a token info cell (larger data: name, symbol, etc.)
/// ~200 CKB = 20_000_000_000 shannons
pub const TOKEN_INFO_CELL_CAPACITY: u64 = 20_000_000_000;

// ============ xUDT Type Script Config ============

/// On-chain xUDT type script location.
/// Must be set to match the deployed xUDT script on the target network.
#[derive(Clone, Debug)]
pub struct XudtConfig {
    /// code_hash of the deployed xUDT type script
    pub xudt_code_hash: [u8; 32],
    /// Hash type (Data1 for mainnet xUDT)
    pub xudt_hash_type: super::HashType,
    /// Cell dep pointing to the deployed xUDT script cell
    pub xudt_cell_dep_tx_hash: [u8; 32],
    pub xudt_cell_dep_index: u32,
    pub xudt_cell_dep_type: super::DepType,
}

// ============ Token Issuance ============

/// Build a transaction to mint new xUDT tokens.
///
/// The issuer's lock script hash becomes the permanent token identity.
/// Only the issuer (owner mode) can mint — anyone holding a cell with the
/// issuer's lock script triggers owner mode, bypassing amount validation.
///
/// Returns the unsigned transaction and the token_type_hash that VibeSwap
/// uses to reference this token everywhere.
pub fn mint_token(
    xudt_config: &XudtConfig,
    issuer_lock: super::Script,
    recipient_lock: super::Script,
    amount: u128,
    issuer_input: super::CellInput,
) -> (super::UnsignedTransaction, /*token_type_hash*/ [u8; 32]) {
    let issuer_lock_hash = hash_script(&issuer_lock);

    // xUDT type script args = owner_lock_hash (32 bytes) + flags (4 bytes)
    let mut type_args = Vec::with_capacity(36);
    type_args.extend_from_slice(&issuer_lock_hash);
    type_args.extend_from_slice(&XUDT_FLAGS_PLAIN);

    let type_script = super::Script {
        code_hash: xudt_config.xudt_code_hash,
        hash_type: xudt_config.xudt_hash_type.clone(),
        args: type_args,
    };

    // Compute the token_type_hash that VibeSwap uses everywhere
    let token_type_hash = hash_type_script(&type_script);

    // Cell data = u128 amount (little-endian, 16 bytes)
    let data = amount.to_le_bytes().to_vec();

    let token_output = super::CellOutput {
        capacity: TOKEN_CELL_CAPACITY,
        lock_script: recipient_lock,
        type_script: Some(type_script),
        data,
    };

    let tx = super::UnsignedTransaction {
        cell_deps: vec![super::CellDep {
            tx_hash: xudt_config.xudt_cell_dep_tx_hash,
            index: xudt_config.xudt_cell_dep_index,
            dep_type: xudt_config.xudt_cell_dep_type.clone(),
        }],
        inputs: vec![issuer_input],
        outputs: vec![token_output],
        witnesses: vec![vec![]], // Issuer signs
    };

    (tx, token_type_hash)
}

/// Build a transaction to mint tokens to multiple recipients in one tx.
/// More efficient than individual mints — one input, many outputs.
pub fn mint_batch(
    xudt_config: &XudtConfig,
    issuer_lock: super::Script,
    recipients: &[(super::Script, u128)], // (lock_script, amount) pairs
    issuer_input: super::CellInput,
) -> (super::UnsignedTransaction, [u8; 32]) {
    let issuer_lock_hash = hash_script(&issuer_lock);

    let mut type_args = Vec::with_capacity(36);
    type_args.extend_from_slice(&issuer_lock_hash);
    type_args.extend_from_slice(&XUDT_FLAGS_PLAIN);

    let type_script = super::Script {
        code_hash: xudt_config.xudt_code_hash,
        hash_type: xudt_config.xudt_hash_type.clone(),
        args: type_args,
    };

    let token_type_hash = hash_type_script(&type_script);

    let outputs: Vec<super::CellOutput> = recipients
        .iter()
        .map(|(lock, amount)| super::CellOutput {
            capacity: TOKEN_CELL_CAPACITY,
            lock_script: lock.clone(),
            type_script: Some(type_script.clone()),
            data: amount.to_le_bytes().to_vec(),
        })
        .collect();

    let witnesses = vec![vec![]; outputs.len().max(1)];

    let tx = super::UnsignedTransaction {
        cell_deps: vec![super::CellDep {
            tx_hash: xudt_config.xudt_cell_dep_tx_hash,
            index: xudt_config.xudt_cell_dep_index,
            dep_type: xudt_config.xudt_cell_dep_type.clone(),
        }],
        inputs: vec![issuer_input],
        outputs,
        witnesses,
    };

    (tx, token_type_hash)
}

// ============ Token Transfer ============

/// Build a transaction to transfer xUDT tokens.
///
/// UTXO model: consumes input cells, creates output cells.
/// Total input amount must >= total output amount (difference is burned).
/// Change is returned to the sender.
pub fn transfer_token(
    xudt_config: &XudtConfig,
    token_type_script: super::Script,
    sender_lock: super::Script,
    recipient_lock: super::Script,
    transfer_amount: u128,
    input_cells: Vec<(super::CellInput, u128)>, // (outpoint, amount) of sender's token cells
) -> Result<super::UnsignedTransaction, super::SDKError> {
    let total_input: u128 = input_cells.iter().map(|(_, amt)| amt).sum();
    if total_input < transfer_amount {
        return Err(super::SDKError::InvalidAmounts);
    }

    let change = total_input - transfer_amount;

    let mut outputs = vec![
        // Recipient cell
        super::CellOutput {
            capacity: TOKEN_CELL_CAPACITY,
            lock_script: recipient_lock,
            type_script: Some(token_type_script.clone()),
            data: transfer_amount.to_le_bytes().to_vec(),
        },
    ];

    // Change cell (only if there's change)
    if change > 0 {
        outputs.push(super::CellOutput {
            capacity: TOKEN_CELL_CAPACITY,
            lock_script: sender_lock,
            type_script: Some(token_type_script),
            data: change.to_le_bytes().to_vec(),
        });
    }

    let inputs: Vec<super::CellInput> = input_cells.into_iter().map(|(ci, _)| ci).collect();
    let witnesses = vec![vec![]; inputs.len()];

    Ok(super::UnsignedTransaction {
        cell_deps: vec![super::CellDep {
            tx_hash: xudt_config.xudt_cell_dep_tx_hash,
            index: xudt_config.xudt_cell_dep_index,
            dep_type: xudt_config.xudt_cell_dep_type.clone(),
        }],
        inputs,
        outputs,
        witnesses,
    })
}

// ============ Token Burn ============

/// Build a transaction to burn xUDT tokens.
///
/// Only the issuer (owner mode) can burn tokens.
/// Consumes input token cells without creating equal output amount.
pub fn burn_token(
    xudt_config: &XudtConfig,
    token_type_script: super::Script,
    burn_amount: u128,
    owner_lock: super::Script,
    input_cells: Vec<(super::CellInput, u128)>,
) -> Result<super::UnsignedTransaction, super::SDKError> {
    let total_input: u128 = input_cells.iter().map(|(_, amt)| amt).sum();
    if total_input < burn_amount {
        return Err(super::SDKError::InvalidAmounts);
    }

    let remaining = total_input - burn_amount;

    let mut outputs = Vec::new();

    // Only create a change cell if tokens remain
    if remaining > 0 {
        outputs.push(super::CellOutput {
            capacity: TOKEN_CELL_CAPACITY,
            lock_script: owner_lock,
            type_script: Some(token_type_script),
            data: remaining.to_le_bytes().to_vec(),
        });
    }

    let inputs: Vec<super::CellInput> = input_cells.into_iter().map(|(ci, _)| ci).collect();
    let witnesses = vec![vec![]; inputs.len()];

    Ok(super::UnsignedTransaction {
        cell_deps: vec![super::CellDep {
            tx_hash: xudt_config.xudt_cell_dep_tx_hash,
            index: xudt_config.xudt_cell_dep_index,
            dep_type: xudt_config.xudt_cell_dep_type.clone(),
        }],
        inputs,
        outputs,
        witnesses,
    })
}

// ============ Token Info Cell ============

/// Token metadata following the xUDT Information Convention.
/// Stored in a separate cell linked to the token's type script.
/// This is how wallets and explorers discover token name/symbol/decimals.
#[derive(Clone, Debug)]
pub struct TokenInfo {
    pub name: String,
    pub symbol: String,
    pub decimals: u8,
    pub description: String,
    /// Total supply cap (0 = unlimited)
    pub max_supply: u128,
}

impl TokenInfo {
    /// Serialize token info to cell data.
    /// Format: [decimals:1][name_len:2][name][symbol_len:2][symbol][desc_len:2][desc][max_supply:16]
    pub fn serialize(&self) -> Vec<u8> {
        let name_bytes = self.name.as_bytes();
        let symbol_bytes = self.symbol.as_bytes();
        let desc_bytes = self.description.as_bytes();

        let total_len = 1 + 2 + name_bytes.len() + 2 + symbol_bytes.len()
            + 2 + desc_bytes.len() + 16;
        let mut buf = Vec::with_capacity(total_len);

        buf.push(self.decimals);
        buf.extend_from_slice(&(name_bytes.len() as u16).to_le_bytes());
        buf.extend_from_slice(name_bytes);
        buf.extend_from_slice(&(symbol_bytes.len() as u16).to_le_bytes());
        buf.extend_from_slice(symbol_bytes);
        buf.extend_from_slice(&(desc_bytes.len() as u16).to_le_bytes());
        buf.extend_from_slice(desc_bytes);
        buf.extend_from_slice(&self.max_supply.to_le_bytes());

        buf
    }

    /// Deserialize token info from cell data.
    pub fn deserialize(data: &[u8]) -> Option<Self> {
        if data.len() < 1 + 2 + 2 + 2 + 16 {
            return None;
        }
        let mut offset = 0;

        let decimals = data[offset];
        offset += 1;

        let name_len = u16::from_le_bytes(data[offset..offset + 2].try_into().ok()?) as usize;
        offset += 2;
        if offset + name_len > data.len() { return None; }
        let name = core::str::from_utf8(&data[offset..offset + name_len]).ok()?.to_string();
        offset += name_len;

        let symbol_len = u16::from_le_bytes(data[offset..offset + 2].try_into().ok()?) as usize;
        offset += 2;
        if offset + symbol_len > data.len() { return None; }
        let symbol = core::str::from_utf8(&data[offset..offset + symbol_len]).ok()?.to_string();
        offset += symbol_len;

        let desc_len = u16::from_le_bytes(data[offset..offset + 2].try_into().ok()?) as usize;
        offset += 2;
        if offset + desc_len > data.len() { return None; }
        let description = core::str::from_utf8(&data[offset..offset + desc_len]).ok()?.to_string();
        offset += desc_len;

        if offset + 16 > data.len() { return None; }
        let max_supply = u128::from_le_bytes(data[offset..offset + 16].try_into().ok()?);

        Some(TokenInfo {
            name,
            symbol,
            decimals,
            description,
            max_supply,
        })
    }
}

/// Build a transaction to create a token info cell.
/// Links metadata to the token via the type script args containing the token_type_hash.
pub fn create_token_info(
    xudt_config: &XudtConfig,
    token_type_hash: [u8; 32],
    info: &TokenInfo,
    issuer_lock: super::Script,
    issuer_input: super::CellInput,
) -> super::UnsignedTransaction {
    let info_data = info.serialize();

    // Info cell uses a unique type script so it can be discovered by indexer
    // Type args = token_type_hash for linking
    let info_output = super::CellOutput {
        capacity: TOKEN_INFO_CELL_CAPACITY,
        lock_script: issuer_lock,
        type_script: Some(super::Script {
            code_hash: xudt_config.xudt_code_hash,
            hash_type: xudt_config.xudt_hash_type.clone(),
            // Embed token_type_hash so indexers can link info to token
            args: token_type_hash.to_vec(),
        }),
        data: info_data,
    };

    super::UnsignedTransaction {
        cell_deps: vec![super::CellDep {
            tx_hash: xudt_config.xudt_cell_dep_tx_hash,
            index: xudt_config.xudt_cell_dep_index,
            dep_type: xudt_config.xudt_cell_dep_type.clone(),
        }],
        inputs: vec![issuer_input],
        outputs: vec![info_output],
        witnesses: vec![vec![]],
    }
}

// ============ Utility Functions ============

/// Parse token amount from xUDT cell data (first 16 bytes, little-endian u128)
pub fn parse_token_amount(cell_data: &[u8]) -> Option<u128> {
    if cell_data.len() < 16 {
        return None;
    }
    Some(u128::from_le_bytes(cell_data[0..16].try_into().ok()?))
}

/// Build xUDT type script args from issuer lock script hash
pub fn build_xudt_args(issuer_lock_hash: &[u8; 32]) -> Vec<u8> {
    let mut args = Vec::with_capacity(36);
    args.extend_from_slice(issuer_lock_hash);
    args.extend_from_slice(&XUDT_FLAGS_PLAIN);
    args
}

/// Compute the token_type_hash from an xUDT type script.
/// This is the 32-byte hash that VibeSwap uses everywhere
/// (CommitCellData.token_type_hash, PoolCellData.token0_type_hash, etc.)
pub fn compute_token_type_hash(
    xudt_code_hash: &[u8; 32],
    hash_type: &super::HashType,
    issuer_lock_hash: &[u8; 32],
) -> [u8; 32] {
    let type_script = super::Script {
        code_hash: *xudt_code_hash,
        hash_type: hash_type.clone(),
        args: build_xudt_args(issuer_lock_hash),
    };
    hash_type_script(&type_script)
}

// ============ Helpers ============

fn hash_script(script: &super::Script) -> [u8; 32] {
    let mut hasher = Sha256::new();
    hasher.update(&script.code_hash);
    hasher.update(&[hash_type_byte(&script.hash_type)]);
    hasher.update(&script.args);
    let result = hasher.finalize();
    let mut hash = [0u8; 32];
    hash.copy_from_slice(&result);
    hash
}

fn hash_type_script(script: &super::Script) -> [u8; 32] {
    // CKB type script hash = blake2b(code_hash || hash_type || args)
    // We use SHA-256 here since blake2b requires C compiler dep.
    // In production, this should use CKB's blake2b with personalization.
    hash_script(script)
}

fn hash_type_byte(ht: &super::HashType) -> u8 {
    match ht {
        super::HashType::Data => 0,
        super::HashType::Type => 1,
        super::HashType::Data1 => 2,
        super::HashType::Data2 => 4,
    }
}

// ============ Tests ============

#[cfg(test)]
mod tests {
    use super::*;

    fn test_xudt_config() -> XudtConfig {
        XudtConfig {
            xudt_code_hash: [0xAA; 32],
            xudt_hash_type: super::super::HashType::Data1,
            xudt_cell_dep_tx_hash: [0xBB; 32],
            xudt_cell_dep_index: 0,
            xudt_cell_dep_type: super::super::DepType::Code,
        }
    }

    fn test_lock(id: u8) -> super::super::Script {
        super::super::Script {
            code_hash: [id; 32],
            hash_type: super::super::HashType::Type,
            args: vec![id; 20],
        }
    }

    fn test_input(id: u8) -> super::super::CellInput {
        super::super::CellInput {
            tx_hash: [id; 32],
            index: 0,
            since: 0,
        }
    }

    // ============ Mint Tests ============

    #[test]
    fn test_mint_token_creates_valid_cell() {
        let config = test_xudt_config();
        let issuer = test_lock(0x01);
        let recipient = test_lock(0x02);
        let amount: u128 = 1_000_000_000_000_000_000_000; // 1000 tokens (18 decimals)

        let (tx, token_type_hash) = mint_token(
            &config,
            issuer,
            recipient,
            amount,
            test_input(0x50),
        );

        assert_eq!(tx.inputs.len(), 1);
        assert_eq!(tx.outputs.len(), 1);
        assert!(tx.outputs[0].type_script.is_some());

        // Verify amount in cell data
        let parsed = parse_token_amount(&tx.outputs[0].data).unwrap();
        assert_eq!(parsed, amount);

        // Token type hash should be non-zero
        assert_ne!(token_type_hash, [0u8; 32]);

        // Type script args should be 36 bytes (32 lock_hash + 4 flags)
        let type_script = tx.outputs[0].type_script.as_ref().unwrap();
        assert_eq!(type_script.args.len(), 36);
        assert_eq!(&type_script.args[32..], &XUDT_FLAGS_PLAIN);
    }

    #[test]
    fn test_mint_token_type_hash_deterministic() {
        let config = test_xudt_config();
        let issuer = test_lock(0x01);

        let (_, hash1) = mint_token(&config, issuer.clone(), test_lock(0x02), 100, test_input(0x50));
        let (_, hash2) = mint_token(&config, issuer, test_lock(0x03), 200, test_input(0x51));

        // Same issuer = same token_type_hash regardless of recipient/amount
        assert_eq!(hash1, hash2);
    }

    #[test]
    fn test_mint_different_issuers_different_tokens() {
        let config = test_xudt_config();

        let (_, hash1) = mint_token(&config, test_lock(0x01), test_lock(0x02), 100, test_input(0x50));
        let (_, hash2) = mint_token(&config, test_lock(0x03), test_lock(0x02), 100, test_input(0x51));

        // Different issuers = different tokens
        assert_ne!(hash1, hash2);
    }

    // ============ Batch Mint Tests ============

    #[test]
    fn test_mint_batch_multiple_recipients() {
        let config = test_xudt_config();
        let issuer = test_lock(0x01);

        let recipients = vec![
            (test_lock(0x02), 1000_u128),
            (test_lock(0x03), 2000),
            (test_lock(0x04), 3000),
        ];

        let (tx, token_type_hash) = mint_batch(&config, issuer, &recipients, test_input(0x50));

        assert_eq!(tx.outputs.len(), 3);
        assert_ne!(token_type_hash, [0u8; 32]);

        // Verify each output has correct amount
        for (i, (_, expected_amount)) in recipients.iter().enumerate() {
            let parsed = parse_token_amount(&tx.outputs[i].data).unwrap();
            assert_eq!(parsed, *expected_amount);
        }
    }

    // ============ Transfer Tests ============

    #[test]
    fn test_transfer_with_change() {
        let config = test_xudt_config();
        let type_script = super::super::Script {
            code_hash: config.xudt_code_hash,
            hash_type: config.xudt_hash_type.clone(),
            args: build_xudt_args(&[0x01; 32]),
        };

        let tx = transfer_token(
            &config,
            type_script,
            test_lock(0x01),
            test_lock(0x02),
            700, // transfer 700
            vec![(test_input(0x50), 1000)], // have 1000
        ).unwrap();

        assert_eq!(tx.outputs.len(), 2); // recipient + change

        let recipient_amount = parse_token_amount(&tx.outputs[0].data).unwrap();
        assert_eq!(recipient_amount, 700);

        let change_amount = parse_token_amount(&tx.outputs[1].data).unwrap();
        assert_eq!(change_amount, 300);
    }

    #[test]
    fn test_transfer_exact_amount_no_change() {
        let config = test_xudt_config();
        let type_script = super::super::Script {
            code_hash: config.xudt_code_hash,
            hash_type: config.xudt_hash_type.clone(),
            args: build_xudt_args(&[0x01; 32]),
        };

        let tx = transfer_token(
            &config,
            type_script,
            test_lock(0x01),
            test_lock(0x02),
            1000,
            vec![(test_input(0x50), 1000)],
        ).unwrap();

        assert_eq!(tx.outputs.len(), 1); // No change cell
    }

    #[test]
    fn test_transfer_multiple_inputs() {
        let config = test_xudt_config();
        let type_script = super::super::Script {
            code_hash: config.xudt_code_hash,
            hash_type: config.xudt_hash_type.clone(),
            args: build_xudt_args(&[0x01; 32]),
        };

        let tx = transfer_token(
            &config,
            type_script,
            test_lock(0x01),
            test_lock(0x02),
            1500,
            vec![
                (test_input(0x50), 800),
                (test_input(0x51), 900),
            ],
        ).unwrap();

        assert_eq!(tx.inputs.len(), 2);
        assert_eq!(tx.outputs.len(), 2); // recipient + change

        let recipient = parse_token_amount(&tx.outputs[0].data).unwrap();
        assert_eq!(recipient, 1500);

        let change = parse_token_amount(&tx.outputs[1].data).unwrap();
        assert_eq!(change, 200); // 800 + 900 - 1500
    }

    #[test]
    fn test_transfer_insufficient_balance() {
        let config = test_xudt_config();
        let type_script = super::super::Script {
            code_hash: config.xudt_code_hash,
            hash_type: config.xudt_hash_type.clone(),
            args: build_xudt_args(&[0x01; 32]),
        };

        let result = transfer_token(
            &config,
            type_script,
            test_lock(0x01),
            test_lock(0x02),
            2000, // want 2000
            vec![(test_input(0x50), 1000)], // only have 1000
        );

        assert_eq!(result.unwrap_err(), super::super::SDKError::InvalidAmounts);
    }

    // ============ Burn Tests ============

    #[test]
    fn test_burn_partial() {
        let config = test_xudt_config();
        let type_script = super::super::Script {
            code_hash: config.xudt_code_hash,
            hash_type: config.xudt_hash_type.clone(),
            args: build_xudt_args(&[0x01; 32]),
        };

        let tx = burn_token(
            &config,
            type_script,
            300,
            test_lock(0x01),
            vec![(test_input(0x50), 1000)],
        ).unwrap();

        assert_eq!(tx.outputs.len(), 1); // Remaining tokens
        let remaining = parse_token_amount(&tx.outputs[0].data).unwrap();
        assert_eq!(remaining, 700);
    }

    #[test]
    fn test_burn_all() {
        let config = test_xudt_config();
        let type_script = super::super::Script {
            code_hash: config.xudt_code_hash,
            hash_type: config.xudt_hash_type.clone(),
            args: build_xudt_args(&[0x01; 32]),
        };

        let tx = burn_token(
            &config,
            type_script,
            1000,
            test_lock(0x01),
            vec![(test_input(0x50), 1000)],
        ).unwrap();

        assert_eq!(tx.outputs.len(), 0); // All burned, no output cells
    }

    #[test]
    fn test_burn_insufficient() {
        let config = test_xudt_config();
        let type_script = super::super::Script {
            code_hash: config.xudt_code_hash,
            hash_type: config.xudt_hash_type.clone(),
            args: build_xudt_args(&[0x01; 32]),
        };

        let result = burn_token(
            &config,
            type_script,
            2000,
            test_lock(0x01),
            vec![(test_input(0x50), 1000)],
        );

        assert_eq!(result.unwrap_err(), super::super::SDKError::InvalidAmounts);
    }

    // ============ Token Info Tests ============

    #[test]
    fn test_token_info_roundtrip() {
        let info = TokenInfo {
            name: "VibeSwap Token".to_string(),
            symbol: "VIBE".to_string(),
            decimals: 18,
            description: "Governance token for VibeSwap DEX".to_string(),
            max_supply: 1_000_000_000_000_000_000_000_000_000, // 1 billion
        };

        let serialized = info.serialize();
        let deserialized = TokenInfo::deserialize(&serialized).unwrap();

        assert_eq!(deserialized.name, "VibeSwap Token");
        assert_eq!(deserialized.symbol, "VIBE");
        assert_eq!(deserialized.decimals, 18);
        assert_eq!(deserialized.description, "Governance token for VibeSwap DEX");
        assert_eq!(deserialized.max_supply, info.max_supply);
    }

    #[test]
    fn test_token_info_empty_strings() {
        let info = TokenInfo {
            name: String::new(),
            symbol: String::new(),
            decimals: 0,
            description: String::new(),
            max_supply: 0,
        };

        let serialized = info.serialize();
        let deserialized = TokenInfo::deserialize(&serialized).unwrap();

        assert_eq!(deserialized.name, "");
        assert_eq!(deserialized.symbol, "");
        assert_eq!(deserialized.decimals, 0);
        assert_eq!(deserialized.max_supply, 0);
    }

    #[test]
    fn test_token_info_unicode() {
        let info = TokenInfo {
            name: "Nervos CKByte".to_string(),
            symbol: "CKB".to_string(),
            decimals: 8,
            description: "Native token of Nervos Network".to_string(),
            max_supply: 0, // Unlimited
        };

        let serialized = info.serialize();
        let deserialized = TokenInfo::deserialize(&serialized).unwrap();
        assert_eq!(deserialized.name, "Nervos CKByte");
        assert_eq!(deserialized.symbol, "CKB");
    }

    #[test]
    fn test_token_info_deserialize_too_short() {
        assert!(TokenInfo::deserialize(&[0u8; 5]).is_none());
        assert!(TokenInfo::deserialize(&[]).is_none());
    }

    #[test]
    fn test_create_token_info_tx() {
        let config = test_xudt_config();
        let token_type_hash = [0x42; 32];
        let info = TokenInfo {
            name: "Test Token".to_string(),
            symbol: "TEST".to_string(),
            decimals: 18,
            description: "A test token".to_string(),
            max_supply: 0,
        };

        let tx = create_token_info(
            &config,
            token_type_hash,
            &info,
            test_lock(0x01),
            test_input(0x50),
        );

        assert_eq!(tx.inputs.len(), 1);
        assert_eq!(tx.outputs.len(), 1);
        assert_eq!(tx.outputs[0].capacity, TOKEN_INFO_CELL_CAPACITY);

        // Info cell data should be parseable
        let parsed = TokenInfo::deserialize(&tx.outputs[0].data).unwrap();
        assert_eq!(parsed.name, "Test Token");
        assert_eq!(parsed.symbol, "TEST");
    }

    // ============ Utility Tests ============

    #[test]
    fn test_parse_token_amount() {
        let amount: u128 = 42_000_000_000_000_000_000;
        let data = amount.to_le_bytes().to_vec();
        assert_eq!(parse_token_amount(&data), Some(amount));
    }

    #[test]
    fn test_parse_token_amount_with_extra_data() {
        let amount: u128 = 100;
        let mut data = amount.to_le_bytes().to_vec();
        data.extend_from_slice(&[0xFF; 32]); // Extra xUDT extension data
        assert_eq!(parse_token_amount(&data), Some(amount));
    }

    #[test]
    fn test_parse_token_amount_too_short() {
        assert_eq!(parse_token_amount(&[0u8; 15]), None);
        assert_eq!(parse_token_amount(&[]), None);
    }

    #[test]
    fn test_build_xudt_args() {
        let lock_hash = [0x42; 32];
        let args = build_xudt_args(&lock_hash);
        assert_eq!(args.len(), 36);
        assert_eq!(&args[0..32], &lock_hash);
        assert_eq!(&args[32..36], &XUDT_FLAGS_PLAIN);
    }

    #[test]
    fn test_compute_token_type_hash_deterministic() {
        let code_hash = [0xAA; 32];
        let lock_hash = [0x01; 32];

        let h1 = compute_token_type_hash(&code_hash, &super::super::HashType::Data1, &lock_hash);
        let h2 = compute_token_type_hash(&code_hash, &super::super::HashType::Data1, &lock_hash);
        assert_eq!(h1, h2);
    }

    #[test]
    fn test_compute_token_type_hash_different_issuers() {
        let code_hash = [0xAA; 32];
        let h1 = compute_token_type_hash(&code_hash, &super::super::HashType::Data1, &[0x01; 32]);
        let h2 = compute_token_type_hash(&code_hash, &super::super::HashType::Data1, &[0x02; 32]);
        assert_ne!(h1, h2);
    }

    // ============ Integration: Mint + Transfer ============

    #[test]
    fn test_mint_then_transfer_workflow() {
        let config = test_xudt_config();
        let issuer = test_lock(0x01);
        let alice = test_lock(0x02);
        let bob = test_lock(0x03);

        // Step 1: Issuer mints 10000 tokens to Alice
        let (mint_tx, token_type_hash) = mint_token(
            &config,
            issuer,
            alice.clone(),
            10000,
            test_input(0x50),
        );

        let minted_amount = parse_token_amount(&mint_tx.outputs[0].data).unwrap();
        assert_eq!(minted_amount, 10000);

        // Step 2: Alice transfers 3000 to Bob
        let type_script = mint_tx.outputs[0].type_script.clone().unwrap();
        let transfer_tx = transfer_token(
            &config,
            type_script,
            alice,
            bob,
            3000,
            vec![(test_input(0x60), 10000)], // Alice's cell from mint
        ).unwrap();

        let bob_amount = parse_token_amount(&transfer_tx.outputs[0].data).unwrap();
        let alice_change = parse_token_amount(&transfer_tx.outputs[1].data).unwrap();
        assert_eq!(bob_amount, 3000);
        assert_eq!(alice_change, 7000);

        // Token type hash is consistent throughout
        assert_ne!(token_type_hash, [0u8; 32]);
    }

    // ============ Edge Case: Zero & Boundary Values ============

    #[test]
    fn test_mint_zero_amount() {
        let config = test_xudt_config();
        let (tx, token_type_hash) = mint_token(
            &config,
            test_lock(0x01),
            test_lock(0x02),
            0, // zero amount mint
            test_input(0x50),
        );

        // Should succeed — on-chain validation handles rules, SDK just builds tx
        assert_eq!(tx.outputs.len(), 1);
        let parsed = parse_token_amount(&tx.outputs[0].data).unwrap();
        assert_eq!(parsed, 0);
        assert_ne!(token_type_hash, [0u8; 32]);
    }

    #[test]
    fn test_mint_u128_max() {
        let config = test_xudt_config();
        let max_amount = u128::MAX;
        let (tx, _) = mint_token(
            &config,
            test_lock(0x01),
            test_lock(0x02),
            max_amount,
            test_input(0x50),
        );

        let parsed = parse_token_amount(&tx.outputs[0].data).unwrap();
        assert_eq!(parsed, u128::MAX);
        assert_eq!(tx.outputs[0].data.len(), 16);
    }

    #[test]
    fn test_transfer_zero_amount() {
        let config = test_xudt_config();
        let type_script = super::super::Script {
            code_hash: config.xudt_code_hash,
            hash_type: config.xudt_hash_type.clone(),
            args: build_xudt_args(&[0x01; 32]),
        };

        // Transfer 0 tokens — should succeed, all input becomes change
        let tx = transfer_token(
            &config,
            type_script,
            test_lock(0x01),
            test_lock(0x02),
            0,
            vec![(test_input(0x50), 5000)],
        ).unwrap();

        // Recipient gets 0
        let recipient_amount = parse_token_amount(&tx.outputs[0].data).unwrap();
        assert_eq!(recipient_amount, 0);

        // Change cell gets full balance back
        assert_eq!(tx.outputs.len(), 2);
        let change_amount = parse_token_amount(&tx.outputs[1].data).unwrap();
        assert_eq!(change_amount, 5000);
    }

    #[test]
    fn test_burn_zero_amount() {
        let config = test_xudt_config();
        let type_script = super::super::Script {
            code_hash: config.xudt_code_hash,
            hash_type: config.xudt_hash_type.clone(),
            args: build_xudt_args(&[0x01; 32]),
        };

        // Burn 0 — all tokens remain as change
        let tx = burn_token(
            &config,
            type_script,
            0,
            test_lock(0x01),
            vec![(test_input(0x50), 1000)],
        ).unwrap();

        assert_eq!(tx.outputs.len(), 1);
        let remaining = parse_token_amount(&tx.outputs[0].data).unwrap();
        assert_eq!(remaining, 1000);
    }

    // ============ Edge Case: Empty & Boundary Inputs ============

    #[test]
    fn test_mint_batch_empty_recipients() {
        let config = test_xudt_config();
        let recipients: Vec<(super::super::Script, u128)> = vec![];
        let (tx, token_type_hash) = mint_batch(
            &config,
            test_lock(0x01),
            &recipients,
            test_input(0x50),
        );

        // Empty batch: no outputs, but tx is structurally valid
        assert_eq!(tx.outputs.len(), 0);
        assert_eq!(tx.inputs.len(), 1);
        // witnesses.len() = max(0, 1) = 1
        assert_eq!(tx.witnesses.len(), 1);
        assert_ne!(token_type_hash, [0u8; 32]);
    }

    #[test]
    fn test_mint_batch_single_recipient() {
        let config = test_xudt_config();
        let recipients = vec![(test_lock(0x02), 42_000_u128)];
        let (tx, hash_batch) = mint_batch(
            &config,
            test_lock(0x01),
            &recipients,
            test_input(0x50),
        );

        // Single recipient batch should match single mint token_type_hash
        let (_, hash_single) = mint_token(
            &config,
            test_lock(0x01),
            test_lock(0x02),
            42_000,
            test_input(0x51),
        );
        assert_eq!(hash_batch, hash_single);

        assert_eq!(tx.outputs.len(), 1);
        let parsed = parse_token_amount(&tx.outputs[0].data).unwrap();
        assert_eq!(parsed, 42_000);
    }

    // ============ Error Path: Transfer Exactly One Short ============

    #[test]
    fn test_transfer_one_short_of_balance() {
        let config = test_xudt_config();
        let type_script = super::super::Script {
            code_hash: config.xudt_code_hash,
            hash_type: config.xudt_hash_type.clone(),
            args: build_xudt_args(&[0x01; 32]),
        };

        // Transfer 999 out of 1000 — should succeed with 1 change
        let tx = transfer_token(
            &config,
            type_script,
            test_lock(0x01),
            test_lock(0x02),
            999,
            vec![(test_input(0x50), 1000)],
        ).unwrap();

        assert_eq!(tx.outputs.len(), 2);
        assert_eq!(parse_token_amount(&tx.outputs[0].data).unwrap(), 999);
        assert_eq!(parse_token_amount(&tx.outputs[1].data).unwrap(), 1);
    }

    #[test]
    fn test_burn_from_multiple_inputs() {
        let config = test_xudt_config();
        let type_script = super::super::Script {
            code_hash: config.xudt_code_hash,
            hash_type: config.xudt_hash_type.clone(),
            args: build_xudt_args(&[0x01; 32]),
        };

        // Burn 1500 across three input cells (500 + 600 + 700 = 1800)
        let tx = burn_token(
            &config,
            type_script,
            1500,
            test_lock(0x01),
            vec![
                (test_input(0x50), 500),
                (test_input(0x51), 600),
                (test_input(0x52), 700),
            ],
        ).unwrap();

        assert_eq!(tx.inputs.len(), 3);
        assert_eq!(tx.witnesses.len(), 3);
        assert_eq!(tx.outputs.len(), 1); // 300 remaining
        assert_eq!(parse_token_amount(&tx.outputs[0].data).unwrap(), 300);
    }

    // ============ Token Info Edge Cases ============

    #[test]
    fn test_token_info_max_decimals() {
        let info = TokenInfo {
            name: "Precision Token".to_string(),
            symbol: "PREC".to_string(),
            decimals: 255, // u8::MAX
            description: "A token with maximum decimal places".to_string(),
            max_supply: u128::MAX,
        };

        let serialized = info.serialize();
        let deserialized = TokenInfo::deserialize(&serialized).unwrap();

        assert_eq!(deserialized.decimals, 255);
        assert_eq!(deserialized.max_supply, u128::MAX);
        assert_eq!(deserialized.name, "Precision Token");
        assert_eq!(deserialized.symbol, "PREC");
    }

    #[test]
    fn test_token_info_truncated_data_rejects() {
        // Build valid data then truncate at various points
        let info = TokenInfo {
            name: "Test".to_string(),
            symbol: "TST".to_string(),
            decimals: 18,
            description: "Description".to_string(),
            max_supply: 1000,
        };
        let full = info.serialize();

        // Truncate before max_supply (cut off last 16 bytes)
        let truncated = &full[..full.len() - 16];
        assert!(TokenInfo::deserialize(truncated).is_none());

        // Truncate mid-description (cut after symbol but partway through desc)
        // 1 (decimals) + 2 (name_len) + 4 (name) + 2 (symbol_len) + 3 (symbol) + 2 (desc_len) = 14
        // Then desc is "Description" (11 bytes), we cut at 5 bytes into it
        let mid_cut = &full[..19]; // 14 + 5
        assert!(TokenInfo::deserialize(mid_cut).is_none());
    }

    // ============ Integration: Mint-Transfer-Burn Chain ============

    #[test]
    fn test_mint_transfer_burn_chain() {
        let config = test_xudt_config();
        let issuer = test_lock(0x10);
        let alice = test_lock(0x20);
        let bob = test_lock(0x30);

        // 1. Issuer mints 50_000 tokens to Alice
        let (mint_tx, _token_type_hash) = mint_token(
            &config,
            issuer.clone(),
            alice.clone(),
            50_000,
            test_input(0xA0),
        );
        let type_script = mint_tx.outputs[0].type_script.clone().unwrap();
        let alice_balance = parse_token_amount(&mint_tx.outputs[0].data).unwrap();
        assert_eq!(alice_balance, 50_000);

        // 2. Alice transfers 20_000 to Bob (keeps 30_000)
        let transfer_tx = transfer_token(
            &config,
            type_script.clone(),
            alice.clone(),
            bob.clone(),
            20_000,
            vec![(test_input(0xA1), 50_000)],
        ).unwrap();
        let bob_balance = parse_token_amount(&transfer_tx.outputs[0].data).unwrap();
        let alice_remaining = parse_token_amount(&transfer_tx.outputs[1].data).unwrap();
        assert_eq!(bob_balance, 20_000);
        assert_eq!(alice_remaining, 30_000);

        // 3. Bob transfers 5_000 back to Alice (keeps 15_000)
        let transfer_tx2 = transfer_token(
            &config,
            type_script.clone(),
            bob.clone(),
            alice.clone(),
            5_000,
            vec![(test_input(0xA2), 20_000)],
        ).unwrap();
        let alice_received = parse_token_amount(&transfer_tx2.outputs[0].data).unwrap();
        let bob_remaining = parse_token_amount(&transfer_tx2.outputs[1].data).unwrap();
        assert_eq!(alice_received, 5_000);
        assert_eq!(bob_remaining, 15_000);

        // 4. Issuer burns 10_000 from their own cells
        // (In practice issuer would need owner-mode cells; SDK just builds the tx)
        let burn_tx = burn_token(
            &config,
            type_script.clone(),
            10_000,
            issuer,
            vec![(test_input(0xA3), 10_000)],
        ).unwrap();
        assert_eq!(burn_tx.outputs.len(), 0); // All burned

        // Verify conservation: Alice has 30k+5k=35k, Bob has 15k, burned 10k
        // But these are separate UTXO cells; verify the chain of values is consistent
        assert_eq!(alice_remaining + alice_received, 35_000);
        assert_eq!(bob_remaining, 15_000);
    }

    // ============ Integration: Full Lifecycle ============

    #[test]
    fn test_full_token_lifecycle() {
        let config = test_xudt_config();
        let issuer = test_lock(0x01);

        // 1. Mint
        let (_, token_type_hash) = mint_token(
            &config,
            issuer.clone(),
            test_lock(0x02),
            1_000_000,
            test_input(0x50),
        );

        // 2. Create info cell
        let info = TokenInfo {
            name: "Test".to_string(),
            symbol: "TST".to_string(),
            decimals: 18,
            description: "Test token".to_string(),
            max_supply: 1_000_000,
        };
        let info_tx = create_token_info(
            &config,
            token_type_hash,
            &info,
            issuer.clone(),
            test_input(0x51),
        );
        let parsed_info = TokenInfo::deserialize(&info_tx.outputs[0].data).unwrap();
        assert_eq!(parsed_info.name, "Test");

        // 3. Transfer
        let type_script = super::super::Script {
            code_hash: config.xudt_code_hash,
            hash_type: config.xudt_hash_type.clone(),
            args: build_xudt_args(&hash_script(&issuer)),
        };
        let transfer_tx = transfer_token(
            &config,
            type_script.clone(),
            test_lock(0x02),
            test_lock(0x03),
            500_000,
            vec![(test_input(0x60), 1_000_000)],
        ).unwrap();
        assert_eq!(parse_token_amount(&transfer_tx.outputs[0].data).unwrap(), 500_000);

        // 4. Burn
        let burn_tx = burn_token(
            &config,
            type_script,
            200_000,
            issuer,
            vec![(test_input(0x70), 500_000)],
        ).unwrap();
        assert_eq!(parse_token_amount(&burn_tx.outputs[0].data).unwrap(), 300_000);
    }

    // ============ Additional Edge Case & Coverage Tests ============

    #[test]
    fn test_mint_token_cell_dep_matches_config() {
        let config = test_xudt_config();
        let (tx, _) = mint_token(
            &config,
            test_lock(0x01),
            test_lock(0x02),
            1000,
            test_input(0x50),
        );

        assert_eq!(tx.cell_deps.len(), 1);
        assert_eq!(tx.cell_deps[0].tx_hash, config.xudt_cell_dep_tx_hash);
        assert_eq!(tx.cell_deps[0].index, config.xudt_cell_dep_index);
    }

    #[test]
    fn test_mint_token_witness_count_matches_inputs() {
        let config = test_xudt_config();
        let (tx, _) = mint_token(
            &config,
            test_lock(0x01),
            test_lock(0x02),
            5000,
            test_input(0x50),
        );

        assert_eq!(tx.witnesses.len(), 1);
        assert_eq!(tx.witnesses.len(), tx.inputs.len());
    }

    #[test]
    fn test_mint_token_recipient_lock_in_output() {
        let config = test_xudt_config();
        let recipient = test_lock(0x02);
        let (tx, _) = mint_token(
            &config,
            test_lock(0x01),
            recipient.clone(),
            1000,
            test_input(0x50),
        );

        // Recipient lock script should be on the output cell
        assert_eq!(tx.outputs[0].lock_script.code_hash, recipient.code_hash);
        assert_eq!(tx.outputs[0].lock_script.args, recipient.args);
    }

    #[test]
    fn test_mint_token_output_capacity() {
        let config = test_xudt_config();
        let (tx, _) = mint_token(
            &config,
            test_lock(0x01),
            test_lock(0x02),
            1000,
            test_input(0x50),
        );

        assert_eq!(tx.outputs[0].capacity, TOKEN_CELL_CAPACITY);
    }

    #[test]
    fn test_mint_batch_witnesses_match_outputs() {
        let config = test_xudt_config();
        let recipients = vec![
            (test_lock(0x02), 100_u128),
            (test_lock(0x03), 200),
            (test_lock(0x04), 300),
            (test_lock(0x05), 400),
        ];

        let (tx, _) = mint_batch(&config, test_lock(0x01), &recipients, test_input(0x50));

        // witnesses.len() = max(outputs.len(), 1) = 4
        assert_eq!(tx.witnesses.len(), 4);
        assert_eq!(tx.outputs.len(), 4);
    }

    #[test]
    fn test_mint_batch_all_outputs_have_same_type_script() {
        let config = test_xudt_config();
        let recipients = vec![
            (test_lock(0x02), 1000_u128),
            (test_lock(0x03), 2000),
        ];

        let (tx, _) = mint_batch(&config, test_lock(0x01), &recipients, test_input(0x50));

        let type0 = tx.outputs[0].type_script.as_ref().unwrap();
        let type1 = tx.outputs[1].type_script.as_ref().unwrap();
        assert_eq!(type0.code_hash, type1.code_hash);
        assert_eq!(type0.args, type1.args);
    }

    #[test]
    fn test_transfer_cell_dep_from_config() {
        let config = test_xudt_config();
        let type_script = super::super::Script {
            code_hash: config.xudt_code_hash,
            hash_type: config.xudt_hash_type.clone(),
            args: build_xudt_args(&[0x01; 32]),
        };

        let tx = transfer_token(
            &config,
            type_script,
            test_lock(0x01),
            test_lock(0x02),
            500,
            vec![(test_input(0x50), 1000)],
        ).unwrap();

        assert_eq!(tx.cell_deps.len(), 1);
        assert_eq!(tx.cell_deps[0].tx_hash, config.xudt_cell_dep_tx_hash);
    }

    #[test]
    fn test_transfer_three_inputs_exact_sum() {
        let config = test_xudt_config();
        let type_script = super::super::Script {
            code_hash: config.xudt_code_hash,
            hash_type: config.xudt_hash_type.clone(),
            args: build_xudt_args(&[0x01; 32]),
        };

        // Three inputs summing to exactly the transfer amount
        let tx = transfer_token(
            &config,
            type_script,
            test_lock(0x01),
            test_lock(0x02),
            600,
            vec![
                (test_input(0x50), 200),
                (test_input(0x51), 200),
                (test_input(0x52), 200),
            ],
        ).unwrap();

        assert_eq!(tx.inputs.len(), 3);
        assert_eq!(tx.outputs.len(), 1); // No change cell — exact amount
        assert_eq!(parse_token_amount(&tx.outputs[0].data).unwrap(), 600);
    }

    #[test]
    fn test_burn_multiple_inputs_exact_burn() {
        let config = test_xudt_config();
        let type_script = super::super::Script {
            code_hash: config.xudt_code_hash,
            hash_type: config.xudt_hash_type.clone(),
            args: build_xudt_args(&[0x01; 32]),
        };

        // Burn exactly the total of two inputs — no remainder
        let tx = burn_token(
            &config,
            type_script,
            1500,
            test_lock(0x01),
            vec![
                (test_input(0x50), 750),
                (test_input(0x51), 750),
            ],
        ).unwrap();

        assert_eq!(tx.outputs.len(), 0); // All burned
        assert_eq!(tx.inputs.len(), 2);
    }

    #[test]
    fn test_parse_token_amount_exactly_16_bytes() {
        let amount: u128 = 999_999_999;
        let data = amount.to_le_bytes().to_vec();
        assert_eq!(data.len(), 16);
        assert_eq!(parse_token_amount(&data), Some(amount));
    }

    #[test]
    fn test_parse_token_amount_zero() {
        let data = 0u128.to_le_bytes().to_vec();
        assert_eq!(parse_token_amount(&data), Some(0));
    }

    #[test]
    fn test_parse_token_amount_u128_max() {
        let data = u128::MAX.to_le_bytes().to_vec();
        assert_eq!(parse_token_amount(&data), Some(u128::MAX));
    }

    #[test]
    fn test_build_xudt_args_different_lock_hashes() {
        let args1 = build_xudt_args(&[0x01; 32]);
        let args2 = build_xudt_args(&[0x02; 32]);

        // Same length but different lock hash prefix
        assert_eq!(args1.len(), args2.len());
        assert_ne!(&args1[0..32], &args2[0..32]);
        // Same flags suffix
        assert_eq!(&args1[32..36], &args2[32..36]);
    }

    #[test]
    fn test_compute_token_type_hash_different_hash_types() {
        let code_hash = [0xAA; 32];
        let lock_hash = [0x01; 32];

        let h_data1 = compute_token_type_hash(&code_hash, &super::super::HashType::Data1, &lock_hash);
        let h_type = compute_token_type_hash(&code_hash, &super::super::HashType::Type, &lock_hash);
        let h_data = compute_token_type_hash(&code_hash, &super::super::HashType::Data, &lock_hash);
        let h_data2 = compute_token_type_hash(&code_hash, &super::super::HashType::Data2, &lock_hash);

        // Different hash types should produce different token type hashes
        assert_ne!(h_data1, h_type);
        assert_ne!(h_data1, h_data);
        assert_ne!(h_data1, h_data2);
        assert_ne!(h_type, h_data);
    }

    #[test]
    fn test_token_info_long_strings() {
        let info = TokenInfo {
            name: "A".repeat(1000),
            symbol: "B".repeat(500),
            decimals: 18,
            description: "C".repeat(2000),
            max_supply: 42,
        };

        let serialized = info.serialize();
        let deserialized = TokenInfo::deserialize(&serialized).unwrap();

        assert_eq!(deserialized.name.len(), 1000);
        assert_eq!(deserialized.symbol.len(), 500);
        assert_eq!(deserialized.description.len(), 2000);
        assert_eq!(deserialized.max_supply, 42);
    }

    #[test]
    fn test_token_info_deserialize_corrupt_name_length() {
        // Create data where name_len claims more bytes than available
        let mut data = vec![18u8]; // decimals
        data.extend_from_slice(&(9999u16).to_le_bytes()); // name_len = 9999 (way too long)
        data.extend_from_slice(&[0u8; 20]); // only 20 bytes available
        assert!(TokenInfo::deserialize(&data).is_none());
    }

    #[test]
    fn test_token_info_deserialize_corrupt_symbol_length() {
        // Valid decimals + name, but symbol_len overflows
        let mut data = vec![18u8]; // decimals
        data.extend_from_slice(&(2u16).to_le_bytes()); // name_len = 2
        data.extend_from_slice(b"OK"); // name
        data.extend_from_slice(&(50000u16).to_le_bytes()); // symbol_len too large
        data.extend_from_slice(&[0u8; 10]); // insufficient data
        assert!(TokenInfo::deserialize(&data).is_none());
    }

    // ============ New Edge Case & Coverage Tests (Batch 3) ============

    #[test]
    fn test_mint_batch_large_recipient_list() {
        // Batch mint to 10 recipients — verify all outputs are correct
        let config = test_xudt_config();
        let recipients: Vec<(super::super::Script, u128)> = (0..10u8)
            .map(|i| (test_lock(0x10 + i), (i as u128 + 1) * 1000))
            .collect();

        let (tx, _) = mint_batch(&config, test_lock(0x01), &recipients, test_input(0x50));
        assert_eq!(tx.outputs.len(), 10);
        assert_eq!(tx.witnesses.len(), 10);

        for (i, (_, expected_amount)) in recipients.iter().enumerate() {
            let parsed = parse_token_amount(&tx.outputs[i].data).unwrap();
            assert_eq!(parsed, *expected_amount, "Output {} amount mismatch", i);
        }
    }

    #[test]
    fn test_transfer_empty_inputs_fails() {
        // Transfer with no input cells — should fail because total_input (0) < transfer_amount
        let config = test_xudt_config();
        let type_script = super::super::Script {
            code_hash: config.xudt_code_hash,
            hash_type: config.xudt_hash_type.clone(),
            args: build_xudt_args(&[0x01; 32]),
        };

        let result = transfer_token(
            &config,
            type_script,
            test_lock(0x01),
            test_lock(0x02),
            100,
            vec![], // No inputs
        );

        assert_eq!(result.unwrap_err(), super::super::SDKError::InvalidAmounts);
    }

    #[test]
    fn test_burn_empty_inputs_fails() {
        // Burn with no input cells — should fail
        let config = test_xudt_config();
        let type_script = super::super::Script {
            code_hash: config.xudt_code_hash,
            hash_type: config.xudt_hash_type.clone(),
            args: build_xudt_args(&[0x01; 32]),
        };

        let result = burn_token(
            &config,
            type_script,
            100,
            test_lock(0x01),
            vec![], // No inputs
        );

        assert_eq!(result.unwrap_err(), super::super::SDKError::InvalidAmounts);
    }

    #[test]
    fn test_hash_type_byte_all_variants() {
        // Verify hash_type_byte maps all variants to distinct values
        let data = hash_type_byte(&super::super::HashType::Data);
        let type_ = hash_type_byte(&super::super::HashType::Type);
        let data1 = hash_type_byte(&super::super::HashType::Data1);
        let data2 = hash_type_byte(&super::super::HashType::Data2);

        assert_eq!(data, 0);
        assert_eq!(type_, 1);
        assert_eq!(data1, 2);
        assert_eq!(data2, 4);
        // All must be distinct
        let set: std::collections::HashSet<u8> = [data, type_, data1, data2].iter().copied().collect();
        assert_eq!(set.len(), 4, "All hash type bytes must be distinct");
    }

    #[test]
    fn test_token_info_serialize_deterministic() {
        // Same input should always produce identical serialized bytes
        let info = TokenInfo {
            name: "Token".to_string(),
            symbol: "TKN".to_string(),
            decimals: 8,
            description: "A test token".to_string(),
            max_supply: 1_000_000,
        };

        let bytes1 = info.serialize();
        let bytes2 = info.serialize();
        assert_eq!(bytes1, bytes2, "Serialization must be deterministic");
    }

    #[test]
    fn test_create_token_info_links_to_token_type_hash() {
        // Verify the info cell's type script args contain the token_type_hash
        let config = test_xudt_config();
        let token_type_hash = [0x99; 32];
        let info = TokenInfo {
            name: "Linked".to_string(),
            symbol: "LNK".to_string(),
            decimals: 18,
            description: "Linked to token via type args".to_string(),
            max_supply: 0,
        };

        let tx = create_token_info(&config, token_type_hash, &info, test_lock(0x01), test_input(0x50));

        let output_type = tx.outputs[0].type_script.as_ref().unwrap();
        assert_eq!(output_type.args, token_type_hash.to_vec(),
            "Info cell type script args must contain the token_type_hash");
        assert_eq!(output_type.code_hash, config.xudt_code_hash);
    }

    #[test]
    fn test_mint_token_same_issuer_and_recipient() {
        // Issuer can mint to themselves
        let config = test_xudt_config();
        let self_lock = test_lock(0x01);
        let (tx, token_type_hash) = mint_token(
            &config,
            self_lock.clone(),
            self_lock.clone(),
            5000,
            test_input(0x50),
        );

        assert_eq!(tx.outputs.len(), 1);
        assert_eq!(parse_token_amount(&tx.outputs[0].data).unwrap(), 5000);
        assert_eq!(tx.outputs[0].lock_script.args, self_lock.args);
        assert_ne!(token_type_hash, [0u8; 32]);
    }

    #[test]
    fn test_transfer_u128_max_amount() {
        // Transfer u128::MAX tokens — should succeed if inputs have enough
        let config = test_xudt_config();
        let type_script = super::super::Script {
            code_hash: config.xudt_code_hash,
            hash_type: config.xudt_hash_type.clone(),
            args: build_xudt_args(&[0x01; 32]),
        };

        let tx = transfer_token(
            &config,
            type_script,
            test_lock(0x01),
            test_lock(0x02),
            u128::MAX,
            vec![(test_input(0x50), u128::MAX)],
        ).unwrap();

        assert_eq!(tx.outputs.len(), 1); // No change
        let recipient_amount = parse_token_amount(&tx.outputs[0].data).unwrap();
        assert_eq!(recipient_amount, u128::MAX);
    }

    // ============ New Tests: Coverage Expansion (Batch 4) ============

    #[test]
    fn test_hash_script_deterministic() {
        // Same script must always produce the same hash
        let script = test_lock(0x42);
        let h1 = hash_script(&script);
        let h2 = hash_script(&script);
        assert_eq!(h1, h2, "hash_script must be deterministic");
        assert_ne!(h1, [0u8; 32], "Hash of non-trivial script should not be all zeros");
    }

    #[test]
    fn test_hash_script_different_args_different_hash() {
        let mut script1 = test_lock(0x01);
        let mut script2 = test_lock(0x01);
        script2.args = vec![0x02; 20]; // Different args

        let h1 = hash_script(&script1);
        let h2 = hash_script(&script2);
        assert_ne!(h1, h2, "Different args must produce different script hash");
    }

    #[test]
    fn test_transfer_to_self_sender_equals_recipient() {
        // Transfer tokens to yourself — should work, creates recipient + change cells
        let config = test_xudt_config();
        let type_script = super::super::Script {
            code_hash: config.xudt_code_hash,
            hash_type: config.xudt_hash_type.clone(),
            args: build_xudt_args(&[0x01; 32]),
        };
        let self_lock = test_lock(0x01);

        let tx = transfer_token(
            &config,
            type_script,
            self_lock.clone(),
            self_lock.clone(),
            300,
            vec![(test_input(0x50), 1000)],
        ).unwrap();

        assert_eq!(tx.outputs.len(), 2); // recipient (self) + change (self)
        let recipient_amount = parse_token_amount(&tx.outputs[0].data).unwrap();
        let change_amount = parse_token_amount(&tx.outputs[1].data).unwrap();
        assert_eq!(recipient_amount, 300);
        assert_eq!(change_amount, 700);
        // Both outputs have same lock script
        assert_eq!(tx.outputs[0].lock_script.args, self_lock.args);
        assert_eq!(tx.outputs[1].lock_script.args, self_lock.args);
    }

    #[test]
    fn test_burn_u128_max_amount() {
        // Burn u128::MAX tokens — should succeed if inputs match exactly
        let config = test_xudt_config();
        let type_script = super::super::Script {
            code_hash: config.xudt_code_hash,
            hash_type: config.xudt_hash_type.clone(),
            args: build_xudt_args(&[0x01; 32]),
        };

        let tx = burn_token(
            &config,
            type_script,
            u128::MAX,
            test_lock(0x01),
            vec![(test_input(0x50), u128::MAX)],
        ).unwrap();

        assert_eq!(tx.outputs.len(), 0, "Burning u128::MAX should leave no outputs");
        assert_eq!(tx.inputs.len(), 1);
    }

    #[test]
    fn test_transfer_witnesses_count_matches_inputs() {
        // Verify witness count always matches input count
        let config = test_xudt_config();
        let type_script = super::super::Script {
            code_hash: config.xudt_code_hash,
            hash_type: config.xudt_hash_type.clone(),
            args: build_xudt_args(&[0x01; 32]),
        };

        for num_inputs in [1, 2, 3, 5] {
            let inputs: Vec<(super::super::CellInput, u128)> = (0..num_inputs)
                .map(|i| (test_input(0x50 + i as u8), 1000))
                .collect();

            let tx = transfer_token(
                &config,
                type_script.clone(),
                test_lock(0x01),
                test_lock(0x02),
                100,
                inputs,
            ).unwrap();

            assert_eq!(tx.witnesses.len(), tx.inputs.len(),
                "Witness count must match input count for {} inputs", num_inputs);
        }
    }

    #[test]
    fn test_create_token_info_issuer_lock_on_output() {
        // Verify the info cell output uses the issuer's lock script
        let config = test_xudt_config();
        let issuer = test_lock(0x55);
        let info = TokenInfo {
            name: "Test".to_string(),
            symbol: "T".to_string(),
            decimals: 8,
            description: "".to_string(),
            max_supply: 0,
        };

        let tx = create_token_info(
            &config,
            [0x42; 32],
            &info,
            issuer.clone(),
            test_input(0x50),
        );

        assert_eq!(tx.outputs[0].lock_script.code_hash, issuer.code_hash);
        assert_eq!(tx.outputs[0].lock_script.args, issuer.args);
        assert_eq!(tx.outputs[0].capacity, TOKEN_INFO_CELL_CAPACITY);
    }

    #[test]
    fn test_compute_token_type_hash_all_zero_inputs() {
        // All-zero inputs should still produce a valid non-zero hash
        let h = compute_token_type_hash(
            &[0u8; 32],
            &super::super::HashType::Data,
            &[0u8; 32],
        );
        assert_ne!(h, [0u8; 32], "Hash of all-zero inputs should not be all zeros");
    }

    #[test]
    fn test_token_info_deserialize_invalid_utf8_name() {
        // Create data where the name bytes are invalid UTF-8
        let mut data = vec![18u8]; // decimals
        data.extend_from_slice(&(4u16).to_le_bytes()); // name_len = 4
        data.extend_from_slice(&[0xFF, 0xFE, 0x80, 0x90]); // invalid UTF-8
        data.extend_from_slice(&(2u16).to_le_bytes()); // symbol_len = 2
        data.extend_from_slice(b"OK"); // valid symbol
        data.extend_from_slice(&(0u16).to_le_bytes()); // desc_len = 0
        data.extend_from_slice(&0u128.to_le_bytes()); // max_supply
        assert!(TokenInfo::deserialize(&data).is_none(),
            "Invalid UTF-8 in name should cause deserialization to fail");
    }

    #[test]
    fn test_token_info_deserialize_invalid_utf8_symbol() {
        // Valid name but invalid UTF-8 in symbol
        let mut data = vec![18u8]; // decimals
        data.extend_from_slice(&(2u16).to_le_bytes()); // name_len = 2
        data.extend_from_slice(b"OK"); // valid name
        data.extend_from_slice(&(3u16).to_le_bytes()); // symbol_len = 3
        data.extend_from_slice(&[0xFF, 0xFE, 0x80]); // invalid UTF-8 symbol
        data.extend_from_slice(&(0u16).to_le_bytes()); // desc_len = 0
        data.extend_from_slice(&0u128.to_le_bytes()); // max_supply
        assert!(TokenInfo::deserialize(&data).is_none(),
            "Invalid UTF-8 in symbol should cause deserialization to fail");
    }

    #[test]
    fn test_parse_token_amount_single_byte_returns_none() {
        // Various sizes below 16 bytes should all return None
        for len in 0..16 {
            let data = vec![0xAA; len];
            assert_eq!(parse_token_amount(&data), None,
                "Data of {} bytes should return None", len);
        }
    }

    #[test]
    fn test_mint_batch_all_outputs_capacity_is_token_cell_capacity() {
        // Every output in a batch mint should have TOKEN_CELL_CAPACITY
        let config = test_xudt_config();
        let recipients = vec![
            (test_lock(0x02), 100_u128),
            (test_lock(0x03), 200),
            (test_lock(0x04), 300),
        ];

        let (tx, _) = mint_batch(&config, test_lock(0x01), &recipients, test_input(0x50));

        for (i, output) in tx.outputs.iter().enumerate() {
            assert_eq!(output.capacity, TOKEN_CELL_CAPACITY,
                "Output {} should have TOKEN_CELL_CAPACITY", i);
        }
    }

    #[test]
    fn test_burn_cell_dep_matches_config() {
        // Verify burn transaction cell_deps come from the xudt config
        let config = test_xudt_config();
        let type_script = super::super::Script {
            code_hash: config.xudt_code_hash,
            hash_type: config.xudt_hash_type.clone(),
            args: build_xudt_args(&[0x01; 32]),
        };

        let tx = burn_token(
            &config,
            type_script,
            500,
            test_lock(0x01),
            vec![(test_input(0x50), 1000)],
        ).unwrap();

        assert_eq!(tx.cell_deps.len(), 1);
        assert_eq!(tx.cell_deps[0].tx_hash, config.xudt_cell_dep_tx_hash);
        assert_eq!(tx.cell_deps[0].index, config.xudt_cell_dep_index);
    }

    // ============ New Tests: Edge Cases & Boundary Coverage (Batch 5) ============

    #[test]
    fn test_mint_batch_with_zero_amounts() {
        // Batch mint where some recipients get zero tokens
        let config = test_xudt_config();
        let recipients = vec![
            (test_lock(0x02), 0_u128),
            (test_lock(0x03), 500),
            (test_lock(0x04), 0),
        ];

        let (tx, _) = mint_batch(&config, test_lock(0x01), &recipients, test_input(0x50));
        assert_eq!(tx.outputs.len(), 3);
        assert_eq!(parse_token_amount(&tx.outputs[0].data).unwrap(), 0);
        assert_eq!(parse_token_amount(&tx.outputs[1].data).unwrap(), 500);
        assert_eq!(parse_token_amount(&tx.outputs[2].data).unwrap(), 0);
    }

    #[test]
    fn test_mint_batch_with_u128_max_amounts() {
        // Batch mint with u128::MAX for each recipient
        let config = test_xudt_config();
        let recipients = vec![
            (test_lock(0x02), u128::MAX),
            (test_lock(0x03), u128::MAX),
        ];

        let (tx, _) = mint_batch(&config, test_lock(0x01), &recipients, test_input(0x50));
        assert_eq!(tx.outputs.len(), 2);
        assert_eq!(parse_token_amount(&tx.outputs[0].data).unwrap(), u128::MAX);
        assert_eq!(parse_token_amount(&tx.outputs[1].data).unwrap(), u128::MAX);
    }

    #[test]
    fn test_transfer_zero_amount_zero_inputs() {
        // Transfer 0 with no inputs — sum of inputs (0) >= 0, should succeed
        let config = test_xudt_config();
        let type_script = super::super::Script {
            code_hash: config.xudt_code_hash,
            hash_type: config.xudt_hash_type.clone(),
            args: build_xudt_args(&[0x01; 32]),
        };

        let tx = transfer_token(
            &config,
            type_script,
            test_lock(0x01),
            test_lock(0x02),
            0,
            vec![], // No inputs, transferring 0
        ).unwrap();

        // Recipient gets 0, no change (0 - 0 = 0)
        assert_eq!(tx.outputs.len(), 1);
        assert_eq!(parse_token_amount(&tx.outputs[0].data).unwrap(), 0);
    }

    #[test]
    fn test_burn_zero_amount_zero_inputs() {
        // Burn 0 with no inputs — sum of inputs (0) >= 0, should succeed
        let config = test_xudt_config();
        let type_script = super::super::Script {
            code_hash: config.xudt_code_hash,
            hash_type: config.xudt_hash_type.clone(),
            args: build_xudt_args(&[0x01; 32]),
        };

        let tx = burn_token(
            &config,
            type_script,
            0,
            test_lock(0x01),
            vec![], // No inputs, burning 0
        ).unwrap();

        // remaining = 0 - 0 = 0, no change cell
        assert_eq!(tx.outputs.len(), 0);
        assert_eq!(tx.inputs.len(), 0);
    }

    #[test]
    fn test_burn_one_remaining() {
        // Burn all but 1 token — boundary value for remaining
        let config = test_xudt_config();
        let type_script = super::super::Script {
            code_hash: config.xudt_code_hash,
            hash_type: config.xudt_hash_type.clone(),
            args: build_xudt_args(&[0x01; 32]),
        };

        let tx = burn_token(
            &config,
            type_script,
            999,
            test_lock(0x01),
            vec![(test_input(0x50), 1000)],
        ).unwrap();

        assert_eq!(tx.outputs.len(), 1);
        assert_eq!(parse_token_amount(&tx.outputs[0].data).unwrap(), 1);
    }

    #[test]
    fn test_transfer_one_token() {
        // Transfer exactly 1 token — minimum non-zero transfer
        let config = test_xudt_config();
        let type_script = super::super::Script {
            code_hash: config.xudt_code_hash,
            hash_type: config.xudt_hash_type.clone(),
            args: build_xudt_args(&[0x01; 32]),
        };

        let tx = transfer_token(
            &config,
            type_script,
            test_lock(0x01),
            test_lock(0x02),
            1,
            vec![(test_input(0x50), 1)],
        ).unwrap();

        assert_eq!(tx.outputs.len(), 1); // No change
        assert_eq!(parse_token_amount(&tx.outputs[0].data).unwrap(), 1);
    }

    #[test]
    fn test_transfer_one_short_of_insufficient() {
        // Transfer exactly total_input + 1 — should fail by exactly 1
        let config = test_xudt_config();
        let type_script = super::super::Script {
            code_hash: config.xudt_code_hash,
            hash_type: config.xudt_hash_type.clone(),
            args: build_xudt_args(&[0x01; 32]),
        };

        let result = transfer_token(
            &config,
            type_script,
            test_lock(0x01),
            test_lock(0x02),
            1001, // One more than available
            vec![(test_input(0x50), 1000)],
        );

        assert_eq!(result.unwrap_err(), super::super::SDKError::InvalidAmounts);
    }

    #[test]
    fn test_burn_one_short_of_insufficient() {
        // Burn exactly total_input + 1 — should fail by exactly 1
        let config = test_xudt_config();
        let type_script = super::super::Script {
            code_hash: config.xudt_code_hash,
            hash_type: config.xudt_hash_type.clone(),
            args: build_xudt_args(&[0x01; 32]),
        };

        let result = burn_token(
            &config,
            type_script,
            1001,
            test_lock(0x01),
            vec![(test_input(0x50), 1000)],
        );

        assert_eq!(result.unwrap_err(), super::super::SDKError::InvalidAmounts);
    }

    #[test]
    fn test_compute_token_type_hash_matches_mint_hash() {
        // The hash from compute_token_type_hash should match the one from mint_token
        let config = test_xudt_config();
        let issuer = test_lock(0x01);
        let issuer_lock_hash = hash_script(&issuer);

        let (_, mint_hash) = mint_token(
            &config,
            issuer,
            test_lock(0x02),
            1000,
            test_input(0x50),
        );

        let computed_hash = compute_token_type_hash(
            &config.xudt_code_hash,
            &config.xudt_hash_type,
            &issuer_lock_hash,
        );

        assert_eq!(mint_hash, computed_hash,
            "compute_token_type_hash must match the hash from mint_token");
    }

    #[test]
    fn test_hash_script_empty_args() {
        // Hash a script with empty args
        let script = super::super::Script {
            code_hash: [0x42; 32],
            hash_type: super::super::HashType::Type,
            args: vec![],
        };
        let h = hash_script(&script);
        assert_ne!(h, [0u8; 32], "Hash of script with empty args should not be all zeros");
    }

    #[test]
    fn test_hash_type_script_equals_hash_script() {
        // hash_type_script is documented as delegating to hash_script
        let script = test_lock(0x42);
        let h1 = hash_script(&script);
        let h2 = hash_type_script(&script);
        assert_eq!(h1, h2, "hash_type_script should equal hash_script");
    }

    #[test]
    fn test_hash_script_different_code_hash_different_result() {
        let script1 = super::super::Script {
            code_hash: [0x01; 32],
            hash_type: super::super::HashType::Type,
            args: vec![0x42; 20],
        };
        let script2 = super::super::Script {
            code_hash: [0x02; 32],
            hash_type: super::super::HashType::Type,
            args: vec![0x42; 20],
        };
        assert_ne!(hash_script(&script1), hash_script(&script2),
            "Different code_hash must produce different script hash");
    }

    #[test]
    fn test_hash_script_different_hash_type_different_result() {
        let script1 = super::super::Script {
            code_hash: [0x01; 32],
            hash_type: super::super::HashType::Data,
            args: vec![0x42; 20],
        };
        let script2 = super::super::Script {
            code_hash: [0x01; 32],
            hash_type: super::super::HashType::Type,
            args: vec![0x42; 20],
        };
        assert_ne!(hash_script(&script1), hash_script(&script2),
            "Different hash_type must produce different script hash");
    }

    #[test]
    fn test_token_info_deserialize_corrupt_description_length() {
        // Valid name and symbol, but description length overflows
        let mut data = vec![18u8]; // decimals
        data.extend_from_slice(&(2u16).to_le_bytes()); // name_len = 2
        data.extend_from_slice(b"OK"); // valid name
        data.extend_from_slice(&(2u16).to_le_bytes()); // symbol_len = 2
        data.extend_from_slice(b"TK"); // valid symbol
        data.extend_from_slice(&(60000u16).to_le_bytes()); // desc_len way too large
        data.extend_from_slice(&[0u8; 10]); // insufficient data
        assert!(TokenInfo::deserialize(&data).is_none(),
            "Corrupt description length should cause deserialization to fail");
    }

    #[test]
    fn test_token_info_deserialize_invalid_utf8_description() {
        // Valid name and symbol, but invalid UTF-8 in description
        let mut data = vec![18u8]; // decimals
        data.extend_from_slice(&(2u16).to_le_bytes()); // name_len = 2
        data.extend_from_slice(b"OK"); // valid name
        data.extend_from_slice(&(2u16).to_le_bytes()); // symbol_len = 2
        data.extend_from_slice(b"TK"); // valid symbol
        data.extend_from_slice(&(3u16).to_le_bytes()); // desc_len = 3
        data.extend_from_slice(&[0xFF, 0xFE, 0x80]); // invalid UTF-8 description
        data.extend_from_slice(&0u128.to_le_bytes()); // max_supply
        assert!(TokenInfo::deserialize(&data).is_none(),
            "Invalid UTF-8 in description should cause deserialization to fail");
    }

    #[test]
    fn test_token_info_deserialize_exact_minimum_length() {
        // Minimum valid data: decimals(1) + name_len(2) + name(0) + symbol_len(2)
        // + symbol(0) + desc_len(2) + desc(0) + max_supply(16) = 23 bytes
        let mut data = vec![8u8]; // decimals = 8
        data.extend_from_slice(&(0u16).to_le_bytes()); // name_len = 0
        data.extend_from_slice(&(0u16).to_le_bytes()); // symbol_len = 0
        data.extend_from_slice(&(0u16).to_le_bytes()); // desc_len = 0
        data.extend_from_slice(&42u128.to_le_bytes()); // max_supply = 42

        let deserialized = TokenInfo::deserialize(&data).unwrap();
        assert_eq!(deserialized.decimals, 8);
        assert_eq!(deserialized.name, "");
        assert_eq!(deserialized.symbol, "");
        assert_eq!(deserialized.description, "");
        assert_eq!(deserialized.max_supply, 42);
    }

    #[test]
    fn test_token_info_deserialize_one_byte_short_of_minimum() {
        // 22 bytes: one short of the minimum (23 bytes for empty strings)
        // 1 + 2 + 2 + 2 + 16 = 23, so 22 should fail
        let data = vec![0u8; 22];
        assert!(TokenInfo::deserialize(&data).is_none());
    }

    #[test]
    fn test_token_info_special_characters() {
        let info = TokenInfo {
            name: "Token\t\n\r\"'\\".to_string(),
            symbol: "<>&".to_string(),
            decimals: 6,
            description: "Line1\nLine2\n\0NullByte".to_string(),
            max_supply: 1,
        };

        let serialized = info.serialize();
        let deserialized = TokenInfo::deserialize(&serialized).unwrap();
        assert_eq!(deserialized.name, "Token\t\n\r\"'\\");
        assert_eq!(deserialized.symbol, "<>&");
        assert_eq!(deserialized.description, "Line1\nLine2\n\0NullByte");
    }

    #[test]
    fn test_token_info_unicode_multibyte() {
        // Test with actual multi-byte UTF-8 characters
        let info = TokenInfo {
            name: "\u{1F600}\u{1F680}\u{2764}".to_string(), // emoji: grinning face, rocket, heart
            symbol: "\u{00E9}\u{00F1}\u{00FC}".to_string(), // accented: e-acute, n-tilde, u-umlaut
            decimals: 18,
            description: "\u{4E16}\u{754C}".to_string(), // Chinese: "world"
            max_supply: 0,
        };

        let serialized = info.serialize();
        let deserialized = TokenInfo::deserialize(&serialized).unwrap();
        assert_eq!(deserialized.name, info.name);
        assert_eq!(deserialized.symbol, info.symbol);
        assert_eq!(deserialized.description, info.description);
    }

    #[test]
    fn test_build_xudt_args_all_zeros() {
        let args = build_xudt_args(&[0u8; 32]);
        assert_eq!(args.len(), 36);
        assert_eq!(&args[0..32], &[0u8; 32]);
        assert_eq!(&args[32..36], &XUDT_FLAGS_PLAIN);
    }

    #[test]
    fn test_build_xudt_args_all_ff() {
        let args = build_xudt_args(&[0xFF; 32]);
        assert_eq!(args.len(), 36);
        assert_eq!(&args[0..32], &[0xFF; 32]);
        assert_eq!(&args[32..36], &XUDT_FLAGS_PLAIN);
    }

    #[test]
    fn test_transfer_many_small_inputs() {
        // 10 inputs of 100 each, transfer 950
        let config = test_xudt_config();
        let type_script = super::super::Script {
            code_hash: config.xudt_code_hash,
            hash_type: config.xudt_hash_type.clone(),
            args: build_xudt_args(&[0x01; 32]),
        };

        let inputs: Vec<(super::super::CellInput, u128)> = (0..10u8)
            .map(|i| (test_input(0x50 + i), 100))
            .collect();

        let tx = transfer_token(
            &config,
            type_script,
            test_lock(0x01),
            test_lock(0x02),
            950,
            inputs,
        ).unwrap();

        assert_eq!(tx.inputs.len(), 10);
        assert_eq!(tx.witnesses.len(), 10);
        assert_eq!(tx.outputs.len(), 2); // recipient + change
        assert_eq!(parse_token_amount(&tx.outputs[0].data).unwrap(), 950);
        assert_eq!(parse_token_amount(&tx.outputs[1].data).unwrap(), 50);
    }

    #[test]
    fn test_burn_witnesses_count_matches_inputs() {
        // Verify burn witness count matches input count for various input counts
        let config = test_xudt_config();
        let type_script = super::super::Script {
            code_hash: config.xudt_code_hash,
            hash_type: config.xudt_hash_type.clone(),
            args: build_xudt_args(&[0x01; 32]),
        };

        for num_inputs in [1, 2, 4] {
            let inputs: Vec<(super::super::CellInput, u128)> = (0..num_inputs)
                .map(|i| (test_input(0x50 + i as u8), 1000))
                .collect();

            let tx = burn_token(
                &config,
                type_script.clone(),
                100,
                test_lock(0x01),
                inputs,
            ).unwrap();

            assert_eq!(tx.witnesses.len(), tx.inputs.len(),
                "Burn witness count must match input count for {} inputs", num_inputs);
        }
    }

    #[test]
    fn test_create_token_info_cell_dep_from_config() {
        // Verify info cell tx has cell_deps from xudt config
        let config = test_xudt_config();
        let info = TokenInfo {
            name: "Info".to_string(),
            symbol: "INF".to_string(),
            decimals: 8,
            description: "".to_string(),
            max_supply: 0,
        };

        let tx = create_token_info(
            &config,
            [0x42; 32],
            &info,
            test_lock(0x01),
            test_input(0x50),
        );

        assert_eq!(tx.cell_deps.len(), 1);
        assert_eq!(tx.cell_deps[0].tx_hash, config.xudt_cell_dep_tx_hash);
        assert_eq!(tx.cell_deps[0].index, config.xudt_cell_dep_index);
    }

    #[test]
    fn test_create_token_info_witness_and_input_count() {
        // Info cell tx should have exactly 1 input and 1 witness
        let config = test_xudt_config();
        let info = TokenInfo {
            name: "W".to_string(),
            symbol: "W".to_string(),
            decimals: 0,
            description: "".to_string(),
            max_supply: 0,
        };

        let tx = create_token_info(
            &config,
            [0x00; 32],
            &info,
            test_lock(0x01),
            test_input(0x50),
        );

        assert_eq!(tx.inputs.len(), 1);
        assert_eq!(tx.witnesses.len(), 1);
        assert_eq!(tx.outputs.len(), 1);
    }

    #[test]
    fn test_mint_batch_preserves_recipient_lock_scripts() {
        // Verify each output's lock_script matches the corresponding recipient
        let config = test_xudt_config();
        let recipients = vec![
            (test_lock(0x10), 100_u128),
            (test_lock(0x20), 200),
            (test_lock(0x30), 300),
        ];

        let (tx, _) = mint_batch(&config, test_lock(0x01), &recipients, test_input(0x50));

        for (i, (lock, _)) in recipients.iter().enumerate() {
            assert_eq!(tx.outputs[i].lock_script.code_hash, lock.code_hash,
                "Output {} lock script code_hash mismatch", i);
            assert_eq!(tx.outputs[i].lock_script.args, lock.args,
                "Output {} lock script args mismatch", i);
        }
    }

    #[test]
    fn test_transfer_output_type_scripts_match() {
        // Both recipient and change outputs should have the same type script
        let config = test_xudt_config();
        let type_script = super::super::Script {
            code_hash: config.xudt_code_hash,
            hash_type: config.xudt_hash_type.clone(),
            args: build_xudt_args(&[0x01; 32]),
        };

        let tx = transfer_token(
            &config,
            type_script.clone(),
            test_lock(0x01),
            test_lock(0x02),
            400,
            vec![(test_input(0x50), 1000)],
        ).unwrap();

        assert_eq!(tx.outputs.len(), 2);
        let recipient_type = tx.outputs[0].type_script.as_ref().unwrap();
        let change_type = tx.outputs[1].type_script.as_ref().unwrap();
        assert_eq!(recipient_type.code_hash, type_script.code_hash);
        assert_eq!(change_type.code_hash, type_script.code_hash);
        assert_eq!(recipient_type.args, type_script.args);
        assert_eq!(change_type.args, type_script.args);
    }

    #[test]
    fn test_burn_output_type_script_matches() {
        // Change cell from burn should have the same type script
        let config = test_xudt_config();
        let type_script = super::super::Script {
            code_hash: config.xudt_code_hash,
            hash_type: config.xudt_hash_type.clone(),
            args: build_xudt_args(&[0x01; 32]),
        };

        let tx = burn_token(
            &config,
            type_script.clone(),
            200,
            test_lock(0x01),
            vec![(test_input(0x50), 1000)],
        ).unwrap();

        assert_eq!(tx.outputs.len(), 1);
        let change_type = tx.outputs[0].type_script.as_ref().unwrap();
        assert_eq!(change_type.code_hash, type_script.code_hash);
        assert_eq!(change_type.args, type_script.args);
    }

    #[test]
    fn test_transfer_output_capacities() {
        // Both recipient and change outputs should use TOKEN_CELL_CAPACITY
        let config = test_xudt_config();
        let type_script = super::super::Script {
            code_hash: config.xudt_code_hash,
            hash_type: config.xudt_hash_type.clone(),
            args: build_xudt_args(&[0x01; 32]),
        };

        let tx = transfer_token(
            &config,
            type_script,
            test_lock(0x01),
            test_lock(0x02),
            600,
            vec![(test_input(0x50), 1000)],
        ).unwrap();

        for (i, output) in tx.outputs.iter().enumerate() {
            assert_eq!(output.capacity, TOKEN_CELL_CAPACITY,
                "Transfer output {} should have TOKEN_CELL_CAPACITY", i);
        }
    }

    #[test]
    fn test_burn_output_capacity() {
        // Change cell from burn should use TOKEN_CELL_CAPACITY
        let config = test_xudt_config();
        let type_script = super::super::Script {
            code_hash: config.xudt_code_hash,
            hash_type: config.xudt_hash_type.clone(),
            args: build_xudt_args(&[0x01; 32]),
        };

        let tx = burn_token(
            &config,
            type_script,
            300,
            test_lock(0x01),
            vec![(test_input(0x50), 1000)],
        ).unwrap();

        assert_eq!(tx.outputs[0].capacity, TOKEN_CELL_CAPACITY);
    }

    #[test]
    fn test_token_info_serialize_length_calculation() {
        // Verify serialize produces exact expected length
        let info = TokenInfo {
            name: "ABCDE".to_string(), // 5 bytes
            symbol: "XY".to_string(),   // 2 bytes
            decimals: 18,
            description: "Hello World".to_string(), // 11 bytes
            max_supply: 100,
        };

        let serialized = info.serialize();
        // Expected: 1 (decimals) + 2 (name_len) + 5 (name) + 2 (symbol_len) + 2 (symbol)
        //         + 2 (desc_len) + 11 (desc) + 16 (max_supply) = 41
        assert_eq!(serialized.len(), 41);
    }

    #[test]
    fn test_compute_token_type_hash_different_code_hashes() {
        // Different code hashes with same lock hash should produce different token type hashes
        let lock_hash = [0x01; 32];
        let h1 = compute_token_type_hash(&[0xAA; 32], &super::super::HashType::Data1, &lock_hash);
        let h2 = compute_token_type_hash(&[0xBB; 32], &super::super::HashType::Data1, &lock_hash);
        assert_ne!(h1, h2, "Different code hashes must produce different token type hashes");
    }

    #[test]
    fn test_parse_token_amount_preserves_byte_order() {
        // Manually set specific bytes to verify little-endian interpretation
        let mut data = [0u8; 16];
        data[0] = 0x01; // LSB
        let amount = parse_token_amount(&data).unwrap();
        assert_eq!(amount, 1, "LE byte order: [0x01, 0, ...] should be 1");

        let mut data2 = [0u8; 16];
        data2[15] = 0x01; // MSB
        let amount2 = parse_token_amount(&data2).unwrap();
        assert_eq!(amount2, 1u128 << 120,
            "LE byte order: [0, ..., 0x01] should be 2^120");
    }

    #[test]
    fn test_xudt_config_clone() {
        // Ensure XudtConfig Clone works correctly (used in mint_token, etc.)
        let config = test_xudt_config();
        let config2 = config.clone();
        assert_eq!(config.xudt_code_hash, config2.xudt_code_hash);
        assert_eq!(config.xudt_cell_dep_tx_hash, config2.xudt_cell_dep_tx_hash);
        assert_eq!(config.xudt_cell_dep_index, config2.xudt_cell_dep_index);
    }

    #[test]
    fn test_mint_token_data_is_exactly_16_bytes() {
        // xUDT cell data must be exactly 16 bytes (u128 LE)
        let config = test_xudt_config();
        for amount in [0u128, 1, 42, u128::MAX / 2, u128::MAX] {
            let (tx, _) = mint_token(
                &config,
                test_lock(0x01),
                test_lock(0x02),
                amount,
                test_input(0x50),
            );
            assert_eq!(tx.outputs[0].data.len(), 16,
                "Cell data for amount {} should be exactly 16 bytes", amount);
        }
    }

    #[test]
    fn test_mint_batch_cell_dep_count() {
        // Batch mint should have exactly 1 cell dep regardless of recipient count
        let config = test_xudt_config();
        for count in [0, 1, 5] {
            let recipients: Vec<(super::super::Script, u128)> = (0..count)
                .map(|i| (test_lock(0x10 + i as u8), 100))
                .collect();
            let (tx, _) = mint_batch(&config, test_lock(0x01), &recipients, test_input(0x50));
            assert_eq!(tx.cell_deps.len(), 1,
                "Batch mint with {} recipients should have exactly 1 cell dep", count);
        }
    }

    #[test]
    fn test_transfer_input_order_preserved() {
        // Verify input cells appear in the same order they were provided
        let config = test_xudt_config();
        let type_script = super::super::Script {
            code_hash: config.xudt_code_hash,
            hash_type: config.xudt_hash_type.clone(),
            args: build_xudt_args(&[0x01; 32]),
        };

        let tx = transfer_token(
            &config,
            type_script,
            test_lock(0x01),
            test_lock(0x02),
            100,
            vec![
                (test_input(0xAA), 50),
                (test_input(0xBB), 50),
                (test_input(0xCC), 50),
            ],
        ).unwrap();

        assert_eq!(tx.inputs[0].tx_hash, [0xAA; 32]);
        assert_eq!(tx.inputs[1].tx_hash, [0xBB; 32]);
        assert_eq!(tx.inputs[2].tx_hash, [0xCC; 32]);
    }

    // ============ Batch 6: Additional Hardening Tests ============

    #[test]
    fn test_mint_token_zero_amount() {
        // Minting zero tokens should produce a valid cell with 0 in data
        let config = test_xudt_config();
        let (tx, hash) = mint_token(
            &config,
            test_lock(0x01),
            test_lock(0x02),
            0,
            test_input(0x50),
        );

        assert_eq!(tx.outputs.len(), 1);
        assert_eq!(parse_token_amount(&tx.outputs[0].data).unwrap(), 0);
        assert_ne!(hash, [0u8; 32]);
    }

    #[test]
    fn test_mint_token_u128_max_amount() {
        // Minting u128::MAX should produce correct cell data
        let config = test_xudt_config();
        let (tx, _) = mint_token(
            &config,
            test_lock(0x01),
            test_lock(0x02),
            u128::MAX,
            test_input(0x50),
        );

        assert_eq!(parse_token_amount(&tx.outputs[0].data).unwrap(), u128::MAX);
        assert_eq!(tx.outputs[0].data.len(), 16);
    }

    #[test]
    fn test_mint_batch_zero_recipients_empty() {
        // Batch mint with zero recipients
        let config = test_xudt_config();
        let (tx, hash) = mint_batch(&config, test_lock(0x01), &[], test_input(0x50));

        assert_eq!(tx.outputs.len(), 0);
        assert_eq!(tx.witnesses.len(), 1); // max(0, 1) = 1
        assert_ne!(hash, [0u8; 32]);
    }

    #[test]
    fn test_transfer_exact_amount_produces_single_output() {
        // Transfer exactly the input amount — no change cell
        let config = test_xudt_config();
        let type_script = super::super::Script {
            code_hash: config.xudt_code_hash,
            hash_type: config.xudt_hash_type.clone(),
            args: build_xudt_args(&[0x01; 32]),
        };

        let tx = transfer_token(
            &config,
            type_script,
            test_lock(0x01),
            test_lock(0x02),
            5000,
            vec![(test_input(0x50), 5000)],
        ).unwrap();

        assert_eq!(tx.outputs.len(), 1); // Only recipient, no change
        assert_eq!(parse_token_amount(&tx.outputs[0].data).unwrap(), 5000);
    }

    #[test]
    fn test_transfer_multiple_inputs_summed() {
        // Verify total_input is computed as the sum of all input amounts
        let config = test_xudt_config();
        let type_script = super::super::Script {
            code_hash: config.xudt_code_hash,
            hash_type: config.xudt_hash_type.clone(),
            args: build_xudt_args(&[0x01; 32]),
        };

        let tx = transfer_token(
            &config,
            type_script,
            test_lock(0x01),
            test_lock(0x02),
            150, // less than any single input, but possible from sum
            vec![
                (test_input(0x50), 50),
                (test_input(0x51), 50),
                (test_input(0x52), 50),
            ],
        ).unwrap();

        assert_eq!(tx.outputs.len(), 1); // No change: 150 = 50+50+50
        assert_eq!(parse_token_amount(&tx.outputs[0].data).unwrap(), 150);
    }

    #[test]
    fn test_burn_exact_total_no_remainder() {
        // Burn exactly the total input — no remaining tokens, no output
        let config = test_xudt_config();
        let type_script = super::super::Script {
            code_hash: config.xudt_code_hash,
            hash_type: config.xudt_hash_type.clone(),
            args: build_xudt_args(&[0x01; 32]),
        };

        let tx = burn_token(
            &config,
            type_script,
            5000,
            test_lock(0x01),
            vec![(test_input(0x50), 5000)],
        ).unwrap();

        assert_eq!(tx.outputs.len(), 0);
    }

    #[test]
    fn test_parse_token_amount_extra_data_ignored() {
        // Data longer than 16 bytes — extra bytes should be ignored
        let mut data = 42u128.to_le_bytes().to_vec();
        data.extend_from_slice(&[0xFF; 100]); // extra garbage
        assert_eq!(parse_token_amount(&data), Some(42));
    }

    #[test]
    fn test_build_xudt_args_length_always_36() {
        // For any lock hash, args should always be 36 bytes
        for id in [0x00u8, 0x01, 0x42, 0xFF] {
            let args = build_xudt_args(&[id; 32]);
            assert_eq!(args.len(), 36, "Args length for id={} should be 36", id);
        }
    }

    #[test]
    fn test_token_info_roundtrip_all_zero_decimals() {
        let info = TokenInfo {
            name: "Zero".to_string(),
            symbol: "Z".to_string(),
            decimals: 0,
            description: "Zero decimals token".to_string(),
            max_supply: 0,
        };

        let serialized = info.serialize();
        let deserialized = TokenInfo::deserialize(&serialized).unwrap();
        assert_eq!(deserialized.decimals, 0);
        assert_eq!(deserialized.max_supply, 0);
    }

    #[test]
    fn test_token_info_roundtrip_max_all_fields() {
        // Maximum values for every field
        let info = TokenInfo {
            name: "X".repeat(u16::MAX as usize),
            symbol: "Y".to_string(),
            decimals: u8::MAX,
            description: "".to_string(),
            max_supply: u128::MAX,
        };

        let serialized = info.serialize();
        let deserialized = TokenInfo::deserialize(&serialized).unwrap();
        assert_eq!(deserialized.name.len(), u16::MAX as usize);
        assert_eq!(deserialized.decimals, u8::MAX);
        assert_eq!(deserialized.max_supply, u128::MAX);
    }

    #[test]
    fn test_transfer_insufficient_by_u128_max() {
        // Transfer u128::MAX but only have 1 token
        let config = test_xudt_config();
        let type_script = super::super::Script {
            code_hash: config.xudt_code_hash,
            hash_type: config.xudt_hash_type.clone(),
            args: build_xudt_args(&[0x01; 32]),
        };

        let result = transfer_token(
            &config,
            type_script,
            test_lock(0x01),
            test_lock(0x02),
            u128::MAX,
            vec![(test_input(0x50), 1)],
        );

        assert_eq!(result.unwrap_err(), super::super::SDKError::InvalidAmounts);
    }

    #[test]
    fn test_burn_insufficient_by_u128_max() {
        // Burn u128::MAX but only have 1 token
        let config = test_xudt_config();
        let type_script = super::super::Script {
            code_hash: config.xudt_code_hash,
            hash_type: config.xudt_hash_type.clone(),
            args: build_xudt_args(&[0x01; 32]),
        };

        let result = burn_token(
            &config,
            type_script,
            u128::MAX,
            test_lock(0x01),
            vec![(test_input(0x50), 1)],
        );

        assert_eq!(result.unwrap_err(), super::super::SDKError::InvalidAmounts);
    }

    #[test]
    fn test_mint_token_input_preserved_in_tx() {
        // Verify the issuer input is preserved correctly in the transaction
        let config = test_xudt_config();
        let input = test_input(0xAB);
        let (tx, _) = mint_token(
            &config,
            test_lock(0x01),
            test_lock(0x02),
            1000,
            input.clone(),
        );

        assert_eq!(tx.inputs.len(), 1);
        assert_eq!(tx.inputs[0].tx_hash, input.tx_hash);
        assert_eq!(tx.inputs[0].index, input.index);
    }

    #[test]
    fn test_token_info_deserialize_empty_data() {
        // Empty data should fail
        assert!(TokenInfo::deserialize(&[]).is_none());
    }

    #[test]
    fn test_token_info_deserialize_single_byte() {
        // Single byte (just decimals) should fail
        assert!(TokenInfo::deserialize(&[18]).is_none());
    }

    #[test]
    fn test_create_token_info_output_capacity() {
        let config = test_xudt_config();
        let info = TokenInfo {
            name: "Cap".to_string(),
            symbol: "C".to_string(),
            decimals: 8,
            description: "".to_string(),
            max_supply: 0,
        };

        let tx = create_token_info(&config, [0x42; 32], &info, test_lock(0x01), test_input(0x50));

        assert_eq!(tx.outputs[0].capacity, TOKEN_INFO_CELL_CAPACITY);
    }

    #[test]
    fn test_hash_type_byte_values_are_stable() {
        // These values are protocol constants and must never change
        assert_eq!(hash_type_byte(&super::super::HashType::Data), 0);
        assert_eq!(hash_type_byte(&super::super::HashType::Type), 1);
        assert_eq!(hash_type_byte(&super::super::HashType::Data1), 2);
        assert_eq!(hash_type_byte(&super::super::HashType::Data2), 4);
    }

    // ============ Hardening Tests (Batch harden3) ============

    #[test]
    fn test_mint_token_data_len_exactly_16_harden3() {
        let config = test_xudt_config();
        let (tx, _) = mint_token(&config, test_lock(0x01), test_lock(0x02), 1, test_input(0x50));
        assert_eq!(tx.outputs[0].data.len(), 16, "Token cell data must always be 16 bytes");
    }

    #[test]
    fn test_mint_token_type_script_code_hash_matches_config_harden3() {
        let config = test_xudt_config();
        let (tx, _) = mint_token(&config, test_lock(0x01), test_lock(0x02), 100, test_input(0x50));
        let ts = tx.outputs[0].type_script.as_ref().unwrap();
        assert_eq!(ts.code_hash, config.xudt_code_hash);
    }

    #[test]
    fn test_mint_token_type_script_hash_type_matches_config_harden3() {
        let mut config = test_xudt_config();
        config.xudt_hash_type = super::super::HashType::Type;
        let (tx, _) = mint_token(&config, test_lock(0x01), test_lock(0x02), 100, test_input(0x50));
        let ts = tx.outputs[0].type_script.as_ref().unwrap();
        assert!(matches!(ts.hash_type, super::super::HashType::Type));
    }

    #[test]
    fn test_mint_batch_token_type_hash_matches_single_mint_harden3() {
        let config = test_xudt_config();
        let issuer = test_lock(0x01);
        let (_, h_single) = mint_token(&config, issuer.clone(), test_lock(0x02), 999, test_input(0x50));
        let recipients = vec![
            (test_lock(0x03), 111_u128),
            (test_lock(0x04), 222),
        ];
        let (_, h_batch) = mint_batch(&config, issuer, &recipients, test_input(0x51));
        assert_eq!(h_single, h_batch, "Same issuer must produce same token_type_hash");
    }

    #[test]
    fn test_transfer_preserves_type_script_harden3() {
        let config = test_xudt_config();
        let type_script = super::super::Script {
            code_hash: config.xudt_code_hash,
            hash_type: config.xudt_hash_type.clone(),
            args: build_xudt_args(&[0x01; 32]),
        };
        let tx = transfer_token(
            &config, type_script.clone(), test_lock(0x01), test_lock(0x02),
            500, vec![(test_input(0x50), 1000)],
        ).unwrap();

        for output in &tx.outputs {
            let ts = output.type_script.as_ref().unwrap();
            assert_eq!(ts.code_hash, type_script.code_hash);
            assert_eq!(ts.args, type_script.args);
        }
    }

    #[test]
    fn test_transfer_sender_lock_on_change_cell_harden3() {
        let config = test_xudt_config();
        let sender = test_lock(0x01);
        let type_script = super::super::Script {
            code_hash: config.xudt_code_hash,
            hash_type: config.xudt_hash_type.clone(),
            args: build_xudt_args(&[0x01; 32]),
        };
        let tx = transfer_token(
            &config, type_script, sender.clone(), test_lock(0x02),
            500, vec![(test_input(0x50), 1000)],
        ).unwrap();
        assert_eq!(tx.outputs[1].lock_script.args, sender.args,
            "Change cell should have sender's lock script");
    }

    #[test]
    fn test_burn_owner_lock_on_change_cell_harden3() {
        let config = test_xudt_config();
        let owner = test_lock(0x01);
        let type_script = super::super::Script {
            code_hash: config.xudt_code_hash,
            hash_type: config.xudt_hash_type.clone(),
            args: build_xudt_args(&[0x01; 32]),
        };
        let tx = burn_token(&config, type_script, 300, owner.clone(),
            vec![(test_input(0x50), 1000)]).unwrap();
        assert_eq!(tx.outputs[0].lock_script.args, owner.args);
    }

    #[test]
    fn test_transfer_one_token_harden3() {
        let config = test_xudt_config();
        let type_script = super::super::Script {
            code_hash: config.xudt_code_hash,
            hash_type: config.xudt_hash_type.clone(),
            args: build_xudt_args(&[0x01; 32]),
        };
        let tx = transfer_token(
            &config, type_script, test_lock(0x01), test_lock(0x02),
            1, vec![(test_input(0x50), 1)],
        ).unwrap();
        assert_eq!(tx.outputs.len(), 1); // No change
        assert_eq!(parse_token_amount(&tx.outputs[0].data).unwrap(), 1);
    }

    #[test]
    fn test_burn_one_token_from_two_harden3() {
        let config = test_xudt_config();
        let type_script = super::super::Script {
            code_hash: config.xudt_code_hash,
            hash_type: config.xudt_hash_type.clone(),
            args: build_xudt_args(&[0x01; 32]),
        };
        let tx = burn_token(&config, type_script, 1, test_lock(0x01),
            vec![(test_input(0x50), 2)]).unwrap();
        assert_eq!(tx.outputs.len(), 1);
        assert_eq!(parse_token_amount(&tx.outputs[0].data).unwrap(), 1);
    }

    #[test]
    fn test_transfer_one_over_balance_fails_harden3() {
        let config = test_xudt_config();
        let type_script = super::super::Script {
            code_hash: config.xudt_code_hash,
            hash_type: config.xudt_hash_type.clone(),
            args: build_xudt_args(&[0x01; 32]),
        };
        let result = transfer_token(
            &config, type_script, test_lock(0x01), test_lock(0x02),
            1001, vec![(test_input(0x50), 1000)],
        );
        assert_eq!(result.unwrap_err(), super::super::SDKError::InvalidAmounts);
    }

    #[test]
    fn test_burn_one_over_balance_fails_harden3() {
        let config = test_xudt_config();
        let type_script = super::super::Script {
            code_hash: config.xudt_code_hash,
            hash_type: config.xudt_hash_type.clone(),
            args: build_xudt_args(&[0x01; 32]),
        };
        let result = burn_token(&config, type_script, 1001, test_lock(0x01),
            vec![(test_input(0x50), 1000)]);
        assert_eq!(result.unwrap_err(), super::super::SDKError::InvalidAmounts);
    }

    #[test]
    fn test_token_info_serialize_total_len_harden3() {
        let info = TokenInfo {
            name: "AB".to_string(),
            symbol: "C".to_string(),
            decimals: 8,
            description: "DEFG".to_string(),
            max_supply: 42,
        };
        let bytes = info.serialize();
        // 1 (decimals) + 2 (name_len) + 2 (name) + 2 (sym_len) + 1 (sym) + 2 (desc_len) + 4 (desc) + 16 (max_supply)
        assert_eq!(bytes.len(), 1 + 2 + 2 + 2 + 1 + 2 + 4 + 16);
    }

    #[test]
    fn test_token_info_deserialize_corrupt_desc_length_harden3() {
        let mut data = vec![18u8]; // decimals
        data.extend_from_slice(&(2u16).to_le_bytes()); // name_len = 2
        data.extend_from_slice(b"OK"); // name
        data.extend_from_slice(&(2u16).to_le_bytes()); // symbol_len = 2
        data.extend_from_slice(b"OK"); // symbol
        data.extend_from_slice(&(60000u16).to_le_bytes()); // desc_len way too large
        data.extend_from_slice(&[0u8; 10]); // insufficient data
        assert!(TokenInfo::deserialize(&data).is_none());
    }

    #[test]
    fn test_token_info_special_chars_harden3() {
        let info = TokenInfo {
            name: "Token\x00With\tSpecial".to_string(),
            symbol: "T\n".to_string(),
            decimals: 18,
            description: "Desc with emoji-like bytes".to_string(),
            max_supply: 0,
        };
        let bytes = info.serialize();
        let parsed = TokenInfo::deserialize(&bytes).unwrap();
        assert_eq!(parsed.name, info.name);
        assert_eq!(parsed.symbol, info.symbol);
    }

    #[test]
    fn test_hash_script_empty_args_harden3() {
        let script = super::super::Script {
            code_hash: [0x01; 32],
            hash_type: super::super::HashType::Data,
            args: vec![],
        };
        let h = hash_script(&script);
        assert_ne!(h, [0u8; 32]);
    }

    #[test]
    fn test_hash_script_long_args_harden3() {
        let script = super::super::Script {
            code_hash: [0x01; 32],
            hash_type: super::super::HashType::Data,
            args: vec![0xAB; 1000],
        };
        let h = hash_script(&script);
        assert_ne!(h, [0u8; 32]);
    }

    #[test]
    fn test_mint_batch_five_recipients_all_zero_harden3() {
        let config = test_xudt_config();
        let recipients: Vec<(super::super::Script, u128)> = (0..5u8)
            .map(|i| (test_lock(0x10 + i), 0_u128))
            .collect();
        let (tx, _) = mint_batch(&config, test_lock(0x01), &recipients, test_input(0x50));
        assert_eq!(tx.outputs.len(), 5);
        for out in &tx.outputs {
            assert_eq!(parse_token_amount(&out.data).unwrap(), 0);
        }
    }

    #[test]
    fn test_transfer_five_inputs_partial_sum_harden3() {
        let config = test_xudt_config();
        let type_script = super::super::Script {
            code_hash: config.xudt_code_hash,
            hash_type: config.xudt_hash_type.clone(),
            args: build_xudt_args(&[0x01; 32]),
        };
        let inputs: Vec<(super::super::CellInput, u128)> = (0..5u8)
            .map(|i| (test_input(0x50 + i), 100))
            .collect();
        let tx = transfer_token(
            &config, type_script, test_lock(0x01), test_lock(0x02),
            350, inputs,
        ).unwrap();
        assert_eq!(parse_token_amount(&tx.outputs[0].data).unwrap(), 350);
        assert_eq!(parse_token_amount(&tx.outputs[1].data).unwrap(), 150);
    }

    #[test]
    fn test_create_token_info_cell_deps_harden3() {
        let config = test_xudt_config();
        let info = TokenInfo {
            name: "T".to_string(),
            symbol: "T".to_string(),
            decimals: 18,
            description: "".to_string(),
            max_supply: 0,
        };
        let tx = create_token_info(&config, [0x42; 32], &info, test_lock(0x01), test_input(0x50));
        assert_eq!(tx.cell_deps.len(), 1);
        assert_eq!(tx.cell_deps[0].tx_hash, config.xudt_cell_dep_tx_hash);
    }

    #[test]
    fn test_create_token_info_witness_count_harden3() {
        let config = test_xudt_config();
        let info = TokenInfo {
            name: "T".to_string(),
            symbol: "T".to_string(),
            decimals: 18,
            description: "".to_string(),
            max_supply: 0,
        };
        let tx = create_token_info(&config, [0x42; 32], &info, test_lock(0x01), test_input(0x50));
        assert_eq!(tx.witnesses.len(), 1);
        assert_eq!(tx.inputs.len(), 1);
    }

    #[test]
    fn test_parse_token_amount_17_bytes_harden3() {
        // 17 bytes: still parseable (only first 16 used)
        let mut data = 42u128.to_le_bytes().to_vec();
        data.push(0xFF);
        assert_eq!(parse_token_amount(&data), Some(42));
    }

    #[test]
    fn test_build_xudt_args_zero_lock_hash_harden3() {
        let args = build_xudt_args(&[0u8; 32]);
        assert_eq!(args.len(), 36);
        assert_eq!(&args[0..32], &[0u8; 32]);
        assert_eq!(&args[32..36], &XUDT_FLAGS_PLAIN);
    }

    #[test]
    fn test_compute_token_type_hash_different_code_hashes_harden3() {
        let h1 = compute_token_type_hash(&[0x01; 32], &super::super::HashType::Data1, &[0xAA; 32]);
        let h2 = compute_token_type_hash(&[0x02; 32], &super::super::HashType::Data1, &[0xAA; 32]);
        assert_ne!(h1, h2, "Different code hashes should produce different type hashes");
    }

    #[test]
    fn test_mint_input_preserved_harden3() {
        let config = test_xudt_config();
        let input = test_input(0xFE);
        let (tx, _) = mint_token(&config, test_lock(0x01), test_lock(0x02), 100, input.clone());
        assert_eq!(tx.inputs[0].tx_hash, input.tx_hash);
        assert_eq!(tx.inputs[0].index, input.index);
    }

    #[test]
    fn test_transfer_recipient_lock_is_correct_harden3() {
        let config = test_xudt_config();
        let recipient = test_lock(0x99);
        let type_script = super::super::Script {
            code_hash: config.xudt_code_hash,
            hash_type: config.xudt_hash_type.clone(),
            args: build_xudt_args(&[0x01; 32]),
        };
        let tx = transfer_token(
            &config, type_script, test_lock(0x01), recipient.clone(),
            500, vec![(test_input(0x50), 1000)],
        ).unwrap();
        assert_eq!(tx.outputs[0].lock_script.args, recipient.args);
    }

    // ============ Hardening Round 5 — 25 new tests ============

    #[test]
    fn test_mint_token_type_args_length_is_36_v5() {
        let config = test_xudt_config();
        let (tx, _) = mint_token(&config, test_lock(0x01), test_lock(0x02), 100, test_input(0x10));
        let type_script = tx.outputs[0].type_script.as_ref().unwrap();
        assert_eq!(type_script.args.len(), 36);
    }

    #[test]
    fn test_mint_token_type_args_ends_with_plain_flags_v5() {
        let config = test_xudt_config();
        let (tx, _) = mint_token(&config, test_lock(0x01), test_lock(0x02), 100, test_input(0x10));
        let args = &tx.outputs[0].type_script.as_ref().unwrap().args;
        assert_eq!(&args[32..], &XUDT_FLAGS_PLAIN);
    }

    #[test]
    fn test_mint_batch_two_recipients_distinct_locks_v5() {
        let config = test_xudt_config();
        let r1 = test_lock(0x01);
        let r2 = test_lock(0x02);
        let (tx, _) = mint_batch(&config, test_lock(0x10), &[(r1.clone(), 100), (r2.clone(), 200)], test_input(0x20));
        assert_eq!(tx.outputs[0].lock_script.args, r1.args);
        assert_eq!(tx.outputs[1].lock_script.args, r2.args);
    }

    #[test]
    fn test_transfer_change_amount_correct_v5() {
        let config = test_xudt_config();
        let type_script = super::super::Script {
            code_hash: config.xudt_code_hash,
            hash_type: config.xudt_hash_type.clone(),
            args: build_xudt_args(&[0x01; 32]),
        };
        let tx = transfer_token(&config, type_script, test_lock(0x01), test_lock(0x02), 300, vec![(test_input(0x10), 1000)]).unwrap();
        let change_data = &tx.outputs[1].data;
        let change_amount = u128::from_le_bytes(change_data[0..16].try_into().unwrap());
        assert_eq!(change_amount, 700);
    }

    #[test]
    fn test_transfer_recipient_amount_in_data_v5() {
        let config = test_xudt_config();
        let type_script = super::super::Script {
            code_hash: config.xudt_code_hash,
            hash_type: config.xudt_hash_type.clone(),
            args: build_xudt_args(&[0x01; 32]),
        };
        let tx = transfer_token(&config, type_script, test_lock(0x01), test_lock(0x02), 250, vec![(test_input(0x10), 1000)]).unwrap();
        let recipient_amount = u128::from_le_bytes(tx.outputs[0].data[0..16].try_into().unwrap());
        assert_eq!(recipient_amount, 250);
    }

    #[test]
    fn test_burn_remaining_amount_in_data_v5() {
        let config = test_xudt_config();
        let type_script = super::super::Script {
            code_hash: config.xudt_code_hash,
            hash_type: config.xudt_hash_type.clone(),
            args: build_xudt_args(&[0x01; 32]),
        };
        let tx = burn_token(&config, type_script, 600, test_lock(0x01), vec![(test_input(0x10), 1000)]).unwrap();
        let remaining = u128::from_le_bytes(tx.outputs[0].data[0..16].try_into().unwrap());
        assert_eq!(remaining, 400);
    }

    #[test]
    fn test_burn_all_produces_no_outputs_v5() {
        let config = test_xudt_config();
        let type_script = super::super::Script {
            code_hash: config.xudt_code_hash,
            hash_type: config.xudt_hash_type.clone(),
            args: build_xudt_args(&[0x01; 32]),
        };
        let tx = burn_token(&config, type_script, 1000, test_lock(0x01), vec![(test_input(0x10), 1000)]).unwrap();
        assert!(tx.outputs.is_empty());
    }

    #[test]
    fn test_token_info_max_supply_zero_means_unlimited_v5() {
        let info = TokenInfo {
            name: "Test".to_string(),
            symbol: "TST".to_string(),
            decimals: 8,
            description: "desc".to_string(),
            max_supply: 0,
        };
        let data = info.serialize();
        let parsed = TokenInfo::deserialize(&data).unwrap();
        assert_eq!(parsed.max_supply, 0);
    }

    #[test]
    fn test_token_info_max_supply_u128_max_v5() {
        let info = TokenInfo {
            name: "A".to_string(),
            symbol: "B".to_string(),
            decimals: 18,
            description: "".to_string(),
            max_supply: u128::MAX,
        };
        let data = info.serialize();
        let parsed = TokenInfo::deserialize(&data).unwrap();
        assert_eq!(parsed.max_supply, u128::MAX);
    }

    #[test]
    fn test_parse_token_amount_boundary_exactly_15_bytes_v5() {
        let data = vec![0u8; 15];
        assert!(parse_token_amount(&data).is_none());
    }

    #[test]
    fn test_hash_script_consistency_across_calls_v5() {
        let script = super::super::Script {
            code_hash: [0x42; 32],
            hash_type: super::super::HashType::Data,
            args: vec![1, 2, 3],
        };
        let h1 = hash_script(&script);
        let h2 = hash_script(&script);
        let h3 = hash_script(&script);
        assert_eq!(h1, h2);
        assert_eq!(h2, h3);
    }

    #[test]
    fn test_mint_batch_three_recipients_output_count_v5() {
        let config = test_xudt_config();
        let recipients = vec![
            (test_lock(0x01), 100),
            (test_lock(0x02), 200),
            (test_lock(0x03), 300),
        ];
        let (tx, _) = mint_batch(&config, test_lock(0x10), &recipients, test_input(0x20));
        assert_eq!(tx.outputs.len(), 3);
    }

    #[test]
    fn test_mint_batch_data_amounts_match_recipients_v5() {
        let config = test_xudt_config();
        let amounts = [100u128, 200, 300, 400];
        let recipients: Vec<_> = amounts.iter().enumerate().map(|(i, &a)| (test_lock(i as u8), a)).collect();
        let (tx, _) = mint_batch(&config, test_lock(0xF0), &recipients, test_input(0x20));
        for (i, &expected_amount) in amounts.iter().enumerate() {
            let parsed = u128::from_le_bytes(tx.outputs[i].data[0..16].try_into().unwrap());
            assert_eq!(parsed, expected_amount);
        }
    }

    #[test]
    fn test_transfer_two_inputs_combined_sufficient_v5() {
        let config = test_xudt_config();
        let type_script = super::super::Script {
            code_hash: config.xudt_code_hash,
            hash_type: config.xudt_hash_type.clone(),
            args: build_xudt_args(&[0x01; 32]),
        };
        let result = transfer_token(
            &config, type_script, test_lock(0x01), test_lock(0x02), 150,
            vec![(test_input(0x10), 80), (test_input(0x11), 80)],
        );
        assert!(result.is_ok());
        let tx = result.unwrap();
        let recipient_amount = u128::from_le_bytes(tx.outputs[0].data[0..16].try_into().unwrap());
        assert_eq!(recipient_amount, 150);
        let change_amount = u128::from_le_bytes(tx.outputs[1].data[0..16].try_into().unwrap());
        assert_eq!(change_amount, 10);
    }

    #[test]
    fn test_transfer_two_inputs_combined_insufficient_v5() {
        let config = test_xudt_config();
        let type_script = super::super::Script {
            code_hash: config.xudt_code_hash,
            hash_type: config.xudt_hash_type.clone(),
            args: build_xudt_args(&[0x01; 32]),
        };
        let result = transfer_token(
            &config, type_script, test_lock(0x01), test_lock(0x02), 200,
            vec![(test_input(0x10), 80), (test_input(0x11), 80)],
        );
        assert!(result.is_err());
    }

    #[test]
    fn test_burn_from_two_inputs_combined_v5() {
        let config = test_xudt_config();
        let type_script = super::super::Script {
            code_hash: config.xudt_code_hash,
            hash_type: config.xudt_hash_type.clone(),
            args: build_xudt_args(&[0x01; 32]),
        };
        let tx = burn_token(
            &config, type_script, 120, test_lock(0x01),
            vec![(test_input(0x10), 80), (test_input(0x11), 80)],
        ).unwrap();
        assert_eq!(tx.outputs.len(), 1);
        let remaining = u128::from_le_bytes(tx.outputs[0].data[0..16].try_into().unwrap());
        assert_eq!(remaining, 40);
    }

    #[test]
    fn test_compute_token_type_hash_consistency_v5() {
        let code_hash = [0xAA; 32];
        let lock_hash = [0xBB; 32];
        let h1 = compute_token_type_hash(&code_hash, &super::super::HashType::Data1, &lock_hash);
        let h2 = compute_token_type_hash(&code_hash, &super::super::HashType::Data1, &lock_hash);
        assert_eq!(h1, h2);
        // Different lock hash should differ
        let h3 = compute_token_type_hash(&code_hash, &super::super::HashType::Data1, &[0xCC; 32]);
        assert_ne!(h1, h3);
    }

    #[test]
    fn test_token_info_decimals_zero_v5() {
        let info = TokenInfo {
            name: "Nodec".to_string(),
            symbol: "ND".to_string(),
            decimals: 0,
            description: "Zero decimals".to_string(),
            max_supply: 1_000_000,
        };
        let data = info.serialize();
        let parsed = TokenInfo::deserialize(&data).unwrap();
        assert_eq!(parsed.decimals, 0);
    }

    #[test]
    fn test_token_info_decimals_255_v5() {
        let info = TokenInfo {
            name: "Max".to_string(),
            symbol: "MX".to_string(),
            decimals: 255,
            description: "".to_string(),
            max_supply: 0,
        };
        let data = info.serialize();
        let parsed = TokenInfo::deserialize(&data).unwrap();
        assert_eq!(parsed.decimals, 255);
    }

    #[test]
    fn test_create_token_info_type_script_args_is_token_type_hash_v5() {
        let config = test_xudt_config();
        let token_type_hash = [0x42; 32];
        let info = TokenInfo {
            name: "T".to_string(),
            symbol: "T".to_string(),
            decimals: 8,
            description: "".to_string(),
            max_supply: 0,
        };
        let tx = create_token_info(&config, token_type_hash, &info, test_lock(0x01), test_input(0x10));
        let output_type = tx.outputs[0].type_script.as_ref().unwrap();
        assert_eq!(output_type.args, token_type_hash.to_vec());
    }

    #[test]
    fn test_xudt_flags_plain_is_all_zeros_v5() {
        assert_eq!(XUDT_FLAGS_PLAIN, [0x00, 0x00, 0x00, 0x00]);
    }

    #[test]
    fn test_token_cell_capacity_reasonable_v5() {
        // Token cell capacity should be at least 100 CKB (10 billion shannons)
        assert!(TOKEN_CELL_CAPACITY >= 10_000_000_000);
        // But not more than 1000 CKB
        assert!(TOKEN_CELL_CAPACITY <= 100_000_000_000);
    }

    #[test]
    fn test_token_info_cell_capacity_larger_than_token_cell_v5() {
        assert!(TOKEN_INFO_CELL_CAPACITY > TOKEN_CELL_CAPACITY);
    }

    #[test]
    fn test_mint_token_input_count_is_one_v5() {
        let config = test_xudt_config();
        let (tx, _) = mint_token(&config, test_lock(0x01), test_lock(0x02), 100, test_input(0x10));
        assert_eq!(tx.inputs.len(), 1);
    }

    #[test]
    fn test_mint_token_output_count_is_one_v5() {
        let config = test_xudt_config();
        let (tx, _) = mint_token(&config, test_lock(0x01), test_lock(0x02), 100, test_input(0x10));
        assert_eq!(tx.outputs.len(), 1);
    }

    #[test]
    fn test_mint_batch_input_count_is_one_v5() {
        let config = test_xudt_config();
        let recipients = vec![(test_lock(0x01), 100), (test_lock(0x02), 200)];
        let (tx, _) = mint_batch(&config, test_lock(0x10), &recipients, test_input(0x20));
        assert_eq!(tx.inputs.len(), 1);
    }

    // ============ Hardening Tests (Round 6) ============

    #[test]
    fn test_token_info_roundtrip_with_emoji_description() {
        let info = TokenInfo {
            name: "TestToken".to_string(),
            symbol: "TT".to_string(),
            decimals: 8,
            description: "A token with special chars: @#$%".to_string(),
            max_supply: 1_000_000,
        };
        let data = info.serialize();
        let restored = TokenInfo::deserialize(&data).unwrap();
        assert_eq!(restored.name, "TestToken");
        assert_eq!(restored.symbol, "TT");
        assert_eq!(restored.decimals, 8);
        assert_eq!(restored.description, "A token with special chars: @#$%");
        assert_eq!(restored.max_supply, 1_000_000);
    }

    #[test]
    fn test_token_info_roundtrip_empty_description() {
        let info = TokenInfo {
            name: "X".to_string(),
            symbol: "X".to_string(),
            decimals: 0,
            description: "".to_string(),
            max_supply: 0,
        };
        let data = info.serialize();
        let restored = TokenInfo::deserialize(&data).unwrap();
        assert_eq!(restored.description, "");
        assert_eq!(restored.max_supply, 0);
    }

    #[test]
    fn test_token_info_serialize_length_predictable() {
        let info = TokenInfo {
            name: "ABC".to_string(),
            symbol: "AB".to_string(),
            decimals: 18,
            description: "Hello".to_string(),
            max_supply: 100,
        };
        let data = info.serialize();
        // 1 (decimals) + 2 (name_len) + 3 (name) + 2 (sym_len) + 2 (sym) + 2 (desc_len) + 5 (desc) + 16 (supply) = 33
        assert_eq!(data.len(), 33);
    }

    #[test]
    fn test_token_info_deserialize_extra_trailing_bytes_ok() {
        let info = TokenInfo {
            name: "T".to_string(),
            symbol: "T".to_string(),
            decimals: 1,
            description: "D".to_string(),
            max_supply: 42,
        };
        let mut data = info.serialize();
        data.extend_from_slice(&[0xFF, 0xFF, 0xFF]); // extra trailing bytes
        let restored = TokenInfo::deserialize(&data).unwrap();
        assert_eq!(restored.name, "T");
        assert_eq!(restored.max_supply, 42);
    }

    #[test]
    fn test_parse_token_amount_le_byte_order() {
        // 1 in little-endian u128 is [1, 0, 0, ..., 0]
        let mut data = [0u8; 16];
        data[0] = 1;
        let amount = parse_token_amount(&data).unwrap();
        assert_eq!(amount, 1);
    }

    #[test]
    fn test_parse_token_amount_large_value_le() {
        let val: u128 = 999_999_999_999_999_999;
        let data = val.to_le_bytes();
        let parsed = parse_token_amount(&data).unwrap();
        assert_eq!(parsed, val);
    }

    #[test]
    fn test_build_xudt_args_flags_at_end() {
        let hash = [0x42u8; 32];
        let args = build_xudt_args(&hash);
        assert_eq!(&args[32..36], &XUDT_FLAGS_PLAIN);
    }

    #[test]
    fn test_build_xudt_args_lock_hash_at_start() {
        let hash = [0x42u8; 32];
        let args = build_xudt_args(&hash);
        assert_eq!(&args[0..32], &hash);
    }

    #[test]
    fn test_transfer_produces_two_outputs_with_change() {
        let config = test_xudt_config();
        let type_script = super::super::Script {
            code_hash: [0xAA; 32],
            hash_type: super::super::HashType::Data1,
            args: vec![0x01; 36],
        };
        let tx = transfer_token(
            &config, type_script, test_lock(0x01), test_lock(0x02),
            50, vec![(test_input(0x10), 100)],
        ).unwrap();
        assert_eq!(tx.outputs.len(), 2);
        // First output: recipient with 50
        let recipient_amount = parse_token_amount(&tx.outputs[0].data).unwrap();
        assert_eq!(recipient_amount, 50);
        // Second output: sender change with 50
        let change_amount = parse_token_amount(&tx.outputs[1].data).unwrap();
        assert_eq!(change_amount, 50);
    }

    #[test]
    fn test_transfer_exact_amount_one_output() {
        let config = test_xudt_config();
        let type_script = super::super::Script {
            code_hash: [0xAA; 32],
            hash_type: super::super::HashType::Data1,
            args: vec![0x01; 36],
        };
        let tx = transfer_token(
            &config, type_script, test_lock(0x01), test_lock(0x02),
            100, vec![(test_input(0x10), 100)],
        ).unwrap();
        assert_eq!(tx.outputs.len(), 1);
    }

    #[test]
    fn test_transfer_insufficient_balance_error() {
        let config = test_xudt_config();
        let type_script = super::super::Script {
            code_hash: [0xAA; 32],
            hash_type: super::super::HashType::Data1,
            args: vec![0x01; 36],
        };
        let result = transfer_token(
            &config, type_script, test_lock(0x01), test_lock(0x02),
            200, vec![(test_input(0x10), 100)],
        );
        assert!(result.is_err());
    }

    #[test]
    fn test_burn_partial_leaves_remainder() {
        let config = test_xudt_config();
        let type_script = super::super::Script {
            code_hash: [0xAA; 32],
            hash_type: super::super::HashType::Data1,
            args: vec![0x01; 36],
        };
        let tx = burn_token(
            &config, type_script, 30, test_lock(0x01),
            vec![(test_input(0x10), 100)],
        ).unwrap();
        assert_eq!(tx.outputs.len(), 1);
        let remaining = parse_token_amount(&tx.outputs[0].data).unwrap();
        assert_eq!(remaining, 70);
    }

    #[test]
    fn test_burn_all_no_output() {
        let config = test_xudt_config();
        let type_script = super::super::Script {
            code_hash: [0xAA; 32],
            hash_type: super::super::HashType::Data1,
            args: vec![0x01; 36],
        };
        let tx = burn_token(
            &config, type_script, 100, test_lock(0x01),
            vec![(test_input(0x10), 100)],
        ).unwrap();
        assert_eq!(tx.outputs.len(), 0);
    }

    #[test]
    fn test_burn_insufficient_error() {
        let config = test_xudt_config();
        let type_script = super::super::Script {
            code_hash: [0xAA; 32],
            hash_type: super::super::HashType::Data1,
            args: vec![0x01; 36],
        };
        let result = burn_token(
            &config, type_script, 200, test_lock(0x01),
            vec![(test_input(0x10), 100)],
        );
        assert!(result.is_err());
    }

    #[test]
    fn test_mint_token_output_has_token_cell_capacity() {
        let config = test_xudt_config();
        let (tx, _) = mint_token(&config, test_lock(0x01), test_lock(0x02), 100, test_input(0x10));
        assert_eq!(tx.outputs[0].capacity, TOKEN_CELL_CAPACITY);
    }

    #[test]
    fn test_create_token_info_output_has_info_cell_capacity() {
        let config = test_xudt_config();
        let info = TokenInfo {
            name: "Test".to_string(),
            symbol: "TST".to_string(),
            decimals: 8,
            description: "desc".to_string(),
            max_supply: 0,
        };
        let tx = create_token_info(&config, [0xCC; 32], &info, test_lock(0x01), test_input(0x10));
        assert_eq!(tx.outputs[0].capacity, TOKEN_INFO_CELL_CAPACITY);
    }

    #[test]
    fn test_compute_token_type_hash_same_inputs_same_result() {
        let hash1 = compute_token_type_hash(
            &[0xAA; 32], &super::super::HashType::Data1, &[0x01; 32],
        );
        let hash2 = compute_token_type_hash(
            &[0xAA; 32], &super::super::HashType::Data1, &[0x01; 32],
        );
        assert_eq!(hash1, hash2);
    }

    #[test]
    fn test_compute_token_type_hash_different_issuer_different_result() {
        let hash1 = compute_token_type_hash(
            &[0xAA; 32], &super::super::HashType::Data1, &[0x01; 32],
        );
        let hash2 = compute_token_type_hash(
            &[0xAA; 32], &super::super::HashType::Data1, &[0x02; 32],
        );
        assert_ne!(hash1, hash2);
    }

    #[test]
    fn test_hash_type_byte_data_is_0() {
        assert_eq!(hash_type_byte(&super::super::HashType::Data), 0);
    }

    #[test]
    fn test_hash_type_byte_type_is_1() {
        assert_eq!(hash_type_byte(&super::super::HashType::Type), 1);
    }

    #[test]
    fn test_hash_type_byte_data1_is_2() {
        assert_eq!(hash_type_byte(&super::super::HashType::Data1), 2);
    }

    #[test]
    fn test_hash_type_byte_data2_is_4() {
        assert_eq!(hash_type_byte(&super::super::HashType::Data2), 4);
    }

    #[test]
    fn test_token_info_decimals_boundary_0() {
        let info = TokenInfo {
            name: "A".to_string(),
            symbol: "A".to_string(),
            decimals: 0,
            description: "".to_string(),
            max_supply: 0,
        };
        let data = info.serialize();
        assert_eq!(data[0], 0);
        let restored = TokenInfo::deserialize(&data).unwrap();
        assert_eq!(restored.decimals, 0);
    }

    #[test]
    fn test_token_info_decimals_boundary_255() {
        let info = TokenInfo {
            name: "A".to_string(),
            symbol: "A".to_string(),
            decimals: 255,
            description: "".to_string(),
            max_supply: 0,
        };
        let data = info.serialize();
        assert_eq!(data[0], 255);
        let restored = TokenInfo::deserialize(&data).unwrap();
        assert_eq!(restored.decimals, 255);
    }

    #[test]
    fn test_token_info_max_supply_u128_max_roundtrip() {
        let info = TokenInfo {
            name: "A".to_string(),
            symbol: "A".to_string(),
            decimals: 18,
            description: "".to_string(),
            max_supply: u128::MAX,
        };
        let data = info.serialize();
        let restored = TokenInfo::deserialize(&data).unwrap();
        assert_eq!(restored.max_supply, u128::MAX);
    }

    #[test]
    fn test_transfer_multiple_inputs_summed_correctly() {
        let config = test_xudt_config();
        let type_script = super::super::Script {
            code_hash: [0xAA; 32],
            hash_type: super::super::HashType::Data1,
            args: vec![0x01; 36],
        };
        let tx = transfer_token(
            &config, type_script, test_lock(0x01), test_lock(0x02),
            100,
            vec![
                (test_input(0x10), 40),
                (test_input(0x11), 30),
                (test_input(0x12), 50),
            ],
        ).unwrap();
        // 40+30+50=120, transfer 100, change 20
        assert_eq!(tx.outputs.len(), 2);
        let change = parse_token_amount(&tx.outputs[1].data).unwrap();
        assert_eq!(change, 20);
    }

    #[test]
    fn test_mint_batch_output_count_matches_recipients() {
        let config = test_xudt_config();
        let recipients = vec![
            (test_lock(0x01), 100),
            (test_lock(0x02), 200),
            (test_lock(0x03), 300),
        ];
        let (tx, _) = mint_batch(&config, test_lock(0x10), &recipients, test_input(0x20));
        assert_eq!(tx.outputs.len(), 3);
    }

    #[test]
    fn test_mint_batch_each_output_amount_matches() {
        let config = test_xudt_config();
        let recipients = vec![
            (test_lock(0x01), 111),
            (test_lock(0x02), 222),
        ];
        let (tx, _) = mint_batch(&config, test_lock(0x10), &recipients, test_input(0x20));
        let a0 = parse_token_amount(&tx.outputs[0].data).unwrap();
        let a1 = parse_token_amount(&tx.outputs[1].data).unwrap();
        assert_eq!(a0, 111);
        assert_eq!(a1, 222);
    }

    #[test]
    fn test_parse_token_amount_exactly_16_zeros() {
        let data = [0u8; 16];
        let amount = parse_token_amount(&data).unwrap();
        assert_eq!(amount, 0);
    }

    #[test]
    fn test_parse_token_amount_15_bytes_too_short() {
        let data = [0u8; 15];
        assert!(parse_token_amount(&data).is_none());
    }

    #[test]
    fn test_token_info_deserialize_empty_returns_none() {
        assert!(TokenInfo::deserialize(&[]).is_none());
    }

    #[test]
    fn test_xudt_flags_plain_all_zeros() {
        assert_eq!(XUDT_FLAGS_PLAIN, [0, 0, 0, 0]);
    }

    #[test]
    fn test_token_cell_capacity_vs_info_capacity() {
        assert!(TOKEN_INFO_CELL_CAPACITY > TOKEN_CELL_CAPACITY);
    }
}
