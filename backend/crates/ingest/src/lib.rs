//! `ingest` — Stellar network ingestion (Phase 2).
//!
//! Horizon / Soroban-RPC workers that pull ledgers, transactions, events, and
//! ledger entries into the platform, plus feed materialization and rate-limiting
//! for the public explorer endpoints.

pub mod asset;
pub mod decode;
pub mod models;
pub mod rollup;
pub mod state;
pub mod sync;
pub mod upstream;
