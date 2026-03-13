import { invoke, view } from '@forge/bridge';

// Injected at build time from package.json (see scripts/bundle-frontend.js)
const BUNDLE_VERSION = typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : '0.0.0';
console.log('[Linked SLA Alerts] SLA relay panel loaded, v' + BUNDLE_VERSION);

const LOADING = document.getElementById('loading');
const ERROR_EL = document.getElementById('error');
const EMPTY_EL = document.getElementById('empty');
const SUMMARY_EL = document.getElementById('sla-summary');
const SEND_SECTION_EL = document.getElementById('sla-send-section');
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
  SUMMARY_EL.style.display = which === 'content' ? 'block' : 'none';
  if (SEND_SECTION_EL) SEND_SECTION_EL.style.display = which === 'content' ? 'block' : 'none';
}

function setError(message) {
  ERROR_EL.textContent = message;
  showState('error');
}

function renderSendPanel(linkedIssues, parentIssueKey, licensed = true) {
  const n = linkedIssues.length;
  SUMMARY_EL.textContent = n === 1 ? '1 linked ticket.' : `${n} linked tickets.`;

  if (!SEND_SECTION_EL) {
    showState('content');
    return;
  }
  SEND_SECTION_EL.innerHTML = '';

  const sendToLabel = document.createElement('p');
  sendToLabel.className = 'sla-send-to-label';
  sendToLabel.textContent = 'Send to:';
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

  const specificWrap = document.createElement('label');
  specificWrap.className = 'sla-radio-wrap';
  const specificRadio = document.createElement('input');
  specificRadio.type = 'radio';
  specificRadio.name = 'sla-send-target';
  specificRadio.value = 'specific';
  const ticketInput = document.createElement('input');
  ticketInput.type = 'text';
  ticketInput.className = 'sla-ticket-input';
  ticketInput.placeholder = 'e.g. OCV2-4, OCV2-5';
  ticketInput.setAttribute('aria-label', 'Ticket keys to send to (comma-separated)');
  specificWrap.appendChild(specificRadio);
  specificWrap.appendChild(document.createTextNode(' Only these: '));
  specificWrap.appendChild(ticketInput);
  optionsWrap.appendChild(specificWrap);

  SEND_SECTION_EL.appendChild(optionsWrap);

  const btnWrap = document.createElement('div');
  btnWrap.className = 'sla-send-btn-wrap';
  const sendToLinkedBtn = document.createElement('button');
  sendToLinkedBtn.type = 'button';
  sendToLinkedBtn.className = 'send-sla-to-linked-btn';
  sendToLinkedBtn.textContent = 'Send SLA to linked tickets';
  sendToLinkedBtn.title = licensed ? 'Post this issue\'s SLA as a comment on the selected linked ticket(s) and @mention their assignee. Only runs when this issue has SLA data.' : 'A valid license is required.';
  sendToLinkedBtn.disabled = !licensed;
  sendToLinkedBtn.addEventListener('click', async () => {
    if (!licensed) return;
    const useSpecific = specificRadio.checked && ticketInput.value.trim() !== '';
    const targetKeys = useSpecific
      ? ticketInput.value.split(/[\s,]+/).map((k) => k.trim()).filter(Boolean)
      : null;
    sendToLinkedBtn.disabled = true;
    sendToLinkedBtn.textContent = '…';
    try {
      const payload = { issueKey: parentIssueKey };
      if (targetKeys != null && targetKeys.length > 0) payload.targetKeys = targetKeys;
      const result = await invoke('notifyLinkedTicketsOfCurrentSla', payload);
      if (result?.error && (result?.posted?.length ?? 0) === 0) {
        showPanelError(result.error || 'Failed.');
      } else {
        showPanelSuccess(result?.message || (result?.posted?.length ? `Posted to ${result.posted.join(', ')}.` : 'Done.'));
      }
    } catch (e) {
      showPanelError('Error: ' + (e.message || String(e)));
    } finally {
      sendToLinkedBtn.disabled = false;
      sendToLinkedBtn.textContent = 'Send SLA to linked tickets';
    }
  });
  btnWrap.appendChild(sendToLinkedBtn);
  SEND_SECTION_EL.appendChild(btnWrap);

  showState('content');
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
    console.error('[Linked SLA Alerts] Frontend: getContext failed', e.message || e);
    setError('Could not get issue context.');
    return;
  }

  try {
    const result = await invoke('getLinkedIssueSlas', issueKey ? { issueKey } : {});
    const licensed = result.licenseStatus?.licensed !== false;

    if (LICENSE_BANNER_EL) {
      if (!licensed) {
        LICENSE_BANNER_EL.textContent = result.licenseStatus?.reason || 'A valid license is required. Please upgrade from the Marketplace to use Linked SLA Alerts.';
        LICENSE_BANNER_EL.style.display = 'block';
      } else {
        LICENSE_BANNER_EL.style.display = 'none';
      }
    }

    if (result.error && (!result.linkedIssues || result.linkedIssues.length === 0)) {
      console.error('[Linked SLA Alerts] Frontend: resolver error', result.error);
      setError(result.error || 'Failed to load linked issues.');
      return;
    }

    const linkedIssues = result.linkedIssues || [];
    console.log('[Linked SLA Alerts] Frontend: linked issues count', linkedIssues.length);

    if (linkedIssues.length === 0) {
      const emptyEl = document.getElementById('empty');
      emptyEl.textContent = 'No linked issues. Add issue links to this ticket to relay SLA status and expiry to them.';
      showState('empty');
      return;
    }

    renderSendPanel(linkedIssues, result.issueKey ?? issueKey, licensed);
  } catch (err) {
    console.error('[Linked SLA Alerts] Frontend error:', err.message || err);
    setError(err.message || 'Failed to load linked issues.');
  }
}

run();
