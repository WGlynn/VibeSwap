// ============ Transaction Assembler ============
// Takes UnsignedTransaction → assembles witnesses → produces SignedTransaction.
//
// CKB transaction signing flow:
// 1. Serialize raw transaction (without witnesses) → tx_hash
// 2. For each lock group (inputs sharing a lock script):
//    a. Build WitnessArgs with empty lock field (65 zero bytes for secp256k1)
//    b. Hash: message = tx_hash || witness_group_hash
//    c. Sign message → fill lock field with signature
// 3. Assemble SignedTransaction with populated witnesses
//
// This module handles the full pipeline from UnsignedTransaction to
// a byte-level representation ready for RPC submission.

use sha2::{Digest, Sha256};
use super::{UnsignedTransaction, CellInput, CellOutput, CellDep, Script, DepType, HashType};

// ============ Constants ============

/// Secp256k1 signature size: 65 bytes (r[32] || s[32] || recovery_id[1])
pub const SECP256K1_SIGNATURE_SIZE: usize = 65;

/// Empty witness lock placeholder for secp256k1 signing
pub const EMPTY_WITNESS_LOCK: [u8; SECP256K1_SIGNATURE_SIZE] = [0u8; SECP256K1_SIGNATURE_SIZE];

/// Minimum transaction fee: 1000 shannons (0.00001 CKB)
pub const MIN_FEE: u64 = 1_000;

/// Fee rate: shannons per byte of serialized transaction
/// CKB default minimum: 1000 shannons per KB = 1 shannon per byte
pub const DEFAULT_FEE_RATE: u64 = 1;

// ============ Error Types ============

#[derive(Debug, Clone, PartialEq)]
pub enum AssemblerError {
    /// No inputs in transaction
    EmptyTransaction,
    /// Witness count doesn't match input count
    WitnessMismatch { inputs: usize, witnesses: usize },
    /// Signing callback returned an error
    SigningFailed(String),
    /// Fee exceeds available capacity change
    InsufficientFeeCapacity { fee: u64, available: u64 },
    /// Serialization error
    SerializationError(String),
    /// Lock group has no inputs
    EmptyLockGroup,
    /// Duplicate input (same outpoint)
    DuplicateInput { tx_hash: [u8; 32], index: u32 },
}

// ============ Witness Types ============

/// CKB WitnessArgs structure (Molecule serialization)
/// lock: Option<Bytes> — signature bytes
/// input_type: Option<Bytes> — type script witness for input cells
/// output_type: Option<Bytes> — type script witness for output cells
#[derive(Clone, Debug, Default)]
pub struct WitnessArgs {
    pub lock: Option<Vec<u8>>,
    pub input_type: Option<Vec<u8>>,
    pub output_type: Option<Vec<u8>>,
}

impl WitnessArgs {
    /// Create WitnessArgs with an empty lock placeholder for signing
    pub fn new_with_empty_lock() -> Self {
        Self {
            lock: Some(EMPTY_WITNESS_LOCK.to_vec()),
            input_type: None,
            output_type: None,
        }
    }

    /// Serialize to CKB Molecule format
    /// WitnessArgs is a table with 3 optional fields:
    /// [total_size:u32][offset0:u32][offset1:u32][offset2:u32][field0][field1][field2]
    /// Each field: None → empty bytes, Some(data) → [len:u32][data]
    pub fn serialize(&self) -> Vec<u8> {
        let fields: [&Option<Vec<u8>>; 3] = [&self.lock, &self.input_type, &self.output_type];
        let field_count = 3u32;
        let header_size = 4 + field_count * 4; // full_size(4) + 3 offsets(12) = 16

        // Calculate field byte sizes
        let field_sizes: Vec<u32> = fields.iter().map(|f| {
            match f {
                Some(data) => 4 + data.len() as u32, // [len:u32][data]
                None => 0,
            }
        }).collect();

        let total_size = header_size + field_sizes.iter().sum::<u32>();
        let mut buf = Vec::with_capacity(total_size as usize);

        // Total size (full_size encoding: includes itself)
        buf.extend_from_slice(&total_size.to_le_bytes());

        // Offsets (relative to start of buffer)
        let mut offset = header_size;
        for &size in &field_sizes {
            buf.extend_from_slice(&offset.to_le_bytes());
            offset += size;
        }

        // Field data
        for field in &fields {
            if let Some(data) = field {
                let len = data.len() as u32;
                buf.extend_from_slice(&(4 + len).to_le_bytes()); // Molecule bytes: [total_size][data]
                buf.extend_from_slice(data);
            }
        }

        buf
    }

    /// Deserialize from CKB Molecule format
    pub fn deserialize(data: &[u8]) -> Result<Self, AssemblerError> {
        if data.len() < 16 {
            return Err(AssemblerError::SerializationError(
                "WitnessArgs too short".into(),
            ));
        }

        let total_size = u32::from_le_bytes([data[0], data[1], data[2], data[3]]) as usize;
        if data.len() < total_size {
            return Err(AssemblerError::SerializationError(
                format!("WitnessArgs data too short: {} < {}", data.len(), total_size),
            ));
        }

        // Read 3 offsets
        let offset0 = u32::from_le_bytes([data[4], data[5], data[6], data[7]]) as usize;
        let offset1 = u32::from_le_bytes([data[8], data[9], data[10], data[11]]) as usize;
        let offset2 = u32::from_le_bytes([data[12], data[13], data[14], data[15]]) as usize;

        let offsets = [offset0, offset1, offset2, total_size];

        let mut fields = [None, None, None];
        for i in 0..3 {
            let start = offsets[i];
            let end = offsets[i + 1];
            if end > start {
                // Field present: [bytes_size:u32][data]
                if start + 4 > data.len() {
                    return Err(AssemblerError::SerializationError(
                        "WitnessArgs field offset out of bounds".into(),
                    ));
                }
                let field_total = u32::from_le_bytes([
                    data[start], data[start + 1], data[start + 2], data[start + 3],
                ]) as usize;
                let field_data_len = field_total.saturating_sub(4);
                if start + 4 + field_data_len > data.len() {
                    return Err(AssemblerError::SerializationError(
                        "WitnessArgs field data out of bounds".into(),
                    ));
                }
                fields[i] = Some(data[start + 4..start + 4 + field_data_len].to_vec());
            }
        }

        Ok(Self {
            lock: fields[0].take(),
            input_type: fields[1].take(),
            output_type: fields[2].take(),
        })
    }
}

// ============ Signing Interface ============

/// Trait for signing CKB transactions
/// Implementors provide the actual cryptographic signing (secp256k1, etc.)
pub trait Signer {
    /// Sign a 32-byte message, returning a 65-byte recoverable signature
    fn sign(&self, message: &[u8; 32]) -> Result<[u8; SECP256K1_SIGNATURE_SIZE], String>;

    /// Return the lock script this signer controls
    fn lock_script(&self) -> Script;
}

/// A no-op signer for testing — produces deterministic "signatures"
pub struct MockSigner {
    pub lock: Script,
    pub signature: [u8; SECP256K1_SIGNATURE_SIZE],
}

