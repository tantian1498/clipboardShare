# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
# Development
npm start          # Standalone server on port 3846
npm run electron   # Electron app (requires npm install first)
npm run agent      # Standalone CLI sync agent

# Build — must temporarily disable electron_mirror in .npmrc before building
npm run build:mac  # macOS DMG (electron-builder --mac)
npm run build:win  # Windows x64 NSIS installer (electron-builder --win --x64)

# Build workaround (dmg-builder 404 fix):
cp .npmrc .npmrc.bak && sed 's/^electron_mirror/#&/' .npmrc.bak > .npmrc && npx electron-builder --mac; cp .npmrc.bak .npmrc && rm .npmrc.bak

# Push to GitHub (SSH on port 443 due to network):
GIT_SSH_COMMAND="ssh -p 443 -o ProxyCommand=none" git push origin main

# Release:
gh release create vX.Y.Z dist/ClipboardShare-*.dmg dist/ClipboardShare-*.exe --title "vX.Y.Z" --notes "..."
# Or use scripts/release.sh for automated version bump + tag + release

# Sync server to production:
scp server.js root@8.148.7.250:/www/clipboardShare/server.js
ssh root@8.148.7.250 "cd /www/clipboardShare && pm2 restart clipboard-share"
```

## Code Style

**ES5 syntax only** — no arrow functions, no optional chaining (`?.`), no nullish coalescing (`??`). Use `function() {}`, manual null checks, and `||` fallbacks.

## Architecture

Two deployment modes sharing the same sync protocol:

### Standalone Server (`server.js`)
Express server on `0.0.0.0:3846`. Serves web UI from `public/`, REST API at `/api/*`. History persisted to `history.json`.

### Electron App (`electron/`)
- **main.js** — Window/tray lifecycle, IPC handlers, coordinates sync engine + embedded server
- **server-embed.js** — Same API as `server.js`, runs inside Electron. History at `~/.clipboard-share/server-history.json`
- **sync-engine.js** — EventEmitter, polls clipboard (500ms) and server (1000ms), device ID: `platform-randomHex`
- **preload.js** — Exposes `window.clipboardAPI` to renderer via contextBridge
- **renderer/** — UI: history list with batch select/delete, settings panel, search/filter

### Sync Protocol
State: `{ type, data, version, lastUpdater, deleteVersion }`
- Content changes increment `version`, other devices detect via `/api/sync?since=N` polling
- Deletions increment `deleteVersion`, clients detect change and reload full history from `/api/history`
- `lastUpdater` (device ID) prevents echo loops
- Image sync via base64 PNG, lazy-loaded in history cards

### Dual Server Pattern
`server.js` (standalone) and `electron/server-embed.js` (embedded) must be kept in sync — same API routes, same history schema. When modifying server endpoints, update both files.

## Build Note

`.npmrc` sets `electron_mirror` to npmmirror for fast Electron binary downloads in China, but this overrides dmg-builder's GitHub download URL causing 404. Temporarily comment out `electron_mirror` before building Mac DMG, then restore it.
