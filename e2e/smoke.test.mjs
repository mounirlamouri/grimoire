// Smoke test: verify the Grimoire binary launches, the main chrome renders,
// and tab navigation works. Catalog sync and install flows are exercised by
// catalog.test.mjs and install.test.mjs respectively.

import { expect } from "@wdio/globals";

async function waitForHeading() {
  const heading = await $("h1=Grimoire");
  await heading.waitForExist({ timeout: 30000 });
  return heading;
}

async function waitForSyncModalToClose() {
  // The app auto-syncs on startup. When the catalog is empty (first run), a
  // modal is shown. Wait for it to disappear before interacting with nav.
  const modal = await $("h3=Syncing Addon Catalog");
  try {
    await modal.waitForExist({ timeout: 5000 });
    await modal.waitForExist({ reverse: true, timeout: 30000 });
  } catch {
    // Modal never appeared — either sync was instantaneous or catalog was
    // already populated. Either way, we're good to proceed.
  }
}

describe("Grimoire smoke test", () => {
  it("launches and shows the Grimoire header", async () => {
    await waitForHeading();
    await waitForSyncModalToClose();
    const heading = await $("h1=Grimoire");
    expect(await heading.getText()).toBe("Grimoire");
  });

  it("navigates between Installed / Browse / Settings tabs without errors", async () => {
    await waitForSyncModalToClose();

    const installedTab = await $("button=installed");
    const browseTab = await $("button=browse");
    const settingsTab = await $("button=settings");

    await installedTab.click();
    await browseTab.click();
    // Browse page shows a search input placeholder — use it as a readiness signal
    const browseSearch = await $(
      'input[placeholder="Search addons by name or author..."]'
    );
    await browseSearch.waitForExist({ timeout: 10000 });

    await settingsTab.click();
    const settingsHeading = await $("h2=Settings");
    await settingsHeading.waitForExist({ timeout: 10000 });

    await installedTab.click();
  });

  it("does not show an error overlay on startup", async () => {
    const errorHeading = await $("h2=Error");
    const exists = await errorHeading.isExisting();
    expect(exists).toBe(false);
  });
});
