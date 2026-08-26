export type DocSection = {
  heading: string;
  paragraphs: string[];
  bullets?: string[];
  code?: string;
  note?: string;
};

export type DocGuide = {
  slug: string;
  label: string;
  description: string;
  sections: DocSection[];
};

export const docGuides: DocGuide[] = [
  {
    slug: "overview",
    label: "Overview",
    description: "Releeve replays Soroban invocations against real Stellar ledger state, with environments you control.",
    sections: [
      {
        heading: "What Releeve is",
        paragraphs: ["Releeve is a platform for running Soroban smart contracts against real Stellar state. A simulation starts from a real ledger snapshot and executes through the same Soroban host the network uses — the outcome is execution against hypothetical state, not a statistical estimate."],
      },
      {
        heading: "The workflow",
        paragraphs: ["Start with a first simulation: create a workspace, issue an access token, and queue an invocation. Then move into persistent environments, monitoring rules, debugging, and programmatic access."],
        bullets: [
          "Quickstart — queue your first simulation and inspect the result",
          "Simulations — replay Soroban invocations against real snapshots with controlled state",
          "Virtual networks — keep a named snapshot, its overrides, and its history together",
          "Monitoring — compose alert rules from a target, expressions, and delivery destinations",
          "Debugger — step through what actually happened in a transaction with state at every step",
          "Source verification — attach source to on-chain WASM so every tool decodes for humans",
        ],
      },
      {
        heading: "What you get back",
        paragraphs: ["Every execution is verified before it is trusted. Output is byte-matched against official Stellar simulateTransaction and getTransaction results after narrow JSON normalization, and executions carry certificates that prove the inputs were complete and consistent."],
      },
      {
        heading: "Programmatic access",
        paragraphs: ["The API reference is canonical for exact routes and schemas. Asynchronous operations return 202 with a persisted run ID; environment creation returns 201. Errors use structured envelopes with stable machine-readable codes."],
      },
    ],
  },
  {
    slug: "quickstart",
    label: "Quickstart",
    description: "Create a workspace, issue an access token, and queue your first simulation.",
    sections: [
      {
        heading: "Before you begin",
        paragraphs: ["Create a Releeve account and verify your email. Signup creates a personal organization automatically, so you can begin without naming a workspace first."],
        bullets: ["A verified Releeve account", "A project scoped to mainnet, testnet, or futurenet", "A Soroban contract ID and function you want to replay"],
      },
      {
        heading: "Create an access token",
        paragraphs: ["Open Settings, choose API keys, and create an organization access token. Store the raw token when it is shown; Releeve only keeps its hash."],
        code: `export RELEEVE_API="https://api.releeve.xyz"\nexport RELEEVE_TOKEN="rlv_..."\nexport RELEEVE_ORG="your-org"\nexport RELEEVE_PROJECT="your-project"`,
        note: "Use a dedicated token for CI and revoke it when the workflow is retired.",
      },
      {
        heading: "Queue a simulation",
        paragraphs: ["Submit a contract invocation to the project simulation endpoint. The request is asynchronous and returns a persisted run identifier."],
        code: `curl -X POST "$RELEEVE_API/api/v1/$RELEEVE_ORG/$RELEEVE_PROJECT/simulations" \\
  -H "Authorization: Bearer $RELEEVE_TOKEN" \\
  -H "Content-Type: application/json" \\
  -d '{
    "contract_id": "CBZV...POOL",
    "function_name": "deposit",
    "args": ["GDX4...ACCOUNT", "25000000"],
    "overrides": [],
    "impersonate": ["GDX4...ACCOUNT"]
  }'`,
        note: "Include an Idempotency-Key header to make retries safe: reusing a key with the same body replays the same run; reusing it with a different body returns an idempotency conflict.",
      },
      {
        heading: "Inspect the result",
        paragraphs: ["Poll the returned run ID until its status becomes success, failed, or error. The detail response exposes calls, events, state changes, resources, return values, and structured failure information."],
        code: `curl "$RELEEVE_API/api/v1/$RELEEVE_ORG/$RELEEVE_PROJECT/simulations/$RUN_ID" \\
  -H "Authorization: Bearer $RELEEVE_TOKEN"`,
        note: "A failed status means the invocation executed and produced a contract or host failure — a useful result that tells you exactly why it would fail on-chain. An error status means the platform or engine could not complete the request.",
      },
    ],
  },
  {
    slug: "simulations",
    label: "Simulations",
    description: "Replay Soroban invocations against real ledger snapshots with controlled state.",
    sections: [
      {
        heading: "Execution model",
        paragraphs: ["A Releeve simulation starts from a real Stellar ledger snapshot and executes through the Soroban host boundary — the same host the network uses. It is execution against hypothetical state, not a statistical estimate."],
        bullets: [
          "Choose the base state explicitly: latest, a pinned historical ledger, or a virtual network",
          "Provide a contract ID, function name, and decoded arguments, or a prepared transaction envelope in XDR",
          "Keep the recorded base ledger visible when comparing results",
        ],
      },
      {
        heading: "State overrides",
        paragraphs: ["Overrides are applied before execution and carry provenance into the result so a changed input cannot be mistaken for network state."],
        bullets: ["Account or asset balances", "Contract storage ledger entries", "Ledger sequence and close timestamp", "Entry TTL and explicit storage footprint"],
        note: "Within a virtual network, overrides are revisioned and tenant-scoped, so every result records exactly what was changed and when.",
      },
      {
        heading: "Account impersonation",
        paragraphs: ["Impersonation lets an approved account satisfy a simulation authorization path without possessing its secret key. It never signs or submits a transaction to Stellar."],
        note: "Treat impersonation as a privileged project operation. It is testing capability, not wallet custody.",
      },
      {
        heading: "Result evidence",
        paragraphs: ["Real and simulated transactions share the same investigation vocabulary."],
        bullets: ["Nested contract calls and authorization records", "Typed contract and diagnostic events", "Before/after ledger-entry state", "CPU, memory, read, write, and timing resources", "Return value or structured host error"],
      },
      {
        heading: "Failure states",
        paragraphs: ["Pending means the run is still queued. Failed means the invocation executed and produced a contract or host failure. Error means the platform or engine could not complete the request. Terminal failures carry stable machine-readable codes."],
      },
      {
        heading: "Bundled simulations",
        paragraphs: ["Multi-step sequences run atomically in order, each step seeing the state produced by the one before it. Bundles model interdependent flows such as approve-then-swap, governance proposals, and multi-call strategies. If a step fails, the bundle returns everything simulated up to the failure point."],
      },
      {
        heading: "Transaction preview",
        paragraphs: ["A lightweight dry-run for dapps and CI: simulate the pending transaction and surface what moves, what it costs, and whether it fails — before anything is signed. Wallet-style previews render asset and balance changes, event logs, and decoded failure reasons."],
      },
    ],
  },
  {
    slug: "virtual-environments",
    label: "Virtual networks",
    description: "Keep a named ledger snapshot, its overrides, and its simulation history together.",
    sections: [
      {
        heading: "Create an environment",
        paragraphs: ["Virtual networks are project-scoped. Select a network, protocol version, and base ledger, then choose whether untouched state should continue synchronizing."],
        code: `POST /api/v1/{org}/{project}/environments

{
  "name": "Checkout regression",
  "network": "testnet",
  "protocol": 27,
  "base_ledger_sequence": 3962796,
  "sync_enabled": true
}`,
        note: "Creation returns a certified revision — a verified, fingerprinted state, never a guess.",
      },
      {
        heading: "Immutable revision history",
        paragraphs: ["An environment is an immutable chain of revisions. Everything you do — activation, rollback, branching — is recorded; nothing is destructively overwritten."],
        bullets: ["Frozen pins one verified revision; the base state never changes underneath you", "Follow-latest captures the authoritative latest state at each use or rebase — no background mirror to keep warm", "Stop sync pins the current revision so a scenario stays stable", "Activating an older revision is a non-destructive rollback; later revisions remain available for roll-forward"],
      },
      {
        heading: "Override wins",
        paragraphs: ["Manual values remain authoritative while synchronization updates untouched ledger entries. This keeps a scenario stable without freezing all surrounding state."],
      },
      {
        heading: "Run and compare",
        paragraphs: ["Queue simulations against the environment rather than rebuilding the same override list for every run. Each result records its environment and base-ledger provenance."],
      },
      {
        heading: "Branching",
        paragraphs: ["Branch from any revision to create a new, independent environment. Branching is ideal for disposable per-PR or per-scenario workspaces that never dirty the shared environment."],
      },
      {
        heading: "Sync and rollback",
        paragraphs: ["Start or stop state synchronization explicitly. Rollback restores the environment to a recorded ledger boundary while preserving an auditable run history."],
        bullets: ["Start sync", "Stop sync", "Inspect sync status", "Rollback to a ledger", "Delete the environment when the scenario is complete"],
      },
      {
        heading: "State-sync semantics",
        paragraphs: ["An environment's base state is served on demand from verified snapshots, current network state, or checkpoint materialization. Untouched ledger entries reflect the network as of the environment's sync position, while overridden entries stay frozen at their recorded values."],
      },
      {
        heading: "Faucet and cheatcodes",
        paragraphs: ["Fund accounts with native XLM or token balances instantly — no mining, no waiting. Time and ledger manipulation let you put a contract into exactly the state your test needs. These operations are available on the privileged environment surface and are never exposed to end users of a staged application."],
      },
    ],
  },
  {
    slug: "monitoring",
    label: "Monitoring",
    description: "Compose alert rules from a target, one or more expressions, and delivery destinations.",
    sections: [
      {
        heading: "Rule model",
        paragraphs: ["Every alert is Target x Expressions x Destinations. Match all requires every expression to pass; match any fires when at least one passes. Rules can start paused or enabled."],
        bullets: ["Targets: address, network, project, or tag", "Expressions: failure, success, function call, event, transfer, balance, state, caller, value, no action, and more", "Destinations: account-scoped services or project-scoped webhooks"],
      },
      {
        heading: "Expressions",
        paragraphs: ["Rules compose from typed conditions evaluated against real on-chain activity."],
        bullets: [
          "Successful or failed transaction — a watched transaction succeeds or fails",
          "Function call — a specific Soroban function is invoked",
          "Event emitted — a specific typed event is emitted",
          "Token transfer — a transfer occurs, with amount, direction, and counterparty",
          "Balance change — a balance crosses a threshold on the transaction that moves it",
          "State change — a ledger-entry state variable changes, in threshold, percentage, criteria, or any-change modes",
          "View function — a read-only function's return value changes",
          "Allowlisted callers — an address not on the allowlist calls a contract",
          "Blocklisted callers — an address on the blocklist calls a contract",
          "Transaction value — the transaction value matches a condition",
          "No action — a watched condition produced nothing within the window",
        ],
        note: "Balance and value conditions are edge-triggered: they fire on the transaction that crosses the boundary, not while the condition merely remains satisfied. Expressions within one alert are combined over the same transaction; independent conditions belong in separate alerts.",
      },
      {
        heading: "Create a rule",
        paragraphs: ["Parameters remain structured JSON so new expression types can be introduced without changing the rule envelope."],
        code: `POST /api/v1/{org}/{project}/alerts

{
  "name": "Failed checkout invocation",
  "target": { "type": "project" },
  "match_logic": "all",
  "expressions": [
    { "type": "function_call", "params": { "function": "checkout" } },
    { "type": "failed_transaction", "params": {} }
  ],
  "enabled": true
}`,
      },
      {
        heading: "Destinations",
        paragraphs: ["Destinations are shared across the organization so one configuration can serve many rules. Email, Slack, Telegram, Discord, Sentry, and PagerDuty destinations are account-scoped and reusable. Webhooks belong to a project."],
      },
      {
        heading: "Webhook verification",
        paragraphs: ["A webhook endpoint responds to GET health checks and POST deliveries. Releeve signs each payload with the webhook's signing secret and a timestamp; verify the signature to guarantee origin. Each event carries a unique ID — use it to make processing idempotent. Every delivery attempt is recorded, and failures retry with exponential backoff before settling at a terminal state."],
        note: "Use the destination test endpoint before enabling a production rule.",
      },
    ],
  },
  {
    slug: "explorer",
    label: "Explorer",
    description: "Inspect public network entities and connect real transactions to project workflows.",
    sections: [
      {
        heading: "Public and tracked access",
        paragraphs: ["Public explorer routes are readable without authentication. Adding an account or contract to a project enables tags, monitoring, comments, priority, and simulation history around that entity."],
      },
      {
        heading: "Entity routes",
        paragraphs: ["Releeve exposes transaction, account, contract, ledger, and token views for mainnet, testnet, and futurenet."],
        code: `GET /api/v1/explorer/{network}/tx/{hash}\nGET /api/v1/explorer/{network}/account/{address}\nGET /api/v1/explorer/{network}/contract/{address}\nGET /api/v1/explorer/{network}/ledger/{sequence}\nGET /api/v1/explorer/{network}/token/{asset}`,
      },
      {
        heading: "Network feeds",
        paragraphs: ["Cached feeds provide immediate network context without positioning Releeve as a general discovery explorer."],
        bullets: ["Latest transactions", "Recent ledgers", "Top tokens", "Token transfers", "Live feed updates"],
      },
      {
        heading: "Soroban-native evidence",
        paragraphs: ["Transaction detail focuses on the diagnostics Stellar developers can act on: nested invocations, authorization records, typed contract and diagnostic events, before/after ledger-entry state, transfers, and metered resources rather than EVM opcode or gas-auction framing."],
      },
      {
        heading: "Fund flow",
        paragraphs: ["An interactive directed graph of asset movement through a transaction: each address is a node, each transfer an edge, and the layout shows the complete path assets took. Follow multi-hop swaps, flash-loan chains, and arbitrage patterns that a flat transfer list hides. Step through transfers in execution order with a timeline, inspect per-address net positions, and jump from any edge to the exact call in the execution trace."],
      },
      {
        heading: "Trace search and collaboration",
        paragraphs: ["Search across the nested call trace by function, contract, or event. Tag contracts and wallets to group monitoring and filter views. Leave comments on any trace node and mark priorities so teams can coordinate during an incident response."],
      },
      {
        heading: "Contract read and write",
        paragraphs: ["Call read-only Soroban functions against current or pinned ledger state and see the decoded result. Mutating calls run against a virtual network's state, never against mainnet."],
      },
    ],
  },
  {
    slug: "debugger",
    label: "Debugger",
    description: "Step through what actually happened in a transaction, real or simulated, with state at every step.",
    sections: [
      {
        heading: "What it does",
        paragraphs: ["The Debugger lets you step through what actually happened in a transaction — real or simulated — at the call level, with evaluated state at each step. It is the tool for finding why a transaction reverted and verifying a fix before anything is signed."],
      },
      {
        heading: "Workflow",
        paragraphs: ["Open any transaction from the transaction listing or search, then jump into the trace view. Inspect the nested call sequence, decoded inputs and outputs, emitted events, and state changes. When a call fails, the trace surfaces the host error and the exact invocation that produced it. Evaluate expressions against the state as of any step to read runtime values at the point of failure."],
      },
      {
        heading: "Recorded execution",
        paragraphs: ["Traces are recorded at execution time, so debugging works for both real on-chain transactions and simulations — including environments where you control the state. The platform mediates access to recorded traces; clients never talk to the recording service directly."],
      },
      {
        heading: "Resource profiling",
        paragraphs: ["A per-call breakdown of metered resources — CPU instructions, memory, reads, writes — shows where an invocation is expensive and how a change to the contract or arguments affects cost. Compare the profile of a failing transaction against a simulated fix."],
      },
      {
        heading: "Re-simulate",
        paragraphs: ["From any trace, re-simulate the transaction with edited arguments, overrides, or impersonation to confirm the fix against the same base state."],
      },
    ],
  },
  {
    slug: "source-verification",
    label: "Source verification",
    description: "Attach source to on-chain WASM so every tool decodes for humans.",
    sections: [
      {
        heading: "Why it matters",
        paragraphs: ["Attaching source to on-chain WASM makes every tool decode for humans: contract views, transaction traces, events, and read/write interfaces become human-readable instead of raw XDR and bytecode."],
      },
      {
        heading: "How it works",
        paragraphs: ["Build provenance is recorded — signed metadata over the source and build environment — and matched against the on-chain bytecode. Capability states are independent and audited separately; provenance, source matching, and source maps are each verified on their own terms. Uploaded artifacts and their provenance are stored by the recording service, and the platform mediates all access."],
      },
      {
        heading: "Verification methods",
        paragraphs: ["Verify from the dashboard by uploading source and build metadata, or from the CLI and build tooling as part of the deploy pipeline. Re-verification after a contract upgrade is supported."],
      },
      {
        heading: "Visibility",
        paragraphs: ["Source can be public or project-private. Private verification keeps pre-release code off public registries while still giving your team fully decoded views."],
      },
    ],
  },
  {
    slug: "networks",
    label: "Networks",
    description: "The Stellar networks Releeve can fork, replay, and write to.",
    sections: [
      {
        heading: "Overview",
        paragraphs: ["A Releeve network is a Stellar network that the platform can fork, replay, and write to. Projects are scoped to one network, which determines the ledger state a simulation starts from."],
      },
      {
        heading: "Network types",
        paragraphs: ["Releeve supports the public Stellar networks — testnet, mainnet, and futurenet — plus virtual networks that branch from them."],
        bullets: ["Testnet: the default for experiments; resets occasionally", "Mainnet: real production state; simulation overrides let you test what-if changes", "Futurenet: protocol-versioned testing network"],
      },
      {
        heading: "Node access",
        paragraphs: ["Reads go through the network's RPC endpoints and ingestion pipeline. Ledger data is mirrored so simulations can fork from any point in the retained history."],
      },
      {
        heading: "Ledger snapshots",
        paragraphs: ["Each simulation starts from a snapshot of the base ledger. Snapshots are cached and materialized on demand; pinned historical ledgers stay available within the retained range."],
        note: "If a snapshot is not yet cached, the first simulation on it may take longer while the cold materializer builds it.",
      },
    ],
  },
  {
    slug: "protocol-support",
    label: "Protocol support",
    description: "Which ledgers Releeve can reason about, and what happens below the boundary.",
    sections: [
      {
        heading: "Supported range",
        paragraphs: ["Releeve supports protocol 26 onward, resolved per ledger from the ledger's own source of truth."],
        bullets: ["Mainnet: protocol 26 from ledger 62,447,231; protocol 27 from 63,386,819", "Testnet: protocol 26 from ledger 2,070,825; protocol 27 from 3,157,753"],
      },
      {
        heading: "Below the boundary",
        paragraphs: ["Requests for ledgers below the supported boundary are rejected with history_before_supported_range — never silently resolved to a newer ledger."],
      },
      {
        heading: "Registry-driven adapters",
        paragraphs: ["Protocol support is implemented as adapters behind a registry, not hard-coded branches. Every read resolves the protocol from the ledger's own source of truth, looks up the adapter cache-first with a database fallback, and fails closed if no adapter exists for that protocol. New protocol versions ship as adapters plus fixture suites, validated against official network output."],
      },
      {
        heading: "History availability",
        paragraphs: ["Historical state comes from the cheapest sufficient source in order: verified local snapshot manifest, verified payload cache, current network state via reverse traversal, then isolated checkpoint materialization. History flags are enabled as the verification ladder passes; the engine never claims history coverage it cannot prove."],
      },
    ],
  },
  {
    slug: "correctness-and-trust",
    label: "Correctness and trust",
    description: "Why you can believe the output — the oracle gate, certificates, and structured errors.",
    sections: [
      {
        heading: "The oracle gate",
        paragraphs: ["No override, impersonation, or environment result is trusted until an unmutated replay through the engine byte-matches official Stellar simulateTransaction and getTransaction output after narrow JSON normalization. Replay fixtures are load-bearing evidence, and fixture self-generation from Releeve's own output is forbidden. A wrong result must be loud, never quiet."],
      },
      {
        heading: "Completeness certificates",
        paragraphs: ["Every execution is gated by a certificate that proves the inputs were complete and consistent before anything ran."],
        bullets: ["Network identity", "Requested, state, and execution ledgers", "Protocol version", "Ledger hash and close time", "Base reserve", "Footprint hash and state hash", "Required and proven key counts, and proven-absent counts", "TTL proofs and header proof", "Canonical sources"],
        note: "Ledger drift versus official state is reported inconclusive, never mismatch.",
      },
      {
        heading: "Structured errors",
        paragraphs: ["Errors are application/problem+json with stable machine-readable codes: history_before_supported_range, history_gap, snapshot_incomplete, ledger_inconsistent, budget_limited, source_unavailable, and more. The platform forwards upstream status, code, and detail verbatim — no lossy re-wrapping."],
      },
      {
        heading: "Resolution order",
        paragraphs: ["A simulation resolves its base state from the cheapest sufficient source: verified local snapshot manifest, verified payload cache, current network state anchored by getLedgerEntries and getLedgers, data-lake-backed RPC, then isolated checkpoint materialization. Nothing is assumed; every source is verified before execution begins."],
      },
    ],
  },
  {
    slug: "node-rpc",
    label: "Node RPC",
    description: "A hosted Soroban RPC endpoint backed by the same verified state layer as simulations.",
    sections: [
      {
        heading: "A hosted Soroban RPC endpoint",
        paragraphs: ["Run your application against a production Soroban RPC endpoint instead of operating your own node. The endpoint is backed by the same snapshot and overlay engine that powers simulations, so reads, events, and transaction queries share one verified state layer."],
      },
      {
        heading: "Methods",
        paragraphs: ["Read ledger state with proof, query transaction and event history, submit transactions, and dry-run or estimate before sending."],
        bullets: ["getLedgerEntries — read current ledger state with proof", "getTransactions and getTransaction — query transaction history", "getEvents — query emitted events with filters", "sendTransaction — submit a transaction", "Simulation and estimation methods — dry-run and cost estimation over RPC"],
      },
      {
        heading: "Auto-mine in environments",
        paragraphs: ["Within a virtual network, sendTransaction accepts a transaction, applies it to the environment's state, fabricates deterministic close metadata, and returns a hash and receipt without consensus or broadcast. There is no mempool and nothing touches the real network — a network you control for integration testing. Determinism is enforced: two sequential executions of the same transaction against the same state produce identical results."],
      },
      {
        heading: "Batching and subscriptions",
        paragraphs: ["JSON-RPC request batching reduces round trips, and real-time subscriptions stream new transactions, events, and ledger closes. Dedicated endpoints are provisioned per network with a unique URL, and usage is metered per request category."],
      },
    ],
  },
  {
    slug: "write-path",
    label: "Write path",
    description: "Deploy into an environment, interact with persistent state, and mine deterministic results.",
    sections: [
      {
        heading: "Deploy into an environment",
        paragraphs: ["Deploy a Soroban contract into a virtual network — not mainnet — using the environment's snapshot and overlay as the substrate. Deployed contracts are recorded in the environment's revision history."],
      },
      {
        heading: "Interact with state",
        paragraphs: ["Queue invocations against an environment that persist into its overlay: the stateful counterpart to stateless simulations. Each accepted write applies immediately, fabricates close metadata, and returns a hash and receipt."],
      },
      {
        heading: "Sync rule",
        paragraphs: ["Local changes win; sync everything else. Your writes detach from the parent network and stay authoritative, while untouched ledger entries keep reflecting the network's sync position."],
      },
      {
        heading: "Deterministic replay",
        paragraphs: ["Every mined transaction is verified by deterministic replay before it is trusted: two sequential executions of the same overlay and transaction must produce identical diffs, and rebases merge deterministically."],
      },
    ],
  },
  {
    slug: "accounts-projects",
    label: "Accounts and projects",
    description: "Organize work into spaces and control who can do what.",
    sections: [
      {
        heading: "Accounts and organizations",
        paragraphs: ["An account is a user or an organization. Signup creates a personal organization automatically. Organizations share projects, alert destinations, and access tokens across members, with role-based permissions controlling what each member can do."],
      },
      {
        heading: "Projects",
        paragraphs: ["Projects scope every resource to one network. A project slug is permanent and used in API paths. Project-scoped resources include simulations, environments, alerts, and watched entities."],
        code: `/api/v1/{org}/{project}/...`,
      },
      {
        heading: "Access tokens",
        paragraphs: ["Organization access tokens authenticate off-chain services — CI, scripts, and backends. The raw token is shown once at creation; only its hash is stored. Browser sessions use secure cookies; programmatic clients use Authorization: Bearer rlv_..."],
      },
      {
        heading: "Permissions",
        paragraphs: ["A permission model gates every action, including simulation impersonation, environment management, and alert management. Permissions are server-authoritative: the platform asserts its identity to the engine with short-lived signed service assertions, so your API key never grants engine access directly."],
      },
    ],
  },
  {
    slug: "pricing",
    label: "Pricing",
    description: "Fair-use limits today and metered usage as scale grows.",
    sections: [
      {
        heading: "Fair-use limits",
        paragraphs: ["Releeve fails closed before exhausting budgets. When a limit is reached you get an honest unavailable, inconclusive, or budget_limited outcome — never a guessed answer."],
        bullets: ["R2 snapshot cache: 8 GiB", "Local payload LRU: 1 GiB", "Cold materializer: concurrency 1 with a 15-minute deadline", "Reverse traversal: 4,096 ledgers / 256 MiB", "Footprint discovery: at most 8 rounds / 1,000 keys", "RPC response ceiling: 64 MiB"],
      },
      {
        heading: "Usage metering",
        paragraphs: ["Usage is metered per request category — reads, simulations, traces, and writes — so costs scale with actual consumption. Self-serve plans and organization billing surface usage per project with alerts at configurable thresholds."],
      },
    ],
  },
];

