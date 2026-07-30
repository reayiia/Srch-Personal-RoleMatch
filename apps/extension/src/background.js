const STORAGE_KEYS = {
  connection: 'rolematch.connection',
  pendingApplications: 'rolematch.pendingApplications',
  settings: 'rolematch.settings',
};

const DEFAULT_SETTINGS = {
  showCompletionPrompt: true,
  paused: false,
  autoAdvanceEnabled: false,
  autoSubmitEnabled: false,
  continueAfterLoginEnabled: false,
};

const APPLICATION_SESSION_TTL_MS = 8 * 60 * 60 * 1000;
const TAB_MESSAGE_TIMEOUT_MS = 3000;
const FILL_TAB_MESSAGE_TIMEOUT_MS = 180000;
const API_REQUEST_TIMEOUT_MS = 5000;

function storageGet(keys) {
  return chrome.storage.local.get(keys);
}

function storageSet(values) {
  return chrome.storage.local.set(values);
}

function normalizeUrl(value) {
  try {
    const url = new URL(value);
    url.hash = '';
    if (/recruiting2?\.ultipro\.com$/i.test(url.hostname)) {
      let opportunityId = url.searchParams.get('opportunityId');
      if (!opportunityId) {
        for (const key of ['redirectUrl', 'cancelUrl', 'returnUrl']) {
          const nestedValue = url.searchParams.get(key);
          if (!nestedValue) continue;
          try {
            const nestedUrl = new URL(nestedValue, url.origin);
            opportunityId = nestedUrl.searchParams.get('opportunityId');
            if (opportunityId) {
              url.pathname = nestedUrl.pathname;
              break;
            }
          } catch {
            // Keep the outer URL when a vendor-provided callback is malformed.
          }
        }
      }
      url.search = opportunityId ? `?opportunityId=${opportunityId}` : '';
      url.pathname = url.pathname
        .replace(/\/(?:Account\/Register|OpportunityApply)(?:\/.*)?$/i, '/OpportunityDetail')
        .replace(/\/$/, '');
      return url.toString().toLowerCase();
    }
    if (/jobs\.dayforcehcm\.com$/i.test(url.hostname)) {
      url.search = '';
      url.pathname = url.pathname
        .replace(/\/jobs\/(\d+)\/apply(?:\/.*)?$/i, '/jobs/$1')
        .replace(/\/$/, '');
      return url.toString().toLowerCase();
    }
    if (url.hostname.includes('.dayforcehcm.com') && /\/CandidatePortal\//i.test(url.pathname)) {
      const postingId = url.searchParams.get('jobPostingId')
        || url.searchParams.get('postingId')
        || url.pathname.match(/\/Posting\/View\/([^/]+)/i)?.[1];
      if (postingId) {
        url.pathname = `/CandidatePortal/job/${encodeURIComponent(postingId)}`;
        url.search = '';
        return url.toString().toLowerCase();
      }
    }
    if (url.hostname.includes('.successfactors.') || /hcm\.ondemand\.com$/i.test(url.hostname)) {
      const jobId = url.searchParams.get('career_job_req_id') || url.searchParams.get('jobId');
      const company = url.searchParams.get('company');
      if (jobId) {
        url.pathname = '/career';
        url.search = '';
        if (company) url.searchParams.set('company', company);
        url.searchParams.set('job', jobId);
        return url.toString().toLowerCase();
      }
    }
    if (/taleo\.net$/i.test(url.hostname) || url.hostname.includes('.taleo.net') || url.hostname === 'careers.who.int') {
      const jobId = url.searchParams.get('job') || url.searchParams.get('jobid');
      if (jobId) {
        url.pathname = url.pathname.replace(/\/(?:jobapply|jobdetail)\.ftl$/i, '/jobdetail.ftl');
        url.search = '';
        url.searchParams.set('job', jobId);
        return url.toString().toLowerCase();
      }
    }
    if ((/oraclecloud\.com$/i.test(url.hostname) || url.hostname.includes('.oraclecloud.com')) && /\/hcmUI\/CandidateExperience\//i.test(url.pathname)) {
      const jobPath = url.pathname.match(/^(.*?\/sites\/[^/]+\/job\/[^/]+)/i)?.[1];
      if (jobPath) {
        url.pathname = jobPath.replace(/\/$/, '');
        url.search = '';
        return url.toString().toLowerCase();
      }
    }
    url.search = '';
    if (/icims\.com$/i.test(url.hostname) || url.hostname.includes('.icims.com')) {
      url.pathname = url.pathname.replace(/\/(?:login|apply|profile|questions|review|thanks)\/?$/i, '/job');
    }
    url.pathname = url.pathname
      .replace(/\/apply\/?$/i, '')
      .replace(/\/thanks\/?$/i, '')
      .replace(/\/$/, '');
    return url.toString().toLowerCase();
  } catch {
    return String(value || '').replace(/[?#].*$/, '').replace(/\/$/, '').toLowerCase();
  }
}

function pendingIsFresh(pendingApplication) {
  const updatedAt = pendingApplication?.updatedAt || pendingApplication?.createdAt;
  const timestamp = updatedAt ? Date.parse(updatedAt) : 0;
  return Number.isFinite(timestamp) && Date.now() - timestamp < APPLICATION_SESSION_TTL_MS;
}

function detectAts(urlValue) {
  try {
    const url = new URL(urlValue);
    if (/greenhouse\.io$/i.test(url.hostname) || url.hostname.includes('.greenhouse.io')) return 'greenhouse';
    if (/lever\.co$/i.test(url.hostname) || url.hostname.includes('.lever.co')) return 'lever';
    if (/ashbyhq\.com$/i.test(url.hostname) || url.hostname.includes('.ashbyhq.com')) return 'ashby';
    if (/myworkdayjobs\.com$/i.test(url.hostname) || /workdayjobs\.com$/i.test(url.hostname) || url.hostname.includes('.myworkdayjobs.com') || url.hostname.includes('.workdayjobs.com')) return 'workday';
    if (/smartrecruiters\.com$/i.test(url.hostname) || url.hostname.includes('.smartrecruiters.com')) return 'smartrecruiters';
    if (/recruitee\.com$/i.test(url.hostname) || url.hostname.includes('.recruitee.com')) return 'recruitee';
    if (/icims\.com$/i.test(url.hostname) || url.hostname.includes('.icims.com')) return 'icims';
    if (/workable\.com$/i.test(url.hostname) || url.hostname.includes('.workable.com')) return 'workable';
    if (/successfactors\.(?:com|eu|cn)$/i.test(url.hostname) || url.hostname.includes('.successfactors.') || /hcm\.ondemand\.com$/i.test(url.hostname) || url.hostname.includes('.hcm.ondemand.com')) return 'successfactors';
    if ((/oraclecloud\.com$/i.test(url.hostname) || url.hostname.includes('.oraclecloud.com')) && /\/hcmUI\/CandidateExperience\//i.test(url.pathname)) return 'oracle';
    if (/taleo\.net$/i.test(url.hostname) || url.hostname.includes('.taleo.net') || url.hostname === 'careers.who.int') return 'taleo';
    if (/(?:recruiting2?|signin-us)\.ultipro\.com$/i.test(url.hostname)) return 'ukg';
    if (/jobs\.dayforcehcm\.com$/i.test(url.hostname) || (url.hostname.includes('.dayforcehcm.com') && /\/CandidatePortal\//i.test(url.pathname))) return 'dayforce';
  } catch {
    return 'unknown';
  }

  return 'unknown';
}

function applyUrl(jobUrl) {
  const ats = detectAts(jobUrl);
  try {
    const url = new URL(jobUrl);
    url.hash = '';
    if (ats === 'lever') {
      if (!/\/apply\/?$/i.test(url.pathname)) {
        url.pathname = `${url.pathname.replace(/\/$/, '')}/apply`;
      }
      url.searchParams.set('lever-source', 'RoleMatch');
      return url.toString();
    }
    if (ats === 'workable') {
      if (!/\/apply\/?$/i.test(url.pathname)) {
        url.pathname = `${url.pathname.replace(/\/$/, '')}/apply/`;
      }
      return url.toString();
    }
    if (ats === 'icims') {
      url.searchParams.set('mode', 'apply');
      url.searchParams.set('apply', 'yes');
      return url.toString();
    }
    return jobUrl;
  } catch {
    return jobUrl;
  }
}

async function getConnection() {
  const result = await storageGet(STORAGE_KEYS.connection);
  return result[STORAGE_KEYS.connection] ?? null;
}

async function saveConnection(connection) {
  const normalized = {
    apiBaseUrl: connection.apiBaseUrl || 'http://localhost:5000',
    frontendBaseUrl: connection.frontendBaseUrl || 'http://localhost:5173',
    token: connection.token,
    connectedAt: new Date().toISOString(),
  };

  if (!normalized.token) {
    throw new Error('RoleMatch is not logged in. Sign in locally before connecting the extension.');
  }

  await storageSet({ [STORAGE_KEYS.connection]: normalized });
  return normalized;
}

async function getPendingApplications() {
  const result = await storageGet(STORAGE_KEYS.pendingApplications);
  return result[STORAGE_KEYS.pendingApplications] ?? {};
}

async function savePendingApplication(job, options = {}) {
  const pending = await getPendingApplications();
  const sessionId = globalThis.crypto?.randomUUID?.()
    ?? `session-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const key = `session:${sessionId}`;
  const targetUrl = options.targetUrl || job.jobUrl;
  const now = new Date().toISOString();
  const nextPending = {
    ...pending,
    [key]: {
      sessionId,
      job: { ...job, jobUrl: job.jobUrl },
      ats: detectAts(job.jobUrl),
      autoFill: options.autoFill !== false,
      tabId: null,
      state: 'opened',
      submitIntentAt: null,
      aliasUrls: [...new Set([job.jobUrl, targetUrl].map(normalizeUrl).filter(Boolean))],
      createdAt: now,
      updatedAt: now,
    },
  };
  await storageSet({ [STORAGE_KEYS.pendingApplications]: nextPending });
  return nextPending[key];
}

async function getSettings() {
  const result = await storageGet(STORAGE_KEYS.settings);
  return {
    ...DEFAULT_SETTINGS,
    ...(result[STORAGE_KEYS.settings] ?? {}),
  };
}

async function saveSettings(settings) {
  const current = await getSettings();
  const next = {
    ...current,
    ...(settings ?? {}),
    showCompletionPrompt: settings?.showCompletionPrompt === false ? false : settings?.showCompletionPrompt === true ? true : current.showCompletionPrompt,
    paused: typeof settings?.paused === 'boolean' ? settings.paused : current.paused,
    autoAdvanceEnabled: typeof settings?.autoAdvanceEnabled === 'boolean' ? settings.autoAdvanceEnabled : current.autoAdvanceEnabled,
    autoSubmitEnabled: typeof settings?.autoSubmitEnabled === 'boolean' ? settings.autoSubmitEnabled : current.autoSubmitEnabled,
    continueAfterLoginEnabled: typeof settings?.continueAfterLoginEnabled === 'boolean' ? settings.continueAfterLoginEnabled : current.continueAfterLoginEnabled,
  };
  await storageSet({ [STORAGE_KEYS.settings]: next });
  return next;
}

function pendingUrls(key, value) {
  return [...new Set([
    ...(Array.isArray(value?.aliasUrls) ? value.aliasUrls : []),
    value?.job?.jobUrl,
    key.startsWith('session:') ? '' : key,
  ].map(normalizeUrl).filter(Boolean))];
}

function urlsReferToSameApplication(first, second) {
  if (!first || !second) return false;
  return first === second || first.startsWith(`${second}/`) || second.startsWith(`${first}/`);
}

function findPendingEntry(pending, context = {}) {
  const normalizedContext = typeof context === 'string' ? { url: context } : context;
  const entries = Object.entries(pending ?? {})
    .filter(([, value]) => pendingIsFresh(value));
  const sessionId = String(normalizedContext.sessionId || '');
  if (sessionId) {
    const sessionEntry = entries.find(([, value]) => value?.sessionId === sessionId);
    if (sessionEntry) return { key: sessionEntry[0], value: sessionEntry[1] };
  }

  const tabId = Number(normalizedContext.tabId);
  if (Number.isInteger(tabId)) {
    const tabEntry = entries.find(([, value]) => Number(value?.tabId) === tabId);
    if (tabEntry) return { key: tabEntry[0], value: tabEntry[1] };
  }

  const current = normalizeUrl(normalizedContext.url);
  if (current) {
    const urlEntry = entries.find(([key, value]) => (
      pendingUrls(key, value).some((url) => urlsReferToSameApplication(current, url))
    ));
    if (urlEntry) return { key: urlEntry[0], value: urlEntry[1] };
  }

  return null;
}

function findPendingEntryForUrl(pending, url) {
  return findPendingEntry(pending, { url });
}

function directApplicationJob(job, url) {
  const jobUrl = normalizeUrl(job?.jobUrl || url);
  const title = String(job?.title || '').trim();
  const company = String(job?.company || '').trim();
  if (!jobUrl || !title || !company) return null;
  return {
    ...job,
    jobUrl,
    title,
    company,
    source: job?.source || 'RoleMatch',
  };
}

async function updatePendingApplication(key, updates = {}) {
  const pending = await getPendingApplications();
  const current = pending[key];
  if (!current) return null;
  const nextUrl = normalizeUrl(updates.url);
  const aliasUrls = [...new Set([
    ...(Array.isArray(current.aliasUrls) ? current.aliasUrls : []),
    ...(Array.isArray(updates.aliasUrls) ? updates.aliasUrls : []),
    nextUrl,
  ].map(normalizeUrl).filter(Boolean))];
  const next = {
    ...current,
    ...updates,
    aliasUrls,
    updatedAt: new Date().toISOString(),
  };
  delete next.url;
  await storageSet({
    [STORAGE_KEYS.pendingApplications]: {
      ...pending,
      [key]: next,
    },
  });
  return next;
}

async function bindPendingApplication(sessionId, tabId, url) {
  const pending = await getPendingApplications();
  const entry = findPendingEntry(pending, { sessionId });
  if (!entry) return null;
  return updatePendingApplication(entry.key, { tabId, url });
}

async function deletePendingApplication(key) {
  const pending = await getPendingApplications();
  if (!pending[key]) return;
  const nextPending = { ...pending };
  delete nextPending[key];
  await storageSet({ [STORAGE_KEYS.pendingApplications]: nextPending });
}

function apiRequestUrls(connection, path) {
  const primary = new URL(path, `${connection.apiBaseUrl.replace(/\/$/, '')}/`);
  const urls = [primary.toString()];
  if (primary.hostname === 'localhost') {
    const fallback = new URL(primary);
    fallback.hostname = '127.0.0.1';
    urls.push(fallback.toString());
  }
  return urls;
}

async function requestApiJson(connection, path, options = {}) {
  let lastError = null;
  for (const url of apiRequestUrls(connection, path)) {
    const controller = typeof AbortController === 'function' ? new AbortController() : null;
    let timeoutId;
    try {
      const request = fetch(url, {
        ...options,
        ...(controller ? { signal: controller.signal } : {}),
      });
      const response = typeof setTimeout === 'function'
        ? await Promise.race([
            request,
            new Promise((_, reject) => {
              timeoutId = setTimeout(() => {
                controller?.abort();
                const error = new Error('RoleMatch local API request timed out.');
                error.name = 'AbortError';
                reject(error);
              }, API_REQUEST_TIMEOUT_MS);
            }),
          ])
        : await request;
      const data = await response.json().catch(() => null);
      return { response, data };
    } catch (error) {
      lastError = error;
    } finally {
      if (timeoutId && typeof clearTimeout === 'function') clearTimeout(timeoutId);
    }
  }

  if (lastError?.name === 'AbortError') {
    throw new Error('RoleMatch local API request timed out. Confirm the local server is running and try again.');
  }
  throw lastError instanceof Error ? lastError : new Error('RoleMatch local API request failed.');
}

async function getProfile() {
  const connection = await getConnection();
  if (!connection?.token) {
    throw new Error('Connect the RoleMatch extension from the local app first.');
  }

  const { response, data } = await requestApiJson(connection, '/api/profile', {
    headers: {
      Authorization: `Bearer ${connection.token}`,
    },
  });

  if (!response.ok) {
    throw new Error(data?.error ?? `RoleMatch profile request failed (${response.status}).`);
  }

  return data;
}

async function resolveAtsCredential(url) {
  const connection = await getConnection();
  if (!connection?.token) {
    throw new Error('Connect the RoleMatch extension before using a saved ATS account.');
  }
  if (!url) {
    throw new Error('The ATS login origin could not be determined.');
  }

  const response = await fetch(`${connection.apiBaseUrl.replace(/\/$/, '')}/api/extension/ats-credentials/resolve`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${connection.token}`,
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store',
    },
    body: JSON.stringify({ url }),
    cache: 'no-store',
  });

  if (!response.ok) {
    const data = await response.json().catch(() => null);
    throw new Error(data?.error ?? `ATS account request failed (${response.status}).`);
  }

  const data = await response.json();
  return data?.credential ?? null;
}

function applicationPayload(job, status) {
  return {
    jobId: job.jobId || job.id,
    title: job.title,
    company: job.company,
    source: job.source || 'RoleMatch',
    jobUrl: job.jobUrl,
    location: job.location,
    status,
    evidenceNotes: status === 'submitted'
      ? 'Marked submitted by the RoleMatch autofill extension.'
      : 'Opened from RoleMatch and started in the external application flow.',
  };
}

async function markApplicationStatus(job, status) {
  const connection = await getConnection();
  if (!connection?.token) {
    throw new Error('Connect the RoleMatch extension from the local app first.');
  }
  if (!job?.jobUrl) {
    throw new Error('No job URL was provided.');
  }

  const { response, data } = await requestApiJson(connection, '/api/applications', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${connection.token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(applicationPayload(job, status)),
  });

  if (!response.ok) {
    throw new Error(data?.error ?? `Application tracking failed (${response.status}).`);
  }

  return data;
}

async function saveCustomAutofillAnswer(answer) {
  const connection = await getConnection();
  if (!connection?.token) {
    throw new Error('Connect the RoleMatch extension from the local app first.');
  }

  const { response, data } = await requestApiJson(connection, '/api/profile/autofill/custom', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${connection.token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(answer ?? {}),
  });

  if (!response.ok) {
    throw new Error(data?.error ?? `Custom answer save failed (${response.status}).`);
  }

  return data;
}

function arrayBufferToBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  const chunkSize = 0x8000;
  let binary = '';
  for (let index = 0; index < bytes.length; index += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunkSize));
  }

  return btoa(binary);
}

