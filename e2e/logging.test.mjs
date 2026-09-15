// Logging test: the running app writes its log file under the data dir
// (GRIMOIRE_DATA_DIR points at the per-run temp dir), and the Settings page
// offers a way to open the logs folder. The button is not clicked: it would
// open a real file manager window.

import { expect } from "@wdio/globals";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const TEMP_DIR = process.env.GRIMOIRE_E2E_TEMP_DIR;
if (!TEMP_DIR) {
  throw new Error(
    "GRIMOIRE_E2E_TEMP_DIR env var not set — wdio.conf.mjs should populate it in onPrepare"
  );
}

const LOG_FILE = join(TEMP_DIR, "logs", "grimoire.log");

function readLog() {
  return existsSync(LOG_FILE) ? readFileSync(LOG_FILE, "utf-8") : "";
}

async function waitForSyncModalToClose() {
  const modal = await $("h3=Syncing Addon Catalog");
  try {
    await modal.waitForExist({ timeout: 5000 });
    await modal.waitForExist({ reverse: true, timeout: 30000 });
  } catch {
    // Modal never appeared — sync was instant or catalog already populated.
  }
}

describe("Grimoire logging", () => {
  before(async () => {
    await (await $("h1=Grimoire")).waitForExist({ timeout: 30000 });
    await waitForSyncModalToClose();
  });

  it("writes a startup entry to the log file in the data dir", async () => {
    await browser.waitUntil(() => readLog().includes("Starting Grimoire"), {
      timeout: 10000,
      timeoutMsg: `no startup entry in ${LOG_FILE}`,
    });
  });

  it("logs the startup catalog sync", async () => {
    await browser.waitUntil(() => readLog().includes("Catalog sync succeeded"), {
      timeout: 30000,
      timeoutMsg: `no catalog sync entry in ${LOG_FILE}`,
    });
  });

  it("shows an Open logs folder button in Settings", async () => {
    await (await $("button=settings")).click();
    await (await $("h2=Settings")).waitForExist({ timeout: 10000 });

    const button = await $("button=Open logs folder");
    await button.waitForExist({ timeout: 5000 });
    expect(await button.isDisplayed()).toBe(true);

    await (await $("button=installed")).click();
  });
});
