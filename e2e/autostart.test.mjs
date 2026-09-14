// Launch-at-login test: toggles the Startup settings and verifies the real OS
// entry (HKCU Run value on Windows, XDG autostart .desktop file on Linux).
// The entry is registered under a test-only name (see e2e/autostart-entry.mjs)
// and removed again in onComplete.
//
// The hidden launch itself (--autostart) and single-instance forwarding are
// not covered here: the harness needs a visible, attached window. They are
// covered by Rust unit tests and manual testing.

import { expect } from "@wdio/globals";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import {
  disableEntryInSystemSettings,
  hasSystemSettingsOverride,
  readEntryCommand,
  removeEntry,
} from "./autostart-entry.mjs";

const binaryPath = resolve(
  "src-tauri",
  "target",
  "debug",
  process.platform === "win32" ? "grimoire.exe" : "grimoire"
);

async function waitForSyncModalToClose() {
  const modal = await $("h3=Syncing Addon Catalog");
  try {
    await modal.waitForExist({ timeout: 5000 });
    await modal.waitForExist({ reverse: true, timeout: 30000 });
  } catch {
    // Modal never appeared — sync was instant or catalog already populated.
  }
}

// Switching tabs remounts the Settings page, which re-reads the OS entry.
async function openSettings() {
  await (await $("button=installed")).click();
  await (await $("button=settings")).click();
  await (await $("h2=Settings")).waitForExist({ timeout: 10000 });
}

async function autostartCheckbox() {
  return (await $("label*=Launch Grimoire when I sign in")).$("input");
}

async function startMinimizedCheckbox() {
  return (await $("label*=Start minimized to the system tray")).$("input");
}

async function waitForSelected(checkbox, selected) {
  await browser.waitUntil(async () => (await checkbox.isSelected()) === selected, {
    timeout: 10000,
    timeoutMsg: `checkbox never became ${selected ? "checked" : "unchecked"}`,
  });
}

function readSettings() {
  const path = join(process.env.GRIMOIRE_E2E_TEMP_DIR, "settings.json");
  return JSON.parse(readFileSync(path, "utf-8"));
}

describe("Grimoire launch at login", () => {
  before(async () => {
    await (await $("h1=Grimoire")).waitForExist({ timeout: 30000 });
    await waitForSyncModalToClose();
    removeEntry();
  });

  after(() => {
    removeEntry();
  });

  it("starts with launch at login off", async () => {
    await openSettings();
    const autostart = await autostartCheckbox();
    await autostart.waitForExist({ timeout: 5000 });

    expect(await autostart.isSelected()).toBe(false);
    expect(await (await startMinimizedCheckbox()).isEnabled()).toBe(false);
  });

  it("registers an OS entry for this binary when enabled", async () => {
    await openSettings();
    await (await autostartCheckbox()).click();

    await browser.waitUntil(() => readEntryCommand() !== null, {
      timeout: 10000,
      timeoutMsg: "autostart entry was not created",
    });
    const command = readEntryCommand();
    expect(command.toLowerCase()).toContain(binaryPath.toLowerCase());
    expect(command).toContain("--autostart");

    const minimized = await startMinimizedCheckbox();
    await browser.waitUntil(() => minimized.isEnabled(), { timeout: 5000 });
  });

  it("reads the enabled state back from the OS", async () => {
    await openSettings();
    await waitForSelected(await autostartCheckbox(), true);
  });

  it("stores the start-minimized preference without rewriting the entry", async () => {
    await openSettings();
    await waitForSelected(await autostartCheckbox(), true);
    const commandBefore = readEntryCommand();
    const minimized = await startMinimizedCheckbox();
    await waitForSelected(minimized, true);

    await minimized.click();
    await browser.waitUntil(() => readSettings().start_minimized_on_autostart === false, {
      timeout: 5000,
      timeoutMsg: "start_minimized_on_autostart was not saved",
    });
    expect(readEntryCommand()).toBe(commandBefore);

    await minimized.click();
    await browser.waitUntil(() => readSettings().start_minimized_on_autostart === true, {
      timeout: 5000,
      timeoutMsg: "start_minimized_on_autostart was not restored",
    });
  });

  it("explains and re-enables an entry the system turned off", async () => {
    disableEntryInSystemSettings();
    await openSettings();

    const note = await $("p*=Turned off in your system");
    await note.waitForExist({ timeout: 5000 });
    const autostart = await autostartCheckbox();
    expect(await autostart.isSelected()).toBe(false);

    await autostart.click();
    await browser.waitUntil(() => !hasSystemSettingsOverride(), {
      timeout: 10000,
      timeoutMsg: "system settings override was not cleared",
    });
    await waitForSelected(autostart, true);
    await note.waitForExist({ reverse: true, timeout: 5000 });
  });

  it("removes the OS entry when disabled", async () => {
    await openSettings();
    const autostart = await autostartCheckbox();
    await waitForSelected(autostart, true);

    await autostart.click();
    await browser.waitUntil(() => readEntryCommand() === null, {
      timeout: 10000,
      timeoutMsg: "autostart entry was not removed",
    });
    await waitForSelected(autostart, false);
  });

  it("reflects an entry removed outside Grimoire", async () => {
    await openSettings();
    await (await autostartCheckbox()).click();
    await browser.waitUntil(() => readEntryCommand() !== null, { timeout: 10000 });

    removeEntry();
    await openSettings();
    // The page starts unchecked before the status loads, so give the OS read
    // time to (incorrectly) flip it back on before asserting.
    await browser.pause(1000);
    expect(await (await autostartCheckbox()).isSelected()).toBe(false);
  });
});