async function fetchProfileFile(file) {
  const connection = await getConnection();
  if (!connection?.token) {
    throw new Error('Connect the RoleMatch extension from the local app first.');
  }
  if (!file?.fileUrl) {
    throw new Error('No profile file URL was provided.');
  }

  const fileUrl = new URL(file.fileUrl, connection.apiBaseUrl.replace(/\/$/, '')).toString();
  const response = await fetch(fileUrl, {
    headers: {
      Authorization: `Bearer ${connection.token}`,
    },
  });

  if (!response.ok) {
    throw new Error(`Unable to fetch profile file (${response.status}).`);
  }

  const mimeType = file.mimeType || response.headers.get('content-type') || 'application/octet-stream';
  const arrayBuffer = await response.arrayBuffer();
  return {
    base64: arrayBufferToBase64(arrayBuffer),
    fileName: file.fileName || fileUrl.split('/').pop() || 'resume',
    mimeType,
  };
}

async function sendToTab(tabId, message) {
  return chrome.tabs.sendMessage(tabId, message);
}

function sendToTabFrame(tabId, message, frameId, timeoutMs = TAB_MESSAGE_TIMEOUT_MS) {
  return Promise.race([
    chrome.tabs.sendMessage(tabId, message, { frameId }),
    new Promise((_, reject) => {
      setTimeout(() => reject(new Error('RoleMatch tab message timed out.')), timeoutMs);
    }),
  ]);
}

