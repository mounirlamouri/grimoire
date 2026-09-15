// CSP test: the policy in tauri.conf.json must not block anything the app
// needs. Debug builds load devUrl, which Tauri serves without the app's CSP,
// so e2e/static-server.mjs sends the same policy with a report-uri and this
// spec checks the violation reports it collected.

import { expect } from "@wdio/globals";
import { CSP_REPORTS_PATH, cspFromTauriConfig } from "./static-server.mjs";

const STATIC_URL = process.env.GRIMOIRE_E2E_STATIC_URL;
if (!STATIC_URL) {
  throw new Error(
    "GRIMOIRE_E2E_STATIC_URL env var not set — wdio.conf.mjs should populate it in onPrepare"
  );
}

async function waitForSyncModalToClose() {
  const modal = await $("h3=Syncing Addon Catalog");
  try {
    await modal.waitForExist({ timeout: 5000 });
    await modal.waitForExist({ reverse: true, timeout: 30000 });
  } catch {
    // Modal never appeared — sync was instant.
  }
}

async function fetchCspReports() {
  const res = await fetch(`${STATIC_URL}${CSP_REPORTS_PATH}`);
  return res.json();
}

describe("Grimoire content security policy", () => {
  before(async () => {
    const heading = await $("h1=Grimoire");
    await heading.waitForExist({ timeout: 30000 });
    await waitForSyncModalToClose();
  });

  it("serves the policy from tauri.conf.json", async () => {
    const res = await fetch(`${STATIC_URL}/`);
    expect(res.headers.get("content-security-policy")).toContain(
      cspFromTauriConfig()
    );
  });

  it("reports no violations while using every page", async () => {
    await (await $("button=installed")).click();

    // Expand a catalog card so its metadata is fetched over IPC and the
    // BBCode description renders.
    await (await $("button=browse")).click();
    const search = await $(
      'input[placeholder="Search addons by name or author..."]'
    );
    await search.waitForExist({ timeout: 10000 });
    await search.setValue("MockStandalone");
    const card = await $("span=MockStandalone");
    await card.waitForExist({ timeout: 10000 });
    await card.click();
    const description = await $(".bbcode-description");
    await description.waitForExist({ timeout: 10000 });
    expect(await description.getText()).toContain("Mock addon MockStandalone");

    await (await $("button=settings")).click();
    await (await $("h2=Settings")).waitForExist({ timeout: 10000 });

    await (await $("button=installed")).click();

    // Reports are posted asynchronously; give late ones a moment to arrive.
    await browser.pause(1000);
    expect(await fetchCspReports()).toEqual([]);
  });

  it("reports a violation for a blocked inline script", async () => {
    // Proves the reporting pipeline works, so the empty list above means
    // something.
    const before = (await fetchCspReports()).length;
    await browser.execute(() => {
      const script = document.createElement("script");
      script.textContent = "window.__cspCanary = true;";
      document.head.appendChild(script);
      script.remove();
    });

    await browser.waitUntil(
      async () => (await fetchCspReports()).length > before,
      {
        timeout: 10000,
        timeoutMsg: "No CSP report received for a blocked inline script",
      }
    );
    expect(await browser.execute(() => window.__cspCanary === true)).toBe(false);
  });
});
