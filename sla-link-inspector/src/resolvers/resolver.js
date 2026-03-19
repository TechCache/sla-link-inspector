import Resolver from '@forge/resolver';
import api, { route, getAppContext } from '@forge/api';
import { kvs } from '@forge/kvs';

const resolver = new Resolver();

/** Set to true to temporarily bypass license check (e.g. for screenshots). Set back to false before release. */
const LICENSE_CHECK_BYPASS = true;

/**
 * Get license status for Marketplace paid app. In PRODUCTION, a valid paid license has license?.isActive === true.
 * In DEVELOPMENT/STAGING (or when unlisted), license is undefined — we treat as allowed for development.
 * @returns {{ licensed: boolean, reason?: string, isProduction?: boolean }}
 */
function getLicenseStatus() {
  if (LICENSE_CHECK_BYPASS) return { licensed: true, isProduction: false };
  try {
    const ctx = getAppContext();
    const isProduction = ctx.environmentType === 'PRODUCTION';
    const license = ctx.license;
    if (!isProduction) {
      return { licensed: true, isProduction: false };
    }
    if (license != null && license.isActive === true) {
      return { licensed: true, isProduction: true };
    }
    if (license != null && license.isActive === false) {
      return { licensed: false, reason: 'License is not active.', isProduction: true };
    }
    return { licensed: false, reason: 'A valid license is required. Please upgrade from the Marketplace.', isProduction: true };
  } catch (e) {
    console.error('[SLA Link Inspector] getLicenseStatus error', e?.message);
    return { licensed: true, reason: undefined, isProduction: false };
  }
}

const SLA_STATUS_STORAGE_PREFIX = 'sla-link-inspector:';
const ADMIN_CONFIG_KEY = SLA_STATUS_STORAGE_PREFIX + 'admin-config';

const DEFAULT_ADMIN_CONFIG = {
  triggerAtRisk: true,
  triggerBreached: true,
  /** One-time linked-ticket alerts when parent SLA hits each threshold (time left or breached). */
  timeLeftWarningsEnabled: false,
  /** { amount: number, unit: 'days'|'hours'|'minutes', recipients: 'at_risk'|'breached' }[] — per-threshold recipient set */
  timeLeftWarningThresholds: [],
  // At Risk → who to notify (parent issue's users)
  atRiskNotifyAssignee: true,
  atRiskNotifyReporter: false,
  atRiskNotifyWatchers: false,
  atRiskNotifyRequestParticipants: false,
  // Breached → who to notify (e.g. assignee + team lead / reporter)
  breachedNotifyAssignee: true,
  breachedNotifyReporter: true,
  breachedNotifyWatchers: false,
  breachedNotifyRequestParticipants: false,
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
  notificationSlackDm: false,
  notificationSlackDmEmails: [],
  emailWebhookUrl: '',
  slackWebhookUrl: '',
  slackChannelId: '',
  slackBotToken: '',
  onlyNotifyIfOpen: true,
  atRiskAdditionalMentions: [],
  breachedAdditionalMentions: [],
  // Notify users from parent issue fields (e.g. "Request Participants", "customfield_12345")
  atRiskNotifyFromFields: [],
  breachedNotifyFromFields: [],
  customTemplate: `⚠️ SLA Alert

The SLA is now {{status}}.

Time remaining: {{remainingTime}}

Ticket Priority: {{priority}}

Please review this issue. {{assignee}}`,
  // Optional override when auto-detect doesn't find your SLA field (e.g. different name or language)
  slaFieldId: '',
  slaFieldName: '',
  // Message template for "Send SLA to linked tickets" (comment on linked ticket + Slack). Empty = default format.
  relayCommentTemplate: `Linked ticket {{issueKey}} SLA is now {{slaStatus}}.

Priority: {{priority}}

The date of expiration: {{expiryDate}}.

{{assignee}}`,
};

function migrateTimeLeftWarningsConfig(cfg) {
  const c = { ...cfg };
  if (!Array.isArray(c.timeLeftWarningThresholds)) c.timeLeftWarningThresholds = [];
  if (c.timeLeftWarningThresholds.length === 0 && Array.isArray(c.timeLeftWarningThresholdsDays) && c.timeLeftWarningThresholdsDays.length > 0) {
    c.timeLeftWarningThresholds = c.timeLeftWarningThresholdsDays
      .map((d) => ({ amount: Number(d), unit: 'days' }))
      .filter((x) => Number.isFinite(x.amount) && x.amount > 0);
  }
  if (c.timeLeftWarningThresholds.length === 0 && c.trigger30MinRemaining && c.warningMinutesRemaining != null) {
    const mins = Math.max(1, Math.min(1440, Number(c.warningMinutesRemaining) || 30));
    c.timeLeftWarningThresholds = [{ amount: mins, unit: 'minutes' }];
    c.timeLeftWarningsEnabled = true;
  }
  const hasThresholds = c.timeLeftWarningThresholds.length > 0;
  if (c.timeLeftWarningsEnabled == null) {
    c.timeLeftWarningsEnabled = Boolean(
      (c.trigger30MinRemaining && hasThresholds) || hasThresholds
    );
  }
  return c;
}

function normalizeAdminTemplate(s) {
  return String(s || '')
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .trim();
}

/**
 * Stored config keeps old default templates after we change DEFAULT_ADMIN_CONFIG.
 * If saved text matches a legacy default, use current defaults (admin UI + runtime).
 */
function migrateMessageTemplates(cfg) {
  const c = { ...cfg };
  const autoNow = DEFAULT_ADMIN_CONFIG.customTemplate;
  const relayNow = DEFAULT_ADMIN_CONFIG.relayCommentTemplate;
  const legacyAutomated = new Set([
    normalizeAdminTemplate(`⚠️ SLA Alert

The SLA is now {{status}}.

Time remaining: {{remainingTime}}

Please review this issue. {{assignee}}`),
    normalizeAdminTemplate(`⚠️ SLA Alert

The SLA is now {{status}}.

Time remaining: {{remainingTime}}

Parent priority: {{priority}}

Please review this issue. {{assignee}}`),
  ]);
  const legacyRelay = new Set([
    normalizeAdminTemplate(`Linked ticket {{issueKey}} SLA is now {{slaStatus}}.

The date of expiration: {{expiryDate}}.

{{assignee}}`),
    normalizeAdminTemplate(`Linked ticket {{issueKey}} SLA is now {{slaStatus}}.

Parent priority: {{priority}}

The date of expiration: {{expiryDate}}.

{{assignee}}`),
  ]);
  if (c.customTemplate != null && legacyAutomated.has(normalizeAdminTemplate(c.customTemplate))) {
    c.customTemplate = autoNow;
  }
  if (c.relayCommentTemplate != null && legacyRelay.has(normalizeAdminTemplate(c.relayCommentTemplate))) {
    c.relayCommentTemplate = relayNow;
  }
  return c;
}

function finalizeAdminConfig(cfg) {
  return migrateMessageTemplates(migrateTimeLeftWarningsConfig(cfg));
}

async function getAdminConfig() {
  try {
    const raw = await kvs.get(ADMIN_CONFIG_KEY);
    if (raw != null && typeof raw === 'object') {
      return finalizeAdminConfig({ ...DEFAULT_ADMIN_CONFIG, ...raw });
    }
  } catch {
    // ignore
  }
  return finalizeAdminConfig({ ...DEFAULT_ADMIN_CONFIG });
}

const TIME_LEFT_UNITS = new Set(['days', 'hours', 'minutes']);

/**
 * Parse threshold entry → hours. Returns { hours, amount, unit } or null.
 * Positive amount = "warn when ≤ X left". Negative amount = "warn when breached ≥ |X|" (e.g. -1 days = 1 day past due).
 */
function parseTimeLeftThresholdEntry(entry) {
  const unit =
    entry && TIME_LEFT_UNITS.has(String(entry.unit)) ? String(entry.unit) : 'days';
  const amount = typeof entry?.amount === 'number' ? entry.amount : parseFloat(entry?.amount);
  if (!Number.isFinite(amount) || amount === 0) return null;
  let hours = null;
  if (unit === 'days') {
    if (amount > 0 && (amount > 365 || amount < 0.01)) return null;
    if (amount < 0 && (amount < -365 || amount > -0.01)) return null;
    hours = amount * 24;
  } else if (unit === 'hours') {
    if (amount > 0 && (amount > 8760 || amount < 1 / 60)) return null;
    if (amount < 0 && (amount < -8760 || amount > -1 / 60)) return null;
    hours = amount;
  } else {
    if (amount > 0 && (amount > 525600 || amount < 1)) return null;
    if (amount < 0 && (amount < -525600 || amount > -1)) return null;
    hours = amount / 60;
  }
  if (hours > 0 && (hours <= 0 || hours > 8760)) return null;
  if (hours < 0 && (hours >= 0 || hours < -8760)) return null;
  return { hours: Math.round(hours * 1e8) / 1e8, amount, unit };
}

function normalizeTimeLeftWarningThresholds(arr) {
  if (!Array.isArray(arr)) return [];
  const seen = new Set();
  const out = [];
  for (const e of arr) {
    const p = parseTimeLeftThresholdEntry(e);
    if (!p) continue;
    const recipients = (e.recipients === 'breached' ? 'breached' : 'at_risk');
    const key = `${p.hours}:${recipients}`;
    if (seen.has(key)) continue;
    seen.add(key);
    let amount = p.amount;
    if (p.unit === 'minutes') amount = Math.round(amount);
    if (p.unit === 'days') amount = Math.round(amount * 10000) / 10000;
    if (p.unit === 'hours') amount = Math.round(amount * 1000) / 1000;
    out.push({ hours: p.hours, amount, unit: p.unit, recipients });
  }
  return out.sort((a, b) => a.hours - b.hours);
}

