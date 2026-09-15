// Minimal static file server for E2E tests. Serves Grimoire's built
// frontend (`dist/`) on a fixed port so the debug grimoire binary — which
// loads from `devUrl: http://localhost:5173` per tauri.conf.json — has
// something to render.
//
// Tauri only applies `app.security.csp` to bundled assets, so a debug build
// loading devUrl would otherwise run without a CSP. When `csp` is passed, HTML
// responses carry that policy plus a report-uri, and violation reports are
// kept for e2e/csp.test.mjs:
//   POST /__csp-report   <- the webview posts violation reports here
//   GET  /__csp-reports  -> JSON array of the reports received so far
//
// Usage:
//   import { start, cspFromTauriConfig } from "./static-server.mjs";
//   const s = await start(5173, "./dist", { csp: cspFromTauriConfig() });
//   ...
//   await s.close();

import http from "node:http";
import { readFileSync } from "node:fs";
import { readFile, stat } from "node:fs/promises";
import { resolve, join, extname } from "node:path";

export const CSP_REPORT_PATH = "/__csp-report";
export const CSP_REPORTS_PATH = "/__csp-reports";

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".mjs": "application/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".map": "application/json; charset=utf-8",
};

function contentType(path) {
  return MIME[extname(path).toLowerCase()] || "application/octet-stream";
}

// Returns `app.security.csp` from tauri.conf.json as a policy string. Tauri
// accepts either a string or a map of directive -> sources (string or array).
export function cspFromTauriConfig(
  configPath = resolve("src-tauri", "tauri.conf.json")
) {
  const config = JSON.parse(readFileSync(configPath, "utf-8"));
  const csp = config.app?.security?.csp;
  if (!csp) {
    throw new Error(`No app.security.csp in ${configPath}`);
  }
  if (typeof csp === "string") return csp;
  return Object.entries(csp)
    .map(([directive, sources]) =>
      `${directive} ${Array.isArray(sources) ? sources.join(" ") : sources}`
    )
    .join("; ");
}

export async function start(port, rootDir, { csp } = {}) {
  const absRoot = resolve(rootDir);
  const cspReports = [];

  function sendHtml(res, buf) {
    const headers = {
      "Content-Type": "text/html; charset=utf-8",
      "Content-Length": buf.length,
    };
    if (csp) {
      headers["Content-Security-Policy"] = `${csp}; report-uri ${CSP_REPORT_PATH}`;
    }
    res.writeHead(200, headers);
    res.end(buf);
  }

  return new Promise((resolveStart, reject) => {
    const server = http.createServer(async (req, res) => {
      try {
        // Strip query string
        const rawPath = (req.url || "/").split("?")[0];

        if (req.method === "POST" && rawPath === CSP_REPORT_PATH) {
          const chunks = [];
          for await (const chunk of req) chunks.push(chunk);
          const body = Buffer.concat(chunks).toString("utf-8");
          try {
            cspReports.push(JSON.parse(body));
          } catch {
            cspReports.push({ raw: body });
          }
          res.writeHead(204);
          res.end();
          return;
        }

        if (rawPath === CSP_REPORTS_PATH) {
          const payload = JSON.stringify(cspReports);
          res.writeHead(200, {
            "Content-Type": "application/json; charset=utf-8",
            "Content-Length": Buffer.byteLength(payload),
          });
          res.end(payload);
          return;
        }

        let relPath = decodeURIComponent(rawPath);
        if (relPath === "/" || relPath === "") relPath = "/index.html";

        // Resolve and ensure we stay under the root (basic path-traversal guard).
        const filePath = resolve(join(absRoot, relPath));
        if (!filePath.startsWith(absRoot)) {
          res.writeHead(403);
          res.end("forbidden");
          return;
        }

        let info;
        try {
          info = await stat(filePath);
        } catch {
          // SPA fallback: if the requested file doesn't exist, serve index.html
          // so client-side routing still works. (Grimoire doesn't currently use
          // routing, but this makes the server well-behaved.)
          sendHtml(res, await readFile(join(absRoot, "index.html")));
          return;
        }

        if (info.isDirectory()) {
          sendHtml(res, await readFile(join(filePath, "index.html")));
          return;
        }

        const buf = await readFile(filePath);
        const type = contentType(filePath);
        if (type.startsWith("text/html")) {
          sendHtml(res, buf);
          return;
        }
        res.writeHead(200, {
          "Content-Type": type,
          "Content-Length": buf.length,
        });
        res.end(buf);
      } catch (err) {
        res.writeHead(500);
        res.end(`server error: ${err.message}`);
      }
    });

    server.on("error", reject);
    server.listen(port, "127.0.0.1", () => {
      const actualPort = server.address().port;
      resolveStart({
        port: actualPort,
        url: `http://127.0.0.1:${actualPort}`,
        close: () =>
          new Promise((r) => {
            server.close(() => r());
          }),
      });
    });
  });
}
