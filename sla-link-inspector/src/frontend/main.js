import { invoke, view } from '@forge/bridge';

// Injected at build time from package.json (see scripts/bundle-frontend.js)
const BUNDLE_VERSION = typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : '0.0.0';
console.log('[SLA Link Inspector] bundle loaded, v' + BUNDLE_VERSION);

const LOADING = document.getElementById('loading');
const ERROR_EL = document.getElementById('error');
const EMPTY_EL = document.getElementById('empty');
const TABLE_EL = document.getElementById('sla-table');
const SUMMARY_EL = document.getElementById('sla-summary');
const PANEL_FEEDBACK_EL = document.getElementById('panel-feedback');
const LICENSE_BANNER_EL = document.getElementById('license-banner');

const PANEL_FEEDBACK_DURATION_MS = 3000;

function showPanelSuccess(message) {
  if (!PANEL_FEEDBACK_EL) return;
  PANEL_FEEDBACK_EL.textContent = message;
  PANEL_FEEDBACK_EL.className = 'panel-feedback panel-feedback-success';
  clearTimeout(showPanelSuccess._timeout);
  showPanelSuccess._timeout = setTimeout(() => {
    PANEL_FEEDBACK_EL.className = 'panel-feedback panel-feedback-hidden';
  }, PANEL_FEEDBACK_DURATION_MS);
}

function showPanelError(message) {
  if (!PANEL_FEEDBACK_EL) return;
  clearTimeout(showPanelSuccess._timeout);
  PANEL_FEEDBACK_EL.textContent = message;
  PANEL_FEEDBACK_EL.className = 'panel-feedback panel-feedback-error';
}

function showState(which) {
  LOADING.style.display = which === 'loading' ? 'block' : 'none';
  ERROR_EL.style.display = which === 'error' ? 'block' : 'none';
  EMPTY_EL.style.display = which === 'empty' ? 'block' : 'none';
  TABLE_EL.style.display = which === 'table' ? 'table' : 'none';
  SUMMARY_EL.style.display = which === 'table' ? 'block' : 'none';
}

function setError(message) {
  ERROR_EL.textContent = message;
  showState('error');
}

function sortLinkedIssues(linkedIssues) {
  const order = { breached: 0, at_risk: 1, within: 2, other: 3, none: 4 };
  return [...linkedIssues].sort((a, b) => {
    const aOrder = order[a.slaStatus] ?? 5;
    const bOrder = order[b.slaStatus] ?? 5;
    return aOrder - bOrder;
  });
}

function statusClass(slaStatus) {
  if (!slaStatus) return 'status-none';
  switch (slaStatus) {
    case 'breached': return 'status-breached';
    case 'at_risk': return 'status-at-risk';
    case 'within': return 'status-within';
    default: return 'status-other';
  }
}

function formatHoursLeft(hours) {
  // Mirrors resolver's formatHours for display (hours assumed positive; "left"/"overdue" added by caller).
  if (hours < 1) return Math.round(hours * 60) + 'm';
  if (hours < 24) return Math.round(hours) + 'h';
  return Math.round(hours / 24) + 'd';
}

