import { expect, test, type BrowserContext } from "@playwright/test";

test.describe.configure({ mode: "serial", timeout: 90_000 });

const environment = {
  id: "env-1",
  name: "Production mirror",
  network: "mainnet",
  protocol: 27,
  base_ledger_sequence: 61234567,
  state_ledger: 61234567,
  execution_ledger: 61234568,
  sync_status: "ready",
  sync_enabled: false,
  mode: "frozen",
  active_revision_id: "revision-1",
  revision: 1,
  state_hash: "6d7f7b0dd3e851bd0d1a3bd9e1f49a6e",
  verification_status: "certified",
  initialization_status: "ready",
  initialization_progress: 100,
  public_explorer_enabled: true,
  rpc_slug: "production-mirror",
};

async function mockPlatform(context: BrowserContext) {
  const wallets = [{
    id: "wallet-1",
    address: "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF",
    label: "Treasury",
    created_at: "2026-08-23T12:00:00Z",
    balances: [{ asset: "native", amount: "2500000000", decimals: 7 }],
  }];
  const deployments = [{
    id: "deployment-1",
    contract_id: "CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABSC4",
    wasm_hash: "9f62d5ce",
    source_account: wallets[0].address,
    created_at: "2026-08-23T12:04:00Z",
  }];
  const logs = [
    { id: "log-1", method: "getLatestLedger", status: "success", latency_ms: 18, caller_class: "private", created_at: "2026-08-23T12:05:00Z" },
    { id: "log-2", method: "simulateTransaction", status: "failed", latency_ms: 42, caller_class: "public", created_at: "2026-08-23T12:06:00Z" },
  ];

  await context.route("**/api/v1/**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname;
    const json = (body: unknown, status = 200) => route.fulfill({
      status,
      contentType: "application/json",
      body: JSON.stringify(body),
    });

    if (path === "/api/v1/me") return json({ id: "user-1", email: "owner@releeve.test", name: "Owner" });
    if (path === "/api/v1/me/organizations") return json([{ id: "org-1", slug: "acme", name: "Acme", is_personal: false, is_owner: true }]);
    if (path === "/api/v1/acme/projects") return json({ data: [{ id: "project-1", slug: "payments", name: "Payments", network: "mainnet" }] });
    if (path === "/api/v1/acme/payments/environments") return json({ environments: [environment] });
    if (path === "/api/v1/acme/payments/simulations") return json({ simulations: [{ id: "simulation-1", function_name: "settle", status: "succeeded", created_at: "2026-08-23T12:03:00Z", fork_environment_id: environment.id }] });
    if (path.endsWith("/overrides")) return json({ overrides: [] });
    if (path.endsWith("/coverage")) return json({ coverage: [] });
    if (path.endsWith("/wallets")) return json({ wallets });
    if (path.endsWith("/deployments")) return json({ deployments });
    if (path.endsWith("/activity")) return json({ activity: [{ id: "activity-1", kind: "funding", summary: "Funded Treasury with 250 XLM", created_at: "2026-08-23T12:02:00Z" }] });
    if (path.endsWith("/rpc-logs")) return json({ logs });
    if (path.endsWith("/rpc") && request.method() === "POST") {
      const rpcRequest = request.postDataJSON() as { id?: unknown; method?: string };
      return json({
        jsonrpc: "2.0",
        id: rpcRequest.id ?? null,
        result: rpcRequest.method === "getLatestLedger"
          ? { id: "61234568-latest", protocolVersion: 27, sequence: 61234568, closeTime: null, entries: Array.from({ length: 80 }, (_, index) => ({ index, value: `entry-${index}` })) }
          : {},
      });
    }
    if (path.endsWith("/revisions")) return json({ revisions: [{ id: "revision-1", revision_number: 1, state_ledger: 61234567, state_hash: environment.state_hash, created_at: "2026-08-23T12:00:00Z" }] });
    if (path === "/api/v1/public/virtual-explorer/acme/payments/production-mirror") return json({
      environment: { id: environment.id, name: environment.name, network: environment.network, state_ledger: environment.state_ledger, protocol: environment.protocol, status: "ready" },
      deployments,
      transactions: [{ tx_hash: "f4bb9170", status: "success", close_ledger: 61234568, created_at: "2026-08-23T12:05:00Z" }],
    });
    return json({});
  });
}

