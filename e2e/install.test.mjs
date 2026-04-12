// Install/uninstall test: install MockAddon from the mock catalog, verify its
// dependency MockLib is auto-installed, the files land in the temp AddOns
// dir, and that uninstalling MockAddon leaves MockLib on disk (libraries are
// not automatically removed).

import { expect } from "@wdio/globals";
import { existsSync } from "node:fs";
import { join } from "node:path";

const ADDONS_DIR = process.env.GRIMOIRE_E2E_ADDONS_DIR;
if (!ADDONS_DIR) {
  throw new Error(
    "GRIMOIRE_E2E_ADDONS_DIR env var not set — wdio.conf.mjs should populate it in onPrepare"
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

async function dismissSuccessOverlay() {
  // Wait for either Success or Error overlay — fail loudly with the error
  // details so install failures are immediately actionable.
  await browser.waitUntil(
    async () => {
      const success = await $("h3=Success");
      const error = await $("h3=Error");
      return (await success.isExisting()) || (await error.isExisting());
    },
    { timeout: 15000, timeoutMsg: "Neither Success nor Error overlay appeared" }
  );

  const error = await $("h3=Error");
  if (await error.isExisting()) {
    // Dump the visible overlay text so the failure is diagnosable.
    const body = await $(".fixed.inset-0.z-50");
    const text = (await body.getText()).replace(/\s+/g, " ").slice(0, 500);
    throw new Error(`Install triggered Error overlay: ${text}`);
  }

  const successHeading = await $("h3=Success");
  const dismiss = await $("button=Dismiss");
  await dismiss.click();
  await successHeading.waitForExist({ reverse: true, timeout: 5000 });
}

describe("Grimoire install/uninstall flow", () => {
  before(async () => {
    const heading = await $("h1=Grimoire");
    await heading.waitForExist({ timeout: 30000 });
    await waitForSyncModalToClose();
  });

  it("installs MockAddon and auto-installs its MockLib dependency", async () => {
    const browseTab = await $("button=browse");
    await browseTab.click();
    const search = await $(
      'input[placeholder="Search addons by name or author..."]'
    );
    await search.waitForExist({ timeout: 10000 });

    // Narrow results so only MockAddon remains visible, then the one and
    // only "Install" button is unambiguous.
    await search.setValue("MockAddon");
    const mockAddonName = await $("span=MockAddon");
    await mockAddonName.waitForExist({ timeout: 10000 });
    // Wait for MockStandalone to be filtered out (300ms debounce).
    const mockStandalone = await $("span=MockStandalone");
    await browser.waitUntil(
      async () => !(await mockStandalone.isExisting()),
      { timeout: 5000, timeoutMsg: "search filter did not narrow results" }
    );

    const installButton = await $("button=Install");
    await installButton.waitForExist({ timeout: 5000 });
    await installButton.click();

    // Dismiss the success overlay — confirms the install actually completed.
    await dismissSuccessOverlay();

    // Files on disk
    expect(existsSync(join(ADDONS_DIR, "MockAddon", "MockAddon.txt"))).toBe(true);
    expect(existsSync(join(ADDONS_DIR, "MockLib", "MockLib.txt"))).toBe(true);
  });

  it("shows the installed addon on the Installed page", async () => {
    const installedTab = await $("button=installed");
    await installedTab.click();

    // Wait for the list to finish loading (loading message disappears).
    await browser.waitUntil(
      async () => {
        const loading = await $("p=Scanning addons...");
        return !(await loading.isExisting());
      },
      { timeout: 10000, timeoutMsg: "Installed list never finished loading" }
    );

    const mockAddonCard = await $("span=MockAddon");
    await mockAddonCard.waitForExist({ timeout: 10000 });

    // Library is hidden by default — enable the toggle to confirm it's there.
    const checkboxes = await $$('input[type="checkbox"]');
    // The first checkbox on the page is the Installed-page "Show libraries"
    // toggle (the Filter input sits directly before it).
    const showLibs = checkboxes[0];
    if (!(await showLibs.isSelected())) {
      await showLibs.click();
    }
    const mockLibCard = await $("span=MockLib");
    await mockLibCard.waitForExist({ timeout: 5000 });
  });

  it("uninstalls MockAddon and leaves MockLib on disk", async () => {
    const installedTab = await $("button=installed");
    await installedTab.click();

    // Narrow the list to just MockAddon so the Uninstall button is unambiguous.
    const filterInput = await $('input[placeholder="Filter addons..."]');
    await filterInput.waitForExist({ timeout: 10000 });
    await filterInput.setValue("MockAddon");

    const uninstallButton = await $("button=Uninstall");
    await uninstallButton.waitForExist({ timeout: 5000 });
    await uninstallButton.click();

    // While confirming, the card now has TWO "Uninstall" buttons — the
    // original top-right one (no-op when already confirming) and the red
    // confirmation button. The red one is the second in document order.
    await browser.waitUntil(
      async () => (await $$("button=Uninstall")).length >= 2,
      { timeout: 5000, timeoutMsg: "confirmation uninstall button never appeared" }
    );
    const confirmButtons = await $$("button=Uninstall");
    await confirmButtons[1].click();

    // Wait for the MockAddon card to disappear from the list.
    const mockAddonName = await $("span=MockAddon");
    await browser.waitUntil(async () => !(await mockAddonName.isExisting()), {
      timeout: 10000,
      timeoutMsg: "MockAddon card still visible after uninstall",
    });

    // MockAddon's folder should be gone; MockLib should still be on disk.
    expect(existsSync(join(ADDONS_DIR, "MockAddon"))).toBe(false);
    expect(existsSync(join(ADDONS_DIR, "MockLib", "MockLib.txt"))).toBe(true);
  });
});
