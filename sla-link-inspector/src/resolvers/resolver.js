import Resolver from '@forge/resolver';
import api, { route } from '@forge/api';
import { kvs } from '@forge/kvs';

const resolver = new Resolver();

const SLA_STATUS_STORAGE_PREFIX = 'sla-link-inspector:';

/**
 * Derive project key from Jira issue key (e.g. PROJ-123 -> PROJ).
 */
function projectKeyFromIssueKey(issueKey) {
  if (issueKey == null || typeof issueKey !== 'string') return '';
  const trimmed = String(issueKey).trim();
  const dash = trimmed.indexOf('-');
  return dash !== -1 ? trimmed.slice(0, dash) : trimmed;
}

/**
 * Find a custom field ID for SLA (case-insensitive).
 * Matches names containing: "sla", "time to resolution", "time to first response".
 * Returns { id, name } or null.
 */
async function findSlaFieldId() {
  const res = await api.asApp().requestJira(route`/rest/api/3/field`);
  if (!res.ok) return null;
  const fields = await res.json();
  const patterns = ['sla', 'time to resolution', 'time to first response'];
  const slaField = fields.find((f) => {
    if (!f.name) return false;
    const name = String(f.name).toLowerCase();
    return patterns.some((p) => name.includes(p));
  });
  return slaField ? { id: slaField.id, name: slaField.name || slaField.id } : null;
}

/**
 * Get SLA status value from an issue's fields.
 * Handles various value shapes: string, { value }, { name }, { displayName }, or object with remainingDuration/elapsedDuration.
 * Returns { label, status, hoursRemaining, totalHours } for display and color logic.
 */
function getSlaData(issueFields, slaFieldId) {
  const none = { label: 'No SLA', status: 'none', hoursRemaining: null, totalHours: null };
  if (!issueFields) return none;

  let raw = null;
  const fieldId = typeof slaFieldId === 'object' && slaFieldId != null ? slaFieldId.id : slaFieldId;
  if (fieldId && issueFields[fieldId] != null) {
    raw = issueFields[fieldId];
  } else {
    for (const [key, value] of Object.entries(issueFields)) {
      const keyLower = String(key).toLowerCase();
      if ((keyLower.includes('sla') || keyLower.includes('time to resolution') || keyLower.includes('time to first response')) && value != null) {
        raw = value;
        break;
      }
    }
  }

  if (raw == null) return none;

  // Structured SLA object (e.g. JSM / Time to SLA app)
  if (typeof raw === 'object') {
    let remainingMs = raw.remainingDuration;
    if (remainingMs == null && raw.currentCycle?.remainingTime != null) {
      const rt = raw.currentCycle.remainingTime;
      remainingMs = typeof rt === 'number' ? rt : rt.milliseconds ?? rt.millis;
    }
    if (remainingMs == null && raw.remainingTime != null) {
      const rt = raw.remainingTime;
      remainingMs = typeof rt === 'number' ? rt : rt.milliseconds ?? rt.millis;
    }
    if (remainingMs == null && raw.ongoingCycle?.remainingTime != null) {
      const rt = raw.ongoingCycle.remainingTime;
      remainingMs = typeof rt === 'number' ? rt : rt.milliseconds ?? rt.millis;
    }

    const elapsedMs = raw.elapsedDuration ?? raw.ongoingCycle?.elapsedTime?.millis ?? raw.ongoingCycle?.elapsedTime?.milliseconds ?? 0;
    const overdueMs = raw.overdueDuration ?? 0;
    let totalMs = raw.slaValue ?? raw.ongoingCycle?.goalDuration?.millis ?? raw.ongoingCycle?.goalDuration?.milliseconds;
    if (totalMs == null) totalMs = elapsedMs + Math.max(0, Number(remainingMs) || 0) + overdueMs;

    if (typeof remainingMs === 'number') {
      const hoursRemaining = remainingMs / (1000 * 60 * 60);
      const totalHours = totalMs / (1000 * 60 * 60);
      let status = 'within';
      if (raw.ongoingCycle?.breached === true || hoursRemaining <= 0) status = 'breached';
      else if (totalHours > 0 && hoursRemaining <= totalHours * 0.25) status = 'at_risk';

      const displayName = raw.name ?? raw.displayName ?? raw.value;
      const friendlyRemaining = raw.ongoingCycle?.remainingTime?.friendly;
      const label = displayName != null ? String(displayName).trim() : (friendlyRemaining || (hoursRemaining > 0 ? `${formatHours(hoursRemaining)} left` : `${formatHours(-hoursRemaining)} overdue`));
      return { label, status, hoursRemaining, totalHours };
    }

    const displayName = raw.displayName ?? raw.value ?? raw.name;
    if (displayName != null && String(displayName).trim() !== '') {
      return { ...normalizeSlaStatus(String(displayName)), hoursRemaining: null, totalHours: null };
    }
  }

  // String value
  if (typeof raw === 'string' && raw.trim() !== '') {
    const parsed = parseHoursFromString(raw);
    if (parsed != null) {
      return { label: parsed.label, status: parsed.status, hoursRemaining: parsed.hoursRemaining, totalHours: parsed.totalHours };
    }
    return { ...normalizeSlaStatus(raw), hoursRemaining: null, totalHours: null };
  }

  return none;
}

