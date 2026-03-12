// ============ Permission Module ============
// Role-Based Access Control (RBAC) for the VibeSwap protocol on CKB.
//
// Key capabilities:
// - Role definition with fine-grained permissions
// - Role assignment with expiry, max holders, and multisig requirements
// - Permission checking and authorization with action logging
// - Two-admin rule for sensitive operations
// - Role hierarchy: SuperAdmin > Admin > Operator > Guardian > Proposer > Keeper > Viewer
// - Custom roles with arbitrary permission sets
// - Analytics: coverage, distribution, activity tracking
// - Validation: orphan detection, admin presence, consistency checks
//
// Philosophy: Access control is structural fairness. Every privileged action
// is logged, bounded by role, and constrained by time. No one operates
// outside the permission graph — not even SuperAdmin escapes the audit trail (P-000).

// ============ Error Types ============

#[derive(Debug, Clone, PartialEq)]
pub enum PermissionError {
    Unauthorized,
    RoleNotFound,
    RoleExpired,
    AlreadyAssigned,
    MaxHoldersReached,
    AssignmentNotFound,
    CannotRevokeLastAdmin,
    SelfRevoke,
    MultisigRequired,
    TwoAdminRequired,
    InvalidRole,
    PermissionNotInRole,
    Inactive,
    LogFull,
}

// ============ Data Types ============

#[derive(Debug, Clone, PartialEq, Hash, Eq)]
pub enum Permission {
    CreatePool,
    PausePool,
    UpdateFees,
    ManageWhitelist,
    ExecuteEmergency,
    ManageGovernance,
    DistributeRewards,
    UpgradeProtocol,
    ManageTreasury,
    ManageBridge,
    ConfigureOracle,
    ManageStaking,
    ViewAnalytics,
    ManageUsers,
    All,
}

#[derive(Debug, Clone, PartialEq)]
pub enum RoleType {
    SuperAdmin,
    Admin,
    Operator,
    Guardian,
    Proposer,
    Keeper,
    Viewer,
    Custom(u32),
}

#[derive(Debug, Clone)]
pub struct Role {
    pub role_type: RoleType,
    pub permissions: Vec<Permission>,
    pub max_holders: u32,
    pub requires_multisig: bool,
    pub time_limited: bool,
}

#[derive(Debug, Clone)]
pub struct RoleAssignment {
    pub address: [u8; 32],
    pub role_type: RoleType,
    pub granted_by: [u8; 32],
    pub granted_at: u64,
    pub expires_at: Option<u64>,
    pub active: bool,
}

#[derive(Debug, Clone)]
pub struct PermissionRegistry {
    pub roles: Vec<Role>,
    pub assignments: Vec<RoleAssignment>,
    pub action_log: Vec<ActionRecord>,
    pub max_log_entries: usize,
    pub require_two_admin: bool,
}

#[derive(Debug, Clone)]
pub struct ActionRecord {
    pub actor: [u8; 32],
    pub permission: Permission,
    pub timestamp: u64,
    pub approved: bool,
    pub target: Option<[u8; 32]>,
}

#[derive(Debug, Clone)]
pub struct PermissionCheck {
    pub has_permission: bool,
    pub role: Option<RoleType>,
    pub expires_at: Option<u64>,
    pub requires_multisig: bool,
    pub is_time_limited: bool,
}

// ============ Constants ============

/// Sensitive permissions that may require two-admin approval
const SENSITIVE_PERMISSIONS: &[Permission] = &[
    Permission::UpgradeProtocol,
    Permission::ExecuteEmergency,
    Permission::ManageTreasury,
    Permission::All,
];

// ============ Registry Setup ============

/// Create a new empty permission registry
pub fn create_registry(require_two_admin: bool, max_log: usize) -> PermissionRegistry {
    PermissionRegistry {
        roles: Vec::new(),
        assignments: Vec::new(),
        action_log: Vec::new(),
        max_log_entries: max_log,
        require_two_admin,
    }
}

/// Return the default set of roles with standard permissions
pub fn default_roles() -> Vec<Role> {
    vec![
        Role {
            role_type: RoleType::SuperAdmin,
            permissions: vec![Permission::All],
            max_holders: 0,
            requires_multisig: false,
            time_limited: false,
        },
        Role {
            role_type: RoleType::Admin,
            permissions: vec![
                Permission::CreatePool,
                Permission::PausePool,
                Permission::UpdateFees,
                Permission::ManageWhitelist,
                Permission::ExecuteEmergency,
                Permission::ManageGovernance,
                Permission::DistributeRewards,
                Permission::ManageTreasury,
                Permission::ManageBridge,
                Permission::ConfigureOracle,
                Permission::ManageStaking,
                Permission::ViewAnalytics,
                Permission::ManageUsers,
            ],
            max_holders: 0,
            requires_multisig: false,
            time_limited: false,
        },
        Role {
            role_type: RoleType::Operator,
            permissions: vec![
                Permission::CreatePool,
                Permission::PausePool,
                Permission::UpdateFees,
                Permission::ManageWhitelist,
                Permission::DistributeRewards,
                Permission::ViewAnalytics,
            ],
            max_holders: 0,
            requires_multisig: false,
            time_limited: false,
        },
        Role {
            role_type: RoleType::Guardian,
            permissions: vec![
                Permission::ExecuteEmergency,
                Permission::PausePool,
                Permission::ViewAnalytics,
            ],
            max_holders: 0,
            requires_multisig: false,
            time_limited: false,
        },
        Role {
            role_type: RoleType::Proposer,
            permissions: vec![
                Permission::ManageGovernance,
                Permission::ViewAnalytics,
            ],
            max_holders: 0,
            requires_multisig: false,
            time_limited: false,
        },
        Role {
            role_type: RoleType::Keeper,
            permissions: vec![
                Permission::DistributeRewards,
                Permission::ConfigureOracle,
                Permission::ManageStaking,
                Permission::ViewAnalytics,
            ],
            max_holders: 0,
            requires_multisig: false,
            time_limited: false,
        },
        Role {
            role_type: RoleType::Viewer,
            permissions: vec![Permission::ViewAnalytics],
            max_holders: 0,
            requires_multisig: false,
            time_limited: false,
        },
    ]
}

/// Register a new role definition in the registry
pub fn register_role(
    registry: &mut PermissionRegistry,
    role: Role,
) -> Result<(), PermissionError> {
    // Check for duplicate role type
    for existing in &registry.roles {
        if existing.role_type == role.role_type {
            return Err(PermissionError::InvalidRole);
        }
    }
    registry.roles.push(role);
    Ok(())
}

/// Add a custom role with a unique ID and specified permissions
pub fn add_custom_role(
    registry: &mut PermissionRegistry,
    id: u32,
    permissions: Vec<Permission>,
    max_holders: u32,
) -> Result<(), PermissionError> {
    let role = Role {
        role_type: RoleType::Custom(id),
        permissions,
        max_holders,
        requires_multisig: false,
        time_limited: false,
    };
    register_role(registry, role)
}

// ============ Role Assignment ============

/// Grant a role to an address
pub fn grant_role(
    registry: &mut PermissionRegistry,
    address: [u8; 32],
    role_type: RoleType,
    granted_by: [u8; 32],
    now: u64,
    expires: Option<u64>,
) -> Result<(), PermissionError> {
    // Check role is defined
    let role = get_role(registry, &role_type);
    if role.is_none() {
        return Err(PermissionError::RoleNotFound);
    }
    let role = role.unwrap();

    // Check max holders
    if role.max_holders > 0 {
        let current_count = holder_count(registry, &role_type, now);
        if current_count >= role.max_holders as usize {
            return Err(PermissionError::MaxHoldersReached);
        }
    }

    // Check not already assigned (active and non-expired)
    for assignment in &registry.assignments {
        if assignment.address == address
            && assignment.role_type == role_type
            && assignment.active
        {
            let expired = match assignment.expires_at {
                Some(exp) => now >= exp,
                None => false,
            };
            if !expired {
                return Err(PermissionError::AlreadyAssigned);
            }
        }
    }

    let assignment = RoleAssignment {
        address,
        role_type,
        granted_by,
        granted_at: now,
        expires_at: expires,
        active: true,
    };
    registry.assignments.push(assignment);
    Ok(())
}

/// Revoke a specific role from an address
pub fn revoke_role(
    registry: &mut PermissionRegistry,
    address: &[u8; 32],
    role_type: &RoleType,
) -> Result<(), PermissionError> {
    // Prevent revoking the last admin/superadmin
    if *role_type == RoleType::SuperAdmin || *role_type == RoleType::Admin {
        let active_count = registry
            .assignments
            .iter()
            .filter(|a| {
                a.active
                    && (a.role_type == RoleType::SuperAdmin || a.role_type == RoleType::Admin)
                    && a.address != *address
            })
            .count();
        if active_count == 0 {
            return Err(PermissionError::CannotRevokeLastAdmin);
        }
    }

    let mut found = false;
    for assignment in &mut registry.assignments {
        if assignment.address == *address && assignment.role_type == *role_type && assignment.active
        {
            assignment.active = false;
            found = true;
        }
    }

    if found {
        Ok(())
    } else {
        Err(PermissionError::AssignmentNotFound)
    }
}

/// Revoke all roles from an address, returns how many were revoked
pub fn revoke_all_roles(registry: &mut PermissionRegistry, address: &[u8; 32]) -> usize {
    let mut count = 0;
    for assignment in &mut registry.assignments {
        if assignment.address == *address && assignment.active {
            assignment.active = false;
            count += 1;
        }
    }
    count
}

/// Extend the expiry of a role assignment
pub fn extend_role(
    registry: &mut PermissionRegistry,
    address: &[u8; 32],
    role_type: &RoleType,
    new_expiry: u64,
) -> Result<(), PermissionError> {
    for assignment in &mut registry.assignments {
        if assignment.address == *address
            && assignment.role_type == *role_type
            && assignment.active
        {
            assignment.expires_at = Some(new_expiry);
            return Ok(());
        }
    }
    Err(PermissionError::AssignmentNotFound)
}

/// Transfer a role from one address to another
pub fn transfer_role(
    registry: &mut PermissionRegistry,
    from: &[u8; 32],
    to: [u8; 32],
    role_type: &RoleType,
    now: u64,
) -> Result<(), PermissionError> {
    // Find the source assignment
    let mut found_idx = None;
    let mut granted_by = [0u8; 32];
    let mut expires_at = None;
    for (i, assignment) in registry.assignments.iter().enumerate() {
        if assignment.address == *from
            && assignment.role_type == *role_type
            && assignment.active
        {
            // Check if expired
            if let Some(exp) = assignment.expires_at {
                if now >= exp {
                    return Err(PermissionError::RoleExpired);
                }
            }
            found_idx = Some(i);
            granted_by = assignment.granted_by;
            expires_at = assignment.expires_at;
            break;
        }
    }

    if found_idx.is_none() {
        return Err(PermissionError::AssignmentNotFound);
    }
    let idx = found_idx.unwrap();

    // Check target doesn't already have this role
    for assignment in &registry.assignments {
        if assignment.address == to && assignment.role_type == *role_type && assignment.active {
            let expired = match assignment.expires_at {
                Some(exp) => now >= exp,
                None => false,
            };
            if !expired {
                return Err(PermissionError::AlreadyAssigned);
            }
        }
    }

    // Deactivate source
    registry.assignments[idx].active = false;

    // Create new assignment for target
    let new_assignment = RoleAssignment {
        address: to,
        role_type: role_type.clone(),
        granted_by,
        granted_at: now,
        expires_at,
        active: true,
    };
    registry.assignments.push(new_assignment);
    Ok(())
}

// ============ Permission Checking ============

/// Check if an address has a specific permission at the given time
pub fn has_permission(
    registry: &PermissionRegistry,
    address: &[u8; 32],
    permission: &Permission,
    now: u64,
) -> bool {
    for assignment in &registry.assignments {
        if assignment.address != *address || !assignment.active {
            continue;
        }
        // Check expiry
        if let Some(exp) = assignment.expires_at {
            if now >= exp {
                continue;
            }
        }
        // Find role definition
        if let Some(role) = get_role(registry, &assignment.role_type) {
            if role.permissions.contains(&Permission::All)
                || role.permissions.contains(permission)
            {
                return true;
            }
        }
    }
    false
}

