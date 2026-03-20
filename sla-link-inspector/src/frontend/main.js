import { invoke, view, router, NavigationTarget } from '@forge/bridge';

const BUNDLE_VERSION = typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : '0.0.0';
console.log('[Linked SLA Alerts] panel loaded, v' + BUNDLE_VERSION);

const LOADING = document.getElementById('loading');
const ERROR_EL = document.getElementById('error');
const PANEL_MAIN = document.getElementById('panel-main');
const SLA_STATUS_BLOCK = document.getElementById('sla-status-block');
const SUMMARY_EL = document.getElementById('sla-summary');
const SEND_SECTION_EL = document.getElementById('sla-send-section');
const LICENSE_BANNER_EL = document.getElementById('license-banner');

const FEEDBACK_OK_MS = 5000;

function showLoading(on) {
  LOADING.style.display = on ? 'block' : 'none';
  PANEL_MAIN.style.display = on ? 'none' : 'block';
  ERROR_EL.style.display = 'none';
}

function showError(message) {
  ERROR_EL.textContent = message;
  ERROR_EL.style.display = 'block';
  LOADING.style.display = 'none';
  if (PANEL_MAIN) PANEL_MAIN.style.display = 'none';
}

function renderSlaStatus(panelSla) {
  SLA_STATUS_BLOCK.innerHTML = '';
  if (!panelSla || !panelSla.line) return;
  const variantClass =
    panelSla.variant === 'at_risk'
      ? 'sla-status-at-risk'
      : panelSla.variant === 'breached'
        ? 'sla-status-breached'
        : panelSla.variant === 'healthy'
          ? 'sla-status-healthy'
          : 'sla-status-unknown';
  const p = document.createElement('p');
  p.className = `sla-status-line ${variantClass}`;
  p.textContent = panelSla.line;
  SLA_STATUS_BLOCK.appendChild(p);
  if (panelSla.configureHint) {
    const h = document.createElement('p');
    h.className = 'sla-status-configure-hint';
    h.textContent = panelSla.configureHint;
    SLA_STATUS_BLOCK.appendChild(h);
  }
}

function renderLinkedCount(n) {
  SUMMARY_EL.innerHTML = '';
  const line = document.createElement('p');
  line.className = 'linked-count-line';
  const bold = document.createElement('span');
  bold.className = 'linked-count';
  bold.textContent = `Linked tickets: ${n}`;
  line.appendChild(bold);
  SUMMARY_EL.appendChild(line);
  if (n === 0) {
    const hint = document.createElement('p');
    hint.className = 'linked-zero-hint';
    hint.textContent = 'No linked tickets found. Link a ticket to this issue first.';
    SUMMARY_EL.appendChild(hint);
  }
}

function setBundleVersionInBanner() {
  const banner = document.getElementById('version-banner');
  if (banner) {
    banner.textContent = `Version · v${BUNDLE_VERSION}`;
  }
}

