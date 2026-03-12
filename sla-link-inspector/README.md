# SLA Link Inspector (Forge app)

For installation, features, and usage, see the [root README](../README.md).

This directory contains the Forge app. Below is developer-focused reference.

## Build and deploy

1. **Install dependencies** (if you haven’t already):
   ```bash
   npm install
   ```

2. **Bundle the frontend** (required so `@forge/bridge` is resolved in Custom UI):
   ```bash
   npm run build
   ```
   This writes `src/frontend/build/main.js`. The panel loads this bundle instead of the raw module.

3. **Deploy:**
   ```bash
   forge deploy
   ```
   Run `npm run build` before every deploy so the panel has the latest bundle.

## Development

- **Resolver:** `src/resolvers/resolver.js` — `getLinkedIssueSlas` uses Jira REST API (issue links + SLA field).
- **Frontend:** `src/frontend/` — Custom UI (HTML/CSS/JS). Entry is `index.html`, which loads `build/main.js` (generated) and `style.css`.
- **Manifest:** `manifest.yml` — `jira:issuePanel` resource points at `src/frontend`.

## Panel behavior

- Uses standard Jira **issue links** (REST `issuelinks`). “Linked work items” in Jira may come from a different source and are not included.
- Finds an SLA custom field by name (e.g. containing “SLA”) and shows status (breached / at risk / within / no SLA) for each linked issue.
