import { invoke } from '@forge/bridge';

const CONFIG_KEYS = [
  'slaFieldId',
  'triggerAtRisk',
  'triggerBreached',
  'onlyNotifyIfOpen',
  'atRiskNotifyAssignee',
  'atRiskNotifyReporter',
  'atRiskNotifyWatchers',
  'atRiskNotifyRequestParticipants',
  'breachedNotifyAssignee',
  'breachedNotifyReporter',
  'breachedNotifyWatchers',
  'breachedNotifyRequestParticipants',
  'notificationComment',
  'notificationMention',
  'notificationEmail',
  'notificationSlack',
  'notificationSlackDm',
  'notificationSlackDmEmails',
  'emailWebhookUrl',
  'slackWebhookUrl',
  'slackChannelId',
  'slackBotToken',
  'customTemplate',
  'relayCommentTemplate',
];

const errorEl = document.getElementById('error');
const savedEl = document.getElementById('saved');
const feedbackEl = document.getElementById('feedback');
const saveBtn = document.getElementById('saveBtn');
const licenseBannerEl = document.getElementById('license-banner');

let isLicensed = true;

const timeLeftWarningsRowsEl = document.getElementById('timeLeftWarningsRows');

function createTimeLeftWarningRow(daysValue) {
  const row = document.createElement('div');
  row.className = 'time-warning-row';
  const v = Number.isFinite(Number(daysValue)) && Number(daysValue) > 0 ? Number(daysValue) : 1;
  row.innerHTML = `
    <span class="time-warning-row-label">Warn when ≤</span>
    <input type="number" class="text-input time-left-days-input" min="0.05" max="365" step="any" value="${v}" />
    <span class="time-warning-row-suffix">days left</span>
    <button type="button" class="btn btn-secondary btn-remove-time-warning">Remove</button>
  `;
  row.querySelector('.btn-remove-time-warning').addEventListener('click', () => {
    if (timeLeftWarningsRowsEl && timeLeftWarningsRowsEl.children.length <= 1) return;
    row.remove();
  });
  return row;
}

function renderTimeLeftWarningRows(thresholds) {
  if (!timeLeftWarningsRowsEl) return;
  timeLeftWarningsRowsEl.innerHTML = '';
  const list = Array.isArray(thresholds) && thresholds.length > 0 ? thresholds : [1];
  list.forEach((d) => {
    const v = parseFloat(d);
    const val = Number.isFinite(v) && v >= 0.05 && v <= 365 ? v : 1;
    timeLeftWarningsRowsEl.appendChild(createTimeLeftWarningRow(val));
  });
}

function collectTimeLeftWarningDays() {
  if (!timeLeftWarningsRowsEl) return [];
  const inputs = timeLeftWarningsRowsEl.querySelectorAll('.time-left-days-input');
  const out = [];
  inputs.forEach((inp) => {
    const v = parseFloat(inp.value);
    if (Number.isFinite(v) && v >= 0.05 && v <= 365) {
      out.push(Math.round(v * 10000) / 10000);
    }
  });
  return [...new Set(out)].sort((a, b) => a - b);
}

function buildAdminSavePayload() {
  const payload = finalizeAdminPayload(formToPayload());
  payload.timeLeftWarningsEnabled = Boolean(document.getElementById('timeLeftWarningsEnabled')?.checked);
  payload.timeLeftWarningThresholdsDays = collectTimeLeftWarningDays();
  return payload;
}

function finalizeAdminPayload(payload) {
  payload.atRiskNotifyFromFields = [];
  payload.breachedNotifyFromFields = [];
  payload.atRiskAdditionalMentions = [];
  payload.breachedAdditionalMentions = [];
  return payload;
}

function updateSlackVisibility() {
  const slackCheckbox = getCheckbox('notificationSlack');
  const slackSubOptions = document.getElementById('slackSubOptions');
  if (!slackSubOptions) return;
  const enabled = Boolean(slackCheckbox && slackCheckbox.checked);
  slackSubOptions.hidden = !enabled;
}

/** Bot token needed when DMs are on, or channel posts use bot (channel ID without webhook). */
function slackDeliveryNeedsBotToken() {
  if (!getCheckbox('notificationSlack')?.checked) return false;
  if (getCheckbox('notificationSlackDm')?.checked) return true;
  const ch = (getInput('slackChannelId')?.value || '').trim();
  const wh = (getInput('slackWebhookUrl')?.value || '').trim();
  return Boolean(ch && !wh);
}

