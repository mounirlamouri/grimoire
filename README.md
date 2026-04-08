# Grimoire

A cross-platform addon manager for Elder Scrolls Online, built with Tauri + React + Rust.

Grimoire is an open-source replacement for Minion, offering addon installation, updates, and dependency management for Windows and Linux.

[![CI](https://github.com/mounirlamouri/grimoire/actions/workflows/ci.yml/badge.svg)](https://github.com/mounirlamouri/grimoire/actions/workflows/ci.yml)
![GPLv3 License](https://img.shields.io/badge/license-GPLv3-blue.svg)

## Features

- **Browse & search** the full ESOUI addon catalog
- **Install addons** with automatic dependency resolution
- **Update detection** against the MMOUI catalog, with version mismatch handling
- **Uninstall** addons cleanly
- **Export/import addon lists** — share your setup via clipboard or paste.rs link
- **Orphaned library detection** — find and remove unused shared libraries
- **Auto-detect ESO addon path** on Windows, Linux (Wine, Steam/Proton, Flatpak)
- **Offline catalog cache** via SQLite — browse and search without repeated API calls
- **Native look & feel** — lightweight desktop app, not an Electron wrapper

## Screenshots

<!-- TODO: add screenshots -->

## Installation

### Pre-built binaries

Download the latest release from the [Releases](https://github.com/mounirlamouri/grimoire/releases) page:

- **Windows**: `.msi` installer or portable `.exe`
- **Linux**: `.deb` package or `.AppImage`

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
| Packaging | Tauri bundler (.msi/.exe, .deb/.AppImage) |

## Architecture

```
src-tauri/src/
├── commands/       # Tauri IPC commands (addons, catalog, install, settings, sharing, updates)
├── esoui/          # MMOUI v3 API client and response models
├── addon/          # Manifest parser and ZIP installer
├── resolver/       # Dependency resolver (topological sort)
├── config/         # Addon path detection and persistent settings
└── db/             # SQLite catalog cache and installed version tracking

src/
├── pages/          # InstalledPage, BrowsePage, SettingsPage
├── components/     # AddonCard, CatalogCard, ErrorOverlay, etc.
└── types/          # TypeScript type definitions
```

## Data Source

Grimoire uses the [MMOUI v3 API](https://api.mmoui.com/v3/globalconfig.json) to fetch the ESOUI addon catalog. No HTML scraping — the same API that other addon managers use.

## Testing

```bash
# Run all Rust tests (117 tests across all modules)
cd src-tauri && cargo test

# Run live API integration tests (requires network)
cd src-tauri && cargo test -- --ignored
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