impl MockSigner {
    pub fn new(lock: Script) -> Self {
        let seed = lock.code_hash[0];
        let mut sig = [0u8; SECP256K1_SIGNATURE_SIZE];
        // Fill with recognizable pattern derived from lock identity
        for (i, byte) in sig.iter_mut().enumerate() {
            *byte = (i as u8).wrapping_mul(0x37).wrapping_add(seed);
        }
        Self { lock, signature: sig }
    }
}

impl Signer for MockSigner {
    fn sign(&self, _message: &[u8; 32]) -> Result<[u8; SECP256K1_SIGNATURE_SIZE], String> {
        Ok(self.signature)
    }

    fn lock_script(&self) -> Script {
        self.lock.clone()
    }
}

// ============ Signed Transaction ============

/// A fully signed CKB transaction ready for submission
#[derive(Clone, Debug)]
pub struct SignedTransaction {
    pub cell_deps: Vec<CellDep>,
    pub inputs: Vec<CellInput>,
    pub outputs: Vec<CellOutput>,
    pub witnesses: Vec<Vec<u8>>,
}

impl SignedTransaction {
    /// Compute the transaction hash (Blake2b-256 of raw transaction)
    /// For our implementation, we use SHA-256 to match our existing hash infrastructure
    pub fn tx_hash(&self) -> [u8; 32] {
        hash_raw_transaction(&self.cell_deps, &self.inputs, &self.outputs)
    }

    /// Estimate serialized size in bytes
    pub fn estimated_size(&self) -> usize {
        estimate_tx_size(&self.cell_deps, &self.inputs, &self.outputs, &self.witnesses)
    }
}

// ============ Lock Groups ============

/// A group of inputs that share the same lock script hash
/// CKB groups inputs by lock script — one signature covers the group
#[derive(Debug)]
struct LockGroup {
    /// Hash of the shared lock script
    lock_hash: [u8; 32],
    /// Indices into the transaction's inputs array
    input_indices: Vec<usize>,
}

/// Group transaction inputs by their lock script hash
#[allow(dead_code)]
fn group_inputs_by_lock(inputs: &[CellInput], outputs: &[CellOutput], _unsigned: &UnsignedTransaction) -> Vec<LockGroup> {
    // We need the lock script for each input, but CellInput only has outpoint.
    // In a real implementation, we'd query the chain for input cells.
    // For our SDK, inputs correspond 1:1 to the outputs in the builder pattern.
    // Convention: the lock script for input[i] comes from unsigned.outputs[i].lock_script
    // when available, otherwise we derive from the first output.
    //
    // This is the SDK convention — builder functions set outputs with the correct locks.
    // For a more general assembler, input cell data would be fetched from the indexer.

    let mut groups: Vec<LockGroup> = Vec::new();

    for (i, _input) in inputs.iter().enumerate() {
        // Use the corresponding output's lock script if available,
        // otherwise use the first output's lock
        let lock = if i < outputs.len() {
            &outputs[i].lock_script
        } else if !outputs.is_empty() {
            &outputs[0].lock_script
        } else {
            continue;
        };

        let lock_hash = hash_script_bytes(lock);

        // Find existing group or create new one
        let found = groups.iter_mut().find(|g| g.lock_hash == lock_hash);
        match found {
            Some(group) => group.input_indices.push(i),
            None => groups.push(LockGroup {
                lock_hash,
                input_indices: vec![i],
            }),
        }
    }

    groups
}

// ============ Transaction Hashing ============

/// Hash a raw transaction (without witnesses) to produce the tx_hash
/// This is the message base for signing
fn hash_raw_transaction(
    cell_deps: &[CellDep],
    inputs: &[CellInput],
    outputs: &[CellOutput],
) -> [u8; 32] {
    let mut hasher = Sha256::new();

    // Hash cell deps
    hasher.update(&(cell_deps.len() as u32).to_le_bytes());
    for dep in cell_deps {
        hasher.update(&dep.tx_hash);
        hasher.update(&dep.index.to_le_bytes());
        hasher.update(&[match dep.dep_type { DepType::Code => 0, DepType::DepGroup => 1 }]);
    }

    // Hash inputs
    hasher.update(&(inputs.len() as u32).to_le_bytes());
    for input in inputs {
        hasher.update(&input.tx_hash);
        hasher.update(&input.index.to_le_bytes());
        hasher.update(&input.since.to_le_bytes());
    }

    // Hash outputs
    hasher.update(&(outputs.len() as u32).to_le_bytes());
    for output in outputs {
        hasher.update(&output.capacity.to_le_bytes());
        hash_script_into(&output.lock_script, &mut hasher);
        match &output.type_script {
            Some(ts) => {
                hasher.update(&[1u8]);
                hash_script_into(ts, &mut hasher);
            }
            None => hasher.update(&[0u8]),
        }
        hasher.update(&(output.data.len() as u32).to_le_bytes());
        hasher.update(&output.data);
    }

    let result = hasher.finalize();
    let mut hash = [0u8; 32];
    hash.copy_from_slice(&result);
    hash
}

/// Hash a script into a Sha256 hasher
fn hash_script_into(script: &Script, hasher: &mut Sha256) {
    hasher.update(&script.code_hash);
    hasher.update(&[match script.hash_type {
        HashType::Data => 0,
        HashType::Type => 1,
        HashType::Data1 => 2,
        HashType::Data2 => 3,
    }]);
    hasher.update(&(script.args.len() as u32).to_le_bytes());
    hasher.update(&script.args);
}

/// Compute the signing message for a lock group
/// message = SHA-256(tx_hash || witness_for_group || other_witnesses_in_group)
fn compute_signing_message(
    tx_hash: &[u8; 32],
    witness_args: &WitnessArgs,
    extra_witnesses: &[&[u8]],
) -> [u8; 32] {
    let serialized_witness = witness_args.serialize();

    let mut hasher = Sha256::new();
    hasher.update(tx_hash);

    // Hash first witness (with empty lock placeholder)
    hasher.update(&(serialized_witness.len() as u64).to_le_bytes());
    hasher.update(&serialized_witness);

    // Hash remaining witnesses in the group
    for w in extra_witnesses {
        hasher.update(&(w.len() as u64).to_le_bytes());
        hasher.update(w);
    }

    let result = hasher.finalize();
    let mut msg = [0u8; 32];
    msg.copy_from_slice(&result);
    msg
}

// ============ Fee Estimation ============

/// Estimate transaction serialized size in bytes
fn estimate_tx_size(
    cell_deps: &[CellDep],
    inputs: &[CellInput],
    outputs: &[CellOutput],
    witnesses: &[Vec<u8>],
) -> usize {
    let mut size = 0usize;

    // Header (version + cell_deps_count + inputs_count + outputs_count + witnesses_count)
    size += 4 + 4 + 4 + 4 + 4;

    // Cell deps: tx_hash(32) + index(4) + dep_type(1) = 37 each
    size += cell_deps.len() * 37;

    // Inputs: tx_hash(32) + index(4) + since(8) = 44 each
    size += inputs.len() * 44;

    // Outputs: capacity(8) + lock(32+1+4+args_len) + type_script(optional) + data_len(4) + data
    for output in outputs {
        size += 8; // capacity
        size += 32 + 1 + 4 + output.lock_script.args.len(); // lock script
        match &output.type_script {
            Some(ts) => size += 1 + 32 + 1 + 4 + ts.args.len(),
            None => size += 1,
        }
        size += 4 + output.data.len(); // data
    }

    // Witnesses
    for w in witnesses {
        size += 4 + w.len();
    }

    size
}

