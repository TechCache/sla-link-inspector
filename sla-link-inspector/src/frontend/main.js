import { invoke, view } from '@forge/bridge';

const BUNDLE_VERSION = '2';
console.log('[SLA Link Inspector] bundle loaded, v' + BUNDLE_VERSION);

const LOADING = document.getElementById('loading');
const ERROR_EL = document.getElementById('error');
const EMPTY_EL = document.getElementById('empty');
const TABLE_EL = document.getElementById('sla-table');
const SUMMARY_EL = document.getElementById('sla-summary');

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
  if (hours < 1) return Math.round(hours * 60) + 'm';
  if (hours < 24) return Math.round(hours) + 'h';
  return Math.round(hours / 24) + 'd';
}

function renderSLATable(linkedIssues, parentIssueKey) {
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
    slaInfoBtn.title = 'Post a comment with when this ticket will be at risk and when it will breach';
    slaInfoBtn.addEventListener('click', async () => {
      slaInfoBtn.disabled = true;
      slaInfoBtn.textContent = '…';
      try {
        const result = await invoke('warnAssigneeSlaDates', { parentIssueKey, linkedIssueKey: ticket.key });
        if (result?.ok) {
          alert(result.message || 'Comment posted.');
        } else {
          alert(result?.error || 'Failed to post comment.');
        }
      } catch (e) {
        alert('Error: ' + (e.message || String(e)));
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
  if (banner) banner.textContent = `SLA Link Inspector · v${BUNDLE_VERSION} · Ticket | Priority | Status | SLA`;
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
        ? `No linked issues returned for ${checkedKey}. The panel uses standard Jira issue links (REST API); "Linked work items" may use a different source.`
        : 'No linked issues returned for this ticket. The panel shows standard Jira issue links only.';
      showState('empty');
      return;
    }

    renderSLATable(linkedIssues, issueKey);
  } catch (err) {
    console.error('[SLA Link Inspector] Frontend error:', err.message || err);
    setError(err.message || 'Failed to load linked issues.');
  }
}

run();
