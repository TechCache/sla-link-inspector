# Linked SLA Alerts

This repository contains the source code for the **SLA Link Inspector** Atlassian Forge app maintained by **Tech Cache**.

A Jira Cloud app that notifies linked tickets of SLA status and expiry. Use the **Send SLA Alert to Linked Tickets** panel to send an issue's SLA status and expiration date to linked tickets, post a comment, mention assignees, and optionally deliver the same message to Slack with clickable links.

Built by **Tech Cache**, Linked SLA Alerts helps support and operational teams keep linked work in sync. When an issue has an SLA, the app relays that context to linked tickets so assignees are informed without needing access to the host project.

The app runs entirely on **Atlassian Forge**, meaning core processing happens inside Atlassian infrastructure. Tech Cache does not operate separate long-lived application servers for that core logic.

**Customer-facing legal & support:**

- [Terms of Service](https://techcache.github.io/terms)
- [Privacy Policy](https://techcache.github.io/privacy)
- [Legal & Trust](https://techcache.github.io/legal/)
- Support: **techcache@proton.me** · [Support & security](https://techcache.github.io/support)

---

## Repository

This is a public repository for the app's source code and supporting documentation. The app is distributed to customers through the **Atlassian Marketplace** under Tech Cache's **Terms** and **Privacy Policy**.

---

## Features

- **Send SLA Alert to Linked Tickets panel**: Notify linked tickets of this issue's SLA status and expiry
- **Send to linked tickets**: Post a comment on each linked ticket with status, expiration date, and assignee mentions
- **Optional Slack delivery**: Send the same message to Slack with clickable links to the posted tickets
- **Send to all or specific tickets**: Choose all linked tickets or specify which keys to notify
- **Configurable SLA-driven notifications**: When someone opens the **Linked SLA Alerts** panel on the parent issue, the app evaluates SLA state and can post on linked tickets, send Slack/email/DMs, and run time-left threshold alerts. There is no separate Forge background scheduler in this app. See `sla-link-inspector/docs/WHEN-ALERTS-RUN.md`.
- **Admin configuration**: Trigger conditions, recipients, Jira comments, Slack webhook or bot token, and custom templates

---

## Installation (developers)

The Forge app lives in the **`sla-link-inspector/`** subdirectory. Run commands from that directory.

```bash
cd sla-link-inspector
npm install
npm run build
```

**Deploy** (Forge uses separate environments):

| Goal | Command |
|------|---------|
| **Production** (Marketplace) | `npm run deploy` / `npm run deploy:production` / `forge deploy -e production` |
| **Development** | `npm run deploy:dev` / `forge deploy -e development` |

Install on a Jira site using the install link from the Atlassian Developer Console for the matching environment, or `forge install --environment production`.

---

## Usage

1. Open a Jira issue that contains linked tickets.
2. Locate the **Linked SLA Alerts** panel in the issue view. Opening the panel loads data and is when configurable automatic notifications are evaluated. See `sla-link-inspector/docs/WHEN-ALERTS-RUN.md`.
3. Review SLA context for linked issues.
4. Use **Send SLA Alert** and related actions as needed.

Administrators configure triggers and integrations from **Jira Admin -> Manage Apps -> Linked SLA Alerts**.

---

## Who It's For

The panel only shows data for linked issues in projects the viewer can already see in Jira. The app does not bypass Jira permissions.

---

## Privacy & Security

Linked SLA Alerts runs on **Forge**. Configuration is stored in **Forge app storage**. Optional Slack and webhook integrations send data only to endpoints the customer configures.

### Slack DMs and Jira email APIs

To match Jira users to Slack for DMs, the app may use email from **Jira Cloud REST APIs** where the declared scopes and Atlassian settings allow it. Admins can also map **Jira accountId -> Slack member ID** so DMs work without email for mapped users.

**Partner notes:** `sla-link-inspector/docs/MARKETPLACE-SLACK-DM.md`

**Full policy:** [Privacy Policy](https://techcache.github.io/privacy)

---

## Support

**techcache@proton.me** · [Support & security](https://techcache.github.io/support)

---

## License

This project is **commercial software**. The Forge app remains **`UNLICENSED`** in `sla-link-inspector/package.json`, and the source code is not offered for open-source redistribution.

This project is proprietary software. All rights reserved. The source code is provided for transparency and collaboration but is not licensed for redistribution or reuse without permission.