function formatHours(hours) {
  const h = Math.abs(hours);
  if (h < 1) return `${Math.round(h * 60)}m`;
  if (h < 24) return `${Math.round(h)}h`;
  return `${Math.round(h / 24)}d`;
}

/**
 * Try to parse "Xh left", "within 72h", "Xh overdue" from label string for color logic.
 */
function parseHoursFromString(str) {
  const s = String(str).trim().toLowerCase();
  const hoursLeftMatch = s.match(/(\d+(?:\.\d+)?)\s*h(?:ours?)?\s+left/);
  const withinMatch = s.match(/within\s+(\d+(?:\.\d+)?)\s*h(?:ours?)?/);
  const overdueMatch = s.match(/(\d+(?:\.\d+)?)\s*h(?:ours?)?\s+overdue/);
  if (hoursLeftMatch) {
    const hoursRemaining = parseFloat(hoursLeftMatch[1]);
    let status = 'within';
    if (hoursRemaining <= 0) status = 'breached';
    else status = 'within'; // can't know total for at_risk from string alone
    return { label: str, status, hoursRemaining, totalHours: null };
  }
  if (withinMatch) {
    const hoursRemaining = parseFloat(withinMatch[1]);
    return { label: str, status: 'within', hoursRemaining, totalHours: hoursRemaining };
  }
  if (overdueMatch) {
    const hoursOverdue = parseFloat(overdueMatch[1]);
    return { label: str, status: 'breached', hoursRemaining: -hoursOverdue, totalHours: null };
  }
  return null;
}

/**
 * Normalize status for display and sorting (breached first).
 */
function normalizeSlaStatus(raw) {
  if (raw == null || raw === '') return { label: 'No SLA', status: 'none' };
  const lower = String(raw).toLowerCase();
  if (lower.includes('breach')) return { label: raw, status: 'breached' };
  if (lower.includes('risk') || lower.includes('at risk')) return { label: raw, status: 'at_risk' };
  if (lower.includes('remaining') || lower.includes('within') || lower.includes('on track')) return { label: raw, status: 'within' };
  return { label: raw, status: 'other' };
}

/**
 * Build ADF body for a Jira comment that mentions the assignee when SLA goes at-risk or breached.
 */
function buildSlaAlertCommentBody(slaStatus, assigneeAccountId, assigneeDisplayName) {
  const statusText = slaStatus === 'breached' ? 'breached' : 'at risk';
  const content = [
    { type: 'text', text: 'SLA Link Inspector: This ticket\'s SLA is now ' },
    { type: 'text', text: statusText, marks: [{ type: 'strong' }] },
    { type: 'text', text: '. ' },
  ];
  if (assigneeAccountId && assigneeDisplayName) {
    content.push({ type: 'mention', attrs: { id: assigneeAccountId, text: `@${assigneeDisplayName}` } });
    content.push({ type: 'text', text: ' please take action.' });
  } else {
    content.push({ type: 'text', text: 'Please take action.' });
  }
  return {
    body: {
      version: 1,
      type: 'doc',
      content: [{ type: 'paragraph', content }],
    },
  };
}

/**
 * Add a comment on the given issue when SLA transitions to at-risk or breached (once per transition).
 */
async function maybeCommentOnSlaChange(jira, linkedIssue) {
  const { key, slaStatus, assigneeAccountId, assigneeDisplayName } = linkedIssue;
  if (slaStatus !== 'at_risk' && slaStatus !== 'breached') return;
  const storageKey = `${SLA_STATUS_STORAGE_PREFIX}${key}`;
  let lastStatus;
  try {
    lastStatus = await kvs.get(storageKey);
  } catch {
    lastStatus = undefined;
  }
  const wasAlreadyAtRiskOrBreached = lastStatus === 'at_risk' || lastStatus === 'breached';
  if (wasAlreadyAtRiskOrBreached) return;
  try {
    const body = buildSlaAlertCommentBody(slaStatus, assigneeAccountId, assigneeDisplayName);
    const res = await jira(route`/rest/api/3/issue/${key}/comment`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      console.error('[SLA Link Inspector] Resolver: failed to add comment on', key, res.status, await res.text());
      return;
    }
    console.log('[SLA Link Inspector] Resolver: added SLA alert comment on', key, 'for', slaStatus);
  } catch (e) {
    console.error('[SLA Link Inspector] Resolver: error adding comment on', key, e.message);
  }
}