function renderSLATable(linkedIssues, parentIssueKey, licensed = true) {
  const sorted = sortLinkedIssues(linkedIssues);

  const counts = { breached: 0, at_risk: 0, within: 0, none: 0, other: 0 };
  linkedIssues.forEach((t) => {
    const s = t.slaStatus || 'other';
    if (counts[s] !== undefined) counts[s]++;
    else counts.other++;
  });
  SUMMARY_EL.textContent = `Breached: ${counts.breached}  ·  At risk: ${counts.at_risk}  ·  Within SLA: ${counts.within}  ·  No SLA: ${counts.none}${counts.other ? '  ·  Other: ' + counts.other : ''}`;

  // Build table entirely in JS so headers are always correct (no reliance on deployed HTML)
  if (!TABLE_EL) {
    console.warn('[SLA Link Inspector] #sla-table not found');
    showState('table');
    return;
  }
  const thead = document.createElement('thead');
  thead.innerHTML = '<tr><th>Ticket</th><th>Priority</th><th>Status</th><th>SLA status</th><th>Actions</th></tr>';
  const tbody = document.createElement('tbody');
  TABLE_EL.innerHTML = '';
  TABLE_EL.appendChild(thead);
  TABLE_EL.appendChild(tbody);

  sorted.forEach((ticket) => {
    const row = document.createElement('tr');

    const ticketCell = document.createElement('td');
    const link = document.createElement('a');
    link.href = `/browse/${encodeURIComponent(ticket.key)}`;
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    link.textContent = ticket.key;
    link.className = 'issue-link';
    ticketCell.appendChild(link);
    row.appendChild(ticketCell);

    const priorityCell = document.createElement('td');
    priorityCell.textContent = ticket.priority ?? '—';
    row.appendChild(priorityCell);

    const statusCell = document.createElement('td');
    statusCell.textContent = ticket.issueStatus ?? '—';
    row.appendChild(statusCell);

    const slaCell = document.createElement('td');
    const label = document.createElement('span');
    label.className = 'status-label ' + statusClass(ticket.slaStatus);
    if (ticket.hoursRemaining != null) {
      if (ticket.hoursRemaining > 0) {
        label.textContent = formatHoursLeft(ticket.hoursRemaining) + ' left';
      } else {
        label.textContent = formatHoursLeft(-ticket.hoursRemaining) + ' overdue';
      }
    } else {
      label.textContent = ticket.sla ?? 'No SLA';
    }
    slaCell.appendChild(label);
    row.appendChild(slaCell);

    const actionsCell = document.createElement('td');
    const actionsDiv = document.createElement('div');
    actionsDiv.className = 'action-buttons';
    const slaInfoBtn = document.createElement('button');
    slaInfoBtn.type = 'button';
    slaInfoBtn.className = 'warn-assignee-btn';
    slaInfoBtn.textContent = 'Show SLA Details';
    slaInfoBtn.title = licensed ? 'Post a comment with when this ticket will be at risk and when it will breach' : 'A valid license is required. Please upgrade from the Marketplace.';
    slaInfoBtn.disabled = !licensed;
    slaInfoBtn.addEventListener('click', async () => {
      if (!licensed) return;
      slaInfoBtn.disabled = true;
      slaInfoBtn.textContent = '…';
      try {
        const result = await invoke('warnAssigneeSlaDates', { parentIssueKey, linkedIssueKey: ticket.key });
        if (result?.ok) {
          showPanelSuccess(result.message || 'SLA comment posted.');
        } else {
          showPanelError(result?.error || 'Unable to post comment.');
        }
      } catch (e) {
        showPanelError('Error: ' + (e.message || String(e)));
      } finally {
        slaInfoBtn.disabled = false;
        slaInfoBtn.textContent = 'Show SLA Details';
      }
    });
    actionsDiv.appendChild(slaInfoBtn);
    actionsCell.appendChild(actionsDiv);
    row.appendChild(actionsCell);

    tbody.appendChild(row);
  });

  showState('table');
}

function setBundleVersionInBanner() {
  const banner = document.getElementById('version-banner');
  if (banner) banner.textContent = `Version · v${BUNDLE_VERSION}`;
}

async function run() {
  showState('loading');
  setBundleVersionInBanner();

  let issueKey;
  try {
    const context = await view.getContext();
    issueKey = context?.extension?.issue?.key ?? context?.extension?.issueKey ?? context?.platform?.issueKey ?? context?.platform?.issue?.key;
  } catch (e) {
    console.error('[SLA Link Inspector] Frontend: getContext failed', e.message || e);
    setError('Could not get issue context.');
    return;
  }

  try {
    const result = await invoke('getLinkedIssueSlas', issueKey ? { issueKey } : {});
    const licensed = result.licenseStatus?.licensed !== false;

    if (LICENSE_BANNER_EL) {
      if (!licensed) {
        LICENSE_BANNER_EL.textContent = result.licenseStatus?.reason || 'A valid license is required. Please upgrade from the Marketplace to use SLA Link Inspector.';
        LICENSE_BANNER_EL.style.display = 'block';
      } else {
        LICENSE_BANNER_EL.style.display = 'none';
      }
    }

    if (result.error && (!result.linkedIssues || result.linkedIssues.length === 0)) {
      console.error('[SLA Link Inspector] Frontend: resolver error', result.error);
      setError(result.error || 'Failed to load linked issues.');
      return;
    }

    const linkedIssues = result.linkedIssues || [];
    console.log('[SLA Link Inspector] Frontend: linked issues count', linkedIssues.length);

    if (linkedIssues.length === 0) {
      const emptyEl = document.getElementById('empty');
      const checkedKey = result.issueKey;
      emptyEl.textContent = checkedKey
        ? `No linked issues for ${checkedKey}, or none you have access to. The panel shows standard Jira issue links only—and only for issues in projects you can see.`
        : 'No linked issues for this ticket, or none you have access to. The panel shows standard Jira issue links only—and only for issues in projects you can see.';
      showState('empty');
      return;
    }

    renderSLATable(linkedIssues, result.issueKey ?? issueKey, licensed);
  } catch (err) {
    console.error('[SLA Link Inspector] Frontend error:', err.message || err);
    setError(err.message || 'Failed to load linked issues.');
  }
}

run();
