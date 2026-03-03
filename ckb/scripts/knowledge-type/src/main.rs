// ============ Knowledge Type Script — CKB-VM Entry Point ============
// Type script validating knowledge cell state transitions for
// PoW-gated shared state used by Jarvis multi-instance sync.

#![cfg_attr(feature = "ckb", no_std)]
#![cfg_attr(feature = "ckb", no_main)]

#[cfg(feature = "ckb")]
ckb_std::default_alloc!();

#[cfg(feature = "ckb")]
ckb_std::entry!(program);

// ============ CKB-VM Entry Point ============

#[cfg(feature = "ckb")]
fn program() -> i8 {
    use ckb_std::ckb_constants::Source;
    use ckb_std::high_level::{load_cell_data, load_script};

    // Load type script to get args (key_hash)
    let _script = match load_script() {
        Ok(s) => s,
        Err(_) => return -1,
    };

    // Try to load input cell data (None for creation)
    let input_data = load_cell_data(0, Source::GroupInput).ok();

    // Try to load output cell data (None for destruction)
    let output_data = load_cell_data(0, Source::GroupOutput).ok();

    match (input_data.as_ref(), output_data.as_ref()) {
        // Creation: no input, has output
        (None, Some(out)) => {
            match knowledge_type::verify_creation(out) {
                Ok(()) => 0,
                Err(_) => -2,
            }
        }
        // Update: has input, has output
        (Some(inp), Some(out)) => {
            match knowledge_type::verify_update(inp, out) {
                Ok(()) => 0,
                Err(_) => -3,
            }
        }
        // Destruction: has input, no output
        (Some(inp), None) => {
            match knowledge_type::verify_destruction(inp) {
                Ok(()) => 0,
                Err(_) => -4,
            }
        }
        // Invalid: no input and no output
        (None, None) => -5,
    }
}

// ============ Native Entry Point ============

#[cfg(not(feature = "ckb"))]
fn main() {
    println!("Knowledge Type Script — compile with --features ckb for CKB-VM");
}

// ============ Tests ============

#[cfg(test)]
mod tests {
    use knowledge_type::*;
    use vibeswap_types::{KnowledgeCellData, KNOWLEDGE_MIN_DIFFICULTY};

    #[test]
    fn test_valid_creation() {
        let genesis = KnowledgeCellData {
            key_hash: [0x01; 32],
            value_hash: [0xAA; 32],
            value_size: 256,
            prev_state_hash: [0u8; 32],
            mmr_root: [0u8; 32],
            update_count: 0,
            author_lock_hash: [0xFF; 32],
            timestamp_block: 100,
            difficulty: KNOWLEDGE_MIN_DIFFICULTY,
        };
        let bytes = genesis.serialize();
        assert!(verify_creation(&bytes).is_ok());
    }

    #[test]
    fn test_creation_wrong_counter_fails() {
        let data = KnowledgeCellData {
            key_hash: [0x01; 32],
            value_hash: [0xAA; 32],
            value_size: 256,
            prev_state_hash: [0u8; 32],
            mmr_root: [0u8; 32],
            update_count: 5, // Not genesis
            author_lock_hash: [0xFF; 32],
            timestamp_block: 100,
            difficulty: KNOWLEDGE_MIN_DIFFICULTY,
        };
        let bytes = data.serialize();
        assert_eq!(verify_creation(&bytes), Err(KnowledgeError::NonZeroGenesisCounter));
    }

    #[test]
    fn test_destroy_genesis_not_allowed() {
        let data = KnowledgeCellData {
            key_hash: [0x01; 32],
            value_hash: [0xAA; 32],
            value_size: 256,
            prev_state_hash: [0u8; 32],
            mmr_root: [0u8; 32],
            update_count: 0,
            author_lock_hash: [0xFF; 32],
            timestamp_block: 100,
            difficulty: KNOWLEDGE_MIN_DIFFICULTY,
        };
        let bytes = data.serialize();
        assert_eq!(verify_destruction(&bytes), Err(KnowledgeError::DestroyGenesisCell));
    }

    #[test]
    fn test_destroy_with_history_ok() {
        let data = KnowledgeCellData {
            key_hash: [0x01; 32],
            value_hash: [0xAA; 32],
            value_size: 256,
            prev_state_hash: [0x11; 32],
            mmr_root: [0x22; 32],
            update_count: 10,
            author_lock_hash: [0xFF; 32],
            timestamp_block: 1000,
            difficulty: KNOWLEDGE_MIN_DIFFICULTY,
        };
        let bytes = data.serialize();
        assert!(verify_destruction(&bytes).is_ok());
    }
}
