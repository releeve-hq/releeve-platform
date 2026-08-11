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
        code: `export RELEEVE_API="http://localhost:8080"\nexport RELEEVE_TOKEN="rlv_..."\nexport RELEEVE_ORG="your-org"\nexport RELEEVE_PROJECT="your-project"`,
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
      },
      {
        heading: "Inspect the result",
        paragraphs: ["Poll the returned run ID until its status becomes success, failed, or error. The detail response exposes calls, events, state changes, resources, return values, and structured failure information."],
        code: `curl "$RELEEVE_API/api/v1/$RELEEVE_ORG/$RELEEVE_PROJECT/simulations/$RUN_ID" \\
  -H "Authorization: Bearer $RELEEVE_TOKEN"`,
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
        paragraphs: ["A Releeve simulation starts from a real Stellar ledger snapshot and executes through Fork Core's Soroban host boundary. It is execution against hypothetical state, not a statistical estimate."],
        bullets: ["Choose the base ledger explicitly or use the project's current snapshot", "Provide a contract ID, function name, and decoded arguments or raw host-function XDR", "Keep the recorded base ledger visible when comparing results"],
      },
      {
        heading: "State overrides",
        paragraphs: ["Overrides are applied before execution and carry provenance into the result so a changed input cannot be mistaken for network state."],
        bullets: ["Account or asset balances", "Contract storage ledger entries", "Ledger sequence and close timestamp", "Entry TTL and explicit storage footprint"],
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
        paragraphs: ["Pending means the run is still queued. Failed means the invocation executed and produced a contract or host failure. Error means Releeve or Fork Core could not complete the request."],
      },
    ],
  },
  {
    slug: "virtual-environments",
    label: "Virtual environments",
    description: "Keep a named ledger snapshot, its overrides, and its simulation history together.",
    sections: [
      {
        heading: "Create an environment",
        paragraphs: ["Virtual environments are project-scoped. Select a network, protocol version, and base ledger, then choose whether untouched state should continue synchronizing."],
        code: `POST /api/v1/{org}/{project}/environments\n\n{
  "name": "Checkout regression",
  "network": "testnet",
  "protocol": 23,
  "base_ledger_sequence": 58743921,
  "sync_enabled": true
}`,
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
        heading: "Sync and rollback",
        paragraphs: ["Start or stop state synchronization explicitly. Rollback restores the environment to a recorded ledger boundary while preserving an auditable run history."],
        bullets: ["Start sync", "Stop sync", "Inspect sync status", "Rollback to a ledger", "Delete the environment when the scenario is complete"],
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
        paragraphs: ["Every alert is Target x Expressions x Destinations. Match all requires every expression to pass; match any fires when at least one passes."],
        bullets: ["Targets: address, network, project, or tag", "Expressions: failure, success, function call, event, transfer, balance, state, caller, value, no action, and more", "Destinations: account-scoped services or project-scoped webhooks"],
      },
      {
        heading: "Create a rule",
        paragraphs: ["Rules can start paused or enabled. Parameters remain structured JSON so new expression types can be introduced without changing the rule envelope."],
        code: `POST /api/v1/{org}/{project}/alerts\n\n{
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
        paragraphs: ["Email, Slack, Telegram, Discord, Sentry, and PagerDuty destinations belong to the organization and can be reused. Webhooks belong to a project."],
      },
      {
        heading: "Webhook verification",
        paragraphs: ["A webhook endpoint responds to GET health checks and POST deliveries. Releeve signs the payload with its signing secret and timestamp, records every attempt, and retries failures up to the configured limit."],
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
        paragraphs: ["Releeve exposes transaction, account, contract, and ledger views for mainnet, testnet, and futurenet."],
        code: `GET /api/v1/explorer/{network}/tx/{hash}\nGET /api/v1/explorer/{network}/account/{address}\nGET /api/v1/explorer/{network}/contract/{address}\nGET /api/v1/explorer/{network}/ledger/{sequence}`,
      },
      {
        heading: "Network feeds",
        paragraphs: ["Cached feeds provide immediate network context without positioning Releeve as a general discovery explorer."],
        bullets: ["Latest transactions", "Recent ledgers", "Top tokens", "Token transfers", "Live feed updates"],
      },
      {
        heading: "Soroban-native evidence",
        paragraphs: ["Transaction detail focuses on the diagnostics Stellar developers can act on: nested invocations, typed events, ledger-entry state, transfers, and metered resources rather than EVM opcode or gas-auction framing."],
      },
    ],
  },
  {
    slug: "api-reference",
    label: "API reference",
    description: "Use the generated OpenAPI surface for exact routes, schemas, and response envelopes.",
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
        heading: "Response behavior",
        paragraphs: ["List endpoints use cursor pagination with allowed limits of 20, 50, or 100. Errors use a structured envelope and stable machine-readable codes."],
      },
    ],
  },
];

export const docsNav = docGuides.map(({ slug, label, description }) => ({ slug, label, description }));

export function getDocGuide(slug: string) {
  return docGuides.find((guide) => guide.slug === slug);
}
