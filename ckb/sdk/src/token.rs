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
}
