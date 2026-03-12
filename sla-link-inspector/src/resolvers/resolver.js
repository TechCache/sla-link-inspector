import Resolver from '@forge/resolver';
import api, { route } from '@forge/api';
import { kvs } from '@forge/kvs';

const resolver = new Resolver();

const SLA_STATUS_STORAGE_PREFIX = 'sla-link-inspector:';
const ADMIN_CONFIG_KEY = SLA_STATUS_STORAGE_PREFIX + 'admin-config';

const DEFAULT_ADMIN_CONFIG = {
  triggerAtRisk: true,
  triggerBreached: true,
  trigger30MinRemaining: false,
  // At Risk → who to notify (parent issue's users)
  atRiskNotifyAssignee: true,
  atRiskNotifyReporter: false,
  atRiskNotifyWatchers: false,
  // Breached → who to notify (e.g. assignee + team lead / reporter)
  breachedNotifyAssignee: true,
  breachedNotifyReporter: true,
  breachedNotifyWatchers: false,
  // Legacy (kept for backward compat; per-trigger above take precedence)
  notifyAssignee: true,
  notifyReporter: false,
  notifyWatchers: false,
  notifyCustom: false,
  customUserGroup: '',
  notificationComment: true,
  notificationMention: true,
  notificationEmail: false,
  notificationSlack: false,
  emailWebhookUrl: '',
  slackWebhookUrl: '',
  slackChannelId: '',
  slackBotToken: '',
  onlyNotifyIfOpen: true,
  atRiskAdditionalMentions: [],
  breachedAdditionalMentions: [],
  customTemplate: `⚠️ SLA Alert

Issue: {{issueKey}}

The SLA "{{slaName}}" is now {{status}}.

Time remaining: {{remainingTime}}

Please review this issue to avoid breach. {{assignee}}`,
};

async function getAdminConfig() {
  try {
    const raw = await kvs.get(ADMIN_CONFIG_KEY);
    if (raw != null && typeof raw === 'object') {
      return { ...DEFAULT_ADMIN_CONFIG, ...raw };
    }
  } catch {
    // ignore
  }
  return { ...DEFAULT_ADMIN_CONFIG };
}

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

resolver.define('getAdminConfig', async () => {
  return getAdminConfig();
});

resolver.define('setAdminConfig', async ({ payload }) => {
  if (payload == null || typeof payload !== 'object') {
    return { ok: false, error: 'Invalid payload.' };
  }
  const allowed = new Set(Object.keys(DEFAULT_ADMIN_CONFIG));
  const toStore = {};
  for (const [key, value] of Object.entries(payload)) {
    if (!allowed.has(key)) continue;
    if (key === 'customTemplate' && value != null) toStore[key] = String(value);
    else if (key === 'customUserGroup' && value != null) toStore[key] = String(value).trim();
    else if ((key === 'slackWebhookUrl' || key === 'emailWebhookUrl') && value != null) toStore[key] = String(value).trim();
    else if (key === 'slackChannelId' && value != null) toStore[key] = String(value).trim();
    else if (key === 'slackBotToken') {
      if (value != null && String(value).trim() !== '') toStore[key] = String(value).trim();
    }
    else if ((key === 'atRiskAdditionalMentions' || key === 'breachedAdditionalMentions') && Array.isArray(value)) {
      toStore[key] = value
        .filter((m) => m && m.accountId)
        .map((m) => ({ accountId: String(m.accountId), displayName: m.displayName != null ? String(m.displayName) : '' }));
    } else if (typeof value === 'boolean') toStore[key] = value;
  }
  try {
    const current = await getAdminConfig();
    await kvs.set(ADMIN_CONFIG_KEY, { ...current, ...toStore });
    return { ok: true };
  } catch (e) {
    console.error('[SLA Link Inspector] setAdminConfig error', e.message);
    return { ok: false, error: e.message || 'Failed to save.' };
  }
});

/**
 * Test Slack delivery (webhook or Web API) by sending a single test message.
 * Payload: optional { slackWebhookUrl, slackChannelId, slackBotToken }. If omitted, uses saved admin config.
 */
