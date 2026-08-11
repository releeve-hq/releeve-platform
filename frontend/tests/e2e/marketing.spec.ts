import { expect, test } from "@playwright/test";

const publicRoutes = [
  "/",
  "/about",
  "/pricing",
  "/docs",
  "/docs/quickstart",
  "/docs/simulations",
  "/docs/virtual-environments",
  "/docs/monitoring",
  "/docs/explorer",
  "/docs/api-reference",
  "/terms",
  "/privacy",
];

test.beforeEach(async ({ page }, testInfo) => {
  if (!testInfo.title.includes("cookie preferences")) {
    await page.addInitScript(() => {
      localStorage.setItem("releeve-cookie-consent", JSON.stringify({ preferences: false, analytics: false, marketing: false }));
    });
  }
});

test("landing renders the product story and real conversion links", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1, name: /Simulation infrastructure for Stellar developers/i })).toBeVisible();
  await expect(page.getByLabel("Example simulation preview").first()).toBeVisible();
  await expect(page.getByRole("link", { name: "Create account" }).first()).toHaveAttribute("href", "/signup");
  await expect(page.getByRole("link", { name: "Explore testnet" })).toHaveAttribute("href", "/explorer/testnet");
  const faviconHref = await page.locator('link[rel~="icon"]').getAttribute("href");
  expect(faviconHref).toContain("/icon.png");
  expect((await page.request.get(new URL(faviconHref!, page.url()).toString())).ok()).toBe(true);
  await page.getByRole("tab", { name: "State" }).first().click();
  await expect(page.locator("code").filter({ hasText: "Positions[GDX4...WHALE]" }).first()).toBeVisible();
});

test("desktop navigation supports dropdown interaction", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name === "mobile-chrome", "Desktop navigation is replaced by the mobile menu.");
  await page.goto("/");
  const platform = page.getByRole("button", { name: "Platform" });
  await platform.click();
  await expect(platform).toHaveAttribute("aria-expanded", "true");
  await expect(page.getByRole("link", { name: /Simulator Replay Soroban calls/ })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(platform).toHaveAttribute("aria-expanded", "false");
});

test("mobile navigation exposes every primary destination", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "mobile-chrome", "Mobile-only interaction.");
  await page.goto("/");
  await page.getByRole("button", { name: "Open navigation" }).click();
  await page.getByRole("button", { name: "Platform" }).click();
  const mobileMenu = page.getByRole("banner");
  await expect(mobileMenu.getByRole("link", { name: "Virtual environments" })).toBeVisible();
  await expect(mobileMenu.getByRole("link", { name: "Pricing" })).toBeVisible();
  await expect(mobileMenu.getByRole("link", { name: "Create account" })).toBeVisible();
});

test("marketing theme defaults dark and persists a light preference", async ({ page }) => {
  await page.goto("/");
  await page.evaluate(() => localStorage.removeItem("releeve-marketing-theme"));
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("data-marketing-theme", "dark");
  const themeToggle = page.getByRole("contentinfo").getByRole("button", { name: "Switch to light theme" });
  await themeToggle.scrollIntoViewIfNeeded();
  await themeToggle.click();
  await expect(page.locator("html")).toHaveAttribute("data-marketing-theme", "light");
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("data-marketing-theme", "light");
});

for (const route of publicRoutes) {
  test(`${route} is public, singular, and does not overflow`, async ({ page }) => {
    const response = await page.goto(route);
    expect(response?.status()).toBeLessThan(400);
    await expect(page.locator("h1")).toHaveCount(1);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1);
    expect(overflow).toBe(false);
  });
}

test("documentation filters guides and API reference reaches OpenAPI", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name === "mobile-chrome", "Desktop docs sidebar test.");
  await page.goto("/docs");
  await page.getByPlaceholder("Filter guides").fill("monitor");
  const docsNav = page.getByLabel("Documentation", { exact: true });
  await expect(docsNav.getByRole("link", { name: "Monitoring" })).toBeVisible();
  await expect(docsNav.locator('a[href="/docs/simulations"]')).toHaveCount(0);
  await page.goto("/docs/api-reference");
  await expect(page.getByRole("link", { name: /Open interactive API reference/ })).toHaveAttribute("href", /\/docs$/);
});

test("pricing is honest about preview and has no checkout", async ({ page }) => {
  await page.goto("/pricing");
  await expect(page.getByText("Preview access")).toBeVisible();
  await expect(page.getByText("Price not set")).toHaveCount(2);
  await expect(page.getByText("final packaging and prices are still being shaped")).toBeVisible();
  await expect(page.getByRole("button", { name: /checkout/i })).toHaveCount(0);
});

test("cookie preferences can be managed without accepting optional categories", async ({ page }) => {
  await page.goto("/");
  const dialog = page.getByRole("dialog", { name: "Cookie preferences" });
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: "Manage" }).click();
  await expect(dialog.getByRole("switch", { name: "Analytics" })).toHaveAttribute("aria-checked", "false");
  await dialog.getByRole("button", { name: "Save preferences" }).click();
  await expect(dialog).toBeHidden();
});