async function sendToTabFrames(tabId, message, timeoutMs = TAB_MESSAGE_TIMEOUT_MS) {
  const frames = await Promise.race([
    chrome.webNavigation.getAllFrames({ tabId }),
    new Promise((resolve) => setTimeout(() => resolve([]), TAB_MESSAGE_TIMEOUT_MS)),
  ]).catch(() => []);
  const frameIds = frames.length > 0 ? frames.map((frame) => frame.frameId) : [0];
  const responses = (await Promise.all(frameIds.map((frameId) => (
    sendToTabFrame(tabId, message, frameId, timeoutMs).catch(() => null)
  )))).filter(Boolean);

  if (responses.length === 0) {
    throw new Error('RoleMatch could not reach a supported application frame in this tab.');
  }

  return responses
    .sort((first, second) => {
      const firstScore = Number(first?.scan?.total || first?.results?.length || first?.clicked || 0);
      const secondScore = Number(second?.scan?.total || second?.results?.length || second?.clicked || 0);
      return secondScore - firstScore;
    })[0];
}

async function broadcastPauseState(paused) {
  const tabs = await chrome.tabs.query({});
  await Promise.all(tabs
    .filter((tab) => tab.id && detectAts(tab.url) !== 'unknown')
    .map((tab) => sendToTabFrames(tab.id, {
      type: 'ROLEMATCH_PAUSE_STATE_CHANGED',
      paused,
    }).catch(() => null)));

  await chrome.runtime.sendMessage({
    type: 'ROLEMATCH_PAUSE_STATE_CHANGED',
    paused,
    source: 'background',
  }).catch(() => null);
}

