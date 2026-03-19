# Linked SLA Alerts

A Jira Cloud app that **notifies linked tickets of SLA status and expiry**. Use the **Send SLA Alert to Linked Tickets** panel to send this issue’s SLA (status and expiration date) to linked tickets—post a comment and @mention assignees, with optional Slack delivery and clickable links.

Built by **TechCache**, Linked SLA Alerts helps support and operational teams keep linked work in sync: when an issue has an SLA, relay it to linked tickets so assignees are advised without needing access to the host project.

The app runs entirely on Atlassian Forge, meaning all processing happens inside Atlassian infrastructure with no external servers required.

## Features

• **Send SLA Alert to Linked Tickets panel** — Notify linked tickets of this issue’s SLA status and expiry  
• **Send to linked tickets** — Post a comment on each linked ticket with status (At-Risk, Breached, in range), date of expiration, and @mention assignees  
• **Optional Slack** — Same message to a Slack channel with clickable links to the posted tickets  
• **Send to all or specific tickets** — Choose all linked tickets or list which keys to notify  
• **Alerts** when a linked issue’s SLA becomes at risk or breached (configurable notifications on the parent issue)  
• **Admin configuration** — Trigger conditions, who to notify, Jira comments, Slack webhook or Bot token, custom templates  

## Installation (Developer Setup)

The Forge app lives in the **`sla-link-inspector/`** subdirectory. All commands below must be run from that directory.

**Clone the repository and go into the app directory:**

```bash
git clone https://github.com/TechCache/sla-link-inspector.git
cd sla-link-inspector/sla-link-inspector
```

**Install dependencies:**

```bash
npm install
```

**Bundle the frontend** (required before deploy):

```bash
npm run build
```

**Deploy the Forge app**

Forge keeps separate builds per **environment**. Plain `forge deploy` (no `-e`) targets **Development** by default, so your production Jira site will not see those builds until you deploy to **Production** and use the Production install link.

| Goal | Command |
|------|---------|
| **Production** (live sites, Marketplace) | `npm run deploy` or `npm run deploy:production` or `forge deploy -e production` |
| **Development** (testing) | `npm run deploy:dev` or `forge deploy -e development` |

**Install the app on a Jira site**

Use an install link from the same environment you deployed to (Developer Console → your app → **Production** or **Development** → Get install link). Or:

```bash
forge install --environment production
# or
forge install --environment development
```

If the app was installed from **Development** but you deployed only to **Production**, Jira will still run the old Development build—reinstall or upgrade using the **Production** install link after `forge deploy -e production`.

## Usage

1. Open a Jira issue that contains linked tickets.
2. Locate the **Linked SLA Alerts** panel in the issue view.
3. Review the SLA status of linked issues in the table.
4. Use **Show SLA Details** to post contextual SLA timing information in the issue comments.

Administrators can configure notification triggers and integrations from **Jira Admin → Manage Apps → Linked SLA Alerts** settings page.

## Who it’s for

**The panel only shows SLA for linked issues in projects the viewer can already see in Jira.** We don’t bypass permissions: if you don’t have access to a linked issue’s project, that row will show “Error loading.” Grant at least **browse** access to the other project if you want the panel to display those SLAs. The app cannot show SLAs for queues or projects you have no access to.

## Privacy & Security

Linked SLA Alerts runs entirely on Atlassian Forge infrastructure. The app does not store customer issue data outside Atlassian systems. Configuration settings are stored within Forge storage.

### Slack DMs and Jira Email API

To send Slack DMs by matching Jira users to Slack members, the app needs each user’s **email**. The app uses **supported Jira Cloud REST APIs** (as the Forge app):

1. **`GET /rest/api/3/user/email`** and **`GET /rest/api/3/user/email/bulk`** — scope **`read:email-address:jira`**
2. **`GET /rest/api/3/user/bulk`** — scope **`read:jira-user`** (response `values[]` may include `emailAddress` per Atlassian’s docs)
3. **`GET /rest/api/3/user`** — same scope; may 404 or omit email when visibility differs from the endpoints above
4. **`emailAddress` on assignee/reporter/watchers** from **`GET /rest/api/3/issue/...`** on the linked issue, then the parent

**Marketplace / partner checklist:** see **`sla-link-inspector/docs/MARKETPLACE-SLACK-DM.md`** (approval process, QA, and disclosure).

**After upgrading to a build that adds email scopes:** a Jira **site admin** must **accept the new permission** (re-consent) on that site—typically **Jira settings → Apps → Manage your apps → Linked SLA Alerts → Update / Review permissions**, or reinstall the app.

**If Forge logs show** `Slack DM skipped — no email for Jira user` **or** `GET /user/email` **403**: the Email API is blocked until an admin approves **`read:email-address:jira`**. Use the detailed **`[SLA Link Inspector] Jira email for Slack DM`** lines in logs (status code and body snippet).

**If logs show `GET /user/email/bulk` with `bodySnippet=[]`:** Jira returned **no unrestricted email rows** for that account. That is controlled by **Atlassian account privacy**, **site membership**, and **org policy**—the app cannot override it. **Always notify these emails** in app settings is an optional way to include fixed addresses in addition to Jira-derived recipients.

See Atlassian’s [Profile visibility and apps](https://developer.atlassian.com/cloud/jira/platform/profile-visibility/), [Get user email](https://developer.atlassian.com/cloud/jira/platform/rest/v3/api-group-users/#api-rest-api-3-user-email-get), and [Get bulk users](https://developer.atlassian.com/cloud/jira/platform/rest/v3/api-group-users/#api-rest-api-3-user-bulk-get).

See the full [privacy policy](https://techcache.github.io/privacy).

## Support

For support or questions: **techcache@proton.me**

## License

MIT License