/// Calculate fee from transaction size
pub fn calculate_fee(tx_size: usize, fee_rate: u64) -> u64 {
    let fee = (tx_size as u64) * fee_rate;
    fee.max(MIN_FEE)
}

// ============ Assembler ============

/// Assemble a signed transaction from an unsigned transaction and signers
///
/// # Arguments
/// * `unsigned` - The unsigned transaction from a builder
/// * `signers` - Slice of signers, one per lock group
/// * `input_locks` - Lock scripts for each input (since CellInput doesn't carry lock info)
///
/// # Returns
/// SignedTransaction with populated witnesses
pub fn assemble(
    unsigned: &UnsignedTransaction,
    signers: &[&dyn Signer],
    input_locks: &[Script],
) -> Result<SignedTransaction, AssemblerError> {
    if unsigned.inputs.is_empty() {
        return Err(AssemblerError::EmptyTransaction);
    }

    if input_locks.len() != unsigned.inputs.len() {
        return Err(AssemblerError::WitnessMismatch {
            inputs: unsigned.inputs.len(),
            witnesses: input_locks.len(),
        });
    }

    // Check for duplicate inputs
    for i in 0..unsigned.inputs.len() {
        for j in (i + 1)..unsigned.inputs.len() {
            if unsigned.inputs[i].tx_hash == unsigned.inputs[j].tx_hash
                && unsigned.inputs[i].index == unsigned.inputs[j].index
            {
                return Err(AssemblerError::DuplicateInput {
                    tx_hash: unsigned.inputs[i].tx_hash,
                    index: unsigned.inputs[i].index,
                });
            }
        }
    }

    // Group inputs by lock script hash
    let mut groups: Vec<LockGroup> = Vec::new();
    for (i, lock) in input_locks.iter().enumerate() {
        let lock_hash = hash_script_bytes(lock);
        let found = groups.iter_mut().find(|g| g.lock_hash == lock_hash);
        match found {
            Some(group) => group.input_indices.push(i),
            None => groups.push(LockGroup {
                lock_hash,
                input_indices: vec![i],
            }),
        }
    }

    // Compute tx_hash
    let tx_hash = hash_raw_transaction(
        &unsigned.cell_deps,
        &unsigned.inputs,
        &unsigned.outputs,
    );

    // Build witnesses array (same length as inputs)
    let mut witnesses: Vec<Vec<u8>> = vec![vec![]; unsigned.inputs.len()];

    // Also include any extra witnesses beyond the input count
    // (some transactions carry additional data witnesses)
    let extra_witness_count = if unsigned.witnesses.len() > unsigned.inputs.len() {
        unsigned.witnesses.len() - unsigned.inputs.len()
    } else {
        0
    };

    // Sign each lock group
    for group in &groups {
        if group.input_indices.is_empty() {
            return Err(AssemblerError::EmptyLockGroup);
        }

        // Find the matching signer
        let signer = signers
            .iter()
            .find(|s| hash_script_bytes(&s.lock_script()) == group.lock_hash)
            .ok_or_else(|| {
                AssemblerError::SigningFailed(format!(
                    "No signer for lock hash {:?}",
                    &group.lock_hash[..4]
                ))
            })?;

        // The first input in the group gets a WitnessArgs with the signature
        let first_idx = group.input_indices[0];

        // Build WitnessArgs with empty lock for signing
        let mut witness_args = WitnessArgs::new_with_empty_lock();

        // Preserve input_type/output_type from the original witness if present
        if first_idx < unsigned.witnesses.len() && !unsigned.witnesses[first_idx].is_empty() {
            if let Ok(original) = WitnessArgs::deserialize(&unsigned.witnesses[first_idx]) {
                witness_args.input_type = original.input_type;
                witness_args.output_type = original.output_type;
            }
        }

        // Collect extra witnesses for the group (non-first inputs)
        let extra_group_witnesses: Vec<&[u8]> = group.input_indices[1..]
            .iter()
            .filter_map(|&idx| {
                if idx < unsigned.witnesses.len() {
                    Some(unsigned.witnesses[idx].as_slice())
                } else {
                    Some(&[] as &[u8])
                }
            })
            .collect();

        // Compute signing message
        let message = compute_signing_message(&tx_hash, &witness_args, &extra_group_witnesses);

        // Sign
        let signature = signer
            .sign(&message)
            .map_err(|e| AssemblerError::SigningFailed(e))?;

        // Fill in the lock field with the actual signature
        witness_args.lock = Some(signature.to_vec());

        // Serialize and place in witnesses array
        witnesses[first_idx] = witness_args.serialize();

        // Other inputs in the group get empty witnesses (CKB convention)
        for &idx in &group.input_indices[1..] {
            if idx < unsigned.witnesses.len() && !unsigned.witnesses[idx].is_empty() {
                witnesses[idx] = unsigned.witnesses[idx].clone();
            }
            // Otherwise leave as empty vec (already initialized)
        }
    }

    // Append extra witnesses (beyond input count)
    for i in 0..extra_witness_count {
        let src_idx = unsigned.inputs.len() + i;
        witnesses.push(unsigned.witnesses[src_idx].clone());
    }

    Ok(SignedTransaction {
        cell_deps: unsigned.cell_deps.clone(),
        inputs: unsigned.inputs.clone(),
        outputs: unsigned.outputs.clone(),
        witnesses,
    })
}

/// Quick sign for single-signer transactions (most common case)
pub fn assemble_single_signer(
    unsigned: &UnsignedTransaction,
    signer: &dyn Signer,
) -> Result<SignedTransaction, AssemblerError> {
    if unsigned.inputs.is_empty() {
        return Err(AssemblerError::EmptyTransaction);
    }

    let lock = signer.lock_script();
    let input_locks: Vec<Script> = (0..unsigned.inputs.len())
        .map(|_| lock.clone())
        .collect();

    assemble(unsigned, &[signer], &input_locks)
}

/// Estimate the fee for a transaction and adjust the last output's capacity
pub fn assemble_with_fee(
    unsigned: &mut UnsignedTransaction,
    signers: &[&dyn Signer],
    input_locks: &[Script],
    fee_rate: u64,
) -> Result<SignedTransaction, AssemblerError> {
    // First pass: estimate witnesses to get accurate size
    let estimated_witness_size = unsigned.inputs.len() * (WitnessArgs::new_with_empty_lock().serialize().len() + 4);
    let base_size = estimate_tx_size(
        &unsigned.cell_deps,
        &unsigned.inputs,
        &unsigned.outputs,
        &unsigned.witnesses,
    );
    let total_estimated_size = base_size + estimated_witness_size;
    let fee = calculate_fee(total_estimated_size, fee_rate);

    // Deduct fee from the last output's capacity
    if let Some(last_output) = unsigned.outputs.last_mut() {
        if last_output.capacity < fee {
            return Err(AssemblerError::InsufficientFeeCapacity {
                fee,
                available: last_output.capacity,
            });
        }
        last_output.capacity -= fee;
    }

    assemble(unsigned, signers, input_locks)
}

