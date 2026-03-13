# Marketplace licensing (Linked SLA Alerts)

This doc describes how licensing is implemented for the paid Marketplace listing and where to change behavior.

## Stack / runtime (from this repo)

- **Runtime:** `nodejs20.x` (see `manifest.yml`).
- **Resolver:** `src/resolvers/resolver.js` — single handler for all resolver functions (issue panel + admin page).
- **Frontend:** Custom UI in `src/frontend/` (HTML/JS/CSS), loaded as `sla-ui-v2`. Admin UI in `src/admin/`.
- **App ID:** Set in `manifest.yml` as `app.id` (ARI). After transfer to the vendor/briefcase space, this may change; re-deploy and re-list on Marketplace.

## How Forge licensing works here

- **Backend:** `getAppContext()` from `@forge/api` returns an object that includes an optional `license` field.
- **When `license` is present:** Only for **paid** apps in the **PRODUCTION** environment. It includes `isActive`, `billingPeriod`, `capabilitySet`, etc.
- **When `license` is undefined:** Free apps, DEVELOPMENT, STAGING, and apps not listed on the Marketplace. Your app should treat that as “no paid license” in production and “allowed” in dev/staging.

So:

- **Licensed** = not in production **or** (in production and `license?.isActive === true`).
- **Unlicensed (paid enforcement)** = in production and (`license == null` or `license.isActive !== true`).

## Where license checks are implemented

1. **Resolver**
   - **`getLicenseStatus`**  
     New resolver method that calls `getAppContext()`, derives `licensed` and optional `reason`, and returns `{ licensed, reason?, isProduction? }` for the UI.
   - **`getLinkedIssueSlas`**  
     Calls the license helper and appends `licenseStatus: { licensed, reason? }` to the response so the issue panel can show an upgrade banner or restrict actions.
   - **`getAdminConfig`**  
     Same: appends `licenseStatus` to the returned config so the admin page can show “Upgrade to use” or disable saving.
   - **Optional enforcement:** In `setAdminConfig`, `warnAssigneeSlaDates`, `testSlackWebhook`, you can check the same helper and return `{ ok: false, error: 'A valid license is required. Please upgrade from the Marketplace.' }` when `licensed === false` in production. Right now the code only *reports* license status; it does not block.

2. **Frontend (issue panel)**  
   - After `invoke('getLinkedIssueSlas', ...)`, read `result.licenseStatus`. If `licensed === false`, show a short message (e.g. “Upgrade to a paid license to use Linked SLA Alerts”) and optionally hide or disable the table / “Show SLA Details”.

3. **Admin UI**  
   - `getAdminConfig` now returns `licenseStatus: { licensed, reason?, isProduction? }`. In `admin.js` `load()`, after `payloadToForm(config)`, if `config.licenseStatus?.licensed === false`, show a banner (e.g. above the form) with `config.licenseStatus.reason` and optionally disable “Save settings” and “Test Slack”.

## Support URL and app metadata

- **Support URL / vendor profile:** Set in the **Atlassian Developer Console** (developer.atlassian.com) under the **vendor** (briefcase “Tech Cache”) space, not in the app manifest.
- **Listing text, screenshots, pricing:** Set in **Atlassian Marketplace** (marketplace.atlassian.com) when you create or edit the listing and attach the app from the vendor space.
- **App name / description in Jira:** The `title` in `manifest.yml` for `jira:issuePanel` and `jira:adminPage` controls what users see in the Jira UI (“Linked SLA Alerts”). Marketplace listing name can be different but is usually the same.

## After app transfer

Once the app is moved to the vendor (briefcase) space:

1. Re-deploy from this repo so the correct `app.id` (if it changed) is in use.
2. In Marketplace, ensure the listing points at the app in the **vendor** environment.
3. Confirm the paid listing and pricing; Forge will then inject `license` in production for paying installations.
4. Test in DEVELOPMENT/STAGING (license will be undefined; app should still work) and in a production site with a paid/trial license (license should be present and `isActive: true`).

## References

- [Forge: Licensing overview](https://developer.atlassian.com/platform/forge/licensing-overview/)
- [Forge: getAppContext (license object)](https://developer.atlassian.com/platform/forge/runtime-reference/app-context-api/)
- [Marketplace: Cloud app licensing](https://developer.atlassian.com/platform/marketplace/cloud-app-licensing/)
