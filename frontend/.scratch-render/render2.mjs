import { chromium } from "playwright";
import { readFileSync } from "node:fs";

const sceneJson = readFileSync(process.argv[2], "utf8");
const b64 = Buffer.from(sceneJson, "utf8").toString("base64");
const url = `https://excalidraw.com/#json=${b64}`;

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 2800, height: 1800 } });
await page.goto(url, { waitUntil: "load", timeout: 120000 });
await page.waitForTimeout(25000);

// The success dialog covers the canvas; dismiss it and the onboarding.
await page.getByRole("button", { name: /success|ok|got it|close/i }).first().click().catch(() => {});
await page.keyboard.press("Escape").catch(() => {}).then(() => page.waitForTimeout(1000));
await page.keyboard.press("Escape").catch(() => {});

// check for our scene text specifically
const found = await page.evaluate(() => {
  const html = document.body.innerHTML;
  return {
    hasProvide: html.includes("WHAT YOU PROVIDE"),
    hasFixture: html.includes("FIXTURE CAPTURE"),
    hasOracle: html.includes("ORACLE / CORRECTNESS"),
    hasProtocol: html.includes("PROTOCOL LANES"),
    svgCount: document.querySelectorAll("svg").length,
    textLen: document.body.innerText.length,
  };
});
console.log(JSON.stringify(found));
await page.screenshot({ path: process.argv[3], fullPage: true });
await browser.close();