// ============ Validation ============

/// Validate an unsigned transaction before signing
pub fn validate_unsigned(tx: &UnsignedTransaction) -> Result<(), AssemblerError> {
    if tx.inputs.is_empty() {
        return Err(AssemblerError::EmptyTransaction);
    }

    // Check for duplicate inputs
    for i in 0..tx.inputs.len() {
        for j in (i + 1)..tx.inputs.len() {
            if tx.inputs[i].tx_hash == tx.inputs[j].tx_hash
                && tx.inputs[i].index == tx.inputs[j].index
            {
                return Err(AssemblerError::DuplicateInput {
                    tx_hash: tx.inputs[i].tx_hash,
                    index: tx.inputs[i].index,
                });
            }
        }
    }

    Ok(())
}

// ============ Helpers ============

/// Hash a Script to 32 bytes
fn hash_script_bytes(script: &Script) -> [u8; 32] {
    let mut hasher = Sha256::new();
    hasher.update(&script.code_hash);
    hasher.update(&[match script.hash_type {
        HashType::Data => 0,
        HashType::Type => 1,
        HashType::Data1 => 2,
        HashType::Data2 => 3,
    }]);
    hasher.update(&script.args);
    let result = hasher.finalize();
    let mut hash = [0u8; 32];
    hash.copy_from_slice(&result);
    hash
}

// ============ Tests ============

#[cfg(test)]
mod tests {
    use super::*;

    fn test_script(id: u8) -> Script {
        Script {
            code_hash: [id; 32],
            hash_type: HashType::Type,
            args: vec![id; 20],
        }
    }

    fn test_input(id: u8) -> CellInput {
        CellInput {
            tx_hash: [id; 32],
            index: id as u32,
            since: 0,
        }
    }

    fn test_output(id: u8, capacity: u64) -> CellOutput {
        CellOutput {
            capacity,
            lock_script: test_script(id),
            type_script: None,
            data: vec![],
        }
    }

    fn test_unsigned(num_inputs: usize) -> UnsignedTransaction {
        UnsignedTransaction {
            cell_deps: vec![CellDep {
                tx_hash: [0xFF; 32],
                index: 0,
                dep_type: DepType::DepGroup,
            }],
            inputs: (0..num_inputs).map(|i| test_input(i as u8 + 1)).collect(),
            outputs: (0..num_inputs).map(|i| test_output(i as u8 + 1, 100_000_000_000)).collect(),
            witnesses: vec![vec![]; num_inputs],
        }
    }

    // ============ WitnessArgs Tests ============

    #[test]
    fn test_witness_args_empty_roundtrip() {
        let wa = WitnessArgs::default();
        let bytes = wa.serialize();
        let decoded = WitnessArgs::deserialize(&bytes).unwrap();
        assert!(decoded.lock.is_none());
        assert!(decoded.input_type.is_none());
        assert!(decoded.output_type.is_none());
    }

    #[test]
    fn test_witness_args_lock_only_roundtrip() {
        let wa = WitnessArgs {
            lock: Some(vec![0x01, 0x02, 0x03]),
            input_type: None,
            output_type: None,
        };
        let bytes = wa.serialize();
        let decoded = WitnessArgs::deserialize(&bytes).unwrap();
        assert_eq!(decoded.lock.unwrap(), vec![0x01, 0x02, 0x03]);
        assert!(decoded.input_type.is_none());
        assert!(decoded.output_type.is_none());
    }

    #[test]
    fn test_witness_args_all_fields_roundtrip() {
        let wa = WitnessArgs {
            lock: Some(vec![0xAA; 65]),
            input_type: Some(vec![0xBB; 32]),
            output_type: Some(vec![0xCC; 16]),
        };
        let bytes = wa.serialize();
        let decoded = WitnessArgs::deserialize(&bytes).unwrap();
        assert_eq!(decoded.lock.unwrap(), vec![0xAA; 65]);
        assert_eq!(decoded.input_type.unwrap(), vec![0xBB; 32]);
        assert_eq!(decoded.output_type.unwrap(), vec![0xCC; 16]);
    }

    #[test]
    fn test_witness_args_empty_lock_placeholder() {
        let wa = WitnessArgs::new_with_empty_lock();
        assert_eq!(wa.lock.as_ref().unwrap().len(), SECP256K1_SIGNATURE_SIZE);
        assert!(wa.lock.as_ref().unwrap().iter().all(|&b| b == 0));
    }

    #[test]
    fn test_witness_args_deserialize_too_short() {
        assert!(WitnessArgs::deserialize(&[0; 10]).is_err());
    }

    // ============ Transaction Hashing Tests ============

    #[test]
    fn test_tx_hash_deterministic() {
        let tx = test_unsigned(2);
        let h1 = hash_raw_transaction(&tx.cell_deps, &tx.inputs, &tx.outputs);
        let h2 = hash_raw_transaction(&tx.cell_deps, &tx.inputs, &tx.outputs);
        assert_eq!(h1, h2);
    }

    #[test]
    fn test_tx_hash_changes_with_inputs() {
        let tx1 = test_unsigned(1);
        let tx2 = test_unsigned(2);
        let h1 = hash_raw_transaction(&tx1.cell_deps, &tx1.inputs, &tx1.outputs);
        let h2 = hash_raw_transaction(&tx2.cell_deps, &tx2.inputs, &tx2.outputs);
        assert_ne!(h1, h2);
    }

    #[test]
    fn test_tx_hash_changes_with_outputs() {
        let mut tx1 = test_unsigned(1);
        let tx2 = test_unsigned(1);
        tx1.outputs[0].capacity = 999;
        let h1 = hash_raw_transaction(&tx1.cell_deps, &tx1.inputs, &tx1.outputs);
        let h2 = hash_raw_transaction(&tx2.cell_deps, &tx2.inputs, &tx2.outputs);
        assert_ne!(h1, h2);
    }

    // ============ Signing Message Tests ============

    #[test]
    fn test_signing_message_deterministic() {
        let tx_hash = [0x42; 32];
        let wa = WitnessArgs::new_with_empty_lock();
        let m1 = compute_signing_message(&tx_hash, &wa, &[]);
        let m2 = compute_signing_message(&tx_hash, &wa, &[]);
        assert_eq!(m1, m2);
    }

    #[test]
    fn test_signing_message_changes_with_tx_hash() {
        let wa = WitnessArgs::new_with_empty_lock();
        let m1 = compute_signing_message(&[0x01; 32], &wa, &[]);
        let m2 = compute_signing_message(&[0x02; 32], &wa, &[]);
        assert_ne!(m1, m2);
    }

