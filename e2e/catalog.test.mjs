// Catalog test: after the app auto-syncs against the mock MMOUI server on
// startup, verify the Browse page shows the fixture addons and that search /
// "show libraries" filter behave correctly.
//
// Fixture catalog (see e2e/mock-server.mjs):
//   - MockLib        (library, hidden by default)
//   - MockAddon      (depends on MockLib)
//   - MockStandalone (no deps)

import { expect } from "@wdio/globals";

async function waitForSyncModalToClose() {
  const modal = await $("h3=Syncing Addon Catalog");
  try {
    await modal.waitForExist({ timeout: 5000 });
    await modal.waitForExist({ reverse: true, timeout: 30000 });
  } catch {
    // Modal never appeared — sync was instant.
  }
}

async function openBrowse() {
  const browseTab = await $("button=browse");
  await browseTab.click();
  const search = await $('input[placeholder="Search addons by name or author..."]');
  await search.waitForExist({ timeout: 10000 });
  return search;
}

describe("Grimoire catalog", () => {
  before(async () => {
    const heading = await $("h1=Grimoire");
    await heading.waitForExist({ timeout: 30000 });
    await waitForSyncModalToClose();
  });

  it("shows non-library fixture addons on the Browse page", async () => {
    await openBrowse();

    const mockAddon = await $("span=MockAddon");
    const mockStandalone = await $("span=MockStandalone");
    await mockAddon.waitForExist({ timeout: 10000 });
    await mockStandalone.waitForExist({ timeout: 10000 });

    // MockLib is a library — hidden by default.
    const mockLib = await $("span=MockLib");
    expect(await mockLib.isExisting()).toBe(false);
  });

  it("reveals libraries when 'Show libraries' is checked", async () => {
    await openBrowse();

    const showLibs = await $('input[type="checkbox"]');
    await showLibs.waitForExist({ timeout: 5000 });
    if (!(await showLibs.isSelected())) {
      await showLibs.click();
    }

    const mockLib = await $("span=MockLib");
    await mockLib.waitForExist({ timeout: 5000 });
    expect(await mockLib.isExisting()).toBe(true);

    // Uncheck again so later tests see the default-filtered view.
    if (await showLibs.isSelected()) {
      await showLibs.click();
    }
  });

  it("narrows results when searching by name", async () => {
    const search = await openBrowse();

    await search.click();
    await browser.keys("MockStandalone");

    // Debounced 300ms; give it a moment then verify.
    const mockStandalone = await $("span=MockStandalone");
    await mockStandalone.waitForExist({ timeout: 5000 });

    const mockAddon = await $("span=MockAddon");
    // MockAddon should no longer be visible in the filtered list.
    await browser.waitUntil(async () => !(await mockAddon.isExisting()), {
      timeout: 5000,
      timeoutMsg: "MockAddon still visible after filtering for MockStandalone",
    });

    // Clear the search for subsequent tests — select all then delete.
    // Uses Ctrl+A (not Cmd+A) since E2E only targets Windows and Linux.
    await search.click();
    await browser.keys(["Control", "a"]);
    await browser.keys(["Backspace"]);
  });
});
