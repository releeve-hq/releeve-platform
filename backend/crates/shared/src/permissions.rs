//! Flat organization-member permission model (doc 02 §2.1, doc 03 §2).
//!
//! Permissions are stored as a single SMALLINT bitmask on
//! `organization_members.permissions`. Each enum variant owns exactly one bit,
//! so there is no named-role hierarchy — every permission is individually
//! toggleable. The bit positions are fixed by the database schema comment and
//! must not be reordered here without a schema migration.

use serde::{Deserialize, Serialize};

const CREATE_PROJECTS: i16 = 1 << 0;
const UPDATE_PROJECTS: i16 = 1 << 1;
const DELETE_PROJECTS: i16 = 1 << 2;
const MANAGE_MEMBERS: i16 = 1 << 3;
const MANAGE_ACCESS_TOKENS: i16 = 1 << 4;
const MANAGE_BILLING: i16 = 1 << 5;
/// Releeve-specific: gates who can run mutating/impersonation simulations.
/// Present and checkable from Phase 1 but inert until Phase 5.
const MANAGE_FORK_SESSIONS: i16 = 1 << 6;

/// A single toggleable permission. Every variant maps to exactly one bit.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize, utoipa::ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum Permission {
    CreateProjects,
    UpdateProjects,
    DeleteProjects,
    ManageMembers,
    ManageAccessTokens,
    ManageBilling,
    ManageForkSessions,
}

impl Permission {
    pub fn bit(self) -> i16 {
        match self {
            Permission::CreateProjects => CREATE_PROJECTS,
            Permission::UpdateProjects => UPDATE_PROJECTS,
            Permission::DeleteProjects => DELETE_PROJECTS,
            Permission::ManageMembers => MANAGE_MEMBERS,
            Permission::ManageAccessTokens => MANAGE_ACCESS_TOKENS,
            Permission::ManageBilling => MANAGE_BILLING,
            Permission::ManageForkSessions => MANAGE_FORK_SESSIONS,
        }
    }

    pub const ALL: &'static [Permission] = &[
        Permission::CreateProjects,
        Permission::UpdateProjects,
        Permission::DeleteProjects,
        Permission::ManageMembers,
        Permission::ManageAccessTokens,
        Permission::ManageBilling,
        Permission::ManageForkSessions,
    ];
}

/// A permission bitmask built from the raw SMALLINT stored on a membership.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct PermissionSet(pub i16);

impl PermissionSet {
    pub fn none() -> Self {
        PermissionSet(0)
    }

    /// The bitmask an owner/creator of an org should hold: every bit set.
    pub fn all() -> Self {
        PermissionSet(
            CREATE_PROJECTS
                | UPDATE_PROJECTS
                | DELETE_PROJECTS
                | MANAGE_MEMBERS
                | MANAGE_ACCESS_TOKENS
                | MANAGE_BILLING
                | MANAGE_FORK_SESSIONS,
        )
    }

    pub fn set(&self, permission: Permission) -> Self {
        PermissionSet(self.0 | permission.bit())
    }

    pub fn clear(&self, permission: Permission) -> Self {
        PermissionSet(self.0 & !permission.bit())
    }

    pub fn contains(&self, permission: Permission) -> bool {
        self.0 & permission.bit() != 0
    }

    pub fn raw(&self) -> i16 {
        self.0
    }

    /// Which of the known bits are set, for serialization to an API array.
    pub fn iter(&self) -> Vec<Permission> {
        Permission::ALL
            .iter()
            .copied()
            .filter(|p| self.contains(*p))
            .collect()
    }
}

impl From<i16> for PermissionSet {
    fn from(raw: i16) -> Self {
        PermissionSet(raw)
    }
}

impl From<&[Permission]> for PermissionSet {
    fn from(perms: &[Permission]) -> Self {
        perms
            .iter()
            .fold(PermissionSet::none(), |set, p| set.set(*p))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn every_permission_maps_to_exactly_one_distinct_bit() {
        let bits: std::collections::HashSet<i16> =
            Permission::ALL.iter().map(|p| p.bit()).collect();
        assert_eq!(bits.len(), Permission::ALL.len(), "bits are unique");
        // Bits must not alias the reserved next bit or collide numerically.
        assert_eq!(Permission::ManageForkSessions.bit(), 1 << 6);
    }

    #[test]
    fn contains_and_toggle_round_trip() {
        let set = PermissionSet::none();
        assert!(!set.contains(Permission::ManageMembers));
        let set = set.set(Permission::ManageMembers);
        assert!(set.contains(Permission::ManageMembers));
        assert!(!set.contains(Permission::CreateProjects));
        let set = set.clear(Permission::ManageMembers);
        assert!(!set.contains(Permission::ManageMembers));
        assert_eq!(set.raw(), 0);
    }

    #[test]
    fn all_sets_every_bit_and_iter_matches() {
        let set = PermissionSet::all();
        for p in Permission::ALL {
            assert!(set.contains(*p));
        }
        assert_eq!(set.iter().len(), Permission::ALL.len());
        assert_eq!(set.raw(), (1 << 7) - 1);
    }

    #[test]
    fn builds_from_slice() {
        let set = PermissionSet::from(&[Permission::CreateProjects][..]);
        assert!(set.contains(Permission::CreateProjects));
        assert!(!set.contains(Permission::UpdateProjects));
    }

    #[test]
    fn serde_round_trip_snake_case() {
        let json = r#"["create_projects","manage_members"]"#;
        let perms: Vec<Permission> = serde_json::from_str(json).unwrap();
        assert!(perms.contains(&Permission::CreateProjects));
        assert!(perms.contains(&Permission::ManageMembers));
        assert!(!perms.contains(&Permission::DeleteProjects));

        let out = serde_json::to_value(Permission::ManageForkSessions).unwrap();
        assert_eq!(out, "manage_fork_sessions");
    }
}