test.beforeEach(async ({ context, page }) => {
  await mockPlatform(context);
  await page.addInitScript(() => {
    localStorage.setItem("releeve-active-workspace", JSON.stringify({ organization: "acme", project: "payments", network: "mainnet" }));
    localStorage.setItem("releeve-cookie-consent", JSON.stringify({ preferences: false, analytics: false, marketing: false }));
  });
});

test("environment workspace exposes every persisted workflow without layout overlap", async ({ page }, testInfo) => {
  await page.goto("/projects/project-1/vnet");
  await expect(page.getByPlaceholder("Search environments")).toBeVisible();
  await expect(page.getByRole("checkbox")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Tag selected environments" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Delete selected environments" })).toHaveCount(0);

  await page.getByPlaceholder("Search environments").fill("does-not-exist");
  await expect(page.getByText("No matching environments", { exact: true })).toBeVisible();
  await expect(page.locator(".pw-catalog-empty")).toHaveCSS("background-image", "none");
  await page.getByPlaceholder("Search environments").fill("");
  await page.getByText("Production mirror", { exact: true }).click();

  await expect(page.getByRole("heading", { name: "Production mirror" })).toBeVisible();
  await expect(page.locator(".ew-icon")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Simulate", exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Back", exact: true })).toBeVisible();
  const tabOverflow = await page.locator(".ew-tabs").evaluate((element) => ({
    horizontal: element.scrollWidth > element.clientWidth + 1,
    vertical: element.scrollHeight > element.clientHeight + 1,
  }));
  expect(tabOverflow.horizontal).toBe(false);
  expect(tabOverflow.vertical).toBe(false);
  await expect(page.getByRole("heading", { name: "Transactions", exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "RPC Requests", exact: true })).toBeVisible();
  await expect(page.getByText("61,234,567", { exact: true }).first()).toBeVisible();

  await page.getByRole("button", { name: "Wallets", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Linked wallets", exact: true })).toBeVisible();
  await expect(page.getByLabel("Address")).toHaveCount(0);
  await page.getByRole("button", { name: "Link wallet", exact: true }).click();
  const walletDialog = page.getByRole("dialog", { name: "Link wallet" });
  await expect(walletDialog).toBeVisible();
  await expect(walletDialog.getByLabel("Address")).toBeVisible();
  await expect(walletDialog.getByLabel("Name")).toBeVisible();
  await walletDialog.getByRole("button", { name: "Cancel", exact: true }).click();

  const sections = [
    ["Wallets", "Linked wallets"],
    ["Contracts", "Deploy contract"],
    ["Fund", "Fund Wallet"],
    ["Fork", "Fork an immutable revision"],
    ["Simulation", "New simulation"],
    ["Integrate", "Integrate"],
    ["Activity", "Environment activity"],
    ["Configure", "Configure environment"],
  ] as const;

  for (const [tab, heading] of sections) {
    await page.getByRole("button", { name: tab, exact: true }).click();
    await expect(page.getByRole("heading", { name: heading, exact: true })).toBeVisible();
  }

  await page.getByRole("button", { name: "RPC Builder", exact: true }).click();
  const rpcWorkspace = page.getByLabel("RPC Builder workspace");
  await rpcWorkspace.getByRole("tab", { name: "JSON-RPC Calls", exact: true }).click();
  await page.getByPlaceholder("Search method, status, or caller").fill("simulate");
  await expect(page.getByText("simulateTransaction", { exact: true })).toBeVisible();
  await expect(page.getByText("getLatestLedger", { exact: true })).toHaveCount(0);

  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1);
  expect(overflow).toBe(false);
  await page.screenshot({ path: testInfo.outputPath("environment-workspace.png"), fullPage: true });
});