/// Detailed permission check returning full context
pub fn check_permission(
    registry: &PermissionRegistry,
    address: &[u8; 32],
    permission: &Permission,
    now: u64,
) -> PermissionCheck {
    for assignment in &registry.assignments {
        if assignment.address != *address || !assignment.active {
            continue;
        }
        if let Some(exp) = assignment.expires_at {
            if now >= exp {
                continue;
            }
        }
        if let Some(role) = get_role(registry, &assignment.role_type) {
            if role.permissions.contains(&Permission::All)
                || role.permissions.contains(permission)
            {
                return PermissionCheck {
                    has_permission: true,
                    role: Some(assignment.role_type.clone()),
                    expires_at: assignment.expires_at,
                    requires_multisig: role.requires_multisig,
                    is_time_limited: role.time_limited,
                };
            }
        }
    }
    PermissionCheck {
        has_permission: false,
        role: None,
        expires_at: None,
        requires_multisig: false,
        is_time_limited: false,
    }
}

/// Authorize an action: check permission, log it, and return result
pub fn authorize(
    registry: &mut PermissionRegistry,
    address: &[u8; 32],
    permission: &Permission,
    now: u64,
    target: Option<[u8; 32]>,
) -> Result<(), PermissionError> {
    let has = has_permission(registry, address, permission, now);

    // Check multisig requirement
    if has {
        let check = check_permission(registry, address, permission, now);
        if check.requires_multisig {
            let _ = log_action(registry, *address, permission.clone(), now, false, target);
            return Err(PermissionError::MultisigRequired);
        }
    }

    // Check two-admin requirement for sensitive permissions
    if has && registry.require_two_admin && needs_second_admin(registry, permission) {
        if !has_two_admin_approval(registry, permission, now, 60_000) {
            let _ = log_action(registry, *address, permission.clone(), now, true, target);
            return Err(PermissionError::TwoAdminRequired);
        }
    }

    let _ = log_action(registry, *address, permission.clone(), now, has, target);

    if has {
        Ok(())
    } else {
        Err(PermissionError::Unauthorized)
    }
}

/// Check if a granter can grant a specific role type
pub fn can_grant_role(
    registry: &PermissionRegistry,
    granter: &[u8; 32],
    role_type: &RoleType,
    now: u64,
) -> bool {
    let granter_roles = roles_for_address(registry, granter, now);
    for granter_role in &granter_roles {
        let granter_level = role_level(granter_role);
        let target_level = role_level(role_type);
        if granter_level >= target_level && granter_level > 0 {
            return true;
        }
        // SuperAdmin can grant anything
        if **granter_role == RoleType::SuperAdmin {
            return true;
        }
    }
    false
}

/// Compute the union of all permissions for an address across active roles
pub fn effective_permissions(
    registry: &PermissionRegistry,
    address: &[u8; 32],
    now: u64,
) -> Vec<Permission> {
    let mut perms = Vec::new();
    for assignment in &registry.assignments {
        if assignment.address != *address || !assignment.active {
            continue;
        }
        if let Some(exp) = assignment.expires_at {
            if now >= exp {
                continue;
            }
        }
        if let Some(role) = get_role(registry, &assignment.role_type) {
            for perm in &role.permissions {
                if !perms.contains(perm) {
                    perms.push(perm.clone());
                }
            }
        }
    }
    perms
}

// ============ Role Queries ============

/// Get a role definition by type
pub fn get_role<'a>(registry: &'a PermissionRegistry, role_type: &RoleType) -> Option<&'a Role> {
    registry.roles.iter().find(|r| r.role_type == *role_type)
}

/// Get all active holders of a specific role
pub fn role_holders(
    registry: &PermissionRegistry,
    role_type: &RoleType,
    now: u64,
) -> Vec<[u8; 32]> {
    let mut holders = Vec::new();
    for assignment in &registry.assignments {
        if assignment.role_type != *role_type || !assignment.active {
            continue;
        }
        if let Some(exp) = assignment.expires_at {
            if now >= exp {
                continue;
            }
        }
        if !holders.contains(&assignment.address) {
            holders.push(assignment.address);
        }
    }
    holders
}

/// Get all active role types for an address
pub fn roles_for_address<'a>(
    registry: &'a PermissionRegistry,
    address: &[u8; 32],
    now: u64,
) -> Vec<&'a RoleType> {
    let mut roles = Vec::new();
    for assignment in &registry.assignments {
        if assignment.address != *address || !assignment.active {
            continue;
        }
        if let Some(exp) = assignment.expires_at {
            if now >= exp {
                continue;
            }
        }
        roles.push(&assignment.role_type);
    }
    roles
}

/// Count active holders of a role
pub fn holder_count(
    registry: &PermissionRegistry,
    role_type: &RoleType,
    now: u64,
) -> usize {
    role_holders(registry, role_type, now).len()
}

/// Check if an address is Admin or SuperAdmin
pub fn is_admin(registry: &PermissionRegistry, address: &[u8; 32], now: u64) -> bool {
    let roles = roles_for_address(registry, address, now);
    roles.iter().any(|r| **r == RoleType::Admin || **r == RoleType::SuperAdmin)
}

/// Check if an address is SuperAdmin
pub fn is_superadmin(registry: &PermissionRegistry, address: &[u8; 32], now: u64) -> bool {
    let roles = roles_for_address(registry, address, now);
    roles.iter().any(|r| **r == RoleType::SuperAdmin)
}

/// Check if an address holds any active role
pub fn has_any_role(registry: &PermissionRegistry, address: &[u8; 32], now: u64) -> bool {
    !roles_for_address(registry, address, now).is_empty()
}

// ============ Expiry Management ============

/// Deactivate all assignments that have expired, returns how many were expired
pub fn expire_assignments(registry: &mut PermissionRegistry, now: u64) -> usize {
    let mut count = 0;
    for assignment in &mut registry.assignments {
        if assignment.active {
            if let Some(exp) = assignment.expires_at {
                if now >= exp {
                    assignment.active = false;
                    count += 1;
                }
            }
        }
    }
    count
}

/// Find assignments expiring within a time window
pub fn expiring_soon<'a>(
    registry: &'a PermissionRegistry,
    now: u64,
    window_ms: u64,
) -> Vec<&'a RoleAssignment> {
    registry
        .assignments
        .iter()
        .filter(|a| {
            a.active
                && match a.expires_at {
                    Some(exp) => exp > now && exp <= now + window_ms,
                    None => false,
                }
        })
        .collect()
}

/// Get all currently active assignments
pub fn active_assignments<'a>(
    registry: &'a PermissionRegistry,
    now: u64,
) -> Vec<&'a RoleAssignment> {
    registry
        .assignments
        .iter()
        .filter(|a| {
            a.active
                && match a.expires_at {
                    Some(exp) => now < exp,
                    None => true,
                }
        })
        .collect()
}

// ============ Action Logging ============

/// Log an action to the registry's audit trail
pub fn log_action(
    registry: &mut PermissionRegistry,
    actor: [u8; 32],
    permission: Permission,
    now: u64,
    approved: bool,
    target: Option<[u8; 32]>,
) -> Result<(), PermissionError> {
    if registry.max_log_entries > 0 && registry.action_log.len() >= registry.max_log_entries {
        return Err(PermissionError::LogFull);
    }
    let record = ActionRecord {
        actor,
        permission,
        timestamp: now,
        approved,
        target,
    };
    registry.action_log.push(record);
    Ok(())
}

/// Get all actions performed by a specific actor
pub fn actions_by_actor<'a>(
    registry: &'a PermissionRegistry,
    actor: &[u8; 32],
) -> Vec<&'a ActionRecord> {
    registry
        .action_log
        .iter()
        .filter(|a| a.actor == *actor)
        .collect()
}

/// Get the most recent N actions
pub fn recent_actions<'a>(
    registry: &'a PermissionRegistry,
    count: usize,
) -> Vec<&'a ActionRecord> {
    let len = registry.action_log.len();
    if count >= len {
        registry.action_log.iter().collect()
    } else {
        registry.action_log[len - count..].iter().collect()
    }
}

/// Get all denied actions
pub fn denied_actions<'a>(registry: &'a PermissionRegistry) -> Vec<&'a ActionRecord> {
    registry
        .action_log
        .iter()
        .filter(|a| !a.approved)
        .collect()
}

/// Get all actions for a specific permission type
pub fn actions_for_permission<'a>(
    registry: &'a PermissionRegistry,
    permission: &Permission,
) -> Vec<&'a ActionRecord> {
    registry
        .action_log
        .iter()
        .filter(|a| a.permission == *permission)
        .collect()
}

// ============ Two-Admin Rule ============

/// Check if a permission requires a second admin approval
pub fn needs_second_admin(registry: &PermissionRegistry, permission: &Permission) -> bool {
    if !registry.require_two_admin {
        return false;
    }
    SENSITIVE_PERMISSIONS.contains(permission)
}

/// Check if two different admins have approved the same permission within a time window
pub fn has_two_admin_approval(
    registry: &PermissionRegistry,
    permission: &Permission,
    now: u64,
    window_ms: u64,
) -> bool {
    let mut approvers: Vec<[u8; 32]> = Vec::new();
    for record in &registry.action_log {
        if record.permission == *permission
            && record.approved
            && record.timestamp + window_ms > now
        {
            // Check if this actor is actually an admin
            if is_admin(registry, &record.actor, now) && !approvers.contains(&record.actor) {
                approvers.push(record.actor);
            }
        }
    }
    approvers.len() >= 2
}

// ============ Analytics ============

/// Calculate what percentage of all permissions have at least one active holder (in bps)
pub fn permission_coverage(registry: &PermissionRegistry, now: u64) -> u64 {
    let all_permissions = vec![
        Permission::CreatePool,
        Permission::PausePool,
        Permission::UpdateFees,
        Permission::ManageWhitelist,
        Permission::ExecuteEmergency,
        Permission::ManageGovernance,
        Permission::DistributeRewards,
        Permission::UpgradeProtocol,
        Permission::ManageTreasury,
        Permission::ManageBridge,
        Permission::ConfigureOracle,
        Permission::ManageStaking,
        Permission::ViewAnalytics,
        Permission::ManageUsers,
    ];
    let total = all_permissions.len() as u64;
    if total == 0 {
        return 0;
    }
    let mut covered = 0u64;
    for perm in &all_permissions {
        // Check if any active assignment covers this permission
        for assignment in &registry.assignments {
            if !assignment.active {
                continue;
            }
            if let Some(exp) = assignment.expires_at {
                if now >= exp {
                    continue;
                }
            }
            if let Some(role) = get_role(registry, &assignment.role_type) {
                if role.permissions.contains(&Permission::All) || role.permissions.contains(perm) {
                    covered += 1;
                    break;
                }
            }
        }
    }
    (covered * 10_000) / total
}

/// Get a distribution of holders per role type
pub fn role_distribution(
    registry: &PermissionRegistry,
    now: u64,
) -> Vec<(RoleType, usize)> {
    let mut seen_role_types: Vec<RoleType> = Vec::new();
    for role in &registry.roles {
        if !seen_role_types.iter().any(|r| *r == role.role_type) {
            seen_role_types.push(role.role_type.clone());
        }
    }
    let mut distribution = Vec::new();
    for rt in seen_role_types {
        let count = holder_count(registry, &rt, now);
        distribution.push((rt, count));
    }
    distribution
}

/// Find the most active actor (most action log entries)
pub fn most_active_actor(registry: &PermissionRegistry) -> Option<[u8; 32]> {
    if registry.action_log.is_empty() {
        return None;
    }
    let mut actors: Vec<([u8; 32], usize)> = Vec::new();
    for record in &registry.action_log {
        let mut found = false;
        for entry in &mut actors {
            if entry.0 == record.actor {
                entry.1 += 1;
                found = true;
                break;
            }
        }
        if !found {
            actors.push((record.actor, 1));
        }
    }
    actors.sort_by(|a, b| b.1.cmp(&a.1));
    actors.first().map(|a| a.0)
}

/// Count how many active admins (Admin or SuperAdmin) exist
pub fn admin_count(registry: &PermissionRegistry, now: u64) -> usize {
    let mut admins: Vec<[u8; 32]> = Vec::new();
    for assignment in &registry.assignments {
        if !assignment.active {
            continue;
        }
        if let Some(exp) = assignment.expires_at {
            if now >= exp {
                continue;
            }
        }
        if assignment.role_type == RoleType::Admin || assignment.role_type == RoleType::SuperAdmin {
            if !admins.contains(&assignment.address) {
                admins.push(assignment.address);
            }
        }
    }
    admins.len()
}

