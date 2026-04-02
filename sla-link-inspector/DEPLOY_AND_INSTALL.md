# Get the new columns showing in Jira

Your code in **Projects/sla-link-inspector/sla-link-inspector** is correct (Ticket | Priority | Status | SLA). If the panel still shows the old columns, Jira is loading a **different** app than the one you deploy.

## 1. Confirm which app you're deploying

Your `manifest.yml` has:
```yaml
app:
  id: ari:cloud:ecosystem::app/875126f5-5997-4d13-bf50-097ce475cee5
```

- Go to https://developer.atlassian.com/console/myapps/
- Click **each** "Linked SLA Alerts" and check **App details** (or the URL). One will have ID ending in **875126f5-5997-4d13-bf50-097ce475cee5**. That is **App A** (the one you're deploying).

## 2. Deploy from the correct folder

```bash
cd /Users/cglove/Projects/sla-link-inspector/sla-link-inspector
# Production (live Jira / what most sites should use):
npm run deploy
# or explicitly:
npm run deploy:production

# Development only (default Forge env when you run bare forge deploy):
npm run deploy:dev
```

- Note the "Build ID" in the output (e.g. `build-1710123456789`).
- In Developer Console, open **App A** and confirm **Last updated** is just now under the **same** environment (Production vs Development).

## 3. Install only App A on your Jira site

- In Jira: **Settings (gear)** → **Apps** → **Manage apps** (or **Find new apps**).
- Find **Linked SLA Alerts**. **Uninstall** it (or both if you see two).
- In Developer Console, open **App A** (the one with id `875126f5-...`).
- Go to **Production** if you ran `npm run deploy` / `forge deploy -e production`, or **Development** if you only deploy to dev.
- Copy the **Install app** / **Get install link** URL from that environment (Production and Development have **different** builds).
- Open that URL in your browser and complete the install on your Jira site.

## 4. Open the panel

- Open any issue and open the **Linked SLA Alerts** panel.
- You should see the **Linked SLA Alerts** panel (Send SLA Alert to Linked Tickets) with version banner and "Send to" options for linked tickets.

If the banner still doesn’t appear, the panel is still loading the other app. Uninstall again and install **only** via the install link from App A (step 3).