test("workspace honors reduced motion", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/projects/project-1/vnet");
  await page.getByText("Production mirror", { exact: true }).click();
  const transitionDuration = await page.locator(".ew-indicator").evaluate((element) => getComputedStyle(element).transitionDuration);
  expect(transitionDuration).toBe("0s");
});

test("RPC Builder opens examples, executes colorized JSON, and creates blank requests", async ({ page }) => {
  await page.goto("/projects/project-1/vnet");
  await page.getByText("Production mirror", { exact: true }).click();
  await page.getByRole("button", { name: "RPC Builder", exact: true }).click();

  const builder = page.getByLabel("RPC Builder workspace");
  await expect(builder.getByRole("tab", { name: "RPC Builder", exact: true })).toHaveAttribute("aria-selected", "true");
  await expect(builder.getByRole("tab", { name: "JSON-RPC Calls", exact: true })).toBeVisible();
  await builder.getByRole("tab", { name: "JSON-RPC Calls", exact: true }).click();
  await expect(builder.getByRole("heading", { name: "JSON-RPC Calls", exact: true })).toBeVisible();
  await expect(builder.getByRole("button", { name: "New Request", exact: true })).toHaveCount(0);
  await builder.getByRole("tab", { name: "RPC Builder", exact: true }).click();
  await expect(builder.locator(".rb-example")).toHaveCount(12);
  await expect(builder.locator(".rb-json-key")).toHaveCount(0);

  await builder.getByRole("button", { name: /^getLatestLedger/ }).click();
  const requestEditor = builder.getByLabel("JSON-RPC request");
  await expect(requestEditor).toHaveValue(/"method": "getLatestLedger"/);
  await expect(builder.locator(".rb-json-key").first()).toBeVisible();
  const pageHeight = await page.evaluate(() => document.documentElement.scrollHeight);
  await requestEditor.fill(JSON.stringify({ jsonrpc: "2.0", id: 1, method: "getLatestLedger", params: { notes: Array.from({ length: 80 }, (_, index) => `line-${index}`) } }, null, 2));
  expect(await requestEditor.evaluate(element => element.scrollHeight > element.clientHeight)).toBe(true);
  expect(await page.evaluate(() => document.documentElement.scrollHeight)).toBeLessThanOrEqual(pageHeight + 1);
  await builder.getByRole("button", { name: /^Run/ }).click();

  const response = builder.getByLabel("JSON-RPC response");
  await expect(response).toContainText('"sequence": 61234568');
  await expect(builder.locator(".rb-response-meta")).toContainText("Status 200");
  expect(await response.evaluate(element => element.scrollHeight > element.clientHeight)).toBe(true);

  await requestEditor.fill('{"jsonrpc":"2.0","method":"getLatestLedger",}');
  const problem = builder.getByRole("button", { name: /^View problem:/ });
  await expect(problem).toBeVisible();
  await expect(builder.locator(".rb-json-error")).toBeVisible();
  await problem.hover();
  await expect(problem.getByRole("tooltip")).toBeVisible();

  await builder.getByRole("button", { name: "New Request", exact: true }).click();
  await expect(builder.getByLabel("JSON-RPC request")).toHaveValue("");
  await expect(builder.getByText("Start with a JSON-RPC request, then run it to see the response.")).toBeVisible();
  await expect(builder.getByRole("button", { name: /^Run/ })).toBeDisabled();
});

test("public virtual explorer is anonymous, responsive, and contains only virtual-chain data", async ({ page }, testInfo) => {
  await page.goto("/virtual-explorer/acme/payments/production-mirror");
  await expect(page.getByRole("heading", { name: "Production mirror" })).toBeVisible();
  await expect(page.getByText("isolated virtual chain")).toBeVisible();
  await expect(page.getByText("f4bb9170")).toBeVisible();
  await expect(page.getByText("owner@releeve.test")).toHaveCount(0);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1);
  expect(overflow).toBe(false);
  await page.screenshot({ path: testInfo.outputPath("virtual-explorer.png"), fullPage: true });
});