/// Total number of assignments (active and inactive)
pub fn total_assignments(registry: &PermissionRegistry) -> usize {
    registry.assignments.len()
}

// ============ Hierarchy ============

/// Get the numeric level for a role type (higher = more powerful)
pub fn role_level(role_type: &RoleType) -> u8 {
    match role_type {
        RoleType::SuperAdmin => 6,
        RoleType::Admin => 5,
        RoleType::Operator => 4,
        RoleType::Guardian => 3,
        RoleType::Proposer => 2,
        RoleType::Keeper => 1,
        RoleType::Viewer => 0,
        RoleType::Custom(_) => 0,
    }
}

/// Check if role A is strictly higher than role B in the hierarchy
pub fn is_higher_role(a: &RoleType, b: &RoleType) -> bool {
    role_level(a) > role_level(b)
}

/// Determine the minimum role that has a given permission in the default role set
pub fn minimum_role_for(permission: &Permission) -> RoleType {
    // From the default_roles definitions, find the lowest-level role that includes this permission
    match permission {
        Permission::ViewAnalytics => RoleType::Viewer,
        Permission::DistributeRewards
        | Permission::ConfigureOracle
        | Permission::ManageStaking => RoleType::Keeper,
        Permission::ManageGovernance => RoleType::Proposer,
        Permission::ExecuteEmergency | Permission::PausePool => RoleType::Guardian,
        Permission::CreatePool | Permission::UpdateFees | Permission::ManageWhitelist => {
            RoleType::Operator
        }
        Permission::ManageTreasury
        | Permission::ManageBridge
        | Permission::ManageUsers => RoleType::Admin,
        Permission::UpgradeProtocol => RoleType::Admin,
        Permission::All => RoleType::SuperAdmin,
    }
}

// ============ Validation ============

/// Validate the registry and return a list of detected issues
pub fn validate_registry(
    registry: &PermissionRegistry,
    now: u64,
) -> Vec<PermissionError> {
    let mut errors = Vec::new();

    // Check for at least one admin
    if !has_admin(registry, now) {
        errors.push(PermissionError::Unauthorized);
    }

    // Check consistency
    if !is_consistent(registry) {
        errors.push(PermissionError::RoleNotFound);
    }

    // Check for expired but still active assignments
    for assignment in &registry.assignments {
        if assignment.active {
            if let Some(exp) = assignment.expires_at {
                if now >= exp {
                    errors.push(PermissionError::RoleExpired);
                }
            }
        }
    }

    // Check max holders violations
    for role in &registry.roles {
        if role.max_holders > 0 {
            let count = holder_count(registry, &role.role_type, now);
            if count > role.max_holders as usize {
                errors.push(PermissionError::MaxHoldersReached);
            }
        }
    }

    errors
}

/// Check if at least one active admin exists
pub fn has_admin(registry: &PermissionRegistry, now: u64) -> bool {
    admin_count(registry, now) > 0
}

/// Check that all assignments reference defined roles (no orphans)
pub fn is_consistent(registry: &PermissionRegistry) -> bool {
    for assignment in &registry.assignments {
        if !assignment.active {
            continue;
        }
        if get_role(registry, &assignment.role_type).is_none() {
            return false;
        }
    }
    true
}

/// Count permissions in a role
pub fn permission_count(role: &Role) -> usize {
    role.permissions.len()
}

/// Remove all inactive assignments, returns how many were cleaned up
pub fn cleanup_inactive(registry: &mut PermissionRegistry) -> usize {
    let before = registry.assignments.len();
    registry.assignments.retain(|a| a.active);
    before - registry.assignments.len()
}

// ============ Tests ============

#[cfg(test)]
mod tests {
    use super::*;

    // ============ Test Helpers ============

    fn addr(n: u8) -> [u8; 32] {
        let mut a = [0u8; 32];
        a[0] = n;
        a
    }

    fn setup_registry() -> PermissionRegistry {
        let mut reg = create_registry(false, 1000);
        for role in default_roles() {
            register_role(&mut reg, role).unwrap();
        }
        reg
    }

    fn setup_with_admin() -> PermissionRegistry {
        let mut reg = setup_registry();
        grant_role(&mut reg, addr(1), RoleType::SuperAdmin, addr(0), 100, None).unwrap();
        reg
    }

    fn setup_with_two_admins() -> PermissionRegistry {
        let mut reg = setup_registry();
        grant_role(&mut reg, addr(1), RoleType::SuperAdmin, addr(0), 100, None).unwrap();
        grant_role(&mut reg, addr(2), RoleType::Admin, addr(1), 100, None).unwrap();
        reg
    }

    // ============ Registry Setup Tests ============

    #[test]
    fn test_create_registry_empty() {
        let reg = create_registry(false, 100);
        assert!(reg.roles.is_empty());
        assert!(reg.assignments.is_empty());
        assert!(reg.action_log.is_empty());
        assert_eq!(reg.max_log_entries, 100);
        assert!(!reg.require_two_admin);
    }

    #[test]
    fn test_create_registry_with_two_admin() {
        let reg = create_registry(true, 500);
        assert!(reg.require_two_admin);
        assert_eq!(reg.max_log_entries, 500);
    }

    #[test]
    fn test_default_roles_count() {
        let roles = default_roles();
        assert_eq!(roles.len(), 7);
    }

    #[test]
    fn test_default_roles_superadmin_has_all() {
        let roles = default_roles();
        let sa = roles.iter().find(|r| r.role_type == RoleType::SuperAdmin).unwrap();
        assert!(sa.permissions.contains(&Permission::All));
        assert_eq!(sa.max_holders, 0);
    }

    #[test]
    fn test_default_roles_admin_permissions() {
        let roles = default_roles();
        let admin = roles.iter().find(|r| r.role_type == RoleType::Admin).unwrap();
        assert!(admin.permissions.contains(&Permission::CreatePool));
        assert!(admin.permissions.contains(&Permission::ManageTreasury));
        assert!(!admin.permissions.contains(&Permission::All));
        assert!(!admin.permissions.contains(&Permission::UpgradeProtocol));
    }

    #[test]
    fn test_default_roles_operator_permissions() {
        let roles = default_roles();
        let op = roles.iter().find(|r| r.role_type == RoleType::Operator).unwrap();
        assert!(op.permissions.contains(&Permission::CreatePool));
        assert!(op.permissions.contains(&Permission::PausePool));
        assert!(!op.permissions.contains(&Permission::ExecuteEmergency));
    }

    #[test]
    fn test_default_roles_guardian_permissions() {
        let roles = default_roles();
        let g = roles.iter().find(|r| r.role_type == RoleType::Guardian).unwrap();
        assert!(g.permissions.contains(&Permission::ExecuteEmergency));
        assert!(g.permissions.contains(&Permission::PausePool));
        assert!(!g.permissions.contains(&Permission::CreatePool));
    }

    #[test]
    fn test_default_roles_proposer_permissions() {
        let roles = default_roles();
        let p = roles.iter().find(|r| r.role_type == RoleType::Proposer).unwrap();
        assert!(p.permissions.contains(&Permission::ManageGovernance));
        assert!(!p.permissions.contains(&Permission::CreatePool));
    }

    #[test]
    fn test_default_roles_keeper_permissions() {
        let roles = default_roles();
        let k = roles.iter().find(|r| r.role_type == RoleType::Keeper).unwrap();
        assert!(k.permissions.contains(&Permission::DistributeRewards));
        assert!(k.permissions.contains(&Permission::ConfigureOracle));
        assert!(k.permissions.contains(&Permission::ManageStaking));
    }

    #[test]
    fn test_default_roles_viewer_permissions() {
        let roles = default_roles();
        let v = roles.iter().find(|r| r.role_type == RoleType::Viewer).unwrap();
        assert_eq!(v.permissions.len(), 1);
        assert!(v.permissions.contains(&Permission::ViewAnalytics));
    }

    #[test]
    fn test_register_role_ok() {
        let mut reg = create_registry(false, 100);
        let role = Role {
            role_type: RoleType::Admin,
            permissions: vec![Permission::CreatePool],
            max_holders: 5,
            requires_multisig: false,
            time_limited: false,
        };
        assert!(register_role(&mut reg, role).is_ok());
        assert_eq!(reg.roles.len(), 1);
    }

    #[test]
    fn test_register_role_duplicate() {
        let mut reg = create_registry(false, 100);
        let role1 = Role {
            role_type: RoleType::Admin,
            permissions: vec![Permission::CreatePool],
            max_holders: 0,
            requires_multisig: false,
            time_limited: false,
        };
        let role2 = Role {
            role_type: RoleType::Admin,
            permissions: vec![Permission::PausePool],
            max_holders: 0,
            requires_multisig: false,
            time_limited: false,
        };
        assert!(register_role(&mut reg, role1).is_ok());
        assert_eq!(register_role(&mut reg, role2), Err(PermissionError::InvalidRole));
    }

    #[test]
    fn test_add_custom_role() {
        let mut reg = create_registry(false, 100);
        assert!(add_custom_role(&mut reg, 42, vec![Permission::CreatePool, Permission::PausePool], 3).is_ok());
        let role = get_role(&reg, &RoleType::Custom(42));
        assert!(role.is_some());
        assert_eq!(role.unwrap().max_holders, 3);
    }

    #[test]
    fn test_add_custom_role_duplicate_id() {
        let mut reg = create_registry(false, 100);
        add_custom_role(&mut reg, 1, vec![Permission::CreatePool], 0).unwrap();
        assert_eq!(
            add_custom_role(&mut reg, 1, vec![Permission::PausePool], 0),
            Err(PermissionError::InvalidRole)
        );
    }

    #[test]
    fn test_register_all_default_roles() {
        let reg = setup_registry();
        assert_eq!(reg.roles.len(), 7);
    }

    // ============ Role Assignment Tests ============

    #[test]
    fn test_grant_role_basic() {
        let mut reg = setup_registry();
        let result = grant_role(&mut reg, addr(1), RoleType::Admin, addr(0), 100, None);
        assert!(result.is_ok());
        assert_eq!(reg.assignments.len(), 1);
    }

    #[test]
    fn test_grant_role_with_expiry() {
        let mut reg = setup_registry();
        grant_role(&mut reg, addr(1), RoleType::Operator, addr(0), 100, Some(200)).unwrap();
        assert_eq!(reg.assignments[0].expires_at, Some(200));
    }

    #[test]
    fn test_grant_role_not_found() {
        let mut reg = create_registry(false, 100);
        // No roles registered
        assert_eq!(
            grant_role(&mut reg, addr(1), RoleType::Admin, addr(0), 100, None),
            Err(PermissionError::RoleNotFound)
        );
    }

    #[test]
    fn test_grant_role_already_assigned() {
        let mut reg = setup_registry();
        grant_role(&mut reg, addr(1), RoleType::Admin, addr(0), 100, None).unwrap();
        assert_eq!(
            grant_role(&mut reg, addr(1), RoleType::Admin, addr(0), 150, None),
            Err(PermissionError::AlreadyAssigned)
        );
    }

    #[test]
    fn test_grant_role_max_holders_reached() {
        let mut reg = create_registry(false, 100);
        let role = Role {
            role_type: RoleType::Operator,
            permissions: vec![Permission::CreatePool],
            max_holders: 2,
            requires_multisig: false,
            time_limited: false,
        };
        register_role(&mut reg, role).unwrap();
        grant_role(&mut reg, addr(1), RoleType::Operator, addr(0), 100, None).unwrap();
        grant_role(&mut reg, addr(2), RoleType::Operator, addr(0), 100, None).unwrap();
        assert_eq!(
            grant_role(&mut reg, addr(3), RoleType::Operator, addr(0), 100, None),
            Err(PermissionError::MaxHoldersReached)
        );
    }

    #[test]
    fn test_grant_role_expired_slot_can_be_reused() {
        let mut reg = setup_registry();
        grant_role(&mut reg, addr(1), RoleType::Admin, addr(0), 100, Some(200)).unwrap();
        // At time 200, the old assignment has expired, so can reassign
        let result = grant_role(&mut reg, addr(1), RoleType::Admin, addr(0), 200, None);
        assert!(result.is_ok());
    }

