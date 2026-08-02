# Releeve — Product Overview

**Status:** Living document, edited as decisions change.
**Reference model:** Tenderly (tenderly.co) — an EVM-chain developer platform for transaction debugging, simulation, forking, and monitoring. Every section below states what Tenderly does, then states the Stellar-native equivalent explicitly. Where Stellar's architecture makes a Tenderly feature unnecessary or impossible, that is called out directly rather than silently dropped.

---

## 1. What Releeve Is

Releeve is a Stellar/Soroban-native developer platform combining:

1. A **decoded transaction/account/contract/ledger explorer** embedded in-app (not a competitor to StellarExpert/Stellar Lab — a UX layer so users never have to leave the product to understand what they're looking at).
2. A **monitoring and alerting system** watching real on-chain activity (transactions, events, state, balances) and notifying teams through configurable destinations.
3. A **state-forking simulation engine** ("fork-core") — the actual differentiator — that lets a developer take real ledger state, mutate it (inflate a balance, impersonate a signer, fast-forward time), and replay a Soroban invocation against that hypothetical state to see exactly what would happen, with the same resource/state/event detail as a real transaction, before anything is risked on mainnet.

Point 3 is the moat. Points 1 and 2 are necessary product surface that make the platform usable and sticky, but are **not** where Releeve is differentiated — equivalents already exist on Stellar (StellarExpert, Stellar Lab, and to a lesser extent the early-stage `erst`/hintents project). Point 3 has **no existing equivalent on Stellar** as of this writing.

### Why this is needed (validated, not assumed)

Research into real Stellar protocol codebases turned up concrete, recurring pain that state-forking would solve:

- **Blend** (lending protocol, ~$80M TVL): hand-rolls all test fixtures from zero synthetic state (`testutils`) because there is no way to pull real mainnet-scale state into a test. Their own deployment scripts document empirically-discovered resource-limit surprises at scale ("8 is a good max for standard setups due to Soroban resource limits") — the same category of surprise Aave hit on EVM and solved specifically by simulating whale-scale deposits before shipping.
- **DeFindex (PaltaLabs)**: test suite structurally breaks every time Stellar's shared public testnet resets, because tests depend on token deployments that vanish on reset. They've had to write a documented recovery runbook for this — a recurring operational tax, not a one-off.
- **Soroswap**: must `git clone --recurse-submodules` several other teams' protocol repos (Phoenix, Aqua) just to get realistic multi-DEX state to test an aggregator against — a maintenance burden that recurs every time any dependency updates.
- **A third-party Blend integrator** publicly warned users not to trust their vault with more than $0.01 because they could not test at realistic scale.

None of the existing Stellar tooling (StellarExpert, Stellar Lab, `erst`) addresses this. Stellar Lab's own `--timestamp`/`--window` override in `erst` only mutates the simulated clock — not balances, not storage, not signer identity.

---

## 2. Reference Model: Tenderly's Four Pillars

Tenderly's product, as researched directly from their docs and homepage, breaks into four pillars. Releeve adopts the same four, Stellar-native.

| Tenderly Pillar | What it does on EVM | Releeve Equivalent |
|---|---|---|
| **Explorer** | Decoded transaction/wallet/contract/block views, with call traces, fund-flow diagrams, token transfers | Same four entities (Transaction, Account, Contract, Ledger), Soroban-native data |
| **Simulator / Forking / Virtual TestNets** | Dry-run transactions against real state; persistent forked environments with state-override cheatcodes | **Fork-core** — see companion doc `04-Releeve-Simulation-Engine.md` |
| **Monitoring / Alerts** | Rule-based alerts on transactions, events, state, balances, delivered to Slack/Discord/webhooks/etc. | Same alert model, Soroban-native trigger types |
| **Web3 Actions** | Auto-execute code in response to an alert (e.g., auto-pause a contract) | **Deferred to v2.** Detection (alerts) ships first; automated reaction is a separate, later capability built on top of a working alert system |

---

## 3. Core Entities (Explorer Layer)

Every entity below was validated against real Soroban RPC (`getTransaction`) response data pulled during design — not guessed. Field names in *italics* are taken directly from confirmed RPC/XDR structures.

### 3.1 Transaction

**Tenderly shows:** hash, network, status, block, timestamp, from/to, value, tx fee, tx type (EIP-1559/legacy), gas price, gas used/limit, index, nonce. Plus tabbed panels: decoded call trace (opcode-level: JUMP/CALL/SLOAD/SSTORE/etc.), searchable trace, storage access, event logs, trace prioritization/comments, tokens transferred (+ USD), Fund Flow (directed graph), involved contracts, state changes, emitted events, Gas Profiler (flame chart).

**Releeve equivalent, field by field:**

| Tenderly field | Releeve field | Notes |
|---|---|---|
| Hash | Hash | Same concept |
| Block | **Ledger** | Stellar's term. *ledger* field confirmed in real RPC response |
| Status | Status | Confirmed via *status* / *tx_success* |
| Tx Type (EIP-1559/legacy) | **Operation Type** | classic op (payment, trustline, offer) vs. `invoke_host_function` — more meaningful than EVM's fee-market-history distinction |
| Gas Price / Gas Used/Limit | **Resource Usage** | No live gas auction on Soroban (see §5). Shows *cpu_insn*, *mem_byte*, *disk_read_bytes*, *write_bytes*, *invoke_time_nsecs* — confirmed present in real `diagnostic_events` (`core_metrics`) |
| Nonce | **Sequence Number** (*seq_num*) | Same purpose, different name |
| Index | Index (*applicationOrder*) | Same |

**Panels, ported with honest scoping:**

- **Decoded call trace** — ✅ build, but **at the nested-invocation level, not per-opcode.** Soroban's `invoke_contract` calls already carry a real, unhashed function name and typed `ScVal` arguments — there is no 4-byte-selector decoding problem to solve the way EVM has. Do **not** replicate `JUMP`/`SLOAD`/`SSTORE`-style individual opcode line items — Soroban's execution is metered in aggregate (CPU/memory totals), not per-instruction, so that granularity would be pure noise with no matching real debugging need on this chain.
- **Trace search** — ✅ build. Scopes: `All | From | To | Function | Contract | File (source-gated) | Comment | Metric` (an added, Soroban-specific scope — see §3.1.1). Dropped: `Opcode` (nothing to search since opcodes aren't displayed).
- **Storage access (before/after)** — ✅ build. Confirmed directly available: real `resultMetaJson` responses contain `state` → `updated`/`created` pairs per `ContractData`/account/trustline entry touched, exactly the before/after diff Tenderly shows for `SLOAD`/`SSTORE`, just at ledger-entry granularity instead of raw storage-slot granularity (which is actually the *correct*, more useful granularity for Soroban).
- **Event logs** — ✅ build, and structurally easier than EVM: Soroban events are natively typed and named (confirmed: `{"symbol": "set_authorized"}, {"address": "..."}, {"data": {"bool": true}}`), unlike EVM's positional `log0`–`log4` topics needing reconstruction.
- **Prioritization / comments** — ✅ build. Pure workflow feature, chain-agnostic, does not require reading contract source. Applies to calls, state changes, or events (the units your trace actually displays).
- **Tokens transferred + USD** — ✅ build, mostly. Works for classic Stellar assets (protocol-native, no event-inference needed) and SEP-41 Soroban tokens (event-based, like ERC-20). Caveat: illiquid/obscure Soroban tokens may lack a reliable USD price feed — same problem EVM has with obscure ERC-20s, not Stellar-specific.
- **Fund Flow (directed graph)** — ✅ build. **Genuine differentiator vs. existing Stellar tools** — neither StellarExpert nor Stellar Lab currently renders a visual sender→amount→receiver graph; both are table-based. Cheap to build, real UX win.
- **Involved contracts (click to source)** — ⚠️ build, but scope expectations to reality: usefulness bounded by how many deployed Soroban contracts publish verified source (likely far fewer than EVM's Etherscan-verified rate today). Degrade gracefully: show bytecode/interface when source is unavailable.
- **State changes (decoded, before/after)** — ✅ build. Same data source as Storage access above.
- **Gas Profiler (flame chart)** — ✅ build, but reframed as a **Resource Profiler**. Precedent already exists and works: Stellar Lab's own Transaction Dashboard already ships CPU instructions, memory bytes, ledger read/write bytes, and fee breakdown for real transactions. `erst`/hintents also has a working flamegraph feature (profiling only, not source-mapped). **Do not rebuild this for real transactions** — it's solved, free, first-party. Build your own version pointed at **simulated fork output**, since nothing existing profiles a hypothetical scenario (see companion simulation doc).

#### 3.1.1 What Tenderly panels have NO Stellar equivalent, and why

| Tenderly feature | Why it exists on EVM | Why it doesn't apply to Stellar |
|---|---|---|
| Account Abstraction / Authorizations (EIP-7702) | Patches Ethereum's historical hard split between EOAs (keypair wallets, no custom logic) and Contract Accounts | Every Stellar account already supports multisig/weighted signers/custom thresholds natively. Soroban gives full custom-logic accounts directly. There was never a split to abstract away. **Do not build this section at all.** |
| Deposits L1→L2 / Withdrawals L2→L1 | Tenderly's reference chain (Base/Arbitrum-style) is an L2 rollup bridging to an L1 | Stellar is a single base layer, no L1/L2 relationship. **No equivalent, not applicable.** |
| Blobs (EIP-4844) | Rollup data-availability mechanism | No Stellar equivalent whatsoever. **Drop entirely**, including from the Ledger entity (§3.4). |

### 3.2 Account (Tenderly: "Wallet")

**Tenderly shows:** ETH balance + $ value, token holdings ($, count), NFT holdings (count, collections), then a filterable transaction list (All/Direct/Internal/Token transfers/NFT transfers), plus Simulations tab and Multichain assets tab.

**Releeve equivalent:**

- **XLM balance** + $ value — direct port.
- **Token holdings** — classic Stellar assets (via trustlines) + SEP-41 Soroban tokens, with $ value where a price feed exists.
- **NFT holdings — drop entirely for v1.** No settled Soroban NFT standard exists yet; capped-supply classic assets are an informal workaround, not a real primitive. Building a tracker for an unstable pattern is wasted effort. Revisit only if/when Soroban standardizes an NFT interface.
- **Filterable transaction list** — filters become `Payments | Contract Invocations | Trustline & Offer changes | Token transfers`. Drop `Internal` (EVM-specific — Stellar has no separate "internal call" transaction category; nested calls appear inside a single invocation's trace, not as separate top-level entries) and `NFT transfers` (see above).
- **Simulations tab** — ✅ **build, this is a linkage point to the fork-core.** History of fork/replay sessions run *for or as* this account (as sender, or as an impersonated signer). See §6.
- **Multichain assets — drop for v1.** Solves EVM's fragmented L1/L2/sidechain landscape, which Stellar does not have.
- **Public lookup pattern (keep):** any account should be viewable/searchable read-only even if not formally added to a Project, with an "Add to Project" action to start tracking/tagging/alerting on it. Matches Tenderly's own pattern and supports the embedded-explorer UX goal (§7).
- **Tagging (keep):** lightweight grouping mechanism independent of Project membership, used as an Alert Target (§5).

### 3.3 Contract

**Tenderly shows:** type (Contract/Proxy), ETH balance/value, deployment address/tx/timestamp, verification status/type/timestamp, optimizations, Solidity version, compiler, EVM version. Tabs: Transactions, Simulations, Source code (Source/Compiler Settings/ABI/Creation Code/Deployed Bytecode/Source Map), Read/Write, Events, Multichain assets.

**Releeve equivalent:**

| Tenderly field | Releeve field |
|---|---|
| Type | Contract / Upgradeable Contract (see below) |
| Balance/value | Same |
| Deployment address/tx/timestamp | Same — every Soroban contract has a real deploy transaction |
| Verification status | Same concept, **expect a much lower "verified" hit rate** than EVM today — source verification isn't as standardized/adopted yet on Stellar |
| Optimizations / Solidity version / Compiler / EVM Version | **Rust compiler version, `soroban-sdk` version, WASM target, build optimization flags (`opt-level`, `wasm-opt` usage), and — Releeve-specific — whether debug symbols (DWARF) are present or stripped.** This last field is where the simulation engine's source-mapping capability (companion doc) surfaces in the UI. |

**Tabs:**

- **Transactions / Simulations** — same pattern and same linkage note as Account (§6).
- **Source code** — Source / Compiler Settings / Spec (Soroban's equivalent of ABI — contract interface definition) / Creation (deploy) WASM / Deployed WASM / **Source Map (DWARF-based, once built — see simulation doc)**.
- **Read/Write** — call any function directly from the UI (run/simulate/view source per function). Genuinely **cleaner to build than EVM's ABI-form approach**, because Soroban function signatures are already typed and named natively.
- **Events** — decoded, filterable by type and ledger range. Direct port, easier due to native event structure.
- **Multichain assets — drop**, same reasoning as Account.

**Proxy / upgrade detection — build, adapted.** Tenderly auto-detects EIP-1967/1167 proxy patterns and shows implementation history. Soroban's equivalent: contracts can be upgraded via `update_current_contract_wasm`, changing which WASM executes at a fixed address while preserving storage. Detect this by watching for that specific host function in a contract's history; show "current implementation" + a chronological list of prior WASM hashes, mirroring Tenderly's implementation-history dialog exactly.

### 3.4 Ledger (Tenderly: "Block")

**Tenderly shows:** height, tx count, blobs, network, size, timestamp, hash, parent hash, base fee per gas, gas used/limit.

**Releeve equivalent:**

| Tenderly field | Releeve field |
|---|---|
| Block Height | **Ledger Sequence** (*ledger*, confirmed field) |
| Transactions | Same |
| **Blobs** | **Drop entirely** — EIP-4844 rollup-specific, no Stellar equivalent (§3.1.1) |
| Size / Timestamp / Hash / Parent Hash | Same, direct port |
| Base Fee Per Gas | **Base operation fee** (confirmed constant, e.g. `0.00001 XLM`) + **base reserve** (e.g. `0.5 XLM`). Unlike EVM, this is a stable protocol constant that changes only on network-wide upgrades — not a live per-block market. Section should be visually quieter than EVM's, correctly reflecting the absence of fee-market volatility. |
| Gas Used & Limit | **Aggregate resource consumption for the ledger** — total CPU instructions/memory used across all transactions vs. the network's per-ledger resource limit |

---

## 4. Why Gas/Fee Framing Differs Structurally (not just cosmetically)

EVM gas price is a **live, congestion-driven auction** — the reason it gets charts, trend lines, and "was this expensive right now" framing is that the price genuinely fluctuates block to block and is a real signal (congestion, demand spikes, potential anomalies).

Soroban resource fees are computed from **actual metered consumption against a published, largely stable fee schedule** — closer to deterministic given the operation than bid-driven. Confirmed directly from real transaction data: `instructions`, `disk_read_bytes`, `write_bytes` in the resource-fee request, and `cpu_insn`, `mem_byte`, `invoke_time_nsecs`, `max_rw_key_byte`, `max_rw_data_byte` as real metered `core_metrics` diagnostic events.

**Design consequence:** keep resource-cost fields (they're genuinely useful diagnostic data, directly tied to Blend's own documented "hit the resource limit" pain point), but drop EVM-style "average gas price over time" trend charts and "did congestion make this expensive" framing — that's solving a market-volatility problem Soroban's fee model doesn't really have. The correct framing throughout Releeve is **"resource budget consumed vs. limit,"** not **"market price paid."**

---

## 5. Monitoring & Alerts

Full detail (expression types, destinations, permission model) is standard product spec — summarized here, canonical source is the API design doc (`02-Releeve-API-Design.md`).

**Alert = Target × Expression(s) × Destination(s).**

- **Target:** Address | Network | Project | Tag — chain-agnostic, ports directly.
- **Expression types** (composable — Tenderly's real API allows combining several per alert, e.g. method call + blocklist + value threshold + state change together; Releeve adopts this composable model from day one rather than 12 hardcoded templates):

| Expression | Port type | Adaptation needed |
|---|---|---|
| Successful / Failed Transaction | Direct | — |
| Function Call | Direct | Walk Soroban's nested call tree for internal invocations |
| Event Emitted / Event Parameter | Direct | Easier — natively structured events |
| Token Transfer | Direct, renamed | Two sub-paths: classic assets + SEP-41 |
| Allowlisted / Blocklisted Callers | Direct | — |
| Balance Change / Transaction Value | Direct | wei → stroops/asset units. Transaction Value mainly meaningful for payments, not all invocations |
| `tx_error` | Direct | — |
| `no_action` | Direct | Genuinely useful — e.g., alert when an oracle contract (like the `set_price` example) stops pushing updates |
| **State Change** | **Adapted** | Named Solidity state variable → **selected storage key** on a contract (Soroban has key-value `ContractData`, not named public variables) |
| **View Function** | **Adapted** | True free `view` call → **periodic `simulateTransaction` polling** (real infra cost — not event-driven like the others, flag this explicitly in ops planning) |
| `token_transfer_matcher` (Tenderly: `erc20_transfer_matcher`) | Direct, renamed | Validates internal balance bookkeeping matches emitted events — same value for SEP-41 |
| `sandwich_transaction` | **Research needed, do not commit to v1** | MEV/sandwich detection is built around EVM public-mempool ordering dynamics. Stellar's consensus (SCP) and tx submission model differs; investigate separately before scoping |

- **Destinations**, split by scope (confirmed pattern, maps directly to Organization/Project hierarchy — §6):
  - **Account-scoped** (reusable across every project): Email, Slack, Telegram, Discord, Sentry, PagerDuty
  - **Project-scoped**: Webhooks (spec below), and — **v2, deferred** — an Actions-equivalent (auto-execute code in response to an alert). Detection ships first; automated reaction is a distinct, later capability.

**Webhook spec (directly portable from Tenderly, battle-tested design):**
- Endpoint must expose GET (health check → 200) and POST (payload) on the same URI
- 5-second timeout → marked failed
- HMAC SHA256 signature: `hash(signing_secret + payload + timestamp)`, sender-verifiable
- Execution status tracking: Success / Failed / Pending / Retry (max 5) / Skipped
- `TEST` event fired on setup; manual test flow accepts a transaction hash — **Releeve enhancement over Tenderly:** allow testing against a *simulated* fork output, not only a real historical hash.

---

## 6. Organization / Project Hierarchy

Decided and finalized:

```
Organization (auto-created, unnamed, on signup — behaves as a personal account until renamed or a member is invited)
  ├── Members — flat permission set (no separate named-role hierarchy):
  │     • Create / Update / Delete projects
  │     • Manage members (grants the power to grant/revoke others' permissions)
  │     • Manage access tokens
  │     • Manage billing
  │     • Manage fork sessions  ← Releeve-specific, gates who can run mutation/impersonation, not just view results
  ├── Account-scoped Destinations (Email, Slack, Telegram, Discord, Sentry, PagerDuty)
  └── Project
        ├── Project-scoped Destinations (Webhooks, [v2] Actions)
        ├── Wallets (Accounts) — add/lookup, tag, alert
        ├── Contracts — add/lookup, tag, alert, proxy/upgrade detection
        ├── Alerts (Target × Expression × Destination)
        └── Fork Sessions ← simulation engine output surfaces here (see §7 and companion doc)
```

**Rationale (weighed, not copied blindly):** a single "Workspace" primitive is architecturally simpler to build (one entity type, no "transfer project between account types" feature needed), while a "personal account first, org later" model matches the mental model of Releeve's actual target users (developers used to GitHub/npm/Vercel-style conventions, not Slack/Notion-style forced workspace naming). The adopted design gets both: one underlying schema (`Organization`), auto-created silently so there's zero onboarding friction, that only becomes visibly "an org" once a second member is invited or a second one is created.

**Multiple orgs per user:** supported, gated by plan tier — same mechanism either way, no schema difference.

---

## 7. The Explorer-is-not-the-moat, Embedded-is-still-needed Principle

Two conclusions reached and both are correct, not contradictory:

1. **Do not build a general, standalone, network-wide discovery surface** — no full browsing explorer competing with StellarExpert/Stellar Lab. One in-app exception, decided: Releeve serves a small set of **cached network feeds** (latest transactions, latest ledgers, top tokens, token transfers) so its own dashboards have immediate context. These are single-purpose, Redis-backed, paginated surfaces (`limit` 20/50/100, cursor Next/Prev — API doc §5.5, DB doc §11), not a general browsing product.
2. **Do build embedded, in-context detail views for anything Releeve's own product references** — an alert firing on a transaction, a monitored contract, a simulation result. If a user has to tab away to a different tool mid-workflow to understand what Releeve just showed them, the monitoring/simulation product is broken regardless of how good the underlying engine is. This is not a competing explorer; it's the connective tissue that makes the rest of the product usable. Data source is the same RPC calls either way — the only difference is "renders inline" vs. "opens a new tab."

---

## 8. Simulation Engine — Summary (full detail in companion doc)

The fork-core is the actual product differentiator. Full design, build order, and testing strategy live in `04-Releeve-Simulation-Engine.md`. Summary for context:

- Loads real ledger state (via `getLedgerEntries`) into a local, mutable store
- Lets a user override specific values (balances, storage) before replay — "cheatcodes," same concept as Tenderly's Admin RPC on Virtual TestNets, which has **no existing equivalent anywhere on Stellar**
- Lets a user impersonate a signer without holding its key (auth bypass), for testing "what if this whale account called this function"
- Replays the invocation through the real `soroban-env-host` execution engine (not a statistical estimate — genuinely metered execution against hypothetical input state)
- Produces the exact same detail (call tree, state diffs, events, resource usage) as a real transaction, reusing the same Transaction-detail-page UI components described in §3.1, just fed from simulated rather than historical data

**Explicitly out of scope for MVP, sequenced for later:** persistent/live-synced ("State Sync") environments, hosted multi-tenant RPC endpoints, a public explorer per fork. MVP is single-shot, local, CLI-first: `fork` → `override` → `replay`. See companion doc for the full reasoning, build order, and verification strategy.

---

## 9. What Is Deliberately Not Being Built (consolidated)

| Feature | Reason |
|---|---|
| General block explorer (network-wide browsing) | Solved already by StellarExpert/Stellar Lab; not the moat — with the one in-app exception: cached, paginated network feeds (latest transactions/ledgers, top tokens, token transfers) for dashboard context (§7) |
| NFT tracking (Top NFTs, transfers, mints) | No stable Soroban NFT standard yet |
| Account Abstraction / Authorizations panel | Stellar never had the EOA/contract split this patches |
| L1↔L2 Deposits/Withdrawals | No L1/L2 relationship on Stellar |
| Blobs | EIP-4844-specific, no Stellar equivalent |
| Multichain assets tab | Solves EVM's fragmented-chain problem; not applicable |
| Per-opcode trace display (JUMP/SLOAD/SSTORE-style) | Soroban meters in aggregate, not per-instruction; would be noise |
| Live gas-price market charts | Soroban fees are schedule-based, not auction-driven |
| `sandwich_transaction` detection (v1) | Needs dedicated research into Stellar's consensus/mempool model first |
| Web3 Actions equivalent (auto-execute reactions) | v2 — build detection (alerts) first, reaction layer after |
