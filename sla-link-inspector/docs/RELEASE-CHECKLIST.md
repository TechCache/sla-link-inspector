# Release checklist (Linked SLA Alerts)

Run before **Marketplace** or major **production** deploy. Tick boxes in your process; adjust for your test sites.

## Build & config

- [ ] `LICENSE_CHECK_BYPASS` is **`false`** in `src/resolvers/resolver.js` (never ship production with `true`).
- [ ] `npm run build` succeeds; `src/frontend/index.html` references `build/main.js` (cache-bust updated by script).
- [ ] `npm run lint` (fix or document exceptions).
- [ ] `package.json` **version** matches what you want users/Marketplace to see (panel shows **Version · v…** from bundle).

## Deploy

- [ ] `forge deploy -e production` (or your target env) from `sla-link-inspector/` after build.
- [ ] Install link / site uses the **same** app id + environment you deployed.

## Licensing (production)

- [ ] **Licensed** site: panel loads, **Send SLA Alert** works, admin **Save** and Slack tests work.
- [ ] **Unlicensed / expired** (or no entitlement): upgrade messaging, restricted actions match expectation.
- [ ] **Development** install still works without Marketplace license.

## Issue panel & SLA

- [ ] Parent with **no** links: empty state, send disabled.
- [ ] Parent with **links**: SLA summary, linked rows, permissions (issues in projects user cannot see).
- [ ] **JSM** request SLA site (if you support it): scope `read:request.sla:jira-service-management` exercised.
- [ ] **Send all** vs **Only these** + validation when nothing selected.

## When alerts run (see `WHEN-ALERTS-RUN.md`)

- [ ] **At risk / breached** path: open panel on parent with configured triggers; comment/Slack behavior and **KVS dedupe** behave as expected.
- [ ] **Time-left thresholds**: enabled row(s), correct unit/recipient mode; dedupe key prevents spam on repeat panel opens.

## Admin UI

- [ ] Save/load: triggers, recipients, templates, Slack (webhook / bot / DM), email list, Jira→Slack map, **Slack IDs admin-only** toggle.
- [ ] **Test Slack** webhook and DM (with valid token).
- [ ] **Slack mapping** disclosure: loads collapsed; save still works.

## Issue panel — Slack ID

- [ ] Self-service link/save/remove (signed-in user’s account).
- [ ] Admin-mapped + **admin-only** modes: copy and disabled controls.

## External

- [ ] **`manifest.yml` `icon`** URL loads signed out (`https://techcache.github.io/assets/icon.png` or current public URL).
- [ ] Listing **scopes** and **Privacy** copy match `manifest.yml` and live policy URLs.

## Partner / listing (outside this repo)

- [ ] Marketplace listing, screenshots, support URL, security questionnaire — per **Atlassian Partner** / **website** process.