resolver.define('getLinkedIssueSlas', async ({ payload, context }) => {
  const issueKey =
    payload?.issueKey ||
    context?.extension?.issue?.key ||
    context?.extension?.issueKey ||
    context?.platform?.issueKey ||
    context?.platform?.issue?.key;
  const safeIssueKey = issueKey != null ? String(issueKey).trim() : '';

  if (!safeIssueKey) {
    console.log('[SLA Link Inspector] Resolver: no issue key in payload or context', JSON.stringify({ hasPayload: !!payload, contextKeys: context ? Object.keys(context) : [] }));
    return { error: 'No issue key. Open this panel from a Jira issue view.', linkedIssues: [] };
  }

  console.log('[SLA Link Inspector] Resolver: selected issue key', safeIssueKey);

  try {
    const jira = api.asApp().requestJira.bind(api.asApp());
    const slaField = await findSlaFieldId();
    const slaFieldId = slaField?.id ?? null;
    if (slaField) {
      console.log('[SLA Link Inspector] Resolver: detected SLA field', slaField.name, '(', slaField.id, ')');
    } else {
      console.log('[SLA Link Inspector] Resolver: no SLA field found in Jira instance');
    }

    const issueRes = await jira(
      route`/rest/api/3/issue/${safeIssueKey}?fields=issuelinks`
    );
    if (!issueRes.ok) {
      const errText = await issueRes.text();
      console.error('[SLA Link Inspector] Resolver: failed to load issue', issueRes.status, errText);
      return { error: `Failed to load issue: ${issueRes.status} ${errText}`, linkedIssues: [] };
    }

    const issueData = await issueRes.json();
    const links = issueData.fields?.issuelinks || [];
    const linkedKeys = new Set();
    for (const link of links) {
      const linked = link.outwardIssue || link.inwardIssue;
      const key = linked?.key;
      if (key != null) linkedKeys.add(String(key).trim());
    }

    console.log('[SLA Link Inspector] Resolver: linked issues returned', linkedKeys.size);

    if (linkedKeys.size === 0) {
      return { linkedIssues: [], issueKey: safeIssueKey };
    }

    const fieldsParam = ['summary', 'status', 'assignee', 'priority'];
    if (slaFieldId) fieldsParam.push(slaFieldId);
    const fieldsQuery = fieldsParam.join(',');

    const linkedIssues = [];
    for (const key of linkedKeys) {
      const safeKey = String(key);
      try {
        const res = await jira(
          route`/rest/api/3/issue/${safeKey}?fields=${fieldsQuery}`
        );
        if (!res.ok) {
          linkedIssues.push({
            key: safeKey,
            projectKey: projectKeyFromIssueKey(safeKey),
            summary: safeKey,
            issueStatus: null,
            priority: null,
            sla: 'Error loading',
            slaStatus: 'other',
            statusCategory: null,
            error: true,
          });
          continue;
        }
        const issue = await res.json();
        const summary = issue.fields?.summary != null ? String(issue.fields.summary) : safeKey;
        const slaData = getSlaData(issue.fields, slaField);
        const statusCategory = issue.fields?.status?.statusCategory?.key ?? null;
        const issueStatus = issue.fields?.status?.name ?? null;
        const assignee = issue.fields?.assignee;
        const assigneeAccountId = assignee?.accountId ?? null;
        const assigneeDisplayName = assignee?.displayName ?? assignee?.name ?? null;
        const priorityName = issue.fields?.priority?.name ?? null;
        linkedIssues.push({
          key: safeKey,
          projectKey: projectKeyFromIssueKey(safeKey),
          summary,
          issueStatus,
          priority: priorityName,
          sla: slaData.label,
          slaStatus: slaData.status,
          hoursRemaining: slaData.hoursRemaining,
          totalHours: slaData.totalHours,
          statusCategory,
          assigneeAccountId,
          assigneeDisplayName,
        });
      } catch (e) {
        console.error('[SLA Link Inspector] Resolver: error fetching linked issue', safeKey, e.message);
        linkedIssues.push({
          key: safeKey,
          projectKey: projectKeyFromIssueKey(safeKey),
          summary: safeKey,
          issueStatus: null,
          priority: null,
          sla: 'Error',
          slaStatus: 'other',
          statusCategory: null,
          error: true,
        });
      }
    }

    for (const linked of linkedIssues) {
      if (linked.error) continue;
      const storageKey = `${SLA_STATUS_STORAGE_PREFIX}${linked.key}`;
      try {
        await maybeCommentOnSlaChange(jira, linked);
        await kvs.set(storageKey, linked.slaStatus);
      } catch (e) {
        console.error('[SLA Link Inspector] Resolver: storage/comment error for', linked.key, e.message);
      }
    }

    return { linkedIssues, issueKey: safeIssueKey };
  } catch (err) {
    console.error('[SLA Link Inspector] Resolver error:', err.message || err);
    return {
      error: err.message || 'Unknown error',
      linkedIssues: [],
      issueKey: safeIssueKey,
    };
  }
});

export const handler = resolver.getDefinitions();
