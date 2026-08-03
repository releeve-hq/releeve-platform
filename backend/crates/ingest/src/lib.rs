//! `ingest` — Stellar network ingestion (Phase 2).
//!
//! Horizon / Soroban-RPC workers that pull ledgers, transactions, events, and
//! ledger entries into the platform, plus feed materialization and rate-limiting
//! for the public explorer endpoints.

pub mod asset;
pub mod daemon;
pub mod decode;
pub mod feeds;
pub mod models;
pub mod prices;
pub mod ratelimit;
pub mod rollup;
pub mod rpc;
pub mod state;
pub mod sync;
pub mod upstream;
pub mod worker;