resolver.define('testSlackWebhook', async ({ payload }) => {
  const config = payload && (payload.slackWebhookUrl != null || payload.slackChannelId != null || payload.slackBotToken != null)
    ? payload
    : await getAdminConfig();
  const params = getSlackSendParams(config);
  if (!params) {
    return { ok: false, error: 'Configure either an Incoming Webhook URL or a Bot token + Channel ID (and optionally set SLACK_BOT_TOKEN in Forge env).' };
  }
  const testMessage = 'SLA Link Inspector: Test message. If you see this, your Slack integration is working.';
  try {
    if (params.method === 'webhook') {
      const res = await fetch(params.webhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: testMessage }),
      });
      if (res.ok) return { ok: true, message: 'Test message sent. Check your Slack channel.' };
      const body = await res.text();
      return { ok: false, error: `Slack returned ${res.status}: ${body || res.statusText}` };
    }
    const res = await fetch('https://slack.com/api/chat.postMessage', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${params.token}` },
      body: JSON.stringify({ channel: params.channelId, text: testMessage }),
    });
    const data = await res.json().catch(() => ({}));
    if (data.ok) return { ok: true, message: 'Test message sent. Check your Slack channel.' };
    return { ok: false, error: data.error || `Slack API ${res.status}` };
  } catch (e) {
    console.error('[SLA Link Inspector] testSlackWebhook error', e.message);
    return { ok: false, error: e.message || 'Request failed.' };
  }
});

/**
 * Search Jira users for the admin "additional mentions" picker. Payload: { query }. Returns { users: [{ accountId, displayName }] }.
 */
resolver.define('searchJiraUsers', async ({ payload }) => {
  const query = (payload?.query != null ? String(payload.query) : '').trim();
  if (query.length < 2) return { users: [] };
  try {
    const jira = api.asApp().requestJira.bind(api.asApp());
    const res = await jira(route`/rest/api/3/user/search?query=${encodeURIComponent(query)}&maxResults=20`);
    if (!res.ok) return { users: [] };
    const data = await res.json();
    const users = (Array.isArray(data) ? data : []).map((u) => ({
      accountId: u.accountId,
      displayName: u.displayName || u.name || u.emailAddress || u.accountId,
    })).filter((u) => u.accountId);
    return { users };
  } catch (e) {
    console.error('[SLA Link Inspector] searchJiraUsers error', e.message);
    return { users: [] };
  }
});

/**
 * Build ADF body for a Jira comment when a linked ticket's SLA goes at-risk or breached.
 * mentions = [{ accountId, displayName }, ...] in order (e.g. assignee, reporter, watchers).
 */
function buildSlaAlertCommentBody(linkedIssueKey, slaStatus, mentions, opts = {}) {
  const { slaName = '', remainingTime = '', customTemplate } = opts;
  const statusText = slaStatus === 'breached' ? 'breached' : (slaStatus === 'at_risk' ? 'at risk' : slaStatus);
  const vars = {
    issueKey: linkedIssueKey,
    slaName: slaName || 'SLA',
    remainingTime: remainingTime || (slaStatus === 'breached' ? 'Overdue' : '—'),
    status: statusText,
  };
  if (customTemplate && String(customTemplate).trim() !== '') {
    return templateToAdf(customTemplate, vars, mentions);
  }
  const content = [
    { type: 'text', text: 'SLA Link Inspector: Linked ticket ' },
    { type: 'text', text: linkedIssueKey, marks: [{ type: 'strong' }] },
    { type: 'text', text: "'s SLA is now " },
    { type: 'text', text: statusText, marks: [{ type: 'strong' }] },
    { type: 'text', text: '. ' },
  ];
  if (Array.isArray(mentions) && mentions.length > 0) {
    for (const m of mentions) {
      if (m && m.accountId) {
        content.push({ type: 'mention', attrs: { id: m.accountId, text: `@${m.displayName || m.name || 'user'}` } });
        content.push({ type: 'text', text: ' ' });
      }
    }
    content.push({ type: 'text', text: 'Please take action.' });
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
 * Convert a template string with {{variables}} into ADF. Supports {{issueKey}}, {{slaName}}, {{remainingTime}}, {{status}}, {{assignee}}.
 * {{assignee}} is replaced with one or more ADF mention nodes. mentions = [{ accountId, displayName }, ...] (parent issue assignee, reporter, watchers as configured).
 */
function templateToAdf(template, vars, mentions) {
  const mentionList = Array.isArray(mentions) ? mentions.filter((m) => m && m.accountId) : [];
  let text = String(template);
  text = text.replace(/\{\{issueKey\}\}/g, vars.issueKey ?? '');
  text = text.replace(/\{\{slaName\}\}/g, vars.slaName ?? '');
  text = text.replace(/\{\{remainingTime\}\}/g, vars.remainingTime ?? '');
  text = text.replace(/\{\{status\}\}/g, vars.status ?? '');
  const paragraphs = text.split(/\n\n+/).filter((p) => p.trim() !== '');
  const content = [];
  for (const para of paragraphs) {
    const parts = [];
    const segs = para.split(/\{\{assignee\}\}/);
    for (let i = 0; i < segs.length; i++) {
      if (segs[i].length > 0) {
        parts.push({ type: 'text', text: segs[i].replace(/\n/g, ' ') });
      }
      if (i < segs.length - 1 && mentionList.length > 0) {
        for (const m of mentionList) {
          parts.push({ type: 'mention', attrs: { id: m.accountId, text: `@${m.displayName || m.name || 'user'}` } });
        }
      }
    }
    if (parts.length > 0) {
      content.push({ type: 'paragraph', content: parts });
    }
  }
  if (content.length === 0) {
    content.push({ type: 'paragraph', content: [{ type: 'text', text: 'SLA alert.' }] });
  }
  return { body: { version: 1, type: 'doc', content } };
}

/**
 * Build ADF body for a "warn assignee" comment with at-risk and breach dates.
 * Comment is posted on the parent issue; assignee is the parent's assignee. linkedIssueKey identifies the linked ticket.
 * @param {object} opts - { linkedIssueKey, atRiskDate, breachedDate, alreadyAtRisk, alreadyBreached, assigneeAccountId, assigneeDisplayName }
 */
function buildWarnAssigneeCommentBody(opts) {
  const {
    linkedIssueKey,
    atRiskDate,
    breachedDate,
    alreadyAtRisk,
    alreadyBreached,
    assigneeAccountId,
    assigneeDisplayName,
  } = opts;
  const formatDate = (d) => (d != null ? new Date(d).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }) : null);
  const ticketRef = linkedIssueKey ? `Linked ticket ${linkedIssueKey}'s SLA` : 'This ticket\'s SLA';
  const content = [{ type: 'text', text: 'SLA Link Inspector: ', marks: [{ type: 'strong' }] }];
  if (alreadyBreached) {
    content.push({ type: 'text', text: `${ticketRef} is already breached (as of ${formatDate(breachedDate)}). ` });
  } else if (alreadyAtRisk) {
    content.push({ type: 'text', text: `${ticketRef} is already at risk. It will be breached on ${formatDate(breachedDate)} if no action is taken. ` });
  } else {
    const atRiskStr = atRiskDate != null ? `at risk on ${formatDate(atRiskDate)}` : null;
    const breachStr = breachedDate != null ? `breached on ${formatDate(breachedDate)}` : null;
    const parts = [atRiskStr, breachStr].filter(Boolean);
    content.push({ type: 'text', text: `${ticketRef} will become ${parts.join(' and ')} if no action is taken.` });
  }
  return {
    body: {
      version: 1,
      type: 'doc',
      content: [{ type: 'paragraph', content }],
    },
  };
}

