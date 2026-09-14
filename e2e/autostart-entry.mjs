// Reads and edits the OS launch-at-login entry Grimoire registers, so E2E
// tests can check it without going through the app. wdio.conf.mjs sets
// GRIMOIRE_AUTOSTART_NAME to ENTRY_NAME, so the user's real "grimoire" entry
// is never touched.

import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { isAbsolute, join } from "node:path";

export const ENTRY_NAME = "grimoire-e2e";

const isWindows = process.platform === "win32";

const RUN_KEY = "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run";
const APPROVED_KEY =
  "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\StartupApproved\\Run";
// What Task Manager writes when an entry is disabled: flag 0x03 + FILETIME.
const TASK_MANAGER_DISABLED = "030000000000000000000000";

function desktopFilePath() {
  const xdg = process.env.XDG_CONFIG_HOME;
  const configDir = xdg && isAbsolute(xdg) ? xdg : join(homedir(), ".config");
  return join(configDir, "autostart", `${ENTRY_NAME}.desktop`);
}

// Returns the data column of `valueName` under `key`, or null if absent.
function regQuery(key, valueName, type) {
  const result = spawnSync("reg", ["query", key, "/v", valueName], { encoding: "utf-8" });
  if (result.status !== 0) return null;
  for (const line of result.stdout.split(/\r?\n/)) {
    const idx = line.indexOf(type);
    if (idx !== -1 && line.trim().startsWith(valueName)) {
      return line.slice(idx + type.length).trim();
    }
  }
  return null;
}

/** The registered launch command (Run value or Exec= line), or null if none. */
export function readEntryCommand() {
  if (isWindows) {
    return regQuery(RUN_KEY, ENTRY_NAME, "REG_SZ");
  }
  const path = desktopFilePath();
  if (!existsSync(path)) return null;
  const exec = readFileSync(path, "utf-8")
    .split(/\r?\n/)
    .find((line) => line.startsWith("Exec="));
  return exec ? exec.slice("Exec=".length) : "";
}

/** Simulates the user turning the entry off in Task Manager / GNOME Tweaks. */
export function disableEntryInSystemSettings() {
  if (isWindows) {
    const result = spawnSync(
      "reg",
      ["add", APPROVED_KEY, "/v", ENTRY_NAME, "/t", "REG_BINARY", "/d", TASK_MANAGER_DISABLED, "/f"],
      { encoding: "utf-8" }
    );
    if (result.status !== 0) {
      throw new Error(`reg add failed: ${result.stderr}`);
    }
    return;
  }
  const path = desktopFilePath();
  const contents = readFileSync(path, "utf-8").replace(
    "X-GNOME-Autostart-enabled=true",
    "X-GNOME-Autostart-enabled=false"
  );
  writeFileSync(path, contents, "utf-8");
}

/** Whether the system-settings override from disableEntryInSystemSettings() is present. */
export function hasSystemSettingsOverride() {
  if (isWindows) {
    return regQuery(APPROVED_KEY, ENTRY_NAME, "REG_BINARY") !== null;
  }
  const path = desktopFilePath();
  return existsSync(path) && readFileSync(path, "utf-8").includes("X-GNOME-Autostart-enabled=false");
}

/** Removes the entry (and Task Manager override) as if deleted outside Grimoire. */
export function removeEntry() {
  if (isWindows) {
    for (const key of [RUN_KEY, APPROVED_KEY]) {
      spawnSync("reg", ["delete", key, "/v", ENTRY_NAME, "/f"], { stdio: "ignore" });
    }
    return;
  }
  rmSync(desktopFilePath(), { force: true });
}