function renderSendPanel(linkedIssues, parentIssueKey, licensed) {
  const n = linkedIssues.length;
  SEND_SECTION_EL.innerHTML = '';

  const hintDefault = 'Posts a comment on each selected linked ticket with the current SLA status.';
  let hintEl;
  let feedbackEl;
  let feedbackTimer;

  function showFeedback(kind, text) {
    clearTimeout(feedbackTimer);
    if (hintEl) hintEl.style.display = kind === 'idle' ? 'block' : 'none';
    if (!feedbackEl) return;
    if (kind === 'idle' || !text) {
      feedbackEl.textContent = '';
      feedbackEl.className = 'send-action-feedback send-action-feedback-hidden';
      return;
    }
    feedbackEl.textContent = text;
    feedbackEl.className =
      kind === 'success'
        ? 'send-action-feedback send-action-feedback-success'
        : 'send-action-feedback send-action-feedback-error';
    if (kind === 'success') {
      feedbackTimer = setTimeout(() => {
        feedbackEl.textContent = '';
        feedbackEl.className = 'send-action-feedback send-action-feedback-hidden';
        if (hintEl) hintEl.style.display = 'block';
      }, FEEDBACK_OK_MS);
    }
  }

  const btnWrap = document.createElement('div');
  btnWrap.className = 'sla-send-btn-wrap';
  const sendBtn = document.createElement('button');
  sendBtn.type = 'button';
  sendBtn.className = 'send-sla-to-linked-btn';
  sendBtn.textContent = 'Send SLA Alert';
  sendBtn.title = licensed
    ? 'Post this issue’s SLA as a comment on the selected linked ticket(s).'
    : 'A valid license is required.';
  sendBtn.disabled = !licensed || n === 0;

  hintEl = document.createElement('p');
  hintEl.className = 'send-action-hint';
  hintEl.textContent = hintDefault;

  feedbackEl = document.createElement('p');
  feedbackEl.className = 'send-action-feedback send-action-feedback-hidden';
  feedbackEl.setAttribute('role', 'status');

  if (n === 0) {
    btnWrap.appendChild(sendBtn);
    SEND_SECTION_EL.appendChild(btnWrap);
    SEND_SECTION_EL.appendChild(hintEl);
    SEND_SECTION_EL.appendChild(feedbackEl);
    return;
  }

  const sendToLabel = document.createElement('p');
  sendToLabel.className = 'sla-send-to-label';
  sendToLabel.textContent = 'Send to';
  SEND_SECTION_EL.appendChild(sendToLabel);

  const optionsWrap = document.createElement('div');
  optionsWrap.className = 'sla-send-options';

  const allWrap = document.createElement('label');
  allWrap.className = 'sla-radio-wrap';
  const allRadio = document.createElement('input');
  allRadio.type = 'radio';
  allRadio.name = 'sla-send-target';
  allRadio.value = 'all';
  allRadio.checked = true;
  allWrap.appendChild(allRadio);
  allWrap.appendChild(document.createTextNode(' All linked tickets'));
  optionsWrap.appendChild(allWrap);

  const specificWrap = document.createElement('div');
  specificWrap.className = 'sla-specific-wrap';
  const specificLabel = document.createElement('label');
  specificLabel.className = 'sla-radio-wrap';
  const specificRadio = document.createElement('input');
  specificRadio.type = 'radio';
  specificRadio.name = 'sla-send-target';
  specificRadio.value = 'specific';
  specificLabel.appendChild(specificRadio);
  specificLabel.appendChild(document.createTextNode(' Only these'));
  specificWrap.appendChild(specificLabel);

  const checklistHost = document.createElement('div');
  checklistHost.className = 'checklist-host checklist-host-hidden';

  const toggleRow = document.createElement('div');
  toggleRow.className = 'checklist-toggles';
  const selectAll = document.createElement('a');
  selectAll.href = '#';
  selectAll.className = 'checklist-toggle-link';
  selectAll.textContent = 'Select all';
  const deselectAll = document.createElement('a');
  deselectAll.href = '#';
  deselectAll.className = 'checklist-toggle-link';
  deselectAll.textContent = 'Deselect all';
  toggleRow.appendChild(selectAll);
  toggleRow.appendChild(document.createTextNode(' · '));
  toggleRow.appendChild(deselectAll);

  const listBox = document.createElement('div');
  listBox.className = 'linked-checklist-box';
  const checkboxes = [];
  for (const issue of linkedIssues) {
    const row = document.createElement('label');
    row.className = 'linked-checklist-row';
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.value = issue.key;
    cb.checked = true;
    checkboxes.push(cb);
    const keySpan = document.createElement('span');
    keySpan.className = 'linked-checklist-key';
    keySpan.textContent = issue.key;
    const titleSpan = document.createElement('span');
    titleSpan.className = 'linked-checklist-title';
    titleSpan.textContent = issue.summary || '—';
    titleSpan.title = issue.summary || '';
    row.appendChild(cb);
    row.appendChild(keySpan);
    row.appendChild(titleSpan);
    listBox.appendChild(row);
  }

  selectAll.addEventListener('click', (e) => {
    e.preventDefault();
    checkboxes.forEach((c) => {
      c.checked = true;
    });
  });
  deselectAll.addEventListener('click', (e) => {
    e.preventDefault();
    checkboxes.forEach((c) => {
      c.checked = false;
    });
  });

  checklistHost.appendChild(toggleRow);
  checklistHost.appendChild(listBox);
  specificWrap.appendChild(checklistHost);
  optionsWrap.appendChild(specificWrap);
  SEND_SECTION_EL.appendChild(optionsWrap);

  function updateChecklistVisibility() {
    if (specificRadio.checked) {
      checklistHost.classList.remove('checklist-host-hidden');
    } else {
      checklistHost.classList.add('checklist-host-hidden');
    }
  }
  allRadio.addEventListener('change', updateChecklistVisibility);
  specificRadio.addEventListener('change', updateChecklistVisibility);

  sendBtn.addEventListener('click', async () => {
    if (!licensed || n === 0) return;
    showFeedback('idle', '');
    if (hintEl) hintEl.style.display = 'block';

    let targetKeys = null;
    if (specificRadio.checked) {
      targetKeys = checkboxes.filter((c) => c.checked).map((c) => c.value);
      if (targetKeys.length === 0) {
        if (hintEl) hintEl.style.display = 'none';
        showFeedback('error', 'Select at least one linked ticket.');
        return;
      }
    }

    sendBtn.disabled = true;
    sendBtn.textContent = 'Sending…';
    try {
      const payload = { issueKey: parentIssueKey };
      if (targetKeys != null && targetKeys.length > 0) payload.targetKeys = targetKeys;
      const result = await invoke('notifyLinkedTicketsOfCurrentSla', payload);
      const posted = result?.posted || [];
      const failed = result?.failed || [];

      if (result?.error && posted.length === 0) {
        if (hintEl) hintEl.style.display = 'none';
        showFeedback('error', 'Send failed. Please try again or check your configuration.');
      } else if (posted.length > 0) {
        if (hintEl) hintEl.style.display = 'none';
        const suffix = failed.length ? ` (${failed.length} could not be sent.)` : '';
        showFeedback('success', `Alert sent to ${posted.length} linked ticket(s).${suffix}`);
      } else {
        if (hintEl) hintEl.style.display = 'none';
        showFeedback('error', 'Send failed. Please try again or check your configuration.');
      }
    } catch (e) {
      if (hintEl) hintEl.style.display = 'none';
      showFeedback('error', 'Send failed. Please try again or check your configuration.');
    } finally {
      sendBtn.disabled = false;
      sendBtn.textContent = 'Send SLA Alert';
    }
  });

  btnWrap.appendChild(sendBtn);
  SEND_SECTION_EL.appendChild(btnWrap);
  SEND_SECTION_EL.appendChild(hintEl);
  SEND_SECTION_EL.appendChild(feedbackEl);
}

