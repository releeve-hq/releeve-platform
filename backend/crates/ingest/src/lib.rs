//! `ingest` — Stellar network ingestion (Phase 2).
//!
//! Horizon / Soroban-RPC / BigQuery workers that pull transactions, events,
//! and ledger entries into the platform, plus feed materialization and
//! rate-limiting for the public explorer endpoints.
//!
//! **Status:** Phase 2 skeleton. No live code yet — Phase 0 only requires the
//! workspace member to exist so the crate split is stable from day one.

pub fn placeholder() -> &'static str {
    "ingest: phase 2 skeleton"
}
