# Linked SLA Alerts

A Jira Cloud app that **notifies linked tickets of SLA status and expiry**. Use the **Send SLA Alert to Linked Tickets** panel to send this issue’s SLA (status and expiration date) to linked tickets—post a comment and @mention assignees, with optional Slack delivery and clickable links.

Built by **Tech Cache**, Linked SLA Alerts helps support and operational teams keep linked work in sync: when an issue has an SLA, relay it to linked tickets so assignees are advised without needing access to the host project.

The app runs entirely on **Atlassian Forge**, meaning core processing happens inside **Atlassian** infrastructure. Tech Cache does **not** operate separate long-lived application servers for that core logic.

**Customer-facing legal & support:**

- [Terms of Service](https://techcache.github.io/terms)  
- [Privacy Policy](https://techcache.github.io/privacy)  
- [Legal & Trust](https://techcache.github.io/legal/)  
- Support: **techcache@proton.me** · [Support & security](https://techcache.github.io/support)

---

## Repository access

This repository is **private** and intended for **authorized Tech Cache contributors** only. **Linked SLA Alerts** is distributed to customers through the **Atlassian Marketplace** under Tech Cache’s **Terms** and **Privacy Policy**, not through public source distribution.

---

## Features

• **Send SLA Alert to Linked Tickets panel** — Notify linked tickets of this issue’s SLA status and expiry  
• **Send to linked tickets** — Post a comment on each linked ticket with status (At-Risk, Breached, in range), date of expiration, and @mention assignees  
• **Optional Slack** — Same message to a Slack channel with clickable links to the posted tickets  
• **Send to all or specific tickets** — Choose all linked tickets or list which keys to notify  
• **Configurable SLA-driven notifications** — When someone **opens the Linked SLA Alerts panel** on the **parent** issue, the app evaluates SLA state and (per admin rules) can post on **linked** tickets, send Slack/email/DMs, and run **time-left threshold** alerts. **There is no separate Forge background scheduler** in this app—activity is driven by that panel load (and manual **Send SLA Alert**). See `sla-link-inspector/docs/WHEN-ALERTS-RUN.md`.  
• **Admin configuration** — Trigger conditions, who to notify, Jira comments, Slack webhook or Bot token, custom templates  

---

## Installation (authorized developers)

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

Install on a Jira site using the **install link** from the Atlassian Developer Console for the matching environment, or `forge install --environment production`.

---

## Usage

1. Open a Jira issue that contains linked tickets.  
2. Locate the **Linked SLA Alerts** panel in the issue view (**opening the panel** loads data and is when configurable automatic notifications are evaluated—see `sla-link-inspector/docs/WHEN-ALERTS-RUN.md`).  
3. Review SLA context for linked issues.  
4. Use **Send SLA Alert** (and related actions) per your workflow.

Administrators configure triggers and integrations from **Jira Admin → Manage Apps → Linked SLA Alerts**.

---

## Who it’s for

**The panel only shows data for linked issues in projects the viewer can already see in Jira.** The app does not bypass Jira permissions.

---

## Privacy & Security

Linked SLA Alerts runs on **Forge**; configuration is stored in **Forge app storage**. Optional **Slack** and **webhook** integrations send data to endpoints **the customer** configures.

### Slack DMs and Jira email APIs

To match Jira users to Slack for DMs, the app may use **email** from **Jira Cloud REST APIs** (scopes include **`read:email-address:jira`** where declared). Visibility is controlled by Atlassian and org settings. Admins can also map **Jira accountId → Slack member ID** so DMs work without email for mapped users.

**Partner notes:** `sla-link-inspector/docs/MARKETPLACE-SLACK-DM.md`  

**Full policy:** [Privacy Policy](https://techcache.github.io/privacy)

---

## Support

**techcache@proton.me** · [Support & security](https://techcache.github.io/support)

---

## License and distribution

**Linked SLA Alerts** is **commercial software**: customers obtain it from the **Atlassian Marketplace** under the **[Terms of Service](https://techcache.github.io/terms)**. This source tree is **not** offered for open-source redistribution. The Forge app’s `package.json` (`sla-link-inspector/package.json`, package name **`linked-sla-alerts-forge`**) uses **`UNLICENSED`** to reflect that; replace or remove any legacy **`LICENSE`** file in the repo root **with counsel** when you finalize the private-repo policy so it matches your commercial model.
