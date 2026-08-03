//! `shared` — domain types, shared DTOs, pagination/cursor utilities,
//! the uniform error envelope, and process configuration.
//!
//! This crate has NO dependencies on the rest of the platform by design: every
//! later crate (api, ingest, alerts, sim) depends on it, never the other way.

pub mod config;
pub mod cursor;
pub mod error;
pub mod pagination;
pub mod permissions;

pub use config::{IngestSettings, Settings};
pub use cursor::{Cursor, CursorError};
pub use error::{Error, ErrorEnvelope, ErrorKind, Result};
pub use pagination::{ALLOWED_LIMITS, DEFAULT_LIMIT, Paged, Pagination, clamp_limit};
pub use permissions::{Permission, PermissionSet};
