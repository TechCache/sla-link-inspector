# SLA Link Inspector

A Jira Cloud app that displays the SLA status of linked Jira issues directly within the issue view, helping teams detect upstream risks before SLAs breach.

Built by **TechCache**, SLA Link Inspector helps support and operational teams monitor dependencies across projects and stay ahead of SLA failures.

The app runs entirely on Atlassian Forge, meaning all processing happens inside Atlassian infrastructure with no external servers required.

## Features

• **Displays SLA status** for linked Jira issues directly in the issue panel  
• **Color-coded SLA indicators** (breached, at risk, within SLA)  
• **Automatically alerts teams** when linked issue SLAs become at risk or breached  
• **Configurable notification recipients:** Assignee, Reporter, Watchers, additional users  
• **Optional integrations:** Jira comments, Jira @mentions, Slack webhooks, email/webhook integrations  
• **Customizable notification templates** using variables: `{{issueKey}}`, `{{slaName}}`, `{{remainingTime}}`, `{{status}}`, `{{assignee}}`  
• **Admin configuration panel** for trigger conditions, escalation rules, notification routing, and custom message templates  
• **"Show SLA Details"** button that posts contextual SLA timing information directly to the issue comments  

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
2. Locate the **SLA Link Inspector** panel in the issue view.
3. Review the SLA status of linked issues in the table.
4. Use **Show SLA Details** to post contextual SLA timing information in the issue comments.

Administrators can configure notification triggers and integrations from **Jira Admin → Manage Apps → SLA Link Inspector** settings page.

## Privacy & Security

SLA Link Inspector runs entirely on Atlassian Forge infrastructure. The app does not store customer issue data outside Atlassian systems. Configuration settings are stored within Forge storage.

See the full [privacy policy](https://techcache.github.io/privacy).

## Support

For support or questions: **techcache@proton.me**

## License

MIT License