    #[test]
    fn test_signing_message_with_extra_witnesses() {
        let tx_hash = [0x42; 32];
        let wa = WitnessArgs::new_with_empty_lock();
        let m1 = compute_signing_message(&tx_hash, &wa, &[]);
        let m2 = compute_signing_message(&tx_hash, &wa, &[&[0x01, 0x02]]);
        assert_ne!(m1, m2);
    }

    // ============ Fee Estimation Tests ============

    #[test]
    fn test_fee_calculation_minimum() {
        assert_eq!(calculate_fee(100, 1), MIN_FEE);
    }

    #[test]
    fn test_fee_calculation_above_minimum() {
        assert_eq!(calculate_fee(2000, 1), 2000);
    }

    #[test]
    fn test_estimate_tx_size_increases_with_outputs() {
        let tx1 = test_unsigned(1);
        let tx2 = test_unsigned(3);
        let s1 = estimate_tx_size(&tx1.cell_deps, &tx1.inputs, &tx1.outputs, &tx1.witnesses);
        let s2 = estimate_tx_size(&tx2.cell_deps, &tx2.inputs, &tx2.outputs, &tx2.witnesses);
        assert!(s2 > s1);
    }

    #[test]
    fn test_estimate_tx_size_with_data() {
        let mut tx = test_unsigned(1);
        let s1 = estimate_tx_size(&tx.cell_deps, &tx.inputs, &tx.outputs, &tx.witnesses);
        tx.outputs[0].data = vec![0u8; 100];
        let s2 = estimate_tx_size(&tx.cell_deps, &tx.inputs, &tx.outputs, &tx.witnesses);
        assert_eq!(s2, s1 + 100);
    }

    // ============ Mock Signer Tests ============

    #[test]
    fn test_mock_signer_produces_signature() {
        let signer = MockSigner::new(test_script(0x01));
        let msg = [0u8; 32];
        let sig = signer.sign(&msg).unwrap();
        assert_eq!(sig.len(), SECP256K1_SIGNATURE_SIZE);
    }

    #[test]
    fn test_mock_signer_deterministic() {
        let signer = MockSigner::new(test_script(0x01));
        let msg = [0u8; 32];
        let s1 = signer.sign(&msg).unwrap();
        let s2 = signer.sign(&msg).unwrap();
        assert_eq!(s1, s2);
    }

    // ============ Assembler Tests ============

    #[test]
    fn test_assemble_single_input() {
        let tx = test_unsigned(1);
        let signer = MockSigner::new(test_script(0x01));
        let locks = vec![test_script(0x01)];

        let signed = assemble(&tx, &[&signer], &locks).unwrap();
        assert_eq!(signed.inputs.len(), 1);
        assert_eq!(signed.witnesses.len(), 1);
        assert!(!signed.witnesses[0].is_empty());
    }

    #[test]
    fn test_assemble_multi_input_same_lock() {
        let mut tx = test_unsigned(3);
        // All inputs share the same lock
        for output in &mut tx.outputs {
            output.lock_script = test_script(0x01);
        }
        let signer = MockSigner::new(test_script(0x01));
        let locks = vec![test_script(0x01); 3];

        let signed = assemble(&tx, &[&signer], &locks).unwrap();
        assert_eq!(signed.witnesses.len(), 3);
        // First witness should have the signature (non-empty WitnessArgs)
        assert!(!signed.witnesses[0].is_empty());
    }

    #[test]
    fn test_assemble_multi_input_different_locks() {
        let tx = test_unsigned(2);
        let signer1 = MockSigner::new(test_script(0x01));
        let signer2 = MockSigner::new(test_script(0x02));
        let locks = vec![test_script(0x01), test_script(0x02)];

        let signed = assemble(&tx, &[&signer1, &signer2], &locks).unwrap();
        assert_eq!(signed.witnesses.len(), 2);
        // Both witnesses should be non-empty (each has its own signature)
        assert!(!signed.witnesses[0].is_empty());
        assert!(!signed.witnesses[1].is_empty());
    }

    #[test]
    fn test_assemble_single_signer_shortcut() {
        let tx = test_unsigned(2);
        let signer = MockSigner::new(test_script(0x01));

        // This should work even though inputs have different scripts in their outputs,
        // because assemble_single_signer assigns the signer's lock to all inputs
        let signed = assemble_single_signer(&tx, &signer).unwrap();
        assert_eq!(signed.witnesses.len(), 2);
    }

    #[test]
    fn test_assemble_empty_transaction() {
        let tx = UnsignedTransaction {
            cell_deps: vec![],
            inputs: vec![],
            outputs: vec![],
            witnesses: vec![],
        };
        let signer = MockSigner::new(test_script(0x01));
        assert!(matches!(
            assemble_single_signer(&tx, &signer),
            Err(AssemblerError::EmptyTransaction)
        ));
    }

    #[test]
    fn test_assemble_duplicate_input_detected() {
        let mut tx = test_unsigned(2);
        tx.inputs[1] = tx.inputs[0].clone(); // Duplicate
        let signer = MockSigner::new(test_script(0x01));
        let locks = vec![test_script(0x01); 2];

        assert!(matches!(
            assemble(&tx, &[&signer], &locks),
            Err(AssemblerError::DuplicateInput { .. })
        ));
    }

    #[test]
    fn test_assemble_no_matching_signer() {
        let tx = test_unsigned(1);
        let signer = MockSigner::new(test_script(0xFF)); // Wrong lock
        let locks = vec![test_script(0x01)]; // Input needs 0x01

        assert!(matches!(
            assemble(&tx, &[&signer], &locks),
            Err(AssemblerError::SigningFailed(_))
        ));
    }

    #[test]
    fn test_assemble_witness_lock_mismatch() {
        let tx = test_unsigned(2);
        let signer = MockSigner::new(test_script(0x01));
        let locks = vec![test_script(0x01)]; // Only 1 lock for 2 inputs

        assert!(matches!(
            assemble(&tx, &[&signer], &locks),
            Err(AssemblerError::WitnessMismatch { .. })
        ));
    }

    // ============ Fee Integration Tests ============

    #[test]
    fn test_assemble_with_fee_deducts_from_last_output() {
        let mut tx = test_unsigned(1);
        tx.outputs[0].capacity = 100_000_000_000; // 1000 CKB
        let signer = MockSigner::new(test_script(0x01));
        let locks = vec![test_script(0x01)];
        let original_cap = tx.outputs[0].capacity;

        let signed = assemble_with_fee(&mut tx, &[&signer], &locks, DEFAULT_FEE_RATE).unwrap();
        // Fee should have been deducted
        assert!(signed.outputs[0].capacity < original_cap);
    }

    #[test]
    fn test_assemble_with_fee_insufficient_capacity() {
        let mut tx = test_unsigned(1);
        tx.outputs[0].capacity = 100; // Way too little
        let signer = MockSigner::new(test_script(0x01));
        let locks = vec![test_script(0x01)];

        assert!(matches!(
            assemble_with_fee(&mut tx, &[&signer], &locks, DEFAULT_FEE_RATE),
            Err(AssemblerError::InsufficientFeeCapacity { .. })
        ));
    }