function buildMentionsForTrigger(config, trigger, parentPeople) {
  const list = [];
  const assignee = parentPeople?.assignee;
  const reporter = parentPeople?.reporter;
  const watchers = Array.isArray(parentPeople?.watchers) ? parentPeople.watchers : [];
  const isAtRisk = trigger === 'at_risk';
  if (isAtRisk) {
    if (config.atRiskNotifyAssignee && assignee?.accountId) list.push({ accountId: assignee.accountId, displayName: assignee.displayName || assignee.name });
    if (config.atRiskNotifyReporter && reporter?.accountId) list.push({ accountId: reporter.accountId, displayName: reporter.displayName || reporter.name });
    if (config.atRiskNotifyWatchers) list.push(...watchers.filter((w) => w?.accountId));
    const extra = Array.isArray(config.atRiskAdditionalMentions) ? config.atRiskAdditionalMentions : [];
    list.push(...extra.filter((m) => m && m.accountId));
  } else {
    if (config.breachedNotifyAssignee && assignee?.accountId) list.push({ accountId: assignee.accountId, displayName: assignee.displayName || assignee.name });
    if (config.breachedNotifyReporter && reporter?.accountId) list.push({ accountId: reporter.accountId, displayName: reporter.displayName || reporter.name });
    if (config.breachedNotifyWatchers) list.push(...watchers.filter((w) => w?.accountId));
    const extra = Array.isArray(config.breachedAdditionalMentions) ? config.breachedAdditionalMentions : [];
    list.push(...extra.filter((m) => m && m.accountId));
  }
  return list;
}

/**
 * Format a timestamp for display in SLA info.
 */
function formatDateForDisplay(ts) {
  if (ts == null) return null;
  return new Date(ts).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}