    #[test]
    fn test_grant_multiple_roles_same_address() {
        let mut reg = setup_registry();
        grant_role(&mut reg, addr(1), RoleType::Admin, addr(0), 100, None).unwrap();
        grant_role(&mut reg, addr(1), RoleType::Operator, addr(0), 100, None).unwrap();
        assert_eq!(reg.assignments.len(), 2);
    }

    #[test]
    fn test_grant_same_role_different_addresses() {
        let mut reg = setup_registry();
        grant_role(&mut reg, addr(1), RoleType::Viewer, addr(0), 100, None).unwrap();
        grant_role(&mut reg, addr(2), RoleType::Viewer, addr(0), 100, None).unwrap();
        assert_eq!(reg.assignments.len(), 2);
    }

    #[test]
    fn test_grant_custom_role() {
        let mut reg = create_registry(false, 100);
        add_custom_role(&mut reg, 99, vec![Permission::ViewAnalytics], 0).unwrap();
        assert!(grant_role(&mut reg, addr(5), RoleType::Custom(99), addr(0), 100, None).is_ok());
    }

    #[test]
    fn test_revoke_role_basic() {
        let mut reg = setup_with_two_admins();
        assert!(revoke_role(&mut reg, &addr(2), &RoleType::Admin).is_ok());
        assert!(!reg.assignments.iter().any(|a| a.address == addr(2) && a.active));
    }

    #[test]
    fn test_revoke_role_not_found() {
        let mut reg = setup_with_admin();
        assert_eq!(
            revoke_role(&mut reg, &addr(99), &RoleType::Admin),
            Err(PermissionError::AssignmentNotFound)
        );
    }

    #[test]
    fn test_revoke_last_admin_prevented() {
        let mut reg = setup_with_admin();
        assert_eq!(
            revoke_role(&mut reg, &addr(1), &RoleType::SuperAdmin),
            Err(PermissionError::CannotRevokeLastAdmin)
        );
    }

    #[test]
    fn test_revoke_last_admin_prevented_admin_type() {
        let mut reg = setup_registry();
        grant_role(&mut reg, addr(1), RoleType::Admin, addr(0), 100, None).unwrap();
        assert_eq!(
            revoke_role(&mut reg, &addr(1), &RoleType::Admin),
            Err(PermissionError::CannotRevokeLastAdmin)
        );
    }

    #[test]
    fn test_revoke_non_admin_role_freely() {
        let mut reg = setup_with_admin();
        grant_role(&mut reg, addr(5), RoleType::Viewer, addr(1), 100, None).unwrap();
        assert!(revoke_role(&mut reg, &addr(5), &RoleType::Viewer).is_ok());
    }

    #[test]
    fn test_revoke_all_roles() {
        let mut reg = setup_registry();
        grant_role(&mut reg, addr(1), RoleType::SuperAdmin, addr(0), 100, None).unwrap();
        grant_role(&mut reg, addr(1), RoleType::Operator, addr(0), 100, None).unwrap();
        grant_role(&mut reg, addr(1), RoleType::Viewer, addr(0), 100, None).unwrap();
        let count = revoke_all_roles(&mut reg, &addr(1));
        assert_eq!(count, 3);
        assert!(!has_any_role(&reg, &addr(1), 100));
    }

    #[test]
    fn test_revoke_all_roles_none_exist() {
        let mut reg = setup_registry();
        assert_eq!(revoke_all_roles(&mut reg, &addr(99)), 0);
    }

    #[test]
    fn test_extend_role_ok() {
        let mut reg = setup_registry();
        grant_role(&mut reg, addr(1), RoleType::Operator, addr(0), 100, Some(200)).unwrap();
        assert!(extend_role(&mut reg, &addr(1), &RoleType::Operator, 500).is_ok());
        assert_eq!(reg.assignments[0].expires_at, Some(500));
    }

    #[test]
    fn test_extend_role_not_found() {
        let mut reg = setup_registry();
        assert_eq!(
            extend_role(&mut reg, &addr(99), &RoleType::Admin, 500),
            Err(PermissionError::AssignmentNotFound)
        );
    }

    #[test]
    fn test_transfer_role_ok() {
        let mut reg = setup_with_two_admins();
        grant_role(&mut reg, addr(3), RoleType::Operator, addr(1), 100, None).unwrap();
        assert!(transfer_role(&mut reg, &addr(3), addr(4), &RoleType::Operator, 150).is_ok());
        assert!(!has_any_role(&reg, &addr(3), 150));
        assert!(has_any_role(&reg, &addr(4), 150));
    }

    #[test]
    fn test_transfer_role_expired_source() {
        let mut reg = setup_registry();
        grant_role(&mut reg, addr(1), RoleType::Operator, addr(0), 100, Some(200)).unwrap();
        assert_eq!(
            transfer_role(&mut reg, &addr(1), addr(2), &RoleType::Operator, 250),
            Err(PermissionError::RoleExpired)
        );
    }

    #[test]
    fn test_transfer_role_target_already_has() {
        let mut reg = setup_registry();
        grant_role(&mut reg, addr(1), RoleType::Operator, addr(0), 100, None).unwrap();
        grant_role(&mut reg, addr(2), RoleType::Operator, addr(0), 100, None).unwrap();
        assert_eq!(
            transfer_role(&mut reg, &addr(1), addr(2), &RoleType::Operator, 150),
            Err(PermissionError::AlreadyAssigned)
        );
    }

    #[test]
    fn test_transfer_role_source_not_found() {
        let mut reg = setup_registry();
        assert_eq!(
            transfer_role(&mut reg, &addr(99), addr(1), &RoleType::Admin, 100),
            Err(PermissionError::AssignmentNotFound)
        );
    }

    // ============ Permission Checking Tests ============

    #[test]
    fn test_has_permission_superadmin_has_all() {
        let reg = setup_with_admin();
        assert!(has_permission(&reg, &addr(1), &Permission::CreatePool, 100));
        assert!(has_permission(&reg, &addr(1), &Permission::UpgradeProtocol, 100));
        assert!(has_permission(&reg, &addr(1), &Permission::ViewAnalytics, 100));
        assert!(has_permission(&reg, &addr(1), &Permission::ManageTreasury, 100));
    }

    #[test]
    fn test_has_permission_no_role() {
        let reg = setup_with_admin();
        assert!(!has_permission(&reg, &addr(99), &Permission::CreatePool, 100));
    }

    #[test]
    fn test_has_permission_expired_role() {
        let mut reg = setup_registry();
        grant_role(&mut reg, addr(1), RoleType::Operator, addr(0), 100, Some(200)).unwrap();
        assert!(has_permission(&reg, &addr(1), &Permission::CreatePool, 150));
        assert!(!has_permission(&reg, &addr(1), &Permission::CreatePool, 200));
    }

    #[test]
    fn test_has_permission_specific_role() {
        let mut reg = setup_registry();
        grant_role(&mut reg, addr(1), RoleType::Viewer, addr(0), 100, None).unwrap();
        assert!(has_permission(&reg, &addr(1), &Permission::ViewAnalytics, 100));
        assert!(!has_permission(&reg, &addr(1), &Permission::CreatePool, 100));
    }

    #[test]
    fn test_has_permission_guardian_emergency() {
        let mut reg = setup_registry();
        grant_role(&mut reg, addr(1), RoleType::Guardian, addr(0), 100, None).unwrap();
        assert!(has_permission(&reg, &addr(1), &Permission::ExecuteEmergency, 100));
        assert!(has_permission(&reg, &addr(1), &Permission::PausePool, 100));
        assert!(!has_permission(&reg, &addr(1), &Permission::CreatePool, 100));
    }

    #[test]
    fn test_has_permission_revoked_role() {
        let mut reg = setup_with_two_admins();
        grant_role(&mut reg, addr(3), RoleType::Operator, addr(1), 100, None).unwrap();
        assert!(has_permission(&reg, &addr(3), &Permission::CreatePool, 100));
        revoke_role(&mut reg, &addr(3), &RoleType::Operator).unwrap();
        assert!(!has_permission(&reg, &addr(3), &Permission::CreatePool, 100));
    }

    #[test]
    fn test_has_permission_multiple_roles_union() {
        let mut reg = setup_registry();
        grant_role(&mut reg, addr(1), RoleType::Guardian, addr(0), 100, None).unwrap();
        grant_role(&mut reg, addr(1), RoleType::Proposer, addr(0), 100, None).unwrap();
        assert!(has_permission(&reg, &addr(1), &Permission::ExecuteEmergency, 100));
        assert!(has_permission(&reg, &addr(1), &Permission::ManageGovernance, 100));
    }

    #[test]
    fn test_check_permission_positive() {
        let reg = setup_with_admin();
        let check = check_permission(&reg, &addr(1), &Permission::CreatePool, 100);
        assert!(check.has_permission);
        assert_eq!(check.role, Some(RoleType::SuperAdmin));
        assert_eq!(check.expires_at, None);
        assert!(!check.requires_multisig);
        assert!(!check.is_time_limited);
    }

    #[test]
    fn test_check_permission_negative() {
        let reg = setup_with_admin();
        let check = check_permission(&reg, &addr(99), &Permission::CreatePool, 100);
        assert!(!check.has_permission);
        assert_eq!(check.role, None);
    }

    #[test]
    fn test_check_permission_with_expiry() {
        let mut reg = setup_registry();
        grant_role(&mut reg, addr(1), RoleType::Operator, addr(0), 100, Some(300)).unwrap();
        let check = check_permission(&reg, &addr(1), &Permission::CreatePool, 150);
        assert!(check.has_permission);
        assert_eq!(check.expires_at, Some(300));
    }

    #[test]
    fn test_check_permission_multisig_role() {
        let mut reg = create_registry(false, 100);
        let role = Role {
            role_type: RoleType::Admin,
            permissions: vec![Permission::ManageTreasury],
            max_holders: 0,
            requires_multisig: true,
            time_limited: false,
        };
        register_role(&mut reg, role).unwrap();
        grant_role(&mut reg, addr(1), RoleType::Admin, addr(0), 100, None).unwrap();
        let check = check_permission(&reg, &addr(1), &Permission::ManageTreasury, 100);
        assert!(check.has_permission);
        assert!(check.requires_multisig);
    }

    #[test]
    fn test_check_permission_time_limited_role() {
        let mut reg = create_registry(false, 100);
        let role = Role {
            role_type: RoleType::Operator,
            permissions: vec![Permission::CreatePool],
            max_holders: 0,
            requires_multisig: false,
            time_limited: true,
        };
        register_role(&mut reg, role).unwrap();
        grant_role(&mut reg, addr(1), RoleType::Operator, addr(0), 100, None).unwrap();
        let check = check_permission(&reg, &addr(1), &Permission::CreatePool, 100);
        assert!(check.is_time_limited);
    }

    #[test]
    fn test_authorize_success() {
        let mut reg = setup_with_admin();
        assert!(authorize(&mut reg, &addr(1), &Permission::CreatePool, 100, None).is_ok());
        assert_eq!(reg.action_log.len(), 1);
        assert!(reg.action_log[0].approved);
    }

    #[test]
    fn test_authorize_unauthorized() {
        let mut reg = setup_with_admin();
        assert_eq!(
            authorize(&mut reg, &addr(99), &Permission::CreatePool, 100, None),
            Err(PermissionError::Unauthorized)
        );
        assert_eq!(reg.action_log.len(), 1);
        assert!(!reg.action_log[0].approved);
    }

    #[test]
    fn test_authorize_with_target() {
        let mut reg = setup_with_admin();
        authorize(&mut reg, &addr(1), &Permission::ManageUsers, 100, Some(addr(5))).unwrap();
        assert_eq!(reg.action_log[0].target, Some(addr(5)));
    }

    #[test]
    fn test_authorize_multisig_required() {
        let mut reg = create_registry(false, 100);
        let role = Role {
            role_type: RoleType::Admin,
            permissions: vec![Permission::ManageTreasury],
            max_holders: 0,
            requires_multisig: true,
            time_limited: false,
        };
        register_role(&mut reg, role).unwrap();
        grant_role(&mut reg, addr(1), RoleType::Admin, addr(0), 100, None).unwrap();
        assert_eq!(
            authorize(&mut reg, &addr(1), &Permission::ManageTreasury, 100, None),
            Err(PermissionError::MultisigRequired)
        );
    }

