// WebdriverIO config for Grimoire E2E tests.
//
// This bypasses `tauri-driver` (which in v2.0.5 does not reliably launch
// non-Edge binaries under modern `msedgedriver`) and instead:
//
//   1. Starts a mock MMOUI server on a random port so the app's catalog/
//      install flows hit local fixtures, never the real ESOUI API.
//   2. Starts a tiny static file server on port 5173 that serves the Vite
//      build output (`dist/`). A debug `grimoire.exe` loads its frontend
//      from the `devUrl` in tauri.conf.json, which is `http://localhost:5173`.
//   3. Launches grimoire.exe directly, with
//      `WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=9222`
//      set in its environment so the embedded WebView2 exposes a Chrome
//      DevTools Protocol endpoint we can attach to.
//   4. Spawns `msedgedriver` and tells it — via
//      `ms:edgeOptions.debuggerAddress` — to attach to the already-running
//      WebView2 instead of launching a new browser.
//
// GRIMOIRE_DATA_DIR / GRIMOIRE_CONFIG_DIR point at a per-run temp dir so
// the real user's catalog.db / settings.json / AddOns folder are untouched.
//
// Linux note: this file is currently Windows-only. Linux support would use
// WebKitGTK + WebKitWebDriver (a different attach model) and is left as a
// follow-up; see docs/phase3-plan.md.

import { spawn } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { start as startMockServer } from "./e2e/mock-server.mjs";
import { start as startStaticServer } from "./e2e/static-server.mjs";

const isWindows = process.platform === "win32";

if (!isWindows) {
  throw new Error(
    "wdio.conf.mjs currently only supports Windows. Linux support via WebKitWebDriver is a planned follow-up."
  );
}

const binaryPath = resolve(
  "src-tauri",
  "target",
  "debug",
  "grimoire.exe"
);
const distDir = resolve("dist");

const DEBUGGER_HOST = "127.0.0.1";
const DEBUGGER_PORT = 9222;
const STATIC_SERVER_PORT = 5173; // must match tauri.conf.json devUrl
const MSEDGE_DRIVER_PORT = 4444;

// Module-level state shared between onPrepare and onComplete.
let tempDir = null;
let addonsDir = null;
let mockServer = null;
let staticServer = null;
let grimoireProc = null;
let msedgedriverProc = null;
let msedgedriverPath = null;

async function waitForPort(host, port, timeoutMs, label) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`http://${host}:${port}/json/version`, {
        signal: AbortSignal.timeout(500),
      });
      if (res.ok) return;
    } catch {
      // not ready yet
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error(`${label} did not become ready on ${host}:${port} within ${timeoutMs}ms`);
}

async function waitForDriverPort(host, port, timeoutMs) {
  // msedgedriver responds with HTML on / until a session is active; just
  // wait for the TCP port to accept connections.
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`http://${host}:${port}/status`, {
        signal: AbortSignal.timeout(500),
      });
      if (res.ok) return;
    } catch {
      // not ready yet
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error(`msedgedriver did not become ready on ${host}:${port} within ${timeoutMs}ms`);
}

async function ensureMsedgedriver() {
  const mod = await import("edgedriver");
  const p = await mod.download();
  if (!existsSync(p)) {
    throw new Error(`edgedriver.download() returned a non-existent path: ${p}`);
  }
  return p;
}

