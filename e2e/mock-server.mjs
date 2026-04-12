// Mock MMOUI server for Grimoire E2E tests.
//
// Exposes a tiny HTTP server that mimics the shape of the real MMOUI v3 API:
//   GET /globalconfig.json   -> JSON pointing at /gameconfig.json
//   GET /gameconfig.json     -> JSON pointing at /filelist.json and /filedetails/
//   GET /filelist.json       -> array of fixture addons
//   GET /filedetails/<uid>.json -> per-addon details
//   GET /downloads/<uid>.zip -> ZIP built on the fly with adm-zip, containing a
//                               valid ESO addon manifest + a trivial Lua file
//
// Usage:
//   import { start } from "./mock-server.mjs";
//   const server = await start(0);          // port 0 = auto-assign
//   console.log(server.baseUrl, server.globalConfigUrl);
//   await server.close();

import http from "node:http";
import AdmZip from "adm-zip";

// Fixture addons used by all E2E tests.
// - MockLib: a library, no deps
// - MockAddon: a regular addon that depends on MockLib
// - MockStandalone: a regular addon with no deps
export const FIXTURE_ADDONS = [
  {
    uid: "1001",
    name: "MockLib",
    dirName: "MockLib",
    version: "1.0",
    author: "E2E Mock",
    isLibrary: true,
    deps: [],
  },
  {
    uid: "1002",
    name: "MockAddon",
    dirName: "MockAddon",
    version: "1.0",
    author: "E2E Mock",
    isLibrary: false,
    deps: ["MockLib"],
  },
  {
    uid: "1003",
    name: "MockStandalone",
    dirName: "MockStandalone",
    version: "1.0",
    author: "E2E Mock",
    isLibrary: false,
    deps: [],
  },
];

function buildAddonZip(dirName, title, deps = []) {
  const zip = new AdmZip();
  const dependsLine = deps.length ? `## DependsOn: ${deps.join(" ")}\n` : "";
  // Manifest format: https://wiki.esoui.com/AddOn_manifest_(.txt)_format
  const manifest =
    `## Title: ${title}\n` +
    `## Author: E2E Mock\n` +
    `## Version: 1.0\n` +
    `## APIVersion: 101047\n` +
    dependsLine +
    `${dirName}.lua\n`;
  zip.addFile(`${dirName}/${dirName}.txt`, Buffer.from(manifest, "utf-8"));
  zip.addFile(
    `${dirName}/${dirName}.lua`,
    Buffer.from("-- mock addon\n", "utf-8")
  );
  return zip.toBuffer();
}

function findAddonByUid(uid) {
  return FIXTURE_ADDONS.find((a) => a.uid === uid);
}

function buildFileList(baseUrl) {
  // Shape matches MMOUI v3 filelist.json entries (see CLAUDE.md "Actual API response format").
  // `is_library` is derived server-side from `UICATID == "53"` (Libraries category),
  // so we set that rather than inventing a boolean field.
  const nowMs = Date.now();
  return FIXTURE_ADDONS.map((a) => ({
    UID: a.uid,
    UIName: a.name,
    UIVersion: a.version,
    UIDir: [a.dirName],
    UIDate: nowMs,
    UIDownloadTotal: "100",
    UIFavoriteTotal: "10",
    UIDownloadMonthly: "10",
    UIAuthorName: a.author,
    UICompatibility: [{ version: "101047", name: "Update 47" }],
    UIFileInfoURL: `${baseUrl}/fileinfo/${a.uid}.html`,
    UICATID: a.isLibrary ? "53" : "12",
    UISiblings: null,
    UIDonationLink: null,
    UIIMG_Thumbs: [],
    UIIMGs: [],
  }));
}

function buildAddonDetails(uid, baseUrl) {
  const addon = findAddonByUid(uid);
  if (!addon) return null;
  return [
    {
      UID: addon.uid,
      UIName: addon.name,
      UIVersion: addon.version,
      // AddonDetails.ui_dir is a plain string, not an array — the details
      // endpoint has a different shape from filelist.json.
      UIDir: addon.dirName,
      UIDownload: `${baseUrl}/downloads/${addon.uid}.zip`,
      UIAuthorName: addon.author,
      UIDescription: `Mock addon ${addon.name} for E2E tests`,
    },
  ];
}

function jsonResponse(res, status, body) {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(payload),
  });
  res.end(payload);
}

function notFound(res) {
  res.writeHead(404, { "Content-Type": "text/plain" });
  res.end("not found");
}

export async function start(port = 0) {
  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      // baseUrl is computed per-request so tests see the real assigned port.
      const baseUrl = `http://127.0.0.1:${server.address().port}`;
      const url = req.url || "/";

      if (req.method !== "GET") {
        res.writeHead(405);
        res.end();
        return;
      }

      if (url === "/globalconfig.json") {
        jsonResponse(res, 200, {
          GAMES: [
            {
              GameID: "ESO",
              GameConfig: `${baseUrl}/gameconfig.json`,
            },
          ],
        });
        return;
      }

      if (url === "/gameconfig.json") {
        jsonResponse(res, 200, {
          APIFeeds: {
            FileList: `${baseUrl}/filelist.json`,
            FileDetails: `${baseUrl}/filedetails/`,
            CategoryList: `${baseUrl}/categorylist.json`,
          },
        });
        return;
      }

      if (url === "/filelist.json") {
        jsonResponse(res, 200, buildFileList(baseUrl));
        return;
      }

      // /filedetails/<uid>.json
      const detailsMatch = url.match(/^\/filedetails\/([^\/]+)\.json$/);
      if (detailsMatch) {
        const details = buildAddonDetails(detailsMatch[1], baseUrl);
        if (!details) {
          notFound(res);
          return;
        }
        jsonResponse(res, 200, details);
        return;
      }

      // /downloads/<uid>.zip
      const downloadMatch = url.match(/^\/downloads\/([^\/]+)\.zip$/);
      if (downloadMatch) {
        const addon = findAddonByUid(downloadMatch[1]);
        if (!addon) {
          notFound(res);
          return;
        }
        const zipBuffer = buildAddonZip(addon.dirName, addon.name, addon.deps);
        res.writeHead(200, {
          "Content-Type": "application/zip",
          "Content-Length": zipBuffer.length,
        });
        res.end(zipBuffer);
        return;
      }

      notFound(res);
    });

    server.on("error", reject);
    server.listen(port, "127.0.0.1", () => {
      const actualPort = server.address().port;
      const baseUrl = `http://127.0.0.1:${actualPort}`;
      resolve({
        port: actualPort,
        baseUrl,
        globalConfigUrl: `${baseUrl}/globalconfig.json`,
        close: () =>
          new Promise((resolveClose) => {
            server.close(() => resolveClose());
          }),
      });
    });
  });
}

// If invoked directly (`node e2e/mock-server.mjs`), start on a fixed port for manual poking.
const invokedDirectly =
  typeof process.argv[1] === "string" &&
  import.meta.url === new URL(`file://${process.argv[1].replace(/\\/g, "/")}`).href;
if (invokedDirectly) {
  const port = Number(process.env.PORT) || 4321;
  start(port).then((s) => {
    console.log(`Mock MMOUI server listening at ${s.baseUrl}`);
    console.log(`Global config: ${s.globalConfigUrl}`);
  });
}