function updateSlackBotSetupVisibility() {
  const host = document.getElementById('slackBotSetupHost');
  const skipped = document.getElementById('slackBotSetupSkipped');
  const step = document.getElementById('slackBotSetupStep');
  if (!host || !skipped || !step) return;
  const slackOn = Boolean(getCheckbox('notificationSlack')?.checked);
  if (!slackOn) {
    host.hidden = true;
    return;
  }
  host.hidden = false;
  const needsBot = slackDeliveryNeedsBotToken();
  skipped.hidden = needsBot;
  step.hidden = !needsBot;
}

function showError(msg) {
  if (errorEl) {
    errorEl.textContent = msg || 'Something went wrong.';
    errorEl.classList.add('feedback-visible');
    if (savedEl) savedEl.classList.remove('feedback-visible');
    if (feedbackEl) feedbackEl.classList.remove('feedback-area-hidden');
  }
}

function showSaved() {
  if (savedEl) {
    savedEl.classList.add('feedback-visible');
    if (errorEl) errorEl.classList.remove('feedback-visible');
    if (feedbackEl) feedbackEl.classList.remove('feedback-area-hidden');
    setTimeout(() => {
      savedEl.classList.remove('feedback-visible');
      if (feedbackEl && !errorEl?.classList.contains('feedback-visible')) feedbackEl.classList.add('feedback-area-hidden');
    }, 3000);
  }
}

function hideFeedback() {
  if (errorEl) errorEl.classList.remove('feedback-visible');
  if (savedEl) savedEl.classList.remove('feedback-visible');
  if (feedbackEl) feedbackEl.classList.add('feedback-area-hidden');
}

function getCheckbox(id) {
  const el = document.getElementById(id);
  return el && el.type === 'checkbox' ? el : null;
}

function getInput(id) {
  return document.getElementById(id);
}

function formToPayload() {
  const payload = {};
  for (const key of CONFIG_KEYS) {
    const el = getInput(key);
    if (!el) continue;
    if (key === 'slackBotToken') {
      if (el.value && el.value.trim() !== '') payload[key] = el.value.trim();
      continue;
    }
    if (key === 'notificationSlackDmEmails') {
      payload[key] = (el.value || '').split(/[\n,]+/).map((s) => s.trim()).filter(Boolean);
      continue;
    }
    if (el.type === 'checkbox') {
      payload[key] = el.checked;
    } else {
      payload[key] = el.value;
    }
  }
  return payload;
}

function payloadToForm(payload) {
  for (const [key, value] of Object.entries(payload)) {
    const el = getInput(key);
    if (!el) continue;
    if (key === 'slackBotToken') {
      el.value = '';
      el.placeholder = value && String(value).trim() ? '•••••••• (saved)' : 'xoxb-...';
      continue;
    }
    if (key === 'notificationSlackDmEmails') {
      el.value = Array.isArray(value) ? value.join(', ') : '';
      continue;
    }
    if (el.type === 'checkbox') {
      el.checked = Boolean(value);
    } else {
      el.value = value != null ? String(value) : '';
    }
  }
}

async function load() {
  try {
    const config = await invoke('getAdminConfig');
    isLicensed = config.licenseStatus?.licensed !== false;
    if (licenseBannerEl) {
      if (!isLicensed) {
        licenseBannerEl.textContent = config.licenseStatus?.reason || 'A valid license is required. Please upgrade from the Marketplace to save settings or test Slack.';
        licenseBannerEl.style.display = 'block';
      } else {
        licenseBannerEl.style.display = 'none';
      }
    }
    if (saveBtn) saveBtn.disabled = !isLicensed;
    const testSlackBtnEl = document.getElementById('testSlackBtn');
    if (testSlackBtnEl) testSlackBtnEl.disabled = !isLicensed;
    payloadToForm(config);
    renderTimeLeftWarningRows(config.timeLeftWarningThresholdsDays);
    const tle = document.getElementById('timeLeftWarningsEnabled');
    if (tle) tle.checked = Boolean(config.timeLeftWarningsEnabled);
    updateSlackVisibility();
    updateSlackBotSetupVisibility();
  } catch (e) {
    showError(e.message || 'Failed to load settings.');
  }
}

document.getElementById('addTimeLeftWarningBtn')?.addEventListener('click', () => {
  if (!timeLeftWarningsRowsEl) return;
  const inputs = timeLeftWarningsRowsEl.querySelectorAll('.time-left-days-input');
  let last = 1;
  if (inputs.length) {
    const p = parseFloat(inputs[inputs.length - 1].value);
    if (Number.isFinite(p) && p > 0.1) last = p;
  }
  const next = Math.max(0.05, Math.min(365, last / 2));
  timeLeftWarningsRowsEl.appendChild(createTimeLeftWarningRow(Math.round(next * 1000) / 1000));
});