    #[test]
    fn test_authorize_two_admin_required() {
        let mut reg = create_registry(true, 1000);
        for role in default_roles() {
            register_role(&mut reg, role).unwrap();
        }
        grant_role(&mut reg, addr(1), RoleType::SuperAdmin, addr(0), 100, None).unwrap();
        grant_role(&mut reg, addr(2), RoleType::Admin, addr(1), 100, None).unwrap();
        // First admin tries a sensitive operation — requires two admin approval
        let result = authorize(&mut reg, &addr(1), &Permission::UpgradeProtocol, 100, None);
        assert_eq!(result, Err(PermissionError::TwoAdminRequired));
    }

    #[test]
    fn test_can_grant_role_superadmin() {
        let reg = setup_with_admin();
        assert!(can_grant_role(&reg, &addr(1), &RoleType::Admin, 100));
        assert!(can_grant_role(&reg, &addr(1), &RoleType::Viewer, 100));
    }

    #[test]
    fn test_can_grant_role_admin_can_grant_lower() {
        let reg = setup_with_two_admins();
        assert!(can_grant_role(&reg, &addr(2), &RoleType::Operator, 100));
        assert!(can_grant_role(&reg, &addr(2), &RoleType::Viewer, 100));
    }

    #[test]
    fn test_can_grant_role_viewer_cannot_grant() {
        let mut reg = setup_with_admin();
        grant_role(&mut reg, addr(5), RoleType::Viewer, addr(1), 100, None).unwrap();
        assert!(!can_grant_role(&reg, &addr(5), &RoleType::Viewer, 100));
        assert!(!can_grant_role(&reg, &addr(5), &RoleType::Admin, 100));
    }

    #[test]
    fn test_can_grant_role_no_role() {
        let reg = setup_with_admin();
        assert!(!can_grant_role(&reg, &addr(99), &RoleType::Viewer, 100));
    }

    #[test]
    fn test_effective_permissions_single_role() {
        let mut reg = setup_registry();
        grant_role(&mut reg, addr(1), RoleType::Viewer, addr(0), 100, None).unwrap();
        let perms = effective_permissions(&reg, &addr(1), 100);
        assert_eq!(perms.len(), 1);
        assert!(perms.contains(&Permission::ViewAnalytics));
    }

    #[test]
    fn test_effective_permissions_multiple_roles() {
        let mut reg = setup_registry();
        grant_role(&mut reg, addr(1), RoleType::Guardian, addr(0), 100, None).unwrap();
        grant_role(&mut reg, addr(1), RoleType::Proposer, addr(0), 100, None).unwrap();
        let perms = effective_permissions(&reg, &addr(1), 100);
        assert!(perms.contains(&Permission::ExecuteEmergency));
        assert!(perms.contains(&Permission::ManageGovernance));
        assert!(perms.contains(&Permission::PausePool));
        assert!(perms.contains(&Permission::ViewAnalytics));
    }

    #[test]
    fn test_effective_permissions_no_duplicates() {
        let mut reg = setup_registry();
        // Guardian and Proposer both have ViewAnalytics
        grant_role(&mut reg, addr(1), RoleType::Guardian, addr(0), 100, None).unwrap();
        grant_role(&mut reg, addr(1), RoleType::Proposer, addr(0), 100, None).unwrap();
        let perms = effective_permissions(&reg, &addr(1), 100);
        let analytics_count = perms.iter().filter(|p| **p == Permission::ViewAnalytics).count();
        assert_eq!(analytics_count, 1);
    }

    #[test]
    fn test_effective_permissions_expired_role_excluded() {
        let mut reg = setup_registry();
        grant_role(&mut reg, addr(1), RoleType::Operator, addr(0), 100, Some(200)).unwrap();
        grant_role(&mut reg, addr(1), RoleType::Viewer, addr(0), 100, None).unwrap();
        let perms = effective_permissions(&reg, &addr(1), 250);
        assert!(perms.contains(&Permission::ViewAnalytics));
        assert!(!perms.contains(&Permission::CreatePool));
    }

    #[test]
    fn test_effective_permissions_superadmin() {
        let reg = setup_with_admin();
        let perms = effective_permissions(&reg, &addr(1), 100);
        assert!(perms.contains(&Permission::All));
    }

    #[test]
    fn test_effective_permissions_no_roles() {
        let reg = setup_registry();
        let perms = effective_permissions(&reg, &addr(99), 100);
        assert!(perms.is_empty());
    }

    // ============ Role Query Tests ============

    #[test]
    fn test_get_role_found() {
        let reg = setup_registry();
        let role = get_role(&reg, &RoleType::Admin);
        assert!(role.is_some());
        assert_eq!(role.unwrap().role_type, RoleType::Admin);
    }

    #[test]
    fn test_get_role_not_found() {
        let reg = setup_registry();
        assert!(get_role(&reg, &RoleType::Custom(999)).is_none());
    }

    #[test]
    fn test_role_holders_basic() {
        let reg = setup_with_two_admins();
        let holders = role_holders(&reg, &RoleType::SuperAdmin, 100);
        assert_eq!(holders.len(), 1);
        assert_eq!(holders[0], addr(1));
    }

    #[test]
    fn test_role_holders_multiple() {
        let mut reg = setup_registry();
        grant_role(&mut reg, addr(1), RoleType::Viewer, addr(0), 100, None).unwrap();
        grant_role(&mut reg, addr(2), RoleType::Viewer, addr(0), 100, None).unwrap();
        grant_role(&mut reg, addr(3), RoleType::Viewer, addr(0), 100, None).unwrap();
        let holders = role_holders(&reg, &RoleType::Viewer, 100);
        assert_eq!(holders.len(), 3);
    }

    #[test]
    fn test_role_holders_excludes_expired() {
        let mut reg = setup_registry();
        grant_role(&mut reg, addr(1), RoleType::Viewer, addr(0), 100, Some(200)).unwrap();
        grant_role(&mut reg, addr(2), RoleType::Viewer, addr(0), 100, None).unwrap();
        let holders = role_holders(&reg, &RoleType::Viewer, 250);
        assert_eq!(holders.len(), 1);
        assert_eq!(holders[0], addr(2));
    }

    #[test]
    fn test_role_holders_excludes_inactive() {
        let mut reg = setup_with_two_admins();
        grant_role(&mut reg, addr(3), RoleType::Viewer, addr(1), 100, None).unwrap();
        revoke_role(&mut reg, &addr(3), &RoleType::Viewer).unwrap();
        let holders = role_holders(&reg, &RoleType::Viewer, 100);
        assert!(holders.is_empty());
    }

    #[test]
    fn test_roles_for_address_basic() {
        let mut reg = setup_registry();
        grant_role(&mut reg, addr(1), RoleType::Admin, addr(0), 100, None).unwrap();
        grant_role(&mut reg, addr(1), RoleType::Operator, addr(0), 100, None).unwrap();
        let roles = roles_for_address(&reg, &addr(1), 100);
        assert_eq!(roles.len(), 2);
    }

    #[test]
    fn test_roles_for_address_no_roles() {
        let reg = setup_registry();
        let roles = roles_for_address(&reg, &addr(99), 100);
        assert!(roles.is_empty());
    }

    #[test]
    fn test_roles_for_address_expired_excluded() {
        let mut reg = setup_registry();
        grant_role(&mut reg, addr(1), RoleType::Admin, addr(0), 100, Some(200)).unwrap();
        let roles = roles_for_address(&reg, &addr(1), 250);
        assert!(roles.is_empty());
    }

    #[test]
    fn test_holder_count() {
        let mut reg = setup_registry();
        grant_role(&mut reg, addr(1), RoleType::Viewer, addr(0), 100, None).unwrap();
        grant_role(&mut reg, addr(2), RoleType::Viewer, addr(0), 100, None).unwrap();
        assert_eq!(holder_count(&reg, &RoleType::Viewer, 100), 2);
    }

    #[test]
    fn test_holder_count_empty() {
        let reg = setup_registry();
        assert_eq!(holder_count(&reg, &RoleType::Admin, 100), 0);
    }

    #[test]
    fn test_is_admin_true() {
        let reg = setup_with_two_admins();
        assert!(is_admin(&reg, &addr(1), 100)); // SuperAdmin
        assert!(is_admin(&reg, &addr(2), 100)); // Admin
    }

    #[test]
    fn test_is_admin_false() {
        let mut reg = setup_with_admin();
        grant_role(&mut reg, addr(5), RoleType::Operator, addr(1), 100, None).unwrap();
        assert!(!is_admin(&reg, &addr(5), 100));
    }

    #[test]
    fn test_is_superadmin_true() {
        let reg = setup_with_admin();
        assert!(is_superadmin(&reg, &addr(1), 100));
    }

    #[test]
    fn test_is_superadmin_false_for_admin() {
        let reg = setup_with_two_admins();
        assert!(!is_superadmin(&reg, &addr(2), 100));
    }

    #[test]
    fn test_has_any_role_true() {
        let mut reg = setup_registry();
        grant_role(&mut reg, addr(1), RoleType::Viewer, addr(0), 100, None).unwrap();
        assert!(has_any_role(&reg, &addr(1), 100));
    }

    #[test]
    fn test_has_any_role_false() {
        let reg = setup_registry();
        assert!(!has_any_role(&reg, &addr(99), 100));
    }

    #[test]
    fn test_has_any_role_all_expired() {
        let mut reg = setup_registry();
        grant_role(&mut reg, addr(1), RoleType::Viewer, addr(0), 100, Some(200)).unwrap();
        assert!(!has_any_role(&reg, &addr(1), 300));
    }

    // ============ Expiry Management Tests ============

    #[test]
    fn test_expire_assignments_basic() {
        let mut reg = setup_registry();
        grant_role(&mut reg, addr(1), RoleType::Viewer, addr(0), 100, Some(200)).unwrap();
        grant_role(&mut reg, addr(2), RoleType::Viewer, addr(0), 100, Some(300)).unwrap();
        let expired = expire_assignments(&mut reg, 250);
        assert_eq!(expired, 1);
        assert!(!reg.assignments[0].active);
        assert!(reg.assignments[1].active);
    }

    #[test]
    fn test_expire_assignments_none_expired() {
        let mut reg = setup_registry();
        grant_role(&mut reg, addr(1), RoleType::Viewer, addr(0), 100, Some(500)).unwrap();
        assert_eq!(expire_assignments(&mut reg, 200), 0);
    }

    #[test]
    fn test_expire_assignments_all_expired() {
        let mut reg = setup_registry();
        grant_role(&mut reg, addr(1), RoleType::Viewer, addr(0), 100, Some(200)).unwrap();
        grant_role(&mut reg, addr(2), RoleType::Operator, addr(0), 100, Some(200)).unwrap();
        assert_eq!(expire_assignments(&mut reg, 200), 2);
    }

    #[test]
    fn test_expire_assignments_no_expiry_not_affected() {
        let mut reg = setup_registry();
        grant_role(&mut reg, addr(1), RoleType::Viewer, addr(0), 100, None).unwrap();
        assert_eq!(expire_assignments(&mut reg, 999999), 0);
        assert!(reg.assignments[0].active);
    }

    #[test]
    fn test_expiring_soon_basic() {
        let mut reg = setup_registry();
        grant_role(&mut reg, addr(1), RoleType::Viewer, addr(0), 100, Some(500)).unwrap();
        grant_role(&mut reg, addr(2), RoleType::Viewer, addr(0), 100, Some(1000)).unwrap();
        let soon = expiring_soon(&reg, 400, 200);
        assert_eq!(soon.len(), 1);
        assert_eq!(soon[0].address, addr(1));
    }

    #[test]
    fn test_expiring_soon_none() {
        let mut reg = setup_registry();
        grant_role(&mut reg, addr(1), RoleType::Viewer, addr(0), 100, None).unwrap();
        let soon = expiring_soon(&reg, 100, 1000);
        assert!(soon.is_empty());
    }

    #[test]
    fn test_expiring_soon_already_expired_excluded() {
        let mut reg = setup_registry();
        grant_role(&mut reg, addr(1), RoleType::Viewer, addr(0), 100, Some(200)).unwrap();
        let soon = expiring_soon(&reg, 300, 100);
        assert!(soon.is_empty());
    }

