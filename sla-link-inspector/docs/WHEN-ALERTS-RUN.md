# When do automatic SLA alerts run?

This doc is for **accurate Marketplace and customer expectations**. Keep it aligned with the **public website** and listing copy.

## No Forge scheduled job in this app

`manifest.yml` does **not** declare a Forge **scheduled trigger** or similar background module. The app does **not** poll Jira on a timer by itself.

## What actually runs the logic

Most **automatic** behavior is evaluated inside the **`getLinkedIssueSlas`** resolver, which the **issue panel** calls when a user **opens or refreshes** the **Linked SLA Alerts** panel on the **parent** issue (the one that carries the SLA you care about).

That resolver:

1. Loads the parent issue, linked issue keys, and SLA data (including JSM request SLA when needed).
2. For each linked issue, may call **`maybeCommentOnSlaChange`** when the **parent’s** SLA is **at risk** or **breached** (subject to admin toggles, deduplication in Forge **KVS**, and “only if linked issue is open”).
3. If **time-left warning thresholds** are enabled, may post **threshold** comments / notifications when the parent’s remaining time matches a rule (also deduped in KVS).

So **“automatic”** here means **automatic when the panel is loaded**, not **continuous background monitoring**.

## Manual / on-demand

**Send SLA Alert** uses **`notifyLinkedTicketsOfCurrentSla`** and does not depend on SLA being at risk or breached—it posts the current parent SLA summary to selected linked tickets when the user clicks send.

## Listing / website wording

Avoid implying **24/7 background scheduling** or **cron** unless you add a real scheduled module later. Safer phrases:

- “When you open the issue panel…”  
- “On panel load, the app checks…”  
- “On-demand send via **Send SLA Alert**…”

## Related files

- Resolver: `src/resolvers/resolver.js` — `getLinkedIssueSlas`, `maybeCommentOnSlaChange`, `notifyLinkedTicketsOfCurrentSla`
- Manifest: `manifest.yml` — `jira:issuePanel`, `jira:adminPage` only
