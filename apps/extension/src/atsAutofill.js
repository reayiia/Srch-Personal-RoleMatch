const ROLEMATCH_FIELD_ID = 'data-rolematch-field-id';
const ROLEMATCH_PANEL_ID = 'rolematch-autofill-panel';
const ROLEMATCH_PANEL_SHELL_ID = 'rolematch-autofill-shell';
const ROLEMATCH_FILLED_ATTR = 'data-rolematch-filled';

const state = {
  ats: detectAts(),
  profile: null,
  job: null,
  settings: {
    showCompletionPrompt: true,
    paused: false,
    autoAdvanceEnabled: false,
    autoSubmitEnabled: false,
    continueAfterLoginEnabled: false,
  },
  lastScan: null,
  lastFillResults: [],
  completion: null,
  status: 'Ready',
  statusBeforePause: '',
  paused: false,
  filling: false,
  savingAnswerId: '',
  customAnswerDrafts: {},
  sessionId: '',
  submitIntentAt: null,
  submitIntentSent: false,
  submitHandled: false,
  submitListenersAttached: false,
  autoAdvanceInProgress: false,
  lastAdvancedStepSignature: '',
  stepAdvanceReadiness: null,
  autoSubmitAttempted: false,
  submissionReadiness: null,
  loginContinueAttempted: false,
  credentialLookupAttempted: false,
  credentialStatus: '',
};

let fieldCounter = 0;
let fieldRefreshTimer = null;
let fieldObserver = null;
let autoAdvanceTimer = null;
let autoSubmitTimer = null;
let loginContinueTimer = null;
const observedFieldRoots = new WeakSet();
const pauseWaiters = new Set();

function extensionIsPaused() {
  return state.paused;
}

function applyPauseState(paused) {
  const nextPaused = Boolean(paused);
  state.settings = {
    ...state.settings,
    paused: nextPaused,
  };

  if (nextPaused === state.paused) {
    renderPanel();
    return;
  }

  if (nextPaused) {
    state.statusBeforePause = state.status;
    state.paused = true;
    state.status = state.filling
      ? 'Autofill paused. Resume to continue.'
      : 'Extension paused.';
  } else {
    state.paused = false;
    state.status = state.filling
      ? 'Resuming autofill'
      : state.statusBeforePause || 'Ready';
    state.statusBeforePause = '';
    const waiting = Array.from(pauseWaiters);
    pauseWaiters.clear();
    waiting.forEach((resolve) => resolve());
  }

  renderPanel();
}

async function setExtensionPaused(paused) {
  const previousPaused = state.paused;
  if (paused) applyPauseState(true);
  const response = await sendMessage({
    type: 'ROLEMATCH_SET_PAUSED',
    paused,
  }).catch((error) => ({ ok: false, error: error instanceof Error ? error.message : String(error) }));

  if (!response?.ok) {
    if (paused) applyPauseState(previousPaused);
    state.status = response?.error || 'Unable to change the extension pause state.';
    renderPanel();
    return false;
  }

  applyPauseState(response.settings?.paused === true);
  return true;
}

async function waitUntilResumed() {
  if (!state.paused) return;
  await new Promise((resolve) => pauseWaiters.add(resolve));
}

