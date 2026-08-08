import { chromium } from "playwright";

const endpoint = process.env.CHROME_CDP_ENDPOINT ?? "http://127.0.0.1:9222";
const tenderlyUrl = "https://dashboard.tenderly.co/";

const browser = await chromium.connectOverCDP(endpoint);
const contexts = browser.contexts();
const context = contexts[0] ?? (await browser.newContext());
let page = context.pages().find((candidate) =>
  candidate.url().includes("tenderly.co"),
);

if (!page) {
  page = await context.newPage();
  await page.goto(tenderlyUrl, { waitUntil: "domcontentloaded" });
}

await page.bringToFront();
console.log(`Connected to Chrome over CDP: ${endpoint}`);
console.log(`Active page: ${page.url()}`);
console.log("Leave this process running while inspecting. Press Ctrl+C to disconnect.");

await new Promise(() => {});
