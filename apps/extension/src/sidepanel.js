const connectionStatus = document.getElementById('connection-status');
const tabStatus = document.getElementById('tab-status');
const fieldCount = document.getElementById('field-count');
const fieldList = document.getElementById('field-list');
const openFormButton = document.getElementById('open-form');
const scanButton = document.getElementById('scan');
const fillButton = document.getElementById('fill');
const pauseButton = document.getElementById('pause');
const pauseLabel = document.getElementById('pause-label');
const completionPrompt = document.getElementById('completion-prompt');
const autoAdvance = document.getElementById('auto-advance');
const autoSubmit = document.getElementById('auto-submit');
const continueLogin = document.getElementById('continue-login');

let activeTab = null;
let extensionPaused = false;
let filling = false;

function supportedAts(url = '') {
  try {
    const host = new URL(url).hostname;
    return host.includes('greenhouse.io')
      || host.includes('lever.co')
      || host.includes('ashbyhq.com')
      || host.includes('myworkdayjobs.com')
      || host.includes('workdayjobs.com')
      || host.includes('smartrecruiters.com')
      || host.includes('recruitee.com')
      || host.includes('icims.com')
      || host.includes('workable.com')
      || host.includes('successfactors.com')
      || host.includes('successfactors.eu')
      || host.includes('successfactors.cn')
      || host.includes('hcm.ondemand.com')
      || host.includes('oraclecloud.com')
      || host.includes('taleo.net')
      || host === 'careers.who.int'
      || host.includes('ultipro.com')
      || host.includes('dayforcehcm.com');
  } catch {
    return false;
  }
}

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

async function send(message) {
  return chrome.runtime.sendMessage(message);
}

function activeTabIsSupported() {
  return Boolean(activeTab && supportedAts(activeTab.url));
}

function renderControls() {
  const available = activeTabIsSupported() && !extensionPaused;
  openFormButton.disabled = !available;
  scanButton.disabled = !available;
  fillButton.disabled = !available || filling;
  pauseButton.dataset.paused = String(extensionPaused);
  pauseButton.setAttribute('aria-pressed', String(extensionPaused));
  pauseLabel.textContent = extensionPaused ? 'Resume extension' : 'Pause extension';

  if (activeTabIsSupported()) {
    tabStatus.textContent = extensionPaused
      ? `Paused - ${activeTab.title || activeTab.url || 'supported ATS tab'}`
      : activeTab.title || activeTab.url || 'Supported ATS tab';
  }
}

async function loadActiveTab() {
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  activeTab = tabs[0] ?? null;
  if (!activeTab || !supportedAts(activeTab.url)) {
    tabStatus.textContent = 'Open a supported ATS application tab.';
    renderControls();
    return null;
  }

  renderControls();
  return activeTab;
}

function renderScan(scan) {
  const fields = scan?.fields ?? [];
  fieldCount.textContent = String(fields.length);
  fieldList.innerHTML = fields.slice(0, 40).map((field) => `
    <li class="${['fill', 'file'].includes(field.action) && field.answer ? 'fillable' : ''}">
      <strong>${escapeHtml(field.label || field.type || 'Field')}</strong>
      <span>${escapeHtml(['fill', 'file'].includes(field.action) && field.answer ? field.answer : field.reason)}</span>
    </li>
  `).join('');
}

async function refreshConnection() {
  const response = await send({ type: 'ROLEMATCH_GET_CONNECTION' }).catch((error) => ({ ok: false, error: error.message }));
  if (!response?.ok || !response.connection) {
    connectionStatus.textContent = response?.error || 'Not connected. Open RoleMatch locally and click Connect extension.';
    return;
  }

  connectionStatus.textContent = `Connected to ${response.connection.apiBaseUrl}`;
}

async function refreshSettings() {
  const response = await send({ type: 'ROLEMATCH_GET_SETTINGS' }).catch((error) => ({ ok: false, error: error.message }));
  completionPrompt.checked = response?.settings?.showCompletionPrompt !== false;
  autoAdvance.checked = response?.settings?.autoAdvanceEnabled === true;
  autoSubmit.checked = response?.settings?.autoSubmitEnabled === true;
  continueLogin.checked = response?.settings?.continueAfterLoginEnabled === true;
  extensionPaused = response?.settings?.paused === true;
  renderControls();
}