export const docsNav = docGuides.map(({ slug, label, description }) => ({ slug, label, description }));

export function getDocGuide(slug: string) {
  return docGuides.find((guide) => guide.slug === slug);
}

export function sectionId(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
}

export type DocTab = {
  slug: string;
  label: string;
  description: string;
  nav: { slug: string; label: string; description?: string }[];
  sections: DocSection[];
};

export const docTabs: DocTab[] = [
  {
    slug: "api-reference",
    label: "API reference",
    description: "Programmatic access to Releeve simulations, environments, and monitoring.",
    nav: [
      { slug: "openapi-is-canonical", label: "OpenAPI is canonical", description: "Exact routes and schemas" },
      { slug: "authentication", label: "Authentication", description: "Sessions and tokens" },
      { slug: "async-semantics", label: "Async semantics", description: "202 responses and idempotency" },
      { slug: "response-behavior", label: "Response behavior", description: "Pagination and errors" },
    ],
    sections: [
      {
        heading: "OpenAPI is canonical",
        paragraphs: ["The Releeve API publishes its generated OpenAPI document and interactive reference from the backend. Use it when exact request or response fields matter."],
      },
      {
        heading: "Authentication",
        paragraphs: ["Browser requests use secure session cookies. Programmatic requests use an organization access token in the Authorization header."],
        code: `Authorization: Bearer rlv_...`,
      },
      {
        heading: "Async semantics",
        paragraphs: ["Asynchronous operations return HTTP 202 with a persisted job or run ID, stage, progress, and status URL. Environment create and branch return HTTP 201. Reuse an Idempotency-Key to make retries safe."],
      },
      {
        heading: "Response behavior",
        paragraphs: ["List endpoints use cursor pagination with allowed limits of 20, 50, or 100. Errors use a structured envelope and stable machine-readable codes; upstream status, code, and detail are preserved verbatim."],
      },
    ],
  },
  {
    slug: "troubleshooting",
    label: "Troubleshooting",
    description: "Outcome semantics, fair-use limits, and common failure modes.",
    nav: [
      { slug: "failed-vs-error", label: "Failed vs error", description: "Outcome semantics" },
      { slug: "budget-limits", label: "Budget limits", description: "Fair-use ceilings" },
      { slug: "cold-materializer", label: "Cold materializer", description: "First-run latency" },
      { slug: "idempotency-conflicts", label: "Idempotency conflicts", description: "Retry safety" },
    ],
    sections: [
      {
        heading: "Failed vs error",
        paragraphs: ["A failed simulation means the invocation executed and produced a contract or host failure — a useful result that explains why it would fail on-chain. An error status means the platform or engine could not complete the request."],
      },
      {
        heading: "Budget limits",
        paragraphs: ["Releeve fails closed before exhausting budgets. When a limit is reached you get an honest unavailable, inconclusive, or budget_limited outcome rather than a guessed answer."],
        bullets: ["R2 snapshot cache: 8 GiB", "Local payload LRU: 1 GiB", "Cold materializer: concurrency 1 with a 15-minute deadline", "Reverse traversal: 4,096 ledgers / 256 MiB", "Footprint discovery: at most 8 rounds / 1,000 keys", "RPC response ceiling: 64 MiB"],
      },
      {
        heading: "Cold materializer",
        paragraphs: ["The first simulation on a snapshot may take longer while the cold materializer builds it, with a 15-minute deadline. Subsequent simulations on the same snapshot reuse the cached materialization."],
      },
      {
        heading: "Idempotency conflicts",
        paragraphs: ["Reusing an Idempotency-Key with a different body returns an idempotency conflict. Keep the key stable per logical operation so retries replay the same request."],
      },
    ],
  },
  {
    slug: "changelog",
    label: "Changelog",
    description: "What changed in the Releeve platform, month by month.",
    nav: [
      { slug: "august-2026", label: "August 2026", description: "Latest updates" },
      { slug: "july-2026", label: "July 2026", description: "Platform and engine" },
      { slug: "june-2026", label: "June 2026", description: "Early access" },
    ],
    sections: [
      {
        heading: "August 2026",
        paragraphs: ["Virtual networks now support write-through overlays with deterministic replay verification, and source verification is available for contract packages."],
      },
      {
        heading: "July 2026",
        paragraphs: ["Monitoring alerts gained flexible notification routing with sequential and parallel execution modes for incident handling."],
      },
      {
        heading: "June 2026",
        paragraphs: ["Public preview of simulations, monitoring, and the explorer. Organization access tokens replaced direct engine credentials."],
      },
    ],
  },
];

