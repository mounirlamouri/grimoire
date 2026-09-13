// WebdriverIO config for Grimoire E2E tests — cross-platform (Windows + Linux).
//
// Windows (WebView2 / msedgedriver):
//   1. Starts a mock MMOUI server on a random port.
//   2. Starts a static file server on port 5173 (serves dist/ to the debug binary).
//   3. Launches grimoire.exe directly with WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS
//      so the embedded WebView2 exposes a CDP endpoint on port 9222. In CI the
//      same arguments are also written to the per-app HKLM WebView2
//      AdditionalBrowserArguments policy (removed in onComplete): GitHub runners
//      run elevated, and WebView2 Runtime 150+ ignores the environment variable
//      (and HKCU policy) for elevated host processes.
//   4. Spawns msedgedriver matching the installed WebView2 runtime (which can
//      differ from the Edge browser version) and attaches it via
//      ms:edgeOptions.debuggerAddress.
//
// Linux (WebKitGTK / tauri-driver):
//   1. Starts the same mock and static servers.
//   2. Spawns tauri-driver (from ~/.cargo/bin/tauri-driver) which manages
//      WebKitWebDriver and launches the grimoire binary itself via the
//      tauri:options.application capability. Env vars are set on the
//      tauri-driver process so they propagate to the app.
//
// GRIMOIRE_DATA_DIR / GRIMOIRE_CONFIG_DIR point at a per-run temp dir so
// the real user's catalog.db / settings.json / AddOns folder are untouched.

