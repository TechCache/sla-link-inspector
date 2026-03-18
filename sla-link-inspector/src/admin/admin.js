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

function updateTimeLeftRowConstraints(row) {
  const inp = row.querySelector('.time-left-amount-input');
  const sel = row.querySelector('.time-left-unit-select');
  if (!inp || !sel) return;
  const u = sel.value;
  if (u === 'minutes') {
    inp.min = 1;
    inp.max = 525600;
    inp.step = 1;
  } else if (u === 'hours') {
    inp.min = 0.02;
    inp.max = 8760;
    inp.step = 'any';
  } else {
    inp.min = 0.01;
    inp.max = 365;
    inp.step = 'any';
  }
}

function syncTimeLeftWarningRemoveButtons() {
  if (!timeLeftWarningsRowsEl) return;
  const rows = timeLeftWarningsRowsEl.querySelectorAll('.time-warning-row');
  rows.forEach((row, i) => {
    const existing = row.querySelector('.btn-remove-time-warning');
    if (i === 0) {
      if (existing) existing.remove();
    } else if (!existing) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'btn btn-secondary btn-remove-time-warning';
      btn.textContent = 'Remove';
      btn.addEventListener('click', () => {
        row.remove();
        syncTimeLeftWarningRemoveButtons();
      });
      row.appendChild(btn);
    }
  });
}

function createTimeLeftWarningRow(amount, unit, isAdditional) {
  const row = document.createElement('div');
  row.className = 'time-warning-row';
  const u = ['minutes', 'hours', 'days'].includes(unit) ? unit : 'days';
  let a = Number(amount);
  if (!Number.isFinite(a) || a <= 0) {
    a = u === 'minutes' ? 60 : u === 'hours' ? 12 : 1;
  }
  const removeBtnHtml = isAdditional
    ? '<button type="button" class="btn btn-secondary btn-remove-time-warning">Remove</button>'
    : '';
  row.innerHTML = `
    <span class="time-warning-row-label">Warn when ≤</span>
    <input type="number" class="text-input time-left-amount-input" />
    <select class="text-input time-left-unit-select" aria-label="Time unit">
      <option value="minutes">minutes</option>
      <option value="hours">hours</option>
      <option value="days">days</option>
    </select>
    <span class="time-warning-row-suffix">left</span>
    ${removeBtnHtml}
  `;
  const inp = row.querySelector('.time-left-amount-input');
  const sel = row.querySelector('.time-left-unit-select');
  inp.value = u === 'minutes' ? String(Math.round(a)) : String(a);
  sel.value = u;
  updateTimeLeftRowConstraints(row);
  sel.addEventListener('change', () => updateTimeLeftRowConstraints(row));
  const removeBtn = row.querySelector('.btn-remove-time-warning');
  if (removeBtn) {
    removeBtn.addEventListener('click', () => {
      row.remove();
      syncTimeLeftWarningRemoveButtons();
    });
  }
  return row;
}

function renderTimeLeftWarningRows(thresholds) {
  if (!timeLeftWarningsRowsEl) return;
  timeLeftWarningsRowsEl.innerHTML = '';
  const list = Array.isArray(thresholds) && thresholds.length > 0 ? thresholds : [{ amount: 1, unit: 'days' }];
  list.forEach((t, index) => {
    const amount = t.amount != null ? t.amount : 1;
    const unit = t.unit || 'days';
    timeLeftWarningsRowsEl.appendChild(createTimeLeftWarningRow(amount, unit, index > 0));
  });
}

function collectTimeLeftWarningThresholds() {
  if (!timeLeftWarningsRowsEl) return [];
  const rows = timeLeftWarningsRowsEl.querySelectorAll('.time-warning-row');
  const out = [];
  rows.forEach((row) => {
    const amount = parseFloat(row.querySelector('.time-left-amount-input').value);
    const unit = row.querySelector('.time-left-unit-select').value;
    if (!Number.isFinite(amount)) return;
    out.push({ amount, unit });
  });
  return out;
}

function buildAdminSavePayload() {
  const payload = finalizeAdminPayload(formToPayload());
  payload.timeLeftWarningsEnabled = Boolean(document.getElementById('timeLeftWarningsEnabled')?.checked);
  payload.timeLeftWarningThresholds = collectTimeLeftWarningThresholds();
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
    renderTimeLeftWarningRows(config.timeLeftWarningThresholds);
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
  const rows = timeLeftWarningsRowsEl.querySelectorAll('.time-warning-row');
  let amount = 1;
  let unit = 'days';
  if (rows.length) {
    const last = rows[rows.length - 1];
    unit = last.querySelector('.time-left-unit-select').value;
    const a = parseFloat(last.querySelector('.time-left-amount-input').value);
    if (Number.isFinite(a) && a > 0) {
      if (unit === 'minutes') amount = Math.max(1, Math.round(a / 2));
      else amount = Math.max(unit === 'days' ? 0.01 : 0.02, Math.round((a / 2) * 1000) / 1000);
    }
  }
  timeLeftWarningsRowsEl.appendChild(createTimeLeftWarningRow(amount, unit, true));
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