    #[test]
    fn test_active_assignments_basic() {
        let mut reg = setup_registry();
        grant_role(&mut reg, addr(1), RoleType::Viewer, addr(0), 100, None).unwrap();
        grant_role(&mut reg, addr(2), RoleType::Viewer, addr(0), 100, Some(200)).unwrap();
        let active = active_assignments(&reg, 100);
        assert_eq!(active.len(), 2);
    }

    #[test]
    fn test_active_assignments_excludes_expired() {
        let mut reg = setup_registry();
        grant_role(&mut reg, addr(1), RoleType::Viewer, addr(0), 100, Some(200)).unwrap();
        grant_role(&mut reg, addr(2), RoleType::Viewer, addr(0), 100, None).unwrap();
        let active = active_assignments(&reg, 250);
        assert_eq!(active.len(), 1);
    }

    #[test]
    fn test_active_assignments_excludes_inactive() {
        let mut reg = setup_with_two_admins();
        grant_role(&mut reg, addr(3), RoleType::Viewer, addr(1), 100, None).unwrap();
        revoke_role(&mut reg, &addr(3), &RoleType::Viewer).unwrap();
        let active = active_assignments(&reg, 100);
        // Only the two admins
        assert_eq!(active.len(), 2);
    }

    // ============ Action Logging Tests ============

    #[test]
    fn test_log_action_basic() {
        let mut reg = create_registry(false, 100);
        assert!(log_action(&mut reg, addr(1), Permission::CreatePool, 100, true, None).is_ok());
        assert_eq!(reg.action_log.len(), 1);
        assert_eq!(reg.action_log[0].actor, addr(1));
        assert!(reg.action_log[0].approved);
    }

    #[test]
    fn test_log_action_with_target() {
        let mut reg = create_registry(false, 100);
        log_action(&mut reg, addr(1), Permission::ManageUsers, 100, true, Some(addr(5))).unwrap();
        assert_eq!(reg.action_log[0].target, Some(addr(5)));
    }

    #[test]
    fn test_log_action_full() {
        let mut reg = create_registry(false, 2);
        log_action(&mut reg, addr(1), Permission::CreatePool, 100, true, None).unwrap();
        log_action(&mut reg, addr(2), Permission::PausePool, 101, true, None).unwrap();
        assert_eq!(
            log_action(&mut reg, addr(3), Permission::UpdateFees, 102, true, None),
            Err(PermissionError::LogFull)
        );
    }

    #[test]
    fn test_log_action_unlimited() {
        let mut reg = create_registry(false, 0);
        for i in 0..100 {
            log_action(&mut reg, addr(1), Permission::ViewAnalytics, i as u64, true, None).unwrap();
        }
        assert_eq!(reg.action_log.len(), 100);
    }

    #[test]
    fn test_actions_by_actor() {
        let mut reg = create_registry(false, 100);
        log_action(&mut reg, addr(1), Permission::CreatePool, 100, true, None).unwrap();
        log_action(&mut reg, addr(2), Permission::PausePool, 101, true, None).unwrap();
        log_action(&mut reg, addr(1), Permission::UpdateFees, 102, true, None).unwrap();
        let actions = actions_by_actor(&reg, &addr(1));
        assert_eq!(actions.len(), 2);
    }

    #[test]
    fn test_actions_by_actor_none() {
        let reg = create_registry(false, 100);
        assert!(actions_by_actor(&reg, &addr(99)).is_empty());
    }

    #[test]
    fn test_recent_actions() {
        let mut reg = create_registry(false, 100);
        for i in 0..10 {
            log_action(&mut reg, addr(1), Permission::ViewAnalytics, i, true, None).unwrap();
        }
        let recent = recent_actions(&reg, 3);
        assert_eq!(recent.len(), 3);
        assert_eq!(recent[0].timestamp, 7);
        assert_eq!(recent[2].timestamp, 9);
    }

    #[test]
    fn test_recent_actions_more_than_available() {
        let mut reg = create_registry(false, 100);
        log_action(&mut reg, addr(1), Permission::CreatePool, 100, true, None).unwrap();
        let recent = recent_actions(&reg, 10);
        assert_eq!(recent.len(), 1);
    }

    #[test]
    fn test_denied_actions() {
        let mut reg = create_registry(false, 100);
        log_action(&mut reg, addr(1), Permission::CreatePool, 100, true, None).unwrap();
        log_action(&mut reg, addr(2), Permission::PausePool, 101, false, None).unwrap();
        log_action(&mut reg, addr(3), Permission::UpdateFees, 102, false, None).unwrap();
        let denied = denied_actions(&reg);
        assert_eq!(denied.len(), 2);
    }

    #[test]
    fn test_denied_actions_none() {
        let mut reg = create_registry(false, 100);
        log_action(&mut reg, addr(1), Permission::CreatePool, 100, true, None).unwrap();
        assert!(denied_actions(&reg).is_empty());
    }

    #[test]
    fn test_actions_for_permission() {
        let mut reg = create_registry(false, 100);
        log_action(&mut reg, addr(1), Permission::CreatePool, 100, true, None).unwrap();
        log_action(&mut reg, addr(2), Permission::CreatePool, 101, false, None).unwrap();
        log_action(&mut reg, addr(3), Permission::PausePool, 102, true, None).unwrap();
        let actions = actions_for_permission(&reg, &Permission::CreatePool);
        assert_eq!(actions.len(), 2);
    }

    #[test]
    fn test_actions_for_permission_none() {
        let reg = create_registry(false, 100);
        assert!(actions_for_permission(&reg, &Permission::UpgradeProtocol).is_empty());
    }

    // ============ Two-Admin Rule Tests ============

    #[test]
    fn test_needs_second_admin_enabled() {
        let reg = create_registry(true, 100);
        assert!(needs_second_admin(&reg, &Permission::UpgradeProtocol));
        assert!(needs_second_admin(&reg, &Permission::ExecuteEmergency));
        assert!(needs_second_admin(&reg, &Permission::ManageTreasury));
        assert!(needs_second_admin(&reg, &Permission::All));
    }

    #[test]
    fn test_needs_second_admin_non_sensitive() {
        let reg = create_registry(true, 100);
        assert!(!needs_second_admin(&reg, &Permission::CreatePool));
        assert!(!needs_second_admin(&reg, &Permission::ViewAnalytics));
    }

    #[test]
    fn test_needs_second_admin_disabled() {
        let reg = create_registry(false, 100);
        assert!(!needs_second_admin(&reg, &Permission::UpgradeProtocol));
        assert!(!needs_second_admin(&reg, &Permission::All));
    }

    #[test]
    fn test_has_two_admin_approval_true() {
        let mut reg = create_registry(true, 1000);
        for role in default_roles() {
            register_role(&mut reg, role).unwrap();
        }
        grant_role(&mut reg, addr(1), RoleType::SuperAdmin, addr(0), 100, None).unwrap();
        grant_role(&mut reg, addr(2), RoleType::Admin, addr(1), 100, None).unwrap();
        // Two different admins approve within window
        log_action(&mut reg, addr(1), Permission::UpgradeProtocol, 100, true, None).unwrap();
        log_action(&mut reg, addr(2), Permission::UpgradeProtocol, 110, true, None).unwrap();
        assert!(has_two_admin_approval(&reg, &Permission::UpgradeProtocol, 120, 60_000));
    }

    #[test]
    fn test_has_two_admin_approval_same_admin() {
        let mut reg = create_registry(true, 1000);
        for role in default_roles() {
            register_role(&mut reg, role).unwrap();
        }
        grant_role(&mut reg, addr(1), RoleType::SuperAdmin, addr(0), 100, None).unwrap();
        // Same admin approves twice — should NOT count
        log_action(&mut reg, addr(1), Permission::UpgradeProtocol, 100, true, None).unwrap();
        log_action(&mut reg, addr(1), Permission::UpgradeProtocol, 110, true, None).unwrap();
        assert!(!has_two_admin_approval(&reg, &Permission::UpgradeProtocol, 120, 60_000));
    }

    #[test]
    fn test_has_two_admin_approval_outside_window() {
        let mut reg = create_registry(true, 1000);
        for role in default_roles() {
            register_role(&mut reg, role).unwrap();
        }
        grant_role(&mut reg, addr(1), RoleType::SuperAdmin, addr(0), 100, None).unwrap();
        grant_role(&mut reg, addr(2), RoleType::Admin, addr(1), 100, None).unwrap();
        // Approvals too far apart
        log_action(&mut reg, addr(1), Permission::UpgradeProtocol, 100, true, None).unwrap();
        log_action(&mut reg, addr(2), Permission::UpgradeProtocol, 200, true, None).unwrap();
        assert!(!has_two_admin_approval(&reg, &Permission::UpgradeProtocol, 200, 50));
    }

    #[test]
    fn test_has_two_admin_approval_non_admin_doesnt_count() {
        let mut reg = create_registry(true, 1000);
        for role in default_roles() {
            register_role(&mut reg, role).unwrap();
        }
        grant_role(&mut reg, addr(1), RoleType::SuperAdmin, addr(0), 100, None).unwrap();
        grant_role(&mut reg, addr(2), RoleType::Operator, addr(1), 100, None).unwrap();
        log_action(&mut reg, addr(1), Permission::UpgradeProtocol, 100, true, None).unwrap();
        log_action(&mut reg, addr(2), Permission::UpgradeProtocol, 110, true, None).unwrap();
        assert!(!has_two_admin_approval(&reg, &Permission::UpgradeProtocol, 120, 60_000));
    }

    // ============ Analytics Tests ============

    #[test]
    fn test_permission_coverage_full() {
        let reg = setup_with_admin(); // SuperAdmin has All
        let coverage = permission_coverage(&reg, 100);
        assert_eq!(coverage, 10_000); // 100%
    }

    #[test]
    fn test_permission_coverage_zero() {
        let reg = setup_registry(); // No assignments
        assert_eq!(permission_coverage(&reg, 100), 0);
    }

    #[test]
    fn test_permission_coverage_partial() {
        let mut reg = setup_registry();
        // Viewer only has ViewAnalytics (1 out of 14 non-All permissions)
        grant_role(&mut reg, addr(1), RoleType::Viewer, addr(0), 100, None).unwrap();
        let coverage = permission_coverage(&reg, 100);
        assert_eq!(coverage, 714); // 1/14 = ~714 bps
    }

    #[test]
    fn test_role_distribution() {
        let mut reg = setup_registry();
        grant_role(&mut reg, addr(1), RoleType::SuperAdmin, addr(0), 100, None).unwrap();
        grant_role(&mut reg, addr(2), RoleType::Admin, addr(1), 100, None).unwrap();
        grant_role(&mut reg, addr(3), RoleType::Admin, addr(1), 100, None).unwrap();
        let dist = role_distribution(&reg, 100);
        let sa = dist.iter().find(|(r, _)| *r == RoleType::SuperAdmin);
        let admin = dist.iter().find(|(r, _)| *r == RoleType::Admin);
        assert_eq!(sa.unwrap().1, 1);
        assert_eq!(admin.unwrap().1, 2);
    }

    #[test]
    fn test_role_distribution_empty() {
        let reg = setup_registry();
        let dist = role_distribution(&reg, 100);
        assert!(dist.iter().all(|(_, count)| *count == 0));
    }

    #[test]
    fn test_most_active_actor_basic() {
        let mut reg = create_registry(false, 100);
        log_action(&mut reg, addr(1), Permission::CreatePool, 100, true, None).unwrap();
        log_action(&mut reg, addr(2), Permission::CreatePool, 101, true, None).unwrap();
        log_action(&mut reg, addr(1), Permission::PausePool, 102, true, None).unwrap();
        log_action(&mut reg, addr(1), Permission::UpdateFees, 103, true, None).unwrap();
        assert_eq!(most_active_actor(&reg), Some(addr(1)));
    }

    #[test]
    fn test_most_active_actor_empty() {
        let reg = create_registry(false, 100);
        assert_eq!(most_active_actor(&reg), None);
    }

    #[test]
    fn test_most_active_actor_tie() {
        let mut reg = create_registry(false, 100);
        log_action(&mut reg, addr(1), Permission::CreatePool, 100, true, None).unwrap();
        log_action(&mut reg, addr(2), Permission::PausePool, 101, true, None).unwrap();
        // Tie — first encountered with max count wins
        let result = most_active_actor(&reg);
        assert!(result == Some(addr(1)) || result == Some(addr(2)));
    }

