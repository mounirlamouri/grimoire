# Grimoire

A cross-platform addon manager for Elder Scrolls Online, built with Tauri + React + Rust.

Grimoire is an open-source replacement for Minion, offering addon installation, updates, and dependency management for Windows and Linux.

[![CI](https://github.com/mounirlamouri/grimoire/actions/workflows/ci.yml/badge.svg)](https://github.com/mounirlamouri/grimoire/actions/workflows/ci.yml)
![GPLv3 License](https://img.shields.io/badge/license-GPLv3-blue.svg)

## Features

- **Browse & search** the full ESOUI addon catalog, with descriptions and screenshots
- **Install addons** from the catalog or an ESOUI link, with automatic dependency resolution
- **Update detection** based on ESOUI release dates, with one-click "Update All"
- **Missing dependency detection** with a one-click fix
- **Outdated addon warnings** for addons not updated in a long time or targeting an old game API version
- **Uninstall** addons cleanly
- **Export/import addon lists** — share your setup via clipboard or paste.rs link
- **Orphaned library detection** — find and remove unused shared libraries
- **Auto-detect ESO addon path** on Windows and Linux (Wine, Steam/Proton, Flatpak)
- **Launch at login** and keep running in the system tray
- **Offline catalog cache** via SQLite — browse and search without repeated API calls
- **Native look & feel** — lightweight desktop app, not an Electron wrapper

## Installation

### Pre-built binaries

Download the latest release from the [Releases](https://github.com/mounirlamouri/grimoire/releases) page:

- **Windows**: `.msi` or `-setup.exe` installer
- **Linux**: `.deb`, `.rpm`, or `.AppImage`

### Build from source

**Prerequisites**: [Rust](https://rustup.rs/), [Node.js](https://nodejs.org/) (v18+), and the [Tauri prerequisites](https://v2.tauri.app/start/prerequisites/) for your platform.

```bash
# Clone the repo
git clone https://github.com/mounirlamouri/grimoire.git
cd grimoire

# Install frontend dependencies
npm install --legacy-peer-deps

# Run in development mode (hot-reload)
cargo tauri dev

# Build for production
cargo tauri build
```

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Backend | Rust (Tauri v2) |
| Frontend | React + TypeScript + Tailwind CSS v4 |
| HTTP | reqwest |
| Database | SQLite (rusqlite) |
| Packaging | Tauri bundler |

## Architecture

```
src-tauri/src/
├── commands/       # Tauri IPC commands (addons, catalog, install, settings, sharing, updates)
├── esoui/          # MMOUI v3 API client and response models
├── addon/          # Manifest parser and ZIP installer
├── resolver/       # Missing dependency detection
├── config/         # Addon path detection, settings, launch at login
└── db/             # SQLite catalog cache and installed version tracking

src/
├── pages/          # InstalledPage, BrowsePage, SettingsPage
├── components/     # AddonCard, CatalogCard, ErrorOverlay, etc.
├── hooks/          # Shared React hooks
├── utils/          # Pure helpers (dates, staleness, API compatibility)
└── types/          # TypeScript type definitions

e2e/                # End-to-end tests against a mock ESOUI API
```

## Data Source

Grimoire uses the [MMOUI v3 API](https://api.mmoui.com/v3/globalconfig.json) to fetch the ESOUI addon catalog. No HTML scraping — the same API that other addon managers use.

## Testing

```bash
# Rust unit and integration tests
cd src-tauri && cargo test

# Live API tests (requires network)
cd src-tauri && cargo test -- --ignored

# Frontend tests
npm test

# End-to-end tests (builds the frontend and the debug app first)
npm run build && npm run test:e2e:build
```

## ESO Addon Path

Grimoire auto-detects your ESO AddOns folder:

| Platform | Path |
|----------|------|
| Windows | `Documents\Elder Scrolls Online\live\AddOns\` |
| Linux (Wine) | `~/.wine/drive_c/users/<user>/Documents/Elder Scrolls Online/live/AddOns/` |
| Linux (Steam) | `~/.steam/steam/steamapps/compatdata/306130/pfx/.../AddOns/` |
| Linux (Flatpak) | `~/.var/app/com.valvesoftware.Steam/.steam/.../AddOns/` |

You can also set the path manually via the Settings page.

## License

[GPLv3](LICENSE)
