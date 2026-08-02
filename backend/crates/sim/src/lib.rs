//! `sim` — fork-core integration client (Phase 5).
//!
//! Talks to the standalone fork-core engine across a clean boundary (CLI or
//! service) and maps engine output → platform DTOs for the simulation
//! endpoints. The engine itself lives outside this repo (doc `04`).
//!
//! **Status:** Phase 5 skeleton. No live code yet — Phase 0 only requires the
//! workspace member to exist so the crate split is stable from day one.

pub fn placeholder() -> &'static str {
    "sim: phase 5 skeleton"
}