    #[test]
    fn test_admin_count() {
        let reg = setup_with_two_admins();
        assert_eq!(admin_count(&reg, 100), 2);
    }

    #[test]
    fn test_admin_count_zero() {
        let reg = setup_registry();
        assert_eq!(admin_count(&reg, 100), 0);
    }

    #[test]
    fn test_admin_count_no_duplicate_counting() {
        let mut reg = setup_registry();
        // Same address with both SuperAdmin and Admin — should count as 1
        grant_role(&mut reg, addr(1), RoleType::SuperAdmin, addr(0), 100, None).unwrap();
        grant_role(&mut reg, addr(1), RoleType::Admin, addr(0), 100, None).unwrap();
        assert_eq!(admin_count(&reg, 100), 1);
    }

    #[test]
    fn test_admin_count_expired_excluded() {
        let mut reg = setup_registry();
        grant_role(&mut reg, addr(1), RoleType::Admin, addr(0), 100, Some(200)).unwrap();
        assert_eq!(admin_count(&reg, 100), 1);
        assert_eq!(admin_count(&reg, 200), 0);
    }

    #[test]
    fn test_total_assignments() {
        let mut reg = setup_with_two_admins();
        grant_role(&mut reg, addr(3), RoleType::Viewer, addr(1), 100, None).unwrap();
        assert_eq!(total_assignments(&reg), 3);
    }

    #[test]
    fn test_total_assignments_includes_inactive() {
        let mut reg = setup_with_two_admins();
        grant_role(&mut reg, addr(3), RoleType::Viewer, addr(1), 100, None).unwrap();
        revoke_role(&mut reg, &addr(3), &RoleType::Viewer).unwrap();
        assert_eq!(total_assignments(&reg), 3); // Still 3, inactive included
    }

    // ============ Hierarchy Tests ============

    #[test]
    fn test_role_level_values() {
        assert_eq!(role_level(&RoleType::SuperAdmin), 6);
        assert_eq!(role_level(&RoleType::Admin), 5);
        assert_eq!(role_level(&RoleType::Operator), 4);
        assert_eq!(role_level(&RoleType::Guardian), 3);
        assert_eq!(role_level(&RoleType::Proposer), 2);
        assert_eq!(role_level(&RoleType::Keeper), 1);
        assert_eq!(role_level(&RoleType::Viewer), 0);
        assert_eq!(role_level(&RoleType::Custom(42)), 0);
    }

    #[test]
    fn test_is_higher_role_true() {
        assert!(is_higher_role(&RoleType::SuperAdmin, &RoleType::Admin));
        assert!(is_higher_role(&RoleType::Admin, &RoleType::Operator));
        assert!(is_higher_role(&RoleType::Operator, &RoleType::Guardian));
        assert!(is_higher_role(&RoleType::Guardian, &RoleType::Proposer));
    }

    #[test]
    fn test_is_higher_role_false() {
        assert!(!is_higher_role(&RoleType::Viewer, &RoleType::SuperAdmin));
        assert!(!is_higher_role(&RoleType::Admin, &RoleType::Admin));
    }

    #[test]
    fn test_is_higher_role_equal() {
        assert!(!is_higher_role(&RoleType::Viewer, &RoleType::Viewer));
        assert!(!is_higher_role(&RoleType::Custom(1), &RoleType::Custom(2)));
    }

    #[test]
    fn test_minimum_role_for_view_analytics() {
        assert_eq!(minimum_role_for(&Permission::ViewAnalytics), RoleType::Viewer);
    }

    #[test]
    fn test_minimum_role_for_distribute_rewards() {
        assert_eq!(minimum_role_for(&Permission::DistributeRewards), RoleType::Keeper);
    }

    #[test]
    fn test_minimum_role_for_manage_governance() {
        assert_eq!(minimum_role_for(&Permission::ManageGovernance), RoleType::Proposer);
    }

    #[test]
    fn test_minimum_role_for_execute_emergency() {
        assert_eq!(minimum_role_for(&Permission::ExecuteEmergency), RoleType::Guardian);
    }

    #[test]
    fn test_minimum_role_for_create_pool() {
        assert_eq!(minimum_role_for(&Permission::CreatePool), RoleType::Operator);
    }

    #[test]
    fn test_minimum_role_for_manage_treasury() {
        assert_eq!(minimum_role_for(&Permission::ManageTreasury), RoleType::Admin);
    }

    #[test]
    fn test_minimum_role_for_upgrade_protocol() {
        assert_eq!(minimum_role_for(&Permission::UpgradeProtocol), RoleType::Admin);
    }

    #[test]
    fn test_minimum_role_for_all() {
        assert_eq!(minimum_role_for(&Permission::All), RoleType::SuperAdmin);
    }

    #[test]
    fn test_minimum_role_for_manage_bridge() {
        assert_eq!(minimum_role_for(&Permission::ManageBridge), RoleType::Admin);
    }

    #[test]
    fn test_minimum_role_for_configure_oracle() {
        assert_eq!(minimum_role_for(&Permission::ConfigureOracle), RoleType::Keeper);
    }

    #[test]
    fn test_minimum_role_for_manage_staking() {
        assert_eq!(minimum_role_for(&Permission::ManageStaking), RoleType::Keeper);
    }

    // ============ Validation Tests ============

    #[test]
    fn test_validate_registry_clean() {
        let reg = setup_with_admin();
        let errors = validate_registry(&reg, 100);
        assert!(errors.is_empty());
    }

    #[test]
    fn test_validate_registry_no_admin() {
        let reg = setup_registry();
        let errors = validate_registry(&reg, 100);
        assert!(errors.contains(&PermissionError::Unauthorized));
    }

    #[test]
    fn test_validate_registry_expired_assignment() {
        let mut reg = setup_with_admin();
        grant_role(&mut reg, addr(5), RoleType::Viewer, addr(1), 100, Some(200)).unwrap();
        let errors = validate_registry(&reg, 250);
        assert!(errors.contains(&PermissionError::RoleExpired));
    }

    #[test]
    fn test_validate_registry_inconsistent() {
        let mut reg = setup_with_admin();
        // Manually add an assignment with no matching role
        reg.assignments.push(RoleAssignment {
            address: addr(99),
            role_type: RoleType::Custom(999),
            granted_by: addr(1),
            granted_at: 100,
            expires_at: None,
            active: true,
        });
        let errors = validate_registry(&reg, 100);
        assert!(errors.contains(&PermissionError::RoleNotFound));
    }

    #[test]
    fn test_validate_registry_max_holders_violated() {
        let mut reg = create_registry(false, 100);
        let role = Role {
            role_type: RoleType::Operator,
            permissions: vec![Permission::CreatePool],
            max_holders: 1,
            requires_multisig: false,
            time_limited: false,
        };
        register_role(&mut reg, role).unwrap();
        // Add SuperAdmin so we have an admin
        for r in default_roles().into_iter().filter(|r| r.role_type == RoleType::SuperAdmin) {
            register_role(&mut reg, r).unwrap();
        }
        grant_role(&mut reg, addr(1), RoleType::SuperAdmin, addr(0), 100, None).unwrap();
        // Force two operator assignments
        grant_role(&mut reg, addr(2), RoleType::Operator, addr(1), 100, None).unwrap();
        reg.assignments.push(RoleAssignment {
            address: addr(3),
            role_type: RoleType::Operator,
            granted_by: addr(1),
            granted_at: 100,
            expires_at: None,
            active: true,
        });
        let errors = validate_registry(&reg, 100);
        assert!(errors.contains(&PermissionError::MaxHoldersReached));
    }

    #[test]
    fn test_has_admin_true() {
        let reg = setup_with_admin();
        assert!(has_admin(&reg, 100));
    }

    #[test]
    fn test_has_admin_false() {
        let reg = setup_registry();
        assert!(!has_admin(&reg, 100));
    }

    #[test]
    fn test_has_admin_expired() {
        let mut reg = setup_registry();
        grant_role(&mut reg, addr(1), RoleType::Admin, addr(0), 100, Some(200)).unwrap();
        assert!(has_admin(&reg, 100));
        assert!(!has_admin(&reg, 200));
    }

    #[test]
    fn test_is_consistent_true() {
        let reg = setup_with_admin();
        assert!(is_consistent(&reg));
    }

    #[test]
    fn test_is_consistent_false() {
        let mut reg = setup_registry();
        reg.assignments.push(RoleAssignment {
            address: addr(1),
            role_type: RoleType::Custom(777),
            granted_by: addr(0),
            granted_at: 100,
            expires_at: None,
            active: true,
        });
        assert!(!is_consistent(&reg));
    }

    #[test]
    fn test_is_consistent_inactive_orphans_ok() {
        let mut reg = setup_registry();
        reg.assignments.push(RoleAssignment {
            address: addr(1),
            role_type: RoleType::Custom(777),
            granted_by: addr(0),
            granted_at: 100,
            expires_at: None,
            active: false,
        });
        // Inactive assignments are not checked
        assert!(is_consistent(&reg));
    }

    #[test]
    fn test_permission_count_basic() {
        let roles = default_roles();
        let admin = roles.iter().find(|r| r.role_type == RoleType::Admin).unwrap();
        assert_eq!(permission_count(admin), 13);
    }

    #[test]
    fn test_permission_count_superadmin() {
        let roles = default_roles();
        let sa = roles.iter().find(|r| r.role_type == RoleType::SuperAdmin).unwrap();
        assert_eq!(permission_count(sa), 1); // Just Permission::All
    }

    #[test]
    fn test_permission_count_viewer() {
        let roles = default_roles();
        let v = roles.iter().find(|r| r.role_type == RoleType::Viewer).unwrap();
        assert_eq!(permission_count(v), 1);
    }

    #[test]
    fn test_cleanup_inactive_basic() {
        let mut reg = setup_with_two_admins();
        grant_role(&mut reg, addr(3), RoleType::Viewer, addr(1), 100, None).unwrap();
        revoke_role(&mut reg, &addr(3), &RoleType::Viewer).unwrap();
        assert_eq!(reg.assignments.len(), 3);
        let cleaned = cleanup_inactive(&mut reg);
        assert_eq!(cleaned, 1);
        assert_eq!(reg.assignments.len(), 2);
    }

    #[test]
    fn test_cleanup_inactive_none() {
        let reg = setup_with_admin();
        let mut reg = reg;
        assert_eq!(cleanup_inactive(&mut reg), 0);
    }

    #[test]
    fn test_cleanup_inactive_all() {
        let mut reg = setup_registry();
        grant_role(&mut reg, addr(1), RoleType::Viewer, addr(0), 100, None).unwrap();
        revoke_all_roles(&mut reg, &addr(1));
        assert_eq!(cleanup_inactive(&mut reg), 1);
        assert!(reg.assignments.is_empty());
    }

    // ============ Integration / Edge Case Tests ============

    #[test]
    fn test_full_lifecycle() {
        let mut reg = setup_registry();
        // Grant SuperAdmin
        grant_role(&mut reg, addr(1), RoleType::SuperAdmin, addr(0), 100, None).unwrap();
        assert!(is_superadmin(&reg, &addr(1), 100));
        // Grant Admin
        grant_role(&mut reg, addr(2), RoleType::Admin, addr(1), 100, None).unwrap();
        assert!(is_admin(&reg, &addr(2), 100));
        // Grant Operator with expiry
        grant_role(&mut reg, addr(3), RoleType::Operator, addr(1), 100, Some(500)).unwrap();
        assert!(has_permission(&reg, &addr(3), &Permission::CreatePool, 100));
        // Authorize action
        assert!(authorize(&mut reg, &addr(3), &Permission::CreatePool, 200, None).is_ok());
        // Extend operator role
        extend_role(&mut reg, &addr(3), &RoleType::Operator, 1000).unwrap();
        assert!(has_permission(&reg, &addr(3), &Permission::CreatePool, 800));
        // Revoke admin
        revoke_role(&mut reg, &addr(2), &RoleType::Admin).unwrap();
        assert!(!is_admin(&reg, &addr(2), 100));
        // Expire the operator role
        assert_eq!(expire_assignments(&mut reg, 1000), 1);
        assert!(!has_permission(&reg, &addr(3), &Permission::CreatePool, 1000));
        // Cleanup
        let cleaned = cleanup_inactive(&mut reg);
        assert!(cleaned >= 2);
    }