    // ============ SignedTransaction Tests ============

    #[test]
    fn test_signed_tx_hash_matches_raw() {
        let tx = test_unsigned(1);
        let signer = MockSigner::new(test_script(0x01));
        let signed = assemble_single_signer(&tx, &signer).unwrap();

        let raw_hash = hash_raw_transaction(&tx.cell_deps, &tx.inputs, &tx.outputs);
        assert_eq!(signed.tx_hash(), raw_hash);
    }

    #[test]
    fn test_signed_tx_estimated_size() {
        let tx = test_unsigned(2);
        let signer = MockSigner::new(test_script(0x01));
        let signed = assemble_single_signer(&tx, &signer).unwrap();
        assert!(signed.estimated_size() > 0);
    }

    // ============ Validation Tests ============

    #[test]
    fn test_validate_valid_transaction() {
        let tx = test_unsigned(2);
        assert!(validate_unsigned(&tx).is_ok());
    }

    #[test]
    fn test_validate_empty_transaction() {
        let tx = UnsignedTransaction {
            cell_deps: vec![],
            inputs: vec![],
            outputs: vec![],
            witnesses: vec![],
        };
        assert!(matches!(validate_unsigned(&tx), Err(AssemblerError::EmptyTransaction)));
    }

    #[test]
    fn test_validate_duplicate_inputs() {
        let mut tx = test_unsigned(2);
        tx.inputs[1] = tx.inputs[0].clone();
        assert!(matches!(validate_unsigned(&tx), Err(AssemblerError::DuplicateInput { .. })));
    }

    // ============ End-to-End Tests ============

    #[test]
    fn test_end_to_end_single_signer() {
        // Simulate: build unsigned tx → validate → assemble → verify
        let tx = test_unsigned(3);
        validate_unsigned(&tx).unwrap();

        let signer = MockSigner::new(test_script(0x01));
        let signed = assemble_single_signer(&tx, &signer).unwrap();

        // Verify structure
        assert_eq!(signed.inputs.len(), 3);
        assert_eq!(signed.outputs.len(), 3);
        assert_eq!(signed.witnesses.len(), 3);

        // First witness should be a valid WitnessArgs
        let wa = WitnessArgs::deserialize(&signed.witnesses[0]).unwrap();
        assert!(wa.lock.is_some());
        assert_eq!(wa.lock.unwrap().len(), SECP256K1_SIGNATURE_SIZE);
    }

    #[test]
    fn test_end_to_end_multi_signer() {
        let mut tx = test_unsigned(4);
        // 2 inputs with lock A, 2 with lock B
        tx.outputs[0].lock_script = test_script(0xAA);
        tx.outputs[1].lock_script = test_script(0xAA);
        tx.outputs[2].lock_script = test_script(0xBB);
        tx.outputs[3].lock_script = test_script(0xBB);

        let signer_a = MockSigner::new(test_script(0xAA));
        let signer_b = MockSigner::new(test_script(0xBB));
        let locks = vec![
            test_script(0xAA), test_script(0xAA),
            test_script(0xBB), test_script(0xBB),
        ];

        let signed = assemble(&tx, &[&signer_a, &signer_b], &locks).unwrap();
        assert_eq!(signed.witnesses.len(), 4);

        // First witness of each group should have signature
        let wa0 = WitnessArgs::deserialize(&signed.witnesses[0]).unwrap();
        assert!(wa0.lock.is_some());

        let wa2 = WitnessArgs::deserialize(&signed.witnesses[2]).unwrap();
        assert!(wa2.lock.is_some());
    }

    #[test]
    fn test_end_to_end_with_fee() {
        let mut tx = test_unsigned(1);
        tx.outputs[0].capacity = 500_000_000_000; // 5000 CKB
        let original = tx.outputs[0].capacity;

        let signer = MockSigner::new(test_script(0x01));
        let locks = vec![test_script(0x01)];

        let signed = assemble_with_fee(&mut tx, &[&signer], &locks, DEFAULT_FEE_RATE).unwrap();

        // Capacity should be less than original (fee deducted)
        assert!(signed.outputs[0].capacity < original);
        // But most capacity should remain
        assert!(signed.outputs[0].capacity > original - 10_000);
    }

    #[test]
    fn test_witness_args_large_data_roundtrip() {
        let wa = WitnessArgs {
            lock: Some(vec![0x42; 65]),
            input_type: Some(vec![0xAB; 1024]),
            output_type: Some(vec![0xCD; 2048]),
        };
        let bytes = wa.serialize();
        let decoded = WitnessArgs::deserialize(&bytes).unwrap();
        assert_eq!(decoded.lock.as_ref().unwrap().len(), 65);
        assert_eq!(decoded.input_type.as_ref().unwrap().len(), 1024);
        assert_eq!(decoded.output_type.as_ref().unwrap().len(), 2048);
    }

    // ============ New Hardening Tests ============

    #[test]
    fn test_witness_args_input_type_only_roundtrip() {
        let wa = WitnessArgs {
            lock: None,
            input_type: Some(vec![0xDE, 0xAD, 0xBE, 0xEF]),
            output_type: None,
        };
        let bytes = wa.serialize();
        let decoded = WitnessArgs::deserialize(&bytes).unwrap();
        assert!(decoded.lock.is_none());
        assert_eq!(decoded.input_type.unwrap(), vec![0xDE, 0xAD, 0xBE, 0xEF]);
        assert!(decoded.output_type.is_none());
    }

    #[test]
    fn test_witness_args_output_type_only_roundtrip() {
        let wa = WitnessArgs {
            lock: None,
            input_type: None,
            output_type: Some(vec![0xCA, 0xFE]),
        };
        let bytes = wa.serialize();
        let decoded = WitnessArgs::deserialize(&bytes).unwrap();
        assert!(decoded.lock.is_none());
        assert!(decoded.input_type.is_none());
        assert_eq!(decoded.output_type.unwrap(), vec![0xCA, 0xFE]);
    }

    #[test]
    fn test_witness_args_deserialize_truncated_field() {
        // Build valid serialized data, then truncate it mid-field
        let wa = WitnessArgs {
            lock: Some(vec![0xFF; 65]),
            input_type: None,
            output_type: None,
        };
        let bytes = wa.serialize();
        // Truncate so the field data is incomplete (cut off last 10 bytes)
        let truncated = &bytes[..bytes.len() - 10];
        // Patch total_size to match truncated length so we pass the first check
        let mut patched = truncated.to_vec();
        let new_len = patched.len() as u32;
        patched[0..4].copy_from_slice(&new_len.to_le_bytes());
        assert!(WitnessArgs::deserialize(&patched).is_err());
    }

    #[test]
    fn test_fee_calculation_zero_size() {
        // Zero-sized transaction should still pay MIN_FEE
        assert_eq!(calculate_fee(0, 1), MIN_FEE);
        assert_eq!(calculate_fee(0, 100), MIN_FEE);
    }

