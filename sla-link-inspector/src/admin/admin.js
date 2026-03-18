import { invoke } from '@forge/bridge';

const CONFIG_KEYS = [
  'slaFieldId',
  'triggerAtRisk',
  'triggerBreached',
  'trigger30MinRemaining',
  'warningMinutesRemaining',
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
    if (key === 'warningMinutesRemaining') {
      const n = parseInt(el.value, 10);
      payload[key] = Number.isNaN(n) ? 30 : Math.max(1, Math.min(1440, n));
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
    if (key === 'warningMinutesRemaining') {
      el.value = value != null && Number.isFinite(Number(value)) ? Math.max(1, Math.min(1440, Number(value))) : '30';
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
    updateSlackVisibility();
    updateSlackBotSetupVisibility();
  } catch (e) {
    showError(e.message || 'Failed to load settings.');
  }
}

async function save() {
  if (!isLicensed) return;
  const payload = finalizeAdminPayload(formToPayload());
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
    const payload = finalizeAdminPayload(formToPayload());
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
