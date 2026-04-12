// Minimal static file server for E2E tests. Serves Grimoire's built
// frontend (`dist/`) on a fixed port so the debug grimoire binary — which
// loads from `devUrl: http://localhost:5173` per tauri.conf.json — has
// something to render.
//
// Usage:
//   import { start } from "./static-server.mjs";
//   const s = await start(5173, "./dist");
//   ...
//   await s.close();

import http from "node:http";
import { readFile, stat } from "node:fs/promises";
import { resolve, join, extname } from "node:path";

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

export async function start(port, rootDir) {
  const absRoot = resolve(rootDir);
  return new Promise((resolveStart, reject) => {
    const server = http.createServer(async (req, res) => {
      try {
        // Strip query string
        const rawPath = (req.url || "/").split("?")[0];
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
          const fallback = join(absRoot, "index.html");
          const buf = await readFile(fallback);
          res.writeHead(200, {
            "Content-Type": "text/html; charset=utf-8",
            "Content-Length": buf.length,
          });
          res.end(buf);
          return;
        }

        if (info.isDirectory()) {
          const indexFile = join(filePath, "index.html");
          const buf = await readFile(indexFile);
          res.writeHead(200, {
            "Content-Type": "text/html; charset=utf-8",
            "Content-Length": buf.length,
          });
          res.end(buf);
          return;
        }

        const buf = await readFile(filePath);
        res.writeHead(200, {
          "Content-Type": contentType(filePath),
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