export const config = {
  runner: "local",

  specs: ["./e2e/**/*.test.mjs"],
  exclude: [
    "./e2e/mock-server.mjs",
    "./e2e/static-server.mjs",
  ],

  maxInstances: 1,

  capabilities: [
    {
      maxInstances: 1,
      browserName: "MicrosoftEdge",
      // Force classic WebDriver. wdio v9 defaults to BiDi, which in this
      // attach-via-debuggerAddress setup creates its own about:blank context
      // instead of attaching to the real grimoire page target.
      "wdio:enforceWebDriverClassic": true,
      webSocketUrl: false,
      "ms:edgeOptions": {
        // Attach to the already-running grimoire WebView2 via its CDP port.
        debuggerAddress: `${DEBUGGER_HOST}:${DEBUGGER_PORT}`,
        w3c: true,
      },
    },
  ],

  logLevel: "warn",
  bail: 0,
  waitforTimeout: 10000,
  connectionRetryTimeout: 120000,
  connectionRetryCount: 3,

  hostname: DEBUGGER_HOST,
  port: MSEDGE_DRIVER_PORT,

  framework: "mocha",
  reporters: ["spec"],
  mochaOpts: {
    ui: "bdd",
    timeout: 120000,
  },

  //
  // Lifecycle hooks
  //

  onPrepare: async function () {
    // Kill any stragglers from a previous crashed run so port 5173 / 9222 /
    // 4444 are free. Best-effort; failures are ignored.
    try {
      const { spawnSync } = await import("node:child_process");
      spawnSync("taskkill", ["/F", "/IM", "grimoire.exe"], { stdio: "ignore" });
      spawnSync("taskkill", ["/F", "/IM", "msedgedriver.exe"], { stdio: "ignore" });
    } catch {
      // ignore
    }

    if (!existsSync(binaryPath)) {
      throw new Error(
        `Grimoire binary not found at ${binaryPath}. Run \`cargo build\` inside src-tauri/ first.`
      );
    }
    if (!existsSync(distDir) || !existsSync(join(distDir, "index.html"))) {
      throw new Error(
        `Frontend build not found at ${distDir}. Run \`npm run build\` first.`
      );
    }

    msedgedriverPath = await ensureMsedgedriver();

    // Fresh temp dir for this run — holds settings.json, catalog.db, AddOns/
    tempDir = mkdtempSync(join(tmpdir(), "grimoire-e2e-"));
    addonsDir = join(tempDir, "AddOns");
    mkdirSync(addonsDir, { recursive: true });

    // Pre-seed settings.json so the app starts with addon_path already set
    // to our temp AddOns dir. This sidesteps having to drive the native
    // folder picker from inside the tests.
    const settings = {
      addon_path: addonsDir,
      sync_interval_hours: 24,
      staleness_warning_days: 180,
      staleness_error_days: 365,
      hide_staleness_warnings: false,
    };
    writeFileSync(
      join(tempDir, "settings.json"),
      JSON.stringify(settings, null, 2),
      "utf-8"
    );

    mockServer = await startMockServer(0);
    staticServer = await startStaticServer(STATIC_SERVER_PORT, distDir);

    console.log(`[e2e] temp dir:       ${tempDir}`);
    console.log(`[e2e] addons dir:     ${addonsDir}`);
    console.log(`[e2e] mock MMOUI:     ${mockServer.baseUrl}`);
    console.log(`[e2e] static server:  ${staticServer.url}`);
    console.log(`[e2e] msedgedriver:   ${msedgedriverPath}`);

    // Launch grimoire with CDP enabled. The env here is inherited by
    // grimoire, so GRIMOIRE_* overrides take effect and point at the temp
    // dir + mock server.
    const grimoireEnv = {
      ...process.env,
      WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${DEBUGGER_PORT} --remote-debugging-address=${DEBUGGER_HOST}`,
      GRIMOIRE_API_BASE_URL: mockServer.globalConfigUrl,
      GRIMOIRE_DATA_DIR: tempDir,
      GRIMOIRE_CONFIG_DIR: tempDir,
    };

    grimoireProc = spawn(binaryPath, [], {
      stdio: ["ignore", "inherit", "inherit"],
      env: grimoireEnv,
    });
    grimoireProc.on("exit", (code, signal) => {
      if (code !== 0 && code !== null) {
        console.error(`[e2e] grimoire exited with code ${code}, signal ${signal}`);
      }
    });

    // Wait for WebView2's CDP endpoint to come up before starting the driver.
    await waitForPort(DEBUGGER_HOST, DEBUGGER_PORT, 20000, "grimoire WebView2 debugger");
    console.log(`[e2e] grimoire CDP ready at ${DEBUGGER_HOST}:${DEBUGGER_PORT}`);

    msedgedriverProc = spawn(
      msedgedriverPath,
      [`--port=${MSEDGE_DRIVER_PORT}`, `--host=${DEBUGGER_HOST}`],
      {
        stdio: ["ignore", "inherit", "inherit"],
      }
    );
    msedgedriverProc.on("exit", (code, signal) => {
      if (code !== 0 && code !== null) {
        console.error(`[e2e] msedgedriver exited with code ${code}, signal ${signal}`);
      }
    });

    await waitForDriverPort(DEBUGGER_HOST, MSEDGE_DRIVER_PORT, 20000);
    console.log(`[e2e] msedgedriver ready on ${DEBUGGER_HOST}:${MSEDGE_DRIVER_PORT}`);
  },

  onComplete: async function () {
    if (msedgedriverProc) {
      try { msedgedriverProc.kill(); } catch { /* ignore */ }
      msedgedriverProc = null;
    }
    if (grimoireProc) {
      try { grimoireProc.kill(); } catch { /* ignore */ }
      grimoireProc = null;
    }
    // Also force-kill any stragglers. Tauri apps on Windows sometimes hang
    // around after SIGTERM because of their tray-icon / CloseRequested hook.
    try {
      const { spawnSync } = await import("node:child_process");
      spawnSync("taskkill", ["/F", "/IM", "grimoire.exe"], { stdio: "ignore" });
      spawnSync("taskkill", ["/F", "/IM", "msedgedriver.exe"], { stdio: "ignore" });
    } catch {
      // ignore
    }

    if (staticServer) {
      try { await staticServer.close(); } catch { /* ignore */ }
      staticServer = null;
    }
    if (mockServer) {
      try { await mockServer.close(); } catch { /* ignore */ }
      mockServer = null;
    }
    if (tempDir) {
      try {
        rmSync(tempDir, { recursive: true, force: true });
      } catch {
        // Windows sometimes holds file locks briefly — best-effort cleanup.
      }
      tempDir = null;
    }
  },
};