/**
 * Build plain-text message for Slack/email from template vars. Replaces {{var}} and {{assignee}} with names.
 */
function buildPlainTextMessage(template, vars, mentions) {
  let text = String(template || '');
  text = text.replace(/\{\{issueKey\}\}/g, vars.issueKey ?? '');
  text = text.replace(/\{\{slaName\}\}/g, vars.slaName ?? '');
  text = text.replace(/\{\{remainingTime\}\}/g, vars.remainingTime ?? '');
  text = text.replace(/\{\{status\}\}/g, vars.status ?? '');
  const names = Array.isArray(mentions) ? mentions.map((m) => m?.displayName || m?.name || 'user').filter(Boolean) : [];
  text = text.replace(/\{\{assignee\}\}/g, names.length > 0 ? names.join(', ') : '');
  return text.replace(/\n\n+/g, '\n').trim();
}

/**
 * Send Slack notification via incoming webhook. Payload: { text } or { text, blocks }.
 */
async function sendSlackNotification(webhookUrl, message) {
  const url = (webhookUrl || '').trim();
  if (!url || !url.startsWith('https://hooks.slack.com/')) return;
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: message }),
    });
    if (!res.ok) {
      console.error('[SLA Link Inspector] Slack webhook failed', res.status, await res.text());
    }
  } catch (e) {
    console.error('[SLA Link Inspector] Slack webhook error', e.message);
  }
}

/**
 * Send Slack notification via Web API (chat.postMessage). Use when webhook URL is not set.
 * Requires bot token (xoxb-...) and channel ID (e.g. C01234ABCD).
 */
async function sendSlackViaWebApi(botToken, channelId, message) {
  const token = (botToken || '').trim() || (typeof process !== 'undefined' && process.env && process.env.SLACK_BOT_TOKEN);
  const channel = (channelId || '').trim();
  if (!token || !channel) return;
  try {
    const res = await fetch('https://slack.com/api/chat.postMessage', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ channel, text: message }),
    });
    const data = await res.json().catch(() => ({}));
    if (!data.ok) {
      console.error('[SLA Link Inspector] Slack Web API failed', data.error || res.status, data);
    }
  } catch (e) {
    console.error('[SLA Link Inspector] Slack Web API error', e.message);
  }
}

/**
 * Resolve how to send to Slack: webhook URL takes precedence; else Bot token + Channel ID (config or SLACK_BOT_TOKEN env).
 * Returns { method: 'webhook', webhookUrl } | { method: 'api', token, channelId } | null.
 */
function getSlackSendParams(config) {
  const webhookUrl = (config.slackWebhookUrl || '').trim();
  if (webhookUrl && webhookUrl.startsWith('https://hooks.slack.com/')) {
    return { method: 'webhook', webhookUrl };
  }
  const token = (config.slackBotToken || '').trim() || (typeof process !== 'undefined' && process.env && process.env.SLACK_BOT_TOKEN) || '';
  const channelId = (config.slackChannelId || '').trim();
  if (token && channelId) return { method: 'api', token, channelId };
  return null;
}

/**
 * POST to an email webhook (e.g. Zapier/Make) so the recipient can send email. Payload includes event, issue keys, status, recipients, message.
 */
async function sendEmailWebhook(webhookUrl, payload) {
  const url = (webhookUrl || '').trim();
  if (!url) return;
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      console.error('[SLA Link Inspector] Email webhook failed', res.status, await res.text());
    }
  } catch (e) {
    console.error('[SLA Link Inspector] Email webhook error', e.message);
  }
}

/**
 * Add a comment on the parent issue when a linked ticket's SLA transitions to at-risk or breached (once per transition).
 * Uses per-trigger config: at-risk vs breached can notify different people (e.g. assignee vs assignee + reporter).
 * Skips if config.onlyNotifyIfOpen and the linked issue is already closed (statusCategory === 'done').
 */