export function getDocTab(slug: string) {
  return docTabs.find((tab) => tab.slug === slug);
}

export type DocsTreePage = { type: "page"; slug: string; label: string };
export type DocsTreeLabel = { type: "label"; label: string };
export type DocsTreeGroup = { type: "group"; label: string; children: DocsTreeItem[] };
export type DocsTreeItem = DocsTreePage | DocsTreeLabel | DocsTreeGroup;

export const docsTree: DocsTreeItem[] = [
  { type: "label", label: "Getting started" },
  { type: "page", slug: "overview", label: "Overview" },
  { type: "page", slug: "quickstart", label: "Quickstart" },
  { type: "label", label: "Simulation" },
  { type: "page", slug: "simulations", label: "Simulations" },
  { type: "page", slug: "virtual-environments", label: "Virtual networks" },
  { type: "page", slug: "correctness-and-trust", label: "Correctness and trust" },
  { type: "label", label: "Monitoring" },
  { type: "page", slug: "monitoring", label: "Monitoring" },
  { type: "page", slug: "explorer", label: "Explorer" },
  { type: "label", label: "Building" },
  { type: "page", slug: "debugger", label: "Debugger" },
  { type: "page", slug: "source-verification", label: "Source verification" },
  { type: "page", slug: "protocol-support", label: "Protocol support" },
  { type: "page", slug: "node-rpc", label: "Node and RPC" },
  { type: "page", slug: "networks", label: "Networks" },
  { type: "group", label: "Platform", children: [
    { type: "page", slug: "write-path", label: "Write path" },
    { type: "page", slug: "accounts-projects", label: "Accounts and projects" },
    { type: "page", slug: "pricing", label: "Pricing" },
  ] },
];

export function getTreePages(tree: DocsTreeItem[]): DocsTreePage[] {
  const pages: DocsTreePage[] = [];
  for (const item of tree) {
    if (item.type === "page") pages.push(item);
    else if (item.type === "group") pages.push(...getTreePages(item.children));
  }
  return pages;
}