    #[test]
    fn test_fee_calculation_high_fee_rate() {
        // 500 bytes at 10 shannons/byte = 5000 > MIN_FEE
        assert_eq!(calculate_fee(500, 10), 5000);
        // 2000 bytes at 5 shannons/byte = 10000
        assert_eq!(calculate_fee(2000, 5), 10_000);
    }

    #[test]
    fn test_tx_hash_changes_with_cell_deps() {
        let mut tx1 = test_unsigned(1);
        let tx2 = test_unsigned(1);
        // Modify a cell dep
        tx1.cell_deps[0].dep_type = DepType::Code;
        let h1 = hash_raw_transaction(&tx1.cell_deps, &tx1.inputs, &tx1.outputs);
        let h2 = hash_raw_transaction(&tx2.cell_deps, &tx2.inputs, &tx2.outputs);
        assert_ne!(h1, h2);
    }

    #[test]
    fn test_assemble_with_extra_witnesses() {
        // Transaction with extra witnesses beyond the input count
        let mut tx = test_unsigned(1);
        // Add two extra data witnesses
        tx.witnesses.push(vec![0xAA, 0xBB, 0xCC]);
        tx.witnesses.push(vec![0xDD, 0xEE]);
        let signer = MockSigner::new(test_script(0x01));
        let locks = vec![test_script(0x01)];

        let signed = assemble(&tx, &[&signer], &locks).unwrap();
        // Should have 1 signed witness + 2 extra witnesses = 3
        assert_eq!(signed.witnesses.len(), 3);
        assert!(!signed.witnesses[0].is_empty()); // signed witness
        assert_eq!(signed.witnesses[1], vec![0xAA, 0xBB, 0xCC]);
        assert_eq!(signed.witnesses[2], vec![0xDD, 0xEE]);
    }

    #[test]
    fn test_estimate_tx_size_with_type_script() {
        let mut tx = test_unsigned(1);
        let s1 = estimate_tx_size(&tx.cell_deps, &tx.inputs, &tx.outputs, &tx.witnesses);
        // Add a type script to the output
        tx.outputs[0].type_script = Some(Script {
            code_hash: [0xBB; 32],
            hash_type: HashType::Data,
            args: vec![0x01; 20],
        });
        let s2 = estimate_tx_size(&tx.cell_deps, &tx.inputs, &tx.outputs, &tx.witnesses);
        // Size should increase by: 1 (presence flag already counted) + 32 (code_hash) + 1 (hash_type) + 4 (args_len) + 20 (args)
        // The None case is 1 byte, Some case is 1 + 32 + 1 + 4 + 20 = 58, delta = 57
        assert!(s2 > s1);
        assert_eq!(s2 - s1, 32 + 1 + 4 + 20); // 57 bytes added (the 1 byte flag is in both branches)
    }

    #[test]
    fn test_validate_single_input_transaction() {
        // Boundary: exactly one input should be valid
        let tx = test_unsigned(1);
        assert!(validate_unsigned(&tx).is_ok());
    }

    #[test]
    fn test_assemble_zero_capacity_output() {
        // Edge case: output with zero capacity (valid structurally, fee check is separate)
        let mut tx = test_unsigned(1);
        tx.outputs[0].capacity = 0;
        let signer = MockSigner::new(test_script(0x01));
        let locks = vec![test_script(0x01)];

        // Assembly itself should succeed (fee validation is separate)
        let signed = assemble(&tx, &[&signer], &locks).unwrap();
        assert_eq!(signed.outputs[0].capacity, 0);
    }

    #[test]
    fn test_end_to_end_assemble_verify_signature_roundtrip() {
        // Multi-step: build tx, assemble with 2 signers, verify each group's
        // first witness contains a valid WitnessArgs with the expected signature
        let mut tx = test_unsigned(3);
        // Input 0 uses lock 0x10, inputs 1-2 use lock 0x20
        tx.outputs[0].lock_script = test_script(0x10);
        tx.outputs[1].lock_script = test_script(0x20);
        tx.outputs[2].lock_script = test_script(0x20);

        let signer_a = MockSigner::new(test_script(0x10));
        let signer_b = MockSigner::new(test_script(0x20));
        let locks = vec![test_script(0x10), test_script(0x20), test_script(0x20)];

        validate_unsigned(&tx).unwrap();
        let signed = assemble(&tx, &[&signer_a, &signer_b], &locks).unwrap();

        assert_eq!(signed.witnesses.len(), 3);

        // Witness 0: first in group A — should contain signer_a's signature
        let wa0 = WitnessArgs::deserialize(&signed.witnesses[0]).unwrap();
        assert_eq!(wa0.lock.as_ref().unwrap().len(), SECP256K1_SIGNATURE_SIZE);
        assert_eq!(wa0.lock.as_ref().unwrap(), &signer_a.signature.to_vec());

        // Witness 1: first in group B — should contain signer_b's signature
        let wa1 = WitnessArgs::deserialize(&signed.witnesses[1]).unwrap();
        assert_eq!(wa1.lock.as_ref().unwrap().len(), SECP256K1_SIGNATURE_SIZE);
        assert_eq!(wa1.lock.as_ref().unwrap(), &signer_b.signature.to_vec());

        // Witness 2: second in group B — should be empty (CKB convention)
        assert!(signed.witnesses[2].is_empty());

        // Verify tx_hash is consistent
        let raw_hash = hash_raw_transaction(&tx.cell_deps, &tx.inputs, &tx.outputs);
        assert_eq!(signed.tx_hash(), raw_hash);

        // Verify estimated size is positive and reasonable
        let size = signed.estimated_size();
        assert!(size > 100, "Signed tx size should be > 100 bytes, got {}", size);
    }

    // ============ Additional Edge Case & Boundary Tests ============

    #[test]
    fn test_witness_args_serialize_deterministic() {
        // Same WitnessArgs should always serialize to the same bytes
        let wa = WitnessArgs {
            lock: Some(vec![0x11; 65]),
            input_type: Some(vec![0x22; 10]),
            output_type: None,
        };
        let b1 = wa.serialize();
        let b2 = wa.serialize();
        assert_eq!(b1, b2);
    }

    #[test]
    fn test_witness_args_empty_vec_lock_roundtrip() {
        // A lock field that is Some but zero-length
        let wa = WitnessArgs {
            lock: Some(vec![]),
            input_type: None,
            output_type: None,
        };
        let bytes = wa.serialize();
        let decoded = WitnessArgs::deserialize(&bytes).unwrap();
        assert_eq!(decoded.lock, Some(vec![]));
        assert!(decoded.input_type.is_none());
        assert!(decoded.output_type.is_none());
    }

    #[test]
    fn test_witness_args_single_byte_fields_roundtrip() {
        // Minimum non-empty data in all three fields
        let wa = WitnessArgs {
            lock: Some(vec![0x01]),
            input_type: Some(vec![0x02]),
            output_type: Some(vec![0x03]),
        };
        let bytes = wa.serialize();
        let decoded = WitnessArgs::deserialize(&bytes).unwrap();
        assert_eq!(decoded.lock.unwrap(), vec![0x01]);
        assert_eq!(decoded.input_type.unwrap(), vec![0x02]);
        assert_eq!(decoded.output_type.unwrap(), vec![0x03]);
    }