async function maybeCommentOnSlaChange(jira, linkedIssue, parentIssueKey, parentPeople, forcePost = false) {
  const { key, slaStatus, sla: slaLabel, hoursRemaining, statusCategory } = linkedIssue;
  if (slaStatus !== 'at_risk' && slaStatus !== 'breached') return;
  const config = await getAdminConfig();
  if (slaStatus === 'at_risk' && !config.triggerAtRisk) return;
  if (slaStatus === 'breached' && !config.triggerBreached) return;
  if (config.onlyNotifyIfOpen && statusCategory === 'done') return;
  const storageKey = `${SLA_STATUS_STORAGE_PREFIX}${key}`;
  if (!forcePost) {
    let lastStatus;
    try {
      lastStatus = await kvs.get(storageKey);
    } catch {
      lastStatus = undefined;
    }
    const wasAlreadyAtRiskOrBreached = lastStatus === 'at_risk' || lastStatus === 'breached';
    if (wasAlreadyAtRiskOrBreached) return;
  }
  try {
    const remainingTimeStr = hoursRemaining != null
      ? (hoursRemaining > 0 ? formatHours(hoursRemaining) + ' left' : formatHours(-hoursRemaining) + ' overdue')
      : '—';
    const mentions = buildMentionsForTrigger(config, slaStatus, parentPeople);
    const commentMentions = config.notificationMention ? mentions : [];
    const body = buildSlaAlertCommentBody(key, slaStatus, commentMentions, {
      slaName: slaLabel || 'SLA',
      remainingTime: remainingTimeStr,
      customTemplate: config.customTemplate || null,
    });
    if (config.notificationComment) {
      const res = await jira(route`/rest/api/3/issue/${parentIssueKey}/comment`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        console.error('[SLA Link Inspector] Resolver: failed to add comment on', parentIssueKey, res.status, await res.text());
        return;
      }
      console.log('[SLA Link Inspector] Resolver: added SLA alert comment on parent', parentIssueKey, 'for linked', key, slaStatus);
    }
    const vars = { issueKey: key, slaName: slaLabel || 'SLA', remainingTime: remainingTimeStr, status: slaStatus === 'breached' ? 'breached' : 'at risk' };
    const plainText = buildPlainTextMessage(config.customTemplate || null, vars, mentions);
    const defaultMsg = `SLA Link Inspector: Linked ticket ${key} is now ${vars.status}. Time remaining: ${remainingTimeStr}.`;
    const messageForChannels = plainText || defaultMsg;
    const slackParams = getSlackSendParams(config);
    if (config.notificationSlack && slackParams) {
      if (slackParams.method === 'webhook') await sendSlackNotification(slackParams.webhookUrl, messageForChannels);
      else await sendSlackViaWebApi(slackParams.token, slackParams.channelId, messageForChannels);
    }
    if (config.notificationEmail && config.emailWebhookUrl) {
      await sendEmailWebhook(config.emailWebhookUrl, {
        event: 'sla_alert',
        parentIssueKey,
        linkedIssueKey: key,
        status: vars.status,
        slaName: vars.slaName,
        remainingTime: remainingTimeStr,
        recipients: mentions.map((m) => ({ accountId: m.accountId, displayName: m.displayName || m.name })),
        message: messageForChannels,
        subject: `SLA ${vars.status}: ${key}`,
      });
    }
  } catch (e) {
    console.error('[SLA Link Inspector] Resolver: error adding comment on', parentIssueKey, e.message);
  }
}

/**
 * Return SLA dates info for a linked issue: when it will be at risk and when it will breach.
 * Payload: { linkedIssueKey }. Returns { ok, summary } or { ok: false, error }.
 */
resolver.define('getSlaDatesInfo', async ({ payload }) => {
  const linkedIssueKey = payload?.linkedIssueKey != null ? String(payload.linkedIssueKey).trim() : '';
  if (!linkedIssueKey) return { ok: false, error: 'Missing linkedIssueKey.' };
  try {
    const jira = api.asApp().requestJira.bind(api.asApp());
    const slaField = await findSlaFieldId();
    const fieldsParam = ['summary', 'status', 'priority'];
    if (slaField?.id) fieldsParam.push(slaField.id);
    const fieldsQuery = fieldsParam.join(',');
    const res = await jira(route`/rest/api/3/issue/${linkedIssueKey}?fields=${fieldsQuery}`);
    if (!res.ok) return { ok: false, error: `Failed to load issue: ${res.status}` };
    const issue = await res.json();
    const slaData = getSlaData(issue.fields, slaField);
    const hoursRemaining = slaData.hoursRemaining;
    const totalHours = slaData.totalHours;
    const slaName = slaData.label || 'SLA';

    const now = Date.now();
    const msPerHour = 60 * 60 * 1000;
    let atRiskDate = null;
    let breachedDate = null;
    let alreadyAtRisk = false;
    let alreadyBreached = false;

    if (hoursRemaining != null) {
      if (hoursRemaining <= 0) {
        alreadyBreached = true;
        breachedDate = now + hoursRemaining * msPerHour;
      } else {
        breachedDate = now + hoursRemaining * msPerHour;
        if (totalHours != null && totalHours > 0) {
          const atRiskThresholdHours = totalHours * 0.25;
          if (hoursRemaining <= atRiskThresholdHours) {
            alreadyAtRisk = true;
          } else {
            atRiskDate = now + (hoursRemaining - atRiskThresholdHours) * msPerHour;
          }
        }
      }
    }

    if (breachedDate == null && atRiskDate == null && !alreadyAtRisk && !alreadyBreached) {
      return { ok: false, error: 'No SLA time data for this issue.' };
    }

    const fmt = formatDateForDisplay;
    let summary = `${linkedIssueKey} — "${slaName}"\n\n`;
    if (alreadyBreached) {
      summary += `• Already breached (as of ${fmt(breachedDate)}).`;
    } else if (alreadyAtRisk) {
      summary += `• Already at risk.\n• Will breach: ${fmt(breachedDate)}`;
    } else {
      if (atRiskDate != null) summary += `• At risk: ${fmt(atRiskDate)}\n`;
      if (breachedDate != null) summary += `• Breach: ${fmt(breachedDate)}`;
    }
    return { ok: true, summary };
  } catch (e) {
    console.error('[SLA Link Inspector] getSlaDatesInfo error', e.message);
    return { ok: false, error: e.message || 'Unknown error' };
  }
});