function detectAts() {
  const host = window.location.hostname;
  if (host.includes('greenhouse.io')) return 'Greenhouse';
  if (host.includes('lever.co')) return 'Lever';
  if (host.includes('ashbyhq.com')) return 'Ashby';
  if (host.includes('myworkdayjobs.com') || host.includes('workdayjobs.com')) return 'Workday';
  if (host.includes('smartrecruiters.com')) return 'SmartRecruiters';
  if (host.includes('recruitee.com')) return 'Recruitee';
  if (host.includes('icims.com')) return 'iCIMS';
  if (host.includes('workable.com')) return 'Workable';
  if (host.includes('successfactors.com') || host.includes('successfactors.eu') || host.includes('successfactors.cn') || host.includes('hcm.ondemand.com')) {
    return 'SuccessFactors';
  }
  if (host.includes('oraclecloud.com') && /\/hcmUI\/CandidateExperience\//i.test(window.location.href)) {
    return 'Oracle Recruiting Cloud';
  }
  if (host.includes('taleo.net') || host === 'careers.who.int') return 'Taleo';
  if (/^(?:recruiting2?|signin-us)\.ultipro\.com$/i.test(host)) return 'UKG Pro Recruiting';
  if (host === 'jobs.dayforcehcm.com' || (host.endsWith('.dayforcehcm.com') && /\/CandidatePortal\//i.test(window.location.href))) {
    return 'Dayforce';
  }
  return 'Supported ATS';
}

function pageJobPosting() {
  const candidates = [];
  const collect = (value) => {
    if (Array.isArray(value)) {
      value.forEach(collect);
      return;
    }
    if (!value || typeof value !== 'object') return;
    candidates.push(value);
    if (Array.isArray(value['@graph'])) value['@graph'].forEach(collect);
  };

  document.querySelectorAll('script[type="application/ld+json"]').forEach((script) => {
    try {
      collect(JSON.parse(script.textContent || 'null'));
    } catch {
      // Ignore unrelated or malformed page metadata.
    }
  });

  return candidates.find((candidate) => {
    const types = Array.isArray(candidate['@type']) ? candidate['@type'] : [candidate['@type']];
    return types.some((type) => String(type || '').toLowerCase() === 'jobposting');
  }) || null;
}

function salaryAmount(value) {
  const raw = String(value ?? '').trim();
  if (!raw) return null;
  const numeric = Number(raw.replace(/[$,\s]/g, '').replace(/[kK]$/, ''));
  if (!Number.isFinite(numeric) || numeric <= 0) return null;
  return /[kK]$/.test(raw) ? numeric * 1000 : numeric;
}

function annualSalaryContextFromPosting(posting) {
  const baseSalary = Array.isArray(posting?.baseSalary) ? posting.baseSalary[0] : posting?.baseSalary;
  const value = baseSalary?.value ?? baseSalary;
  const unitText = compactText(value?.unitText ?? baseSalary?.unitText, 30).toUpperCase();
  const currency = compactText(baseSalary?.currency ?? posting?.salaryCurrency, 10).toUpperCase();
  const salaryMin = salaryAmount(value?.minValue ?? value?.value ?? value);
  const salaryMax = salaryAmount(value?.maxValue ?? value?.value ?? value);

  if (!salaryMin || !salaryMax || (unitText && !/YEAR|ANNUAL/.test(unitText))) return {};
  if (currency && currency !== 'USD') return {};

  return {
    salaryMin: Math.min(salaryMin, salaryMax),
    salaryMax: Math.max(salaryMin, salaryMax),
    salaryCurrency: currency || 'USD',
    salaryPeriod: 'YEAR',
  };
}

function annualSalaryContextFromPage() {
  const text = String(document.body?.innerText || document.body?.textContent || '').replace(/\u00a0/g, ' ');
  const rangePattern = /(?:salary\s+range|base\s+salary(?:\s+range)?|pay\s+range|compensation(?:\s+range)?|range\s+for\s+this\s+position)[^$]{0,260}\$\s*(\d{2,3}(?:,\d{3})+|\d{2,3}(?:\.\d+)?\s*[kK])\s*(?:-|–|—|to)\s*\$?\s*(\d{2,3}(?:,\d{3})+|\d{2,3}(?:\.\d+)?\s*[kK])/i;
  const match = text.match(rangePattern);
  const salaryMin = salaryAmount(match?.[1]);
  const salaryMax = salaryAmount(match?.[2]);
  if (!salaryMin || !salaryMax) return {};

  return {
    salaryMin: Math.min(salaryMin, salaryMax),
    salaryMax: Math.max(salaryMin, salaryMax),
    salaryCurrency: 'USD',
    salaryPeriod: 'YEAR',
  };
}

function currentPageJobContext(job = {}) {
  const ats = detectAts();
  if (![
    'Greenhouse',
    'Lever',
    'Ashby',
    'SmartRecruiters',
    'Recruitee',
    'iCIMS',
    'Workable',
    'SuccessFactors',
    'Oracle Recruiting Cloud',
    'Taleo',
    'UKG Pro Recruiting',
    'Dayforce',
  ].includes(ats)) return job ?? {};

  const posting = pageJobPosting();
  const titleParts = String(document.title || '').match(/^(.+?)\s+@\s+(.+)$/);
  const greenhouseTitleParts = String(document.title || '').match(/^Job Application for (.+?) at (.+)$/i);
  const heading = compactText(document.querySelector('h1')?.textContent, 180);
  const title = compactText(posting?.title, 180)
    || heading
    || compactText(greenhouseTitleParts?.[1], 180)
    || compactText(titleParts?.[1], 180);
  const company = compactText(posting?.hiringOrganization?.name, 120)
    || compactText(greenhouseTitleParts?.[2], 120)
    || compactText(titleParts?.[2], 120);
  const postingSalary = annualSalaryContextFromPosting(posting);
  const salaryContext = Object.keys(postingSalary).length > 0 ? postingSalary : annualSalaryContextFromPage();

  return {
    ...(job ?? {}),
    ...(title ? { title } : {}),
    ...(company ? { company } : {}),
    ...salaryContext,
    jobUrl: window.location.href,
    url: window.location.href,
  };
}

function normalize(value) {
  return String(value ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9+#./@$ -]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function compactText(value, maxLength = 260) {
  const text = String(value ?? '').replace(/\s+/g, ' ').trim();
  return text.length > maxLength ? text.slice(0, maxLength).trim() : text;
}

function questionLeadText(value) {
  const text = compactText(value, 520).replace(/[âœ±✱*]+/g, ' ').trim();
  const question = text.match(/^(.+?\?)/);
  if (question?.[1]) return compactText(question[1], 220);
  const selectIndex = text.search(/\b(select|choose|type your response|yes no|high school diploma|linkedin job postings)\b/i);
  if (selectIndex > 8) return compactText(text.slice(0, selectIndex), 220);
  return compactText(text, 220);
}

function cleanFieldLabelNoise(value) {
  return String(value ?? '')
    .replace(/no location found.*$/i, '')
    .replace(/try entering a different location.*$/i, '')
    .replace(/loading.*$/i, '')
    .trim();
}

function uniqueParts(parts) {
  return Array.from(new Set(parts.map((part) => compactText(part)).filter(Boolean)));
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function visible(element) {
  if (!(element instanceof HTMLElement)) return false;
  if (element.disabled) return false;
  if (element.type === 'hidden') return false;
  for (let current = element; current; current = parentAcrossShadow(current)) {
    if (current.getAttribute?.('aria-hidden') === 'true') return false;
  }
  const style = window.getComputedStyle(element);
  if (style.display === 'none' || style.visibility === 'hidden') return false;
  if (style.opacity === '0') {
    const dayforceCombobox = state.ats === 'Dayforce'
      && element.getAttribute('role') === 'combobox'
      && element.closest?.('.ant-select');
    if (!dayforceCombobox) return false;
  }
  const rect = element.getBoundingClientRect();
  return rect.width > 0 && rect.height > 0;
}

function deepQuerySelectorAll(selector, root = document) {
  const matches = [];
  const roots = [root];
  const seenRoots = new Set();

  while (roots.length > 0) {
    const currentRoot = roots.shift();
    if (!currentRoot?.querySelectorAll || seenRoots.has(currentRoot)) continue;
    seenRoots.add(currentRoot);
    matches.push(...Array.from(currentRoot.querySelectorAll(selector)));
    Array.from(currentRoot.querySelectorAll('*')).forEach((element) => {
      if (element.shadowRoot && !seenRoots.has(element.shadowRoot)) roots.push(element.shadowRoot);
    });
  }

  return Array.from(new Set(matches));
}

function deepQuerySelector(selector, root = document) {
  return deepQuerySelectorAll(selector, root)[0] || null;
}

function elementRoot(element) {
  return element?.getRootNode?.() || document;
}

function parentAcrossShadow(element) {
  if (element?.parentElement) return element.parentElement;
  const root = elementRoot(element);
  return root?.host instanceof HTMLElement ? root.host : null;
}

function closestAcrossShadow(element, selector) {
  let current = element;
  const visited = new Set();
  while (current instanceof HTMLElement && !visited.has(current)) {
    visited.add(current);
    const found = current.closest?.(selector);
    if (found) return found;
    const root = elementRoot(current);
    current = root?.host instanceof HTMLElement ? root.host : null;
  }
  return null;
}

function crossShadowNodes(element, maxDepth = 8) {
  const nodes = [];
  let current = element;
  const visited = new Set();
  while (current instanceof HTMLElement && nodes.length < maxDepth && !visited.has(current)) {
    visited.add(current);
    nodes.push(current);
    current = parentAcrossShadow(current);
  }
  return nodes;
}

function crossShadowIdentity(element, maxDepth = 8) {
  return normalize(crossShadowNodes(element, maxDepth).flatMap((node) => {
    const text = compactText(node.innerText || node.textContent || '', 260);
    return [
      node.tagName,
      node.id,
      node.getAttribute?.('name'),
      node.getAttribute?.('label'),
      node.getAttribute?.('label-hint'),
      node.getAttribute?.('labelled-by'),
      node.getAttribute?.('aria-label'),
      node.getAttribute?.('placeholder'),
      node.getAttribute?.('title'),
      node.getAttribute?.('data-test'),
      node.getAttribute?.('data-qa'),
      node.getAttribute?.('data-testid'),
      node.getAttribute?.('data-automation-id'),
      node.getAttribute?.('formcontrolname'),
      text.length <= 240 ? text : '',
    ];
  }).filter(Boolean).join(' '));
}

function elementByIdNear(element, id) {
  if (!id) return null;
  const root = elementRoot(element);
  return root?.getElementById?.(id)
    || root?.querySelector?.(`#${CSS.escape(id)}`)
    || document.getElementById(id);
}

function rawFieldIdentity(element) {
  return crossShadowIdentity(element, 5);
}

function isAutofillTrap(element) {
  const identity = normalize([
    element?.tagName,
    element?.id,
    element?.getAttribute?.('name'),
    element?.getAttribute?.('aria-label'),
    element?.getAttribute?.('placeholder'),
    element?.getAttribute?.('autocomplete'),
    element?.getAttribute?.('data-qa'),
    element?.getAttribute?.('data-testid'),
    element?.getAttribute?.('data-automation-id'),
    ...Array.from(element?.labels || []).map((label) => label?.textContent || ''),
  ].filter(Boolean).join(' '));
  if (/beecatcher|honeypot|robots? only|do not enter if you(?:'| a)?re human|leave (?:this )?field blank/.test(identity)) {
    return true;
  }

  const rect = element?.getBoundingClientRect?.();
  return Boolean(
    rect
    && rect.width <= 1
    && rect.height <= 1
    && /website|url|homepage/.test(identity)
  );
}

function isNonApplicationMenu(element) {
  if (closestAcrossShadow(element, '[role="option"], [data-automation-id="promptOption"], [data-automation-id="menuItem"]')) {
    return true;
  }
  if (element?.tagName !== 'BUTTON') return false;
  const identity = rawFieldIdentity(element);
  return /utility menu|utilitymenubutton|language|hammy menu|hammymenuicon|main menu|search for jobs|talent community|sign in/.test(identity);
}

function isSupportedApplicationSurface() {
  const href = String(window.location.href || '');
  const pathname = String(window.location.pathname || '');

  if (state.ats === 'Greenhouse') {
    return /\/jobs\/\d+(?:\/|$)/.test(pathname)
      || /\/embed\/job_app(?:\/|$)/.test(pathname)
      || /[?&](?:gh_jid|token)=\d+/.test(href);
  }

  if (state.ats === 'Ashby') {
    return /\/application(?:\/|$)/.test(pathname);
  }

  return true;
}

function usefulDirectLabelPart(value) {
  const text = compactText(value, 180);
  if (!text) return false;
  return !/^(start typing|type here|select|select one|choose|search|hello@example\.com)(?:\.{3})?$/i.test(text);
}

function nativeSetValue(element, value, options = {}) {
  const prototype = element.tagName === 'TEXTAREA'
    ? window.HTMLTextAreaElement.prototype
    : window.HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(prototype, 'value')?.set;
  if (setter) setter.call(element, value);
  else element.value = value;
  try {
    element.dispatchEvent(new InputEvent('input', {
      bubbles: true,
      cancelable: true,
      data: String(value ?? ''),
      inputType: 'insertText',
    }));
  } catch {
    element.dispatchEvent(new Event('input', { bubbles: true }));
  }
  element.dispatchEvent(new Event('change', { bubbles: true }));
  if (options.blur !== false) element.dispatchEvent(new Event('blur', { bubbles: true }));
}

function nativeSetChecked(element, checked) {
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'checked')?.set;
  if (setter) setter.call(element, checked);
  else element.checked = checked;
  element.dispatchEvent(new Event('input', { bubbles: true }));
  element.dispatchEvent(new Event('change', { bubbles: true }));
}

function dispatchTextKeyEvent(element, eventType, key) {
  const digit = /^\d$/.test(key);
  const keyCode = digit ? key.charCodeAt(0) : (key === 'Backspace' ? 8 : 0);
  const event = new KeyboardEvent(eventType, {
    bubbles: true,
    cancelable: true,
    key,
    code: digit ? `Digit${key}` : key,
    view: window,
  });
  Object.defineProperty(event, 'keyCode', { get: () => keyCode });
  Object.defineProperty(event, 'which', { get: () => keyCode });
  Object.defineProperty(event, 'charCode', { get: () => (eventType === 'keypress' && digit ? keyCode : 0) });
  element.dispatchEvent(event);
}

function dispatchInputValue(element, value, data, inputType) {
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set;
  if (setter) setter.call(element, value);
  else element.value = value;
  try {
    element.dispatchEvent(new InputEvent('input', {
      bubbles: true,
      cancelable: true,
      data,
      inputType,
    }));
  } catch {
    element.dispatchEvent(new Event('input', { bubbles: true }));
  }
}

function isWorkdayDateSegment(element) {
  if (state.ats !== 'Workday') return false;
  const id = String(element?.id || '');
  return /^workExperience-\d+--(?:startDate|endDate)-dateSection(?:Month|Year)-input$/i.test(id)
    || /^education-\d+--(?:firstYearAttended|lastYearAttended)-dateSectionYear-input$/i.test(id);
}

async function fillWorkdayDateSegment(element, match) {
  const id = String(element.id || '');
  const desired = String(match.answer ?? '').replace(/\D/g, '');
  if (!id || !desired) return { filled: false, reason: 'Workday date segment is empty' };

  let current = document.getElementById(id) || element;
  current.focus?.();
  dispatchTextKeyEvent(current, 'keydown', 'Backspace');
  dispatchInputValue(current, '', null, 'deleteContentBackward');
  dispatchTextKeyEvent(current, 'keyup', 'Backspace');
  await wait(120);

  for (const character of desired) {
    current = document.getElementById(id) || current;
    current.focus?.();
    const nextValue = `${String(current.value || '')}${character}`;
    dispatchTextKeyEvent(current, 'keydown', character);
    dispatchTextKeyEvent(current, 'keypress', character);
    dispatchInputValue(current, nextValue, character, 'insertText');
    dispatchTextKeyEvent(current, 'keyup', character);
    await wait(120);
  }

  current = document.getElementById(id) || current;
  current.dispatchEvent(new Event('change', { bubbles: true }));
  current.blur?.();
  await wait(180);
  current = document.getElementById(id) || current;

  const committed = String(current.value || '').replace(/\D/g, '');
  const matches = /datesectionmonth/i.test(id)
    ? Number(committed) === Number(desired)
    : committed === desired;
  if (!matches) return { filled: false, reason: 'Workday date segment did not stick' };

  current.setAttribute(ROLEMATCH_FILLED_ATTR, 'true');
  return { filled: true, value: String(current.value || match.answer) };
}

function inferredFieldLabel(element) {
  const raw = [
    element.getAttribute('name'),
    element.id,
    element.getAttribute('data-qa'),
    element.getAttribute('data-testid'),
    element.getAttribute('test-id'),
    element.getAttribute('data-automation-id'),
    element.getAttribute('data-uxi-widget-type'),
    element.getAttribute('autocomplete'),
    elementRoot(element)?.host instanceof HTMLElement ? crossShadowIdentity(element, 8) : '',
  ].filter(Boolean).join(' ');
  const source = normalize(raw.replace(/[\][_.:-]+/g, ' '));
  const groupHeading = normalize(
    element.closest?.('[role="group"]')?.querySelector?.('h4, [role="heading"]')?.textContent || '',
  );

  if (/workexperience \d+ jobtitle/.test(source)) return 'Job title';
  if (/workexperience \d+ companyname/.test(source)) return 'Company';
  if (/workexperience \d+ location/.test(source)) return 'Work location';
  if (/workexperience \d+ currentlyworkhere/.test(source)) return 'I currently work here';
  if (/workexperience \d+ startdate datesectionmonth/.test(source)) return 'Work start month';
  if (/workexperience \d+ startdate datesectionyear/.test(source)) return 'Work start year';
  if (/workexperience \d+ enddate datesectionmonth/.test(source)) return 'Work end month';
  if (/workexperience \d+ enddate datesectionyear/.test(source)) return 'Work end year';
  if (/workexperience \d+ roledescription/.test(source)) return 'Role description';
  if (/education \d+ school/.test(source)) return 'School or university';
  if (/education \d+ degree/.test(source)) return 'Degree';
  if (/education \d+ fieldofstudy/.test(source)) return 'Field of study';
  if (/education \d+ gradeaverage/.test(source)) return 'Overall result (GPA)';
  if (/education \d+ firstyearattended/.test(source)) return 'Education start year';
  if (/education \d+ lastyearattended/.test(source)) return 'Education end year';
  if (/skills skills/.test(source)) return 'Skills';
  if (/file upload input ref/.test(source) && /resume|cv/.test(groupHeading)) return 'Resume/CV';

  if (/jobpostingapplication workhistory \d+ title/.test(source)) return 'Job title';
  if (/jobpostingapplication workhistory \d+ iscurrent/.test(source)) return 'I currently work here';
  if (/jobpostingapplication workhistory \d+ companyname/.test(source)) return 'Company';
  if (/jobpostingapplication workhistory \d+ effectivestart/.test(source)) return 'Work start date';
  if (/jobpostingapplication workhistory \d+ effectiveend/.test(source)) return 'Work end date';
  if (/jobpostingapplication workhistory \d+ countrycode/.test(source)) return 'Work country';
  if (/jobpostingapplication workhistory \d+ statecode/.test(source)) return 'Work state/province';
  if (/jobpostingapplication workhistory \d+ city/.test(source)) return 'Work city';
  if (/jobpostingapplication workhistory \d+ department/.test(source)) return 'Department';
  if (/jobpostingapplication workhistory \d+ supervisor/.test(source)) return 'Supervisor';
  if (/jobpostingapplication workhistory \d+ reasonforleaving/.test(source)) return 'Reason for leaving';
  if (/jobpostingapplication workhistory \d+ description/.test(source)) return 'Role description';
  if (/jobpostingapplication educationhistory \d+ degreename/.test(source)) return 'Degree';
  if (/jobpostingapplication educationhistory \d+ notcompleted/.test(source)) return 'Education not completed';
  if (/jobpostingapplication educationhistory \d+ majorname/.test(source)) return 'Major or field of study';
  if (/jobpostingapplication educationhistory \d+ minorname/.test(source)) return 'Minor';
  if (/jobpostingapplication educationhistory \d+ effectivestart/.test(source)) return 'Education start date';
  if (/jobpostingapplication educationhistory \d+ effectiveend/.test(source)) return 'Education end date';
  if (/jobpostingapplication educationhistory \d+ schoolname/.test(source)) return 'School or university';
  if (/jobpostingapplication educationhistory \d+ countrycode/.test(source)) return 'Education country';
  if (/jobpostingapplication educationhistory \d+ statecode/.test(source)) return 'Education state/province';
  if (/jobpostingapplication educationhistory \d+ city/.test(source)) return 'Education city';
  if (/jobpostingapplication educationhistory \d+ gpa/.test(source)) return 'GPA';
  if (/jobpostingapplication files resume/.test(source)) return 'Resume/CV';
  if (/jobpostingapplication files coverletter/.test(source)) return 'Cover letter';
  if (/jobpostingapplication candidateinfo confirmemail/.test(source)) return 'Confirm email';
  if (/jobpostingapplication candidateinfo email/.test(source)) return 'Email';
  if (/jobpostingapplication candidateinfo preferredcontactmethod/.test(source)) return 'Preferred contact method';
  if (/jobpostingapplication candidateinfo candidatesource/.test(source)) return 'How did you hear about us?';

  if (
    /race\s*ethnicity|ethnicity\s*race/.test(source)
    || (detectAts() === 'SmartRecruiters' && /\bethnicity\b/.test(source))
  ) return 'Race';
  if (/hispanic|latino|ethnicity/.test(source)) return 'Hispanic/Latino';
  if (/eeo.*gender|\bgender\b|\bsex\b/.test(source)) return 'Gender';
  if (/eeo.*race|\brace\b|racial/.test(source)) return 'Race';
  if (/eeo.*veteran|veteran|military/.test(source)) return 'Veteran status';
  if (/eeo.*disab|disab/.test(source)) return 'Disability status';
  if (/first.*name|given.*name|given-name/.test(source)) return 'First name';
  if (/middle.*name/.test(source)) return 'Middle name';
  if (/last.*name|family.*name|surname|family-name/.test(source)) return 'Last name';
  if (/legal.*name|full.*name|candidate.*name/.test(source)) return 'Full legal name';
  if (/^name$|applicant.*name|candidate.*name/.test(source)) return 'Full name';
  if (/resume|cv/.test(source)) return 'Resume/CV';
  if (/cover.*letter/.test(source)) return 'Cover letter';
  if (/\bemail\b|e-mail/.test(source)) return 'Email';
  if (/preferred.*check|preferred.*name/.test(source)) return 'I have a preferred name';
  if (/phone.*device.*type|phone.*type/.test(source)) return 'Phone device type';
  if (/country.*phone.*code/.test(source)) return 'Country phone code';
  if (/phone.*extension|\bextension\b/.test(source)) return 'Phone extension';
  if (/phone.*number|mobile|telephone|tel/.test(source)) return 'Phone number';
  if (/address.*line.*1/.test(source)) return 'Address line 1';
  if (/postal.*code|zip.*code|\bzip\b/.test(source)) return 'Postal code';
  if (/address.*countryregion/.test(source)) return 'State';
  if (/country.*region/.test(source)) return 'Country';
  if (/state.*province|^state$|^province$/.test(source)) return 'State';
  if (/manual.*location.*city|location.*city|^city$|address.*city/.test(source)) return 'City';
  if (/^org$|current.*company|current.*employer|organization|organisation|employer/.test(source)) return 'Current company';
  if (/opportunity.*location|candidate.*selected.*location|selected.*location|current.*location|^location$|\blocation\b/.test(source)) {
    return /opportunity.*location|candidate.*selected.*location|selected.*location/.test(source)
      ? 'Which location are you applying for?'
      : 'Current location';
  }
  if (/urls?.*linkedin|linkedin/.test(source)) return 'LinkedIn';
  if (/urls?.*github|github/.test(source)) return 'GitHub';
  if (/urls?.*twitter|twitter/.test(source)) return 'Twitter';
  if (/urls?.*other/.test(source)) return 'Other URL';
  if (/urls?.*portfolio|urls?.*website|urls?.*personal|portfolio|website|url/.test(source)) return 'Website';
  if (/comments|additional.*information|anything.*else|cover.*letter/.test(source)) return 'Additional information';
  if (/source|hear.*about|referred|referral/.test(source)) return 'How did you hear about this job?';
  if (/linkedin/.test(source)) return 'LinkedIn';
  if (/github/.test(source)) return 'GitHub';
  if (/portfolio|website|url/.test(source)) return 'Website';

  return '';
}

function optionText(element) {
  const parts = [];
  const explicitLabel = element.getAttribute('label') || element.getAttribute('aria-label');
  const role = element.getAttribute('role');

  if (['radio', 'checkbox'].includes(role)) {
    const labelledByIds = String(element.getAttribute('aria-labelledby') || '').split(/\s+/).filter(Boolean);
    const optionLabelIds = labelledByIds.length > 1 ? labelledByIds.slice(1) : labelledByIds;
    const root = elementRoot(element);
    optionLabelIds.forEach((id) => {
      const node = root?.getElementById?.(id) || elementByIdNear(element, id);
      if (node?.textContent) parts.push(node.textContent);
    });
  }

  if (['radio', 'checkbox'].includes(role)) {
    const roleText = compactText(element.innerText || element.textContent || '', 90);
    if (roleText) parts.push(roleText);
  }

  if (element.labels) {
    Array.from(element.labels).forEach((label) => {
      if (label.textContent) parts.push(label.textContent);
    });
  }

  ['label', 'aria-label', 'value'].forEach((attribute) => {
    const value = element.getAttribute(attribute);
    if (value) parts.push(value);
  });

  if (!explicitLabel) {
    const parentText = compactText(element.parentElement?.innerText || element.parentElement?.textContent || '', 90);
    if (parentText && parentText.length <= 90) parts.push(parentText);
  }

  return uniqueParts(parts.map((part) => (
    String(part).replace(/SVGs not supported by this browser\.?/gi, ' ').trim()
  ))).join(' | ');
}

function radioGroupElements(element) {
  const groupName = element.getAttribute('name');
  const root = elementRoot(element);
  if (groupName) {
    return deepQuerySelectorAll(`input[type="radio"][name="${CSS.escape(groupName)}"]`, root);
  }

  if (element.getAttribute('role') === 'radio') {
    const questionLabelId = String(element.getAttribute('aria-labelledby') || '').split(/\s+/).filter(Boolean)[0];
    if (questionLabelId) {
      const labelledControls = deepQuerySelectorAll('[role="radio"]', root).filter((control) => (
        String(control.getAttribute('aria-labelledby') || '').split(/\s+/).includes(questionLabelId)
      ));
      if (labelledControls.length > 0) return labelledControls;
    }
    const group = element.closest?.('spl-radio-group, [role="radiogroup"]') || parentAcrossShadow(element);
    const controls = Array.from(group?.querySelectorAll?.('[role="radio"], input[type="radio"]') || []);
    if (controls.length > 0) return controls;
  }

  return [element];
}

function radioGroupKey(element) {
  const name = element.getAttribute('name');
  if (name) return `name:${name}`;
  if (element.getAttribute('role') === 'radio') {
    const questionLabelId = String(element.getAttribute('aria-labelledby') || '').split(/\s+/).filter(Boolean)[0];
    if (questionLabelId) return `labelledby:${questionLabelId}`;
  }
  const group = element.closest?.('spl-radio-group, [role="radiogroup"]');
  if (group) return `group:${group.id || compactText(group.innerText || group.textContent || '', 260)}`;
  return `label:${getLabelText(element)}`;
}

function choiceChecked(element) {
  return Boolean(
    element?.checked
    || element?.getAttribute?.('aria-checked') === 'true'
    || element?.querySelector?.('input[type="radio"], input[type="checkbox"]')?.checked,
  );
}

function radioGroupQuestion(element) {
  const group = radioGroupElements(element);
  const choices = uniqueParts(group.flatMap((radio) => [
    optionText(radio),
    radio.getAttribute('value'),
  ]))
    .map((choice) => choice.split('|')[0]?.trim())
    .filter((choice) => choice && choice.length <= 60);

  let parent = element.parentElement;
  for (let depth = 0; parent && depth < 7; depth += 1, parent = parent.parentElement) {
    const raw = compactText(parent.innerText || parent.textContent || '', 520);
    if (!raw || raw.length < 8) continue;

    let candidate = raw;
    for (const choice of choices) {
      candidate = candidate.replace(new RegExp(`\\b${escapeRegExp(choice)}\\b`, 'gi'), ' ');
    }
    candidate = compactText(candidate.replace(/[✱*]+/g, ' '), 380);
    const normalized = normalize(candidate);

    if (
      candidate
      && candidate.length >= 12
      && candidate.length <= 380
      && (
        candidate.includes('?')
        || /authorized|eligible|sponsor|visa|relocat|remote|hybrid|located|veteran|military|gender|race|ethnic|disab|referr|work/.test(normalized)
      )
    ) {
      return candidate;
    }
  }

  return '';
}

function checkboxGroupQuestion(element) {
  const groupName = element.getAttribute('name');
  const root = elementRoot(element);
  const namedGroup = groupName
    ? deepQuerySelectorAll(`input[type="checkbox"][name="${CSS.escape(groupName)}"]`, root)
    : [element];
  const optionChoices = (checkboxes) => uniqueParts(checkboxes.flatMap((checkbox) => [
    ...optionText(checkbox).split('|'),
    checkbox.getAttribute('value'),
  ]))
    .map((choice) => choice?.trim())
    .filter((choice) => choice && choice.length <= 90)
    .sort((left, right) => right.length - left.length);

  let parent = parentAcrossShadow(element);
  for (let depth = 0; parent && depth < 8; depth += 1, parent = parentAcrossShadow(parent)) {
    const raw = compactText(parent.innerText || parent.textContent || '', 2400);
    if (!raw || raw.length < 8) continue;

    const explicitQuestion = raw.match(/(.{8,280}?\?(?:\s+(?:Please\s+)?select all that apply\.?)?)/i)?.[1];
    if (explicitQuestion) {
      const question = compactText(explicitQuestion.replace(/[\u2731*]+/g, ' '), 380);
      const normalizedQuestion = normalize(question);
      if (/pronouns|ethnicity|race|gender|sexual|orientation|education|age|communities|consent|contact me|location|relocat|committed|where.*work/.test(normalizedQuestion)) {
        return question;
      }
    }

    // Ashby gives each option in a multi-select question a unique name. Use all
    // sibling options at the shared container so every option gets one label.
    const siblingGroup = Array.from(
      parent.querySelectorAll?.('input[type="checkbox"], [role="checkbox"]') || [],
    );
    const choices = optionChoices(Array.from(new Set([...namedGroup, ...siblingGroup])));
    let candidate = raw;
    for (const choice of choices) {
      candidate = candidate.replace(new RegExp(`\\b${escapeRegExp(choice)}\\b`, 'gi'), ' ');
    }
    candidate = compactText(candidate.replace(/[\u2731*]+/g, ' '), 380);
    const normalized = normalize(candidate);

    if (
      candidate
      && candidate.length >= 8
      && candidate.length <= 380
      && (
        candidate.includes('?')
        || /pronouns|ethnicity|race|gender|sexual|orientation|education|age|consent|contact me|location|relocat|committed|where.*work/.test(normalized)
      )
    ) {
      return candidate;
    }
  }

  return '';
}

function workdayQuestionText(element) {
  if (state.ats !== 'Workday' || element?.tagName !== 'BUTTON') return '';
  if (!/^primaryQuestionnaire--/i.test(String(element.id || ''))) return '';

  let container = element.parentElement;
  for (let depth = 0; container && depth < 7; depth += 1, container = container.parentElement) {
    if (String(container.tagName || '').toUpperCase() !== 'FIELDSET') continue;
    const question = compactText(container.innerText || container.textContent || '', 1800)
      .replace(/\s*Select One\s*$/i, '')
      .trim();
    const numberedQuestion = question.match(/(?:^|\s)(\d+\)\s+.+)$/);
    return numberedQuestion?.[1] || question;
  }
  return '';
}

function smartRecruitersQuestionText(element) {
  if (state.ats !== 'SmartRecruiters') return '';

  for (const node of crossShadowNodes(element, 24)) {
    const tag = String(node.tagName || '').toUpperCase();
    const text = compactText(node.innerText || node.textContent || '', 1200);
    if (!text || text.length > 1100) continue;
    if (
      ['SPL-AUTOCOMPLETE', 'SPL-INPUT', 'SPL-CHECKBOX', 'SPL-RADIO-GROUP'].includes(tag)
      && (text.includes('?') || /signature field|today'?s date|read and understand.*privacy notice/i.test(text))
    ) {
      return questionLeadText(text);
    }
  }

  return '';
}

function oracleJetQuestionText(element) {
  if (state.ats !== 'Oracle Recruiting Cloud') return '';

  for (const node of crossShadowNodes(element, 14)) {
    const explicit = uniqueParts([
      node.getAttribute?.('label-hint'),
      node.getAttribute?.('label'),
      node.getAttribute?.('aria-label'),
      node.getAttribute?.('title'),
    ]).filter(usefulDirectLabelPart);
    if (explicit.length > 0) return explicit.join(' | ');

    const labelledBy = String(node.getAttribute?.('labelled-by') || node.getAttribute?.('aria-labelledby') || '')
      .split(/\s+/)
      .filter(Boolean);
    const labelledText = uniqueParts(labelledBy.map((id) => elementByIdNear(node, id)?.textContent))
      .filter(usefulDirectLabelPart);
    if (labelledText.length > 0) return labelledText.join(' | ');
  }

  return '';
}

function legacyAtsQuestionText(element) {
  if (!['SuccessFactors', 'Taleo', 'UKG Pro Recruiting'].includes(state.ats)) return '';

  let container = parentAcrossShadow(element);
  for (let depth = 0; container && depth < 8; depth += 1, container = parentAcrossShadow(container)) {
    const tag = String(container.tagName || '').toUpperCase();
    const isQuestionContainer = ['FIELDSET', 'TR', 'LI'].includes(tag)
      || /(?:^|\s)(?:field|form-group|question|application-question)(?:\s|$)/i.test(String(container.className || ''));
    if (!isQuestionContainer) continue;

    const explicit = container.querySelector?.('legend, label, .field-label, .formLabel, .question, [class*="label"], [class*="Label"]');
    const explicitText = compactText(explicit?.innerText || explicit?.textContent || '', 420);
    if (explicitText && usefulDirectLabelPart(explicitText)) return questionLeadText(explicitText);

    const containerText = compactText(container.innerText || container.textContent || '', 520);
    if (containerText && containerText.length <= 420) return questionLeadText(containerText);
  }

  return '';
}

function ashbyQuestionText(element) {
  if (state.ats !== 'Ashby') return '';

  const fieldEntry = closestAcrossShadow(element, '.ashby-application-form-field-entry');
  if (!fieldEntry) return '';

  const explicit = fieldEntry.querySelector?.('label, legend, [data-testid*="label"], [class*="label"], [class*="Label"]');
  const explicitText = compactText(explicit?.innerText || explicit?.textContent || '', 420);
  if (explicitText && usefulDirectLabelPart(explicitText)) return questionLeadText(explicitText);

  const fieldText = compactText(fieldEntry.innerText || fieldEntry.textContent || '', 520);
  return fieldText && fieldText.length <= 420 ? questionLeadText(fieldText) : '';
}

function getLabelText(element) {
  const labelParts = [];
  const type = fieldType(element).toLowerCase();
  const isLeverCustomCardField = /cards\[/.test(String(element.getAttribute('name') || ''));
  const root = elementRoot(element);

  if (element.id) {
    const label = root?.querySelector?.(`label[for="${CSS.escape(element.id)}"]`)
      || deepQuerySelector(`label[for="${CSS.escape(element.id)}"]`);
    if (label?.textContent) labelParts.push(label.textContent);
  }

  if (element.labels) {
    Array.from(element.labels).forEach((label) => {
      if (label.textContent) labelParts.push(label.textContent);
    });
  }

  const labelledBy = element.getAttribute('aria-labelledby');
  if (labelledBy) {
    labelledBy.split(/\s+/).forEach((id) => {
      const node = root?.getElementById?.(id) || elementByIdNear(element, id);
      if (node?.textContent && !/placeholder|error|description/i.test(id)) {
        labelParts.push(node.textContent);
      }
    });
  }

  ['aria-label', 'placeholder', 'label-hint', 'label', 'title'].forEach((attribute) => {
    const value = element.getAttribute(attribute);
    if (value) labelParts.push(value);
  });

  let directParts = uniqueParts(labelParts).filter(usefulDirectLabelPart);
  const attributeParts = [];
  ['name', 'id', 'data-qa', 'data-testid', 'test-id', 'data-automation-id', 'data-uxi-widget-type', 'autocomplete', 'label-hint'].forEach((attribute) => {
    const value = element.getAttribute(attribute);
    if (value) attributeParts.push(value);
  });

  if (elementRoot(element)?.host instanceof HTMLElement) {
    crossShadowNodes(element, 8).slice(1).forEach((node) => {
      ['label', 'label-hint', 'aria-label', 'title'].forEach((attribute) => {
        const value = node.getAttribute?.(attribute);
        if (value) labelParts.push(value);
      });
      const text = compactText(node.innerText || node.textContent || '', 300);
      if (text && text.length <= 260) labelParts.push(text);
    });
  }
  const inferred = inferredFieldLabel(element);
  const workdayQuestion = workdayQuestionText(element);
  const smartRecruitersQuestion = smartRecruitersQuestionText(element);
  const oracleJetQuestion = oracleJetQuestionText(element);
  const legacyAtsQuestion = legacyAtsQuestionText(element);
  const ashbyQuestion = ashbyQuestionText(element);

  if (workdayQuestion) {
    return uniqueParts([workdayQuestion, ...attributeParts]).join(' | ');
  }

  if (smartRecruitersQuestion) {
    return uniqueParts([smartRecruitersQuestion, inferred]).join(' | ');
  }

  if (oracleJetQuestion) {
    return uniqueParts([oracleJetQuestion, inferred, ...directParts, ...attributeParts]).join(' | ');
  }

  if (legacyAtsQuestion && (directParts.length === 0 || ['radio', 'checkbox'].includes(type))) {
    return uniqueParts([legacyAtsQuestion, inferred, ...directParts, ...attributeParts]).join(' | ');
  }

  if (ashbyQuestion && !['radio', 'checkbox'].includes(type)) {
    return uniqueParts([ashbyQuestion, inferred, ...directParts, ...attributeParts]).join(' | ');
  }

  if (type === 'radio') {
    const customRole = element.getAttribute('role') === 'radio';
    return uniqueParts([
      radioGroupQuestion(element),
      inferred,
      ...(customRole ? directParts : attributeParts),
    ]).join(' | ');
  }

  if (type === 'checkbox') {
    if (/preferred name/.test(normalize(inferred))) {
      return uniqueParts([inferred, ...directParts, optionText(element), ...attributeParts]).join(' | ');
    }
    return uniqueParts([checkboxGroupQuestion(element), ...directParts, optionText(element), inferred, ...attributeParts]).join(' | ');
  }

  if (isLeverCustomCardField) {
    const questionContainer = element.closest('.application-question, li');
    const questionText = questionLeadText(questionContainer?.innerText || questionContainer?.textContent || '');
    if (questionText && !/^select|^type your response$/i.test(questionText)) {
      labelParts.push(questionText);
      directParts = uniqueParts(labelParts).filter(usefulDirectLabelPart);
    }
  }

  if (directParts.length > 0) {
    return uniqueParts([inferred, ...directParts, ...attributeParts]).join(' | ');
  }

  let parent = parentAcrossShadow(element);
  for (let depth = 0; parent && depth < 7; depth += 1, parent = parentAcrossShadow(parent)) {
    const text = compactText(parent.innerText || parent.textContent || '');
    if (text && text.length < 360 && (text.includes('?') || /\*$|select/i.test(text) || depth === 0 || isLeverCustomCardField)) {
      labelParts.push(text);
      break;
    }
  }

  return uniqueParts([inferred, ...labelParts.filter(usefulDirectLabelPart), ...attributeParts]).join(' | ');
}

function ensureFieldId(element) {
  const existing = element.getAttribute(ROLEMATCH_FIELD_ID);
  if (existing) return existing;
  const next = `rm-field-${Date.now()}-${fieldCounter++}`;
  element.setAttribute(ROLEMATCH_FIELD_ID, next);
  return next;
}

function fieldType(element) {
  const tag = element.tagName.toLowerCase();
  const role = element.getAttribute('role');
  const inputType = tag === 'input' ? (element.getAttribute('type') || 'text').toLowerCase() : '';
  if (['file', 'password', 'radio', 'checkbox'].includes(inputType)) return inputType;
  if (tag === 'select') return 'select';
  if (tag === 'textarea') return 'textarea';
  if (role === 'radio' || role === 'checkbox') return role;
  if (isPhoneCountrySearch(element)) return 'internal-search';
  if (closestAcrossShadow(element, 'oj-select-single, oj-select-many, oj-combobox-one, oj-combobox-many, oj-input-search')) return 'combobox';
  if (tag === 'button' && /listbox|menu/i.test(element.getAttribute('aria-haspopup') || '')) return 'combobox';
  if (closestAcrossShadow(element, 'spl-autocomplete, spl-select')) return 'combobox';
  if (isWorkdayPromptSearchCombobox(element)) return 'combobox';
  if (element.getAttribute('role') === 'combobox' || element.getAttribute('aria-autocomplete') === 'list') return 'combobox';
  if (isLocationAutocomplete(element)) return 'combobox';
  return element.getAttribute('type') || 'text';
}

function fieldHasIdentity(element) {
  if (element.id || element.getAttribute('name')) return true;
  if (element.labels?.length) return true;
  if (['aria-label', 'aria-labelledby', 'placeholder', 'data-qa', 'data-testid', 'test-id', 'data-automation-id', 'data-uxi-widget-type', 'autocomplete', 'label', 'label-hint', 'labelled-by', 'title']
    .some((attribute) => Boolean(element.getAttribute(attribute)))) return true;
  return crossShadowNodes(element, 6).slice(1).some((node) => (
    ['label', 'label-hint', 'labelled-by', 'aria-label', 'title', 'data-test', 'data-testid', 'formcontrolname']
      .some((attribute) => Boolean(node.getAttribute?.(attribute)))
  ));
}

function fileInputAvailable(element) {
  if (!(element instanceof HTMLElement)) return false;
  if (element.disabled) return false;
  if ((element.getAttribute('type') || '').toLowerCase() !== 'file') return false;

  const identity = `${crossShadowIdentity(element, 8)} ${normalize(getLabelText(element))}`;

  return /resume|cv|cover letter|attach/.test(identity)
    && !/avatar|profile photo|profile picture/.test(identity);
}

function choiceInputAvailable(element) {
  if (!(element instanceof HTMLElement)) return false;
  if (element.disabled) return false;
  const type = (element.getAttribute('type') || '').toLowerCase();
  if (!['radio', 'checkbox'].includes(type)) return false;

  const question = closestAcrossShadow(element, '.application-question');
  const root = elementRoot(element);
  const label = element.id
    ? root?.querySelector?.(`label[for="${CSS.escape(element.id)}"]`) || deepQuerySelector(`label[for="${CSS.escape(element.id)}"]`)
    : null;
  const visibleContainer = [label, closestAcrossShadow(element, 'label'), question, parentAcrossShadow(element)]
    .find((node) => node instanceof HTMLElement && visible(node));
  const identity = normalize([
    optionText(element),
    question?.innerText,
    question?.textContent,
    element.getAttribute('name'),
    element.id,
  ].filter(Boolean).join(' '));

  return Boolean(visibleContainer && identity.length >= 3);
}

function isLocationAutocomplete(element) {
  const identity = crossShadowIdentity(element, 7);

  return /location-input|current location.*no location found|no location found.*loading|^location$|\blocation\b.*current location|current location.*\blocation\b|\bcity\b.*autocomplete|autocomplete.*\bcity\b/.test(identity);
}

function isPhoneCountrySearch(element) {
  const identity = normalize([
    element.id,
    element.getAttribute('name'),
    element.className,
    element.getAttribute('aria-label'),
    element.getAttribute('aria-controls'),
    element.getAttribute('placeholder'),
    element.getAttribute('data-automation-id'),
  ].filter(Boolean).join(' '));

  return /country phone code|countryphonecode|\bcountry code\b|country calling code|calling code|search by country.*code|country.*code.*search/.test(identity)
    || (/iti.*search|country listbox|^search$/.test(identity) && /iti|country/.test(identity));
}

function isWorkdaySearchCombobox(element) {
  const identity = normalize([
    element.id,
    element.getAttribute('name'),
    element.getAttribute('data-automation-id'),
    element.getAttribute('placeholder'),
  ].filter(Boolean).join(' ').replace(/[\][_.:-]+/g, ' '));

  return /source source/.test(identity) && /search/.test(identity);
}

function isWorkdayPromptSearchCombobox(element) {
  const identity = normalize([
    element.id,
    element.getAttribute('name'),
    element.getAttribute('data-automation-id'),
    element.getAttribute('placeholder'),
  ].filter(Boolean).join(' ').replace(/[\][_.:-]+/g, ' '));

  return isWorkdaySearchCombobox(element)
    || (/search/.test(identity) && /education \d+ (school|fieldofstudy)|skills skills/.test(identity));
}

function isWorkdaySkillsSearch(element) {
  return /skills skills/.test(normalize(String(element.id || '').replace(/[\][_.:-]+/g, ' ')));
}

function isWorkdaySchoolSearch(element) {
  return /education \d+ school/.test(normalize(String(element.id || '').replace(/[\][_.:-]+/g, ' ')));
}

function isWorkdayFieldOfStudySearch(element) {
  return /education \d+ fieldofstudy/.test(normalize(String(element.id || '').replace(/[\][_.:-]+/g, ' ')));
}

function comboboxControl(element) {
  return closestAcrossShadow(element, 'oj-select-single, oj-select-many, oj-combobox-one, oj-combobox-many, oj-input-search')
    || element.closest('.ant-select, .select__control, [class*="select"][class*="control"], [class*="Select"][class*="Control"], [class*="control"], [class*="Control"]')
    || element.parentElement;
}

function selectedComboboxText(element) {
  const smartRecruitersInput = closestAcrossShadow(element, 'spl-input');
  const smartRecruitersValue = compactText(smartRecruitersInput?.getAttribute?.('value') || '', 180);
  if (smartRecruitersValue) return smartRecruitersValue;

  const control = comboboxControl(element);
  const selected = control?.querySelector('.ant-select-selection-item, .select__single-value, [class*="singleValue"], [class*="SingleValue"]');
  const text = compactText(selected?.textContent || '', 180);
  const fallback = compactText(control?.textContent || '', 180)
    .replace(/no location found.*$/i, '')
    .replace(/loading.*$/i, '')
    .replace(/^0 items? selected.*$/i, '')
    .replace(/^\d+ items? selected,?\s*/i, '')
    .trim();
  const selectedText = text || fallback;
  if (!selectedText || /^select(\.\.\.)?$|^expanded$|^collapsed$|no options|no location found|loading/i.test(selectedText)) return '';
  if (/results found|no results found/i.test(selectedText)) return '';
  return selectedText;
}

function isReactSelectInput(element) {
  const root = elementRoot(element);
  return Boolean(
    String(element.className || '').includes('select__input')
    || String(element.getAttribute('aria-describedby') || '').includes('react-select-')
    || (element.id && (root?.getElementById?.(`react-select-${element.id}-listbox`) || elementByIdNear(element, `react-select-${element.id}-listbox`)))
    || (element.id && element.getAttribute('aria-activedescendant')?.startsWith(`react-select-${element.id}-option-`))
  );
}

function fieldValue(element) {
  if (fieldType(element).toLowerCase() === 'combobox') {
    if (element.tagName === 'BUTTON') {
      return compactText(element.innerText || element.textContent || element.getAttribute('aria-label') || '', 180);
    }
    const dataValue = element.parentElement?.getAttribute('data-value')?.trim();
    const selectedText = selectedComboboxText(element);
    if (closestAcrossShadow(element, 'spl-autocomplete, spl-select')) return selectedText || '';
    if (isReactSelectInput(element) && isLocationAutocomplete(element)) return selectedText || element.value || '';
    if (isReactSelectInput(element)) return selectedText || '';
    if (isWorkdayPromptSearchCombobox(element)) return selectedText || dataValue || '';
    return selectedText || dataValue || element.value || '';
  }

  if (element.isContentEditable) return element.textContent ?? '';
  return element.value ?? '';
}

function collectFields() {
  if (!isSupportedApplicationSurface()) return [];

  const selector = [
    'input:not([type="hidden"])',
    'textarea',
    'select',
    'button[aria-haspopup="listbox"]',
    'button[aria-haspopup="menu"]',
    '[contenteditable="true"]',
    '[role="textbox"]',
    '[role="combobox"]',
    '[role="radio"]',
    '[role="checkbox"]',
  ].join(',');

  const seenRadioGroups = new Set();
  const seenRecruiteeLocationGroups = new Set();

  return deepQuerySelectorAll(selector)
    .filter((element) => !closestAcrossShadow(element, `#${ROLEMATCH_PANEL_ID}`))
    .filter((element) => !isAutofillTrap(element) && !isNonApplicationMenu(element))
    .filter((element) => visible(element) || fileInputAvailable(element) || choiceInputAvailable(element))
    .filter((element) => {
      const type = fieldType(element).toLowerCase();
      if (['submit', 'button', 'reset', 'image'].includes(type)) return false;
      if (type === 'internal-search') return false;
      if (
        element.tagName === 'INPUT'
        && ['radio', 'checkbox'].includes(type)
        && closestAcrossShadow(element, `[role="${type}"]`)
      ) {
        return false;
      }
      if (
        type === 'combobox'
        && !element.id
        && !element.getAttribute('aria-labelledby')
        && !element.getAttribute('aria-label')
        && !fieldHasIdentity(element)
      ) {
        return false;
      }
      if (element.tagName === 'INPUT' && type === 'text' && !fieldHasIdentity(element)) {
        return false;
      }
      if (type === 'radio') {
        const groupKey = radioGroupKey(element);
        if (seenRadioGroups.has(groupKey)) return false;
        seenRadioGroups.add(groupKey);
      }
      if (type === 'checkbox' && state.ats === 'Recruitee') {
        const label = normalize(getLabelText(element));
        if (/preferred work location/.test(label)) {
          const groupKey = 'preferred-work-location';
          if (seenRecruiteeLocationGroups.has(groupKey)) return false;
          seenRecruiteeLocationGroups.add(groupKey);
        }
      }
      return true;
    })
    .map((element) => ({
      id: ensureFieldId(element),
      element,
      type: fieldType(element).toLowerCase(),
      label: getLabelText(element),
      required: Boolean(element.required || element.getAttribute('aria-required') === 'true'),
      value: fieldValue(element),
      options: element.tagName === 'SELECT'
        ? Array.from(element.options).map((option) => ({ value: option.value, text: option.textContent?.trim() || '' }))
        : [],
    }));
}

function refreshFieldReference(field) {
  const domId = String(field.element?.id || '');
  const root = elementRoot(field.element);
  const element = (field.element?.isConnected !== false ? field.element : null)
    || (domId ? root?.getElementById?.(domId) || root?.querySelector?.(`#${CSS.escape(domId)}`) : null)
    || field.element;
  if (!element) return field;

  return {
    ...field,
    element,
    type: fieldType(element).toLowerCase(),
    label: getLabelText(element),
    required: Boolean(element.required || element.getAttribute('aria-required') === 'true'),
    value: fieldValue(element),
    options: element.tagName === 'SELECT'
      ? Array.from(element.options).map((option) => ({ value: option.value, text: option.textContent?.trim() || '' }))
      : [],
  };
}

const CUSTOM_ANSWER_INTENT_LIBRARY = Object.freeze({
  primary_application_email: [
    'What email address should we use for your application?',
    'Please enter your preferred application email.',
    'What is your primary contact email?',
  ],
  requires_sponsorship: [
    'Will you now or in the future require employment visa sponsorship?',
    'Do you require visa sponsorship?',
    'Will the company need to sponsor your work authorization?',
    'Do you need sponsorship now or in the future?',
  ],
  authorized_to_work: [
    'Are you legally authorized to work in this country?',
    'Are you authorized to work in the United States?',
    'Do you have permanent work authorization?',
    'Can you legally work in the location of this role?',
  ],
  preferred_pronouns: [
    'What are your preferred pronouns?',
    'Please select your pronouns.',
    'How should we refer to you?',
  ],
  current_company: [
    'What is your current company?',
    'Who is your current employer?',
    'Please enter your present employer.',
  ],
  prior_company_employment: [
    'Have you worked for this company before?',
    'Were you previously employed by us?',
    'Are you a former employee of this company?',
    'Have you ever been employed by this organization?',
  ],
  relative_at_company: [
    'Do you have a relative who works for this company?',
    'Is a family member employed by us?',
    'Do any immediate family members work here?',
  ],
  employee_referral: [
    'Were you referred by a current employee?',
    'Did an employee refer you for this role?',
    'Do you know anyone who works at this company?',
  ],
  active_security_clearance: [
    'Do you currently hold an active security clearance?',
    'What level of security clearance do you hold?',
    'Do you have a current government security clearance?',
  ],
  willing_to_obtain_clearance: [
    'Are you willing to obtain a security clearance?',
    'Can you obtain public trust or a security clearance?',
    'Are you eligible and willing to pursue the required clearance?',
  ],
  employment_restriction: [
    'Are you subject to a non-compete agreement?',
    'Have you entered into a non-disclosure or non-solicitation agreement?',
    'Are you bound by any employment restriction?',
    'Do you have a restrictive covenant with a current or former employer?',
  ],
  professional_certifications: [
    'Do you hold any professional certifications?',
    'Please list your licenses and certifications.',
    'What certifications do you currently have?',
  ],
  age_18_or_older: [
    'Are you at least 18 years of age?',
    'Are you 18 years old or older?',
    'Do you meet the minimum working age requirement?',
  ],
  linkedin_identity_verified: [
    'Have you verified your identity on LinkedIn?',
    'Is your LinkedIn identity verified?',
    'Did you complete LinkedIn identity verification?',
  ],
  primary_engineering_expertise: [
    'What is your primary engineering expertise?',
    'Which engineering area is your strongest?',
    'What is your main technical discipline?',
  ],
  programming_languages: [
    'Which programming languages are you proficient in?',
    'What programming languages do you use?',
    'Please list your primary programming languages.',
  ],
  full_time_software_experience: [
    'Do you have full-time professional software engineering experience?',
    'How many years of full-time software engineering experience do you have?',
    'Have you worked full time as a software engineer?',
  ],
  production_systems_experience: [
    'How many years have you supported production systems?',
    'How much production software experience do you have?',
    'How many years have you worked on production applications?',
  ],
  production_sql_experience: [
    'How many years of production SQL experience do you have?',
    'How much experience do you have using SQL in production?',
    'How long have you worked with production databases and SQL?',
  ],
  cloud_production_experience: [
    'How many years have you supported cloud production workloads?',
    'How much production cloud experience do you have?',
    'How long have you worked with cloud infrastructure in production?',
  ],
  user_facing_web_apps: [
    'Have you built user-facing web applications?',
    'Do you have experience developing customer-facing web products?',
    'Have you shipped web application features used by customers?',
  ],
  external_customer_support: [
    'Do you have experience providing technical support to external customers?',
    'Have you supported customers with technical product issues?',
    'Do you have customer-facing technical support experience?',
  ],
  enterprise_saas_support: [
    'Have you supported an enterprise SaaS product?',
    'Do you have in-application support experience for SaaS customers?',
    'Have you provided technical support for enterprise software?',
  ],
  bug_reproduction_reporting: [
    'Do you have experience reproducing and reporting software bugs?',
    'Have you documented reproducible defects for engineering teams?',
    'Can you reproduce customer issues and create technical bug reports?',
  ],
  workforce_management_experience: [
    'Do you have workforce management software experience?',
    'Have you worked with workforce management platforms?',
    'Do you have experience supporting workforce management products?',
  ],
  government_employee: [
    'Are you currently an employee of the United States government?',
    'Do you work for a federal, state, or local government agency?',
    'Are you a current government employee?',
  ],
  government_service: [
    'Will you be serving in a government position while employed here?',
    'Do you currently hold a public office or government appointment?',
    'Will you maintain government service during this employment?',
  ],
  export_control_status: [
    'What is your United States export control status?',
    'Are you a U.S. person for export control purposes?',
    'Do you meet the export authorization requirements for this role?',
  ],
  apac_hours_availability: [
    'Are you available to work APAC business hours?',
    'Can you support customers during Asia Pacific hours?',
    'Are you willing to work an APAC-aligned schedule?',
  ],
  prior_apprenticeship: [
    'Have you participated in our apprenticeship program?',
    'Were you previously enrolled in this company apprenticeship?',
    'Are you a former apprenticeship program participant?',
  ],
  application_source: [
    'How did you hear about this job?',
    'Where did you find this position?',
    'What is the source of your application?',
  ],
  sms_opt_in: [
    'Would you like to receive recruiting text messages?',
    'Do you consent to SMS updates about your application?',
    'May we contact you by text message?',
  ],
  travel_percentage: [
    'What percentage of travel are you willing to accept?',
    'How much travel are you comfortable with?',
    'Are you willing to travel for this role?',
  ],
  willing_to_relocate: [
    'Are you willing to relocate?',
    'Would you relocate for this position?',
    'Are you open to relocation for the role?',
  ],
  overtime_availability: [
    'Are you willing to work overtime?',
    'Can you work more than 40 hours when needed?',
    'Are you available for additional hours as required?',
  ],
  spoken_languages: [
    'What languages do you speak?',
    'Please list each language and your proficiency.',
    'Do you speak any languages other than English?',
  ],
  desired_annual_compensation: [
    'What is your desired annual salary?',
    'What base salary are you seeking?',
    'What are your yearly compensation expectations?',
  ],
  desired_hourly_compensation: [
    'What is your desired hourly rate?',
    'What hourly pay are you seeking?',
    'What are your hourly compensation expectations?',
  ],
});

const CUSTOM_ANSWER_QUESTION_STOP_WORDS = new Set([
  'a', 'an', 'and', 'are', 'as', 'at', 'be', 'been', 'before', 'can', 'could',
  'did', 'do', 'does', 'for', 'from', 'have', 'has', 'if', 'in', 'is', 'it',
  'of', 'on', 'or', 'our', 'please', 'the', 'this', 'to', 'us', 'what', 'when',
  'where', 'which', 'who', 'will', 'with', 'would', 'you', 'your',
]);

const WEAK_CUSTOM_ANSWER_KEYWORDS = new Set([
  'answer', 'application', 'company', 'date', 'experience', 'field', 'job',
  'language', 'languages', 'location', 'name', 'question', 'salary', 'work', 'years',
]);

function customAnswerIntent(value) {
  return String(value ?? '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9 _-]+/g, '')
    .replace(/[\s-]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

function customAnswerQuestionTerms(value) {
  return normalize(value)
    .split(' ')
    .map((term) => term.replace(/^[^a-z0-9+#]+|[^a-z0-9+#]+$/g, ''))
    .filter((term) => term.length > 1 && !CUSTOM_ANSWER_QUESTION_STOP_WORDS.has(term));
}

function customAnswerPhraseScore(question, phrase, penalty = 0) {
  const normalizedQuestion = normalize(question);
  const normalizedPhrase = normalize(phrase);
  if (!normalizedQuestion || normalizedPhrase.length < 4) return 0;
  const phraseTerms = customAnswerQuestionTerms(normalizedPhrase);
  const specificity = Math.min(phraseTerms.length, 10);

  if (normalizedQuestion === normalizedPhrase) return 120 + specificity - penalty;
  if (normalizedPhrase.length >= 8 && normalizedQuestion.includes(normalizedPhrase)) {
    return 104 + specificity - penalty;
  }
  if (normalizedQuestion.length >= 8 && normalizedPhrase.includes(normalizedQuestion)) {
    return 98 + specificity - penalty;
  }

  if (phraseTerms.length < 2) return 0;
  const questionTerms = new Set(customAnswerQuestionTerms(normalizedQuestion));
  const matches = phraseTerms.filter((term) => questionTerms.has(term)).length;
  const coverage = matches / phraseTerms.length;
  const precision = matches / Math.max(questionTerms.size, 1);
  if (matches < 2 || coverage < 0.8 || (precision < 0.3 && matches < 4)) return 0;

  return 72 + Math.round(coverage * 12) + Math.min(matches, 8) - penalty;
}

function inferredCustomAnswerIntent(answer) {
  const explicitIntent = customAnswerIntent(answer?.intent);
  if (explicitIntent && CUSTOM_ANSWER_INTENT_LIBRARY[explicitIntent]) return explicitIntent;

  const ownPhrases = [answer?.label, ...(Array.isArray(answer?.aliases) ? answer.aliases : [])]
    .map(normalize)
    .filter((phrase) => phrase.length >= 8);
  let best = { intent: '', score: 0 };
  let runnerUp = { intent: '', score: 0 };

  Object.entries(CUSTOM_ANSWER_INTENT_LIBRARY).forEach(([intent, aliases]) => {
    let intentScore = 0;
    ownPhrases.forEach((ownPhrase) => {
      aliases.forEach((alias) => {
        const normalizedAlias = normalize(alias);
        const score = ownPhrase === normalizedAlias
          ? 120
          : ownPhrase.includes(normalizedAlias) || normalizedAlias.includes(ownPhrase)
            ? 100
            : 0;
        intentScore = Math.max(intentScore, score);
      });
    });
    if (intentScore > best.score) {
      runnerUp = best;
      best = { intent, score: intentScore };
    } else if (intentScore > runnerUp.score) {
      runnerUp = { intent, score: intentScore };
    }
  });

  return best.score >= 100 && best.score > runnerUp.score ? best.intent : '';
}

function legacyCustomAnswerKeywordScore(question, keywords) {
  const keywordTerms = normalize(keywords).split(' ').filter((term) => term.length > 2);
  if (
    keywordTerms.length === 1
    && (keywordTerms[0].length < 8 || WEAK_CUSTOM_ANSWER_KEYWORDS.has(keywordTerms[0]))
  ) {
    return 0;
  }

  const normalizedQuestion = normalize(question);
  const requiredMatches = keywordTerms.length <= 3 ? keywordTerms.length : Math.ceil(keywordTerms.length * 0.75);
  const matches = keywordTerms.filter((term) => normalizedQuestion.includes(term)).length;
  return keywordTerms.length > 0 && matches >= requiredMatches
    ? 60 + Math.round((matches / keywordTerms.length) * 10)
    : 0;
}

function customAnswerValue(entry, field, question) {
  const defaultAnswer = String(entry?.answer ?? '').trim();
  const shortAnswer = String(entry?.shortAnswer ?? '').trim();
  const longAnswer = String(entry?.longAnswer ?? '').trim();
  const type = normalize(field?.type);
  const normalizedQuestion = normalize(field?.label || question);
  const choiceField = ['checkbox', 'combobox', 'radio', 'select'].includes(type)
    || (Array.isArray(field?.options) && field.options.length > 0);
  const longFormField = type === 'textarea'
    || /\bdescribe\b|\bexplain\b|\btell us\b|\bgive an example\b|\bprovide details\b|\badditional information\b|\bcover letter\b|\bessay\b|\bhow (?:have|do|did|would) you\b/.test(normalizedQuestion);

  if (choiceField) return shortAnswer || defaultAnswer || longAnswer;
  if (longFormField) return longAnswer || defaultAnswer || shortAnswer;
  return defaultAnswer || shortAnswer || longAnswer;
}

function customAnswer(profile, label, field = null) {
  const normalizedLabel = normalize(label);
  const answers = profile?.autofillAnswers?.custom ?? [];
  if (!normalizedLabel || !Array.isArray(answers)) return '';

  const candidates = answers
    .map((answer, index) => {
      const answerText = customAnswerValue(answer, field, normalizedLabel);
      if (!answerText) return null;
      const aliases = Array.isArray(answer?.aliases) ? answer.aliases : [];
      const directPhrases = [answer?.label, ...aliases].filter(Boolean);
      let score = directPhrases.reduce(
        (best, phrase) => Math.max(best, customAnswerPhraseScore(normalizedLabel, phrase)),
        0,
      );
      const intent = inferredCustomAnswerIntent(answer);
      if (intent) {
        const intentPenalty = customAnswerIntent(answer?.intent) === intent ? 0 : 6;
        score = CUSTOM_ANSWER_INTENT_LIBRARY[intent].reduce(
          (best, phrase) => Math.max(best, customAnswerPhraseScore(normalizedLabel, phrase, intentPenalty)),
          score,
        );
      }
      score = Math.max(score, legacyCustomAnswerKeywordScore(normalizedLabel, answer?.keywords));

      return score > 0 ? { answer: answerText, index, score } : null;
    })
    .filter(Boolean)
    .sort((left, right) => right.score - left.score || left.index - right.index);

  const best = candidates[0];
  if (!best) return '';
  const conflictingRunnerUp = candidates.find((candidate) => normalize(candidate.answer) !== normalize(best.answer));
  if (conflictingRunnerUp && best.score - conflictingRunnerUp.score <= 4) return '';

  return best.answer;
}

function exactCustomAnswer(profile, label, field = null) {
  const normalizedLabels = new Set([
    normalize(label),
    normalize(displayFieldLabel(label)),
  ].filter(Boolean));
  const answers = profile?.autofillAnswers?.custom ?? [];
  if (normalizedLabels.size === 0 || !Array.isArray(answers)) return '';

  const matches = answers
    .filter((entry) => (
      [entry?.label, ...(Array.isArray(entry?.aliases) ? entry.aliases : [])]
        .some((phrase) => normalizedLabels.has(normalize(phrase)))
    ))
    .map((entry) => customAnswerValue(entry, field, normalize(displayFieldLabel(label))))
    .filter(Boolean);
  const uniqueAnswers = new Map(matches.map((answer) => [normalize(answer), answer]));

  return uniqueAnswers.size === 1 ? uniqueAnswers.values().next().value : '';
}

function splitName(fullName) {
  const parts = String(fullName ?? '').trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return { firstName: '', lastName: '' };
  if (parts.length === 1) return { firstName: parts[0], lastName: '' };
  return { firstName: parts[0], lastName: parts.slice(1).join(' ') };
}

function displayFieldLabel(label) {
  const seen = new Set();
  const parts = String(label ?? '')
    .split('|')
    .map((part) => compactText(cleanFieldLabelNoise(part.replace(/[\u2731*]/g, ' '))))
    .filter(Boolean)
    .filter((part) => {
      const normalized = normalize(part);
      if (
        !normalized
        || normalized === 'off'
        || normalized === 'on'
        || normalized === 'type your response'
        || normalized === 'select'
        || normalized === 'select ...'
        || /^question \d+$/.test(normalized)
        || /^question_\d+$/.test(part)
        || /^react select \d+/.test(normalized)
        || /^rm field/.test(normalized)
        || ['given-name', 'family-name'].includes(part)
      ) {
        return false;
      }

      if (seen.has(normalized)) return false;
      seen.add(normalized);
      return true;
    });

  return parts.find((part) => part.includes('?')) || parts[0] || compactText(label, 180) || 'Field';
}

function locationParts(location) {
  const parts = String(location ?? '').split(',').map((part) => part.trim()).filter(Boolean);
  return {
    city: parts[0] ?? '',
    state: parts[1] ?? '',
    country: parts[2] ?? parts.find((part) => /united states|usa|canada|kingdom|germany|france|spain|italy/i.test(part)) ?? '',
    cityState: [parts[0], parts[1]].filter(Boolean).join(', '),
  };
}

function ageFromDate(value) {
  if (!value) return '';
  const birthDate = new Date(value);
  if (Number.isNaN(birthDate.getTime())) return '';
  const today = new Date();
  let age = today.getFullYear() - birthDate.getFullYear();
  const monthDelta = today.getMonth() - birthDate.getMonth();
  if (monthDelta < 0 || (monthDelta === 0 && today.getDate() < birthDate.getDate())) {
    age -= 1;
  }
  return age >= 0 && age < 120 ? String(age) : '';
}

function isAdultAgeVerificationLabel(value) {
  const label = normalize(value);
  return (
    /\b(?:over(?: the)? age of|at least)\s*18\b/.test(label)
    || /\b18\s*years?\s*(?:of age\s*)?(?:or|and)?\s*older\b/.test(label)
    || /\b18\s*years?\s*old\b/.test(label)
  );
}

function hasSkill(profile, patterns) {
  const skillText = [
    ...(profile?.skills ?? []),
    ...(profile?.workHistory ?? []).flatMap((entry) => entry.skills ?? []),
    ...(profile?.projectHistory ?? []).flatMap((entry) => entry.technologies ?? []),
  ].map(normalize).join(' ');

  return patterns.some((pattern) => pattern.test(skillText));
}

function shortCustomAnswer(profile, label) {
  const answer = customAnswer(profile, label, { label, type: 'text' });
  return answer && String(answer).length <= 90 ? answer : '';
}

function customAnswerKeywords(label) {
  return normalize(label)
    .split(' ')
    .filter((term) => term.length > 2 && !['please', 'select', 'required', 'optional', 'application'].includes(term))
    .slice(0, 10)
    .join(' ');
}

function conciseYesNo(value) {
  const normalized = normalize(value);
  if (!normalized) return '';
  if (/^(yes|true|y)\b/.test(normalized)) return 'Yes';
  if (/^(no|false|n)\b/.test(normalized)) return 'No';
  if (/not willing|unable|cannot|can't|will not|won't/.test(normalized)) return 'No';
  if (/willing|open to relocat|can relocat/.test(normalized)) return 'Yes';
  return '';
}

function experienceThresholdAnswer(label, values) {
  const normalizedLabel = normalize(label);
  if (!/experience|software|engineer|development|programming|infrastructure|industry|career/.test(normalizedLabel)) {
    return '';
  }
  const thresholdMatch = normalizedLabel.match(
    /(?:at least|minimum(?: of)?|minimum requirement(?: of)?|do you have)\s*(\d{1,2})\+?\s*(?:or more\s*)?years?/,
  ) || normalizedLabel.match(/(\d{1,2})\+\s*years?/);
  if (!thresholdMatch) return '';

  const threshold = Number(thresholdMatch[1]);
  const profileYears = Number(
    /software|engineer|development|programming|infrastructure/.test(normalizedLabel)
      ? values.yearsSoftware
      : values.yearsProfessional,
  );
  if (!Number.isFinite(threshold) || !Number.isFinite(profileYears)) return '';
  return profileYears >= threshold ? 'Yes' : 'No';
}

function isManualPlaceholderAnswer(value) {
  return /^(manual|todo|tbd|placeholder|needs manual|manual:|todo:)\b/.test(normalize(value));
}

function looksLikeUrl(value) {
  const text = String(value ?? '').trim();
  if (!text) return false;
  try {
    const url = new URL(text);
    return ['http:', 'https:'].includes(url.protocol);
  } catch {
    return /^https?:\/\/\S+\.\S+/.test(text);
  }
}

function expectsUrlAnswer(label) {
  const normalizedLabel = normalize(label);
  return /\burl\b|\blink\b|website|portfolio|linkedin|github|shared block/.test(normalizedLabel);
}

function answerMatchesRequestedCurrency(label, answer) {
  const normalizedLabel = normalize(label);
  const normalizedAnswer = normalize(answer);
  const checks = [
    { requested: /japanese yen|\bjpy\b/, supplied: /\byen\b|\bjpy\b|\u00a5/ },
    { requested: /british pounds?|pounds? sterling|\bgbp\b/, supplied: /\bpounds?\b|\bgbp\b|\u00a3/ },
    { requested: /\beuros?\b|\beur\b/, supplied: /\beuros?\b|\beur\b|\u20ac/ },
    { requested: /canadian dollars?|\bcad\b/, supplied: /canadian dollars?|\bcad\b/ },
    { requested: /australian dollars?|\baud\b/, supplied: /australian dollars?|\baud\b/ },
  ];
  const requested = checks.filter((entry) => entry.requested.test(normalizedLabel));
  if (requested.length === 0) return true;
  return requested.some((entry) => entry.supplied.test(normalizedAnswer));
}

function answerMatchesRequestedSalaryPeriod(label, answer) {
  const normalizedLabel = normalize(label);
  const normalizedAnswer = normalize(answer);
  const requestedPeriod = /per month|monthly|\/\s*month|\/\s*mo\b/.test(normalizedLabel)
    ? 'monthly'
    : (/per hour|hourly|\/\s*hour|\/\s*hr\b/.test(normalizedLabel)
      ? 'hourly'
      : (/per year|yearly|annual|annually|\/\s*year|\/\s*yr\b/.test(normalizedLabel) ? 'annual' : ''));

  if (!requestedPeriod) return true;

  const suppliedPeriod = /per month|monthly|\/\s*month|\/\s*mo\b/.test(normalizedAnswer)
    ? 'monthly'
    : (/per hour|hourly|\/\s*hour|\/\s*hr\b/.test(normalizedAnswer)
      ? 'hourly'
      : (/per year|yearly|annual|annually|\/\s*year|\/\s*yr\b/.test(normalizedAnswer) ? 'annual' : ''));

  // RoleMatch's base salary preference is annual unless the saved answer says otherwise.
  if (!suppliedPeriod) return requestedPeriod === 'annual';
  return suppliedPeriod === requestedPeriod;
}

function isSalaryQuestionLabel(value) {
  return /salary|compensation|desired pay|pay expectation|expected annual|desired annual|target compensation/.test(normalize(value));
}

function annualPostedSalaryAnswer(job) {
  const salaryMin = salaryAmount(job?.salaryMin);
  const salaryMax = salaryAmount(job?.salaryMax);
  const period = normalize(job?.salaryPeriod || job?.salaryUnit || 'year');
  const currency = normalize(job?.salaryCurrency || job?.currency || 'usd');
  if (!salaryMin || !salaryMax || !/year|annual/.test(period) || !/^(?:usd|us dollars?)$/.test(currency)) return '';

  const low = Math.min(salaryMin, salaryMax);
  const high = Math.max(salaryMin, salaryMax);
  const target = Math.max(low, Math.floor((low + ((high - low) * 0.45)) / 1000) * 1000);
  return `$${String(target).replace(/\B(?=(\d{3})+(?!\d))/g, ',')}`;
}

function customAnswerFitsField(field, answer) {
  const label = normalize(field.label);
  const normalizedAnswer = normalize(answer);
  const textField = ['text', 'textarea'].includes(field.type);

  if (
    textField
    && /(?:list|specify|share|provide|what).*languages?|languages?.*(?:proficiency|level|speak)/.test(label)
    && /^(?:yes|no|true|false|0|1)$/.test(normalizedAnswer)
  ) {
    return false;
  }

  if (/salary|compensation|desired pay|pay expectation|expected annual|desired annual|target compensation/.test(label)) {
    return answerMatchesRequestedCurrency(label, answer);
  }

  return true;
}

function answerFromCustomProfile(profile, field, exactOnly = false) {
  const custom = exactOnly
    ? exactCustomAnswer(profile, field.label, field)
    : customAnswer(profile, field.label, field);
  if (!custom) return null;
  if (isManualPlaceholderAnswer(custom)) {
    return { action: 'skip', answer: custom, reason: 'manual custom answer placeholder' };
  }
  if (expectsUrlAnswer(field.label) && !looksLikeUrl(custom)) {
    return { action: 'skip', answer: custom, reason: 'custom answer is not a URL' };
  }
  if (!customAnswerFitsField(field, custom)) {
    return { action: 'skip', answer: custom, reason: 'custom answer format does not fit this question' };
  }
  return { action: 'fill', answer: custom, reason: 'custom autofill answer' };
}

function answerForCustomCheckbox(field, profile) {
  const customMatch = answerFromCustomProfile(profile, field, true)
    || answerFromCustomProfile(profile, field);
  if (!customMatch || customMatch.action !== 'fill') return customMatch;

  // Ashby renders one Yes/No value as a hidden checkbox beside two buttons.
  // The saved answer applies to that button group, not the hidden input text.
  if (checkboxYesNoButtons(field.element).length > 0) return customMatch;

  const option = field.element ? optionText(field.element).split('|')[0]?.trim() : '';
  if (!option) return customMatch;
  if (
    optionMatches(option, customMatch.answer, field.label)
    || normalize(customMatch.answer).includes(normalize(option))
  ) return customMatch;

  return { action: 'skip', answer: '', reason: 'custom checkbox option not selected' };
}

function technologyExperienceAnswer(profile, label) {
  const custom = shortCustomAnswer(profile, label);
  if (custom) return custom;

  const normalizedLabel = normalize(label);
  if (/ai[- ]assisted|claude|cursor|copilot|codex|openai/.test(normalizedLabel)) return 'Advanced';
  if (/javascript|react|node/.test(normalizedLabel)) {
    return hasSkill(profile, [/javascript/, /typescript/, /react/, /node/]) ? 'Intermediate' : 'Beginner';
  }
  if (/python|ruby|java/.test(normalizedLabel)) {
    return hasSkill(profile, [/python/, /\bjava\b/, /ruby/]) ? 'Intermediate' : 'Beginner';
  }
  if (/\bgo\b|golang/.test(normalizedLabel)) {
    return hasSkill(profile, [/\bgo\b/, /golang/]) ? 'Beginner' : 'No professional experience';
  }
  if (/unit test|testing|test automation|qa/.test(normalizedLabel)) return 'Intermediate';

  return '';
}

function isTechnologyExperienceLevelQuestion(label) {
  const normalizedLabel = normalize(label);
  return /level of experience|experience level|level of proficiency|proficiency (?:with|in)|rank yourself|rate (?:yourself|your experience|your proficiency)/.test(normalizedLabel);
}

function technologyYearsAnswer(profile, label, values) {
  const normalizedLabel = normalize(label);
  if (!/how many years|years of (?:hands on |professional )?experience|years.*experience/.test(normalizedLabel)) return '';

  const technologies = [
    { pattern: /\bgo\b|golang/, skills: [/\bgo\b/, /golang/] },
    { pattern: /python/, skills: [/python/] },
    { pattern: /javascript|typescript|react|node/, skills: [/javascript/, /typescript/, /react/, /node/] },
    { pattern: /java(?!script)/, skills: [/\bjava\b/] },
    { pattern: /\bphp\b/, skills: [/\bphp\b/] },
    { pattern: /ruby|rails/, skills: [/ruby/, /rails/] },
    { pattern: /c\s*#|csharp|\.net/, skills: [/c\s*#/, /csharp/, /\.net/] },
    { pattern: /\brust\b/, skills: [/\brust\b/] },
    { pattern: /\bswift\b/, skills: [/\bswift\b/] },
    { pattern: /\bkotlin\b/, skills: [/\bkotlin\b/] },
    { pattern: /\bscala\b/, skills: [/\bscala\b/] },
    { pattern: /linux/, skills: [/linux/] },
  ];
  const technology = technologies.find((entry) => entry.pattern.test(normalizedLabel));
  if (!technology) return '';
  if (!hasSkill(profile, technology.skills)) return '0';
  return values.yearsSoftware || values.yearsProfessional || '';
}

function currentCompany(profile) {
  const companyLooksReal = (value) => {
    const normalized = normalize(value);
    return Boolean(
      normalized
      && !['current company', 'current employer', 'company', 'employer', 'organization', 'organisation'].includes(normalized)
    );
  };
  const current = (profile?.workHistory ?? []).find((entry) => entry.current && companyLooksReal(entry.company));
  const custom = shortCustomAnswer(profile, 'current company current employer current organization current workplace');
  return current?.company ?? (custom || 'N/A');
}

function buildInterestAnswer(profile, job) {
  const skills = [
    ...(profile?.skills ?? []),
    ...(profile?.projectHistory ?? []).flatMap((project) => project.technologies ?? []),
  ].filter(Boolean).slice(0, 6);
  const role = job?.title || profile?.targetRoles?.[0] || 'this role';
  const company = job?.company || 'your team';
  const skillText = skills.length > 0 ? skills.join(', ') : 'software development, databases, APIs, debugging, and documentation';

  return `I am interested in ${role} at ${company} because it aligns with my background in ${skillText}. I am comfortable learning quickly, working through technical problems, and contributing to reliable software systems.`;
}

function buildGrowthAnswer(profile, job) {
  const role = job?.title || profile?.targetRoles?.[0] || 'this role';
  return `I hope to grow in ${role} by taking on more ownership of product features, improving my ability to build reliable user-facing systems, and learning from experienced engineers through code review and technical collaboration. I am especially interested in strengthening my debugging, system design, and delivery skills while contributing useful work to the team.`;
}

function buildMobileAiAnswer(profile, job) {
  const role = job?.title || profile?.targetRoles?.[0] || 'the role';
  return `In the past six months, I used AI assistance while building and testing application features that needed to work cleanly across different screen sizes and user flows. For ${role}, I would use the same approach: ask AI to help compare implementation options, generate edge-case checklists, and speed up debugging, then personally review the output, run the code, and adjust the final implementation so it matches the actual product requirements.`;
}

function ageRangeAnswer(age) {
  const numericAge = Number(age);
  if (!Number.isFinite(numericAge)) return '';
  if (numericAge <= 17) return '17 or younger';
  if (numericAge <= 20) return '18-20';
  if (numericAge <= 29) return '21-29';
  if (numericAge <= 39) return '30-39';
  if (numericAge <= 49) return '40-49';
  if (numericAge <= 59) return '50-59';
  return '60 or older';
}

const US_STATE_ABBREVIATIONS = {
  alabama: 'al',
  alaska: 'ak',
  arizona: 'az',
  arkansas: 'ar',
  california: 'ca',
  colorado: 'co',
  connecticut: 'ct',
  delaware: 'de',
  florida: 'fl',
  georgia: 'ga',
  hawaii: 'hi',
  idaho: 'id',
  illinois: 'il',
  indiana: 'in',
  iowa: 'ia',
  kansas: 'ks',
  kentucky: 'ky',
  louisiana: 'la',
  maine: 'me',
  maryland: 'md',
  massachusetts: 'ma',
  michigan: 'mi',
  minnesota: 'mn',
  mississippi: 'ms',
  missouri: 'mo',
  montana: 'mt',
  nebraska: 'ne',
  nevada: 'nv',
  'new hampshire': 'nh',
  'new jersey': 'nj',
  'new mexico': 'nm',
  'new york': 'ny',
  'north carolina': 'nc',
  'north dakota': 'nd',
  ohio: 'oh',
  oklahoma: 'ok',
  oregon: 'or',
  pennsylvania: 'pa',
  'rhode island': 'ri',
  'south carolina': 'sc',
  'south dakota': 'sd',
  tennessee: 'tn',
  texas: 'tx',
  utah: 'ut',
  vermont: 'vt',
  virginia: 'va',
  washington: 'wa',
  'west virginia': 'wv',
  wisconsin: 'wi',
  wyoming: 'wy',
};

function normalizedStateAbbreviation(value) {
  const text = normalize(value);
  const exact = US_STATE_ABBREVIATIONS[text];
  if (exact) return exact;
  return Object.entries(US_STATE_ABBREVIATIONS)
    .find(([stateName]) => text.includes(stateName))?.[1] || '';
}

function todayDateAnswer() {
  const today = new Date();
  const month = String(today.getMonth() + 1).padStart(2, '0');
  const day = String(today.getDate()).padStart(2, '0');
  return `${today.getFullYear()}-${month}-${day}`;
}

function phoneWithCountryCode(value, country) {
  const raw = compactText(value, 60);
  if (!raw || raw.startsWith('+')) return raw;
  const digits = raw.replace(/\D/g, '');
  if (/united states|usa|u\.?s\.?/i.test(String(country || '')) && digits.length === 10) {
    return `+1 ${digits.slice(0, 3)} ${digits.slice(3, 6)} ${digits.slice(6)}`;
  }
  return raw;
}

function buildProfileValues(profile, job) {
  const activeJob = currentPageJobContext(job);
  const names = splitName(profile?.fullName);
  const location = profile?.location || profile?.preferredLocations?.[0] || '';
  const parsedLocation = locationParts(location);
  const educationEntry = (profile?.educationHistory ?? []).find((entry) => entry?.school || entry?.degree || entry?.field) ?? {};
  const authorized = conciseYesNo(profile?.workAuthorization || profile?.autofillAnswers?.authorizedToWork) || 'Yes';
  const sponsorship = conciseYesNo(profile?.autofillAnswers?.sponsorshipRequired) || 'No';
  const resumeDocument = [...(profile?.documents ?? [])]
    .filter((document) => document.documentType === 'resume' || /resume|cv/i.test(document.label ?? ''))
    .sort((first, second) => Date.parse(second.uploadedAt ?? '') - Date.parse(first.uploadedAt ?? ''))[0];
  const postedSalary = annualPostedSalaryAnswer(activeJob);

  return {
    fullName: profile?.fullName || [names.firstName, names.lastName].filter(Boolean).join(' '),
    todayDate: todayDateAnswer(),
    firstName: names.firstName,
    middleName: profile?.middleName || '',
    lastName: names.lastName,
    dateOfBirth: profile?.dateOfBirth || '',
    age: ageFromDate(profile?.dateOfBirth),
    email: shortCustomAnswer(profile, 'primary application email preferred email application email email')
      || profile?.gmailEmail
      || profile?.email
      || '',
    phone: profile?.phone || shortCustomAnswer(profile, 'phone'),
    phoneDeviceType: shortCustomAnswer(profile, 'phone device type mobile home work') || 'Mobile',
    phoneExtension: shortCustomAnswer(profile, 'phone extension') || '',
    location,
    city: parsedLocation.city,
    state: parsedLocation.state,
    country: parsedLocation.country || 'United States',
    cityState: parsedLocation.cityState || location,
    streetAddress: shortCustomAnswer(profile, 'current mailing address street address home address address line 1'),
    postalCode: shortCustomAnswer(profile, 'postal code zip code zip'),
    linkedIn: profile?.linkedinUrl || shortCustomAnswer(profile, 'linkedin'),
    github: profile?.githubUrl || shortCustomAnswer(profile, 'github'),
    twitter: shortCustomAnswer(profile, 'twitter x profile social media url'),
    portfolio: profile?.portfolioUrl || profile?.githubUrl || shortCustomAnswer(profile, 'portfolio website personal site'),
    currentCompany: currentCompany(profile),
    education: profile?.education || educationEntry.school || '',
    school: educationEntry.school || profile?.educationHistory?.[0]?.school || '',
    degree: educationEntry.degree || profile?.educationHistory?.[0]?.degree || '',
    discipline: educationEntry.field || educationEntry.discipline || profile?.educationHistory?.[0]?.field || '',
    authorized,
    citizenship: /citizen/.test(normalize(profile?.workAuthorization || '')) ? 'Yes' : '',
    sponsorship,
    veteran: profile?.veteranStatus || profile?.autofillAnswers?.veteranStatus || 'No',
    disability: profile?.disabilityStatus || profile?.autofillAnswers?.disabilityStatus || 'No',
    gender: profile?.gender || profile?.autofillAnswers?.gender || '',
    race: profile?.race || profile?.autofillAnswers?.race || '',
    pronouns: profile?.pronouns || shortCustomAnswer(profile, 'pronouns preferred pronouns'),
    salary: postedSalary || profile?.salaryMinimum || profile?.autofillAnswers?.desiredSalary || '',
    postedSalary,
    startDate: profile?.autofillAnswers?.earliestStartDate || '',
    relocate: conciseYesNo(profile?.autofillAnswers?.willingToRelocate),
    remoteWork: conciseYesNo(shortCustomAnswer(profile, 'remote work willing to work remotely')) || 'Yes',
    clearance: shortCustomAnswer(profile, 'security clearance public trust clearance active clearance') || 'No',
    yearsProfessional: profile?.autofillAnswers?.yearsProfessionalExperience || '',
    yearsSoftware: profile?.autofillAnswers?.yearsSoftwareExperience || profile?.autofillAnswers?.yearsProfessionalExperience || '',
    hispanic: shortCustomAnswer(profile, 'hispanic latino ethnicity') || 'No',
    source: shortCustomAnswer(profile, 'how did you hear about us source company careers job posting') || 'Company careers page',
    referral: shortCustomAnswer(profile, 'referral referrer referred refer someone employee') || 'No',
    resumeFile: resumeDocument || (profile?.resumeUrl ? {
      documentType: 'resume',
      fileUrl: profile.resumeUrl,
      fileName: profile.resumeUrl.split('/').pop() || 'resume',
      mimeType: null,
      label: 'Resume',
    } : null),
    interest: buildInterestAnswer(profile, activeJob),
    growth: buildGrowthAnswer(profile, activeJob),
    mobileAi: buildMobileAiAnswer(profile, activeJob),
    ageRange: ageRangeAnswer(ageFromDate(profile?.dateOfBirth)),
  };
}

function workdayCollectionIndex(element, collection) {
  const currentPrefix = String(element?.id || '').match(new RegExp(`^(${collection}-\\d+)--`))?.[1];
  if (!currentPrefix) return -1;

  const prefixes = uniqueParts(
    Array.from(document.querySelectorAll(`[id^="${collection}-"]`))
      .map((candidate) => String(candidate.id || '').match(new RegExp(`^(${collection}-\\d+)--`))?.[1])
      .filter(Boolean),
  );
  return prefixes.indexOf(currentPrefix);
}

function profileDateParts(value) {
  const raw = String(value || '').trim();
  const iso = raw.match(/^(\d{4})(?:-(\d{1,2}))?/);
  if (iso) {
    return {
      year: iso[1],
      month: iso[2] ? String(Number(iso[2])) : '',
    };
  }

  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) return { year: '', month: '' };
  return { year: String(parsed.getFullYear()), month: String(parsed.getMonth() + 1) };
}

function structuredFieldAnswer(value, reason) {
  const answer = String(value ?? '').trim();
  return answer
    ? { action: 'fill', answer, reason }
    : { action: 'skip', answer: '', reason: `${reason} is not in the profile` };
}

function primaryEducationField(value) {
  return String(value ?? '')
    .split(';')[0]
    .replace(/\s+(?:with\s+)?(?:a\s+)?minor\s+in\s+.+$/i, '')
    .trim();
}

function answerForWorkdayIndexedField(field, profile) {
  const element = field.element;
  if (!element) return null;

  const identity = normalize([
    element.id,
    element.getAttribute('name'),
    field.label,
  ].filter(Boolean).join(' ').replace(/[\][_.:-]+/g, ' '));

  const workIndex = workdayCollectionIndex(element, 'workExperience');
  if (workIndex >= 0) {
    const entries = (profile?.workHistory ?? []).filter((entry) => entry?.company || entry?.title);
    const entry = entries[workIndex];
    if (!entry) return { action: 'skip', answer: '', reason: 'no matching work-history entry in profile' };

    const start = profileDateParts(entry.startDate);
    const end = profileDateParts(entry.endDate);
    if (/jobtitle/.test(identity)) return structuredFieldAnswer(entry.title, 'job title');
    if (/companyname/.test(identity)) return structuredFieldAnswer(entry.company, 'company');
    if (/currentlyworkhere/.test(identity)) {
      return entry.current
        ? { action: 'fill', answer: 'Yes', reason: 'current work-history entry' }
        : { action: 'skip', answer: '', reason: 'work-history entry is not current' };
    }
    if (/startdate.*datesectionmonth/.test(identity)) return structuredFieldAnswer(start.month, 'work start month');
    if (/startdate.*datesectionyear/.test(identity)) return structuredFieldAnswer(start.year, 'work start year');
    if (/enddate.*datesectionmonth/.test(identity)) {
      return entry.current
        ? { action: 'skip', answer: '', reason: 'current work entry has no end month' }
        : structuredFieldAnswer(end.month, 'work end month');
    }
    if (/enddate.*datesectionyear/.test(identity)) {
      return entry.current
        ? { action: 'skip', answer: '', reason: 'current work entry has no end year' }
        : structuredFieldAnswer(end.year, 'work end year');
    }
    if (/roledescription/.test(identity)) {
      return structuredFieldAnswer((entry.highlights ?? []).join('\n'), 'role description');
    }
    if (/\blocation\b/.test(identity)) return structuredFieldAnswer(entry.location, 'work location');
  }

  const educationIndex = workdayCollectionIndex(element, 'education');
  if (educationIndex >= 0) {
    const entries = (profile?.educationHistory ?? []).filter((entry) => entry?.school || entry?.degree);
    const entry = entries[educationIndex];
    if (!entry) return { action: 'skip', answer: '', reason: 'no matching education entry in profile' };

    const start = profileDateParts(entry.startDate);
    const end = profileDateParts(entry.endDate);
    if (/\bschool\b/.test(identity)) return structuredFieldAnswer(entry.school, 'school');
    if (/\bdegree\b/.test(identity)) return structuredFieldAnswer(entry.degree, 'degree');
    if (/fieldofstudy/.test(identity)) {
      return structuredFieldAnswer(primaryEducationField(entry.field || entry.discipline), 'field of study');
    }
    if (/gradeaverage/.test(identity)) {
      const numericGpa = String(entry.gpa ?? '').match(/\b(?:[0-4](?:\.\d+)?)\b/)?.[0] || '';
      return structuredFieldAnswer(numericGpa, 'GPA');
    }
    if (/firstyearattended/.test(identity)) return structuredFieldAnswer(start.year, 'education start year');
    if (/lastyearattended/.test(identity)) return structuredFieldAnswer(end.year, 'education end year');
  }

  return null;
}

function dayforceCollectionIndex(element, collection) {
  const identity = `${element?.id || ''} ${element?.getAttribute?.('name') || ''}`;
  const match = identity.match(new RegExp(`jobPostingApplication_${collection}_(\\d+)_`, 'i'));
  return match ? Number(match[1]) : -1;
}

function profileDateForField(value, element) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  const parts = profileDateParts(raw);
  const month = String(parts.month || '1').padStart(2, '0');
  const placeholder = normalize(element?.getAttribute?.('placeholder'));
  const type = String(element?.getAttribute?.('type') || '').toLowerCase();
  if (/mm.*yyyy|month.*year/.test(placeholder)) return `${month}/${parts.year}`;
  if (type === 'month') return `${parts.year}-${month}`;
  if (type === 'date') return /^\d{4}-\d{2}-\d{2}$/.test(raw) ? raw : `${parts.year}-${month}-01`;
  return raw;
}

function answerForDayforceIndexedField(field, profile) {
  if (state.ats !== 'Dayforce' || !field.element) return null;
  const identity = normalize([
    field.element.id,
    field.element.getAttribute('name'),
    field.element.getAttribute('test-id'),
    field.label,
  ].filter(Boolean).join(' ').replace(/[\][_.:-]+/g, ' '));

  const workIndex = dayforceCollectionIndex(field.element, 'workHistory');
  if (workIndex >= 0) {
    const entry = (profile?.workHistory ?? []).filter((item) => item?.company || item?.title)[workIndex];
    if (!entry) return { action: 'skip', answer: '', reason: 'no matching work-history entry in profile' };
    const location = locationParts(entry.location || '');
    if (/\btitle\b/.test(identity)) return structuredFieldAnswer(entry.title, 'job title');
    if (/iscurrent/.test(identity)) {
      return entry.current
        ? { action: 'fill', answer: 'Yes', reason: 'current work-history entry' }
        : { action: 'skip', answer: '', reason: 'work-history entry is not current' };
    }
    if (/companyname/.test(identity)) return structuredFieldAnswer(entry.company, 'company');
    if (/effectivestart/.test(identity)) return structuredFieldAnswer(profileDateForField(entry.startDate, field.element), 'work start date');
    if (/effectiveend/.test(identity)) {
      return entry.current
        ? { action: 'skip', answer: '', reason: 'current work entry has no end date' }
        : structuredFieldAnswer(profileDateForField(entry.endDate, field.element), 'work end date');
    }
    if (/countrycode/.test(identity)) return structuredFieldAnswer(location.country, 'work country');
    if (/statecode/.test(identity)) return structuredFieldAnswer(location.state, 'work state/province');
    if (/\bcity\b/.test(identity)) return structuredFieldAnswer(location.city, 'work city');
    if (/description/.test(identity)) return structuredFieldAnswer((entry.highlights ?? []).join('\n'), 'role description');
    if (/department|supervisor|reasonforleaving/.test(identity)) {
      return { action: 'skip', answer: '', reason: 'this work-history detail is not in the profile' };
    }
  }

  const educationIndex = dayforceCollectionIndex(field.element, 'educationHistory');
  if (educationIndex >= 0) {
    const entry = (profile?.educationHistory ?? []).filter((item) => item?.school || item?.degree)[educationIndex];
    if (!entry) return { action: 'skip', answer: '', reason: 'no matching education entry in profile' };
    const location = locationParts(entry.location || '');
    const minor = String(entry.field || '').match(/\bminor(?:\s+in)?\s+([^;,]+)/i)?.[1]?.trim() || '';
    if (/degreename/.test(identity)) return structuredFieldAnswer(entry.degree, 'degree');
    if (/notcompleted/.test(identity)) return { action: 'skip', answer: '', reason: 'education completion status is not explicit in profile' };
    if (/majorname/.test(identity)) return structuredFieldAnswer(primaryEducationField(entry.field), 'major');
    if (/minorname/.test(identity)) return structuredFieldAnswer(minor, 'minor');
    if (/effectivestart/.test(identity)) return structuredFieldAnswer(profileDateForField(entry.startDate, field.element), 'education start date');
    if (/effectiveend/.test(identity)) return structuredFieldAnswer(profileDateForField(entry.endDate, field.element), 'education end date');
    if (/schoolname/.test(identity)) return structuredFieldAnswer(entry.school, 'school');
    if (/countrycode/.test(identity)) return structuredFieldAnswer(location.country, 'education country');
    if (/statecode/.test(identity)) return structuredFieldAnswer(location.state, 'education state/province');
    if (/\bcity\b/.test(identity)) return structuredFieldAnswer(location.city, 'education city');
    if (/\bgpa\b/.test(identity)) {
      const numericGpa = String(entry.gpa ?? '').match(/\b(?:[0-4](?:\.\d+)?)\b/)?.[0] || '';
      return structuredFieldAnswer(numericGpa, 'GPA');
    }
  }

  return null;
}

function answerForGreenhouseEducationField(field, profile) {
  if (state.ats !== 'Greenhouse' || !field.element) return null;
  const id = String(field.element.id || '');
  const match = id.match(/^(start|end)-(month|year)--(\d+)$/i);
  if (!match) return null;
  const entry = (profile?.educationHistory ?? []).filter((item) => item?.school || item?.degree)[Number(match[3])];
  if (!entry) return { action: 'skip', answer: '', reason: 'no matching education entry in profile' };
  const date = profileDateParts(match[1].toLowerCase() === 'start' ? entry.startDate : entry.endDate);
  const answer = match[2].toLowerCase() === 'year'
    ? date.year
    : ['', 'January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'][Number(date.month)] || '';
  return structuredFieldAnswer(answer, `education ${match[1].toLowerCase()} ${match[2].toLowerCase()}`);
}

function checkboxYesNoButtons(element) {
  let container = parentAcrossShadow(element);
  for (let depth = 0; container && depth < 5; depth += 1, container = parentAcrossShadow(container)) {
    const buttons = Array.from(new Set([
      ...Array.from(container.querySelectorAll?.('button') || []),
      ...Array.from(container.querySelectorAll?.('[role="button"]') || []),
    ]))
      .filter((button) => visible(button))
      .filter((button) => /^(?:yes|no)$/i.test(compactText(button.innerText || button.textContent)));
    const hasYes = buttons.some((button) => /^yes$/i.test(compactText(button.innerText || button.textContent)));
    const hasNo = buttons.some((button) => /^no$/i.test(compactText(button.innerText || button.textContent)));
    if (hasYes && hasNo) return buttons;
  }
  return [];
}

function answerForCheckboxField(field, values) {
  const label = normalize(field.label);
  const option = normalize(field.element ? optionText(field.element) : field.label);
  const identity = normalize([
    field.element?.id,
    field.element?.getAttribute?.('name'),
    field.element?.getAttribute?.('data-testid'),
  ].filter(Boolean).join(' '));

  if (/preferred name/.test(label)) {
    return { action: 'skip', answer: '', reason: 'no separate preferred name in profile' };
  }
  if (
    /read and understand.*privacy notice|privacy notice.*read and understand|acknowledge.*privacy notice/.test(label)
    || (state.ats === 'iCIMS' && /accept.*privacy (?:policy|notice)|application privacy notice/.test(label))
    || (
      state.ats === 'iCIMS'
      && /(?:accept|acknowledge).*(?:gdpr|privacy)|(?:gdpr|privacy).*(?:accept|acknowledge)/.test(identity)
    )
  ) {
    return { action: 'fill', answer: 'I agree', reason: 'required privacy notice acknowledgement' };
  }
  if (/marketing|future job opportunities|talent community|contact me about future/.test(label)) {
    return { action: 'skip', answer: '', reason: 'optional marketing consent is manual' };
  }
  if (/privacy policy|consent/.test(label)) {
    return { action: 'skip', answer: '', reason: 'privacy or consent acknowledgement is manual' };
  }
  if (/pronoun/.test(label)) {
    if (!values.pronouns) return { action: 'skip', answer: '', reason: 'no pronouns in profile' };
    return option.includes(normalize(values.pronouns))
      ? { action: 'fill', answer: values.pronouns, reason: 'profile pronouns' }
      : { action: 'skip', answer: '', reason: 'pronoun option does not match profile' };
  }
  if (/ethnic|race/.test(label)) {
    if (/white/.test(normalize(values.race)) && /white|caucasian/.test(option)) {
      return { action: 'fill', answer: 'White / Caucasian', reason: 'race/ethnicity checkbox' };
    }
    if (/asian/.test(normalize(values.race)) && /asian/.test(option)) {
      return { action: 'fill', answer: 'Asian', reason: 'race/ethnicity checkbox' };
    }
    return { action: 'skip', answer: '', reason: 'race checkbox option does not match profile' };
  }
  if (/gender|sex\b/.test(label)) {
    if (/male/.test(normalize(values.gender)) && /^male\b/.test(option)) {
      return { action: 'fill', answer: 'Male', reason: 'gender checkbox' };
    }
    if (/female/.test(normalize(values.gender)) && /^female\b/.test(option)) {
      return { action: 'fill', answer: 'Female', reason: 'gender checkbox' };
    }
    return { action: 'skip', answer: '', reason: 'gender checkbox option does not match profile' };
  }
  if (/highest.*education|education/.test(label)) {
    if (/bachelor/.test(normalize(values.degree || values.education)) && /bachelor/.test(option)) {
      return { action: 'fill', answer: 'Bachelor', reason: 'education checkbox' };
    }
    return { action: 'skip', answer: '', reason: 'education checkbox option does not match profile' };
  }
  if (checkboxYesNoButtons(field.element).length > 0) {
    return { action: 'skip', answer: '', reason: 'no confident profile match' };
  }
  return { action: 'skip', answer: '', reason: 'checkboxes require manual review' };
}

function answerForField(field, profile, job) {
  const label = normalize(field.label);
  const promptLabel = normalize(displayFieldLabel(field.label));
  const type = field.type;
  const nativeInputType = String(field.element?.getAttribute?.('type') || '').toLowerCase();
  const values = buildProfileValues(profile, job);
  const isApplicationChallenge = /application challenge/.test(label);

  if (field.element && isAutofillTrap(field.element)) {
    return { action: 'skip', answer: '', reason: 'anti-bot field is never filled' };
  }
  if (type === 'password' || /\bpassword\b|\bpasscode\b|\baccount pin\b/.test(label)) {
    return { action: 'skip', answer: '', reason: 'saved ATS account or browser password manager handles login' };
  }
  if (state.ats === 'Taleo' && /\buser name\b|\busername\b/.test(label)) {
    return { action: 'skip', answer: '', reason: 'saved ATS account or browser password manager handles login' };
  }
  if (state.ats === 'Taleo' && /^select a language\b|\bapplication language\b/.test(label)) {
    return { action: 'fill', answer: 'English', reason: 'application interface language' };
  }
  if (!isApplicationChallenge && /captcha|hcaptcha|recaptcha|security code|verification code|one time|otp/.test(label)) {
    return { action: 'skip', answer: '', reason: 'verification/CAPTCHA is manual' };
  }
  if (/diversity and inclusion consent|diversity data.*consent|data privacy consent/.test(label)) {
    return { action: 'skip', answer: '', reason: 'privacy or diversity consent is manual' };
  }
  if (/address line 2|address 2|secondary address|apartment suite unit/.test(label) && !field.required) {
    return { action: 'skip', answer: '', reason: 'optional secondary address left blank' };
  }
  if (type === 'file' || nativeInputType === 'file') {
    const fileIdentity = normalize(`${field.label} ${field.element ? crossShadowIdentity(field.element, 9) : ''}`);
    if (/cover letter/.test(label)) return { action: 'skip', answer: '', reason: 'cover letter file needs manual selection' };
    if (/resume|cv|apply with resume|resume upload/.test(fileIdentity) && values.resumeFile?.fileUrl) {
      return { action: 'file', answer: values.resumeFile.fileName || 'Resume', file: values.resumeFile, reason: 'resume file' };
    }
    return { action: 'skip', answer: '', reason: 'file upload needs manual selection' };
  }
  if (/preferred name/.test(label)) {
    return { action: 'skip', answer: '', reason: 'no separate preferred name in profile' };
  }
  if (isAdultAgeVerificationLabel(label)) {
    const isAdult = Number(values.age) >= 18;
    return {
      action: isAdult ? 'fill' : 'skip',
      answer: isAdult ? 'Yes' : '',
      reason: isAdult ? 'age verification' : 'date of birth is not in the profile',
    };
  }
  if (isSalaryQuestionLabel(label) && values.postedSalary) {
    return { action: 'fill', answer: values.postedSalary, reason: 'posted salary range' };
  }
  const exactCustomMatch = answerFromCustomProfile(profile, field, true);
  if (exactCustomMatch && type !== 'checkbox') return exactCustomMatch;
  if (/sms consent|text message consent|consent.*(?:sms|text message)|receive.*(?:sms|text messages?)/.test(label)) {
    return { action: 'skip', answer: '', reason: 'optional messaging consent is manual' };
  }
  if (
    /if you have any relative.*provide|if you were formerly employed.*provide.*employee id|if yes,? please (?:provide|list|describe|specify)/.test(label)
  ) {
    return { action: 'skip', answer: '', reason: 'conditional follow-up only applies after a yes answer' };
  }
  const structuredWorkdayAnswer = answerForWorkdayIndexedField(field, profile);
  if (structuredWorkdayAnswer) return structuredWorkdayAnswer;
  const structuredDayforceAnswer = answerForDayforceIndexedField(field, profile);
  if (structuredDayforceAnswer) return structuredDayforceAnswer;
  const structuredGreenhouseAnswer = answerForGreenhouseEducationField(field, profile);
  if (structuredGreenhouseAnswer) return structuredGreenhouseAnswer;
  if (field.element && isWorkdaySkillsSearch(field.element)) {
    const skills = uniqueParts(profile?.skills ?? []).filter(Boolean).slice(0, 10);
    return skills.length > 0
      ? { action: 'fill', answer: skills[0], answers: skills, reason: 'profile skills' }
      : { action: 'skip', answer: '', reason: 'no skills in profile' };
  }
  const asksAuthorization = /authorized to work|authorization to work|eligible(?: and willing)? to work|right to work/.test(label);
  const asksSponsorship = /sponsor|sponsorship|(?:need|require|seek|support|provide|obtain)(?:\W+\w+){0,3}\W+visa|visa(?:\W+\w+){0,3}\W+(?:need|require|sponsor|support)/.test(label);
  if (asksAuthorization && asksSponsorship) {
    const customAuthorization = answerFromCustomProfile(profile, field, true);
    if (customAuthorization) return customAuthorization;
    if (/without (?:visa )?sponsorship|do not require sponsorship|no sponsorship/.test(label)) {
      return { action: 'fill', answer: 'Yes', reason: 'authorized without sponsorship' };
    }
    if (['text', 'textarea'].includes(type)) {
      return {
        action: 'fill',
        answer: 'Yes, I am legally authorized to work and do not require sponsorship.',
        reason: 'combined work authorization and sponsorship answer',
      };
    }
    return { action: 'skip', answer: '', reason: 'no confident profile match' };
  }
  if (/require.*work authorization|work authorization.*require/.test(label)) {
    const answer = type === 'textarea' || type === 'text'
      ? 'No, I am legally authorized to work and do not require sponsorship.'
      : values.sponsorship;
    return { action: 'fill', answer, reason: 'does not require work authorization support' };
  }
  if (asksSponsorship && /require|need|sponsor|sponsorship|visa/.test(label)) {
    return { action: 'fill', answer: values.sponsorship, reason: 'sponsorship requirement' };
  }
  if (type === 'checkbox') {
    const customCheckboxMatch = answerForCustomCheckbox(field, profile);
    if (customCheckboxMatch) return customCheckboxMatch;
    return answerForCheckboxField(field, values);
  }
  if (/current employer.*(?:customer|client)|(?:customer|client).*current employer/.test(label)) {
    return { action: 'fill', answer: 'No', reason: 'no current-employer client conflict' };
  }
  if (/employed.*external auditors?|external auditors?.*employed/.test(label)) {
    return { action: 'fill', answer: 'No', reason: 'no external-auditor employment history' };
  }
  if (/legally authorized to work|authorized to work in the country|eligible(?: and willing)? to work|eligible to work in (?:the )?country|legally eligible to be employed|eligible for employment|right to work in the country/.test(label)) {
    return { action: 'fill', answer: values.authorized, reason: 'work authorization' };
  }
  if (/first name|given name/.test(label)) return { action: 'fill', answer: values.firstName, reason: 'first name' };
  if (/middle name/.test(label)) {
    return values.middleName
      ? { action: 'fill', answer: values.middleName, reason: 'middle name' }
      : { action: 'skip', answer: '', reason: 'no middle name in profile' };
  }
  if (/last name|family name|surname/.test(label)) return { action: 'fill', answer: values.lastName, reason: 'last name' };
  if (/full legal name|legal name|your name|full name/.test(label) && !/company|referral|employer/.test(label)) {
    return { action: 'fill', answer: values.fullName, reason: 'full name' };
  }
  if (/email|e-mail/.test(label)) return { action: 'fill', answer: values.email, reason: 'email' };
  if (/preferred contact method|preferred method of contact/.test(label)) {
    return { action: 'fill', answer: 'Email', reason: 'preferred contact method' };
  }
  if (/home phone/.test(label)) {
    return { action: 'skip', answer: '', reason: 'no separate home phone in profile' };
  }
  if (/phone number|mobile phone|cell phone|contact number|\btelephone\b|\btel\b/.test(label)) {
    const answer = state.ats === 'Recruitee'
      ? phoneWithCountryCode(values.phone, values.country)
      : values.phone;
    return { action: 'fill', answer, reason: 'phone number' };
  }
  if (/transgender/.test(label)) {
    const explicitAnswer = (profile?.autofillAnswers?.custom ?? []).find((answer) => (
      /transgender/.test(normalize(`${answer.label ?? ''} ${answer.keywords ?? ''}`))
    ))?.answer;
    return explicitAnswer
      ? { action: 'fill', answer: explicitAnswer, reason: 'explicit transgender profile answer' }
      : { action: 'skip', answer: '', reason: 'no explicit transgender answer in profile' };
  }
  const thresholdAnswer = experienceThresholdAnswer(field.label, values);
  if (thresholdAnswer) {
    return { action: 'fill', answer: thresholdAnswer, reason: 'profile experience threshold comparison' };
  }
  const customMatch = answerFromCustomProfile(profile, field);
  if (/^(?:start|end) date (?:month|year)\b/.test(label)) {
    return { action: 'skip', answer: '', reason: 'education date is not in the profile' };
  }
  if (customMatch) return customMatch;
  if (/high\s*school.*name.*location|school.*name.*location|supervisor.*name.*title/.test(label)) {
    return { action: 'skip', answer: '', reason: 'no confident profile match' };
  }
  if (/u\.?s\.? citizen|united states citizen/.test(label)) {
    return values.citizenship
      ? { action: 'fill', answer: values.citizenship, reason: 'explicit citizenship status' }
      : { action: 'skip', answer: '', reason: 'no explicit citizenship status in profile' };
  }
  if (/\bcitizenship\b/.test(label)) {
    return { action: 'skip', answer: '', reason: 'requested citizenship is not explicit in the profile' };
  }
  if (/commute|commuting/.test(label)) {
    return { action: 'skip', answer: '', reason: 'commute feasibility requires a profile answer' };
  }
  if (isApplicationChallenge) {
    return { action: 'skip', answer: '', reason: 'no confident profile match' };
  }
  if (/submit application|submit your application|final submit/.test(label)) {
    return { action: 'skip', answer: '', reason: 'final submit is intentionally manual' };
  }
  if (/^if yes\b|if yes.*list|if yes.*name|if yes.*relationship|please list.*relationship/.test(label)) {
    if (field.required && ['combobox', 'radio', 'select'].includes(type)) {
      return { action: 'fill', answer: 'No', reason: 'required conditional choice after a negative antecedent' };
    }
    return { action: 'skip', answer: '', reason: 'conditional follow-up only applies after a yes answer' };
  }
  if (/^if other\b|if other.*specify|other.*please specify/.test(label)) {
    return { action: 'skip', answer: '', reason: 'conditional follow-up only applies after selecting other' };
  }
  if (
    type === 'textarea'
    && /if yes|if applicable|please describe|please explain|explain/.test(label)
    && /related|relative|family|friend|conflict|relationship|government|clearance|sponsor|authorization|referred/.test(label)
  ) {
    return { action: 'skip', answer: '', reason: 'conditional follow-up only applies after a yes answer' };
  }
  if (/currently live.*time\s*zone|currently live.*timezone|time\s*zone.*eligib|timezone.*eligib/.test(label)) {
    return { action: 'skip', answer: '', reason: 'timezone/location eligibility requires manual review' };
  }

  if (/first name|given name/.test(label)) return { action: 'fill', answer: values.firstName, reason: 'first name' };
  if (/middle name/.test(label)) {
    return values.middleName
      ? { action: 'fill', answer: values.middleName, reason: 'middle name' }
      : { action: 'skip', answer: '', reason: 'no middle name in profile' };
  }
  if (/last name|family name|surname/.test(label)) return { action: 'fill', answer: values.lastName, reason: 'last name' };
  if (/full legal name|legal name|your name|full name|^name(?:\b|$)|applicant name|candidate name/.test(label) && !/company|referral|employer/.test(label)) {
    return { action: 'fill', answer: values.fullName, reason: 'full name' };
  }
  if (/email|e-mail/.test(label)) return { action: 'fill', answer: values.email, reason: 'email' };
  if (
    (type === 'textarea' || /tell us|describe|time in the past|example/.test(label))
    && /\bai\b|artificial intelligence|ai-assisted|generative ai/.test(label)
    && /mobile.*development|development project|project/.test(label)
  ) {
    return { action: 'fill', answer: values.mobileAi, reason: 'mobile AI project answer' };
  }
  if (/phone device type|phone type/.test(label)) {
    return { action: 'fill', answer: values.phoneDeviceType, reason: 'phone device type' };
  }
  if (/phone extension|\bextension\b/.test(label)) {
    return values.phoneExtension
      ? { action: 'fill', answer: values.phoneExtension, reason: 'phone extension' }
      : { action: 'skip', answer: '', reason: 'no phone extension in profile' };
  }
  if (/phone number|mobile phone|cell phone|contact number|\btelephone\b|\btel\b/.test(label)) {
    const answer = state.ats === 'Recruitee'
      ? phoneWithCountryCode(values.phone, values.country)
      : values.phone;
    return { action: 'fill', answer, reason: 'phone number' };
  }
  if (/\bphone\b/.test(label)) return { action: 'fill', answer: values.phone, reason: 'phone' };
  if (/current mailing address|mailing address|street address|address line 1|^address$/.test(label)) {
    return values.streetAddress
      ? { action: 'fill', answer: values.streetAddress, reason: 'street address' }
      : { action: 'skip', answer: '', reason: 'no confident profile match' };
  }
  if (/postal code|zip code|\bzip\b/.test(label)) {
    return values.postalCode
      ? { action: 'fill', answer: values.postalCode, reason: 'postal code' }
      : { action: 'skip', answer: '', reason: 'no confident profile match' };
  }
  if (/date of birth|birth date|\bdob\b/.test(label)) return { action: 'fill', answer: values.dateOfBirth, reason: 'date of birth' };
  if (/disability.*signature.*date|signature.*date|date.*signature|today(?:'?s|\s+s)?.*date/.test(label)) {
    return { action: 'fill', answer: values.todayDate, reason: 'signature date' };
  }
  if (/age range|age group/.test(label)) return { action: 'fill', answer: values.ageRange, reason: 'age range' };
  if (isAdultAgeVerificationLabel(label)) return { action: 'fill', answer: Number(values.age) >= 18 ? 'Yes' : '', reason: 'age verification' };
  if (/\bage\b/.test(label) && !/manage|manager|coverage/.test(label)) return { action: 'fill', answer: values.age, reason: 'age' };
  if (isTechnologyExperienceLevelQuestion(field.label)) {
    const answer = technologyExperienceAnswer(profile, field.label);
    return answer
      ? { action: 'fill', answer, reason: 'technology experience level' }
      : { action: 'skip', answer: '', reason: 'no concise experience level available' };
  }
  if (/non[- ]disclosure|non[- ]compete|nda|restrictive agreement|confidentiality agreement/.test(label)) {
    return { action: 'fill', answer: 'No', reason: 'no restrictive agreement' };
  }
  if (/ever been employed by|worked.*(?:temporary|contract).*through.*(?:3rd|third)[- ]party.*(?:at|for)|worked(?:\s+as\b.*?)?\s+(?:at|for)\b.*(?:past|previous|before|3rd[- ]party|third[- ]party|temporary|contract)|previously worked|former employee|worked at accenture|worked for accenture/.test(label)) {
    return { action: 'fill', answer: 'No', reason: 'no previous employment at this company' };
  }
  if (/current employer.*accenture|working relationship.*accenture|worked.*project.*accenture|accenture.*project/.test(label)) {
    return { action: 'fill', answer: 'No', reason: 'no current-employer client conflict' };
  }
  if (/security clearance|public trust clearance|hold.*clearance|active clearance/.test(label)) {
    return { action: 'fill', answer: values.clearance, reason: 'security clearance' };
  }
  if (/currently.*employee.*(u\.?s\.?|us|united states).*government|current employee.*(u\.?s\.?|us|united states).*government|employee.*government.*past 10|government.*within past 10|u\.?s\.? government.*within past|employed.*(?:federal|state|local).*government|employed.*entity.*government|have you been.*government|reserves|national guard|serving while/.test(label)) {
    return { action: 'fill', answer: 'No', reason: 'government employment/service status' };
  }
  if (/suspend(?:ed|sion)|debar(?:red|ment)|declared ineligible.*contract/.test(label)) {
    return { action: 'fill', answer: 'No', reason: 'no government contracting exclusion' };
  }
  if (/family member|family members|close relationship|close relationships|relative.*work|work for adventure|work at adventure|work for accenture/.test(label)) {
    return { action: 'fill', answer: 'No', reason: 'no listed internal relationship' };
  }
  if (/willing.*(?:undergo|complete).*(?:background|criminal).*(?:check|screen)|(?:background|criminal).*(?:check|screen).*willing/.test(label)) {
    return { action: 'fill', answer: 'Yes', reason: 'background-check consent' };
  }
  if (/affirmation|i agree|acknowledge|certify|agree to the above|understand.*agree/.test(label)) {
    return { action: 'fill', answer: 'I agree', reason: 'affirmation' };
  }
  if (/confirm.*(?:application|information).*(?:true|accurate|own)|everything.*application.*true.*own/.test(label)) {
    return { action: 'fill', answer: 'Yes', reason: 'application accuracy affirmation' };
  }
  if (/linkedin/.test(label)) return { action: 'fill', answer: values.linkedIn, reason: 'LinkedIn URL' };
  if (/github/.test(label) && !/copilot|assistant|ai-assisted|level of experience/.test(label)) {
    return { action: 'fill', answer: values.github, reason: 'GitHub URL' };
  }
  if (/twitter|x profile|x url/.test(label)) {
    return values.twitter
      ? { action: 'fill', answer: values.twitter, reason: 'Twitter/X URL' }
      : { action: 'skip', answer: '', reason: 'no Twitter/X profile URL in profile' };
  }
  if (/facebook/.test(label)) {
    return { action: 'skip', answer: '', reason: 'no Facebook profile URL in profile' };
  }
  if (/other url|other link|urls other/.test(label)) {
    const customOther = shortCustomAnswer(profile, field.label);
    return customOther
      ? { action: 'fill', answer: customOther, reason: 'custom other URL' }
      : { action: 'skip', answer: '', reason: 'no specific URL for this optional field' };
  }
  if (/portfolio|personal website|website|web site|project site/.test(label)) return { action: 'fill', answer: values.portfolio, reason: 'portfolio URL' };
  if (/current company|current employer|organization|organisation/.test(label)) return { action: 'fill', answer: values.currentCompany, reason: 'current company' };
  if (/which country.*work from|list your city and country|city and country/.test(label)) {
    return { action: 'fill', answer: values.location, reason: 'work location' };
  }
  if (/\bcountry\b/.test(label)) return { action: 'fill', answer: values.country, reason: 'country' };
  if (/relocat/.test(label)) {
    return values.relocate
      ? { action: 'fill', answer: values.relocate, reason: 'relocation' }
      : { action: 'skip', answer: '', reason: 'needs concise relocation preference' };
  }
  if (/currently located|current location|city,\s*state|city state/.test(label)) return { action: 'fill', answer: values.cityState || values.location, reason: 'city/state' };
  if (/\bcity\b/.test(label)) return { action: 'fill', answer: values.city || values.location, reason: 'city' };
  if (/\bstate\b|province/.test(label)) return { action: 'fill', answer: values.state, reason: 'state' };
  if (/location|where are you based|where do you live/.test(label)) return { action: 'fill', answer: values.location, reason: 'location' };
  if (/hybrid.*boston|boston.*office|working out of.*boston|4 days per week|working environment.*seeking/.test(label)) {
    return { action: 'fill', answer: 'Yes', reason: 'hybrid Boston preference' };
  }
  const technologyYears = technologyYearsAnswer(profile, field.label, values);
  if (technologyYears) {
    return { action: 'fill', answer: technologyYears, reason: 'technology experience years' };
  }
  if (/how many years|years of professional|years.*experience/.test(label) && !/level of experience|years of education/.test(label)) {
    const answer = /software|engineer|development|programming/.test(label)
      ? values.yearsSoftware
      : values.yearsProfessional;
    return { action: 'fill', answer, reason: 'professional experience years' };
  }
  if (/highest.*education|education completed|education.*attained|level of education/.test(label)) {
    return { action: 'fill', answer: values.degree || values.education, reason: 'education level' };
  }
  if (/school|university|college/.test(label)) return { action: 'fill', answer: values.school || values.education, reason: 'school' };
  if (/\bdegree\b/.test(label)) return { action: 'fill', answer: values.degree || values.education, reason: 'degree' };
  if (/discipline|major|field of study|area of study/.test(label)) return { action: 'fill', answer: values.discipline || values.education, reason: 'discipline' };
  if (/education/.test(label)) return { action: 'fill', answer: values.education, reason: 'education' };
  if (isSalaryQuestionLabel(label)) {
    if (!answerMatchesRequestedCurrency(field.label, values.salary)) {
      return { action: 'skip', answer: '', reason: 'requested salary currency is not in the profile' };
    }
    if (!answerMatchesRequestedSalaryPeriod(field.label, values.salary)) {
      return { action: 'skip', answer: '', reason: 'requested salary period is not in the profile' };
    }
    return { action: 'fill', answer: values.salary, reason: 'salary preference' };
  }
  if (/how many years.*software|years.*professional software|years.*software development/.test(label)) {
    return { action: 'fill', answer: values.yearsSoftware || values.yearsProfessional, reason: 'software experience years' };
  }
  if (/remote|work remotely|distributed/.test(label)) return { action: 'fill', answer: values.remoteWork, reason: 'remote work preference' };
  if (/based.*(u\.?s\.?|united states|canada)|living.*(u\.?s\.?|united states|canada)|live.*(u\.?s\.?|united states|canada)/.test(label)) {
    const profileLocation = normalize(`${values.location} ${values.country}`);
    return /united states|\busa\b|\bus\b|canada/.test(profileLocation)
      ? { action: 'fill', answer: 'Yes', reason: 'profile location is in supported country' }
      : { action: 'skip', answer: '', reason: 'supported-country location needs manual review' };
  }
  if (/require.*work authorization|work authorization.*require/.test(label)) {
    const answer = type === 'textarea' || type === 'text'
      ? 'No, I am legally authorized to work and do not require sponsorship.'
      : values.sponsorship;
    return { action: 'fill', answer, reason: 'does not require work authorization support' };
  }
  if (/permanent.*authorization.*work|authorization.*work|authorized|eligible.*work|legally.*work|work.*united states|work authorization|right to work/.test(label)) {
    return { action: 'fill', answer: values.authorized, reason: 'work authorization' };
  }
  if (/sponsor|sponsorship|visa/.test(label)) return { action: 'fill', answer: values.sponsorship, reason: 'sponsorship' };
  if (/veteran|military/.test(label)) return { action: 'fill', answer: values.veteran, reason: 'veteran status' };
  if (/disab/.test(label)) return { action: 'fill', answer: values.disability, reason: 'disability status' };
  if (/gender|sex\b/.test(label)) return { action: 'fill', answer: values.gender, reason: 'gender' };
  if (/hispanic|latino/.test(promptLabel)) {
    return { action: 'fill', answer: values.hispanic, reason: 'Hispanic/Latino status' };
  }
  if (/\brace\b|ethnic/.test(promptLabel)) return { action: 'fill', answer: values.race, reason: 'race/ethnicity' };
  if (/hear about|how did you hear|source|job board/.test(label)) return { action: 'fill', answer: values.source, reason: 'source' };
  if (/referral|referred|who referred|refer you|refer/.test(label)) return { action: 'fill', answer: values.referral, reason: 'referral' };
  if (/start date|available to start|earliest start/.test(label)) return { action: 'fill', answer: values.startDate, reason: 'start date' };

  if (/how.*hope.*grow|hope to grow|grow in this role|professional growth|career growth/.test(label)) {
    return { action: 'fill', answer: values.growth, reason: 'growth answer' };
  }

  if (/why.*interest|why.*role|why.*company|why.*position|why.*this position|cover letter|additional information|anything else/.test(label)) {
    return { action: 'fill', answer: values.interest, reason: 'short profile-based answer' };
  }

  return { action: 'skip', answer: '', reason: 'no confident profile match' };
}

const GENERIC_SCHOOL_TERMS = new Set([
  'college',
  'institute',
  'school',
  'technology',
  'the',
  'university',
]);

function distinctiveSchoolTerms(value) {
  return normalize(value)
    .split(' ')
    .filter((term) => term.length >= 3 && !GENERIC_SCHOOL_TERMS.has(term));
}

function optionMatches(optionText, answer, fieldLabel) {
  const rawOption = String(optionText ?? '').toLowerCase();
  const rawDesired = String(answer ?? '').toLowerCase();
  const option = normalize(optionText);
  const desired = normalize(answer);
  const label = normalize(fieldLabel);

  if (!option || /select|choose|please/.test(option)) return false;
  if (!desired) return false;
  const wantsYes = /yes|true|authorized|eligible|willing|agree|acknowledge|certify/.test(desired);
  const wantsNo = /(^|\b)(no|none|false|not|n\/a|na)(\b|$)|do not|don't|no current|no active|not applicable/.test(desired);
  const isEducationLevel = /\bdegree\b|highest.*education|education completed|education.*attained|level of education/.test(label);

  if (/school|university|college|institution/.test(label) && !isEducationLevel) {
    const desiredTerms = distinctiveSchoolTerms(answer);
    if (desiredTerms.length > 0) return desiredTerms.every((term) => option.includes(term));
    return option === desired || option.includes(desired) || desired.includes(option);
  }

  if (isEducationLevel) {
    if (/bachelor/.test(desired)) return /bachelor|bachelor's|bachelors|b\.?s\.?|b\.?a\.?/.test(option);
    if (/master/.test(desired)) return /master|m\.?s\.?|m\.?a\.?/.test(option);
    if (/associate/.test(desired)) return /associate|a\.?s\.?/.test(option);
  }

  if (/discipline|major|field of study|area of study/.test(label)) {
    if (/computer science/.test(desired)) return /\bcomputer science\b/.test(option);
    return desired.split(' ').filter((term) => term.length >= 4).some((term) => option.includes(term));
  }

  if (/affirmation|i agree|acknowledge|certify|agree to the above|understand.*agree/.test(label)) {
    return /agree|acknowledge|certify|yes/.test(option);
  }

  if (/security clearance|public trust clearance|hold.*clearance|active clearance/.test(label)) {
    if (wantsNo) return /^no\b|^none\b|no active|no current|do not|don't|not applicable|n\/a/.test(option);
    if (wantsYes) return /^yes\b|active|secret|public trust|clearance/.test(option);
  }

  if (/non[- ]disclosure|non[- ]compete|nda|restrictive agreement|confidentiality agreement|worked at|worked for|previously worked|former employee|current employer.*accenture|working relationship.*accenture|accenture.*project|current employee.*government|employee.*government.*past 10|government.*within past 10|serving while|reserves|national guard|family member|family members|close relationship|close relationships/.test(label)) {
    if (wantsNo) return /^no\b|^none\b|not applicable|n\/a|do not|don't|not currently|never/.test(option);
    if (wantsYes) return /^yes\b/.test(option);
  }

  if (/which location.*applying|location.*applying|preferred.*location|job location/.test(label)) {
    const desiredParts = desired.split(' ').filter((term) => term.length >= 3);
    const state = normalizedStateAbbreviation(answer);
    if (state && new RegExp(`(^|\\b)${state}(\\b|$)`).test(option)) return true;
    if (desiredParts.some((term) => option.includes(term) && !['united', 'states', 'usa'].includes(term))) return true;
    return false;
  }

  if (/how many years|years of professional|years.*experience/.test(label) && !/level of experience/.test(label)) {
    if (/3\s*\+|3 plus|three plus|three or more|3 or more/.test(rawDesired)) {
      return /3\s*\+|3 plus|three plus|three or more|3 or more/.test(rawOption);
    }
    if (/2\s*-\s*3|2 to 3/.test(rawDesired)) return /2\s*-\s*3|2 to 3/.test(rawOption);
    if (/1\s*-\s*2|1 to 2/.test(rawDesired)) return /1\s*-\s*2|1 to 2/.test(rawOption);
  }

  if (/sponsor|visa/.test(label)) {
    if (/no|not|false/.test(desired)) return /^no\b|not require|do not|don't/.test(option);
    if (/yes|true|required|need/.test(desired)) return /^yes\b|require/.test(option);
  }

  if (/authorized|eligible|right to work|remote|work remotely|refer/.test(label)) {
    if (/yes|true|authorized|legally/.test(desired)) return /^yes\b|authorized|eligible|citizen/.test(option);
    if (/no|false/.test(desired)) return /^no\b/.test(option);
  }

  if (/relocat/.test(label)) {
    if (/yes|true|willing/.test(desired)) return /^yes\b|willing/.test(option);
    if (/no|false|not willing/.test(desired)) return /^no\b|not willing/.test(option);
  }

  if (/\bcountry\b/.test(label)) {
    if (/united states|\busa\b|\bus\b/.test(desired)) {
      return /^(?:united states(?: of america)?|usa|u s a|u s)(?: 1)?$/.test(option);
    }
    if (/canada/.test(desired)) return /canada/.test(option);
  }

  if (/\bstate\b|province/.test(label)) {
    const desiredState = normalizedStateAbbreviation(desired);
    const optionState = normalizedStateAbbreviation(option);
    if (desiredState && optionState) return desiredState === optionState;
  }

  if (isTechnologyExperienceLevelQuestion(fieldLabel)) {
    if (/no professional|none|no experience|0/.test(desired)) return /none|^no\b|no experience|0|n\/a/.test(option);
    if (/beginner|basic|limited|entry/.test(desired)) return /beginner|basic|limited|entry|some/.test(option);
    if (/intermediate|proficient|working/.test(desired)) return /intermediate|proficient|working|moderate|practical|2|3/.test(option);
    if (/advanced|advance|expert|extensive/.test(desired)) return /advanced|advance|expert|extensive|strong|5/.test(option);
  }

  if (/current age|age range|age group|\bage\b/.test(label)) {
    const numericAge = Number(String(answer).match(/\d+/)?.[0]);
    if (Number.isFinite(numericAge)) {
      if (numericAge < 30 && /under 30|younger than 30|18\s*-\s*29|21\s*-\s*29/.test(option)) return true;
      if (numericAge >= 30 && numericAge <= 39 && /30\s*-\s*39/.test(option)) return true;
      if (numericAge >= 40 && numericAge <= 49 && /40\s*-\s*49/.test(option)) return true;
      if (numericAge >= 50 && numericAge <= 59 && /50\s*-\s*59/.test(option)) return true;
      if (numericAge >= 60 && /60 or older|60\+/.test(option)) return true;
    }
  }

  if (/gender|sex\b/.test(label)) {
    if (/^male\b/.test(desired)) return /^male\b|^man\b/.test(option);
    if (/^female\b/.test(desired)) return /^female\b|^woman\b/.test(option);
  }

  if (/race|ethnic/.test(label)) {
    if (/hispanic|latino/.test(label) && /no|not hispanic|not latino/.test(desired)) return /^no\b|not hispanic|not latino/.test(option);
    if (/white/.test(desired)) return /white/.test(option);
    if (/prefer/.test(desired)) return /prefer not|decline/.test(option);
    if (/no|not hispanic/.test(desired)) return /^no\b|not hispanic|not latino/.test(option);
  }

  if (/veteran|military/.test(label)) {
    if (/no|not/.test(desired)) return /not.*veteran|not.*protected|no military|^no\b/.test(option);
  }

  if (/disab/.test(label)) {
    if (/no|not/.test(desired)) return /^no\b|do not have|don't have|not disabled/.test(option);
  }

  if (/hear about|source|job board/.test(label)) {
    if (/rolematch/.test(desired)) return /job board/.test(option);
    if (/company|career|website|posting/.test(desired)) return /company|career|website|posting|other/.test(option);
    return /linkedin|job board|other|indeed|company|career|website/.test(option);
  }

  if (wantsNo && /^no\b|^none\b|not applicable|n\/a/.test(option)) return true;
  if (wantsYes && !wantsNo && /^yes\b/.test(option)) return true;

  return option.includes(desired) || desired.includes(option);
}

function requiresVerifiedEducationOption(fieldLabel) {
  const label = normalize(fieldLabel);
  return /school|university|college|\bdegree\b|discipline|major|field of study|area of study/.test(label);
}

function dropdownCommitMatchesAnswer(value, answer, fieldLabel) {
  if (!requiresVerifiedEducationOption(fieldLabel)) return true;

  const committed = normalize(value);
  const desired = normalize(answer);
  const searchTerm = normalize(dropdownSearchTerm(answer, fieldLabel));
  if (committed && committed === searchTerm && committed !== desired) return false;

  return optionMatches(value, answer, fieldLabel);
}

function fillSelect(element, field, match) {
  const options = Array.from(element.options);
  const label = normalize(field.label);
  const selected = options.find((option) => optionMatches(option.textContent || '', match.answer, field.label))
    || (/gender|sex\b|race|ethnic|hispanic|latino|veteran|military|disab/.test(label)
      ? options.find((option) => /prefer not|decline/.test(normalize(option.textContent)))
      : null);

  if (!selected) return { filled: false, reason: 'no matching select option' };

  element.value = selected.value;
  element.setAttribute(ROLEMATCH_FILLED_ATTR, 'true');
  element.dispatchEvent(new Event('input', { bubbles: true }));
  element.dispatchEvent(new Event('change', { bubbles: true }));
  return { filled: true, value: selected.textContent?.trim() || selected.value };
}

async function fillRadio(element, field, match) {
  const group = radioGroupElements(element);
  const customGroup = element.getAttribute('role') === 'radio'
    ? element.closest?.('spl-radio-group, [role="radiogroup"]')
    : null;
  const customGroupId = customGroup?.id || '';
  const customGroupRoot = customGroup ? elementRoot(customGroup) : null;
  const currentRadioGroup = () => {
    if (customGroupId && customGroupRoot?.querySelector) {
      const liveGroup = customGroupRoot.querySelector(`#${CSS.escape(customGroupId)}`);
      const controls = Array.from(liveGroup?.querySelectorAll?.('[role="radio"], input[type="radio"]') || []);
      if (controls.length > 0) return controls;
    }
    return radioGroupElements(element);
  };
  const selected = group.find((radio) => optionMatches(radio.value || radio.getAttribute('value') || '', match.answer, field.label))
    || group.find((radio) => optionMatches(optionText(radio), match.answer, field.label));

  if (!selected) return { filled: false, reason: 'no matching radio option' };

  const nestedRadio = selected.getAttribute?.('role') === 'radio'
    ? selected.querySelector?.('input[type="radio"]')
    : null;
  const label = (nestedRadio?.id
    ? elementRoot(nestedRadio)?.querySelector?.(`label[for="${CSS.escape(nestedRadio.id)}"]`)
    : null)
    || (selected.id ? elementRoot(selected)?.querySelector?.(`label[for="${CSS.escape(selected.id)}"]`) : null);
  const control = label && typeof label.click === 'function'
    ? label
    : selected.getAttribute?.('role') === 'radio'
      ? selected
      : nestedRadio || selected;
  dispatchOptionSelection(control);
  await wait(260);

  if (selected.getAttribute?.('role') === 'radio') {
    group.forEach((choice) => {
      const selectedChoice = choice === selected;
      const input = choice.querySelector?.('input[type="radio"]');
      if (input) nativeSetChecked(input, selectedChoice);
      choice.setAttribute?.('aria-checked', selectedChoice ? 'true' : 'false');
    });
    await wait(180);
  }

  let currentGroup = currentRadioGroup();
  let currentSelected = currentGroup.find(choiceChecked);
  if (!currentSelected) {
    dispatchOptionSelection(selected);
    await wait(260);
    currentGroup = currentRadioGroup();
    currentSelected = currentGroup.find(choiceChecked);
  }
  if (!currentSelected) return { filled: false, reason: 'radio option did not stick' };

  currentSelected.setAttribute(ROLEMATCH_FILLED_ATTR, 'true');
  const selectedText = optionText(currentSelected).split('|')[0]?.trim();
  return { filled: true, value: selectedText || currentSelected.value || currentSelected.getAttribute('value') };
}

async function fillCheckbox(element, field, match) {
  if (element.checked) {
    element.setAttribute(ROLEMATCH_FILLED_ATTR, 'true');
    return { filled: true, value: optionText(element) || match.answer };
  }

  if (match.reason === 'required privacy notice acknowledgement') {
    dispatchOptionSelection(element);
    await wait(140);
    const currentElement = element.id ? elementByIdNear(element, element.id) || element : element;
    if (!currentElement.checked) return { filled: false, reason: 'privacy acknowledgement did not stick' };
    currentElement.setAttribute(ROLEMATCH_FILLED_ATTR, 'true');
    return { filled: true, value: 'Acknowledged' };
  }

  const yesNoButtons = checkboxYesNoButtons(element);
  if (yesNoButtons.length > 0) {
    const selected = yesNoButtons.find((button) => optionMatches(button.innerText || button.textContent || '', match.answer, field.label));
    if (!selected) return { filled: false, reason: 'no matching yes/no option' };
    dispatchOptionSelection(selected);
    await wait(120);

    const desiredChecked = /^yes$/i.test(compactText(selected.innerText || selected.textContent));
    let currentElement = element.id ? elementByIdNear(element, element.id) || element : element;
    // Ashby's visible buttons can update their styling without committing the
    // hidden checkbox that its form validator reads. Commit that value through
    // the native input setter so React receives the input/change events.
    nativeSetChecked(currentElement, desiredChecked);
    await wait(160);
    currentElement = element.id ? elementByIdNear(element, element.id) || currentElement : currentElement;
    if (Boolean(currentElement.checked) !== desiredChecked) {
      return { filled: false, reason: 'yes/no selection did not stick' };
    }

    currentElement.setAttribute(ROLEMATCH_FILLED_ATTR, 'true');
    return { filled: true, value: compactText(selected.innerText || selected.textContent) };
  }

  if (/currently work here/.test(normalize(field.label)) && /yes|true|current/.test(normalize(match.answer))) {
    const currentLabel = element.id ? elementRoot(element)?.querySelector?.(`label[for="${CSS.escape(element.id)}"]`) : null;
    dispatchOptionSelection(currentLabel || element);
    await wait(120);
    const currentElement = element.id ? elementByIdNear(element, element.id) || element : element;
    if (!currentElement.checked) return { filled: false, reason: 'checkbox selection did not stick' };
    currentElement.setAttribute(ROLEMATCH_FILLED_ATTR, 'true');
    return { filled: true, value: 'I currently work here' };
  }

  const option = optionText(element);
  if (!optionMatches(option, match.answer, field.label) && !normalize(option).includes(normalize(match.answer))) {
    return { filled: false, reason: 'checkbox option does not match answer' };
  }

  const label = element.id ? elementRoot(element)?.querySelector?.(`label[for="${CSS.escape(element.id)}"]`) : null;
  dispatchOptionSelection(label || element);
  await wait(120);

  let currentElement = element.id ? elementByIdNear(element, element.id) || element : element;
  if (!currentElement.checked && label) {
    dispatchOptionSelection(currentElement);
    await wait(120);
    currentElement = element.id ? elementByIdNear(element, element.id) || currentElement : currentElement;
  }
  if (!currentElement.checked) return { filled: false, reason: 'checkbox selection did not stick' };

  currentElement.setAttribute(ROLEMATCH_FILLED_ATTR, 'true');

  return { filled: true, value: option || match.answer };
}

function visibleOptions(element = null) {
  const controlledList = element?.getAttribute?.('aria-controls');
  const expectedList = element?.id ? `react-select-${element.id}-listbox` : '';
  const expectedPrefix = element?.id ? `react-select-${element.id}-option-` : '';
  const listId = controlledList || expectedList;
  const root = element ? elementRoot(element) : document;
  const optionSelector = '[role="option"], oj-option, .select__option, [data-automation-id="promptOption"], [data-automation-id="menuItem"], [role="menuitemradio"]';
  const scopedSelector = listId
    ? optionSelector.split(',').map((selector) => `#${CSS.escape(listId)} ${selector.trim()}`).join(', ')
    : '';
  const scopedOptions = listId
    ? deepQuerySelectorAll(scopedSelector, root)
    : [];
  const prefixedOptions = expectedPrefix
    ? deepQuerySelectorAll(optionSelector, root)
      .filter((option) => option.id?.startsWith(expectedPrefix))
    : [];

  const candidates = scopedOptions.length > 0
    ? scopedOptions
    : (prefixedOptions.length > 0
      ? prefixedOptions
        : deepQuerySelectorAll(optionSelector));

  return candidates
    .filter((element) => visible(element))
    .filter((element) => element.getAttribute?.('data-automation-id') !== 'selectedItem')
    .filter((element) => !/select|loading|no options/i.test(comboboxOptionText(element)));
}

function comboboxOptionText(element) {
  const selectOption = closestAcrossShadow(element, 'spl-select-option');
  const dropdownItem = closestAcrossShadow(element, 'spl-dropdown-item');
  const titledOption = selectOption?.querySelector?.('[title]')?.getAttribute?.('title')
    || dropdownItem?.querySelector?.('[title]')?.getAttribute?.('title');

  return uniqueParts([
    titledOption,
    element?.innerText,
    element?.textContent,
    selectOption?.innerText,
    selectOption?.textContent,
    dropdownItem?.innerText,
    dropdownItem?.textContent,
  ]).join(' | ');
}

function dispatchOptionSelection(element) {
  element.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
  const eventOptions = { bubbles: true, cancelable: true, view: window };
  if (detectAts() === 'Workday' && element.getAttribute?.('role') === 'option') {
    const nestedChoice = element.querySelector?.('input[type="checkbox"], input[type="radio"], [role="checkbox"], [role="radio"]');
    const target = nestedChoice || element;
    const checked = nestedChoice && ('checked' in nestedChoice
      ? nestedChoice.checked
      : nestedChoice.getAttribute?.('aria-checked') === 'true');
    if (checked) return;

    target.dispatchEvent?.(new MouseEvent('mouseover', eventOptions));
    target.dispatchEvent?.(new MouseEvent('mousemove', eventOptions));
    if (typeof PointerEvent === 'function') {
      target.dispatchEvent?.(new PointerEvent('pointerdown', eventOptions));
      target.dispatchEvent?.(new PointerEvent('pointerup', eventOptions));
    }
    target.dispatchEvent?.(new MouseEvent('mousedown', eventOptions));
    target.dispatchEvent?.(new MouseEvent('mouseup', eventOptions));
    target.click?.();
    return;
  }
  element.dispatchEvent(new MouseEvent('mouseover', eventOptions));
  element.dispatchEvent(new MouseEvent('mousemove', eventOptions));
  if (typeof PointerEvent === 'function') {
    element.dispatchEvent(new PointerEvent('pointerdown', eventOptions));
    element.dispatchEvent(new PointerEvent('pointerup', eventOptions));
  }
  element.dispatchEvent(new MouseEvent('mousedown', eventOptions));
  element.dispatchEvent(new MouseEvent('mouseup', eventOptions));
  if (typeof element.click === 'function') {
    element.click();
  } else {
    element.dispatchEvent(new MouseEvent('click', eventOptions));
  }
}

function dispatchComboboxKey(element, key) {
  const keyCodes = {
    ArrowDown: 40,
    Enter: 13,
    Escape: 27,
    Tab: 9,
  };
  const eventOptions = { bubbles: true, cancelable: true, key, code: key, view: window };
  ['keydown', 'keypress', 'keyup'].forEach((eventType) => {
    const event = new KeyboardEvent(eventType, eventOptions);
    const keyCode = keyCodes[key] ?? 0;
    Object.defineProperty(event, 'keyCode', { get: () => keyCode });
    Object.defineProperty(event, 'which', { get: () => keyCode });
    Object.defineProperty(event, 'charCode', { get: () => (eventType === 'keypress' ? keyCode : 0) });
    element.dispatchEvent(event);
  });
}

function dropdownSearchTerm(answer, fieldLabel) {
  const desired = normalize(answer);
  const label = normalize(fieldLabel);

  if (!desired) return '';
  const isEducationLevel = /\bdegree\b|highest.*education|education completed|education.*attained|level of education/.test(label);

  if (/school|university|college|institution/.test(label) && !isEducationLevel) {
    return distinctiveSchoolTerms(answer)[0]
      || answer.split(/\s+/).find((part) => part.length >= 4)
      || answer;
  }

  if (isEducationLevel) {
    if (/bachelor/.test(desired)) return 'bachelor';
    if (/master/.test(desired)) return 'master';
    if (/associate/.test(desired)) return 'associate';
  }

  if (/discipline|major|field of study|area of study/.test(label)) {
    if (/computer science/.test(desired)) return 'computer s';
    return answer.split(/\s+/).find((part) => part.length >= 4) || answer;
  }

  if (/security clearance|public trust clearance|hold.*clearance|active clearance/.test(label)) {
    if (/no|none|not|no current|no active/.test(desired)) return 'none';
  }

  if (/affirmation|i agree|acknowledge|certify|agree to the above|understand.*agree/.test(label)) return 'agree';
  if (/hear about|source|job board/.test(label)) return /rolematch/.test(desired) ? 'job' : 'company';
  if (/non[- ]disclosure|non[- ]compete|nda|restrictive agreement|worked at|worked for|current employer.*accenture|government|serving while|reserves|national guard|family member|close relationship/.test(label)) {
    if (/no|none|not|do not|don't/.test(desired)) return 'no';
  }

  if (isTechnologyExperienceLevelQuestion(fieldLabel)) {
    if (/advanced|advance|expert|extensive/.test(desired)) return 'advance';
    if (/intermediate|proficient|working/.test(desired)) return 'intermediate';
    if (/beginner|basic|limited|entry/.test(desired)) return 'basic';
    if (/no professional|none|no experience|0/.test(desired)) return 'none';
  }

  if (/disab/.test(label)) {
    if (/no|not|do not|don't/.test(desired)) return 'no';
    if (/prefer|decline/.test(desired)) return 'prefer';
    if (/yes|have|history|record/.test(desired)) return 'yes';
  }

  if (/veteran|military/.test(label)) {
    if (/not.*veteran|not.*protected|no|not|military service/.test(desired)) return 'not';
    if (/yes|protected|veteran/.test(desired)) return 'veteran';
  }

  if (/race|ethnic/.test(label)) {
    if (/white/.test(desired)) return 'white';
    if (/black|african/.test(desired)) return 'black';
    if (/asian/.test(desired)) return 'asian';
    if (/native|indigenous|alaska/.test(desired)) return 'native';
    if (/hawaiian|pacific/.test(desired)) return 'pacific';
    if (/prefer|decline/.test(desired)) return 'prefer';
  }

  if (/gender|sex\b/.test(label)) {
    if (/male/.test(desired)) return 'male';
    if (/female/.test(desired)) return 'female';
    if (/nonbinary|non binary/.test(desired)) return 'non';
    if (/prefer|decline/.test(desired)) return 'prefer';
  }

  if (/sponsor|visa|authorized|eligible|remote|work remotely|refer|relocat/.test(label)) {
    if (/yes|true|authorized|eligible|willing/.test(desired)) return 'yes';
    if (/no|false|not|do not|don't/.test(desired)) return 'no';
  }

  if (/which country.*work from|list your city and country|city and country/.test(label)) {
    return String(answer).split(',')[0]?.trim() || answer;
  }
  if (/\bcountry\b/.test(label)) return desired.includes('united states') ? 'united' : answer;

  return answer;
}

async function commitComboboxByKeyboard(element, field, answer) {
  const searchTerm = dropdownSearchTerm(answer, field.label);
  element.focus();
  dispatchOptionSelection(element);
  await wait(120);

  let selected = visibleOptions(element).find((option) => optionMatches(comboboxOptionText(option), answer, field.label));
  if (!selected) {
    nativeSetValue(element, searchTerm || answer, { blur: false });
    await wait(180);
    selected = visibleOptions(element).find((option) => optionMatches(comboboxOptionText(option), answer, field.label));
  }

  if (!selected) {
    dispatchComboboxKey(element, 'ArrowDown');
    await wait(120);
    selected = visibleOptions(element).find((option) => optionMatches(comboboxOptionText(option), answer, field.label));
  }

  if (!selected && visibleOptions(element).length === 1) {
    const onlyOption = visibleOptions(element)[0];
    if (dropdownCommitMatchesAnswer(comboboxOptionText(onlyOption), answer, field.label)) {
      selected = onlyOption;
    }
  }

  let optionValue = '';
  if (selected) {
    optionValue = compactText(comboboxOptionText(selected), 80);
    if (optionValue) {
      nativeSetValue(element, optionValue, { blur: false });
      await wait(120);
      selected = visibleOptions(element).find((option) => optionMatches(comboboxOptionText(option), optionValue, field.label))
        || visibleOptions(element).find((option) => optionMatches(comboboxOptionText(option), answer, field.label))
        || selected;
    }
  }

  if (selected) {
    dispatchOptionSelection(selected);
    await wait(260);
    const current = element.id ? elementByIdNear(element, element.id) || element : element;
    const clickedValue = selectedComboboxText(current) || fieldValue(current);
    if (clickedValue) return clickedValue;
  }

  element.focus();
  dispatchOptionSelection(element);
  await wait(100);
  if (optionValue) {
    nativeSetValue(element, optionValue, { blur: false });
    await wait(120);
  } else if (searchTerm) {
    nativeSetValue(element, searchTerm, { blur: false });
    await wait(120);
  }
  dispatchComboboxKey(element, 'ArrowDown');
  await wait(80);
  dispatchComboboxKey(element, 'Enter');
  element.dispatchEvent(new Event('change', { bubbles: true }));
  await wait(260);

  let current = element.id ? elementByIdNear(element, element.id) || element : element;
  let committedValue = selectedComboboxText(current) || fieldValue(current);
  if (!committedValue && selected) {
    dispatchOptionSelection(selected);
    await wait(220);
    current = element.id ? elementByIdNear(element, element.id) || element : element;
    committedValue = selectedComboboxText(current) || fieldValue(current);
  }

  if (!committedValue && isReactSelectInput(element) && !isLocationAutocomplete(element)) {
    nativeSetValue(element, '', { blur: false });
    dispatchComboboxKey(element, 'Escape');
  }

  return committedValue;
}

async function commitWorkdaySourceCombobox(element, field, answer) {
  element.focus();
  dispatchOptionSelection(element);
  await wait(220);

  const sourceText = (option) => compactText(option?.textContent || '', 120)
    .replace(/\s+not checked$/i, '')
    .trim();
  const preferredLeaf = (options) => {
    const priorities = [
      /^corporate website$/i,
      /^company (?:career|careers|job|jobs|employment) (?:page|site|website)$/i,
      /^career section$/i,
      /^careers page$/i,
      /^employment website$/i,
      /^company website$/i,
      /^[\w.-]+\.com$/i,
      /^other$/i,
    ];
    for (const pattern of priorities) {
      const match = options.find((option) => pattern.test(sourceText(option)));
      if (match) return match;
    }
    return null;
  };
  const preferredCategory = (options) => {
    const priorities = [
      /^website$/i,
      /^job board$/i,
      /^workday$/i,
      /^other$/i,
    ];
    for (const pattern of priorities) {
      const match = options.find((option) => pattern.test(sourceText(option)));
      if (match) return match;
    }
    return options.find((option) => optionMatches(sourceText(option), answer, field.label)) || null;
  };
  const waitForLeaf = async (excludedText = '') => {
    for (let attempt = 0; attempt < 12; attempt += 1) {
      const options = visibleOptions(element)
        .filter((option) => normalize(sourceText(option)) !== normalize(excludedText));
      const leaf = preferredLeaf(options);
      if (leaf) return leaf;
      await wait(120);
    }
    return null;
  };
  const commitByKeyboard = async (terms) => {
    for (const term of terms) {
      element.focus();
      dispatchOptionSelection(element);
      nativeSetValue(element, term, { blur: false });
      await wait(420);
      dispatchComboboxKey(element, 'ArrowDown');
      await wait(100);
      dispatchComboboxKey(element, 'Enter');
      element.dispatchEvent(new Event('change', { bubbles: true }));
      await wait(460);

      const committed = fieldValue(element);
      if (committed) return committed;
    }
    return '';
  };

  let initialOptions = [];
  for (let attempt = 0; attempt < 12 && initialOptions.length === 0; attempt += 1) {
    initialOptions = visibleOptions(element);
    if (initialOptions.length === 0) {
      if (attempt === 3) {
        dispatchOptionSelection(element);
        dispatchComboboxKey(element, 'ArrowDown');
      }
      await wait(120);
    }
  }
  const direct = preferredLeaf(initialOptions);
  if (direct) {
    const directText = sourceText(direct);
    dispatchOptionSelection(direct);
    await wait(320);

    const secondary = await waitForLeaf(directText);
    if (secondary) {
      dispatchOptionSelection(secondary);
      await wait(320);
    }

    return fieldValue(element) || sourceText(secondary) || directText;
  }

  const primary = preferredCategory(initialOptions);
  if (!primary) return commitByKeyboard(['website', 'company careers page']);

  const primaryText = sourceText(primary);
  dispatchOptionSelection(primary);
  await wait(320);

  const secondary = await waitForLeaf(primaryText);
  if (!secondary) {
    return fieldValue(element) || commitByKeyboard(['workday.com', 'company careers page']);
  }

  dispatchOptionSelection(secondary);
  await wait(320);
  return fieldValue(element) || sourceText(secondary);
}

async function commitWorkdaySchoolCombobox(element, field, answer) {
  element.focus();
  element.click();
  nativeSetValue(element, answer, { blur: false });
  await wait(300);

  const exact = visibleOptions(element).find((option) => normalize(option.textContent) === normalize(answer));
  if (exact) {
    dispatchOptionSelection(exact);
    await wait(280);
  } else {
    dispatchComboboxKey(element, 'Enter');
    await wait(320);
  }

  return fieldValue(document.getElementById(element.id) || element);
}

async function commitWorkdayFieldOfStudyCombobox(element, field, answer) {
  element.focus();
  element.click();
  await wait(220);

  const allOption = visibleOptions(element).find((option) => normalize(option.textContent) === 'all');
  if (allOption) {
    dispatchOptionSelection(allOption);
    await wait(420);
  }

  const current = document.getElementById(element.id) || element;
  current.focus();
  current.click();
  await wait(220);
  nativeSetValue(current, answer, { blur: false });
  await wait(180);
  dispatchComboboxKey(current, 'Enter');
  await wait(420);

  let exact = null;
  for (let attempt = 0; attempt < 12 && !exact; attempt += 1) {
    const options = visibleOptions(current);
    exact = options.find((option) => normalize(option.textContent) === normalize(answer));
    if (!exact && attempt === 5) dispatchComboboxKey(current, 'Enter');
    if (!exact) await wait(180);
  }
  if (!exact) {
    const educationPrefix = String(current.id || '').replace(/--fieldOfStudy.*$/i, '');
    const degreeElement = educationPrefix
      ? document.getElementById(`${educationPrefix}--degree`)
      : null;
    const degreeHint = normalize(
      degreeElement?.getAttribute?.('aria-label')
        || degreeElement?.innerText
        || degreeElement?.textContent
        || '',
    );
    const degreeTerms = ['bachelor', 'master', 'associate', 'doctor'];
    const preferredDegree = degreeTerms.find((term) => degreeHint.includes(term)) || '';
    const options = visibleOptions(current);
    exact = options
      .filter((option) => optionMatches(option.textContent || '', answer, field.label))
      .sort((first, second) => {
        const firstText = normalize(first.textContent);
        const secondText = normalize(second.textContent);
        const firstDegreeMatch = preferredDegree && firstText.includes(preferredDegree) ? 1 : 0;
        const secondDegreeMatch = preferredDegree && secondText.includes(preferredDegree) ? 1 : 0;
        if (firstDegreeMatch !== secondDegreeMatch) return secondDegreeMatch - firstDegreeMatch;
        const firstMenuRow = first.getAttribute?.('data-automation-id') === 'menuItem' ? 1 : 0;
        const secondMenuRow = second.getAttribute?.('data-automation-id') === 'menuItem' ? 1 : 0;
        if (firstMenuRow !== secondMenuRow) return secondMenuRow - firstMenuRow;
        return compactText(first.textContent || '').length - compactText(second.textContent || '').length;
      })[0] || null;
  }
  if (!exact) return '';

  const selectable = exact.closest?.('[data-automation-id="menuItem"]') || exact;
  dispatchOptionSelection(selectable);
  for (let attempt = 0; attempt < 12; attempt += 1) {
    await wait(180);
    const refreshed = document.getElementById(element.id) || current;
    const value = fieldValue(refreshed);
    if (value) return value;
  }
  return '';
}

function workdaySkillOption(options, answer) {
  const desiredIdentity = compactText(answer, 180).toLowerCase();
  const desired = normalize(answer);
  if (!desired) return null;

  const available = options.filter((option) => {
    const choice = option.querySelector?.('input[type="checkbox"], [role="checkbox"]');
    return !choice || !('checked' in choice) || !choice.checked;
  });
  const exactIdentity = available.find((option) => compactText(option.textContent, 180).toLowerCase() === desiredIdentity);
  if (exactIdentity) return exactIdentity;

  const symbolicAliases = {
    'c++': ['c++ programming language'],
    'c#': ['c#'],
    c: ['c (programming language)'],
    css: ['cascading style sheets (css)'],
    html: ['hyper text markup language (html)'],
    javascript: ['java script', 'ecmascript'],
    sql: ['structured query language (sql)'],
  };
  const symbolicAlias = available.find((option) => (
    symbolicAliases[desiredIdentity] || []
  ).includes(compactText(option.textContent, 180).toLowerCase()));
  if (symbolicAlias) return symbolicAlias;

  const exact = available.find((option) => normalize(option.textContent) === desired);
  if (exact) return exact;

  const aliases = {
    css: ['cascading style sheets css'],
    html: ['hyper text markup language html'],
    javascript: ['java script', 'ecmascript'],
    sql: ['structured query language sql'],
  };
  const alias = available.find((option) => (aliases[desired] || []).includes(normalize(option.textContent)));
  if (alias) return alias;

  if (desired.length <= 4) return null;
  const tokenPattern = new RegExp(`(^|\\s)${escapeRegExp(desired)}(\\s|$)`);
  const tokenMatches = available
    .filter((option) => tokenPattern.test(normalize(option.textContent)))
    .sort((left, right) => normalize(left.textContent).length - normalize(right.textContent).length);
  return tokenMatches[0]
    || available.find((option) => optionMatches(option.textContent || '', answer, 'skills'))
    || null;
}

async function commitWorkdaySkillCombobox(element, field, answer, beforeCount) {
  let current = document.getElementById(element.id) || element;
  current.focus();
  current.click();
  await wait(160);
  nativeSetValue(current, answer, { blur: false });
  await wait(220);

  dispatchComboboxKey(current, 'Enter');
  let selected = null;
  for (let attempt = 0; attempt < 6 && !selected; attempt += 1) {
    selected = workdaySkillOption(visibleOptions(current), answer);
    if (!selected) await wait(120);
  }
  if (!selected) return false;

  dispatchOptionSelection(selected);
  for (let attempt = 0; attempt < 6; attempt += 1) {
    await wait(100);
    current = document.getElementById(element.id) || current;
    if (workdaySelectedItemCount(current) > beforeCount) return true;
  }
  return false;
}

function workdaySelectedItemCount(element) {
  const group = element.closest?.('[role="group"]');
  const selectedItems = group?.querySelectorAll?.('[data-automation-id="selectedItem"]') || [];
  if (selectedItems.length > 0) return selectedItems.length;

  const text = compactText(
    group?.innerText
      || group?.textContent
      || element.parentElement?.innerText
      || element.parentElement?.textContent
      || '',
    220,
  );
  const count = text.match(/(\d+) items? selected/i);
  return count ? Number(count[1]) : 0;
}

async function fillWorkdaySkills(element, field, match) {
  const targetCount = 6;
  const answers = uniqueParts(match.answers?.length ? match.answers : [match.answer]).slice(0, 10);
  const selected = [];
  let current = element;
  const existingCount = workdaySelectedItemCount(current);
  if (existingCount >= 5) {
    current.setAttribute(ROLEMATCH_FILLED_ATTR, 'true');
    return {
      filled: true,
      value: `${existingCount} skills already selected`,
      reason: 'Workday already has enough selected skills',
    };
  }

  for (const answer of answers) {
    current = document.getElementById(element.id) || current;
    const beforeCount = workdaySelectedItemCount(current);
    const committed = await commitWorkdaySkillCombobox(current, field, answer, beforeCount);
    current = document.getElementById(element.id) || current;
    const afterCount = workdaySelectedItemCount(current);
    if (committed && afterCount > beforeCount) selected.push(answer);
    current = document.getElementById(element.id) || current;
    nativeSetValue(current, '', { blur: false });
    dispatchComboboxKey(current, 'Escape');
    current.blur?.();
    if (afterCount >= targetCount) break;
  }

  if (selected.length === 0) return { filled: false, reason: 'no Workday skill options matched' };
  current = document.getElementById(element.id) || current;
  nativeSetValue(current, '', { blur: false });
  dispatchComboboxKey(current, 'Escape');
  current.blur?.();
  await wait(220);
  current = document.getElementById(element.id) || current;
  dispatchComboboxKey(current, 'Escape');
  current.blur?.();
  current.setAttribute(ROLEMATCH_FILLED_ATTR, 'true');
  return { filled: true, value: selected.join(', ') };
}

async function commitDropdownButton(element, field, answer) {
  element.focus();
  dispatchOptionSelection(element);
  await wait(220);

  let selected = null;
  let current = element.id ? document.getElementById(element.id) || element : element;
  for (let attempt = 0; attempt < 10 && !selected; attempt += 1) {
    current = element.id ? document.getElementById(element.id) || current : current;
    selected = visibleOptions(current).find((option) => optionMatches(option.textContent || '', answer, field.label));
    if (!selected) await wait(120);
  }
  if (!selected) {
    const searchTerm = dropdownSearchTerm(answer, field.label);
    selected = visibleOptions(current).find((option) => optionMatches(option.textContent || '', searchTerm, field.label));
  }
  if (!selected && visibleOptions(current).length === 1) {
    const onlyOption = visibleOptions(current)[0];
    if (dropdownCommitMatchesAnswer(comboboxOptionText(onlyOption), answer, field.label)) {
      selected = onlyOption;
    }
  }

  if (!selected) return '';

  const selectedText = compactText(selected.textContent || '', 90);
  dispatchOptionSelection(selected);
  await wait(260);
  current = element.id ? document.getElementById(element.id) || current : current;
  const buttonValue = fieldValue(current);
  return buttonValue && !/^select|choose/i.test(buttonValue) ? buttonValue : selectedText;
}

async function fillCombobox(element, field, match) {
  const answer = String(match.answer ?? '').trim();
  if (!answer) return { filled: false, reason: 'profile value empty' };
  if (answer.length > 90) return { filled: false, reason: 'answer is too long for dropdown' };

  element.scrollIntoView({ block: 'center', inline: 'nearest' });
  const workdaySourceField = detectAts() === 'Workday'
    && /hear about|source|job board/.test(normalize(field.label));
  let finalValue = workdaySourceField || isWorkdaySearchCombobox(element)
    ? await commitWorkdaySourceCombobox(element, field, answer)
    : (isWorkdaySchoolSearch(element)
      ? await commitWorkdaySchoolCombobox(element, field, answer)
      : (isWorkdayFieldOfStudySearch(element)
        ? await commitWorkdayFieldOfStudyCombobox(element, field, answer)
        : (element.tagName === 'BUTTON'
          ? await commitDropdownButton(element, field, answer)
          : await commitComboboxByKeyboard(element, field, answer))));
  if (!finalValue && isLocationAutocomplete(element) && String(element.value ?? '').trim()) {
    finalValue = String(element.value).trim();
  }
  if (!finalValue && isLocationAutocomplete(element)) {
    for (let attempt = 0; attempt < 30; attempt += 1) {
      await wait(200);
      const locationValue = String(element.value ?? '').trim();
      if (locationValue) {
        finalValue = locationValue;
        break;
      }
    }
  }

  if (!finalValue) {
    const selected = visibleOptions(element).find((option) => optionMatches(comboboxOptionText(option), answer, field.label));
    if (!selected) {
      if (isLocationAutocomplete(element)) {
        const locationValue = String(element.value ?? '').trim();
        if (locationValue) {
          finalValue = locationValue;
        }
      }
      if (!finalValue) return { filled: false, reason: 'no matching dropdown option' };
    }

    if (selected) {
      dispatchOptionSelection(selected);
      await wait(260);
      const current = element.id ? elementByIdNear(element, element.id) || element : element;
      finalValue = fieldValue(current);
    }
  }

  if (!finalValue) return { filled: false, reason: 'dropdown value did not stick' };
  if (!dropdownCommitMatchesAnswer(finalValue, answer, field.label)) {
    if (['INPUT', 'TEXTAREA'].includes(element.tagName)) {
      nativeSetValue(element, '', { blur: false });
      dispatchComboboxKey(element, 'Escape');
    }
    return { filled: false, reason: 'dropdown selection did not match profile answer' };
  }

  element.setAttribute(ROLEMATCH_FILLED_ATTR, 'true');
  element.dispatchEvent(new Event('input', { bubbles: true }));
  element.dispatchEvent(new Event('change', { bubbles: true }));

  return { filled: true, value: finalValue };
}

function base64ToBlob(base64, mimeType) {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return new Blob([bytes], { type: mimeType || 'application/octet-stream' });
}

async function fillFileInput(element, match) {
  if (!match.file?.fileUrl) return { filled: false, reason: 'no profile file selected' };

  if (state.ats === 'Workday') {
    const fileName = normalize(match.file.fileName || '');
    let container = element;
    for (let level = 0; container && level < 6; level += 1, container = container.parentElement) {
      if (container.getAttribute?.('data-automation-id') !== 'attachments-FileUpload') continue;
      const uploadedText = normalize(container.innerText || container.textContent || '');
      if (fileName && uploadedText.includes(fileName)) {
        element.setAttribute(ROLEMATCH_FILLED_ATTR, 'true');
        return { filled: true, value: match.file.fileName, reason: 'matching Workday file already uploaded' };
      }
      break;
    }
  }

  const response = await sendMessage({
    type: 'ROLEMATCH_FETCH_PROFILE_FILE',
    file: match.file,
  }).catch((error) => ({ ok: false, error: error instanceof Error ? error.message : String(error) }));

  if (!response?.ok || !response.file?.base64) {
    return { filled: false, reason: response?.error || 'unable to fetch profile file' };
  }

  const blob = base64ToBlob(response.file.base64, response.file.mimeType);
  const file = new File([blob], response.file.fileName || match.file.fileName || 'resume', {
    type: response.file.mimeType || blob.type,
  });
  const dataTransfer = new DataTransfer();
  dataTransfer.items.add(file);
  element.files = dataTransfer.files;
  element.setAttribute(ROLEMATCH_FILLED_ATTR, 'true');
  element.dispatchEvent(new Event('input', { bubbles: true }));
  element.dispatchEvent(new Event('change', { bubbles: true }));

  return { filled: true, value: file.name };
}

async function fillTextElement(element, match) {
  if (!match.answer) return { filled: false, reason: 'profile value empty' };

  if (element.isContentEditable) {
    element.textContent = match.answer;
    element.setAttribute(ROLEMATCH_FILLED_ATTR, 'true');
    element.dispatchEvent(new Event('input', { bubbles: true }));
    element.dispatchEvent(new Event('change', { bubbles: true }));
    return { filled: true, value: match.answer };
  }

  if (state.ats === 'Workday' && element.tagName === 'TEXTAREA' && /^workExperience-\d+--roleDescription$/i.test(String(element.id || ''))) {
    element.focus?.();
    nativeSetValue(element, match.answer, { blur: false });
    await wait(100);
    const current = document.getElementById(element.id) || element;
    current.dispatchEvent(new Event('change', { bubbles: true }));
    current.blur?.();
    current.setAttribute(ROLEMATCH_FILLED_ATTR, 'true');
    await wait(100);
  } else {
    nativeSetValue(element, match.answer);
    element.setAttribute(ROLEMATCH_FILLED_ATTR, 'true');
    await wait(100);
  }

  if (!fieldValue(element)) {
    return { filled: false, reason: 'field cleared the value after fill' };
  }

  return { filled: true, value: match.answer };
}

async function fillField(field, match) {
  await waitUntilResumed();
  const element = field.element;
  const type = field.type;

  if (match.action === 'file') return fillFileInput(element, match);
  if (match.action !== 'fill') return { filled: false, reason: match.reason };
  if (type === 'file') return { filled: false, reason: 'file upload skipped' };
  if (type === 'checkbox') return fillCheckbox(element, field, match);
  if (type === 'radio') return fillRadio(element, field, match);
  if (element.tagName === 'SELECT') return fillSelect(element, field, match);
  if (isWorkdayDateSegment(element)) return fillWorkdayDateSegment(element, match);
  if (type === 'combobox' && isWorkdaySkillsSearch(element)) return fillWorkdaySkills(element, field, match);
  if (type === 'combobox') return fillCombobox(element, field, match);

  return fillTextElement(element, match);
}

function scanFields(profile = state.profile, job = state.job) {
  const fields = collectFields().map((field) => {
    const match = answerForField(field, profile, job);
    const sensitive = field.type === 'password' || /\bpassword\b|\bpasscode\b|\baccount pin\b/.test(normalize(field.label));
    return {
      id: field.id,
      type: field.type,
      label: displayFieldLabel(field.label).slice(0, 260),
      required: field.required,
      hasValue: Boolean(String(field.value ?? '').trim()),
      value: sensitive && field.value ? 'Password saved' : field.value ? String(field.value).slice(0, 180) : '',
      action: match.action,
      answer: sensitive ? '' : match.answer ? String(match.answer).slice(0, 180) : '',
      reason: match.reason,
    };
  });

  const matched = fields.filter((field) => ['fill', 'file'].includes(field.action) && field.answer).length;
  const manual = fields.filter((field) => field.action === 'skip').length;
  state.lastScan = {
    ats: state.ats,
    url: window.location.href,
    total: fields.length,
    matched,
    manual,
    fields,
  };
  return state.lastScan;
}

async function openApplicationForm() {
  await waitUntilResumed();
  let clicked = false;

  for (let step = 0; step < 3; step += 1) {
    const beforeCount = collectFields().length;
    const candidates = deepQuerySelectorAll('a, button, input[type="button"], input[type="submit"], [role="button"], ukg-button')
      .filter((element) => visible(element))
      .map((element) => ({
        element,
        text: normalize([
          element.innerText,
          element.textContent,
          element.value,
          element.getAttribute('aria-label'),
          element.getAttribute('data-automation'),
          element.getAttribute('test-id'),
        ].filter(Boolean).join(' ')),
      }))
      .filter(({ text }) => {
        if (!text) return false;
        if (/submit|submitted|already applied|application submitted|save|share|consent|privacy|sign in|log in|create account|register/.test(text)) return false;
        if (/apply with (?:linkedin|indeed)|social apply/.test(text)) return false;
        return /^apply\b|apply for this job|apply now|apply manually|apply without an account|apply as guest|continue as guest|start application|start your application|begin application/.test(text);
      })
      .sort((first, second) => {
        const priority = (candidate) => (/without an account|as guest|continue as guest/.test(candidate.text) ? 2 : 1);
        return priority(second) - priority(first);
      });

    if (!candidates[0]) break;
    candidates[0].element.click();
    clicked = true;
    await waitForFormChange(beforeCount);
    await wait(250);
    if (collectFields().length > beforeCount) break;
  }

  return { ok: true, clicked };
}

async function wait(ms) {
  await waitUntilResumed();
  await new Promise((resolve) => window.setTimeout(resolve, ms));
  await waitUntilResumed();
}

async function waitForFormChange(beforeCount) {
  for (let index = 0; index < 12; index += 1) {
    await wait(350);
    if (collectFields().length > beforeCount) return true;
    const guestEntryAvailable = deepQuerySelectorAll('a, button, input[type="button"], [role="button"]')
      .some((element) => /apply without an account|apply as guest|continue as guest/i.test(
        element.innerText || element.textContent || element.value || element.getAttribute('aria-label') || '',
      ));
    if (guestEntryAvailable) return true;
  }
  return false;
}

function fieldAttemptKey(field) {
  const stableLabel = normalize([
    field.type,
    field.label,
    field.element.getAttribute('name'),
    field.element.id,
  ].filter(Boolean).join(' | '));
  return stableLabel || field.id;
}

function hasMeaningfulValue(field) {
  if (field.type === 'radio' || field.type === 'checkbox') return Boolean(field.element.checked);
  if (field.type === 'file') return Boolean(field.element.files?.length);
  const value = String(field.value ?? '').trim();
  if (!value) return false;
  if (field.type === 'tel' && value.replace(/\D/g, '').length <= 4) return false;
  if (/^select(\.\.\.)?$|select one|^choose\b|please select|loading|no options|^0 items? selected/i.test(value)) return false;
  return true;
}

function answersEquivalent(actual, expected) {
  const actualText = String(actual ?? '').trim();
  const expectedText = String(expected ?? '').trim();
  if (!actualText || !expectedText) return false;
  if (normalize(actualText) === normalize(expectedText)) return true;

  const actualDigits = actualText.replace(/\D/g, '');
  const expectedDigits = expectedText.replace(/\D/g, '');
  if (actualDigits.length >= 7 && expectedDigits.length >= 7 && actualDigits === expectedDigits) return true;

  return normalize(actualText.replace(/^https?:\/\//i, '').replace(/\/$/, ''))
    === normalize(expectedText.replace(/^https?:\/\//i, '').replace(/\/$/, ''));
}

async function waitForResumeParser() {
  await wait(1200);
  let previousSignature = '';
  let stableChecks = 0;

  for (let index = 0; index < 10; index += 1) {
    const signature = collectFields()
      .map((field) => `${fieldAttemptKey(field)}=${normalize(field.value)}`)
      .join('||');
    stableChecks = signature === previousSignature ? stableChecks + 1 : 0;
    previousSignature = signature;
    if (stableChecks >= 2) return;
    await wait(250);
  }
}

async function ensureProfileLoaded(profile = state.profile) {
  if (profile) return profile;
  state.status = 'Loading RoleMatch profile';
  renderPanel();

  const profileResponse = await sendMessage({ type: 'ROLEMATCH_GET_PROFILE' }).catch((error) => ({
    ok: false,
    error: error instanceof Error ? error.message : String(error),
  }));

  if (profileResponse?.ok && profileResponse.profile) {
    state.profile = profileResponse.profile;
    return state.profile;
  }

  throw new Error(profileResponse?.error || 'Unable to load RoleMatch profile before filling.');
}

function workdaySectionGroup(sectionName) {
  return Array.from(document.querySelectorAll('[role="group"]')).find((group) => {
    const heading = group.querySelector('h4');
    return normalize(heading?.textContent) === normalize(sectionName);
  }) || null;
}

function workdaySectionEntryCount(section, sectionName) {
  return Array.from(section?.querySelectorAll('h5') || [])
    .filter((heading) => normalize(heading.textContent).startsWith(normalize(`${sectionName} `)))
    .length;
}

async function ensureWorkdaySectionEntries(sectionName, desiredCount) {
  if (desiredCount <= 0) return;

  for (let attempt = 0; attempt < desiredCount + 2; attempt += 1) {
    await waitUntilResumed();
    const section = workdaySectionGroup(sectionName);
    if (!section) return;
    const currentCount = workdaySectionEntryCount(section, sectionName);
    if (currentCount >= desiredCount) return;

    const buttonText = currentCount === 0 ? 'add' : 'add another';
    const addButton = Array.from(section.querySelectorAll('button'))
      .find((button) => normalize(button.textContent) === buttonText && visible(button));
    if (!addButton) return;

    addButton.click();
    let rendered = false;
    for (let waitAttempt = 0; waitAttempt < 20; waitAttempt += 1) {
      await wait(150);
      const refreshedSection = workdaySectionGroup(sectionName);
      if (workdaySectionEntryCount(refreshedSection, sectionName) > currentCount) {
        rendered = true;
        break;
      }
    }
    if (!rendered) return;
  }
}

async function prepareWorkdayExperienceSections(profile) {
  if (detectAts() !== 'Workday') return;

  const workCount = (profile?.workHistory ?? [])
    .filter((entry) => entry?.company || entry?.title)
    .slice(0, 5).length;
  const educationCount = (profile?.educationHistory ?? [])
    .filter((entry) => entry?.school || entry?.degree)
    .slice(0, 3).length;

  await ensureWorkdaySectionEntries('Work Experience', workCount);
  await ensureWorkdaySectionEntries('Education', educationCount);
}

function workableSectionButton(sectionName) {
  const expected = normalize(`Add ${sectionName}`);
  return deepQuerySelectorAll('button').find((button) => (
    normalize(button.getAttribute('aria-label')) === expected
  )) || null;
}

function workableSectionContainer(sectionName) {
  const button = workableSectionButton(sectionName);
  return button?.parentElement?.parentElement || null;
}

function workableEditor(section) {
  return Array.from(section?.querySelectorAll?.('li') || []).find((entry) => (
    Array.from(entry.querySelectorAll?.('button') || [])
      .some((button) => normalize(button.innerText || button.textContent) === 'update')
  )) || null;
}

function workableSavedEntryCount(section) {
  return Array.from(section?.querySelectorAll?.('li') || [])
    .filter((entry) => (
      !Array.from(entry.querySelectorAll?.('button') || [])
        .some((button) => normalize(button.innerText || button.textContent) === 'update')
    ))
    .length;
}

function monthYearAnswer(value) {
  const parts = profileDateParts(value);
  return parts.year && parts.month
    ? `${String(parts.month).padStart(2, '0')}/${parts.year}`
    : '';
}

function workableEntryValues(sectionName, entry) {
  if (sectionName === 'Education') {
    return {
      school: entry.school || '',
      field_of_study: primaryEducationField(entry.field || entry.discipline),
      degree: entry.degree || '',
      start_date: monthYearAnswer(entry.startDate),
      end_date: monthYearAnswer(entry.endDate),
    };
  }

  return {
    title: entry.title || '',
    company: entry.company || '',
    industry: entry.industry || '',
    summary: (entry.highlights ?? []).filter(Boolean).join('\n'),
    start_date: monthYearAnswer(entry.startDate),
    end_date: entry.current ? '' : monthYearAnswer(entry.endDate),
    currently_work_here: Boolean(entry.current),
  };
}

async function fillWorkableEditor(sectionName, editor, entry) {
  const values = workableEntryValues(sectionName, entry);
  const fields = Array.from(editor.querySelectorAll('input:not([type="hidden"]), textarea'));

  for (const element of fields) {
    await waitUntilResumed();
    const name = String(element.getAttribute('name') || element.id || '').toLowerCase();
    const type = fieldType(element).toLowerCase();
    if (type === 'checkbox' && /currently/.test(normalize(getLabelText(element)))) {
      if (values.currently_work_here && !element.checked) {
        await fillCheckbox(
          element,
          { element, type, label: getLabelText(element) },
          { action: 'fill', answer: 'Yes', reason: 'current work-history entry' },
        );
      }
      continue;
    }

    const answer = values[name];
    if (!answer) continue;
    await fillTextElement(element, { action: 'fill', answer, reason: `Workable ${sectionName.toLowerCase()} entry` });
  }

  const requiredName = sectionName === 'Education' ? 'school' : 'title';
  const requiredField = editor.querySelector(`[name="${requiredName}"]`);
  return Boolean(requiredField && String(requiredField.value || '').trim());
}

async function ensureWorkableEntries(sectionName, entries) {
  const desiredEntries = entries.filter((entry) => (
    sectionName === 'Education'
      ? entry?.school || entry?.degree
      : entry?.company || entry?.title
  ));
  if (desiredEntries.length === 0) return;

  let section = workableSectionContainer(sectionName);
  if (!section) return;
  const existingCount = workableSavedEntryCount(section);

  for (let index = existingCount; index < desiredEntries.length; index += 1) {
    await waitUntilResumed();
    const addButton = workableSectionButton(sectionName);
    if (!addButton || addButton.disabled) return;
    dispatchOptionSelection(addButton);

    let editor = null;
    for (let attempt = 0; attempt < 20 && !editor; attempt += 1) {
      await wait(120);
      section = workableSectionContainer(sectionName);
      editor = workableEditor(section);
    }
    if (!editor) return;

    const readyToSave = await fillWorkableEditor(sectionName, editor, desiredEntries[index]);
    const buttons = Array.from(editor.querySelectorAll('button'));
    const updateButton = buttons.find((button) => normalize(button.innerText || button.textContent) === 'update');
    const cancelButton = buttons.find((button) => normalize(button.innerText || button.textContent) === 'cancel');
    if (!readyToSave || !updateButton || updateButton.disabled) {
      cancelButton?.click?.();
      return;
    }

    dispatchOptionSelection(updateButton);
    for (let attempt = 0; attempt < 20; attempt += 1) {
      await wait(120);
      section = workableSectionContainer(sectionName);
      if (!workableEditor(section)) break;
    }
  }
}

async function prepareWorkableProfileSections(profile) {
  if (detectAts() !== 'Workable') return;
  await ensureWorkableEntries('Education', (profile?.educationHistory ?? []).slice(0, 2));
  await ensureWorkableEntries('Experience', (profile?.workHistory ?? []).slice(0, 3));
}

async function fillVisibleFields(profile = state.profile, job = state.job) {
  state.filling = true;
  state.autoSubmitAttempted = false;
  state.submissionReadiness = null;
  state.status = state.paused ? 'Autofill paused. Resume to continue.' : 'Filling visible fields';
  renderPanel();

  await waitUntilResumed();

  try {
    profile = await ensureProfileLoaded(profile);
  } catch (error) {
    state.filling = false;
    state.status = error instanceof Error ? error.message : 'Unable to load RoleMatch profile before filling.';
    renderPanel();
    return { ok: false, error: state.status };
  }

  const storedCredentialFill = await fillStoredCredentialFieldsForVisibleLogin();

  await waitUntilResumed();
  await prepareWorkdayExperienceSections(profile);
  await prepareWorkableProfileSections(profile);

  const results = [];
  const completedKeys = new Set();
  const skippedKeys = new Set();
  const initialFields = collectFields();
  const initialValues = new Map(
    initialFields
      .filter((field) => field.type !== 'file')
      .map((field) => [fieldAttemptKey(field), String(field.value ?? '')]),
  );
  let resumeParserRan = false;

  for (const field of initialFields.filter((candidate) => candidate.type === 'file')) {
    await waitUntilResumed();
    const key = fieldAttemptKey(field);
    const match = answerForField(field, profile, job);
    if (hasMeaningfulValue(field)) {
      skippedKeys.add(key);
      results.push({
        id: field.id,
        key,
        type: field.type,
        pass: 1,
        label: displayFieldLabel(field.label).slice(0, 140),
        filled: false,
        value: safeFillResultValue(field),
        reason: 'already had a value',
        match,
      });
      continue;
    }

    const result = await fillField(field, match);
    if (result.filled) {
      completedKeys.add(key);
      resumeParserRan = true;
    } else {
      skippedKeys.add(key);
    }
    results.push({ id: field.id, key, type: field.type, pass: 1, label: displayFieldLabel(field.label).slice(0, 140), ...result, match });
    await wait(50);
  }

  if (resumeParserRan) await waitForResumeParser();

  for (let pass = 1; pass <= 3; pass += 1) {
    await waitUntilResumed();
    const fields = collectFields();
    let filledThisPass = 0;
    let attemptedThisPass = 0;

    for (const collectedField of fields) {
      await waitUntilResumed();
      const field = refreshFieldReference(collectedField);
      const key = fieldAttemptKey(field);
      const filledByRoleMatch = field.element.getAttribute(ROLEMATCH_FILLED_ATTR) === 'true';
      if (filledByRoleMatch || skippedKeys.has(key)) {
        continue;
      }

      const match = answerForField(field, profile, job);
      if (hasMeaningfulValue(field)) {
        const originalValue = initialValues.get(key) ?? '';
        const resumeParserValue = resumeParserRan && !String(originalValue).trim() && match.action === 'fill';
        if (resumeParserValue && !answersEquivalent(field.value, match.answer)) {
          // Resume parsers can replace inputs and overwrite profile values. Reapply RoleMatch below.
        } else if (resumeParserValue) {
          field.element.setAttribute(ROLEMATCH_FILLED_ATTR, 'true');
          completedKeys.add(key);
          results.push({
            id: field.id,
            key,
            type: field.type,
            pass,
            label: displayFieldLabel(field.label).slice(0, 140),
            filled: true,
            value: safeFillResultValue(field),
            reason: 'resume parser value matched RoleMatch',
            match,
          });
          continue;
        } else {
          skippedKeys.add(key);
          results.push({
            id: field.id,
            key,
            type: field.type,
            pass,
            label: displayFieldLabel(field.label).slice(0, 140),
            filled: false,
            value: safeFillResultValue(field),
            reason: 'already had a value',
            match,
          });
          continue;
        }
      }

      const result = await fillField(field, match);
      attemptedThisPass += 1;
      if (result.filled) {
        filledThisPass += 1;
        completedKeys.add(key);
      } else {
        skippedKeys.add(key);
      }
      results.push({ id: field.id, key, type: field.type, pass, label: displayFieldLabel(field.label).slice(0, 140), ...result, match });
      await wait(50);
    }

    if (!attemptedThisPass) break;
    if (filledThisPass) {
      await wait(350);
      continue;
    }
    break;
  }

  state.filling = false;
  state.lastFillResults = results;
  const filledCount = filledResultCount(results);
  const passCount = Math.max(1, ...results.map((result) => result.pass ?? 1));
  const totalFilledCount = filledCount + storedCredentialFill;
  const credentialSummary = state.credentialStatus ? ` ${state.credentialStatus}` : '';
  state.status = `Filled ${totalFilledCount} field${totalFilledCount === 1 ? '' : 's'} across ${passCount} pass${passCount === 1 ? '' : 'es'}.${credentialSummary}`;
  scanFields(profile, job);
  renderPanel();
  await maybeContinueCredentialLogin();
  const advanced = await maybeAutoAdvanceApplication('autofill completed');
  if (!advanced) await maybeAutoSubmitApplication('autofill completed');
  return { ok: true, results, scan: state.lastScan };
}

function safeFillResultValue(field) {
  const nativeInputType = String(field?.element?.getAttribute?.('type') || '').toLowerCase();
  if (field?.type === 'password' || nativeInputType === 'password') return '[stored credential]';
  return field?.value;
}

function filledResultCount(results) {
  return new Set(
    results
      .filter((result) => result.filled)
      .map((result) => result.key || result.id),
  ).size;
}

function controlTextParts(element) {
  if (!(element instanceof HTMLElement)) return [];
  return uniqueParts([
    element.innerText,
    element.textContent,
    element.value,
    element.getAttribute('aria-label'),
    element.getAttribute('title'),
    element.getAttribute('data-automation'),
    element.getAttribute('data-automation-id'),
    element.getAttribute('data-testid'),
    element.getAttribute('test-id'),
    element.getAttribute('name'),
    element.id,
  ]).map(normalize).filter(Boolean);
}

function looksLikeFinalSubmitControl(element) {
  const text = controlTextParts(element).join(' ');

  if (!text) return false;
  if (/save|draft|back|previous|next|continue|review|apply with|autofill|upload|attach/.test(text)) return false;
  return /submit application|submit your application|send application|complete application|finish application|final submit|application submit|^submit$/.test(text);
}

function looksLikeStepAdvanceControl(element) {
  const parts = controlTextParts(element);
  if (parts.length === 0 || looksLikeFinalSubmitControl(element) || looksLikeLoginControl(element)) return false;

  const combined = parts.join(' ');
  if (/submit|sign in|log in|login|create account|register|sign up|continue as guest|continue with|forgot|reset password|captcha|verification|payment|checkout|upload|attach/.test(combined)) {
    return false;
  }

  const visibleLabels = uniqueParts([
    element.innerText,
    element.textContent,
    element.value,
    element.getAttribute('aria-label'),
    element.getAttribute('title'),
  ]).map(normalize).filter(Boolean);
  const visiblePattern = /^(?:next|next step|continue|continue application|continue to application|continue to next step|continue to the next step|save and continue|save continue|proceed|proceed to next step|proceed to the next step)$/;
  if (visibleLabels.some((label) => visiblePattern.test(label))) return true;

  const machineLabels = uniqueParts([
    element.getAttribute('data-automation'),
    element.getAttribute('data-automation-id'),
    element.getAttribute('data-testid'),
    element.getAttribute('test-id'),
    element.getAttribute('name'),
    element.id,
  ]).map(normalize).filter(Boolean);
  return machineLabels.some((label) => (
    !/pagination|carousel|job search|job result/.test(label)
    && /(?:^| )(?:next|continue)(?: (?:step|button|application|action))?(?:$| )/.test(label)
  ));
}

async function loadSettings() {
  const response = await sendMessage({ type: 'ROLEMATCH_GET_SETTINGS' }).catch(() => null);
  if (response?.ok && response.settings) {
    state.settings = {
      ...state.settings,
      ...response.settings,
    };
    applyPauseState(response.settings.paused === true);
  }
  return state.settings;
}

function looksLikeLoginControl(element) {
  if (!(element instanceof HTMLElement)) return false;
  const text = normalize(uniqueParts([
    element.innerText,
    element.textContent,
    element.value,
    element.getAttribute('aria-label'),
    element.getAttribute('data-automation-id'),
    element.getAttribute('data-testid'),
  ]).join(' '));
  if (/create account|register|sign up|forgot|reset|cancel|back/.test(text)) return false;
  return /^sign in$|^log in$|^login$|continue with email|continue to application/.test(text);
}

function credentialValueForField(field, credential) {
  if (!credential || !field?.element) return '';
  const identity = normalize([
    field.label,
    field.type,
    field.element.getAttribute('autocomplete'),
    field.element.getAttribute('name'),
    field.element.getAttribute('id'),
    field.element.getAttribute('aria-label'),
  ].filter(Boolean).join(' '));

  if (/verification|security code|one[ -]?time|\botp\b|authenticator|two[ -]?factor|\b2fa\b|\bmfa\b/.test(identity)) {
    return '';
  }
  if (field.type === 'password' || /\bpassword\b|\baccount pin\b/.test(identity)) {
    return credential.password || '';
  }
  if (
    !/confirm|verification|security code|one[ -]?time|\botp\b/.test(identity)
    && /\bemail\b|e-mail|user ?name|login (?:id|email)|account email/.test(identity)
  ) {
    return credential.username || '';
  }
  return '';
}

async function fillStoredCredentialFields(fields, credential) {
  let filled = 0;
  for (const field of fields) {
    const value = credentialValueForField(field, credential);
    if (!value || !field.element || !visible(field.element)) continue;
    nativeSetValue(field.element, value, { blur: false });
    field.element.setAttribute(ROLEMATCH_FILLED_ATTR, 'true');
    filled += 1;
    await wait(40);
  }
  return filled;
}

async function fillStoredCredentialFieldsForVisibleLogin() {
  if (state.paused || state.credentialLookupAttempted) return 0;

  const fields = collectFields();
  const passwordFields = fields.filter((field) => (
    field.type === 'password' || /\bpassword\b|\bpasscode\b/.test(normalize(field.label))
  ));
  // Account-creation forms commonly expose password and confirmation inputs on
  // the same Workday route. Only resolve an existing ATS credential for a
  // one-password login form so a lookup is not consumed against the wrong UI.
  if (passwordFields.length !== 1 || passwordFields.every((field) => hasMeaningfulValue(field))) return 0;

  state.credentialLookupAttempted = true;
  const response = await sendMessage({ type: 'ROLEMATCH_GET_ATS_CREDENTIAL' }).catch((error) => ({
    ok: false,
    error: error instanceof Error ? error.message : String(error),
  }));
  if (!response?.ok) {
    state.credentialStatus = response?.error || 'Unable to load the saved ATS account.';
    state.status = state.credentialStatus;
    renderPanel();
    return 0;
  }

  const credential = response.credential;
  if (!credential) {
    state.credentialStatus = 'No saved ATS account matches this exact login site.';
    return 0;
  }

  const exactOrigin = String(credential.origin || '').toLowerCase() === window.location.origin.toLowerCase();
  const filled = exactOrigin ? await fillStoredCredentialFields(fields, credential) : 0;
  credential.password = '';
  if (!exactOrigin) {
    state.credentialStatus = 'Saved ATS account did not match this exact login site.';
    state.status = state.credentialStatus;
    renderPanel();
    return 0;
  }

  if (filled > 0) {
    state.credentialStatus = `Filled saved ${credential.provider || 'ATS'} account.`;
    state.status = state.credentialStatus;
    renderPanel();
  }
  return filled;
}

function credentialLoginControl(fields) {
  const controls = deepQuerySelectorAll('button, input[type="submit"], input[type="button"], [role="button"], ukg-button')
    .filter((element) => visible(element) && looksLikeLoginControl(element));
  if (controls.length === 1) return controls[0];

  const passwordElements = fields
    .filter((field) => field.type === 'password' || /\bpassword\b|\bpasscode\b/.test(normalize(field.label)))
    .map((field) => field.element)
    .filter(Boolean);
  const formControls = controls.filter((control) => {
    const form = control.closest('form');
    return form && passwordElements.some((element) => form.contains(element));
  });
  return formControls.length === 1 ? formControls[0] : null;
}

async function maybeContinueCredentialLogin() {
  if (!state.settings.continueAfterLoginEnabled || state.paused || state.loginContinueAttempted) return false;
  let fields = collectFields();
  let passwords = fields.filter((field) => field.type === 'password' || /\bpassword\b|\bpasscode\b/.test(normalize(field.label)));
  if (passwords.length === 0) return false;

  if (passwords.some((field) => !hasMeaningfulValue(field))) {
    await fillStoredCredentialFieldsForVisibleLogin();
    fields = collectFields();
    passwords = fields.filter((field) => field.type === 'password' || /\bpassword\b|\bpasscode\b/.test(normalize(field.label)));
  }

  if (passwords.some((field) => !hasMeaningfulValue(field))) return false;

  const credentialFields = fields.filter((field) => (
    field.required
    && /email|user ?name|login|password|passcode/.test(normalize(field.label))
  ));
  if (credentialFields.some((field) => !hasMeaningfulValue(field))) return false;

  const gates = detectedManualSubmissionGates(fields);
  if (gates.some((gate) => /CAPTCHA|verification code|one-time/i.test(gate))) return false;

  const control = credentialLoginControl(fields);
  if (!control) return false;

  state.loginContinueAttempted = true;
  state.status = 'ATS login filled. Continuing to the application.';
  renderPanel();
  control.click();
  return true;
}

function scheduleCredentialLoginCheck() {
  if (!state.settings.continueAfterLoginEnabled || state.paused || state.loginContinueAttempted) return;
  if (loginContinueTimer) window.clearTimeout(loginContinueTimer);
  loginContinueTimer = window.setTimeout(() => {
    loginContinueTimer = null;
    void maybeContinueCredentialLogin();
  }, 500);
}

function evaluateSubmissionReadiness(fields, gateReasons = [], submitControlCount = 0, hasApplicationContext = true) {
  const blockers = [...gateReasons];
  fields.forEach((field) => {
    const label = displayFieldLabel(field.label || field.type || 'Required field');
    const reason = String(field.reason || '');
    if (field.required && !field.hasValue) {
      blockers.push(`${label}: required field is incomplete`);
      return;
    }
    if (!field.hasValue && /verification\/CAPTCHA|saved ATS account|browser password manager/i.test(reason)) {
      blockers.push(`${label}: ${reason}`);
    }
    if (field.required && /manual|no confident profile match|no matching dropdown option/i.test(reason)) {
      blockers.push(`${label}: ${reason}`);
    }
  });

  if (!hasApplicationContext) blockers.push('RoleMatch application context is missing');
  if (submitControlCount === 0) blockers.push('Final submit button is not ready');
  if (submitControlCount > 1) blockers.push('Multiple final submit controls need review');

  const uniqueBlockers = [...new Set(blockers.filter(Boolean))];
  return { ready: uniqueBlockers.length === 0, blockers: uniqueBlockers };
}

function dedupeNestedControls(controls) {
  const uniqueControls = Array.from(new Set(controls));
  return uniqueControls.filter((control) => !uniqueControls.some((candidate) => (
    candidate !== control
    && typeof control.contains === 'function'
    && control.contains(candidate)
  )));
}

function visibleFinalSubmitControls() {
  return dedupeNestedControls(
    deepQuerySelectorAll('button, input[type="submit"], input[type="button"], [role="button"], ukg-button')
      .filter((element) => visible(element) && looksLikeFinalSubmitControl(element)),
  );
}

function visibleStepAdvanceControls() {
  return dedupeNestedControls(
    deepQuerySelectorAll('a, button, input[type="submit"], input[type="button"], [role="button"], ukg-button')
      .filter((element) => (
        visible(element)
        && element.getAttribute('aria-disabled') !== 'true'
        && looksLikeStepAdvanceControl(element)
      )),
  );
}

function isInteractiveCaptchaGate(element) {
  if (!visible(element)) return false;
  const src = String(element.getAttribute?.('src') || '').toLowerCase();
  const identity = normalize([
    src,
    element.getAttribute?.('title'),
    element.getAttribute?.('aria-label'),
    element.innerText,
    element.textContent,
  ].filter(Boolean).join(' '));
  const rect = element.getBoundingClientRect?.();
  const largeEnoughForInteraction = !rect || (rect.width >= 30 && rect.height >= 20);

  if (/size=invisible/.test(src) && !/challenge|bframe/.test(src)) return false;
  if (/challenge|bframe/.test(src) && /captcha/.test(identity)) return true;
  if (/recaptcha|hcaptcha/.test(src)) {
    return largeEnoughForInteraction && /anchor|checkbox|challenge|bframe|i(?:'| a)m not a robot/.test(identity);
  }

  return largeEnoughForInteraction
    && /captcha challenge|verify (?:that )?you are human|i(?:'| a)m not a robot/.test(identity);
}

function detectedManualSubmissionGates(fields) {
  const blockers = [];
  const captchaVisible = deepQuerySelectorAll([
    'iframe[src*="recaptcha"]',
    'iframe[src*="hcaptcha"]',
    '[class*="captcha"]',
    '[id*="captcha"]',
    '[data-testid*="captcha"]',
  ].join(',')).some(isInteractiveCaptchaGate);
  if (captchaVisible) blockers.push('CAPTCHA requires completion');

  fields.forEach((field) => {
    const label = normalize(field.label);
    if (!hasMeaningfulValue(field) && /one[ -]?time password|one[ -]?time code|verification code|\botp\b|security token/.test(label)) {
      blockers.push('One-time verification code is incomplete');
    }
    if (!hasMeaningfulValue(field) && (field.type === 'password' || /\bpassword\b|\bpasscode\b|account pin/.test(label))) {
      blockers.push('ATS login is incomplete');
    }
    if (field.required && !hasMeaningfulValue(field) && /consent|privacy|terms|acknowledge|certify|signature/.test(label)) {
      blockers.push(`${displayFieldLabel(field.label)} requires explicit review`);
    }
  });

  const invalidForms = deepQuerySelectorAll('form').filter((form) => (
    typeof form.checkValidity === 'function' && !form.checkValidity()
  ));
  if (invalidForms.length > 0) blockers.push('The ATS reports incomplete or invalid fields');
  return [...new Set(blockers)];
}

function evaluateStepAdvanceReadiness(fields, gateReasons = [], advanceControlCount = 0, hasApplicationContext = true) {
  const blockers = [...gateReasons];
  fields.forEach((field) => {
    const label = displayFieldLabel(field.label || field.type || 'Required field');
    const reason = String(field.reason || '');
    if (field.required && !field.hasValue) {
      blockers.push(`${label}: required field is incomplete`);
      return;
    }
    if (!field.hasValue && /verification\/CAPTCHA|saved ATS account|browser password manager/i.test(reason)) {
      blockers.push(`${label}: ${reason}`);
    }
    if (field.required && /manual|no confident profile match|no matching dropdown option/i.test(reason)) {
      blockers.push(`${label}: ${reason}`);
    }
  });

  if (fields.length === 0) blockers.push('No application fields are visible');
  if (!hasApplicationContext) blockers.push('RoleMatch application context is missing');
  if (advanceControlCount === 0) blockers.push('Next or Continue button is not ready');
  if (advanceControlCount > 1) blockers.push('Multiple Next or Continue controls need review');

  const uniqueBlockers = [...new Set(blockers.filter(Boolean))];
  return { ready: uniqueBlockers.length === 0, blockers: uniqueBlockers };
}

function fieldReadinessRecords(fields) {
  return fields.map((field) => {
    const match = answerForField(field, state.profile, state.job);
    return {
      label: field.label,
      type: field.type,
      required: field.required,
      hasValue: hasMeaningfulValue(field),
      action: match.action,
      reason: match.reason,
    };
  });
}

function currentStepAdvanceReadiness() {
  const fields = collectFields();
  const records = fieldReadinessRecords(fields);
  const controls = visibleStepAdvanceControls();
  const gates = detectedManualSubmissionGates(fields);
  if (visibleFinalSubmitControls().length > 0) {
    gates.push('Final submit control is visible');
  }
  const readiness = evaluateStepAdvanceReadiness(
    records,
    gates,
    controls.length,
    Boolean(state.sessionId && state.job?.jobUrl),
  );
  return {
    ...readiness,
    controlCount: controls.length,
    control: readiness.ready ? controls[0] : null,
  };
}

function currentSubmissionReadiness() {
  const fields = collectFields();
  const records = fieldReadinessRecords(fields);
  const controls = visibleFinalSubmitControls();
  const gates = detectedManualSubmissionGates(fields);
  if (visibleStepAdvanceControls().length > 0) {
    gates.push('A next application step is still available');
  }
  const readiness = evaluateSubmissionReadiness(
    records,
    gates,
    controls.length,
    Boolean(state.sessionId && state.job?.jobUrl),
  );
  return { ...readiness, control: readiness.ready ? controls[0] : null };
}

function readinessBlockerSummary(blockers) {
  const details = (blockers || [])
    .map((blocker) => compactText(blocker, 180))
    .filter(Boolean)
    .slice(0, 3);
  return details.length > 0 ? ` ${details.join(' | ')}` : '';
}

function applicationStepSignature() {
  const headings = deepQuerySelectorAll('h1, h2, [role="heading"]')
    .filter((element) => !element.closest?.(`#${ROLEMATCH_PANEL_ID}`))
    .filter((element) => !(element instanceof HTMLElement) || visible(element))
    .slice(0, 6)
    .map((element) => normalize(element.innerText || element.textContent))
    .filter(Boolean);
  const fields = collectFields().map(fieldAttemptKey).sort();
  const stepMarkers = deepQuerySelectorAll('[aria-current="step"], [data-automation-id*="progress"], [data-testid*="step"]')
    .filter((element) => !element.closest?.(`#${ROLEMATCH_PANEL_ID}`))
    .filter((element) => !(element instanceof HTMLElement) || visible(element))
    .slice(0, 8)
    .map((element) => normalize(element.innerText || element.textContent || element.getAttribute?.('aria-label')))
    .filter(Boolean)
    .sort();
  return JSON.stringify({
    url: window.location.href,
    headings,
    fields,
    stepMarkers,
  });
}

async function waitForApplicationStepChange(beforeSignature) {
  for (let attempt = 0; attempt < 24; attempt += 1) {
    await wait(250);
    if (applicationStepSignature() === beforeSignature) continue;
    const nextFieldsVisible = collectFields().length > 0;
    const nextWorkflowControlVisible = (
      visibleStepAdvanceControls().length > 0
      || visibleFinalSubmitControls().length > 0
    );
    if (nextFieldsVisible || nextWorkflowControlVisible) return true;
  }
  return false;
}

async function maybeAutoAdvanceApplication(trigger) {
  if (
    !state.settings.autoAdvanceEnabled
    || state.paused
    || state.filling
    || state.autoAdvanceInProgress
    || state.submitHandled
  ) {
    return false;
  }

  const controls = visibleStepAdvanceControls();
  if (controls.length === 0) return false;

  const signature = applicationStepSignature();
  if (state.lastAdvancedStepSignature === signature) return false;

  const readiness = currentStepAdvanceReadiness();
  state.stepAdvanceReadiness = { ready: readiness.ready, blockers: readiness.blockers };
  if (!readiness.ready || !readiness.control) {
    const count = readiness.blockers.length;
    state.status = `Autofill complete. ${count} item${count === 1 ? '' : 's'} need attention before automatic advance.`;
    renderPanel();
    return false;
  }

  state.autoAdvanceInProgress = true;
  state.lastAdvancedStepSignature = signature;
  state.status = 'Current step complete. Advancing through the application.';
  renderPanel();

  try {
    dispatchOptionSelection(readiness.control);
  } catch (error) {
    state.autoAdvanceInProgress = false;
    state.lastAdvancedStepSignature = '';
    state.status = error instanceof Error ? error.message : 'Unable to advance to the next application step.';
    renderPanel();
    return false;
  }

  const changed = await waitForApplicationStepChange(signature);
  state.autoAdvanceInProgress = false;

  if (!changed) {
    state.status = 'Next or Continue selected. Waiting for the ATS to load the next step.';
    renderPanel();
    return true;
  }

  state.autoSubmitAttempted = false;
  state.submissionReadiness = null;
  state.stepAdvanceReadiness = null;
  if (!state.settings.autoAdvanceEnabled || state.paused) {
    state.status = state.paused ? 'Extension paused.' : 'Next application step is ready.';
    renderPanel();
    return true;
  }

  state.status = `Next application step opened after ${trigger}. Filling visible fields.`;
  renderPanel();
  await wait(200);
  await fillVisibleFields(state.profile, state.job);
  return true;
}

function scheduleAutoAdvanceCheck(trigger) {
  if (!state.settings.autoAdvanceEnabled || state.paused || state.filling || state.autoAdvanceInProgress) return;
  if (autoAdvanceTimer) window.clearTimeout(autoAdvanceTimer);
  autoAdvanceTimer = window.setTimeout(() => {
    autoAdvanceTimer = null;
    void maybeAutoAdvanceApplication(trigger);
  }, 400);
}

async function maybeAutoSubmitApplication(trigger) {
  if (!state.settings.autoSubmitEnabled || state.paused || state.filling || state.submitHandled || state.autoSubmitAttempted) {
    return false;
  }

  const readiness = currentSubmissionReadiness();
  state.submissionReadiness = { ready: readiness.ready, blockers: readiness.blockers };
  if (!readiness.ready || !readiness.control) {
    const count = readiness.blockers.length;
    state.status = `Autofill complete. ${count} item${count === 1 ? '' : 's'} need attention before automatic submit.${readinessBlockerSummary(readiness.blockers)}`;
    renderPanel();
    return false;
  }

  state.autoSubmitAttempted = true;
  state.status = 'Application complete. Submitting through the ATS.';
  renderPanel();
  await handleApplicationSubmitIntent(`automatic submit after ${trigger}`);
  await wait(200);
  readiness.control.click();
  scheduleSubmissionConfirmationChecks('RoleMatch automatic submit');
  return true;
}

function scheduleAutoSubmitCheck(trigger) {
  if (!state.settings.autoSubmitEnabled || state.paused || state.filling || state.autoSubmitAttempted) return;
  if (autoSubmitTimer) window.clearTimeout(autoSubmitTimer);
  autoSubmitTimer = window.setTimeout(() => {
    autoSubmitTimer = null;
    void maybeAutoSubmitApplication(trigger);
  }, 450);
}

async function saveCompletionPromptSetting(showCompletionPrompt) {
  state.settings = {
    ...state.settings,
    showCompletionPrompt,
  };
  await sendMessage({
    type: 'ROLEMATCH_SAVE_SETTINGS',
    settings: { showCompletionPrompt },
  }).catch(() => null);
  renderPanel();
}

function submissionConfirmationEvidence() {
  const selectors = [
    'h1',
    'h2',
    '[role="status"]',
    '[role="alert"]',
    '[data-automation-id*="confirmation"]',
    '[data-testid*="confirmation"]',
    '[test-id*="confirmation"]',
    '[class*="confirmation"]',
    '[class*="thank-you"]',
    '[class*="success"]',
  ].join(',');
  const candidates = uniqueParts([
    document.title,
    ...deepQuerySelectorAll(selectors).map((element) => compactText(element.innerText || element.textContent, 700)),
  ]).filter(Boolean);
  const confirmation = /thank(?:s| you)(?: very much)? for (?:your )?(?:application|applying)|(?:your |the )?application (?:has been |was )?(?:successfully )?(?:submitted|received)|we(?:'ve| have)? received your application|application (?:submission )?(?:is )?complete|successfully submitted (?:your )?application/i;
  const evidence = candidates.find((candidate) => confirmation.test(candidate));
  if (evidence) return compactText(evidence, 260);

  const urlLooksConfirmed = /\/(?:thank(?:-?you)?|thanks|submitted|submission-confirmation|application-confirmation)(?:\/|$)/i.test(window.location.pathname);
  if (urlLooksConfirmed) {
    const contextual = candidates.find((candidate) => /application|applying|received|submitted|thank/i.test(candidate));
    if (contextual) return compactText(contextual, 260);
  }
  return '';
}

function submitIntentIsFresh() {
  const timestamp = state.submitIntentAt ? Date.parse(state.submitIntentAt) : 0;
  return state.submitIntentSent || (Number.isFinite(timestamp) && Date.now() - timestamp < 2 * 60 * 60 * 1000);
}

async function handleApplicationSubmitted(trigger, evidence) {
  if (state.submitHandled || state.paused) return;
  state.submitHandled = true;
  state.status = 'Application submitted. Updating RoleMatch tracker.';
  state.completion = {
    ok: null,
    title: 'Application submitted',
    detail: 'Updating the RoleMatch tracker...',
    trigger,
    evidence,
  };
  renderPanel();

  const response = await sendMessage({
    type: 'ROLEMATCH_APPLICATION_SUBMITTED',
    confirmed: true,
    sessionId: state.sessionId,
    job: state.job,
    trigger,
    evidence,
    url: window.location.href,
    ats: state.ats,
  }).catch((error) => ({ ok: false, error: error instanceof Error ? error.message : String(error) }));

  if (response?.settings) {
    state.settings = {
      ...state.settings,
      ...response.settings,
    };
  }

  if (response?.ok) {
    state.status = 'Application tracked as submitted.';
    state.completion = {
      ok: true,
      title: 'Application complete',
      detail: response.application
        ? 'RoleMatch marked this job as submitted.'
        : 'Submit detected, but no RoleMatch job context was available for this tab.',
      trigger,
    };
  } else {
    state.submitHandled = false;
    state.status = response?.error || 'Submit detected, but tracking failed.';
    state.completion = {
      ok: false,
      title: 'Submit detected',
      detail: response?.error || 'RoleMatch could not update the tracker for this tab.',
      trigger,
    };
  }

  renderPanel();
}

async function maybeConfirmApplicationSubmission(trigger) {
  if (state.submitHandled || state.paused || !submitIntentIsFresh()) return false;
  const evidence = submissionConfirmationEvidence();
  if (!evidence) return false;
  await handleApplicationSubmitted(trigger, evidence);
  return true;
}

function scheduleSubmissionConfirmationChecks(trigger) {
  [600, 1500, 3500, 7000].forEach((delay) => {
    window.setTimeout(() => {
      void maybeConfirmApplicationSubmission(trigger);
    }, delay);
  });
}

async function handleApplicationSubmitIntent(trigger) {
  if (state.paused) return;
  if (!state.submitIntentSent) {
    state.submitIntentSent = true;
    state.status = 'Submit attempted. Waiting for ATS confirmation.';
    renderPanel();
    const response = await sendMessage({
      type: 'ROLEMATCH_APPLICATION_SUBMIT_INTENT',
      sessionId: state.sessionId,
      job: state.job,
      trigger,
      url: window.location.href,
      ats: state.ats,
    }).catch(() => null);
    if (response?.session?.submitIntentAt) state.submitIntentAt = response.session.submitIntentAt;
  }
  scheduleSubmissionConfirmationChecks(trigger);
}

function attachSubmitCompletionHandlers() {
  if (state.submitListenersAttached) return;
  state.submitListenersAttached = true;

  document.addEventListener('submit', (event) => {
    if (state.paused) return;
    const submitter = event.submitter instanceof HTMLElement ? event.submitter : null;
    if (submitter && !looksLikeFinalSubmitControl(submitter)) return;
    void handleApplicationSubmitIntent(submitter ? 'submit button' : 'form submit');
  }, true);

  document.addEventListener('click', (event) => {
    if (state.paused) return;
    const target = event.target instanceof HTMLElement
      ? event.target.closest('button, input[type="submit"], input[type="button"], a, [role="button"], ukg-button')
      : null;
    if (!target || !looksLikeFinalSubmitControl(target)) return;
    void handleApplicationSubmitIntent('submit click');
  }, true);
}

function attachDynamicFieldObserver() {
  if (fieldObserver || typeof MutationObserver !== 'function') return;

  fieldObserver = new MutationObserver((mutations) => {
    const hasApplicationMutation = mutations.some((mutation) => {
      const target = mutation.target;
      return !(target instanceof HTMLElement && target.closest?.(`#${ROLEMATCH_PANEL_ID}`));
    });
    if (!hasApplicationMutation) return;

    observeDynamicFieldRoots();
    if (submitIntentIsFresh()) void maybeConfirmApplicationSubmission('ATS success state');

    if (fieldRefreshTimer) window.clearTimeout(fieldRefreshTimer);
    fieldRefreshTimer = window.setTimeout(() => {
      fieldRefreshTimer = null;
      if (state.filling || state.paused) return;
      scanFields(state.profile, state.job);
      renderPanel();
      scheduleCredentialLoginCheck();
      scheduleAutoAdvanceCheck('application step updated');
      scheduleAutoSubmitCheck('verification or login completed');
    }, 250);
  });

  observeDynamicFieldRoots();
}

function observeDynamicFieldRoots() {
  if (!fieldObserver) return;
  const observe = (root) => {
    if (!root?.querySelectorAll || observedFieldRoots.has(root)) return;
    observedFieldRoots.add(root);
    fieldObserver.observe(root, { childList: true, subtree: true });
    Array.from(root.querySelectorAll('*')).forEach((element) => {
      if (element.shadowRoot) observe(element.shadowRoot);
    });
  };

  observe(document.documentElement);
}

function scheduleHydratedFieldRescans() {
  [600, 1600, 3000].forEach((delay) => {
    window.setTimeout(() => {
      observeDynamicFieldRoots();
      if (state.filling || state.paused) return;
      scanFields(state.profile, state.job);
      renderPanel();
      scheduleCredentialLoginCheck();
      scheduleAutoAdvanceCheck('application fields loaded');
      scheduleAutoSubmitCheck('application fields loaded');
    }, delay);
  });
}

function aggregateCheckboxQuestionRows(rows) {
  const ordered = [];
  const checkboxGroups = new Map();

  rows.forEach((row, index) => {
    const label = displayFieldLabel(row.label || 'Field');
    const groupKey = row.type === 'checkbox' ? normalize(label) : '';
    if (!groupKey) {
      ordered.push({ index, row });
      return;
    }

    const existing = checkboxGroups.get(groupKey);
    if (existing) {
      existing.rows.push(row);
      return;
    }

    const group = { index, label, rows: [row] };
    checkboxGroups.set(groupKey, group);
    ordered.push({ index, group });
  });

  checkboxGroups.forEach((group) => {
    if (group.rows.length === 1) {
      group.merged = group.rows[0];
      return;
    }

    const fillResults = group.rows.some((row) => Object.prototype.hasOwnProperty.call(row, 'filled'));
    const selectedRows = fillResults
      ? group.rows.filter((row) => row.filled)
      : group.rows.filter((row) => ['fill', 'file'].includes(row.action) && row.answer);
    const failedSelections = fillResults
      ? group.rows.filter((row) => !row.filled && ['fill', 'file'].includes(row.match?.action))
      : [];
    const selectedValues = uniqueParts(selectedRows.map((row) => (
      fillResults
        ? row.value || row.match?.answer
        : row.answer
    )).map((value) => String(value || '').split('|')[0]?.trim()).filter(Boolean));
    const fallback = failedSelections[0] || selectedRows[0] || group.rows[0];
    const reasons = uniqueParts(group.rows.map((row) => row.reason || row.match?.reason).filter(Boolean));
    const manualReason = failedSelections[0]?.reason
      || failedSelections[0]?.match?.reason
      || (reasons.length === 1 ? reasons[0] : 'checkboxes require manual review');

    group.merged = fillResults
      ? {
        ...fallback,
        key: `checkbox-question:${normalize(group.label)}`,
        type: 'checkbox',
        label: group.label,
        filled: selectedRows.length > 0 && failedSelections.length === 0,
        value: selectedValues.join(', '),
        reason: selectedRows.length > 0 && failedSelections.length === 0 ? fallback.reason : manualReason,
      }
      : {
        ...fallback,
        id: `checkbox-question:${normalize(group.label)}`,
        type: 'checkbox',
        label: group.label,
        action: selectedRows.length > 0 ? 'fill' : 'skip',
        answer: selectedValues.join(', '),
        reason: selectedRows.length > 0 ? fallback.reason : manualReason,
      };
  });

  return ordered
    .sort((left, right) => left.index - right.index)
    .map((entry) => entry.group?.merged || entry.row);
}

function lastFillRows() {
  const rows = new Map();
  (state.lastFillResults || []).forEach((result) => {
    const label = result.label || result.match?.reason || 'Field';
    if (!label) return;
    const key = result.key || `${label}-${result.match?.reason || result.reason || ''}`;
    const existing = rows.get(key);
    if (!existing || result.filled) {
      rows.set(key, result);
    }
  });
  return aggregateCheckboxQuestionRows(Array.from(rows.values()));
}

function learnableReason(reason) {
  return /no confident profile match|no concise experience level available|needs concise relocation preference|supported-country location needs manual review|requires a profile answer|checkboxes require manual review|no matching (?:select|radio|yes\/no|dropdown|combobox) option/i.test(reason || '');
}

function isDocumentUploadQuestion(label) {
  const normalized = normalize(label);
  if (!normalized) return false;
  if (/^(?:resume(?:\/cv)?|cv|cover letter)$/.test(normalized)) return true;
  return /\b(?:upload|attach|choose|select)\b[^.]{0,80}\b(?:resume|cv|cover letter|file|document)\b/.test(normalized)
    || /\b(?:resume|cv|cover letter)\b[^.]{0,80}\b(?:upload|attachment|file)\b/.test(normalized)
    || /\bfile upload\b/.test(normalized);
}

function learnableQuestion(label) {
  const normalized = normalize(label);
  const shortWhyPrompt = /^why\s+[a-z0-9][a-z0-9+#./@$ &-]+$/.test(normalized);
  return Boolean(
    normalized
    && (normalized.length >= 8 || shortWhyPrompt)
    && !/captcha|hcaptcha|recaptcha|verification code|one time|otp|\bpassword\b|\bpasscode\b|\baccount pin\b|submit application|final submit/.test(normalized)
    && !isDocumentUploadQuestion(normalized)
  );
}

function customAnswerCandidates() {
  const rows = lastFillRows();
  const candidates = new Map();

  const addCandidate = ({ label, reason, value }) => {
    const questionLabel = displayFieldLabel(label);
    if (!learnableReason(reason) || !learnableQuestion(questionLabel)) return;
    if (value && normalize(questionLabel) === normalize(value)) return;
    const key = normalize(questionLabel).slice(0, 100);
    if (!key || candidates.has(key)) return;
    candidates.set(key, {
      id: `custom-${candidates.size}`,
      key,
      label: compactText(questionLabel, 180),
      keywords: customAnswerKeywords(questionLabel),
      value: compactText(value || '', 320),
      reason,
    });
  };

  rows.forEach((row) => {
    addCandidate({
      label: row.label,
      reason: row.filled === false && row.reason
        ? row.reason
        : row.match?.reason || row.reason,
      value: row.reason === 'already had a value' ? row.value : '',
    });
  });

  if (rows.length === 0 && state.lastScan?.fields) {
    aggregateCheckboxQuestionRows(state.lastScan.fields).forEach((field) => {
      addCandidate({
        label: field.label,
        reason: field.reason,
        value: field.hasValue ? field.value : '',
      });
    });
  }

  return Array.from(candidates.values());
}

function customAnswerPanel() {
  const candidates = customAnswerCandidates();
  if (candidates.length === 0) return '';

  const cards = candidates.map((candidate) => {
    const draft = Object.prototype.hasOwnProperty.call(state.customAnswerDrafts, candidate.key)
      ? state.customAnswerDrafts[candidate.key]
      : candidate.value;
    return `
      <div class="rm-custom-card">
        <strong>${escapeHtml(candidate.label)}</strong>
        <span>${escapeHtml(candidate.reason)}</span>
        <textarea data-rm-custom-text="${escapeHtml(candidate.id)}" data-rm-custom-key="${escapeHtml(candidate.key)}" placeholder="Enter the answer to save for future autofill">${escapeHtml(draft)}</textarea>
        <button type="button" data-rm-save-custom="${escapeHtml(candidate.id)}" ${state.paused || state.savingAnswerId === candidate.id ? 'disabled' : ''}>
          ${state.savingAnswerId === candidate.id ? 'Saving...' : 'Save custom answer'}
        </button>
      </div>
    `;
  }).join('');

  return `
    <section class="rm-custom-section" aria-label="Custom answer learning">
      <h3>Unmatched questions</h3>
      <p class="rm-muted">Save answers here and RoleMatch will reuse them on future forms.</p>
      ${cards}
    </section>
  `;
}

function refreshAfterCustomAnswerSave(profile = state.profile, job = state.job) {
  state.lastFillResults = [];
  return scanFields(profile, job);
}

function mergeUpdatedProfile(profile) {
  if (!profile) return state.profile;
  const previousProfile = state.profile ?? {};
  state.profile = {
    ...previousProfile,
    ...profile,
    email: profile.email ?? previousProfile.email,
    documents: profile.documents ?? previousProfile.documents,
  };
  return state.profile;
}

function applyUpdatedProfile(profile) {
  const updatedProfile = mergeUpdatedProfile(profile);
  if (!updatedProfile || state.paused) return state.lastScan;
  return refreshAfterCustomAnswerSave(updatedProfile, state.job);
}

async function fillCurrentTabWithLatestProfile() {
  if (state.paused) {
    state.status = 'Extension paused. Resume before filling fields.';
    renderPanel();
    return { ok: false, paused: true, error: state.status };
  }

  const resultsBeforeRefresh = state.lastFillResults;
  state.status = state.ats === 'iCIMS' && window.top === window
    ? 'Refreshing profile and filling embedded iCIMS application'
    : 'Refreshing RoleMatch profile';
  renderPanel();

  const response = await sendMessage({
    type: 'ROLEMATCH_FILL_CURRENT_TAB',
    job: state.job,
  }).catch((error) => ({
    ok: false,
    error: error instanceof Error ? error.message : String(error),
  }));

  if (!response?.ok) {
    // The background request can outlive the content-script fill on complex
    // forms. Do not replace a newer, completed fill result with a stale timeout.
    if (state.lastFillResults === resultsBeforeRefresh) {
      state.status = response?.error || 'Unable to refresh the RoleMatch profile before filling.';
      renderPanel();
    }
  }

  return response;
}

function fillRunSummary() {
  const rows = lastFillRows();
  if (rows.length === 0) return '';
  const filled = rows.filter((row) => row.filled).length;
  const skipped = rows.length - filled;
  const skippedText = skipped > 0 ? ` ${skipped} skipped/manual.` : '';
  return `Last fill run: ${filled}/${rows.length} fields filled.${skippedText}`;
}

function completionPanel() {
  if (!state.completion || state.settings.showCompletionPrompt === false) return '';
  const className = state.completion.ok === false ? 'rm-completion-card rm-warning' : 'rm-completion-card';
  return `
    <section class="${className}" aria-label="Application completion">
      <strong>${escapeHtml(state.completion.title)}</strong>
      <p>${escapeHtml(state.completion.detail)}</p>
      <button type="button" data-rm-hide-completion>Don't show again</button>
    </section>
  `;
}

function panelRows() {
  if (!state.lastScan) return '<p class="rm-muted">No fields scanned yet.</p>';
  const fillRows = lastFillRows();
  if (fillRows.length > 0) {
    const rows = fillRows.map((field) => {
      const answer = field.filled
        ? (field.value || field.match?.answer || 'Filled')
        : (field.reason || field.match?.reason || 'Manual review');
      return `
        <li class="${field.filled ? 'rm-fillable' : ''}">
          <strong>${escapeHtml(field.label || 'Field')}</strong>
          <span>${escapeHtml(answer)}</span>
        </li>
      `;
    }).join('');
    return `
      <p class="rm-muted">Showing ${fillRows.length} fields from the last fill run.</p>
      <ul class="rm-field-list">${rows}</ul>
    `;
  }

  const scanRows = aggregateCheckboxQuestionRows(state.lastScan.fields);
  const rows = scanRows.map((field) => `
    <li class="${['fill', 'file'].includes(field.action) && field.answer ? 'rm-fillable' : ''}">
      <strong>${escapeHtml(field.label || field.type || 'Field')}</strong>
      <span>${escapeHtml(['fill', 'file'].includes(field.action) && field.answer ? field.answer : field.reason)}</span>
    </li>
  `).join('');
  return `
    <p class="rm-muted">Showing all ${scanRows.length} scanned fields.</p>
    <ul class="rm-field-list">${rows}</ul>
  `;
}

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function renderPanel() {
  let panel = document.getElementById(ROLEMATCH_PANEL_ID);
  if (!panel) {
    panel = document.createElement('rolematch-autofill-root');
    panel.id = ROLEMATCH_PANEL_ID;
    const panelRoot = panel.attachShadow({ mode: 'open' });
    panelRoot.innerHTML = `
      <style>
        #${ROLEMATCH_PANEL_SHELL_ID} {
          position: fixed;
          right: 8px;
          bottom: 16px;
          width: 330px;
          display: flex;
          flex-direction: column;
          max-height: min(82vh, 720px);
          z-index: 2147483647;
          background: #ffffff;
          color: #111827;
          border: 1px solid #d1d5db;
          border-radius: 10px;
          box-shadow: 0 22px 60px rgba(15, 23, 42, 0.22);
          font: 13px/1.45 Arial, sans-serif;
          overflow: hidden;
          transition: width 180ms ease, box-shadow 180ms ease;
        }
        #${ROLEMATCH_PANEL_SHELL_ID},
        #${ROLEMATCH_PANEL_SHELL_ID} * {
          box-sizing: border-box;
        }
        #${ROLEMATCH_PANEL_SHELL_ID}.rm-collapsed {
          width: 226px;
        }
        #${ROLEMATCH_PANEL_SHELL_ID} .rm-head {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 8px;
          padding: 12px 14px;
          background: #111827;
          color: white;
        }
        #${ROLEMATCH_PANEL_SHELL_ID} h2 { margin: 0; font-size: 14px; }
        #${ROLEMATCH_PANEL_SHELL_ID} .rm-body {
          flex: 1;
          min-height: 0;
          padding: 12px 14px 18px;
          overflow-y: auto;
          max-height: calc(min(82vh, 720px) - 48px);
          overscroll-behavior: contain;
          opacity: 1;
          transform: translateY(0);
          transition: max-height 220ms ease, opacity 160ms ease, transform 200ms ease, padding 200ms ease;
        }
        #${ROLEMATCH_PANEL_SHELL_ID}.rm-collapsed .rm-body {
          max-height: 0;
          padding-top: 0;
          padding-bottom: 0;
          opacity: 0;
          transform: translateY(10px);
          pointer-events: none;
          overflow: hidden;
        }
        #${ROLEMATCH_PANEL_SHELL_ID} .rm-status {
          margin: 0 0 10px;
          color: #475569;
        }
        #${ROLEMATCH_PANEL_SHELL_ID} .rm-actions {
          display: grid;
          gap: 8px;
          margin-bottom: 10px;
        }
        #${ROLEMATCH_PANEL_SHELL_ID} button {
          border: 1px solid #cbd5e1;
          border-radius: 8px;
          background: #f8fafc;
          color: #111827;
          cursor: pointer;
          font-weight: 700;
          padding: 8px 10px;
        }
        #${ROLEMATCH_PANEL_SHELL_ID} button.rm-primary {
          background: #2563eb;
          border-color: #2563eb;
          color: white;
          width: 100%;
        }
        #${ROLEMATCH_PANEL_SHELL_ID} button.rm-pause {
          width: 100%;
        }
        #${ROLEMATCH_PANEL_SHELL_ID} button.rm-pause[data-paused="true"] {
          background: #f0fdf4;
          border-color: #86efac;
          color: #166534;
        }
        #${ROLEMATCH_PANEL_SHELL_ID} .rm-icon-button {
          padding: 2px 7px;
          background: transparent;
          color: white;
          border-color: rgba(255,255,255,0.35);
        }
        #${ROLEMATCH_PANEL_SHELL_ID} .rm-field-list {
          display: grid;
          gap: 7px;
          margin: 8px 0 0;
          padding: 0 0 12px;
          list-style: none;
        }
        #${ROLEMATCH_PANEL_SHELL_ID} .rm-field-list li {
          display: grid;
          grid-template-columns: minmax(0, 1fr);
          gap: 4px;
          min-width: 0;
          height: auto !important;
          min-height: 0;
          position: relative;
          border: 1px solid #e5e7eb;
          border-radius: 8px;
          padding: 8px;
          background: #f9fafb;
        }
        #${ROLEMATCH_PANEL_SHELL_ID} .rm-field-list li.rm-fillable {
          border-color: #93c5fd;
          background: #eff6ff;
        }
        #${ROLEMATCH_PANEL_SHELL_ID} .rm-field-list strong,
        #${ROLEMATCH_PANEL_SHELL_ID} .rm-field-list span {
          display: block;
          position: static !important;
          float: none !important;
          width: auto !important;
          min-width: 0;
          max-width: 100%;
          line-height: 1.4 !important;
          white-space: normal !important;
          overflow-wrap: anywhere;
          word-break: normal;
        }
        #${ROLEMATCH_PANEL_SHELL_ID} .rm-field-list span {
          color: #64748b;
          margin-top: 3px;
        }
        #${ROLEMATCH_PANEL_SHELL_ID} .rm-custom-section {
          border-top: 1px solid #e5e7eb;
          margin-top: 4px;
          padding-top: 10px;
        }
        #${ROLEMATCH_PANEL_SHELL_ID} .rm-custom-section h3 {
          margin: 0 0 4px;
          font-size: 13px;
        }
        #${ROLEMATCH_PANEL_SHELL_ID} .rm-custom-card {
          display: grid;
          grid-template-columns: minmax(0, 1fr);
          gap: 6px;
          min-width: 0;
          margin-top: 8px;
          padding: 8px;
          border: 1px solid #fed7aa;
          border-radius: 8px;
          background: #fff7ed;
        }
        #${ROLEMATCH_PANEL_SHELL_ID} .rm-custom-card strong,
        #${ROLEMATCH_PANEL_SHELL_ID} .rm-custom-card span {
          display: block;
          position: static;
          float: none;
          width: auto;
          min-width: 0;
          max-width: 100%;
          line-height: 1.4;
          white-space: normal;
          overflow-wrap: anywhere;
        }
        #${ROLEMATCH_PANEL_SHELL_ID} .rm-custom-card span {
          color: #9a3412;
          font-size: 12px;
        }
        #${ROLEMATCH_PANEL_SHELL_ID} .rm-custom-card textarea {
          display: block;
          position: static;
          float: none;
          width: 100%;
          min-width: 0;
          max-width: 100%;
          min-height: 62px;
          resize: vertical;
          border: 1px solid #fdba74;
          border-radius: 7px;
          padding: 7px;
          font: inherit;
          color: #111827;
          background: #ffffff;
        }
        #${ROLEMATCH_PANEL_SHELL_ID} .rm-custom-card button {
          width: 100%;
        }
        #${ROLEMATCH_PANEL_SHELL_ID} .rm-muted {
          color: #64748b;
          margin: 0;
        }
        #${ROLEMATCH_PANEL_SHELL_ID} .rm-completion-card {
          display: grid;
          gap: 6px;
          margin-bottom: 10px;
          padding: 10px;
          border: 1px solid #86efac;
          border-radius: 8px;
          background: #f0fdf4;
          color: #14532d;
        }
        #${ROLEMATCH_PANEL_SHELL_ID} .rm-completion-card.rm-warning {
          border-color: #fde68a;
          background: #fffbeb;
          color: #92400e;
        }
        #${ROLEMATCH_PANEL_SHELL_ID} .rm-completion-card p {
          margin: 0;
        }
        #${ROLEMATCH_PANEL_SHELL_ID} .rm-completion-card button {
          justify-self: start;
          padding: 6px 8px;
          font-size: 12px;
        }
      </style>
      <div id="${ROLEMATCH_PANEL_SHELL_ID}">
        <div class="rm-head">
          <h2>RoleMatch Autofill</h2>
          <button class="rm-icon-button" type="button" data-rm-collapse title="Show or collapse panel" aria-expanded="true">-</button>
        </div>
        <div class="rm-body"></div>
      </div>
    `;
    document.documentElement.appendChild(panel);
    panelRoot.querySelector('[data-rm-collapse]')?.addEventListener('click', () => {
      panelRoot.querySelector(`#${ROLEMATCH_PANEL_SHELL_ID}`)?.classList.toggle('rm-collapsed');
      updateCollapseButton(panel);
    });
  }
  updateCollapseButton(panel);

  const body = panel.shadowRoot?.querySelector('.rm-body');
  if (!body) return;
  const summary = fillRunSummary();
  body.innerHTML = `
    <p class="rm-status"><strong>${escapeHtml(state.ats)}</strong> - ${escapeHtml(state.status)}</p>
    ${completionPanel()}
    ${summary ? `<p class="rm-muted">${escapeHtml(summary)}</p>` : (state.lastScan ? `<p class="rm-muted">Current scan: ${state.lastScan.matched}/${state.lastScan.total} visible fields have RoleMatch answers.</p>` : '')}
    <div class="rm-actions">
      <button type="button" class="rm-primary" data-rm-fill ${state.filling || state.paused ? 'disabled' : ''}>Fill visible fields</button>
      <button type="button" class="rm-pause" data-rm-pause data-paused="${state.paused}">${state.paused ? 'Resume extension' : 'Pause extension'}</button>
    </div>
    ${panelRows()}
    ${customAnswerPanel()}
  `;
  body.querySelector('[data-rm-fill]')?.addEventListener('click', () => {
    void fillCurrentTabWithLatestProfile();
  });
  body.querySelector('[data-rm-pause]')?.addEventListener('click', () => {
    void setExtensionPaused(!state.paused);
  });
  body.querySelector('[data-rm-hide-completion]')?.addEventListener('click', () => {
    void saveCompletionPromptSetting(false);
  });
  body.querySelectorAll('[data-rm-save-custom]').forEach((button) => {
    button.addEventListener('click', () => {
      const id = button.getAttribute('data-rm-save-custom');
      const textarea = body.querySelector(`[data-rm-custom-text="${CSS.escape(id || '')}"]`);
      void saveCustomAnswer(id, textarea?.value ?? '');
    });
  });
  body.querySelectorAll('[data-rm-custom-text]').forEach((textarea) => {
    textarea.addEventListener('input', () => {
      const key = textarea.getAttribute('data-rm-custom-key');
      if (key) state.customAnswerDrafts[key] = textarea.value;
    });
  });
}

function updateCollapseButton(panel) {
  const panelRoot = panel.shadowRoot;
  const shell = panelRoot?.querySelector(`#${ROLEMATCH_PANEL_SHELL_ID}`);
  const button = panelRoot?.querySelector('[data-rm-collapse]');
  if (!button) return;
  const collapsed = shell?.classList.contains('rm-collapsed') === true;
  button.textContent = collapsed ? '+' : '-';
  button.setAttribute('aria-expanded', collapsed ? 'false' : 'true');
}

async function saveCustomAnswer(id, answer) {
  if (state.paused) {
    state.status = 'Extension paused. Resume before saving an answer.';
    renderPanel();
    return;
  }

  const candidate = customAnswerCandidates().find((item) => item.id === id);
  const draftAnswer = candidate && Object.prototype.hasOwnProperty.call(state.customAnswerDrafts, candidate.key)
    ? state.customAnswerDrafts[candidate.key]
    : answer;
  const cleanAnswer = compactText(draftAnswer, 1200);
  if (!candidate || !cleanAnswer) {
    state.status = 'Enter an answer before saving.';
    renderPanel();
    return;
  }

  state.savingAnswerId = id;
  state.status = 'Saving custom answer';
  renderPanel();

  const response = await sendMessage({
    type: 'ROLEMATCH_SAVE_CUSTOM_ANSWER',
    answer: {
      intent: inferredCustomAnswerIntent({ label: candidate.label }),
      label: candidate.label,
      aliases: [candidate.label],
      keywords: candidate.keywords,
      answer: cleanAnswer,
    },
  }).catch((error) => ({ ok: false, error: error instanceof Error ? error.message : String(error) }));

  state.savingAnswerId = '';
  if (!response?.ok) {
    state.status = response?.error || 'Unable to save custom answer.';
    renderPanel();
    return;
  }

  if (response.profile) applyUpdatedProfile(response.profile);
  else refreshAfterCustomAnswerSave(state.profile, state.job);
  delete state.customAnswerDrafts[candidate.key];
  state.status = 'Custom answer saved. Select Fill visible fields to apply it.';
  renderPanel();
}

async function sendMessage(message) {
  return chrome.runtime.sendMessage(message);
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === 'ROLEMATCH_PROFILE_UPDATED') {
    const scan = applyUpdatedProfile(message.profile);
    const updatedStatus = 'Profile updated. Select Fill visible fields to apply the latest answers.';
    if (state.paused) state.statusBeforePause = updatedStatus;
    else state.status = updatedStatus;
    renderPanel();
    sendResponse({ ok: true, scan });
    return false;
  }

  if (message?.type === 'ROLEMATCH_PAUSE_STATE_CHANGED') {
    applyPauseState(message.paused);
    sendResponse({ ok: true, paused: state.paused });
    return false;
  }

  if (message?.type === 'ROLEMATCH_SETTINGS_CHANGED') {
    const autoAdvanceWasEnabled = state.settings.autoAdvanceEnabled === true;
    state.settings = { ...state.settings, ...(message.settings ?? {}) };
    applyPauseState(state.settings.paused === true);
    if (state.settings.autoAdvanceEnabled) {
      if (!autoAdvanceWasEnabled) state.lastAdvancedStepSignature = '';
      scheduleAutoAdvanceCheck('automatic step advancement enabled');
    } else if (autoAdvanceTimer) {
      window.clearTimeout(autoAdvanceTimer);
      autoAdvanceTimer = null;
    }
    if (state.settings.autoSubmitEnabled) scheduleAutoSubmitCheck('automatic submit enabled');
    if (state.settings.continueAfterLoginEnabled) {
      state.credentialLookupAttempted = false;
      scheduleCredentialLoginCheck();
    }
    sendResponse({ ok: true, settings: state.settings });
    return false;
  }

  if (message?.type === 'ROLEMATCH_SCAN_FIELDS') {
    if (state.paused) {
      sendResponse({ ok: false, paused: true, error: 'RoleMatch is paused. Resume the extension to continue.' });
      return false;
    }
    sendResponse({ ok: true, scan: scanFields() });
    renderPanel();
    return false;
  }

  if (message?.type === 'ROLEMATCH_OPEN_FORM') {
    if (state.paused) {
      sendResponse({ ok: false, paused: true, error: 'RoleMatch is paused. Resume the extension to continue.' });
      return false;
    }
    openApplicationForm()
      .then((response) => {
        scanFields();
        renderPanel();
        sendResponse(response);
      })
      .catch((error) => sendResponse({ ok: false, error: error instanceof Error ? error.message : String(error) }));
    return true;
  }

  if (message?.type === 'ROLEMATCH_FILL_FIELDS') {
    if (state.paused) {
      sendResponse({ ok: false, paused: true, error: 'RoleMatch is paused. Resume the extension to continue.' });
      return false;
    }
    state.profile = message.profile ?? state.profile;
    state.job = message.job ?? state.job;
    fillVisibleFields(state.profile, state.job)
      .then((response) => sendResponse(response))
      .catch((error) => sendResponse({ ok: false, error: error instanceof Error ? error.message : String(error) }));
    return true;
  }

  return false;
});

async function init() {
  attachSubmitCompletionHandlers();
  attachDynamicFieldObserver();
  await loadSettings();
  state.job = currentPageJobContext(state.job);
  renderPanel();
  if (!state.paused) scanFields();
  renderPanel();
  scheduleHydratedFieldRescans();

  const response = await sendMessage({
    type: 'ROLEMATCH_ATS_READY',
    url: window.location.href,
    ats: state.ats,
    fieldCount: collectFields().length,
    isTopFrame: window.top === window,
    job: state.job,
  }).catch((error) => ({ ok: false, error: error instanceof Error ? error.message : String(error) }));

  if (!response?.ok) {
    state.status = response?.error || 'Connect RoleMatch before autofill.';
    renderPanel();
    return;
  }

  state.sessionId = response.sessionId || state.sessionId;
  state.submitIntentAt = response.submitIntentAt || state.submitIntentAt;
  if (state.submitIntentAt) {
    scheduleSubmissionConfirmationChecks('ATS success page');
    await maybeConfirmApplicationSubmission('ATS success page');
  }

  if (response.settings) {
    state.settings = {
      ...state.settings,
      ...response.settings,
    };
    applyPauseState(response.settings.paused === true);
  }

  if (response.shouldAutoFill) {
    state.profile = response.profile;
    state.job = response.job;
    await waitUntilResumed();
    state.status = 'Opening application form';
    renderPanel();
    await openApplicationForm();
    await wait(500);
    if (!state.paused) scanFields(state.profile, state.job);
    renderPanel();
    await fillVisibleFields(state.profile, state.job);
  } else {
    if (response.profile) state.profile = response.profile;
    if (response.job) state.job = response.job;
    const connectedStatus = 'Connected. Use Fill visible fields when ready.';
    if (state.paused) {
      state.statusBeforePause = connectedStatus;
      state.status = 'Extension paused.';
    } else {
      state.status = connectedStatus;
    }
    if (!state.profile) {
      const profileResponse = await sendMessage({ type: 'ROLEMATCH_GET_PROFILE' }).catch(() => null);
      if (profileResponse?.ok) state.profile = profileResponse.profile;
    }
    scanFields(state.profile, state.job);
    renderPanel();
  }
}

void init();
