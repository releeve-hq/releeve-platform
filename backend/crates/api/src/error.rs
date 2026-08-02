//! HTTP error mapping.
//!
//! [`shared::Error`] implements `axum::response::IntoResponse` (defined in the
//! `shared` crate, which owns the type), producing the uniform JSON envelope
//! described in phase 0. The `api` crate needs only the type to be in scope,
//! which the handlers already import via `shared::Error`.
