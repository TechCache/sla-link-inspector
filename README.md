# Linked SLA Alerts

A Jira Cloud app that **notifies linked tickets of SLA status and expiry**. Use the **Send SLA Alert to Linked Tickets** panel to send this issue’s SLA (status and expiration date) to linked tickets—post a comment and @mention assignees, with optional Slack delivery and clickable links.

Built by **TechCache**, Linked SLA Alerts helps support and operational teams keep linked work in sync: when an issue has an SLA, relay it to linked tickets so assignees are advised without needing access to the host project.

The app runs entirely on Atlassian Forge, meaning all processing happens inside Atlassian infrastructure with no external servers required.

## Features

• **Send SLA Alert to Linked Tickets panel** — Notify linked tickets of this issue’s SLA status and expiry  
• **Send to linked tickets** — Post a comment on each linked ticket with status (At-Risk, Breached, In SLA range), date of expiration, and @mention assignees  
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

**Deploy the Forge app:**

```bash
forge deploy
```

**Install the app to your Jira site:**

```bash
forge install
```

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

See the full [privacy policy](https://techcache.github.io/privacy).

## Support

For support or questions: **techcache@proton.me**

## License

MIT License
