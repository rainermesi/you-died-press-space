# AGENTS.md

## Cursor Cloud specific instructions

**Product:** "Rebirth Odds" — a single static web app. The entire app (HTML, CSS, JS, and data) lives in `index.html`. There is no backend, database, build step, package manager, lint config, or test suite.

**Run (dev):** Serve the repo root over HTTP, e.g. `python3 -m http.server 8080`, then open `http://localhost:8080/index.html`. `python3` is preinstalled; there are no dependencies to install.

**Network requirement (non-obvious):** The map and libraries are loaded at runtime from the jsdelivr CDN (`d3@7`, `topojson-client@3`, `world-atlas@2/countries-110m.json`). Outbound HTTPS to `cdn.jsdelivr.net` is required or the world map and rebirth logic will not render. Opening via `file://` is unreliable; always serve over HTTP.

**Build / test / lint:** None are configured in the repo.
