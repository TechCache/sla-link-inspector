# Console scripts to debug Linked SLA Alerts panel

Run these in the browser **Developer Tools → Console** (F12 or Cmd+Option+J) while viewing a Jira issue with the Linked SLA Alerts panel **open and visible**.

---

## Script 1: Run from the main Jira page (issue view)

Paste this in the console and press Enter. It finds the panel iframe and reports its URL and whatever it can read.

```javascript
(function() {
  const iframes = document.querySelectorAll('iframe');
  let report = [];
  iframes.forEach((f, i) => {
    const src = f.src || '';
    const name = f.name || f.id || '(no name)';
    if (src && (src.includes('forge') || src.includes('atlassian') || src.includes('sla') || src.length > 50)) {
      report.push({ index: i, name, src: src.substring(0, 120) + (src.length > 120 ? '...' : '') });
      try {
        const doc = f.contentDocument;
        if (doc) {
          const banner = doc.querySelector('#version-banner, .version-banner');
          const headRow = doc.querySelector('#sla-table-head');
          const ths = doc.querySelectorAll('#sla-table th');
          const colText = Array.from(ths).map(t => t.textContent).join(' | ');
          report[report.length - 1].sameOrigin = true;
          report[report.length - 1].bannerText = banner ? banner.textContent : '(no banner)';
          report[report.length - 1].columnHeaders = colText || '(no thead)';
          report[report.length - 1].scriptTags = Array.from(doc.querySelectorAll('script[src]')).map(s => s.src);
        } else {
          report[report.length - 1].sameOrigin = false;
          report[report.length - 1].note = 'Cannot read iframe (different origin)';
        }
      } catch (e) {
        report[report.length - 1].error = e.message;
      }
    }
  });
  console.table(report);
  report.forEach((r, i) => {
    console.log('--- Iframe', i, '---');
    console.log('URL:', r.src);
    if (r.columnHeaders) console.log('Table columns:', r.columnHeaders);
    if (r.bannerText) console.log('Banner:', r.bannerText);
    if (r.scriptTags) console.log('Scripts:', r.scriptTags);
  });
  return report;
})();
```

**What to look for**
- **URL** – Should point at a Forge/Atlassian host. Note the path (e.g. contains an app ID or resource key).
- **Table columns** – If `sameOrigin` is true, you’ll see the actual header text (e.g. "Ticket | Priority | Status | SLA status" vs "Linked ticket | Project | Status | SLA status").
- **Banner** – Should show "Version · vX.X.X" and the Send SLA Alert to Linked Tickets panel content.

---

## Script 2: Run inside the panel iframe (Chrome)

If Script 1 shows `sameOrigin: false`, you can still inspect the panel’s DOM:

1. Right‑click inside the **Linked SLA Alerts panel** → **Inspect** (or Inspect Element).
2. In the **Elements** tab, click the topmost element (often `<html>` or the iframe’s document).
3. Go to the **Console** tab. Use the dropdown that says "top" and switch to the iframe for the panel (e.g. "sla-link-inspector" or the URL that looks like the panel).
4. Paste this and press Enter:

```javascript
(function() {
  const banner = document.querySelector('#version-banner, .version-banner');
  const ths = document.querySelectorAll('#sla-table th, #sla-table-head th');
  const columns = Array.from(ths).map(t => t.textContent.trim());
  console.log('Banner:', banner ? banner.textContent : '(not found)');
  console.log('Column headers:', columns.length ? columns.join(' | ') : '(none)');
  console.log('Script src:', document.querySelector('script[src]')?.src || '(none)');
  return { banner: banner?.textContent, columns };
})();
```

**What to look for**
- **Banner** – Version banner and SLA relay heading (Linked SLA Alerts panel).
- **Content** – Summary of linked tickets and "Send to" options (no table in current UI).
- **Script src** – URL of the loaded JS; may include a version or hash.

---

## What it tells you

| If you see | Meaning |
|------------|--------|
| Columns = "Ticket \| Priority \| Status \| SLA status" | New UI is loading; column layout is correct. |
| Columns = "Linked ticket \| Project \| ..." | Old app/version is loading; Jira is using a different app or cached resource. |
| sameOrigin: false and can’t run Script 2 | Use Script 2 from inside the iframe (steps above). |
| iframe URL contains a different app ID | The installed app is not the one you’re deploying; install the app that matches your manifest and try again. |

Copy the console output (or a screenshot) and share it to interpret what’s loading.