async function run() {
  showLoading(true);
  setBundleVersionInBanner();

  let issueKey;
  try {
    const context = await view.getContext();
    issueKey =
      context?.extension?.issue?.key ??
      context?.extension?.issueKey ??
      context?.platform?.issueKey ??
      context?.platform?.issue?.key;
  } catch (e) {
    console.error('[Linked SLA Alerts] getContext failed', e.message || e);
    showError('Could not get issue context.');
    return;
  }

  try {
    const result = await invoke('getLinkedIssueSlas', issueKey ? { issueKey } : {});
    const licensed = result.licenseStatus?.licensed !== false;

    if (LICENSE_BANNER_EL) {
      if (!licensed) {
        LICENSE_BANNER_EL.textContent =
          result.licenseStatus?.reason ||
          'A valid license is required. Please upgrade from the Marketplace to use Linked SLA Alerts.';
        LICENSE_BANNER_EL.style.display = 'block';
      } else {
        LICENSE_BANNER_EL.style.display = 'none';
      }
    }

    if (result.error && (!result.linkedIssues || result.linkedIssues.length === 0)) {
      console.error('[Linked SLA Alerts] resolver error', result.error);
      showError(result.error || 'Failed to load linked issues.');
      return;
    }

    const linkedIssues = result.linkedIssues || [];
    LOADING.style.display = 'none';
    PANEL_MAIN.style.display = 'block';

    renderSlaStatus(result.panelSla);
    renderLinkedCount(linkedIssues.length);
    renderSendPanel(linkedIssues, result.issueKey ?? issueKey, licensed);
    void renderSlackSelfLinkSection(licensed);
  } catch (err) {
    console.error('[Linked SLA Alerts] error:', err.message || err);
    showError(err.message || 'Failed to load linked issues.');
  }
}

/**
 * Optional: map this Jira user to a Slack member ID (progressive disclosure).
 */