async function save() {
  if (!isLicensed) return;
  const payload = buildAdminSavePayload();
  saveBtn.disabled = true;
  hideFeedback();
  try {
    const result = await invoke('setAdminConfig', payload);
    if (result && result.ok) {
      showSaved();
    } else {
      showError(result?.error || 'Failed to save.');
    }
  } catch (e) {
    showError(e.message || 'Failed to save.');
  } finally {
    saveBtn.disabled = false;
  }
}

saveBtn.addEventListener('click', save);
hideFeedback();
load();

getCheckbox('notificationSlack')?.addEventListener('change', () => {
  updateSlackVisibility();
  updateSlackBotSetupVisibility();
});
getCheckbox('notificationSlackDm')?.addEventListener('change', updateSlackBotSetupVisibility);
getInput('slackChannelId')?.addEventListener('input', updateSlackBotSetupVisibility);
getInput('slackWebhookUrl')?.addEventListener('input', updateSlackBotSetupVisibility);

async function testSlack() {
  const btn = document.getElementById('testSlackBtn');
  if (!btn || !isLicensed) return;
  const webhookUrl = (getInput('slackWebhookUrl')?.value || '').trim();
  const channelId = (getInput('slackChannelId')?.value || '').trim();
  const botToken = (getInput('slackBotToken')?.value || '').trim();
  btn.disabled = true;
  hideFeedback();
  try {
    const payload = { slackWebhookUrl: webhookUrl || undefined, slackChannelId: channelId || undefined, slackBotToken: botToken || undefined };
    const result = await invoke('testSlackWebhook', payload);
    if (result && result.ok) {
      alert(result.message || 'Test message sent. Check your Slack channel.');
    } else {
      showError(result?.error || 'Slack test failed.');
    }
  } catch (e) {
    showError(e.message || 'Slack test failed.');
  } finally {
    btn.disabled = false;
  }
}

const testSlackBtn = document.getElementById('testSlackBtn');
if (testSlackBtn) testSlackBtn.addEventListener('click', testSlack);

async function testSlackDm() {
  const btn = document.getElementById('testSlackDmBtn');
  if (!btn || !isLicensed) return;
  const botToken = (getInput('slackBotToken')?.value || '').trim();
  const dmEmailsRaw = (getInput('notificationSlackDmEmails')?.value || '').trim();
  const firstEmail = dmEmailsRaw.split(/[\n,]+/).map((s) => s.trim()).filter(Boolean)[0] || '';
  const issueKey = !firstEmail ? (prompt('Optional: enter an issue key to DM its assignee (e.g. ABC-123). Leave blank to DM your own Jira user.', '') || '').trim() : '';
  btn.disabled = true;
  hideFeedback();
  try {
    const payload = { slackBotToken: botToken || undefined, email: firstEmail || undefined, issueKey: issueKey || undefined };
    const result = await invoke('testSlackDm', payload);
    if (result && result.ok) {
      alert(result.message || 'Test DM sent. Check your Slack direct messages.');
    } else {
      showError(result?.error || 'Slack DM test failed.');
    }
  } catch (e) {
    showError(e.message || 'Slack DM test failed.');
  } finally {
    btn.disabled = false;
  }
}

const testSlackDmBtn = document.getElementById('testSlackDmBtn');
if (testSlackDmBtn) testSlackDmBtn.addEventListener('click', testSlackDm);

async function clearSlackToken() {
  if (!isLicensed) return;
  const btn = document.getElementById('clearSlackTokenBtn');
  if (btn) btn.disabled = true;
  hideFeedback();
  try {
    const payload = buildAdminSavePayload();
    payload.slackBotToken = '';
    const result = await invoke('setAdminConfig', payload);
    if (result && result.ok) {
      showSaved();
      await load();
    } else {
      showError(result?.error || 'Failed to clear token.');
    }
  } catch (e) {
    showError(e.message || 'Failed to clear token.');
  } finally {
    const clearBtn = document.getElementById('clearSlackTokenBtn');
    if (clearBtn) clearBtn.disabled = false;
  }
}

const clearSlackTokenBtn = document.getElementById('clearSlackTokenBtn');
if (clearSlackTokenBtn) clearSlackTokenBtn.addEventListener('click', clearSlackToken);