async function broadcastSettings(settings) {
  const tabs = await chrome.tabs.query({});
  await Promise.all(tabs
    .filter((tab) => tab.id && detectAts(tab.url) !== 'unknown')
    .map((tab) => sendToTabFrames(tab.id, {
      type: 'ROLEMATCH_SETTINGS_CHANGED',
      settings,
    }).catch(() => null)));
}

async function broadcastProfileUpdated(profile, excludedTabId = null) {
  const tabs = await chrome.tabs.query({});
  const responses = await Promise.all(tabs
    .filter((tab) => tab.id && tab.id !== excludedTabId && detectAts(tab.url) !== 'unknown')
    .map((tab) => sendToTabFrames(tab.id, {
      type: 'ROLEMATCH_PROFILE_UPDATED',
      profile,
    }).catch(() => null)));

  return responses.filter(Boolean).length;
}

async function handleMessage(message, sender) {
  switch (message?.type) {
    case 'ROLEMATCH_CONNECT': {
      const connection = await saveConnection(message.payload ?? {});
      return { ok: true, connection: { ...connection, token: undefined } };
    }

    case 'ROLEMATCH_START_APPLICATION': {
      const payload = message.payload ?? {};
      const settings = await getSettings();
      if (settings.paused) {
        throw new Error('RoleMatch is paused. Resume the extension before starting an application.');
      }
      if (payload.connection) {
        await saveConnection(payload.connection);
      }

      if (!payload.job?.jobUrl) {
        throw new Error('No job URL was provided.');
      }

      const targetUrl = applyUrl(payload.job.jobUrl);
      const pending = await savePendingApplication(payload.job, { autoFill: true, targetUrl });
      const tab = await chrome.tabs.create({ url: targetUrl, active: true });
      const session = await bindPendingApplication(pending.sessionId, tab.id, targetUrl);
      void markApplicationStatus(payload.job, 'in_progress').catch((error) => {
        console.warn('[RoleMatch] Application opened, but the tracker update failed.', error);
      });
      return { ok: true, tabId: tab.id, pending: session ?? pending };
    }

    case 'ROLEMATCH_OPEN_APPLICATION': {
      const payload = message.payload ?? {};
      const settings = await getSettings();
      if (settings.paused) {
        throw new Error('RoleMatch is paused. Resume the extension before opening an application.');
      }
      if (payload.connection) {
        await saveConnection(payload.connection);
      }

      if (!payload.job?.jobUrl) {
        throw new Error('No job URL was provided.');
      }

      const targetUrl = applyUrl(payload.job.jobUrl);
      const pending = await savePendingApplication(payload.job, { autoFill: false, targetUrl });
      const tab = await chrome.tabs.create({ url: targetUrl, active: true });
      const session = await bindPendingApplication(pending.sessionId, tab.id, targetUrl);
      void markApplicationStatus(payload.job, 'in_progress').catch((error) => {
        console.warn('[RoleMatch] Application opened, but the tracker update failed.', error);
      });
      return { ok: true, tabId: tab.id, pending: session ?? pending };
    }

    case 'ROLEMATCH_GET_CONNECTION': {
      const connection = await getConnection();
      return { ok: true, connection: connection ? { ...connection, token: undefined } : null };
    }

    case 'ROLEMATCH_GET_SETTINGS': {
      const settings = await getSettings();
      return { ok: true, settings };
    }

    case 'ROLEMATCH_SAVE_SETTINGS': {
      const settings = await saveSettings(message.settings ?? {});
      await broadcastSettings(settings);
      return { ok: true, settings };
    }

    case 'ROLEMATCH_SET_PAUSED': {
      const settings = await saveSettings({ paused: Boolean(message.paused) });
      await broadcastPauseState(settings.paused);
      return { ok: true, paused: settings.paused, settings };
    }

    case 'ROLEMATCH_PAUSE_STATE_CHANGED': {
      return { ok: true, paused: Boolean(message.paused) };
    }

    case 'ROLEMATCH_GET_PROFILE': {
      const profile = await getProfile();
      return { ok: true, profile };
    }

    case 'ROLEMATCH_PROFILE_UPDATED': {
      const profile = await getProfile();
      const updatedTabs = await broadcastProfileUpdated(profile);
      return { ok: true, updatedTabs };
    }

    case 'ROLEMATCH_GET_ATS_CREDENTIAL': {
      const url = sender.url || sender.tab?.url || '';
      const credential = await resolveAtsCredential(url);
      return { ok: true, credential };
    }

    case 'ROLEMATCH_FETCH_PROFILE_FILE': {
      const file = await fetchProfileFile(message.file);
      return { ok: true, file };
    }

    case 'ROLEMATCH_SAVE_CUSTOM_ANSWER': {
      const settings = await getSettings();
      if (settings.paused) throw new Error('RoleMatch is paused. Resume the extension before saving an answer.');
      const data = await saveCustomAutofillAnswer(message.answer);
      const updatedTabs = data.profile
        ? await broadcastProfileUpdated(data.profile, sender.tab?.id ?? null)
        : 0;
      return { ok: true, ...data, updatedTabs };
    }

    case 'ROLEMATCH_MARK_APPLICATION_STATUS': {
      const data = await markApplicationStatus(message.job, message.status === 'submitted' ? 'submitted' : 'in_progress');
      return { ok: true, ...data };
    }

    case 'ROLEMATCH_APPLICATION_SUBMIT_INTENT': {
      const settings = await getSettings();
      if (settings.paused) throw new Error('RoleMatch is paused. Resume the extension before tracking a submission.');
      const pending = await getPendingApplications();
      const pendingEntry = findPendingEntry(pending, {
        sessionId: message.sessionId,
        tabId: sender.tab?.id,
        url: message.url || sender.tab?.url,
      });
      if (!pendingEntry) return { ok: true, settings, session: null };
      const submitIntentAt = new Date().toISOString();
      const session = await updatePendingApplication(pendingEntry.key, {
        tabId: sender.tab?.id ?? pendingEntry.value.tabId,
        url: message.url || sender.tab?.url,
        state: 'submit_intent',
        submitIntentAt,
      });
      return { ok: true, settings, session };
    }

    case 'ROLEMATCH_APPLICATION_SUBMITTED': {
      const settings = await getSettings();
      if (settings.paused) throw new Error('RoleMatch is paused. Resume the extension before tracking a submission.');
      if (message.confirmed !== true) {
        return { ok: false, error: 'A confirmed ATS success page is required before marking an application submitted.' };
      }
      const pending = await getPendingApplications();
      const pendingEntry = findPendingEntry(pending, {
        sessionId: message.sessionId,
        tabId: sender.tab?.id,
        url: message.url || sender.tab?.url || message.job?.jobUrl,
      });
      if (!pendingEntry) {
        return { ok: false, error: 'No tracked RoleMatch application session was found for this confirmation.' };
      }
      const submitIntentAt = pendingEntry.value.submitIntentAt ? Date.parse(pendingEntry.value.submitIntentAt) : 0;
      if (!Number.isFinite(submitIntentAt) || Date.now() - submitIntentAt >= 2 * 60 * 60 * 1000) {
        return { ok: false, error: 'A recent submit action is required before marking an application submitted.' };
      }
      const job = pendingEntry.value.job;
      const data = await markApplicationStatus(job, 'submitted');
      if (data.application !== null) {
        await deletePendingApplication(pendingEntry.key);
      }
      return { ok: true, settings, job, ...data };
    }

    case 'ROLEMATCH_ATS_READY': {
      const tabId = sender.tab?.id;
      if (tabId) {
        await chrome.sidePanel?.setOptions?.({ tabId, path: 'src/sidepanel.html', enabled: true }).catch(() => {});
      }

      let pending = await getPendingApplications();
      let pendingEntry = findPendingEntry(pending, {
        sessionId: message.sessionId,
        tabId,
        url: message.url ?? sender.tab?.url ?? '',
      });
      const directJob = message.isTopFrame === true
        ? directApplicationJob(message.job, message.url ?? sender.tab?.url ?? '')
        : null;
      if (!pendingEntry && directJob) {
        const directSession = await savePendingApplication(directJob, {
          targetUrl: message.url ?? sender.tab?.url ?? directJob.jobUrl,
          autoFill: false,
        });
        const session = await bindPendingApplication(
          directSession.sessionId,
          tabId,
          message.url ?? sender.tab?.url ?? directJob.jobUrl,
        );
        pending = await getPendingApplications();
        pendingEntry = findPendingEntry(pending, { sessionId: session?.sessionId || directSession.sessionId });
      }
      if (!pendingEntry) {
        const [profile, settings] = await Promise.all([getProfile(), getSettings()]);
        return {
          ok: true,
          shouldAutoFill: false,
          profile,
          job: directJob || message.job || null,
          settings,
        };
      }

      if (!pendingIsFresh(pendingEntry.value)) {
        await deletePendingApplication(pendingEntry.key);
        return { ok: true, shouldAutoFill: false };
      }

      const session = await updatePendingApplication(pendingEntry.key, {
        tabId: tabId ?? pendingEntry.value.tabId,
        url: message.url ?? sender.tab?.url ?? '',
        ats: message.ats || pendingEntry.value.ats,
      });
      const profile = await getProfile();
      const settings = await getSettings();
      const isIcms = String(message.ats || session?.ats || pendingEntry.value.ats || '').toLowerCase() === 'icims';
      const frameHasFields = Number(message.fieldCount || 0) > 0;
      const shouldAutoFill = pendingEntry.value.autoFill !== false && (!isIcms || frameHasFields);
      return {
        ok: true,
        shouldAutoFill,
        profile,
        job: pendingEntry.value.job,
        settings,
        sessionId: pendingEntry.value.sessionId,
        submitIntentAt: session?.submitIntentAt ?? pendingEntry.value.submitIntentAt ?? null,
      };
    }

    case 'ROLEMATCH_SCAN_TAB': {
      if (!message.tabId) throw new Error('No active ATS tab found.');
      const settings = await getSettings();
      if (settings.paused) throw new Error('RoleMatch is paused. Resume the extension before scanning fields.');
      return sendToTabFrames(message.tabId, { type: 'ROLEMATCH_SCAN_FIELDS' });
    }

    case 'ROLEMATCH_FILL_TAB': {
      if (!message.tabId) throw new Error('No active ATS tab found.');
      const settings = await getSettings();
      if (settings.paused) throw new Error('RoleMatch is paused. Resume the extension before filling fields.');
      const profile = await getProfile();
      return sendToTabFrames(
        message.tabId,
        { type: 'ROLEMATCH_FILL_FIELDS', profile, job: message.job ?? null },
        FILL_TAB_MESSAGE_TIMEOUT_MS,
      );
    }

    case 'ROLEMATCH_FILL_CURRENT_TAB': {
      const tabId = sender.tab?.id;
      if (!tabId) throw new Error('No active ATS tab found.');
      const settings = await getSettings();
      if (settings.paused) throw new Error('RoleMatch is paused. Resume the extension before filling fields.');
      const profile = await getProfile();
      return sendToTabFrames(
        tabId,
        { type: 'ROLEMATCH_FILL_FIELDS', profile, job: message.job ?? null },
        FILL_TAB_MESSAGE_TIMEOUT_MS,
      );
    }

    case 'ROLEMATCH_OPEN_FORM_TAB': {
      if (!message.tabId) throw new Error('No active ATS tab found.');
      const settings = await getSettings();
      if (settings.paused) throw new Error('RoleMatch is paused. Resume the extension before opening the application form.');
      return sendToTabFrames(message.tabId, { type: 'ROLEMATCH_OPEN_FORM' });
    }

    default:
      return { ok: false, error: 'Unknown RoleMatch extension message.' };
  }
}

chrome.runtime.onInstalled.addListener(() => {
  chrome.sidePanel?.setPanelBehavior?.({ openPanelOnActionClick: true }).catch(() => {});
});

chrome.tabs.onRemoved?.addListener((tabId) => {
  void (async () => {
    const pending = await getPendingApplications();
    const entry = findPendingEntry(pending, { tabId });
    if (!entry) return;
    await updatePendingApplication(entry.key, {
      tabId: null,
      state: entry.value.state === 'submitted' ? 'submitted' : 'closed',
      submitIntentAt: null,
    });
  })().catch(() => {});
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  handleMessage(message, sender)
    .then((response) => sendResponse(response))
    .catch((error) => sendResponse({ ok: false, error: error instanceof Error ? error.message : String(error) }));
  return true;
});