    #[test]
    fn test_custom_role_lifecycle() {
        let mut reg = setup_with_admin();
        add_custom_role(&mut reg, 1, vec![Permission::CreatePool, Permission::PausePool], 2).unwrap();
        grant_role(&mut reg, addr(5), RoleType::Custom(1), addr(1), 100, None).unwrap();
        assert!(has_permission(&reg, &addr(5), &Permission::CreatePool, 100));
        assert!(!has_permission(&reg, &addr(5), &Permission::ManageTreasury, 100));
        grant_role(&mut reg, addr(6), RoleType::Custom(1), addr(1), 100, None).unwrap();
        // Max holders reached (2)
        assert_eq!(
            grant_role(&mut reg, addr(7), RoleType::Custom(1), addr(1), 100, None),
            Err(PermissionError::MaxHoldersReached)
        );
    }

    #[test]
    fn test_permission_coverage_with_operator() {
        let mut reg = setup_registry();
        grant_role(&mut reg, addr(1), RoleType::Operator, addr(0), 100, None).unwrap();
        let coverage = permission_coverage(&reg, 100);
        // Operator has: CreatePool, PausePool, UpdateFees, ManageWhitelist, DistributeRewards, ViewAnalytics = 6/14
        assert_eq!(coverage, 4285); // 6/14 = ~4285 bps
    }

    #[test]
    fn test_transfer_preserves_expiry() {
        let mut reg = setup_registry();
        grant_role(&mut reg, addr(1), RoleType::Operator, addr(0), 100, Some(500)).unwrap();
        transfer_role(&mut reg, &addr(1), addr(2), &RoleType::Operator, 150).unwrap();
        let assignment = reg.assignments.iter().find(|a| a.address == addr(2) && a.active).unwrap();
        assert_eq!(assignment.expires_at, Some(500));
    }

    #[test]
    fn test_multiple_permissions_across_roles() {
        let mut reg = setup_registry();
        grant_role(&mut reg, addr(1), RoleType::Keeper, addr(0), 100, None).unwrap();
        grant_role(&mut reg, addr(1), RoleType::Guardian, addr(0), 100, None).unwrap();
        let perms = effective_permissions(&reg, &addr(1), 100);
        // Keeper: DistributeRewards, ConfigureOracle, ManageStaking, ViewAnalytics
        // Guardian: ExecuteEmergency, PausePool, ViewAnalytics
        // Union (no duplicates): 6
        assert_eq!(perms.len(), 6);
        assert!(perms.contains(&Permission::DistributeRewards));
        assert!(perms.contains(&Permission::ExecuteEmergency));
    }

    #[test]
    fn test_authorize_logs_denied() {
        let mut reg = setup_with_admin();
        let _ = authorize(&mut reg, &addr(99), &Permission::CreatePool, 100, None);
        let denied = denied_actions(&reg);
        assert_eq!(denied.len(), 1);
        assert_eq!(denied[0].actor, addr(99));
    }

    #[test]
    fn test_role_distribution_with_expired() {
        let mut reg = setup_registry();
        grant_role(&mut reg, addr(1), RoleType::Viewer, addr(0), 100, Some(200)).unwrap();
        grant_role(&mut reg, addr(2), RoleType::Viewer, addr(0), 100, None).unwrap();
        let dist = role_distribution(&reg, 250);
        let viewer = dist.iter().find(|(r, _)| *r == RoleType::Viewer).unwrap();
        assert_eq!(viewer.1, 1);
    }

    #[test]
    fn test_expiring_soon_window_edge() {
        let mut reg = setup_registry();
        grant_role(&mut reg, addr(1), RoleType::Viewer, addr(0), 100, Some(500)).unwrap();
        // Exactly at window boundary: now=400, window=100 => range (400, 500], 500 is included
        let soon = expiring_soon(&reg, 400, 100);
        assert_eq!(soon.len(), 1);
        // Window just misses: now=399, window=100 => range (399, 499], 500 is outside
        let soon = expiring_soon(&reg, 399, 100);
        assert_eq!(soon.len(), 0);
        // Window doesn't reach
        let soon = expiring_soon(&reg, 100, 100);
        assert!(soon.is_empty());
    }

    #[test]
    fn test_grant_role_records_metadata() {
        let mut reg = setup_registry();
        grant_role(&mut reg, addr(5), RoleType::Viewer, addr(1), 12345, Some(99999)).unwrap();
        let a = &reg.assignments[0];
        assert_eq!(a.granted_by, addr(1));
        assert_eq!(a.granted_at, 12345);
        assert_eq!(a.expires_at, Some(99999));
        assert!(a.active);
    }

    #[test]
    fn test_revoke_admin_with_another_admin_remaining() {
        let mut reg = setup_with_two_admins();
        // addr(1) = SuperAdmin, addr(2) = Admin — can revoke one
        assert!(revoke_role(&mut reg, &addr(2), &RoleType::Admin).is_ok());
        assert_eq!(admin_count(&reg, 100), 1);
    }

    #[test]
    fn test_permission_all_covers_everything() {
        let reg = setup_with_admin();
        let all_perms = vec![
            Permission::CreatePool, Permission::PausePool, Permission::UpdateFees,
            Permission::ManageWhitelist, Permission::ExecuteEmergency,
            Permission::ManageGovernance, Permission::DistributeRewards,
            Permission::UpgradeProtocol, Permission::ManageTreasury,
            Permission::ManageBridge, Permission::ConfigureOracle,
            Permission::ManageStaking, Permission::ViewAnalytics,
            Permission::ManageUsers,
        ];
        for perm in &all_perms {
            assert!(has_permission(&reg, &addr(1), perm, 100), "SuperAdmin missing {:?}", perm);
        }
    }

    #[test]
    fn test_can_grant_role_operator_can_grant_lower() {
        let mut reg = setup_registry();
        grant_role(&mut reg, addr(1), RoleType::Operator, addr(0), 100, None).unwrap();
        assert!(can_grant_role(&reg, &addr(1), &RoleType::Proposer, 100));
        assert!(can_grant_role(&reg, &addr(1), &RoleType::Viewer, 100));
        assert!(!can_grant_role(&reg, &addr(1), &RoleType::Admin, 100));
    }

    #[test]
    fn test_can_grant_role_guardian_can_grant_lower() {
        let mut reg = setup_registry();
        grant_role(&mut reg, addr(1), RoleType::Guardian, addr(0), 100, None).unwrap();
        assert!(can_grant_role(&reg, &addr(1), &RoleType::Proposer, 100));
        assert!(can_grant_role(&reg, &addr(1), &RoleType::Keeper, 100));
        assert!(can_grant_role(&reg, &addr(1), &RoleType::Viewer, 100));
        assert!(!can_grant_role(&reg, &addr(1), &RoleType::Operator, 100));
    }

    #[test]
    fn test_keeper_permissions_exactly() {
        let mut reg = setup_registry();
        grant_role(&mut reg, addr(1), RoleType::Keeper, addr(0), 100, None).unwrap();
        assert!(has_permission(&reg, &addr(1), &Permission::DistributeRewards, 100));
        assert!(has_permission(&reg, &addr(1), &Permission::ConfigureOracle, 100));
        assert!(has_permission(&reg, &addr(1), &Permission::ManageStaking, 100));
        assert!(has_permission(&reg, &addr(1), &Permission::ViewAnalytics, 100));
        assert!(!has_permission(&reg, &addr(1), &Permission::CreatePool, 100));
        assert!(!has_permission(&reg, &addr(1), &Permission::ExecuteEmergency, 100));
    }

    #[test]
    fn test_action_record_fields() {
        let mut reg = create_registry(false, 100);
        log_action(&mut reg, addr(7), Permission::ManageBridge, 42, false, Some(addr(8))).unwrap();
        let rec = &reg.action_log[0];
        assert_eq!(rec.actor, addr(7));
        assert_eq!(rec.permission, Permission::ManageBridge);
        assert_eq!(rec.timestamp, 42);
        assert!(!rec.approved);
        assert_eq!(rec.target, Some(addr(8)));
    }

    #[test]
    fn test_empty_registry_queries() {
        let reg = create_registry(false, 100);
        assert!(!has_permission(&reg, &addr(1), &Permission::CreatePool, 100));
        assert!(!is_admin(&reg, &addr(1), 100));
        assert!(!is_superadmin(&reg, &addr(1), 100));
        assert!(!has_any_role(&reg, &addr(1), 100));
        assert_eq!(admin_count(&reg, 100), 0);
        assert_eq!(total_assignments(&reg), 0);
        assert_eq!(most_active_actor(&reg), None);
        assert_eq!(permission_coverage(&reg, 100), 0);
        assert!(role_holders(&reg, &RoleType::Admin, 100).is_empty());
        assert!(roles_for_address(&reg, &addr(1), 100).is_empty());
        assert!(active_assignments(&reg, 100).is_empty());
    }

    #[test]
    fn test_revoke_then_regrant() {
        let mut reg = setup_with_two_admins();
        grant_role(&mut reg, addr(3), RoleType::Viewer, addr(1), 100, None).unwrap();
        revoke_role(&mut reg, &addr(3), &RoleType::Viewer).unwrap();
        assert!(!has_any_role(&reg, &addr(3), 100));
        // Re-grant should work since previous is inactive
        grant_role(&mut reg, addr(3), RoleType::Viewer, addr(1), 200, None).unwrap();
        assert!(has_any_role(&reg, &addr(3), 200));
    }

    #[test]
    fn test_multiple_custom_roles() {
        let mut reg = create_registry(false, 100);
        add_custom_role(&mut reg, 1, vec![Permission::CreatePool], 0).unwrap();
        add_custom_role(&mut reg, 2, vec![Permission::PausePool], 0).unwrap();
        add_custom_role(&mut reg, 3, vec![Permission::UpdateFees], 0).unwrap();
        assert_eq!(reg.roles.len(), 3);
    }

    #[test]
    fn test_has_two_admin_approval_denied_logs_ignored() {
        let mut reg = create_registry(true, 1000);
        for role in default_roles() {
            register_role(&mut reg, role).unwrap();
        }
        grant_role(&mut reg, addr(1), RoleType::SuperAdmin, addr(0), 100, None).unwrap();
        grant_role(&mut reg, addr(2), RoleType::Admin, addr(1), 100, None).unwrap();
        // One approved, one denied
        log_action(&mut reg, addr(1), Permission::UpgradeProtocol, 100, true, None).unwrap();
        log_action(&mut reg, addr(2), Permission::UpgradeProtocol, 110, false, None).unwrap();
        assert!(!has_two_admin_approval(&reg, &Permission::UpgradeProtocol, 120, 60_000));
    }

    #[test]
    fn test_cleanup_preserves_active() {
        let mut reg = setup_with_two_admins();
        grant_role(&mut reg, addr(3), RoleType::Viewer, addr(1), 100, None).unwrap();
        grant_role(&mut reg, addr(4), RoleType::Viewer, addr(1), 100, None).unwrap();
        revoke_role(&mut reg, &addr(3), &RoleType::Viewer).unwrap();
        let before_active = active_assignments(&reg, 100).len();
        cleanup_inactive(&mut reg);
        let after_active = active_assignments(&reg, 100).len();
        assert_eq!(before_active, after_active);
    }

    #[test]
    fn test_authorize_non_sensitive_no_two_admin() {
        let mut reg = create_registry(true, 1000);
        for role in default_roles() {
            register_role(&mut reg, role).unwrap();
        }
        grant_role(&mut reg, addr(1), RoleType::SuperAdmin, addr(0), 100, None).unwrap();
        // Non-sensitive permission should not require two admin
        assert!(authorize(&mut reg, &addr(1), &Permission::CreatePool, 100, None).is_ok());
    }

    #[test]
    fn test_extend_role_changes_only_target() {
        let mut reg = setup_registry();
        grant_role(&mut reg, addr(1), RoleType::Operator, addr(0), 100, Some(200)).unwrap();
        grant_role(&mut reg, addr(2), RoleType::Operator, addr(0), 100, Some(300)).unwrap();
        extend_role(&mut reg, &addr(1), &RoleType::Operator, 999).unwrap();
        assert_eq!(reg.assignments[0].expires_at, Some(999));
        assert_eq!(reg.assignments[1].expires_at, Some(300)); // Unchanged
    }
}
