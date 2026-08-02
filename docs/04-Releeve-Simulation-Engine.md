# Releeve — Simulation Engine ("Fork-Core")

**Status:** Living document. This is the actual product differentiator — everything in `01`, `02`, `03` is necessary product surface, but this is the piece with no existing equivalent on Stellar. Built and proven **standalone**, before platform integration (see §9, Phased Build Plan).

---

## 1. The Problem, Stated Precisely

Soroban's `simulateTransaction` RPC method already does a dry-run of a transaction against **real, current, unmodified ledger state**. This is confirmed and well-understood — it returns `results`, `cost` (CPU/memory), and `events` (diagnostic events), and it genuinely executes the transaction rather than statically analyzing it. It answers: *"what would happen if I submitted this exact transaction right now, against the world as it actually is?"*

What it structurally **cannot** do, by design, because it never lies to you about state:
- Tell you what happens if a specific account had a different balance than it actually has
- Let you act as (impersonate) an address whose private key you don't hold
- Let you mutate a contract's storage to a hypothetical value before replaying against it
- Fast-forward or rewind the ledger clock to test time-locked logic without waiting in real time

This is the exact same gap Tenderly's **Simulator**, **Forks**, and **Virtual TestNets** products fill on EVM chains — confirmed directly from Tenderly's own case studies:

- **Aave** needed this because <cite>"at scale, Aave behaves differently; large deposits shift utilization, rates, and risk parameters in ways small test amounts never reveal"</cite> — they can't test whale-scale behavior without whale-scale test balances they don't actually have.
- **Tenor** needed this to skip real multi-day timelock waiting periods and to avoid leaking unreleased code on a public testnet.
- **zeroShadow** (an incident-response firm) needed this to verify an exploit-recovery script works *before* risking real gas/timing racing an actual attacker, and to show non-technical clients exactly what a recovery transaction will do before it happens.

**Nothing on Stellar does this today.** `erst`/hintents (the closest project) only overrides the simulated ledger **timestamp** — a narrow slice of one feature. It does not do arbitrary balance/storage override, and does not do auth impersonation. This was confirmed by directly reading `erst`'s own docs and README rather than assumed.

---

## 2. Three Sub-Problems Investigated, and Their Actual Difficulty (this order matters — see §9)

The overall idea decomposes into three genuinely separate engineering problems, discovered and scoped over the course of design discussion. Do not treat them as one blob of "build the simulator" — they have very different risk profiles.

### 2.1 State-Forking / Impersonation (the core mechanism)

**What it is:** pull real ledger entries for a specific footprint, load them into a local mutable store, let a user override specific values (a balance, a storage key) or impersonate a signer (bypass auth checks for a chosen address), then replay a real invocation against that store using the real execution engine.

**Why it's tractable, not a research problem:**
- The execution engine already exists and is open-source Rust: `soroban-env-host`, the exact same host the RPC node itself uses internally for `simulateTransaction`. You are not writing a WASM interpreter — you are reusing the real one.
- `soroban-simulation` (a published crate within `stellar/rs-soroban-env`) already provides footprint resolution, storage-access abstraction, and auth-payload recording end-to-end — this is explicitly described in the crate's own docs as: *"given an invocation specification and provided with on-chain storage access, this allows users to record all the information necessary for submitting the transaction on-chain, such as the storage access footprint, necessary resources, recorded authorization payloads."* This was, going into this project, assumed to be "hard, novel work" — it turned out to already be a maintained, actively-released crate (63 releases as of research, latest June 2026).
- State is just ledger entries, retrievable via `getLedgerEntries`. "Overriding" is just mutating an entry in your local copy before handing it to the host.
- Auth bypass is intercepting wherever `require_auth`-style signature verification happens and short-circuiting it for chosen addresses — conceptually the same pattern Soroban's own SDK test harness already uses to skip real signature verification in unit tests, just applied against real mainnet snapshots instead of synthetic test state.