async function renderSlackSelfLinkSection(licensed) {
  const host = document.getElementById('slack-self-link-section');
  if (!host) return;
  host.hidden = false;
  host.innerHTML = '';
  host.className = 'slack-self-link-section slack-dm-fallback-disclosure';

  let st = null;
  try {
    if (licensed) {
      st = await invoke('getSlackLinkStatus');
    }
  } catch (_) {
    st = null;
  }

  const initialLinked = Boolean(licensed && st?.hasSlackMapping);
  const accountKnown = st?.accountKnown !== false;

  const trigger = document.createElement('button');
  trigger.type = 'button';
  trigger.className = 'slack-dm-fallback-trigger';
  trigger.setAttribute('aria-expanded', 'false');
  trigger.setAttribute('aria-controls', 'slack-dm-fallback-panel');

  const panel = document.createElement('div');
  panel.id = 'slack-dm-fallback-panel';
  panel.className = 'slack-dm-fallback-panel';
  panel.setAttribute('role', 'region');
  panel.setAttribute('aria-label', 'Slack DM fallback settings');

  const panelInner = document.createElement('div');
  panelInner.className = 'slack-dm-fallback-panel-inner';

  const title = document.createElement('p');
  title.className = 'slack-dm-fallback-title';
  title.innerHTML = '<strong>Slack DM Fallback</strong>';

  const desc = document.createElement('p');
  desc.className = 'slack-dm-fallback-desc';
  desc.innerHTML =
    `Jira doesn't always share your email with apps. Paste your <a href="https://api.slack.com/methods/users.lookupByEmail" target="_blank" rel="noopener noreferrer">Slack member ID</a> so this app can DM you directly.`;

  const row = document.createElement('div');
  row.className = 'slack-self-link-row';

  const input = document.createElement('input');
  input.type = 'text';
  input.className = 'slack-self-link-input';
  input.placeholder = 'Your Slack member ID (e.g. U01234ABCDE)';
  input.setAttribute('aria-label', 'Slack member ID');
  input.autocomplete = 'off';

  const saveBtn = document.createElement('button');
  saveBtn.type = 'button';
  saveBtn.className = 'slack-self-link-btn';
  saveBtn.textContent = 'Save';
  saveBtn.disabled = !licensed;

  const clearBtn = document.createElement('button');
  clearBtn.type = 'button';
  clearBtn.className = 'slack-self-link-btn slack-self-link-btn-secondary';
  clearBtn.textContent = 'Remove';
  clearBtn.disabled = !licensed;

  const statusEl = document.createElement('p');
  statusEl.className = 'slack-self-link-status';

  const closeBtn = document.createElement('button');
  closeBtn.type = 'button';
  closeBtn.className = 'slack-dm-fallback-close';
  closeBtn.textContent = '✕ Close';

  row.appendChild(input);
  row.appendChild(saveBtn);
  row.appendChild(clearBtn);

  panelInner.appendChild(title);
  panelInner.appendChild(desc);
  panelInner.appendChild(row);
  panelInner.appendChild(statusEl);
  panelInner.appendChild(closeBtn);
  panel.appendChild(panelInner);

  host.appendChild(trigger);
  host.appendChild(panel);

  function setExpanded(on) {
    host.classList.toggle('is-expanded', on);
    trigger.setAttribute('aria-expanded', on ? 'true' : 'false');
  }

  function updateTrigger(linked) {
    if (linked && st?.mappingSource === 'admin') {
      trigger.textContent = 'Slack ID linked ✓ (workspace admin) →';
      trigger.classList.add('slack-dm-fallback-trigger--linked');
    } else if (linked) {
      trigger.textContent = 'Slack ID linked ✓ — update or remove →';
      trigger.classList.add('slack-dm-fallback-trigger--linked');
    } else {
      trigger.textContent = 'Not receiving Slack DMs? Link your Slack ID →';
      trigger.classList.remove('slack-dm-fallback-trigger--linked');
    }
  }

  function applyButtonStateFromSt() {
    if (!licensed || !accountKnown) {
      saveBtn.disabled = true;
      clearBtn.disabled = true;
      input.disabled = true;
      return;
    }
    if (st?.hasSlackMapping && st.mappingSource === 'admin') {
      saveBtn.disabled = true;
      clearBtn.disabled = true;
      input.disabled = true;
      input.placeholder = 'Managed in admin settings';
      return;
    }
    saveBtn.disabled = false;
    clearBtn.disabled = false;
    input.disabled = false;
    input.placeholder = 'Your Slack member ID (e.g. U01234ABCDE)';
  }

  function applyStatusFromServer() {
    if (!licensed) {
      statusEl.textContent = 'A valid license is required to save this mapping.';
      applyButtonStateFromSt();
      return;
    }
    if (!accountKnown) {
      statusEl.textContent = 'Sign in to Jira to link your Slack ID.';
      applyButtonStateFromSt();
      return;
    }

    if (st?.hasSlackMapping && st.mappingSource === 'admin') {
      statusEl.textContent = `Linked: ${st.slackUserIdMasked} — set by a workspace admin in app settings. It can’t be removed from this panel; ask an admin to delete your line in the Jira → Slack ID mapping.`;
      applyButtonStateFromSt();
      return;
    }

    if (st?.hasSlackMapping && st.slackUserIdMasked) {
      statusEl.textContent = `Linked: ${st.slackUserIdMasked} (saved from this panel for your Jira account).`;
    } else {
      statusEl.textContent = 'No Slack ID saved from this panel for your Jira account yet.';
    }
    applyButtonStateFromSt();
  }

  updateTrigger(initialLinked);
  applyStatusFromServer();
  // Slack subsection stays collapsed until the user opens it (even when already linked).

  trigger.addEventListener('click', () => {
    setExpanded(!host.classList.contains('is-expanded'));
  });

  closeBtn.addEventListener('click', () => {
    setExpanded(false);
  });

  saveBtn.addEventListener('click', async () => {
    const v = (input.value || '').trim();
    if (!v) {
      if (st?.mappingSource === 'self') {
        statusEl.textContent = 'Use Remove to clear your saved Slack ID, or enter an ID to replace it.';
      } else if (st?.mappingSource === 'admin') {
        statusEl.textContent = 'This mapping is managed by an admin.';
      } else {
        statusEl.textContent = 'Enter your Slack member ID.';
      }
      return;
    }
    saveBtn.disabled = true;
    clearBtn.disabled = true;
    try {
      const res = await invoke('saveMySlackUserId', { slackUserId: v });
      if (res?.ok) {
        input.value = '';
        try {
          st = await invoke('getSlackLinkStatus');
        } catch (_) {
          st = null;
        }
        applyStatusFromServer();
        updateTrigger(Boolean(st?.hasSlackMapping));
      } else {
        statusEl.textContent = res?.error || 'Could not save.';
      }
    } catch (err) {
      statusEl.textContent = err.message || 'Could not save.';
    } finally {
      if (licensed && accountKnown) {
        applyButtonStateFromSt();
      }
    }
  });

  clearBtn.addEventListener('click', async () => {
    saveBtn.disabled = true;
    clearBtn.disabled = true;
    try {
      const res = await invoke('saveMySlackUserId', { slackUserId: '' });
      if (res?.ok) {
        try {
          st = await invoke('getSlackLinkStatus');
        } catch (_) {
          st = null;
        }
        if (res.adminMappingStillApplies) {
          statusEl.textContent =
            'Removed your personal Slack ID from this panel. A workspace admin still maps your Jira account in app settings, so the link will keep working until they remove that line.';
        } else {
          statusEl.textContent = res.cleared ? 'Removed your Slack ID mapping.' : 'Updated.';
        }
        updateTrigger(Boolean(st?.hasSlackMapping));
        applyStatusFromServer();
      } else {
        statusEl.textContent = res?.error || 'Could not remove.';
      }
    } catch (err) {
      statusEl.textContent = err.message || 'Could not remove.';
    } finally {
      if (licensed && accountKnown) {
        applyButtonStateFromSt();
      }
    }
  });
}

function openAdmin() {
  router.open({ target: NavigationTarget.Module, moduleKey: 'sla-link-inspector-configure' }).catch((e) => {
    console.error('[Linked SLA Alerts] Failed to open admin', e?.message || e);
  });
}

const adminLinkEl = document.getElementById('panel-admin-link');
if (adminLinkEl) {
  adminLinkEl.addEventListener('click', (e) => {
    e.preventDefault();
    openAdmin();
  });
}

run();