import { spawn, spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { start as startMockServer } from "./e2e/mock-server.mjs";
import { start as startStaticServer } from "./e2e/static-server.mjs";

const isWindows = process.platform === "win32";
const isLinux = process.platform === "linux";

if (!isWindows && !isLinux) {
  throw new Error(
    `wdio.conf.mjs supports Windows and Linux only (got: ${process.platform}).`
  );
}

const binaryPath = resolve(
  "src-tauri",
  "target",
  "debug",
  isWindows ? "grimoire.exe" : "grimoire"
);
const distDir = resolve("dist");

const DEBUGGER_HOST = "127.0.0.1";
const DEBUGGER_PORT = 9222;       // Windows CDP port
const DRIVER_PORT = 4444;         // msedgedriver (Windows) or tauri-driver (Linux)
const STATIC_SERVER_PORT = 5173;  // must match tauri.conf.json devUrl
// WebView2 can be slow to open its CDP port on a cold CI runner. Override with
// GRIMOIRE_E2E_CDP_TIMEOUT_MS (a tiny value forces the diagnostics path).
const CDP_TIMEOUT_MS = Number(process.env.GRIMOIRE_E2E_CDP_TIMEOUT_MS) || 60000;

const WEBVIEW2_ARGS = `--remote-debugging-port=${DEBUGGER_PORT} --remote-debugging-address=${DEBUGGER_HOST}`;
// EdgeUpdate client ID of the Evergreen WebView2 runtime.
const WEBVIEW2_CLIENT_GUID = "{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}";
// Since WebView2 Runtime 150, an elevated host process ignores
// WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS and HKCU policy; only HKLM policy and
// API-supplied arguments are honored (by design, see
// https://github.com/MicrosoftEdge/WebView2Feedback/issues/5640). Writing HKLM
// requires admin, which CI runners have. Value names are app IDs; never use
// "*", or every WebView2 app on the machine would try to claim the port.
const WEBVIEW2_ARGS_POLICY_KEY =
  "HKLM\\Software\\Policies\\Microsoft\\Edge\\WebView2\\AdditionalBrowserArguments";
const WEBVIEW2_ARGS_POLICY_APP_ID = "grimoire.exe";

// Module-level state shared between lifecycle hooks.
let tempDir = null;
let addonsDir = null;
let mockServer = null;
let staticServer = null;
// Windows
let grimoireProc = null;
let grimoireExit = null;
let webview2PolicySet = false;
let msedgedriverProc = null;
let msedgedriverPath = null;
// Linux
let tauriDriverProc = null;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function waitForCdpPort(host, port, timeoutMs) {
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
  throw new Error(
    `Grimoire WebView2 debugger did not become ready on ${host}:${port} within ${timeoutMs}ms`
  );
}

async function waitForDriverStatus(host, port, timeoutMs, label) {
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
  throw new Error(
    `${label} did not become ready on ${host}:${port} within ${timeoutMs}ms`
  );
}

// Returns the REG_SZ data of `valueName` under `key`, or null if absent.
function regQueryValue(key, valueName) {
  const result = spawnSync("reg", ["query", key, "/v", valueName], { encoding: "utf-8" });
  if (result.status !== 0) return null;
  for (const line of result.stdout.split(/\r?\n/)) {
    const idx = line.indexOf("REG_SZ");
    if (idx !== -1 && line.trim().startsWith(valueName)) {
      return line.slice(idx + "REG_SZ".length).trim();
    }
  }
  return null;
}

// Version of the WebView2 runtime grimoire.exe runs on, or null if not found.
function getWebView2RuntimeVersion() {
  const keys = [
    `HKLM\\SOFTWARE\\WOW6432Node\\Microsoft\\EdgeUpdate\\Clients\\${WEBVIEW2_CLIENT_GUID}`,
    `HKLM\\SOFTWARE\\Microsoft\\EdgeUpdate\\Clients\\${WEBVIEW2_CLIENT_GUID}`,
    `HKCU\\Software\\Microsoft\\EdgeUpdate\\Clients\\${WEBVIEW2_CLIENT_GUID}`,
  ];
  for (const key of keys) {
    const version = regQueryValue(key, "pv");
    if (version && version !== "0.0.0.0") return version;
  }
  return null;
}

function setWebView2ArgsPolicy() {
  const result = spawnSync(
    "reg",
    ["add", WEBVIEW2_ARGS_POLICY_KEY, "/v", WEBVIEW2_ARGS_POLICY_APP_ID, "/t", "REG_SZ", "/d", WEBVIEW2_ARGS, "/f"],
    { encoding: "utf-8" }
  );
  if (result.status !== 0) {
    console.error(
      `[e2e] failed to set WebView2 args policy: ${result.error?.message ?? result.stderr.trim()}`
    );
    return;
  }
  webview2PolicySet = true;
  console.log(
    `[e2e] WebView2 args policy: ${WEBVIEW2_ARGS_POLICY_KEY} ${WEBVIEW2_ARGS_POLICY_APP_ID} = ${WEBVIEW2_ARGS}`
  );
}

function removeWebView2ArgsPolicy() {
  if (!webview2PolicySet) return;
  spawnSync(
    "reg",
    ["delete", WEBVIEW2_ARGS_POLICY_KEY, "/v", WEBVIEW2_ARGS_POLICY_APP_ID, "/f"],
    { stdio: "ignore" }
  );
  webview2PolicySet = false;
}

// Logs why the WebView2 CDP port may not have opened: whether grimoire is
// still alive, which WebView2 runtime is installed, whether WebView2 browser
// processes were spawned (and with which arguments), and what owns port 9222.
function logWindowsCdpDiagnostics() {
  console.error("[e2e] ---- WebView2 CDP diagnostics ----");
  console.error(
    `[e2e] grimoire pid ${grimoireProc?.pid ?? "n/a"}: ` +
      (grimoireExit
        ? `exited (code ${grimoireExit.code}, signal ${grimoireExit.signal})`
        : "still running")
  );

  const script = String.raw`
$ErrorActionPreference = 'SilentlyContinue'
$guid = '{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}'
$keys = @(
  "HKLM:\SOFTWARE\WOW6432Node\Microsoft\EdgeUpdate\Clients\$guid",
  "HKLM:\SOFTWARE\Microsoft\EdgeUpdate\Clients\$guid",
  "HKCU:\Software\Microsoft\EdgeUpdate\Clients\$guid"
)
foreach ($k in $keys) {
  $pv = (Get-ItemProperty -Path $k).pv
  if ($pv) { "WebView2 runtime: $pv ($k)" } else { "WebView2 runtime: not found ($k)" }
}
$gpid = [int]$env:GRIMOIRE_PID
$procs = @(Get-CimInstance Win32_Process -Filter "Name='msedgewebview2.exe'")
$browsers = @($procs | Where-Object { $_.ParentProcessId -eq $gpid -and $_.CommandLine -notmatch '--type=' })
"msedgewebview2.exe processes: " + $procs.Count + " total, " + $browsers.Count + " browser process(es) started by grimoire"
foreach ($p in $browsers) {
  $cl = [string]$p.CommandLine
  if ($cl.Length -gt 600) { $cl = $cl.Substring(0, 600) + '...' }
  "browser process " + $p.ProcessId + " (parent " + $p.ParentProcessId + "): " + $cl
}
foreach ($root in @('HKLM', 'HKCU')) {
  $pol = Get-ItemProperty -Path "$($root):\Software\Policies\Microsoft\Edge\WebView2\AdditionalBrowserArguments"
  $vals = @($pol.PSObject.Properties | Where-Object { $_.Name -notlike 'PS*' } | ForEach-Object { $_.Name + ' = ' + $_.Value })
  if ($vals.Count -eq 0) { "WebView2 args policy ($root): not set" } else { "WebView2 args policy ($root): " + ($vals -join '; ') }
}
$listeners = @(Get-NetTCPConnection -LocalPort 9222 -State Listen)
if ($listeners.Count -eq 0) { "port 9222: nothing listening" }
foreach ($l in $listeners) { "port 9222: listening on " + $l.LocalAddress + " by pid " + $l.OwningProcess }
`;

  const result = spawnSync(
    "powershell.exe",
    ["-NoProfile", "-NonInteractive", "-Command", script],
    {
      encoding: "utf-8",
      timeout: 30000,
      env: { ...process.env, GRIMOIRE_PID: String(grimoireProc?.pid ?? 0) },
    }
  );
  if (result.error) {
    console.error(`[e2e] diagnostics script failed: ${result.error.message}`);
  }
  for (const line of `${result.stdout ?? ""}${result.stderr ?? ""}`.split(/\r?\n/)) {
    if (line.trim()) console.error(`[e2e]   ${line}`);
  }
  console.error("[e2e] ----------------------------------");
}

// msedgedriver must match the WebView2 runtime it attaches to, not the Edge
// browser that edgedriver detects by default (runner images ship them at
// different versions). edgedriver reuses any msedgedriver.exe already in its
// cache dir regardless of version, so cache each version separately.
async function ensureMsedgedriver() {
  const mod = await import("edgedriver");
  const webview2Version = getWebView2RuntimeVersion();
  console.log(`[e2e] WebView2 runtime: ${webview2Version ?? "not found, using Edge browser version"}`);
  const p = webview2Version
    ? await mod.download(
        webview2Version,
        join(tmpdir(), "grimoire-e2e-msedgedriver", webview2Version)
      )
    : await mod.download();
  if (!existsSync(p)) {
    throw new Error(`edgedriver.download() returned a non-existent path: ${p}`);
  }
  return p;
}

function killStaleProcesses() {
  if (isWindows) {
    spawnSync("taskkill", ["/F", "/IM", "grimoire.exe"], { stdio: "ignore" });
    spawnSync("taskkill", ["/F", "/IM", "msedgedriver.exe"], { stdio: "ignore" });
  } else {
    spawnSync("pkill", ["-f", "target/debug/grimoire"], { stdio: "ignore" });
    spawnSync("pkill", ["-f", "tauri-driver"], { stdio: "ignore" });
    spawnSync("pkill", ["-f", "WebKitWebDriver"], { stdio: "ignore" });
  }
}

// ---------------------------------------------------------------------------
// Capabilities (platform-specific)
// ---------------------------------------------------------------------------

const capabilities = isWindows
  ? [
      {
        maxInstances: 1,
        browserName: "MicrosoftEdge",
        // Force classic WebDriver. wdio v9 defaults to BiDi, which in this
        // attach-via-debuggerAddress setup creates its own about:blank context
        // instead of attaching to the real grimoire page target.
        "wdio:enforceWebDriverClassic": true,
        webSocketUrl: false,
        "ms:edgeOptions": {
          debuggerAddress: `${DEBUGGER_HOST}:${DEBUGGER_PORT}`,
          w3c: true,
        },
      },
    ]
  : [
      {
        maxInstances: 1,
        "tauri:options": {
          application: resolve("src-tauri", "target", "debug", "grimoire"),
        },
      },
    ];

// ---------------------------------------------------------------------------
// Exported wdio config
// ---------------------------------------------------------------------------

export const config = {
  runner: "local",

  specs: ["./e2e/**/*.test.mjs"],
  exclude: [
    "./e2e/mock-server.mjs",
    "./e2e/static-server.mjs",
  ],

  maxInstances: 1,

  capabilities,

  logLevel: "warn",
  bail: 0,
  waitforTimeout: 10000,
  connectionRetryTimeout: 120000,
  connectionRetryCount: 3,

  hostname: DEBUGGER_HOST,
  port: DRIVER_PORT,

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
    // Kill any stragglers from a previous crashed run so ports are free.
    // Best-effort; failures are ignored.
    try { killStaleProcesses(); } catch { /* ignore */ }

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

    if (isWindows) {
      msedgedriverPath = await ensureMsedgedriver();
    }

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

    // Expose paths to tests via env (wdio workers inherit parent env).
    process.env.GRIMOIRE_E2E_TEMP_DIR = tempDir;
    process.env.GRIMOIRE_E2E_ADDONS_DIR = addonsDir;

    console.log(`[e2e] temp dir:       ${tempDir}`);
    console.log(`[e2e] addons dir:     ${addonsDir}`);
    console.log(`[e2e] mock MMOUI:     ${mockServer.baseUrl}`);
    console.log(`[e2e] static server:  ${staticServer.url}`);

    if (isWindows) {
      console.log(`[e2e] msedgedriver:   ${msedgedriverPath}`);

      // Launch grimoire with CDP enabled.
      const grimoireEnv = {
        ...process.env,
        WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: WEBVIEW2_ARGS,
        GRIMOIRE_API_BASE_URL: mockServer.globalConfigUrl,
        GRIMOIRE_DATA_DIR: tempDir,
        GRIMOIRE_CONFIG_DIR: tempDir,
      };
      // Only in CI: the policy enables remote debugging for every grimoire.exe
      // launch until it is removed, which must never linger on a dev machine.
      if (process.env.CI) {
        setWebView2ArgsPolicy();
      }

      const launchedAt = Date.now();
      grimoireExit = null;
      grimoireProc = spawn(binaryPath, [], {
        stdio: ["ignore", "inherit", "inherit"],
        env: grimoireEnv,
      });
      grimoireProc.on("error", (err) => {
        console.error(`[e2e] failed to launch grimoire: ${err.message}`);
      });
      grimoireProc.on("exit", (code, signal) => {
        grimoireExit = { code, signal };
        if (code !== 0 && code !== null) {
          console.error(`[e2e] grimoire exited with code ${code}, signal ${signal}`);
        }
      });

      try {
        await waitForCdpPort(DEBUGGER_HOST, DEBUGGER_PORT, CDP_TIMEOUT_MS);
      } catch (err) {
        logWindowsCdpDiagnostics();
        throw err;
      }
      console.log(
        `[e2e] grimoire CDP ready at ${DEBUGGER_HOST}:${DEBUGGER_PORT} after ${Date.now() - launchedAt}ms`
      );

      msedgedriverProc = spawn(
        msedgedriverPath,
        [`--port=${DRIVER_PORT}`, `--host=${DEBUGGER_HOST}`],
        { stdio: ["ignore", "inherit", "inherit"] }
      );
      msedgedriverProc.on("exit", (code, signal) => {
        if (code !== 0 && code !== null) {
          console.error(`[e2e] msedgedriver exited with code ${code}, signal ${signal}`);
        }
      });

      await waitForDriverStatus(DEBUGGER_HOST, DRIVER_PORT, 20000, "msedgedriver");
      console.log(`[e2e] msedgedriver ready on ${DEBUGGER_HOST}:${DRIVER_PORT}`);
    }

    if (isLinux) {
      // Spawn tauri-driver, which manages WebKitWebDriver and launches the
      // grimoire binary when wdio creates a WebDriver session.
      //
      // Unlike Windows (where we pass env vars via the grimoireProc spawn
      // object), here we set them directly on process.env. tauri-driver
      // inherits process.env and passes it through to WebKitWebDriver and
      // then to the grimoire app. Using a spawn `env` option alone was not
      // enough — the vars didn't reach the app in practice.
      const tauriDriverPath = join(homedir(), ".cargo", "bin", "tauri-driver");
      if (!existsSync(tauriDriverPath)) {
        throw new Error(
          `tauri-driver not found at ${tauriDriverPath}. Run \`cargo install tauri-driver --locked\`.`
        );
      }

      process.env.GRIMOIRE_API_BASE_URL = mockServer.globalConfigUrl;
      process.env.GRIMOIRE_DATA_DIR = tempDir;
      process.env.GRIMOIRE_CONFIG_DIR = tempDir;

      tauriDriverProc = spawn(tauriDriverPath, [], {
        stdio: ["ignore", "inherit", "inherit"],
      });
      tauriDriverProc.on("exit", (code, signal) => {
        if (code !== 0 && code !== null) {
          console.error(`[e2e] tauri-driver exited with code ${code}, signal ${signal}`);
        }
      });

      await waitForDriverStatus(DEBUGGER_HOST, DRIVER_PORT, 20000, "tauri-driver");
      console.log(`[e2e] tauri-driver ready on ${DEBUGGER_HOST}:${DRIVER_PORT}`);
    }
  },

  onComplete: async function () {
    if (isWindows) {
      if (msedgedriverProc) {
        try { msedgedriverProc.kill(); } catch { /* ignore */ }
        msedgedriverProc = null;
      }
      if (grimoireProc) {
        try { grimoireProc.kill(); } catch { /* ignore */ }
        grimoireProc = null;
      }
      removeWebView2ArgsPolicy();
    } else {
      if (tauriDriverProc) {
        try { tauriDriverProc.kill(); } catch { /* ignore */ }
        tauriDriverProc = null;
      }
    }

    // Force-kill any stragglers regardless of platform.
    try { killStaleProcesses(); } catch { /* ignore */ }

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
        // file locks can briefly linger on Windows — best-effort cleanup
      }
      tempDir = null;
    }
  },
};