/**
 * Test helper: post the SLA alert comment on the parent issue (the one the user has open), @mentioning the parent's assignee.
 * Payload: { parentIssueKey, linkedIssueKey }. Linked issue must be at_risk or breached.
 */
resolver.define('testFireSlaComment', async ({ payload }) => {
  const linkedIssueKey = payload?.linkedIssueKey != null ? String(payload.linkedIssueKey).trim() : '';
  const parentIssueKey = payload?.parentIssueKey != null ? String(payload.parentIssueKey).trim() : '';
  if (!linkedIssueKey) return { ok: false, error: 'Missing linkedIssueKey.' };
  if (!parentIssueKey) return { ok: false, error: 'Missing parentIssueKey.' };
  try {
    const jira = api.asApp().requestJira.bind(api.asApp());
    const slaField = await findSlaFieldId();
    const fieldsParam = ['summary', 'status', 'assignee', 'priority'];
    if (slaField?.id) fieldsParam.push(slaField.id);
    const fieldsQuery = fieldsParam.join(',');
    const [linkedRes, parentRes] = await Promise.all([
      jira(route`/rest/api/3/issue/${linkedIssueKey}?fields=${fieldsQuery}`),
      jira(route`/rest/api/3/issue/${parentIssueKey}?fields=assignee,reporter`),
    ]);
    if (!linkedRes.ok) return { ok: false, error: `Failed to load linked issue: ${linkedRes.status}` };
    if (!parentRes.ok) return { ok: false, error: `Failed to load parent issue: ${parentRes.status}` };
    const linkedIssue = await linkedRes.json();
    const parentIssue = await parentRes.json();
    const slaData = getSlaData(linkedIssue.fields, slaField);
    const linked = {
      key: linkedIssueKey,
      slaStatus: slaData.status,
      sla: slaData.label,
      hoursRemaining: slaData.hoursRemaining,
      statusCategory: linkedIssue.fields?.status?.statusCategory?.key ?? null,
    };
    if (linked.slaStatus !== 'at_risk' && linked.slaStatus !== 'breached') {
      return { ok: false, error: `Linked issue is not at_risk or breached (current: ${linked.slaStatus}).` };
    }
    const parentAssignee = parentIssue.fields?.assignee;
    const parentReporter = parentIssue.fields?.reporter;
    const parentPeople = {
      assignee: parentAssignee ? { accountId: parentAssignee.accountId, displayName: parentAssignee.displayName || parentAssignee.name } : null,
      reporter: parentReporter ? { accountId: parentReporter.accountId, displayName: parentReporter.displayName || parentReporter.name } : null,
      watchers: [],
    };
    const cfg = await getAdminConfig();
    if (cfg.atRiskNotifyWatchers || cfg.breachedNotifyWatchers) {
      try {
        const wRes = await jira(route`/rest/api/3/issue/${parentIssueKey}/watchers`);
        if (wRes.ok) {
          const wData = await wRes.json();
          parentPeople.watchers = (wData.watchers || []).map((w) => ({ accountId: w.accountId, displayName: w.displayName || w.name }));
        }
      } catch {
        // ignore
      }
    }
    await maybeCommentOnSlaChange(jira, linked, parentIssueKey, parentPeople, true);
    return { ok: true, message: `Comment posted on parent ${parentIssueKey} (linked ${linkedIssueKey} is ${linked.slaStatus}).` };
  } catch (e) {
    console.error('[SLA Link Inspector] testFireSlaComment error', e.message);
    return { ok: false, error: e.message || 'Unknown error' };
  }
});