**Where the real difficulty actually lives:** not in "can you fork state" but in **correctness under mutation**. A subtly wrong storage-trait implementation doesn't crash — it silently produces a plausible-looking wrong answer, which is the worst failure mode for a tool whose entire value proposition is "trust this result before risking real money." This is why §6 (Verification Strategy) is the most important section in this document, not an afterthought.

### 2.2 Source-Line Mapping (WASM trap → Rust `file:line`)

**What it is:** when a contract call fails, map the raw WASM instruction offset where it trapped back to the actual line of Rust source code that produced it — turning "failed at byte offset 4821" into "failed at `token/src/lib.rs:42`."

**Confirmed status on Stellar:** genuinely unbuilt anywhere. `erst`'s own README lists this explicitly under **"Core Features (Planned)"**, not shipped — despite the project's roadmap claiming to be in "Phase 4: Advanced Diagnostics & Source Mapping (Current Focus)," an internal inconsistency worth noting (claiming the focus phase while the deliverables of that phase are still marked Planned).

**Why it's narrower but has a hard ceiling on applicability:**
- Mechanically tractable: this is a well-understood problem with existing tooling. Rust's `-g` flag preserves DWARF debug info; the `gimli` crate already parses DWARF in Rust; wiring a trap's instruction offset through DWARF resolution to `file:line` is a bounded, well-scoped piece of engineering — a few weeks of focused work, not a research project.
- **The hard ceiling:** this only works for contracts **compiled with debug symbols intact**, which almost certainly excludes most already-deployed production contracts, since debug info is typically stripped to reduce deployed WASM size (smaller contract = cheaper deployment/execution fees — there's active pressure *against* keeping symbols around). So this solves "debug my own contract during my own development," not "debug any contract's revert on mainnet" — a meaningfully smaller claim than the original "Tenderly for Soroban" ambition implied.

**Sequencing decision:** build this **second**, or in parallel by a second contributor, but do not let it block §2.1. It is a self-contained slice usable even without the fork-core (you can source-map a real, already-failed transaction's trap without needing hypothetical state at all).

### 2.3 Virtual Environment / State Sync (persistent, shared, multi-tenant fork)

**What it is:** the full Tenderly "Virtual TestNet" experience — a persistent, named, live-synced fork with its own hosted RPC endpoint, faucet, public explorer, and per-team/per-member isolation, that a whole team develops against for weeks, not seconds.

**Confirmed real-world justification, from three independent Tenderly case studies, each needing it for a genuinely different reason:**
- Aave: shared, persistent, deployed-once state so contract/backend/frontend teams don't redeploy against each other constantly, plus whale-scale balance testing via unlimited faucet cheatcodes.
- Tenor: privacy (public testnet would leak unreleased code) + eliminating real multi-day timelock waits via time-skip cheatcodes.
- zeroShadow: a standing, shareable public link a non-technical client can review before authorizing a fund-recovery action.

**Explicit scoping decision: this is NOT MVP.** The mechanism itself (§2.1's fork-core, running continuously with a sync loop and conflict-resolution rule instead of once) is only an *incremental* addition once §2.1 exists. What makes this hard is not the algorithm — it's **operational infrastructure**: 24/7 hosting, a hosted RPC endpoint per environment, multi-tenant isolation, a UI (dashboard/explorer/faucet), auth/billing. That is a different *category* of difficulty (ops/infra scale) than the Rust-correctness difficulty of §2.1, and it is explicitly deferred — see §9.

---

## 3. Architecture

```
fork-core/                    # pure Rust engine, no UI dependency
├── Cargo.toml                # depends on soroban-env-host, soroban-simulation (NOT forked — added as deps)
└── src/
    ├── snapshot.rs           # getLedgerEntries → local, footprint-scoped snapshot
    ├── store.rs               # implements the Host's storage-access trait, backed by the local snapshot
    ├── override.rs            # the "cheatcode" mutation API — set_balance, set_storage_value, etc.
    ├── auth_bypass.rs         # impersonation — intercept and short-circuit signature verification for chosen addresses
    ├── source_map.rs          # [Phase 2] DWARF parsing (gimli), offset → file:line resolution
    └── executor.rs            # wires store.rs into soroban-env-host::Host, runs the invocation, captures trace output

cli/                          # thin CLI wrapper, proof-of-concept harness — NOT the deliverable itself, a test harness for the engine
```

**Where you point an LLM coding agent, concretely (this was scoped explicitly during design):**

1. **Primary dependency, added via Cargo, never forked:**
   `stellar/rs-soroban-env` → specifically the `soroban-simulation` crate (footprint resolution, storage-access abstraction, auth recording — already built, do not reimplement) and `soroban-env-host` (the actual `Host` type and execution engine).

2. **Read closely before writing `store.rs`:**
   `soroban-env-host/src/storage.rs` — understand exactly what storage-access trait/interface the `Host` expects, so your local-snapshot-backed implementation satisfies it correctly. This is the single highest-risk file to get subtly wrong.

3. **Reference only, do not depend on:**
   `dotandev/hintents` (erst) — specifically `docs/architecture.md`, purely for the pattern of "how does a CLI talk to a separate Rust execution process." Fork-core has **no dependency** on erst anywhere in its critical path; this is prior art to learn from, not infrastructure to build on. (Full reasoning for this distinction is in the design conversation history — erst's simulation/source-mapping capability is explicitly marked "Planned," not usable as a dependency.)

**Working with an LLM coding agent on this codebase, concretely:**
```bash
git clone https://github.com/stellar/rs-soroban-env
cd rs-soroban-env
cargo doc --open -p soroban-env-host -p soroban-simulation
```
Point the agent at this **cloned, real source** as a reference dependency it can read directly — do not let it recall the API from training data / general Soroban knowledge, since this ecosystem moves fast (63 releases on this one repo) and recalled internals are likely stale. This applies especially to RPC response shapes: a real Protocol 23 schema change was found during this project's own research where `getTransaction`'s `diagnosticEvents` field moved from a flat top-level field to a nested `events: { diagnosticEventsXdr, transactionEventsXdr, contractEventsXdr }` object — code written against older docs or an older SDK's field names will silently break against current responses.

---

## 4. Data Sources — What Each RPC Method Is Actually For

Confirmed directly by making real requests during design, not assumed from docs alone:

| Method | Job | Used for |
|---|---|---|
| `getTransaction` | Full detail for **one specific transaction you already have the hash for** — `resultMetaXdr` (state changes, results), `events` (diagnostic/transaction/contract events, nested per-operation) | Replaying/inspecting a known transaction; the correctness-oracle diff target (§6) |
| `getEvents` | **Discovery** — scan a *range of ledgers* for events matching a filter, without already knowing which transaction produced them | Platform monitoring/dashboard layer (§7), not the fork-core itself |
| `getLedgerEntries` | Retrieve **actual current ledger entry contents** | Building the fork-core's snapshot — this is the only one of the three that gives you state to mutate, as opposed to describing what already happened |

**Confirmed gotchas from real testing:**
- Diagnostic events (`diagnostic_events` / the rich `core_metrics` breakdown showing `cpu_insn`, `mem_byte`, `invoke_time_nsecs`, `max_rw_key_byte`, `max_rw_data_byte`) only populate if the specific RPC node queried has `ENABLE_SOROBAN_DIAGNOSTIC_EVENTS` enabled. Confirmed present on at least one real testnet RPC endpoint during design testing (via Stellar Lab) — do not assume it's universally on for every public RPC provider; check per-endpoint.
- Public RPC nodes retain only a **24-hour to 7-day** transaction history window (confirmed directly — a real transaction hash returned `"status": "NOT_FOUND"` once past this window, with `oldestLedgerCloseTime` in the response revealing exactly where the window currently sits). For historical replay beyond this window, options are self-indexing, a third-party indexer, or Stellar's public BigQuery dataset (Hubble) — not solved by MVP scope, noted for later.
- Even a **real Soroban contract invocation** doesn't guarantee nested cross-contract calls appear in every example — confirmed directly: a real `push(...)` oracle invocation showed a single-hop call with `contractEventsJson: [[]]` (empty), no second contract touched. True multi-hop nesting (the interesting case for a call-tree UI) needs a transaction like a DEX swap or a lending-protocol interaction (Blend, Aquarius) to actually exercise it — worth deliberately sourcing such an example for engine test fixtures rather than assuming any random Soroban tx demonstrates nesting.

---

## 5. How Resource/Cost Modeling Actually Works Under Mutation

This was a specific, important question during design: **can hypothetical resource costs (CPU, memory, fees) be trusted for a mutated/impersonated scenario, or only guessed at?**

**Answer: measurement stays exact; only scenario realism is a design responsibility, not a fundamental limitation.**

- Soroban resource numbers are **not predicted or statistically estimated** — they are directly metered by the host *during actual execution*, the same way a profiler counts real function calls. `simulateTransaction` itself already works exactly this way: it executes, then reports what was actually consumed.
- Consequence: fork-core doesn't need to *predict* cost for a hypothetical scenario — it needs to *actually run* the hypothetical scenario and let the host meter it for real, identically to how it meters any other execution. The host doesn't know or care that an input balance is "fake" — it executes the real WASM bytecode with that value in memory and counts real instructions as it goes.
- **Where accuracy genuinely gets shakier, and why this is a design responsibility, not a blocker:**
  1. **Divergent code paths** — a mutated balance can push execution down a branch that's never actually been exercised on real chain (e.g., an overflow-adjacent conditional). The instruction count is real *for that path*, but there's no real-world baseline to cross-check it against, since nothing like it has happened yet — which is the entire point, but means "is this representative" is a human judgment call, not something the tool can self-verify.
  2. **Internal consistency of the scenario** — if you mutate a balance but don't also keep other contextual state (ledger close time, sequence numbers) consistent with that scenario, you can get a technically-real-but-not-meaningfully-representative result. The fix is design discipline in `override.rs` (consistently updating all state a mutation should logically touch), not a change to the execution model.
  3. **Global, non-footprint-scoped pricing state** (e.g., storage rent pricing tied to ledger-wide parameters) — if your fork snapshot is stale relative to current network-wide fee parameters, a technically-correct execution can still be priced against outdated parameters. Mitigate by recording and displaying `base_ledger_sequence` prominently on every simulation result, so staleness is visible, not hidden.

This finding is the same reason Tenderly's own gas estimates on forked/overridden EVM state are trusted enough for Aave and Safe to sign real multisig transactions off of — the underlying EVM is also executing real bytecode with real metering under the hood, just against forked state. Same pattern, same justification, ported cleanly.

---

## 6. Verification Strategy (the single most important section)

**Core principle, stated as the constraint every other design decision must satisfy:** a wrong result must be *loud*, never quiet. This governs build order more than any other single decision in this project.

### 6.1 The correctness oracle

> An **unmutated** replay through fork-core must produce a result that is byte-for-byte (or field-for-field, after JSON normalization) identical to what real `simulateTransaction` / `getTransaction` returns for the exact same invocation.

This is the test that must pass **before any override/mutation logic is written at all.** If the unmutated case doesn't match, the storage-trait implementation (`store.rs`) has a bug, and every mutated result built on top of it is untrustworthy in a way that won't announce itself.

### 6.2 Staged build order, each stage gated by a concrete check

1. **Read-only, no mutation.** Pull real current state for one known testnet contract via `getLedgerEntries`, load into `soroban-env-host`'s `Host` unmodified, replay an invocation, diff against `stellar-cli simulate`'s own output for the identical invocation. **Do not proceed past this stage until they match exactly.**
2. **Add mutation, verify by contradiction.** Override one balance to something impossible on real state (e.g., 10x a real account's actual balance), replay, and confirm the *only* things that changed in the output are causally downstream of that one mutation — nothing else in the trace should differ from stage 1's baseline.
3. **Auth bypass, verify both directions.** Impersonate an address you don't hold keys for; confirm the invocation executes as that address. Then test the **negative case explicitly**: an invocation that should still fail auth for an address you did *not* impersonate — this catches the failure mode of accidentally disabling all auth checking globally instead of scoping the bypass correctly.
4. **CLI wrapper**, only once the engine underneath is proven correct — the CLI is a test harness for the engine, not the deliverable.

### 6.3 CI-level enforcement

- Every PR runs the "unmutated replay matches `stellar-cli simulate`" oracle test against a fixed set of known testnet transactions — a correctness-regression job, distinct from ordinary `cargo test`/`clippy`/`fmt`.
- Version bumps to `soroban-env-host` / `soroban-simulation` specifically always trigger the full correctness-regression suite before merge — never auto-merged the way an ordinary patch-version dependency bump might be, given how fast this repo moves (63 releases observed) and the real, confirmed schema drift (Protocol 23's `events` restructuring) already found during research.

### 6.4 Where to slow down when working with an LLM coding agent

- **Move fast on:** RPC client code, snapshot serialization, CLI argument parsing, test scaffolding.
- **Review line-by-line, do not let an agent move fast on:** the storage-trait implementation (`store.rs`) and the auth-bypass logic (`auth_bypass.rs`). These are the two places a wrong assumption produces a *plausible* wrong answer instead of a crash — the single worst failure mode for a tool whose value proposition is "trust this before risking real funds."

---

## 7. Edge Cases and Failure Modes to Explicitly Test

- **Cross-contract calls where a called contract isn't in your local snapshot.** Real footprint resolution needs to correctly identify and pull everything a given invocation will *transitively* touch, not just the top-level contract. Test with a real multi-hop transaction (a swap, a Blend liquidation) specifically, since single-hop examples won't exercise this at all.
- **Partial/incomplete footprint.** What happens if a mutation causes execution to branch into reading a ledger entry that wasn't in the original (unmutated) footprint and therefore wasn't pulled into the snapshot? Define explicit failure behavior (error clearly) rather than silently returning a default/zero value.
- **Stale global pricing state** (§5) — test that `base_ledger_sequence` is always recorded and surfaced, and consider a warning when a fork snapshot's age exceeds some threshold relative to current network state.
- **Auth-bypass leakage** — explicit negative-case test (§6.2, stage 3) — an impersonation flag scoped to one address must never silently apply to any other signer in the same invocation.
- **Isolation between concurrent sessions/environments** (relevant even at MVP, more so once §2.3 is eventually built): each `fork` invocation should be a fresh, independent snapshot held only in that process's memory — trivially isolated by construction, since nothing persists or is shared between separate CLI invocations. When persistence is eventually added, isolation becomes explicit **namespacing**: a shared, cheap, read-only base snapshot (safe to share, since it's historical fact) plus separate, per-environment override diffs (never shared) — this is the architectural shape to design toward, not full state duplication per environment.
- **Protocol version drift.** `soroban-env-host` moves fast; decide explicitly whether fork-core pins to one host version or tracks latest, and run a "nightly against latest host" CI job separately from the "stable" branch so protocol upgrades that break assumptions are caught early, not discovered by a user.
- **Resource-limit edge cases.** Blend's own deployment scripts document an empirically-discovered real constraint ("8 is a good max for standard setups due to Soroban resource limits") — a good, real-world-sourced test fixture: construct a scenario that intentionally approaches a documented resource limit and confirm fork-core's metering matches the real limit-hitting behavior, not just "successful" scenarios.

---

## 8. How This Differs From Tenderly's EVM Equivalent — Concretely, Not Just "Different Chain"

| Dimension | Tenderly (EVM) | Fork-core (Soroban) |
|---|---|---|
| Execution engine | Reimplements/wraps EVM execution (or uses go-ethereum-derived tooling) | **Reuses the real, official `soroban-env-host`** — the same code the RPC node itself runs. Not a reimplementation. |
| Calldata / call decoding | Requires a 4-byte function-selector lookup against signature databases; raw calldata is opaque hex needing active decoding | **Function names and typed arguments are natively present** in `InvokeContractArgs` — no selector-hash decoding layer needed at all. Structural advantage, not a feature Releeve has to build. |
| Storage model | Slot-based (`SLOAD`/`SSTORE` against 32-byte hashed slots), largely opaque without a decoder | Key-value `ContractData` entries, already meaningfully structured; before/after diffs are directly usable without slot-hash reverse-engineering |
| Events | Positional `log0`–`log4` topics, need ABI/signature matching to become meaningful | Natively typed and named (`{"symbol": "set_authorized", ...}`) — genuinely easier to decode well than EVM's equivalent |
| Cost/fee model | Live, congestion-driven gas auction — price genuinely fluctuates block to block, is itself a signal worth charting | Schedule-based resource metering against a stable, published fee schedule — not auction-driven. Charting "average price over time" the way Tenderly does is solving a volatility problem Soroban doesn't structurally have. |
| Trace granularity worth displaying | Per-opcode (`JUMP`/`CALL`/`SLOAD`/`SSTORE`), individually gas-metered, genuinely useful because EVM's opacity is fine-grained and fee-sensitive at that level | **Coarser, aggregate metering** (CPU/memory totals via `core_metrics`) is the *correct* native granularity — replicating EVM's opcode-level view would be noise without a matching real debugging need |
| State-override / impersonation tooling precedent | Mature: Foundry/Anvil had this for years before Tenderly hosted it; Tenderly's contribution was removing operational toil (persistence, sharing, no self-hosting), not inventing the concept | **No prior art at all** on Stellar, not even a Foundry/Anvil-equivalent local tool. Fork-core is closer to being *both* the "Anvil-equivalent" and eventually the "Tenderly-equivalent," not just the latter. |
| Source-to-bytecode debugging maturity | Solidity source verification and mapping is a mature, widely-adopted practice (high Etherscan-verified rate) | Source verification is far less standardized/adopted on Stellar today; expect and design for a much lower "verified" hit rate, with graceful degradation when source/debug symbols are unavailable |

---

## 9. Phased Build Plan

**Phase 0 (this document + companions 01–03): design, before any code.**

**Phase 1 — Fork-core MVP, single-shot, CLI-only, standalone (no platform integration yet).**
```
your-tool fork --at-ledger <N> --contract <id>
your-tool override --balance <address> <amount>
your-tool replay <invocation>
```
Built and verified per the staged order in §6.2. This alone — pull real state, mutate one thing, replay against `soroban-env-host`, get a real, correctness-verified result — is the entire hard technical core and the genuinely differentiated, portfolio-worthy deliverable, independent of everything else in this project.

**Phase 2 — Source-line mapping (§2.2), parallel or immediately following Phase 1.** Self-contained; does not block or get blocked by Phase 1's platform-integration timeline. Narrower scope, hard ceiling on applicability (own-contracts-with-symbols only), still genuinely valuable and unclaimed.

**Phase 3 — Platform integration.** Wire Phase 1's engine into the reserved `[SIM-HOOK]` endpoints from `02-Releeve-API-Design.md` and the `simulation_runs`/`simulation_*` tables from `03-Releeve-DB-Schema.md`. This is where the Contract-page and Account-page Simulations tabs go from stubbed to real. The platform's Transaction-detail UI component is reused as-is, fed by simulation data instead of real-transaction data — no separate UI built.

**Phase 4 (v1.5+, explicitly deferred, not MVP) — State Sync / persistent named environments (§2.3).** Only pursued once Phase 1–3 demonstrate real usage/traction. This is where `fork_environments` (already reserved in the DB schema) gets populated, where a sync loop + conflict-resolution policy ("manual overrides win, sync everything else," mirroring Tenderly's own documented approach) gets built, and where genuine infrastructure-operations work (hosting, per-tenant RPC, uptime, a public explorer per environment) begins — a different category of difficulty than anything in Phase 1–3, deliberately not conflated with them in scope or timeline.

**What "done" looks like for the purposes of this being a legitimate, defensible claim of new value on Stellar:** Phase 1 alone, correctness-verified per §6, already clears that bar. Everything after Phase 1 is expansion, not a prerequisite for the core claim being true.
