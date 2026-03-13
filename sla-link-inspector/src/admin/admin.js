import { invoke } from '@forge/bridge';

const CONFIG_KEYS = [
  'slaFieldId',
  'triggerAtRisk',
  'triggerBreached',
  'trigger30MinRemaining',
  'onlyNotifyIfOpen',
  'atRiskNotifyAssignee',
  'atRiskNotifyReporter',
  'atRiskNotifyWatchers',
  'breachedNotifyAssignee',
  'breachedNotifyReporter',
  'breachedNotifyWatchers',
  'notificationComment',
  'notificationMention',
  'notificationEmail',
  'notificationSlack',
  'emailWebhookUrl',
  'slackWebhookUrl',
  'slackChannelId',
  'slackBotToken',
  'customTemplate',
  'relayCommentTemplate',
  'atRiskNotifyFromFields',
  'breachedNotifyFromFields',
];

const errorEl = document.getElementById('error');
const savedEl = document.getElementById('saved');
const feedbackEl = document.getElementById('feedback');
const saveBtn = document.getElementById('saveBtn');
const licenseBannerEl = document.getElementById('license-banner');

let additionalMentionsAtRisk = [];
let additionalMentionsBreached = [];
let isLicensed = true;

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
    if (key === 'atRiskNotifyFromFields' || key === 'breachedNotifyFromFields') {
      payload[key] = (el.value || '').split(',').map((s) => s.trim()).filter(Boolean);
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
    if (key === 'atRiskNotifyFromFields' || key === 'breachedNotifyFromFields') {
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
    additionalMentionsAtRisk = Array.isArray(config.atRiskAdditionalMentions) ? config.atRiskAdditionalMentions : [];
    additionalMentionsBreached = Array.isArray(config.breachedAdditionalMentions) ? config.breachedAdditionalMentions : [];
    renderMentionChips('atRisk');
    renderMentionChips('breached');
  } catch (e) {
    showError(e.message || 'Failed to load settings.');
  }
}

async function save() {
  if (!isLicensed) return;
  const payload = formToPayload();
  payload.atRiskAdditionalMentions = additionalMentionsAtRisk;
  payload.breachedAdditionalMentions = additionalMentionsBreached;
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

async function clearSlackToken() {
  if (!isLicensed) return;
  const btn = document.getElementById('clearSlackTokenBtn');
  if (btn) btn.disabled = true;
  hideFeedback();
  try {
    const payload = formToPayload();
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

function renderMentionChips(trigger) {
  const list = trigger === 'atRisk' ? additionalMentionsAtRisk : additionalMentionsBreached;
  const container = document.getElementById(trigger === 'atRisk' ? 'atRiskMentionChips' : 'breachedMentionChips');
  if (!container) return;
  container.innerHTML = '';
  list.forEach((user, index) => {
    const chip = document.createElement('span');
    chip.className = 'mention-chip';
    chip.appendChild(document.createTextNode(user.displayName || user.accountId || 'User'));
    const remove = document.createElement('span');
    remove.className = 'mention-chip-remove';
    remove.setAttribute('aria-label', 'Remove');
    remove.textContent = '×';
    remove.addEventListener('click', (e) => {
      e.preventDefault();
      if (trigger === 'atRisk') {
        additionalMentionsAtRisk = additionalMentionsAtRisk.filter((_, i) => i !== index);
      } else {
        additionalMentionsBreached = additionalMentionsBreached.filter((_, i) => i !== index);
      }
      renderMentionChips(trigger);
    });
    chip.appendChild(remove);
    container.appendChild(chip);
  });
}

function renderMentionResults(trigger, users) {
  const container = document.getElementById(trigger === 'atRisk' ? 'atRiskMentionResults' : 'breachedMentionResults');
  if (!container) return;
  container.innerHTML = '';
  const list = trigger === 'atRisk' ? additionalMentionsAtRisk : additionalMentionsBreached;
  const existingIds = new Set(list.map((u) => u.accountId));
  (users || []).forEach((user) => {
    if (existingIds.has(user.accountId)) return;
    const item = document.createElement('div');
    item.className = 'mention-results-item';
    item.textContent = user.displayName || user.accountId;
    item.addEventListener('click', () => {
      if (trigger === 'atRisk') {
        additionalMentionsAtRisk = [...additionalMentionsAtRisk, { accountId: user.accountId, displayName: user.displayName || user.accountId }];
      } else {
        additionalMentionsBreached = [...additionalMentionsBreached, { accountId: user.accountId, displayName: user.displayName || user.accountId }];
      }
      renderMentionChips(trigger);
      container.innerHTML = '';
    });
    container.appendChild(item);
  });
}

async function doMentionSearch(trigger) {
  const input = document.getElementById(trigger === 'atRisk' ? 'atRiskMentionSearch' : 'breachedMentionSearch');
  const query = (input && input.value || '').trim();
  if (query.length < 2) {
    renderMentionResults(trigger, []);
    return;
  }
  try {
    const result = await invoke('searchJiraUsers', { query });
    renderMentionResults(trigger, result.users || []);
  } catch (e) {
    renderMentionResults(trigger, []);
  }
}

document.getElementById('atRiskMentionSearchBtn')?.addEventListener('click', () => doMentionSearch('atRisk'));
document.getElementById('breachedMentionSearchBtn')?.addEventListener('click', () => doMentionSearch('breached'));
document.getElementById('atRiskMentionSearch')?.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); doMentionSearch('atRisk'); } });
document.getElementById('breachedMentionSearch')?.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); doMentionSearch('breached'); } });