/**
 * Post a comment on the parent issue (the one the user has open) warning the parent's assignee when the linked ticket's SLA will become at-risk and/or breached.
 * Payload: { parentIssueKey, linkedIssueKey }.
 */
resolver.define('warnAssigneeSlaDates', async ({ payload }) => {
  const linkedIssueKey = payload?.linkedIssueKey != null ? String(payload.linkedIssueKey).trim() : '';
  const parentIssueKey = payload?.parentIssueKey != null ? String(payload.parentIssueKey).trim() : '';
  if (!linkedIssueKey) return { ok: false, error: 'Missing linkedIssueKey.' };
  if (!parentIssueKey) return { ok: false, error: 'Missing parentIssueKey.' };
  try {
    const jira = api.asApp().requestJira.bind(api.asApp());
    const slaField = await findSlaFieldId();
    const fieldsParam = ['summary', 'status', 'assignee', 'priority'];
    if (slaField?.id) fieldsParam.push(slaField.id);
    const fieldsQuery = fieldsParam.join(',');
    const [linkedRes, parentRes] = await Promise.all([
      jira(route`/rest/api/3/issue/${linkedIssueKey}?fields=${fieldsQuery}`),
      jira(route`/rest/api/3/issue/${parentIssueKey}?fields=assignee`),
    ]);
    if (!linkedRes.ok) return { ok: false, error: `Failed to load linked issue: ${linkedRes.status}` };
    if (!parentRes.ok) return { ok: false, error: `Failed to load parent issue: ${parentRes.status}` };
    const linkedIssue = await linkedRes.json();
    const parentIssue = await parentRes.json();
    const slaData = getSlaData(linkedIssue.fields, slaField);
    const parentAssignee = parentIssue.fields?.assignee;
    const parentAccountId = parentAssignee?.accountId ?? null;
    const parentDisplayName = parentAssignee?.displayName ?? parentAssignee?.name ?? null;
    const hoursRemaining = slaData.hoursRemaining;
    const totalHours = slaData.totalHours;

    const now = Date.now();
    const msPerHour = 60 * 60 * 1000;
    let atRiskDate = null;
    let breachedDate = null;
    let alreadyAtRisk = false;
    let alreadyBreached = false;

    if (hoursRemaining != null) {
      if (hoursRemaining <= 0) {
        alreadyBreached = true;
        breachedDate = now + hoursRemaining * msPerHour;
      } else {
        breachedDate = now + hoursRemaining * msPerHour;
        if (totalHours != null && totalHours > 0) {
          const atRiskThresholdHours = totalHours * 0.25;
          if (hoursRemaining <= atRiskThresholdHours) {
            alreadyAtRisk = true;
          } else {
            atRiskDate = now + (hoursRemaining - atRiskThresholdHours) * msPerHour;
          }
        }
      }
    }

    if (breachedDate == null && atRiskDate == null && !alreadyAtRisk && !alreadyBreached) {
      return { ok: false, error: 'No SLA time data for this linked issue. Add an SLA with remaining time to use this action.' };
    }

    const body = buildWarnAssigneeCommentBody({
      linkedIssueKey,
      atRiskDate,
      breachedDate,
      alreadyAtRisk,
      alreadyBreached,
      assigneeAccountId: parentAccountId,
      assigneeDisplayName: parentDisplayName,
    });
    const commentRes = await jira(route`/rest/api/3/issue/${parentIssueKey}/comment`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(body),
    });
    if (!commentRes.ok) {
      const errText = await commentRes.text();
      console.error('[SLA Link Inspector] warnAssigneeSlaDates: failed to add comment', commentRes.status, errText);
      return { ok: false, error: `Failed to post comment: ${commentRes.status}` };
    }
    console.log('[SLA Link Inspector] Resolver: warn-assignee comment posted on parent', parentIssueKey);
    return { ok: true, message: `Warning comment posted on this ticket (${parentIssueKey}).` };
  } catch (e) {
    console.error('[SLA Link Inspector] warnAssigneeSlaDates error', e.message);
    return { ok: false, error: e.message || 'Unknown error' };
  }
});

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
      route`/rest/api/3/issue/${safeIssueKey}?fields=issuelinks,assignee,reporter`
    );
    if (!issueRes.ok) {
      const errText = await issueRes.text();
      console.error('[SLA Link Inspector] Resolver: failed to load issue', issueRes.status, errText);
      return { error: `Failed to load issue: ${issueRes.status} ${errText}`, linkedIssues: [] };
    }

    const issueData = await issueRes.json();
    const parentAssignee = issueData.fields?.assignee;
    const parentReporter = issueData.fields?.reporter;
    const parentPeople = {
      assignee: parentAssignee ? { accountId: parentAssignee.accountId, displayName: parentAssignee.displayName || parentAssignee.name } : null,
      reporter: parentReporter ? { accountId: parentReporter.accountId, displayName: parentReporter.displayName || parentReporter.name } : null,
      watchers: [],
    };
    const configEarly = await getAdminConfig();
    if (configEarly.atRiskNotifyWatchers || configEarly.breachedNotifyWatchers) {
      try {
        const watchersRes = await jira(route`/rest/api/3/issue/${safeIssueKey}/watchers`);
        if (watchersRes.ok) {
          const watchersData = await watchersRes.json();
          const watchersList = watchersData.watchers || [];
          parentPeople.watchers = watchersList.map((w) => ({ accountId: w.accountId, displayName: w.displayName || w.name }));
        }
      } catch {
        // ignore
      }
    }
    const parentAssigneeAccountId = parentAssignee?.accountId ?? null;
    const parentAssigneeDisplayName = parentAssignee?.displayName ?? parentAssignee?.name ?? null;
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
        await maybeCommentOnSlaChange(jira, linked, safeIssueKey, parentPeople);
        await kvs.set(storageKey, linked.slaStatus);
      } catch (e) {
        console.error('[SLA Link Inspector] Resolver: storage/comment error for', linked.key, e.message);
      }
    }

    const config = await getAdminConfig();
    if (config.trigger30MinRemaining) {
      for (const linked of linkedIssues) {
        if (linked.error) continue;
        if (config.onlyNotifyIfOpen && linked.statusCategory === 'done') continue;
        const hr = linked.hoursRemaining;
        if (hr == null || hr <= 0 || hr > 0.5) continue;
        const key30 = `${SLA_STATUS_STORAGE_PREFIX}30min:${linked.key}`;
        try {
          const already = await kvs.get(key30);
          if (already) continue;
          const remainingTimeStr = formatHours(hr) + ' left';
          const template = config.customTemplate || 'Linked ticket {{issueKey}}: 30 minutes remaining. {{assignee}} please review.';
          const mentions30 = buildMentionsForTrigger(config, 'at_risk', parentPeople);
          const commentMentions30 = config.notificationMention ? mentions30 : [];
          const adfBody = templateToAdf(template, {
            issueKey: linked.key,
            slaName: linked.sla || 'SLA',
            remainingTime: remainingTimeStr,
            status: '30 minutes remaining',
          }, commentMentions30);
          if (config.notificationComment) {
            const res = await jira(route`/rest/api/3/issue/${safeIssueKey}/comment`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
              body: JSON.stringify(adfBody),
            });
            if (!res.ok) continue;
            await kvs.set(key30, 'sent');
            console.log('[SLA Link Inspector] Resolver: 30min warning posted on parent for', linked.key);
          } else {
            await kvs.set(key30, 'sent');
          }
          const vars30 = { issueKey: linked.key, slaName: linked.sla || 'SLA', remainingTime: remainingTimeStr, status: '30 minutes remaining' };
          const plain30 = buildPlainTextMessage(config.customTemplate || null, vars30, mentions30) || `Linked ticket ${linked.key}: 30 minutes remaining.`;
          const slackParams30 = getSlackSendParams(config);
          if (config.notificationSlack && slackParams30) {
            if (slackParams30.method === 'webhook') await sendSlackNotification(slackParams30.webhookUrl, plain30);
            else await sendSlackViaWebApi(slackParams30.token, slackParams30.channelId, plain30);
          }
          if (config.notificationEmail && config.emailWebhookUrl) {
            await sendEmailWebhook(config.emailWebhookUrl, {
              event: 'sla_alert',
              parentIssueKey: safeIssueKey,
              linkedIssueKey: linked.key,
              status: '30 minutes remaining',
              slaName: vars30.slaName,
              remainingTime: remainingTimeStr,
              recipients: mentions30.map((m) => ({ accountId: m.accountId, displayName: m.displayName || m.name })),
              message: plain30,
              subject: `SLA 30 min remaining: ${linked.key}`,
            });
          }
        } catch (e) {
          console.error('[SLA Link Inspector] Resolver: 30min comment error for', linked.key, e.message);
        }
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