function timeLeftWarningStatusLabel(amount, unit) {
  if (!Number.isFinite(amount) || amount <= 0) return 'threshold';
  if (unit === 'minutes') {
    const m = Math.round(amount);
    return `${m} minute${m === 1 ? '' : 's'} left`;
  }
  if (unit === 'hours') {
    const h = amount % 1 === 0 ? Math.floor(amount) : Math.round(amount * 100) / 100;
    const s = String(h);
    return `${s} hour${Number(h) === 1 ? '' : 's'} left`;
  }
  const r = Math.round(amount * 100) / 100;
  const s = r % 1 === 0 ? String(Math.floor(r)) : String(r);
  return `${s} day${Number(s) === 1 ? '' : 's'} left`;
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
 * Find a custom field ID for SLA by name (case-insensitive).
 * Matches names containing: sla, time to resolution, goal, target, etc.
 * Returns { id, name } or null.
 */
async function findSlaFieldId() {
  const res = await api.asApp().requestJira(route`/rest/api/3/field`);
  if (!res.ok) return null;
  const fields = await res.json();
  const patterns = [
    'sla',
    'time to resolution',
    'time to resolve',
    'time to first response',
    'goal duration',
    'sla goal',
    'resolution time',
    'target time',
    'time remaining',
  ];
  const slaField = fields.find((f) => {
    if (!f.name) return false;
    const name = String(f.name).toLowerCase();
    return patterns.some((p) => name.includes(p));
  });
  return slaField ? { id: slaField.id, name: slaField.name || slaField.id } : null;
}

/**
 * Get SLA field to use: admin override (if set) or auto-detect. Use this for all SLA reads.
 */
async function getSlaFieldForRequest() {
  const config = await getAdminConfig();
  const id = config.slaFieldId != null ? String(config.slaFieldId).trim() : '';
  if (id) {
    return { id, name: (config.slaFieldName != null ? String(config.slaFieldName).trim() : id) || id };
  }
  return await findSlaFieldId();
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
  // Fallback: find any field value that looks like an SLA object (e.g. current issue uses a different custom field)
  if (raw == null && issueFields && typeof issueFields === 'object') {
    for (const value of Object.values(issueFields)) {
      if (value != null && typeof value === 'object' && (
        value.remainingDuration != null ||
        value.currentCycle?.remainingTime != null ||
        value.ongoingCycle?.remainingTime != null ||
        value.targetDate != null ||
        value.dueDate != null ||
        value.ongoingCycle?.targetDate != null
      )) {
        raw = value;
        break;
      }
    }
  }

  // Fallback: Jira/SLM often show SLA as due date on the issue (e.g. "Mar 20 07:33" in sidebar)
  if (raw == null && issueFields && typeof issueFields === 'object' && issueFields.duedate) {
    const due = issueFields.duedate;
    const dueStr = typeof due === 'string' ? due : (due?.value ?? due?.iso ?? null);
    if (dueStr) {
      const dueMs = new Date(dueStr).getTime();
      if (!Number.isNaN(dueMs)) {
        const remainingMs = dueMs - Date.now();
        const hoursRemaining = remainingMs / (1000 * 60 * 60);
        const totalHours = Math.max(0, hoursRemaining) + 1;
        let status = 'within';
        if (hoursRemaining <= 0) status = 'breached';
        else if (hoursRemaining <= totalHours * 0.25) status = 'at_risk';
        const label = 'Time to resolution';
        return { label, status, hoursRemaining, totalHours };
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
    if (remainingMs == null && (raw.targetDate != null || raw.dueDate != null || raw.ongoingCycle?.targetDate != null)) {
      const dateStr = raw.targetDate ?? raw.dueDate ?? raw.ongoingCycle?.targetDate;
      const dateMs = typeof dateStr === 'string' ? new Date(dateStr).getTime() : (dateStr?.epochMillis ?? null);
      if (dateMs != null && !Number.isNaN(dateMs)) remainingMs = dateMs - Date.now();
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

/**
 * Fetch SLA from Jira Service Management API when issue fields don't contain it.
 * GET /rest/servicedeskapi/request/{issueIdOrKey}/sla returns SLAs with ongoingCycle.remainingTime.millis.
 * Returns { label, status, hoursRemaining, totalHours } or null if not JSM or no SLA.
 */
async function getSlaDataFromJsm(jira, issueKey) {
  try {
    const res = await jira(route`/rest/servicedeskapi/request/${issueKey}/sla`);
    if (!res.ok) return null;
    const data = await res.json();
    const values = data?.values;
    if (!Array.isArray(values) || values.length === 0) return null;
    // Prefer "Time to resolution" / "Time To Resolution", else first SLA
    const sla = values.find((s) => /time to resolution/i.test(s?.name || '')) || values[0];
    const cycle = sla?.ongoingCycle;
    if (!cycle) return null;
    const remainingMs = cycle.remainingTime?.millis ?? cycle.remainingTime?.milliseconds;
    if (remainingMs == null) return null;
    const hoursRemaining = remainingMs / (1000 * 60 * 60);
    const goalMs = cycle.goalDuration?.millis ?? cycle.goalDuration?.milliseconds ?? 0;
    const totalHours = goalMs / (1000 * 60 * 60);
    let status = 'within';
    if (cycle.breached === true || hoursRemaining <= 0) status = 'breached';
    else if (totalHours > 0 && hoursRemaining <= totalHours * 0.25) status = 'at_risk';
    const label = sla.name || 'Time to resolution';
    return { label, status, hoursRemaining, totalHours };
  } catch (e) {
    console.error('[SLA Link Inspector] getSlaDataFromJsm error', e?.message);
    return null;
  }
}

function formatHours(hours) {
  const h = Math.abs(hours);
  if (h < 1) return `${Math.round(h * 60)}m`;
  if (h < 24) return `${Math.round(h)}h`;
  return `${Math.round(h / 24)}d`;
}

/**
 * Issue panel SLA summary (parent ticket). variant: at_risk | breached | healthy | unknown
 */
function buildPanelSlaSummary(slaField, sla) {
  const hasField = Boolean(slaField?.id);
  const st = sla?.status ?? 'none';
  const hr = sla?.hoursRemaining;
  const noSlaData = st === 'none' && (hr == null || Number.isNaN(hr));

  if (!hasField && noSlaData) {
    return {
      variant: 'unknown',
      line: 'SLA Status: Not detected',
      configureHint: 'Check SLA field settings in Configure app.',
    };
  }

  if (st === 'breached' || (typeof hr === 'number' && hr < 0)) {
    const overdue = typeof hr === 'number' && hr < 0 ? formatHours(Math.abs(hr)) : '0m';
    return { variant: 'breached', line: `SLA Status: Breached · ${overdue} overdue`, configureHint: null };
  }

  if (st === 'at_risk') {
    const rem = typeof hr === 'number' && hr > 0 ? formatHours(hr) : '—';
    return { variant: 'at_risk', line: `SLA Status: At Risk · ${rem} remaining`, configureHint: null };
  }

  if (st === 'within' || (typeof hr === 'number' && hr > 0)) {
    const rem = typeof hr === 'number' ? formatHours(hr) : '—';
    return { variant: 'healthy', line: `SLA Status: On Track · ${rem} remaining`, configureHint: null };
  }

  if (noSlaData) {
    return {
      variant: 'unknown',
      line: 'SLA Status: Not detected',
      configureHint: hasField ? null : 'Check SLA field settings in Configure app.',
    };
  }

  return { variant: 'unknown', line: 'SLA Status: Not detected', configureHint: null };
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
  const config = await getAdminConfig();
  const licenseStatus = getLicenseStatus();
  const out = { ...config, licenseStatus };
  if (out.slackBotToken != null && String(out.slackBotToken).trim() !== '') {
    out.slackBotToken = '•••••••• (saved)';
  }
  return out;
});

resolver.define('getLicenseStatus', async () => {
  return getLicenseStatus();
});

resolver.define('setAdminConfig', async ({ payload }) => {
  const licenseStatus = getLicenseStatus();
  if (licenseStatus.isProduction && !licenseStatus.licensed) {
    return { ok: false, error: licenseStatus.reason || 'A valid license is required. Please upgrade from the Marketplace.' };
  }
  if (payload == null || typeof payload !== 'object') {
    return { ok: false, error: 'Invalid payload.' };
  }
  const allowed = new Set(Object.keys(DEFAULT_ADMIN_CONFIG));
  const toStore = {};
  for (const [key, value] of Object.entries(payload)) {
    if (!allowed.has(key)) continue;
    if ((key === 'customTemplate' || key === 'relayCommentTemplate') && value != null) toStore[key] = String(value);
    else if (key === 'customUserGroup' && value != null) toStore[key] = String(value).trim();
    else if ((key === 'slackWebhookUrl' || key === 'emailWebhookUrl') && value != null) toStore[key] = String(value).trim();
    else if (key === 'slackChannelId' && value != null) toStore[key] = String(value).trim();
    else if (key === 'slackBotToken') {
      if (Object.prototype.hasOwnProperty.call(payload, 'slackBotToken')) toStore[key] = (value != null ? String(value) : '').trim();
    }
    else if ((key === 'slaFieldId' || key === 'slaFieldName') && value != null) toStore[key] = String(value).trim();
    else if ((key === 'atRiskAdditionalMentions' || key === 'breachedAdditionalMentions') && Array.isArray(value)) {
      const seen = new Set();
      toStore[key] = value
        .filter((m) => m && m.accountId)
        .filter((m) => {
          const id = String(m.accountId);
          if (seen.has(id)) return false;
          seen.add(id);
          return true;
        })
        .map((m) => ({ accountId: String(m.accountId), displayName: m.displayName != null ? String(m.displayName) : '' }));
    }     else if ((key === 'atRiskNotifyFromFields' || key === 'breachedNotifyFromFields') && Array.isArray(value)) {
      toStore[key] = value.map((s) => String(s).trim()).filter(Boolean);
    } else if (key === 'notificationSlackDmEmails' && Array.isArray(value)) {
      toStore[key] = value.map((s) => String(s).trim()).filter(Boolean);
    } else if (key === 'timeLeftWarningThresholds' && Array.isArray(value)) {
      toStore[key] = normalizeTimeLeftWarningThresholds(value).map((t) => ({
        amount: t.amount,
        unit: t.unit,
        recipients: t.recipients === 'breached' ? 'breached' : 'at_risk',
      }));
    } else if (typeof value === 'boolean') toStore[key] = value;
  }
  try {
    const current = await getAdminConfig();
    const next = migrateTimeLeftWarningsConfig({ ...current, ...toStore });
    delete next.trigger30MinRemaining;
    delete next.warningMinutesRemaining;
    delete next.timeLeftWarningThresholdsDays;
    delete next.atRiskNotifyManager;
    delete next.breachedNotifyManager;
    delete next.warningThresholdsRecipients;
    await kvs.set(ADMIN_CONFIG_KEY, next);
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
  const licenseStatus = getLicenseStatus();
  if (licenseStatus.isProduction && !licenseStatus.licensed) {
    return { ok: false, error: licenseStatus.reason || 'A valid license is required. Please upgrade from the Marketplace.' };
  }
  const config = payload && (payload.slackWebhookUrl != null || payload.slackChannelId != null || payload.slackBotToken != null)
    ? payload
    : await getAdminConfig();
  const params = getSlackSendParams(config);
  if (!params) {
    return { ok: false, error: 'Configure either an Incoming Webhook URL or a Bot token + Channel ID in app configuration.' };
  }
  const testMessage = 'Test message. If you see this, your Slack integration is working.';
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
 * Test Slack DM delivery by emailing lookup and DM send.
 * Payload: { email, slackBotToken? }. If slackBotToken omitted, uses saved admin config token.
 */
resolver.define('testSlackDm', async ({ payload, context }) => {
  const licenseStatus = getLicenseStatus();
  if (licenseStatus.isProduction && !licenseStatus.licensed) {
    return { ok: false, error: licenseStatus.reason || 'A valid license is required. Please upgrade from the Marketplace.' };
  }
  const email = (payload?.email != null ? String(payload.email) : '').trim();
  const issueKeyOverride = (payload?.issueKey != null ? String(payload.issueKey) : '').trim();
  const config = (payload && payload.slackBotToken != null) ? payload : await getAdminConfig();
  const token = getSlackBotTokenForDm(config);
  if (!token) return { ok: false, error: 'Missing Slack Bot token. Paste it under “Shared requirement — Bot token (Options 2 & 3)”.' };
  const testMessage = `Test DM. If you see this, Slack DMs are working for this app.`;
  try {
    const attempted = [];
    if (email) {
      const res = await sendSlackDmWithResult(token, email, testMessage);
      if (!res.ok) return { ok: false, error: `Slack DM failed for ${email}: ${res.error}` };
      attempted.push(email);
    }

    // If no explicit email, DM the assignee of the current issue if available; otherwise DM the current Jira user.
    const jira = api.asApp().requestJira.bind(api.asApp());
    let targetAccountId = null;
    const issueKey =
      issueKeyOverride ||
      (context && (context?.extension?.issue?.key || context?.extension?.issueKey || context?.platform?.issueKey || context?.platform?.issue?.key)) ||
      null;
    if (issueKey) {
      try {
        const issueRes = await jira(route`/rest/api/3/issue/${issueKey}?fields=assignee`);
        if (issueRes.ok) {
          const issue = await issueRes.json().catch(() => ({}));
          targetAccountId = issue?.fields?.assignee?.accountId || null;
        }
      } catch {
        // ignore
      }
    }
    if (!targetAccountId) {
      targetAccountId = (context && (context.accountId || context?.principal?.accountId || context?.extension?.accountId)) || null;
    }
    if (targetAccountId) {
      const jiraEmail = await getEmailForJiraAccountId(jira, String(targetAccountId));
      const normalizedPrimary = email ? email.toLowerCase() : '';
      if (jiraEmail && jiraEmail.toLowerCase() !== normalizedPrimary) {
        const res = await sendSlackDmWithResult(token, jiraEmail, testMessage);
        if (!res.ok) return { ok: false, error: `Slack DM failed for ${jiraEmail}: ${res.error}` };
        attempted.push(jiraEmail);
      }
    }

    if (attempted.length === 0) {
      return { ok: false, error: 'No DM target found. Add an email under “Also DM these emails” or run this test from an issue context with an assignee.' };
    }
    return {
      ok: true,
      message: `Test DM attempted to: ${attempted.join(', ')}. Note: the DM will appear to the recipient as a conversation with the SLA Link Inspector app. If you don’t receive it, check Slack scopes (users:read.email, im:write) and that the email matches a workspace member.`,
    };
  } catch (e) {
    return { ok: false, error: e.message || 'Slack DM test failed.' };
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
 * Status label for "Send to linked tickets" message: At-Risk, Breached, in range.
 */
function sendToLinkedStatusLabel(slaStatus) {
  if (slaStatus === 'at_risk') return 'At-Risk';
  if (slaStatus === 'breached') return 'Breached';
  return 'in range';
}

/**
 * Build expiration date string from hoursRemaining (hours). Returns formatted date or "—" if unknown.
 */
function formatExpirationDate(hoursRemaining) {
  if (hoursRemaining == null || typeof hoursRemaining !== 'number') return '—';
  const expMs = Date.now() + hoursRemaining * 60 * 60 * 1000;
  return new Date(expMs).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}

/** Jira priority field → display string for templates. */
function formatParentPriority(priorityField) {
  const n = priorityField?.name;
  if (n != null && String(n).trim()) return String(n).trim();
  return '—';
}

/**
 * Build ADF from relay template. Vars: {{issueKey}}, {{slaStatus}}, {{priority}}, {{expiryDate}}, {{assignee}} (mention nodes).
 */
function relayTemplateToAdf(template, hostIssueKey, statusText, expirationDateStr, mentions, parentPriority) {
  const mentionList = Array.isArray(mentions) ? mentions.filter((m) => m && m.accountId) : [];
  let text = String(template);
  text = text.replace(/\{\{issueKey\}\}/g, hostIssueKey ?? '');
  text = text.replace(/\{\{slaStatus\}\}/g, statusText ?? '');
  text = text.replace(/\{\{priority\}\}/g, parentPriority ?? '—');
  text = text.replace(/\{\{expiryDate\}\}/g, expirationDateStr ?? '');
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
    content.push({ type: 'paragraph', content: [{ type: 'text', text: 'Send SLA Alert to Linked Tickets.' }] });
  }
  return { body: { version: 1, type: 'doc', content } };
}

/**
 * Build plain text from relay template for Slack. Same vars as relayTemplateToAdf; {{assignee}} → @Name list.
 */
function relayTemplateToPlainText(template, hostIssueKey, statusText, expirationDateStr, mentions, parentPriority) {
  let text = String(template);
  text = text.replace(/\{\{issueKey\}\}/g, hostIssueKey ?? '');
  text = text.replace(/\{\{slaStatus\}\}/g, statusText ?? '');
  text = text.replace(/\{\{priority\}\}/g, parentPriority ?? '—');
  text = text.replace(/\{\{expiryDate\}\}/g, expirationDateStr ?? '');
  const names = Array.isArray(mentions) ? mentions.map((m) => m?.displayName || m?.name || 'user').filter(Boolean) : [];
  text = text.replace(/\{\{assignee\}\}/g, names.length > 0 ? names.map((n) => `@${n}`).join(' ') : '');
  return text.replace(/\n\n+/g, '\n').trim();
}

/**
 * Build ADF comment body for "Send to linked tickets": uses relayCommentTemplate if set, else default.
 */
function buildSendToLinkedSlaCommentBody(hostIssueKey, slaStatus, expirationDateStr, mentions, relayTemplate, parentPriority) {
  const statusText = sendToLinkedStatusLabel(slaStatus);
  const pri = parentPriority ?? '—';
  if (relayTemplate && String(relayTemplate).trim() !== '') {
    return relayTemplateToAdf(relayTemplate, hostIssueKey, statusText, expirationDateStr, mentions, pri);
  }
  const content = [
    { type: 'text', text: 'Linked ticket ', marks: [] },
    { type: 'text', text: hostIssueKey, marks: [{ type: 'strong' }] },
    { type: 'text', text: ' SLA is now ', marks: [] },
    { type: 'text', text: statusText, marks: [{ type: 'strong' }] },
    { type: 'text', text: `. Priority: ${pri}. The date of expiration: `, marks: [] },
    { type: 'text', text: expirationDateStr, marks: [] },
    { type: 'text', text: ' ', marks: [] },
  ];
  if (Array.isArray(mentions) && mentions.length > 0) {
    for (const m of mentions) {
      if (m && m.accountId) {
        content.push({ type: 'mention', attrs: { id: m.accountId, text: `@${m.displayName || m.name || 'user'}` } });
        content.push({ type: 'text', text: ' ', marks: [] });
      }
    }
  }
  content.push({ type: 'text', text: '.', marks: [] });
  return {
    body: {
      version: 1,
      type: 'doc',
      content: [{ type: 'paragraph', content }],
    },
  };
}

/**
 * Build plain text for Slack: uses relayCommentTemplate if set, else default.
 */
function buildSendToLinkedSlackText(hostIssueKey, slaStatus, expirationDateStr, mentions, relayTemplate, parentPriority) {
  const statusText = sendToLinkedStatusLabel(slaStatus);
  const pri = parentPriority ?? '—';
  if (relayTemplate && String(relayTemplate).trim() !== '') {
    return relayTemplateToPlainText(relayTemplate, hostIssueKey, statusText, expirationDateStr, mentions, pri);
  }
  const names = Array.isArray(mentions) ? mentions.map((m) => m?.displayName || m?.name || 'user').filter(Boolean) : [];
  const mentionStr = names.length > 0 ? names.map((n) => `@${n}`).join(' ') + ' ' : '';
  return `Linked ticket ${hostIssueKey} SLA is now ${statusText}. Priority: ${pri}. The date of expiration: ${expirationDateStr}. ${mentionStr}`.trim();
}

/**
 * Get Jira site base URL (e.g. https://yoursite.atlassian.net) for building browse links. Returns null on failure.
 */
async function getJiraBaseUrl(jira) {
  try {
    const res = await jira(route`/rest/api/3/serverInfo`);
    if (!res.ok) return null;
    const data = await res.json();
    const base = data?.baseUrl;
    return typeof base === 'string' && base.trim() ? base.replace(/\/$/, '') : null;
  } catch (e) {
    console.error('[SLA Link Inspector] getJiraBaseUrl error', e?.message);
    return null;
  }
}

/**
 * Build "Posted to: <url|KEY>, ..." for Slack mrkdwn so ticket keys are clickable links.
 */
function buildSlackPostedToLinks(baseUrl, issueKeys) {
  if (!Array.isArray(issueKeys) || issueKeys.length === 0) return '';
  if (!baseUrl) return ` (Posted to: ${issueKeys.join(', ')}.)`;
  const links = issueKeys.map((key) => `<${baseUrl}/browse/${encodeURIComponent(key)}|${key}>`);
  return ` (Posted to: ${links.join(', ')}.)`;
}

/**
 * Build ADF body for a comment on a linked ticket when we could not read the current issue's SLA.
 * Notifies the linked ticket that it is linked to currentIssueKey and @mentions assignee.
 */
function buildLinkedIssueNoticeCommentBody(currentIssueKey, mentions) {
  const content = [
    { type: 'text', text: 'This ticket is linked to ', marks: [] },
    { type: 'text', text: currentIssueKey, marks: [{ type: 'strong' }] },
    { type: 'text', text: '. View that issue in Jira for SLA status and details. ', marks: [] },
  ];
  if (Array.isArray(mentions) && mentions.length > 0) {
    for (const m of mentions) {
      if (m && m.accountId) {
        content.push({ type: 'mention', attrs: { id: m.accountId, text: `@${m.displayName || m.name || 'user'}` } });
        content.push({ type: 'text', text: ' ', marks: [] });
      }
    }
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
 * Build ADF body for a comment (posted on a linked ticket) about the parent ticket's SLA going at-risk or breached.
 * issueKeyWithSla = parent issue key; mentions = linked ticket's people.
 */
function buildSlaAlertCommentBody(issueKeyWithSla, slaStatus, mentions, opts = {}) {
  const { slaName = '', remainingTime = '', customTemplate, priority = '—' } = opts;
  const statusText = slaStatus === 'breached' ? 'breached' : (slaStatus === 'at_risk' ? 'at risk' : slaStatus);
  const vars = {
    issueKey: issueKeyWithSla,
    slaName: slaName || 'SLA',
    remainingTime: remainingTime || (slaStatus === 'breached' ? 'Overdue' : '—'),
    status: statusText,
    priority: priority || '—',
  };
  if (customTemplate && String(customTemplate).trim() !== '') {
    return templateToAdf(customTemplate, vars, mentions);
  }
  const pri = vars.priority || '—';
  const content = [
    { type: 'text', text: 'Parent ticket ' },
    { type: 'text', text: issueKeyWithSla, marks: [{ type: 'strong' }] },
    { type: 'text', text: "'s SLA is now " },
    { type: 'text', text: statusText, marks: [{ type: 'strong' }] },
    { type: 'text', text: `. Ticket Priority: ${pri}. ` },
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
 * Convert a template string with {{variables}} into ADF. Supports {{issueKey}}, {{slaName}}, {{remainingTime}}, {{status}}, {{priority}}, {{assignee}}.
 * {{assignee}} is replaced with one or more ADF mention nodes. mentions = [{ accountId, displayName }, ...] (parent issue assignee, reporter, watchers as configured).
 */
function templateToAdf(template, vars, mentions) {
  const mentionList = Array.isArray(mentions) ? mentions.filter((m) => m && m.accountId) : [];
  let text = String(template);
  text = text.replace(/\{\{issueKey\}\}/g, vars.issueKey ?? '');
  text = text.replace(/\{\{slaName\}\}/g, vars.slaName ?? '');
  text = text.replace(/\{\{remainingTime\}\}/g, vars.remainingTime ?? '');
  text = text.replace(/\{\{status\}\}/g, vars.status ?? '');
  text = text.replace(/\{\{priority\}\}/g, vars.priority ?? '—');
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
 * Comment is posted on the parent issue. linkedIssueKey identifies the linked ticket.
 * @param {object} opts - { linkedIssueKey, atRiskDate, breachedDate, alreadyAtRisk, alreadyBreached }
 */
function buildWarnAssigneeCommentBody(opts) {
  const {
    linkedIssueKey,
    atRiskDate,
    breachedDate,
    alreadyAtRisk,
    alreadyBreached,
  } = opts;
  const formatDate = (d) => (d != null ? new Date(d).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }) : null);
  const ticketRef = linkedIssueKey ? `Linked ticket ${linkedIssueKey}'s SLA` : 'This ticket\'s SLA';
  const content = [{ type: 'text', text: 'SLA status: ', marks: [{ type: 'strong' }] }];
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

/**
 * Resolve field names or IDs (e.g. "Request Participants", "customfield_10001") to Jira field IDs.
 * Returns a Map: userInput -> fieldId (for requesting in issue fields).
 */
async function resolveNotifyFromFieldIds(jira, namesOrIds) {
  const inputs = Array.isArray(namesOrIds) ? namesOrIds.map((s) => String(s).trim()).filter(Boolean) : [];
  if (inputs.length === 0) return new Map();
  const byId = new Map();
  const byName = new Map();
  try {
    const res = await jira(route`/rest/api/3/field`);
    if (!res.ok) return byId;
    const fields = await res.json();
    for (const f of fields || []) {
      const id = f.id;
      const name = f.name != null ? String(f.name).trim().toLowerCase() : '';
      if (id) byId.set(id.toLowerCase(), id);
      if (name) byName.set(name, id);
    }
  } catch (e) {
    console.error('[SLA Link Inspector] resolveNotifyFromFieldIds error', e?.message);
    return new Map();
  }
  const result = new Map();
  for (const input of inputs) {
    if (/^customfield_\d+$/i.test(input)) {
      result.set(input, input);
      continue;
    }
    const id = byId.get(input.toLowerCase()) ?? byName.get(input.toLowerCase());
    if (id) result.set(input, id);
  }
  return result;
}

/** Cached Jira field id for JSM "Request participants" (null = not found). */
const _rpFieldCacheUnset = {};
let _cachedRequestParticipantsFieldId = _rpFieldCacheUnset;
async function resolveRequestParticipantsFieldId(jira) {
  if (_cachedRequestParticipantsFieldId !== _rpFieldCacheUnset) {
    return _cachedRequestParticipantsFieldId;
  }
  _cachedRequestParticipantsFieldId = null;
  try {
    const res = await jira(route`/rest/api/3/field`);
    if (!res.ok) return null;
    const fields = await res.json();
    const list = fields || [];
    const exact = list.find((f) => f && f.name && String(f.name).trim().toLowerCase() === 'request participants');
    const fuzzy = exact || list.find((f) => f && f.name && /request participant/i.test(String(f.name)));
    if (fuzzy?.id) _cachedRequestParticipantsFieldId = fuzzy.id;
    return _cachedRequestParticipantsFieldId;
  } catch (e) {
    console.error('[SLA Link Inspector] resolveRequestParticipantsFieldId', e?.message);
  }
  return null;
}

/**
 * Build mention-people (assignee, reporter, watchers, request participants) from a single issue.
 */
async function buildMentionPeopleFromIssue(jira, issueKey, config, resolvedNotifyFields) {
  const out = {
    assignee: null,
    reporter: null,
    watchers: [],
    fieldUsers: {},
    requestParticipants: [],
  };
  const needRp =
    config &&
    (config.atRiskNotifyRequestParticipants || config.breachedNotifyRequestParticipants);
  let rpFieldId = null;
  if (needRp) {
    rpFieldId = await resolveRequestParticipantsFieldId(jira);
  }
  const fromMap = resolvedNotifyFields && resolvedNotifyFields.size > 0 ? [...resolvedNotifyFields.values()] : [];
  const fieldIds = ['assignee', 'reporter', ...fromMap];
  if (rpFieldId) fieldIds.push(rpFieldId);
  const fieldsQuery = [...new Set(fieldIds)].join(',');
  try {
    const res = await jira(route`/rest/api/3/issue/${issueKey}?fields=${fieldsQuery}`);
    if (!res.ok) return out;
    const issue = await res.json();
    const assignee = issue.fields?.assignee;
    const reporter = issue.fields?.reporter;
    out.assignee = assignee ? { accountId: assignee.accountId, displayName: assignee.displayName || assignee.name } : null;
    out.reporter = reporter ? { accountId: reporter.accountId, displayName: reporter.displayName || reporter.name } : null;
    if (resolvedNotifyFields && resolvedNotifyFields.size > 0) {
      for (const [userInput, fieldId] of resolvedNotifyFields) {
        const val = issue.fields?.[fieldId];
        out.fieldUsers[userInput] = extractUsersFromFieldValue(val);
      }
    }
    if (rpFieldId && issue.fields?.[rpFieldId] != null) {
      out.requestParticipants = extractUsersFromFieldValue(issue.fields[rpFieldId]);
    }
    if (config && (config.atRiskNotifyWatchers || config.breachedNotifyWatchers)) {
      try {
        const wRes = await jira(route`/rest/api/3/issue/${issueKey}/watchers`);
        if (wRes.ok) {
          const wData = await wRes.json();
          out.watchers = (wData.watchers || []).map((w) => ({ accountId: w.accountId, displayName: w.displayName || w.name }));
        }
      } catch {
        // ignore
      }
    }
  } catch (e) {
    console.error('[SLA Link Inspector] buildMentionPeopleFromIssue error', issueKey, e?.message);
  }
  return out;
}

/**
 * Extract user list from a Jira field value (single user or array of users).
 */
function extractUsersFromFieldValue(value) {
  if (value == null) return [];
  if (Array.isArray(value)) {
    return value
      .filter((u) => u && u.accountId)
      .map((u) => ({ accountId: u.accountId, displayName: u.displayName || u.name || 'user' }));
  }
  if (value.accountId) {
    return [{ accountId: value.accountId, displayName: value.displayName || value.name || 'user' }];
  }
  return [];
}

function buildMentionsForTrigger(config, trigger, parentPeople) {
  const list = [];
  const assignee = parentPeople?.assignee;
  const reporter = parentPeople?.reporter;
  const watchers = Array.isArray(parentPeople?.watchers) ? parentPeople.watchers : [];
  const fieldUsers = parentPeople?.fieldUsers || {};
  const rp = Array.isArray(parentPeople?.requestParticipants) ? parentPeople.requestParticipants : [];
  const isAtRisk = trigger === 'at_risk';
  if (isAtRisk) {
    if (config.atRiskNotifyAssignee && assignee?.accountId) list.push({ accountId: assignee.accountId, displayName: assignee.displayName || assignee.name });
    if (config.atRiskNotifyReporter && reporter?.accountId) list.push({ accountId: reporter.accountId, displayName: reporter.displayName || reporter.name });
    if (config.atRiskNotifyWatchers) list.push(...watchers.filter((w) => w?.accountId));
    if (config.atRiskNotifyRequestParticipants) list.push(...rp.filter((u) => u?.accountId));
    const extra = Array.isArray(config.atRiskAdditionalMentions) ? config.atRiskAdditionalMentions : [];
    list.push(...extra.filter((m) => m && m.accountId));
    const fromFields = Array.isArray(config.atRiskNotifyFromFields) ? config.atRiskNotifyFromFields : [];
    for (const key of fromFields) {
      list.push(...(fieldUsers[key] || []));
    }
  } else {
    if (config.breachedNotifyAssignee && assignee?.accountId) list.push({ accountId: assignee.accountId, displayName: assignee.displayName || assignee.name });
    if (config.breachedNotifyReporter && reporter?.accountId) list.push({ accountId: reporter.accountId, displayName: reporter.displayName || reporter.name });
    if (config.breachedNotifyWatchers) list.push(...watchers.filter((w) => w?.accountId));
    if (config.breachedNotifyRequestParticipants) list.push(...rp.filter((u) => u?.accountId));
    const extra = Array.isArray(config.breachedAdditionalMentions) ? config.breachedAdditionalMentions : [];
    list.push(...extra.filter((m) => m && m.accountId));
    const fromFields = Array.isArray(config.breachedNotifyFromFields) ? config.breachedNotifyFromFields : [];
    for (const key of fromFields) {
      list.push(...(fieldUsers[key] || []));
    }
  }
  const seen = new Set();
  return list.filter((m) => {
    if (!m || !m.accountId) return false;
    if (seen.has(m.accountId)) return false;
    seen.add(m.accountId);
    return true;
  });
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
  text = text.replace(/\{\{priority\}\}/g, vars.priority ?? '—');
  const names = Array.isArray(mentions) ? mentions.map((m) => m?.displayName || m?.name || 'user').filter(Boolean) : [];
  text = text.replace(/\{\{assignee\}\}/g, names.length > 0 ? names.join(', ') : '');
  return text.replace(/\n\n+/g, '\n').trim();
}

/**
 * Send Slack notification via incoming webhook. Payload: { text } or { attachments } when mrkdwn.
 * @param {object} [opts] - { mrkdwn: true } to render message as mrkdwn (e.g. clickable <url|text> links).
 */
async function sendSlackNotification(webhookUrl, message, opts = {}) {
  const url = (webhookUrl || '').trim();
  if (!url || !url.startsWith('https://hooks.slack.com/')) return;
  try {
    const body = opts.mrkdwn
      ? { attachments: [{ text: message, mrkdwn_in: ['text'] }] }
      : { text: message };
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
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
 * @param {object} [opts] - { mrkdwn: true } to render message as mrkdwn (e.g. clickable <url|text> links).
 */
async function sendSlackViaWebApi(botToken, channelId, message, opts = {}) {
  const token = (botToken || '').trim();
  const channel = (channelId || '').trim();
  if (!token || !channel) return;
  try {
    const payload = opts.mrkdwn
      ? { channel, text: message, blocks: [{ type: 'section', text: { type: 'mrkdwn', text: message } }] }
      : { channel, text: message };
    const res = await fetch('https://slack.com/api/chat.postMessage', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(payload),
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
 * Get Jira user email by accountId (for Slack DM lookup). Returns email string or null.
 */
async function getEmailForJiraAccountId(jira, accountId) {
  if (!jira || !accountId) return null;
  try {
    const res = await jira(route`/rest/api/3/user?accountId=${encodeURIComponent(accountId)}`, {
      headers: { Accept: 'application/json' },
    });
    if (!res.ok) return null;
    const user = await res.json();
    return (user && user.emailAddress) ? String(user.emailAddress).trim() : null;
  } catch {
    return null;
  }
}

/**
 * Send a DM to a Slack user by email: users.lookupByEmail → conversations.open → chat.postMessage.
 * Best-effort; logs and returns on errors (no throw). Requires bot token with users:read.email and im:write.
 */
async function sendSlackDm(botToken, email, message) {
  const token = (botToken || '').trim();
  const e = (email || '').trim().toLowerCase();
  if (!token || !e) return;
  try {
    const lookupRes = await fetch(`https://slack.com/api/users.lookupByEmail?email=${encodeURIComponent(e)}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const lookupData = await lookupRes.json().catch(() => ({}));
    if (!lookupData.ok || !lookupData.user?.id) {
      if (lookupData.error !== 'users_not_found') console.error('[SLA Link Inspector] Slack DM lookup failed for', e, lookupData.error);
      return;
    }
    const userId = lookupData.user.id;
    const openRes = await fetch('https://slack.com/api/conversations.open', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      // Slack expects `users` as a comma-separated string (or single user ID), not an array.
      body: JSON.stringify({ users: userId }),
    });
    const openData = await openRes.json().catch(() => ({}));
    if (!openData.ok || !openData.channel?.id) {
      console.error('[SLA Link Inspector] Slack DM conversations.open failed', openData.error);
      return;
    }
    const channelId = openData.channel.id;
    const postRes = await fetch('https://slack.com/api/chat.postMessage', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ channel: channelId, text: message }),
    });
    const postData = await postRes.json().catch(() => ({}));
    if (!postData.ok) console.error('[SLA Link Inspector] Slack DM post failed', postData.error);
  } catch (err) {
    console.error('[SLA Link Inspector] Slack DM error', err.message);
  }
}

/**
 * Same as sendSlackDm, but returns a result for tests/diagnostics.
 */
async function sendSlackDmWithResult(botToken, email, message) {
  const token = (botToken || '').trim();
  const e = (email || '').trim().toLowerCase();
  if (!token) return { ok: false, error: 'missing_token' };
  if (!e) return { ok: false, error: 'missing_email' };
  try {
    const lookupRes = await fetch(`https://slack.com/api/users.lookupByEmail?email=${encodeURIComponent(e)}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const lookupData = await lookupRes.json().catch(() => ({}));
    if (!lookupData.ok || !lookupData.user?.id) {
      return { ok: false, error: lookupData.error || 'lookup_failed' };
    }
    const userId = lookupData.user.id;
    const openRes = await fetch('https://slack.com/api/conversations.open', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ users: userId }),
    });
    const openData = await openRes.json().catch(() => ({}));
    if (!openData.ok || !openData.channel?.id) {
      return { ok: false, error: openData.error || 'open_failed' };
    }
    const channelId = openData.channel.id;
    const postRes = await fetch('https://slack.com/api/chat.postMessage', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ channel: channelId, text: message }),
    });
    const postData = await postRes.json().catch(() => ({}));
    if (!postData.ok) {
      return { ok: false, error: postData.error || 'post_failed' };
    }
    return { ok: true, userId, channelId };
  } catch (err) {
    return { ok: false, error: err.message || 'error' };
  }
}

/**
 * Resolve how to send to Slack: webhook URL takes precedence; else Bot token + Channel ID from admin config.
 * Returns { method: 'webhook', webhookUrl } | { method: 'api', token, channelId } | null.
 * Channel posting only runs when both token and channelId are set.
 */
function getSlackSendParams(config) {
  const webhookUrl = (config.slackWebhookUrl || '').trim();
  if (webhookUrl && webhookUrl.startsWith('https://hooks.slack.com/')) {
    return { method: 'webhook', webhookUrl };
  }
  const token = (config.slackBotToken || '').trim();
  const channelId = (config.slackChannelId || '').trim();
  if (token && channelId) return { method: 'api', token, channelId };
  return null;
}

/** Bot token for DMs only (no channel needed). DMs work for any workspace member by email. */
function getSlackBotTokenForDm(config) {
  const token = (config.slackBotToken || '').trim();
  return token || null;
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
 * When the parent ticket's SLA is at-risk or breached, post a comment on the linked ticket about the parent's SLA
 * and @mention the linked ticket's people. Comment is posted on linkedIssueKey; message is about parentIssueKey's SLA.
 */
async function maybeCommentOnSlaChange(
  jira,
  parentIssueKey,
  parentSla,
  linkedIssueKey,
  linkedStatusCategory,
  mentionPeople,
  forcePost = false,
  parentPriorityLabel = '—'
) {
  const slaStatus = parentSla?.status;
  if (slaStatus !== 'at_risk' && slaStatus !== 'breached') return;
  const config = await getAdminConfig();
  if (slaStatus === 'at_risk' && !config.triggerAtRisk) return;
  if (slaStatus === 'breached' && !config.triggerBreached) return;
  if (config.onlyNotifyIfOpen && linkedStatusCategory === 'done') return;
  const storageKey = `${SLA_STATUS_STORAGE_PREFIX}${parentIssueKey}:${linkedIssueKey}`;
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
  const hoursRemaining = parentSla?.hoursRemaining;
  const slaLabel = parentSla?.sla;
  try {
    const remainingTimeStr = hoursRemaining != null
      ? (hoursRemaining > 0 ? formatHours(hoursRemaining) + ' left' : formatHours(-hoursRemaining) + ' overdue')
      : '—';
    const mentions = buildMentionsForTrigger(config, slaStatus, mentionPeople);
    const commentMentions = config.notificationMention ? mentions : [];
    const body = buildSlaAlertCommentBody(parentIssueKey, slaStatus, commentMentions, {
      slaName: slaLabel || 'SLA',
      remainingTime: remainingTimeStr,
      customTemplate: config.customTemplate || null,
      priority: parentPriorityLabel,
    });
    if (config.notificationComment) {
      const res = await jira(route`/rest/api/3/issue/${linkedIssueKey}/comment`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        console.error('[SLA Link Inspector] Resolver: failed to add comment on linked', linkedIssueKey, res.status, await res.text());
        return;
      }
      console.log('[SLA Link Inspector] Resolver: added parent SLA alert comment on linked', linkedIssueKey, slaStatus);
    }
    const vars = {
      issueKey: parentIssueKey,
      slaName: slaLabel || 'SLA',
      remainingTime: remainingTimeStr,
      status: slaStatus === 'breached' ? 'breached' : 'at risk',
      priority: parentPriorityLabel,
    };
    const plainText = buildPlainTextMessage(config.customTemplate || null, vars, mentions);
    const defaultMsg = `Parent ticket ${parentIssueKey}'s SLA is now ${vars.status}. Ticket Priority: ${parentPriorityLabel}. Time remaining: ${remainingTimeStr}.`;
    const messageForChannels = plainText || defaultMsg;
    const slackParams = getSlackSendParams(config);
    if (config.notificationSlack && slackParams) {
      if (slackParams.method === 'webhook') await sendSlackNotification(slackParams.webhookUrl, messageForChannels);
      else await sendSlackViaWebApi(slackParams.token, slackParams.channelId, messageForChannels);
    }
    const dmEnabled = config.notificationSlackDm || (Array.isArray(config.notificationSlackDmEmails) && config.notificationSlackDmEmails.length > 0);
    const dmToken = getSlackBotTokenForDm(config);
    if (dmEnabled && dmToken) {
      const dmSent = new Set();
      if (config.notificationSlackDm && Array.isArray(mentions)) {
        for (const m of mentions) {
          if (!m?.accountId) continue;
          const email = await getEmailForJiraAccountId(jira, m.accountId);
          if (email && !dmSent.has(email.toLowerCase())) {
            dmSent.add(email.toLowerCase());
            await sendSlackDm(dmToken, email, messageForChannels);
          }
        }
      }
      const extraEmails = Array.isArray(config.notificationSlackDmEmails) ? config.notificationSlackDmEmails : [];
      for (const email of extraEmails) {
        const e = (email && String(email).trim()) || '';
        if (e && !dmSent.has(e.toLowerCase())) {
          dmSent.add(e.toLowerCase());
          await sendSlackDm(dmToken, e, messageForChannels);
        }
      }
    }
    if (config.notificationEmail && config.emailWebhookUrl) {
      await sendEmailWebhook(config.emailWebhookUrl, {
        event: 'sla_alert',
        parentIssueKey,
        linkedIssueKey,
        status: vars.status,
        slaName: vars.slaName,
        remainingTime: remainingTimeStr,
        parentPriority: parentPriorityLabel,
        recipients: mentions.map((m) => ({ accountId: m.accountId, displayName: m.displayName || m.name })),
        message: messageForChannels,
        subject: `SLA ${vars.status}: ${parentIssueKey}`,
      });
    }
    if (!forcePost) {
      try {
        await kvs.set(storageKey, slaStatus);
      } catch {
        // ignore
      }
    }
  } catch (e) {
    console.error('[SLA Link Inspector] Resolver: error adding comment on linked', linkedIssueKey, e.message);
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
    const slaField = await getSlaFieldForRequest();
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
 * Test helper: post the parent's SLA alert comment on the linked ticket, @mentioning the linked ticket's people.
 * Payload: { parentIssueKey, linkedIssueKey }. Parent's SLA must be at_risk or breached.
 */
resolver.define('testFireSlaComment', async ({ payload }) => {
  const linkedIssueKey = payload?.linkedIssueKey != null ? String(payload.linkedIssueKey).trim() : '';
  const parentIssueKey = payload?.parentIssueKey != null ? String(payload.parentIssueKey).trim() : '';
  if (!linkedIssueKey) return { ok: false, error: 'Missing linkedIssueKey.' };
  if (!parentIssueKey) return { ok: false, error: 'Missing parentIssueKey.' };
  try {
    const jira = api.asApp().requestJira.bind(api.asApp());
    const slaField = await getSlaFieldForRequest();
    const parentFieldsParam = ['summary', 'status', 'priority'];
    if (slaField?.id) parentFieldsParam.push(slaField.id);
    const parentFieldsQuery = parentFieldsParam.join(',');
    const cfg = await getAdminConfig();
    const resolvedNotifyFields = new Map();
    const [parentRes, linkedRes] = await Promise.all([
      jira(route`/rest/api/3/issue/${parentIssueKey}?fields=${parentFieldsQuery}`),
      jira(route`/rest/api/3/issue/${linkedIssueKey}?fields=status`),
    ]);
    if (!parentRes.ok) return { ok: false, error: `Failed to load parent issue: ${parentRes.status}` };
    if (!linkedRes.ok) return { ok: false, error: `Failed to load linked issue: ${linkedRes.status}` };
    const parentIssue = await parentRes.json();
    const linkedIssue = await linkedRes.json();
    const parentSla = getSlaData(parentIssue.fields, slaField);
    if (parentSla.status !== 'at_risk' && parentSla.status !== 'breached') {
      return { ok: false, error: `Parent's SLA is not at_risk or breached (current: ${parentSla.status}).` };
    }
    const linkedStatusCategory = linkedIssue.fields?.status?.statusCategory?.key ?? null;
    const linkedPeople = await buildMentionPeopleFromIssue(jira, linkedIssueKey, cfg, resolvedNotifyFields);
    const parentPri = formatParentPriority(parentIssue.fields?.priority);
    await maybeCommentOnSlaChange(jira, parentIssueKey, parentSla, linkedIssueKey, linkedStatusCategory, linkedPeople, true, parentPri);
    return { ok: true, message: `Comment posted on linked ticket ${linkedIssueKey} (parent ${parentIssueKey} SLA: ${parentSla.status}).` };
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
  const licenseStatus = getLicenseStatus();
  if (licenseStatus.isProduction && !licenseStatus.licensed) {
    return { ok: false, error: licenseStatus.reason || 'A valid license is required. Please upgrade from the Marketplace.' };
  }
  const linkedIssueKey = payload?.linkedIssueKey != null ? String(payload.linkedIssueKey).trim() : '';
  const parentIssueKey = payload?.parentIssueKey != null ? String(payload.parentIssueKey).trim() : '';
  if (!linkedIssueKey) return { ok: false, error: 'Missing linkedIssueKey.' };
  if (!parentIssueKey) return { ok: false, error: 'Missing parentIssueKey.' };
  try {
    const jira = api.asApp().requestJira.bind(api.asApp());
    const slaField = await getSlaFieldForRequest();
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
      // Linked issue has no SLA time data; post a short note and point to the other action
      const noDataBody = {
        body: {
          version: 1,
          type: 'doc',
          content: [{
            type: 'paragraph',
            content: [
              { type: 'text', text: 'Linked ticket ', marks: [] },
              { type: 'text', text: linkedIssueKey, marks: [{ type: 'strong' }] },
              { type: 'text', text: ' has no SLA remaining time data. Use the "Send SLA to linked tickets" button above to post this issue\'s SLA to linked tickets.', marks: [] },
            ],
          }],
        },
      };
      const noDataRes = await jira(route`/rest/api/3/issue/${parentIssueKey}/comment`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify(noDataBody),
      });
      if (!noDataRes.ok) {
        return { ok: false, error: `Failed to post comment: ${noDataRes.status}` };
      }
      return { ok: true, message: `Comment posted: linked ticket ${linkedIssueKey} has no SLA time data. Use "Send SLA to linked tickets" to post this issue's SLA.` };
    }

    const body = buildWarnAssigneeCommentBody({
      linkedIssueKey,
      atRiskDate,
      breachedDate,
      alreadyAtRisk,
      alreadyBreached,
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

/**
 * Test: post the current issue's SLA info as a comment on each linked ticket and @mention the linked ticket's assignee.
 * Use this to verify the app can post comments to linked issues (e.g. cross-project). Payload: { issueKey }.
 * Returns { ok, posted: string[], failed: { key, error }[] }.
 * Payload: { issueKey, targetKeys?: string[] }. If targetKeys is provided and non-empty, only those linked keys are used.
 */
resolver.define('notifyLinkedTicketsOfCurrentSla', async ({ payload }) => {
  const licenseStatus = getLicenseStatus();
  if (licenseStatus.isProduction && !licenseStatus.licensed) {
    return { ok: false, error: licenseStatus.reason || 'A valid license is required.', posted: [], failed: [] };
  }
  const currentIssueKey = payload?.issueKey != null ? String(payload.issueKey).trim() : '';
  if (!currentIssueKey) return { ok: false, error: 'Missing issueKey.', posted: [], failed: [] };
  const targetKeysFromPayload = Array.isArray(payload?.targetKeys) ? payload.targetKeys : (payload?.targetKeys != null ? [payload.targetKeys] : null);
  try {
    const jira = api.asApp().requestJira.bind(api.asApp());
    const slaField = await getSlaFieldForRequest();
    // Fetch issuelinks with same request as panel (fields=issuelinks) so we see the same linked issues
    const linksRes = await jira(
      route`/rest/api/3/issue/${currentIssueKey}?fields=issuelinks`
    );
    if (!linksRes.ok) {
      return { ok: false, error: `Failed to load current issue: ${linksRes.status}`, posted: [], failed: [] };
    }
    const linksData = await linksRes.json();
    const links = linksData.fields?.issuelinks || [];
    const linkedKeysSet = new Set();
    for (const link of links) {
      const linked = link.outwardIssue || link.inwardIssue;
      const key = linked?.key;
      if (key != null) linkedKeysSet.add(String(key).trim());
    }
    if (linkedKeysSet.size === 0) {
      return { ok: true, message: 'No linked issues.', posted: [], failed: [] };
    }
    // Restrict to targetKeys if provided (only post to keys that are actually linked)
    let keysToPost = [...linkedKeysSet];
    if (targetKeysFromPayload != null && targetKeysFromPayload.length > 0) {
      const wanted = new Set(targetKeysFromPayload.map((k) => String(k).trim()).filter(Boolean));
      keysToPost = keysToPost.filter((k) => wanted.has(k));
      if (keysToPost.length === 0) {
        return { ok: false, error: 'None of the specified tickets are linked to this issue.', posted: [], failed: [] };
      }
    }
    // Fetch current issue: explicit SLA field when we have one, else fields=* so getSlaData can use duedate/value-shape fallbacks.
    const currentFieldsParam = ['summary', 'status', 'assignee', 'priority'];
    if (slaField?.id) currentFieldsParam.push(slaField.id);
    const currentRes = await jira(
      route`/rest/api/3/issue/${currentIssueKey}?fields=${slaField?.id ? currentFieldsParam.join(',') : '*'}`
    );
    if (!currentRes.ok) {
      return { ok: false, error: `Failed to load current issue SLA: ${currentRes.status}`, posted: [], failed: [] };
    }
    const currentIssue = await currentRes.json();
    const relayParentPriority = formatParentPriority(currentIssue.fields?.priority);
    let currentSla = getSlaData(currentIssue.fields, slaField);
    const hasSlaFromFields = currentSla.status !== 'none' || (currentSla.label != null && !String(currentSla.label).toLowerCase().includes('no sla'));
    if (!hasSlaFromFields) {
      const jsmSla = await getSlaDataFromJsm(jira, currentIssueKey);
      if (jsmSla) currentSla = jsmSla;
    }
    const hasSlaData = currentSla.status !== 'none' || (currentSla.label != null && !String(currentSla.label).toLowerCase().includes('no sla'));
    if (!hasSlaData) {
      return { ok: false, error: 'This issue has no SLA data. Add an SLA to this issue to send it to linked tickets.', posted: [], failed: [] };
    }
    const config = await getAdminConfig();
    const relayTemplate = config.relayCommentTemplate || '';
    const expirationDateStr = formatExpirationDate(currentSla.hoursRemaining);
    const posted = [];
    const failed = [];
    for (const linkedKey of keysToPost) {
      try {
        const linkedRes = await jira(route`/rest/api/3/issue/${linkedKey}?fields=assignee,reporter`);
        if (!linkedRes.ok) {
          failed.push({ key: linkedKey, error: `Failed to load: ${linkedRes.status}` });
          continue;
        }
        const linkedIssue = await linkedRes.json();
        const assignee = linkedIssue.fields?.assignee;
        const reporter = linkedIssue.fields?.reporter;
        const mentions = [];
        if (assignee?.accountId) mentions.push({ accountId: assignee.accountId, displayName: assignee.displayName || assignee.name });
        if (reporter?.accountId && reporter.accountId !== assignee?.accountId) mentions.push({ accountId: reporter.accountId, displayName: reporter.displayName || reporter.name });
        const body = buildSendToLinkedSlaCommentBody(
          currentIssueKey,
          currentSla.status,
          expirationDateStr,
          mentions,
          relayTemplate,
          relayParentPriority
        );
        const commentRes = await jira(route`/rest/api/3/issue/${linkedKey}/comment`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
          body: JSON.stringify(body),
        });
        if (!commentRes.ok) {
          const errText = await commentRes.text();
          failed.push({ key: linkedKey, error: `${commentRes.status}: ${(errText || '').slice(0, 80)}` });
          continue;
        }
        posted.push(linkedKey);
      } catch (e) {
        failed.push({ key: linkedKey, error: e.message || 'Unknown error' });
      }
    }
    const ok = failed.length === 0;
    const message = posted.length > 0
      ? (failed.length > 0 ? `Posted to ${posted.join(', ')}. Failed: ${failed.map((f) => `${f.key} (${f.error})`).join('; ')}` : `Posted to ${posted.join(', ')}.`)
      : (failed.length > 0 ? `No comments posted. Failed: ${failed.map((f) => `${f.key} (${f.error})`).join('; ')}` : 'No linked issues.');
    let slackTextForSlackDelivery = buildSendToLinkedSlackText(
      currentIssueKey,
      currentSla.status,
      expirationDateStr,
      [],
      relayTemplate,
      relayParentPriority
    );
    if (posted.length > 0) {
      const baseUrl = await getJiraBaseUrl(jira);
      slackTextForSlackDelivery += buildSlackPostedToLinks(baseUrl, posted);
    }

    if (posted.length > 0) {
      const slackParams = getSlackSendParams(config);
      if (config.notificationSlack && slackParams) {
        const mrkdwnOpts = { mrkdwn: true };
        if (slackParams.method === 'webhook') {
          await sendSlackNotification(slackParams.webhookUrl, slackTextForSlackDelivery, mrkdwnOpts);
        } else {
          await sendSlackViaWebApi(slackParams.token, slackParams.channelId, slackTextForSlackDelivery, mrkdwnOpts);
        }
      }
    }

    const dmEnabledManual =
      config.notificationSlackDm ||
      (Array.isArray(config.notificationSlackDmEmails) && config.notificationSlackDmEmails.length > 0);
    const dmTokenManual = getSlackBotTokenForDm(config);
    if (dmEnabledManual && dmTokenManual) {
      const dmSentManual = new Set();
      if (config.notificationSlackDm && posted.length > 0) {
        const dmTrigger = currentSla.status === 'breached' ? 'breached' : 'at_risk';
        const resolvedNotifyFieldsManual = new Map();
        for (const linkedKey of posted) {
          const linkedPeople = await buildMentionPeopleFromIssue(
            jira,
            linkedKey,
            config,
            resolvedNotifyFieldsManual
          );
          const mentionsDm = buildMentionsForTrigger(config, dmTrigger, linkedPeople);
          for (const m of mentionsDm) {
            if (!m?.accountId) continue;
            const email = await getEmailForJiraAccountId(jira, m.accountId);
            if (email && !dmSentManual.has(email.toLowerCase())) {
              dmSentManual.add(email.toLowerCase());
              await sendSlackDm(dmTokenManual, email, slackTextForSlackDelivery);
            }
          }
        }
      }
      const extraEmailsManual = Array.isArray(config.notificationSlackDmEmails)
        ? config.notificationSlackDmEmails
        : [];
      for (const email of extraEmailsManual) {
        const e = (email && String(email).trim()) || '';
        if (e && !dmSentManual.has(e.toLowerCase())) {
          dmSentManual.add(e.toLowerCase());
          await sendSlackDm(dmTokenManual, e, slackTextForSlackDelivery);
        }
      }
    }

    return { ok, message, posted, failed };
  } catch (e) {
    console.error('[SLA Link Inspector] notifyLinkedTicketsOfCurrentSla error', e.message);
    return { ok: false, error: e.message || 'Unknown error', posted: [], failed: [] };
  }
});

resolver.define('getLinkedIssueSlas', async ({ payload, context }) => {
  const licenseStatus = getLicenseStatus();
  const issueKey =
    payload?.issueKey ||
    context?.extension?.issue?.key ||
    context?.extension?.issueKey ||
    context?.platform?.issueKey ||
    context?.platform?.issue?.key;
  const safeIssueKey = issueKey != null ? String(issueKey).trim() : '';

  if (!safeIssueKey) {
    console.log('[SLA Link Inspector] Resolver: no issue key in payload or context', JSON.stringify({ hasPayload: !!payload, contextKeys: context ? Object.keys(context) : [] }));
    return { error: 'No issue key. Open this panel from a Jira issue view.', linkedIssues: [], panelSla: null, licenseStatus };
  }

  console.log('[SLA Link Inspector] Resolver: selected issue key', safeIssueKey);

  try {
    const jira = api.asApp().requestJira.bind(api.asApp());
    const slaField = await getSlaFieldForRequest();
    const slaFieldId = slaField?.id ?? null;
    if (slaField) {
      console.log('[SLA Link Inspector] Resolver: detected SLA field', slaField.name, '(', slaField.id, ')');
    } else {
      console.log('[SLA Link Inspector] Resolver: no SLA field found in Jira instance');
    }

    const configEarly = await getAdminConfig();
    const resolvedNotifyFields = new Map();
    const parentFieldsParam = ['issuelinks', 'priority'];
    if (slaFieldId) parentFieldsParam.push(slaFieldId);
    const parentFieldsQuery = parentFieldsParam.join(',');
    const issueRes = await jira(
      route`/rest/api/3/issue/${safeIssueKey}?fields=${parentFieldsQuery}`
    );
    if (!issueRes.ok) {
      const errText = await issueRes.text();
      console.error('[SLA Link Inspector] Resolver: failed to load issue', issueRes.status, errText);
      return { error: `Failed to load issue: ${issueRes.status} ${errText}`, linkedIssues: [], panelSla: null, licenseStatus };
    }

    const issueData = await issueRes.json();
    const parentPriorityStr = formatParentPriority(issueData.fields?.priority);
    const parentSla = getSlaData(issueData.fields, slaField);
    let slaForPanel = parentSla;
    const hasSlaFromFields =
      parentSla.status !== 'none' ||
      (parentSla.label != null && !String(parentSla.label).toLowerCase().includes('no sla'));
    if (!hasSlaFromFields) {
      const jsmSla = await getSlaDataFromJsm(jira, safeIssueKey);
      if (jsmSla) slaForPanel = jsmSla;
    }
    const panelSla = buildPanelSlaSummary(slaField, slaForPanel);
    const links = issueData.fields?.issuelinks || [];
    const linkedKeys = new Set();
    for (const link of links) {
      const linked = link.outwardIssue || link.inwardIssue;
      const key = linked?.key;
      if (key != null) linkedKeys.add(String(key).trim());
    }

    console.log('[SLA Link Inspector] Resolver: linked issues returned', linkedKeys.size);

    if (linkedKeys.size === 0) {
      return { linkedIssues: [], issueKey: safeIssueKey, parentSla: parentSla || null, panelSla, licenseStatus };
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
      const linkedPeople = await buildMentionPeopleFromIssue(jira, linked.key, configEarly, resolvedNotifyFields);
      try {
        await maybeCommentOnSlaChange(jira, safeIssueKey, parentSla, linked.key, linked.statusCategory, linkedPeople, false, parentPriorityStr);
      } catch (e) {
        console.error('[SLA Link Inspector] Resolver: storage/comment error for', linked.key, e.message);
      }
    }

    const config = await getAdminConfig();
    const hrParent = parentSla?.hoursRemaining;
    const thresholds = normalizeTimeLeftWarningThresholds(config.timeLeftWarningThresholds);
    if (config.timeLeftWarningsEnabled && thresholds.length > 0 && hrParent != null) {
      const slaName = parentSla?.label || parentSla?.sla || 'SLA';
      for (const th of thresholds) {
        const maxHours = th.hours;
        const isBreachedThreshold = maxHours < 0;
        if (isBreachedThreshold) {
          if (hrParent > maxHours) continue;
        } else {
          if (hrParent <= 0 || hrParent > maxHours) continue;
        }
        const recipientsKey = th.recipients === 'breached' ? 'breached' : 'at_risk';
        const hKey = String(maxHours).replace(/\./g, 'p').replace(/-/g, 'n');
        const warnKvsKey = `${SLA_STATUS_STORAGE_PREFIX}warningTh:${hKey}:${recipientsKey}:${safeIssueKey}`;
        try {
          const already = await kvs.get(warnKvsKey);
          if (already) continue;
          await kvs.set(warnKvsKey, 'sent');
          const remainingTimeStr =
            hrParent > 0 ? formatHours(hrParent) + ' left' : formatHours(-hrParent) + ' overdue';
          const statusLabel = isBreachedThreshold ? 'breached' : 'in range';
          const template =
            config.customTemplate ||
            `Linked ticket {{issueKey}}: parent SLA in range. Ticket Priority: {{priority}}. {{assignee}} please review.`;
          const varsWarn = {
            issueKey: safeIssueKey,
            slaName,
            remainingTime: remainingTimeStr,
            status: statusLabel,
            priority: parentPriorityStr,
          };
          for (const linked of linkedIssues) {
            if (linked.error) continue;
            if (config.onlyNotifyIfOpen && linked.statusCategory === 'done') continue;
            const linkedPeopleW = await buildMentionPeopleFromIssue(jira, linked.key, config, resolvedNotifyFields);
            const triggerForThresholds = recipientsKey;
            const mentionsW = buildMentionsForTrigger(config, triggerForThresholds, linkedPeopleW);
            const commentMentionsW = config.notificationMention ? mentionsW : [];
            const adfBody = templateToAdf(template, varsWarn, commentMentionsW);
            if (config.notificationComment) {
              const res = await jira(route`/rest/api/3/issue/${linked.key}/comment`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
                body: JSON.stringify(adfBody),
              });
              if (!res.ok) continue;
              console.log('[SLA Link Inspector] Resolver: time-left warning', hKey, 'posted on linked', linked.key);
            }
            const plainW =
              buildPlainTextMessage(config.customTemplate || null, varsWarn, mentionsW) ||
              `Parent ticket ${safeIssueKey} SLA: ${statusLabel}. Ticket Priority: ${parentPriorityStr}.`;
            const slackParamsW = getSlackSendParams(config);
            if (config.notificationSlack && slackParamsW) {
              if (slackParamsW.method === 'webhook') await sendSlackNotification(slackParamsW.webhookUrl, plainW);
              else await sendSlackViaWebApi(slackParamsW.token, slackParamsW.channelId, plainW);
            }
            const dmEnabledW =
              config.notificationSlackDm ||
              (Array.isArray(config.notificationSlackDmEmails) && config.notificationSlackDmEmails.length > 0);
            const dmTokenW = getSlackBotTokenForDm(config);
            if (dmEnabledW && dmTokenW) {
              const dmSentW = new Set();
              if (config.notificationSlackDm && Array.isArray(mentionsW)) {
                for (const m of mentionsW) {
                  if (!m?.accountId) continue;
                  const email = await getEmailForJiraAccountId(jira, m.accountId);
                  if (email && !dmSentW.has(email.toLowerCase())) {
                    dmSentW.add(email.toLowerCase());
                    await sendSlackDm(dmTokenW, email, plainW);
                  }
                }
              }
              const extraEmailsW = Array.isArray(config.notificationSlackDmEmails)
                ? config.notificationSlackDmEmails
                : [];
              for (const email of extraEmailsW) {
                const e = (email && String(email).trim()) || '';
                if (e && !dmSentW.has(e.toLowerCase())) {
                  dmSentW.add(e.toLowerCase());
                  await sendSlackDm(dmTokenW, e, plainW);
                }
              }
            }
            if (config.notificationEmail && config.emailWebhookUrl) {
              await sendEmailWebhook(config.emailWebhookUrl, {
                event: 'sla_alert',
                parentIssueKey: safeIssueKey,
                linkedIssueKey: linked.key,
                status: statusLabel,
                slaName: varsWarn.slaName,
                remainingTime: remainingTimeStr,
                parentPriority: parentPriorityStr,
                recipients: mentionsW.map((m) => ({ accountId: m.accountId, displayName: m.displayName || m.name })),
                message: plainW,
                subject: `SLA warning (${safeIssueKey}): ${statusLabel}`,
              });
            }
          }
        } catch (e) {
          console.error('[SLA Link Inspector] Resolver: time-left warning error', hKey, e.message);
        }
      }
    }

    return { linkedIssues, issueKey: safeIssueKey, parentSla: parentSla || null, panelSla, licenseStatus };
  } catch (err) {
    console.error('[SLA Link Inspector] Resolver error:', err.message || err);
    return {
      error: err.message || 'Unknown error',
      linkedIssues: [],
      issueKey: safeIssueKey,
      panelSla: null,
      licenseStatus: getLicenseStatus(),
    };
  }
});

export const handler = resolver.getDefinitions();