async function scanFields() {
  if (extensionPaused) return;
  const tab = await loadActiveTab();
  if (!tab?.id) return;
  const response = await send({ type: 'ROLEMATCH_SCAN_TAB', tabId: tab.id }).catch((error) => ({ ok: false, error: error.message }));
  if (!response?.ok) {
    tabStatus.textContent = response?.error || 'Unable to scan this tab.';
    return;
  }

  renderScan(response.scan);
}

openFormButton.addEventListener('click', async () => {
  const tab = await loadActiveTab();
  if (!tab?.id) return;
  await send({ type: 'ROLEMATCH_OPEN_FORM_TAB', tabId: tab.id }).catch(() => null);
  await scanFields();
});

scanButton.addEventListener('click', () => {
  void scanFields();
});

fillButton.addEventListener('click', async () => {
  const tab = await loadActiveTab();
  if (!tab?.id) return;
  filling = true;
  renderControls();
  fillButton.textContent = 'Filling...';
  const response = await send({ type: 'ROLEMATCH_FILL_TAB', tabId: tab.id }).catch((error) => ({ ok: false, error: error.message }));
  filling = false;
  fillButton.textContent = 'Fill visible fields';
  renderControls();
  if (!response?.ok) {
    tabStatus.textContent = response?.error || 'Unable to fill fields.';
    return;
  }
  renderScan(response.scan);
});

pauseButton.addEventListener('click', async () => {
  const nextPaused = !extensionPaused;
  pauseButton.disabled = true;
  const response = await send({
    type: 'ROLEMATCH_SET_PAUSED',
    paused: nextPaused,
  }).catch((error) => ({ ok: false, error: error.message }));

  if (response?.ok) {
    extensionPaused = response.settings?.paused === true;
  } else {
    tabStatus.textContent = response?.error || 'Unable to change the extension pause state.';
  }
  pauseButton.disabled = false;
  renderControls();
});

completionPrompt.addEventListener('change', async () => {
  completionPrompt.disabled = true;
  await send({
    type: 'ROLEMATCH_SAVE_SETTINGS',
    settings: { showCompletionPrompt: completionPrompt.checked },
  }).catch(() => null);
  completionPrompt.disabled = false;
});

autoAdvance.addEventListener('change', async () => {
  autoAdvance.disabled = true;
  const response = await send({
    type: 'ROLEMATCH_SAVE_SETTINGS',
    settings: { autoAdvanceEnabled: autoAdvance.checked },
  }).catch((error) => ({ ok: false, error: error.message }));
  if (!response?.ok) {
    autoAdvance.checked = !autoAdvance.checked;
    tabStatus.textContent = response?.error || 'Unable to save automatic step advancement setting.';
  }
  autoAdvance.disabled = false;
});

autoSubmit.addEventListener('change', async () => {
  autoSubmit.disabled = true;
  const response = await send({
    type: 'ROLEMATCH_SAVE_SETTINGS',
    settings: { autoSubmitEnabled: autoSubmit.checked },
  }).catch((error) => ({ ok: false, error: error.message }));
  if (!response?.ok) {
    autoSubmit.checked = !autoSubmit.checked;
    tabStatus.textContent = response?.error || 'Unable to save automatic submission setting.';
  }
  autoSubmit.disabled = false;
});

continueLogin.addEventListener('change', async () => {
  continueLogin.disabled = true;
  const response = await send({
    type: 'ROLEMATCH_SAVE_SETTINGS',
    settings: { continueAfterLoginEnabled: continueLogin.checked },
  }).catch((error) => ({ ok: false, error: error.message }));
  if (!response?.ok) {
    continueLogin.checked = !continueLogin.checked;
    tabStatus.textContent = response?.error || 'Unable to save ATS account setting.';
  }
  continueLogin.disabled = false;
});

chrome.runtime.onMessage.addListener((message) => {
  if (message?.type !== 'ROLEMATCH_PAUSE_STATE_CHANGED') return false;
  extensionPaused = Boolean(message.paused);
  renderControls();
  return false;
});

async function init() {
  await Promise.all([refreshConnection(), refreshSettings()]);
  await loadActiveTab();
  await scanFields();
}

void init();