    #[test]
    fn test_witness_args_deserialize_total_size_mismatch() {
        // total_size says 100 but we only provide 20 bytes — should error
        let mut data = vec![0u8; 20];
        // Set total_size to 100
        data[0..4].copy_from_slice(&100u32.to_le_bytes());
        // Set three offsets to 16 (header end) so fields are "empty"
        data[4..8].copy_from_slice(&16u32.to_le_bytes());
        data[8..12].copy_from_slice(&16u32.to_le_bytes());
        data[12..16].copy_from_slice(&16u32.to_le_bytes());
        assert!(WitnessArgs::deserialize(&data).is_err());
    }

    #[test]
    fn test_tx_hash_nonzero() {
        // Even a minimal transaction should produce a non-zero hash
        let tx = test_unsigned(1);
        let hash = hash_raw_transaction(&tx.cell_deps, &tx.inputs, &tx.outputs);
        assert_ne!(hash, [0u8; 32]);
    }

    #[test]
    fn test_tx_hash_changes_with_output_data() {
        let mut tx1 = test_unsigned(1);
        let tx2 = test_unsigned(1);
        tx1.outputs[0].data = vec![0xAA, 0xBB, 0xCC];
        let h1 = hash_raw_transaction(&tx1.cell_deps, &tx1.inputs, &tx1.outputs);
        let h2 = hash_raw_transaction(&tx2.cell_deps, &tx2.inputs, &tx2.outputs);
        assert_ne!(h1, h2);
    }

    #[test]
    fn test_tx_hash_changes_with_since() {
        let mut tx1 = test_unsigned(1);
        let tx2 = test_unsigned(1);
        tx1.inputs[0].since = 12345;
        let h1 = hash_raw_transaction(&tx1.cell_deps, &tx1.inputs, &tx1.outputs);
        let h2 = hash_raw_transaction(&tx2.cell_deps, &tx2.inputs, &tx2.outputs);
        assert_ne!(h1, h2);
    }

    #[test]
    fn test_signing_message_changes_with_witness_args() {
        let tx_hash = [0x42; 32];
        let wa1 = WitnessArgs::new_with_empty_lock();
        let wa2 = WitnessArgs {
            lock: Some(vec![0xFF; 65]),
            input_type: None,
            output_type: None,
        };
        let m1 = compute_signing_message(&tx_hash, &wa1, &[]);
        let m2 = compute_signing_message(&tx_hash, &wa2, &[]);
        assert_ne!(m1, m2);
    }

    #[test]
    fn test_signing_message_nonzero() {
        let tx_hash = [0x00; 32];
        let wa = WitnessArgs::new_with_empty_lock();
        let msg = compute_signing_message(&tx_hash, &wa, &[]);
        assert_ne!(msg, [0u8; 32]);
    }

    #[test]
    fn test_mock_signer_different_locks_different_sigs() {
        let signer_a = MockSigner::new(test_script(0x01));
        let signer_b = MockSigner::new(test_script(0x02));
        assert_ne!(signer_a.signature, signer_b.signature);
    }

    #[test]
    fn test_mock_signer_lock_script_matches() {
        let lock = test_script(0x42);
        let signer = MockSigner::new(lock.clone());
        let returned = signer.lock_script();
        assert_eq!(returned.code_hash, lock.code_hash);
        assert_eq!(returned.args, lock.args);
    }

    #[test]
    fn test_estimate_tx_size_empty_transaction() {
        // A transaction with no deps, inputs, outputs, or witnesses
        let size = estimate_tx_size(&[], &[], &[], &[]);
        // Should just be the header: 4 + 4 + 4 + 4 + 4 = 20 bytes
        assert_eq!(size, 20);
    }

    #[test]
    fn test_estimate_tx_size_with_witnesses() {
        let tx = test_unsigned(1);
        let small_witnesses: Vec<Vec<u8>> = vec![vec![0u8; 10]];
        let large_witnesses: Vec<Vec<u8>> = vec![vec![0u8; 200]];
        let s1 = estimate_tx_size(&tx.cell_deps, &tx.inputs, &tx.outputs, &small_witnesses);
        let s2 = estimate_tx_size(&tx.cell_deps, &tx.inputs, &tx.outputs, &large_witnesses);
        assert_eq!(s2 - s1, 190); // 200 - 10 = 190 extra bytes
    }

    #[test]
    fn test_validate_many_unique_inputs() {
        // 10 unique inputs should pass validation
        let tx = test_unsigned(10);
        assert!(validate_unsigned(&tx).is_ok());
    }

    #[test]
    fn test_assemble_preserves_cell_deps() {
        let tx = test_unsigned(1);
        let signer = MockSigner::new(test_script(0x01));
        let locks = vec![test_script(0x01)];
        let signed = assemble(&tx, &[&signer], &locks).unwrap();
        assert_eq!(signed.cell_deps.len(), tx.cell_deps.len());
        assert_eq!(signed.cell_deps[0].tx_hash, tx.cell_deps[0].tx_hash);
    }

    #[test]
    fn test_assemble_preserves_outputs() {
        let tx = test_unsigned(2);
        let signer = MockSigner::new(test_script(0x01));
        let signed = assemble_single_signer(&tx, &signer).unwrap();
        assert_eq!(signed.outputs.len(), 2);
        assert_eq!(signed.outputs[0].capacity, tx.outputs[0].capacity);
        assert_eq!(signed.outputs[1].capacity, tx.outputs[1].capacity);
    }

    #[test]
    fn test_assemble_with_fee_exact_capacity() {
        // Output capacity exactly equals the fee — should result in zero capacity
        let mut tx = test_unsigned(1);
        // First assemble to find out what the fee would be
        let mut tx_probe = tx.clone();
        let signer = MockSigner::new(test_script(0x01));
        let locks = vec![test_script(0x01)];
        // Estimate the fee
        let estimated_witness_size = tx.inputs.len() * (WitnessArgs::new_with_empty_lock().serialize().len() + 4);
        let base_size = estimate_tx_size(&tx.cell_deps, &tx.inputs, &tx.outputs, &tx.witnesses);
        let fee = calculate_fee(base_size + estimated_witness_size, DEFAULT_FEE_RATE);
        // Set capacity to exactly the fee
        tx_probe.outputs[0].capacity = fee;
        let result = assemble_with_fee(&mut tx_probe, &[&signer], &locks, DEFAULT_FEE_RATE);
        // Should succeed with 0 remaining capacity
        let signed = result.unwrap();
        assert_eq!(signed.outputs[0].capacity, 0);
    }

    #[test]
    fn test_signed_tx_hash_deterministic() {
        let tx = test_unsigned(2);
        let signer = MockSigner::new(test_script(0x01));
        let signed = assemble_single_signer(&tx, &signer).unwrap();
        let h1 = signed.tx_hash();
        let h2 = signed.tx_hash();
        assert_eq!(h1, h2);
    }
}
