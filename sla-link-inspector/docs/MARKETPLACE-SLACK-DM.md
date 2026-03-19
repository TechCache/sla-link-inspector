# Slack DMs & Marketplace readiness

Linked SLA Alerts matches **Jira users to Slack workspace members by email** (`users.lookupByEmail`), then opens an IM and posts the message. That requires obtaining a **work email address** for each Jira `accountId` through **supported Atlassian REST APIs only** (no scraping or unsupported behavior).

## Scopes in `manifest.yml`

| Scope | Role |
|--------|------|
| `read:email-address:jira` | `GET /rest/api/3/user/email` and `GET /rest/api/3/user/email/bulk` (dedicated email APIs). |
| `read:jira-user` | `GET /rest/api/3/user/bulk` and `GET /rest/api/3/user` — bulk user payloads may include `emailAddress` per [REST docs](https://developer.atlassian.com/cloud/jira/platform/rest/v3/api-group-users/#api-rest-api-3-user-bulk-get). |

Resolver order: `/user/email` → `/user/email/bulk` → **`/user/bulk`** → `/user`, then assignee/reporter/watchers on linked + parent issues.

## Atlassian approval for email access

For **Connect** apps, Atlassian documents that **`ACCESS_EMAIL_ADDRESSES`**-style access may require an approved use case before customers can install from Marketplace. See:

- [Guidelines for requesting access to email address](https://community.developer.atlassian.com/t/guidelines-for-requesting-access-to-email-address/27603) (Developer Community)
- [App installation failed due to ACCESS_EMAIL_ADDRESSES scope](https://support.atlassian.com/atlassian-cloud/kb/app-installation-failed-due-to-access_email_addresses-scope/) (support article)

Forge uses OAuth-style scopes (`read:email-address:jira`). **Before listing publicly**, confirm with Atlassian Partner / Marketplace review whether your app’s email use case needs explicit approval or additional disclosure. Keep your **privacy policy** and **Marketplace “data security” answers** aligned with: email is read only to address Slack DMs and is not stored for unrelated purposes.

## When APIs still return no email

Even with correct scopes and admin consent:

- **`GET /user/email/bulk` returning `[]`** means Jira chose not to return **unrestricted** email rows for that account (org policy, site membership, or end-user visibility rules).
- **`GET /user` returning 404** often masks “no permission” or an account not resolvable on that site.

Those outcomes are **platform-enforced**, not something an app can bypass while staying compliant. The app also reads `emailAddress` from **issue expand** (assignee/reporter/watchers) when Jira includes it there.

## Slack member ID mapping (fallback without Jira email)

When Jira does not return email for an `accountId`, the app can still DM if either:

1. **Admin map** — In settings, **Jira account ID → Slack member ID** (`U…` / `W…`), one per line (tab- or comma-separated).
2. **Self-service** — From the **issue panel**, each user can save their own Slack member ID (stored in Forge KVS). Admin entries **override** the same Jira `accountId`.

Delivery uses Slack **`conversations.open`** + **`chat.postMessage`**. Scopes: at minimum **`im:write`** and **`chat:write`**; **`users:read.email`** is only needed for recipients resolved by email.

## QA checklist before submission

1. Install on a **test site** where the assignee’s Atlassian account shares email with apps (see [Profile visibility and apps](https://developer.atlassian.com/cloud/jira/platform/profile-visibility/)), **or** map Slack member IDs for test users.
2. Confirm DMs arrive (email path and/or member-ID path).
3. Slack app: **`im:write`** and **`chat:write`** for all DMs; add **`users:read.email`** when using email lookup.
4. Document for customers: Slack **channel** posts need webhook or bot token + channel ID; **DMs** need bot token and either Jira-visible email **or** a Slack member ID mapping.
