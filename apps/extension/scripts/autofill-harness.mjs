import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

class TestHTMLElement {
  constructor(attributes = {}) {
    this.attributes = new Map(Object.entries(attributes).map(([key, value]) => [key, String(value)]));
    this.children = [];
    this.parentElement = null;
    this.disabled = false;
    this.type = attributes.type || 'text';
    this.id = attributes.id || '';
    this.tagName = attributes.tagName || 'INPUT';
    this.textContent = attributes.textContent || '';
    this.innerText = attributes.innerText || this.textContent;
    this.className = attributes.className || '';
    this.clicked = false;
    this.checked = false;
    this.required = Boolean(attributes.required);
    this.labels = attributes.labels || null;
    this.files = null;
    this.events = [];
    this.rect = attributes.rect || { width: 100, height: 28 };
  }

  get value() {
    return this._value ?? '';
  }

  set value(value) {
    this._value = String(value ?? '');
  }

  getAttribute(name) {
    if (name === 'id') return this.id || null;
    if (name === 'type') return this.type || null;
    if (name === 'class') return this.className || null;
    return this.attributes.get(name) ?? null;
  }

  setAttribute(name, value) {
    this.attributes.set(name, String(value));
    if (name === 'id') this.id = String(value);
    if (name === 'type') this.type = String(value);
  }

  dispatchEvent(event) {
    this.events.push(event.type);
    return true;
  }

  getBoundingClientRect() {
    return this.rect;
  }

  attachShadow() {
    this.shadowRoot = {
      innerHTML: '',
      querySelector() {
        return null;
      },
      querySelectorAll() {
        return [];
      },
    };
    return this.shadowRoot;
  }

  scrollIntoView() {}

  focus() {
    this.focused = true;
  }

  click() {
    this.clicked = true;
    this.dispatchEvent(new TestEvent('click'));
    if (this.type === 'radio') this.checked = true;
    if (this.type === 'checkbox') this.checked = !this.checked;
    if (this.getAttribute('role') === 'radio') {
      this.setAttribute('aria-checked', 'true');
      const nestedRadio = this.querySelector('input[type="radio"]');
      if (nestedRadio) nestedRadio.checked = true;
    }
  }

  closest(selector) {
    const selectors = String(selector).split(',').map((part) => part.trim());
    let node = this.parentElement;
    while (node) {
      if (
        selectors.some((part) => (
          (part === '.select__control' && String(node.className).includes('select__control'))
          || (part === '.application-question' && String(node.className).includes('application-question'))
          || (part === 'li' && String(node.tagName).toLowerCase() === 'li')
          || (part.startsWith('#') && node.id === part.slice(1))
           || (part.startsWith('.') && String(node.className).split(/\s+/).includes(part.slice(1)))
           || (part === '[role="group"]' && node.getAttribute('role') === 'group')
           || (part === '[role="radio"]' && node.getAttribute('role') === 'radio')
           || (part === '[role="checkbox"]' && node.getAttribute('role') === 'checkbox')
           || (part === '[role="option"]' && node.getAttribute('role') === 'option')
          || (part === '[data-automation-id="promptOption"]' && node.getAttribute('data-automation-id') === 'promptOption')
          || (part === '[data-automation-id="menuItem"]' && node.getAttribute('data-automation-id') === 'menuItem')
          || (part === 'spl-input' && String(node.tagName).toLowerCase() === 'spl-input')
          || (part === 'spl-select-option' && String(node.tagName).toLowerCase() === 'spl-select-option')
          || (part === 'spl-dropdown-item' && String(node.tagName).toLowerCase() === 'spl-dropdown-item')
          || (part === 'oj-select-single' && String(node.tagName).toLowerCase() === 'oj-select-single')
          || (part === 'oj-select-many' && String(node.tagName).toLowerCase() === 'oj-select-many')
          || (part === 'oj-combobox-one' && String(node.tagName).toLowerCase() === 'oj-combobox-one')
          || (part === 'oj-combobox-many' && String(node.tagName).toLowerCase() === 'oj-combobox-many')
          || (part === 'oj-input-search' && String(node.tagName).toLowerCase() === 'oj-input-search')
          || (/^[a-z][a-z0-9-]*$/i.test(part) && String(node.tagName).toLowerCase() === part.toLowerCase())
          || (part === '[class*="control"]' && String(node.className).includes('control'))
          || (part === '[class*="Control"]' && String(node.className).includes('Control'))
        ))
      ) return node;
      node = node.parentElement;
    }
    return null;
  }

  querySelector(selector) {
    if (selector === 'h4, [role="heading"]') {
      return this.children.find((child) => String(child.tagName).toUpperCase() === 'H4' || child.getAttribute('role') === 'heading') ?? null;
    }
    if (selector.includes('input[type="checkbox"]') || selector.includes('input[type="radio"]')) {
      return this.children.find((child) => ['checkbox', 'radio'].includes(String(child.type).toLowerCase())) ?? null;
    }
    if (selector.includes('ant-select-selection-item') || selector.includes('select__single-value') || selector.includes('singleValue')) {
      return this.children.find((child) => (
        String(child.className).includes('ant-select-selection-item')
        || String(child.className).includes('select__single-value')
      )) ?? null;
    }
    return null;
  }

  querySelectorAll(selector) {
    if (selector === 'button') {
      return this.children.filter((child) => String(child.tagName).toUpperCase() === 'BUTTON');
    }
    if (selector.includes('[role="radio"]') || selector.includes('input[type="radio"]')) {
      return this.children.filter((child) => child.getAttribute('role') === 'radio' || child.type === 'radio');
    }
    if (selector.includes('[role="checkbox"]') || selector.includes('input[type="checkbox"]')) {
      return this.children.filter((child) => child.getAttribute('role') === 'checkbox' || child.type === 'checkbox');
    }
    if (selector === '[data-automation-id="selectedItem"]') {
      return this.children.filter((child) => child.getAttribute('data-automation-id') === 'selectedItem');
    }
    return [];
  }
}

class TestInputElement extends TestHTMLElement {}
class TestTextAreaElement extends TestHTMLElement {}

class TestEvent {
  constructor(type, options = {}) {
    this.type = type;
    Object.assign(this, options);
  }
}

class TestKeyboardEvent extends TestEvent {}
class TestMouseEvent extends TestEvent {}
class TestPointerEvent extends TestEvent {}

class TestDataTransfer {
  constructor() {
    const files = [];
    this.files = files;
    this.items = {
      add(file) {
        files.push(file);
      },
    };
  }
}

function makeNode(textContent) {
  return { textContent, innerText: textContent };
}

function loadAutofillContext({
  labels = {},
  options = [],
  elements = [],
  fileResponse = null,
  runtimeHandler = null,
  hostname = 'job-boards.greenhouse.io',
  href = 'https://job-boards.greenhouse.io/remesh/jobs/8450776002',
  pageTitle = '',
  pageHeading = '',
  pageText = '',
} = {}) {
  const root = path.resolve(import.meta.dirname, '..');
  const parsedLocation = new URL(href);
  const runtimeMessages = [];
  const source = fs.readFileSync(path.join(root, 'src', 'atsAutofill.js'), 'utf8')
    .replace(/void init\(\);\s*$/, '');

  const documentMock = {
    title: pageTitle,
    body: {
      innerText: pageText,
      textContent: pageText,
    },
    querySelector(selector) {
      if (selector === 'h1') return pageHeading ? makeNode(pageHeading) : null;
      const labelMatch = selector.match(/^label\[for="(.+)"\]$/);
      if (labelMatch) return labels[labelMatch[1]] ? makeNode(labels[labelMatch[1]]) : null;
      return null;
    },
    querySelectorAll(selector) {
      if (selector.includes('h1') && pageHeading) return [makeNode(pageHeading)];
      if (selector.includes('[role="option"]') || selector.includes('.select__option')) return options;
      if (selector.includes('ukg-button') || selector.includes('input[type="button"]')) return elements;
      const radioNameMatch = selector.match(/^input\[type="radio"\]\[name="(.+)"\]$/);
      if (radioNameMatch) {
        return elements.filter((element) => element.type === 'radio' && element.getAttribute('name') === radioNameMatch[1]);
      }
      const checkboxNameMatch = selector.match(/^input\[type="checkbox"\]\[name="(.+)"\]$/);
      if (checkboxNameMatch) {
        return elements.filter((element) => element.type === 'checkbox' && element.getAttribute('name') === checkboxNameMatch[1]);
      }
      const idPrefixMatch = selector.match(/^\[id\^="(.+)"\]$/);
      if (idPrefixMatch) {
        return elements.filter((element) => String(element.id || '').startsWith(idPrefixMatch[1]));
      }
      if (
        selector.includes('input:not([type="hidden"])')
        || selector.includes('textarea')
        || selector.includes('select')
        || selector.includes('[role="combobox"]')
        || selector.includes('[role="radio"]')
        || selector.includes('[role="checkbox"]')
      ) {
        return elements;
      }
      return [];
    },
    getElementById(id) {
      const element = elements.find((candidate) => candidate.id === id);
      if (element) return element;
      return labels[id] ? makeNode(labels[id]) : null;
    },
    createElement() {
      return new TestHTMLElement({ tagName: 'ASIDE' });
    },
    documentElement: {
      appendChild() {},
    },
  };

  const context = {
    assert,
    Blob,
    File,
    Promise,
    URL,
    console,
    setTimeout,
    clearTimeout,
    atob: (value) => Buffer.from(value, 'base64').toString('binary'),
    btoa: (value) => Buffer.from(value, 'binary').toString('base64'),
    DataTransfer: TestDataTransfer,
    Event: TestEvent,
    KeyboardEvent: TestKeyboardEvent,
    MouseEvent: TestMouseEvent,
    PointerEvent: TestPointerEvent,
    HTMLElement: TestHTMLElement,
    CSS: { escape: (value) => String(value) },
    window: {
      HTMLInputElement: TestInputElement,
      HTMLTextAreaElement: TestTextAreaElement,
      location: { hostname, href, pathname: parsedLocation.pathname },
      getComputedStyle: (element) => ({
        display: element?.getAttribute?.('data-test-display') || 'block',
        visibility: element?.getAttribute?.('data-test-visibility') || 'visible',
        opacity: element?.getAttribute?.('data-test-opacity') || '1',
      }),
      setTimeout,
    },
    document: documentMock,
    chrome: {
      runtime: {
        onMessage: { addListener() {} },
        sendMessage: async (message) => {
          runtimeMessages.push(message);
          if (runtimeHandler) return runtimeHandler(message);
          return fileResponse ?? { ok: false, error: 'not connected' };
        },
      },
    },
    runtimeMessages,
  };

  vm.createContext(context);
  vm.runInContext(source, context);
  return context;
}

function profileFixture(overrides = {}) {
  const fixtureBirthYear = new Date().getFullYear() - 22;

  return {
    fullName: 'Alex Morgan',
    dateOfBirth: `${fixtureBirthYear}-01-01`,
    email: 'alex.morgan@example.com',
    phone: '(617) 555-0142',
    location: 'Boston, Massachusetts, United States',
    linkedinUrl: 'https://www.linkedin.com/in/alex-morgan-example',
    githubUrl: 'https://github.com/alex-morgan-example',
    portfolioUrl: 'https://alex-morgan.example.com',
    workAuthorization: 'Yes',
    education: 'Example Institute of Technology, Bachelor of Science in Computer Science',
    educationHistory: [{
      school: 'Example Institute of Technology',
      degree: 'Bachelor of Science',
      field: 'Computer Science',
    }],
    veteranStatus: 'No military service / not a protected veteran',
    disabilityStatus: 'No, I do not have a disability, or have a history/record of having a disability',
    gender: 'Male',
    race: 'White',
    skills: ['Python', 'Java', 'SQL', 'React', 'JavaScript', 'OpenAI Codex'],
    workHistory: [{ current: true, company: 'RoleMatch', skills: ['unit tests', 'React'] }],
    projectHistory: [{ technologies: ['Node.js', 'PostgreSQL'] }],
    autofillAnswers: {
      yearsProfessionalExperience: '1',
      yearsSoftwareExperience: '2',
      sponsorshipRequired: 'No',
      willingToRelocate: 'Yes',
      custom: [
        { label: 'Country', keywords: 'country united states', answer: 'United States' },
      ],
    },
    documents: [{
      documentType: 'resume',
      label: 'Primary resume',
      fileName: 'Alex_Morgan_Resume.docx',
      fileUrl: '/uploads/profile-documents/resume.docx',
      mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      uploadedAt: '2026-06-28T12:00:00.000Z',
    }],
    ...overrides,
  };
}

function answerMatrixTest() {
  const context = loadAutofillContext();
  const profile = profileFixture();
  const job = { title: 'Software Engineer', company: 'Remesh' };
  const today = new Date();
  const todayIso = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
  const cases = [
    ['first', 'First Name* | First Name | first_name | given-name', 'text', { action: 'fill', answer: 'Alex' }],
    ['last', 'Last Name* | Last Name | last_name | family-name', 'text', { action: 'fill', answer: 'Morgan' }],
    ['email', 'Email* | Email | email', 'text', { action: 'fill', answer: 'alex.morgan@example.com' }],
    ['country', 'Country* | country | off', 'text', { action: 'fill', answer: 'United States' }],
    ['phone', 'Phone* | Phone | phone | off', 'tel', { action: 'fill', answer: '(617) 555-0142' }],
    ['dob', 'Date of birth', 'text', { action: 'fill', answer: profile.dateOfBirth }],
    ['disability-signature-date', 'Date | eeo[disabilitySignatureDate] | off', 'text', { action: 'fill', answer: todayIso }],
    ['age', 'Age', 'text', { action: 'fill', answer: '22' }],
    ['over-18', 'Are you at least 18 years old?', 'combobox', { action: 'fill', answer: 'Yes' }],
    ['full', 'Full name* | name', 'text', { action: 'fill', answer: 'Alex Morgan' }],
    ['company', 'Current company', 'text', { action: 'fill', answer: 'RoleMatch' }],
    ['resume', 'Resume/CV* Attach Accepted file types: pdf, doc, docx, txt, rtf', 'file', { action: 'file', answer: 'Alex_Morgan_Resume.docx' }],
    ['cover', 'Cover Letter Attach Accepted file types: pdf, doc, docx, txt, rtf', 'file', { action: 'skip' }],
    ['refer', 'Did someone at Remesh refer you to this position?', 'text', { action: 'fill', answer: 'No' }],
    ['source', 'How did you hear about this job?', 'text', { action: 'fill', answer: 'Company careers page' }],
    ['third-party-employment', 'Have you ever worked as a temporary or contract employee through a 3rd party at Broadcom?', 'combobox', { action: 'fill', answer: 'No' }],
    ['government-employment', 'Are you now, or have you been in the last five years, employed by any entity of the federal, state or local government?', 'combobox', { action: 'fill', answer: 'No' }],
    ['location', 'Where are you currently located? (City, State)', 'text', { action: 'fill', answer: 'Boston, Massachusetts' }],
    ['remote', 'Are you willing to work remotely?', 'combobox', { action: 'fill', answer: 'Yes' }],
    ['school', 'School | school--0 | off | Select...', 'combobox', { action: 'fill', answer: 'Example Institute of Technology' }],
    ['degree', 'Degree* | degree--0 | off | Select...', 'combobox', { action: 'fill', answer: 'Bachelor of Science' }],
    ['discipline', 'Discipline | discipline--0 | off | Select...', 'combobox', { action: 'fill', answer: 'Computer Science' }],
    ['years', 'How many years of professional software development experience do you have?', 'text', { action: 'fill', answer: '2' }],
    ['js', 'What is your level of experience with JavaScript?', 'combobox', { action: 'fill', answer: 'Intermediate' }],
    ['ai', 'What is your level of experience with AI-Assisted development tools?', 'combobox', { action: 'fill', answer: 'Advanced' }],
    ['go', 'What is your level of experience with Go?', 'combobox', { action: 'fill', answer: 'No professional experience' }],
    ['unit', 'What is your level of experience with unit tests and testing best practices?', 'combobox', { action: 'fill', answer: 'Intermediate' }],
    ['auth', 'Are you legally authorized to work in the United States?', 'combobox', { action: 'fill', answer: 'Yes' }],
    ['based-us-canada', 'If hired by Warp, will you be based in the U.S. or Canada?', 'combobox', { action: 'fill', answer: 'Yes' }],
    ['permanent-auth', 'Do you have permanent authorization to work for Warp in the U.S. or Canada?', 'combobox', { action: 'fill', answer: 'Yes' }],
    ['require-work-auth', 'Do you require work authorization?', 'text', { action: 'fill', answer: 'No, I am legally authorized to work and do not require sponsorship.' }],
    ['sponsor', 'Will you now or in the future require sponsorship for employment visa status?', 'combobox', { action: 'fill', answer: 'No' }],
    ['hispanic', 'Are you Hispanic/Latino?', 'combobox', { action: 'fill', answer: 'No' }],
    ['hispanic-id', 'Are you Hispanic/Latino? | hispanic_ethnicity | off', 'combobox', { action: 'fill', answer: 'No' }],
    ['hispanic-race-label', 'Race | Are you Hispanic/Latino? | hispanic_ethnicity | off', 'combobox', { action: 'fill', answer: 'No' }],
    ['application-security-code', 'Application Challenge: Security Code (format: ABC-123-XYZ)', 'text', { action: 'skip' }],
    ['generic-security-code', 'Security code', 'text', { action: 'skip' }],
    ['checkbox-name', 'Use name only | pronouns | useNameOnlyPronounsOption', 'checkbox', { action: 'skip' }],
    ['relocate-prose', 'This is a hybrid position located in Minnesota - are you currently located in Minnesota or willing to relocate?', 'radio', { action: 'fill', answer: 'Yes' }],
    ['non-compete', 'Have you entered into a non-disclosure or non-compete agreement understanding of any kind?', 'combobox', { action: 'fill', answer: 'No' }],
    ['afs-past', 'Have you worked at Accenture Federal Services in the past?', 'combobox', { action: 'fill', answer: 'No' }],
    ['afs-source', 'How did you hear about us?', 'combobox', { action: 'fill', answer: 'Company careers page' }],
    ['afs-clearance', 'Do you hold a security clearance?', 'combobox', { action: 'fill', answer: 'No' }],
    ['afs-current-employer', 'Does your current employer have or has your current employer had a working relationship with Accenture Federal Services in the past 24 months?', 'combobox', { action: 'fill', answer: 'No' }],
    ['afs-current-government', 'Are you currently an employee of the U.S. Government?', 'combobox', { action: 'fill', answer: 'No' }],
    ['afs-reserves', 'Will you be serving in the Reserves or National Guard while working for Accenture Federal Services?', 'combobox', { action: 'fill', answer: 'No' }],
    ['afs-past-government', 'Were you an employee of the U.S. Government within the past 10 years?', 'combobox', { action: 'fill', answer: 'No' }],
    ['afs-family', 'Do you have relatives/family members or close personal relationships who work at Adventure Federal Services?', 'combobox', { action: 'fill', answer: 'No' }],
    ['afs-family-followup', 'If yes, please list their name and relationship to you.', 'text', { action: 'skip' }],
    ['sf-relatives-followup', 'If you have any relative working with HSBC group, please provide name & additional information such as location, job title, department etc.', 'textarea', { action: 'skip' }],
    ['sf-former-employee-id', 'If you were formerly employed by HSBC Group or currently engaged as a contractor, consultant or Service Provider please provide your Employee ID', 'text', { action: 'skip' }],
    ['sf-diversity-consent', 'Diversity and Inclusion Consent', 'combobox', { action: 'skip' }],
    ['sf-authorization-document-note', 'Are you eligible to work in the country/territory where this role is based? Please note, verification checks will be conducted, and you may be required to present your passport, work visa, and/or national ID during the onboarding process.', 'combobox', { action: 'fill', answer: 'Yes' }],
    ['sf-external-auditor', 'Have you been employed, or are still employed, by HSBC external auditors?', 'combobox', { action: 'fill', answer: 'No' }],
    ['afs-affirmation', 'Affirmation: I agree that the above information is accurate.', 'combobox', { action: 'fill', answer: 'I agree' }],
    ['essay', 'If I asked your siblings or close friends to write your Twitter bio, what would they write?', 'textarea', { action: 'skip' }],
  ];

  for (const [key, label, type, expected] of cases) {
    const actual = context.answerForField({ label, type }, profile, job);
    assert.equal(actual.action, expected.action, `${key} action`);
    if ('answer' in expected) assert.equal(actual.answer, expected.answer, `${key} answer`);
  }

  const profileWithLearnedChallenge = profileFixture({
    autofillAnswers: {
      ...profile.autofillAnswers,
      custom: [
        ...(profile.autofillAnswers.custom ?? []),
        {
          label: 'Application Challenge: Security Code (format: ABC-123-XYZ)',
          keywords: 'challenge security code format',
          answer: 'ABC-123-XYZ',
        },
      ],
    },
  });
  const learnedChallenge = context.answerForField(
    { label: 'Application Challenge: Security Code (format: ABC-123-XYZ)', type: 'text' },
    profileWithLearnedChallenge,
    job,
  );
  assert.equal(learnedChallenge.action, 'fill', 'learned application challenge action');
  assert.equal(learnedChallenge.answer, 'ABC-123-XYZ', 'learned application challenge answer');

  const profileWithManualWarpLink = profileFixture({
    autofillAnswers: {
      ...profile.autofillAnswers,
      custom: [
        ...(profile.autofillAnswers.custom ?? []),
        {
          label: 'Application Challenge: Link to Warp Shared Block containing the command',
          keywords: 'challenge link warp shared block command',
          answer: 'Manual: create and paste the Warp Shared Block URL after running the challenge command in Warp.',
        },
      ],
    },
  });
  const manualWarpLink = context.answerForField(
    { label: 'Application Challenge: Link to Warp Shared Block containing the command', type: 'text' },
    profileWithManualWarpLink,
    job,
  );
  assert.equal(manualWarpLink.action, 'skip', 'manual Warp shared block placeholder action');
  assert.equal(manualWarpLink.reason, 'manual custom answer placeholder', 'manual Warp shared block placeholder reason');

  const profileWithWarpUrl = profileFixture({
    autofillAnswers: {
      ...profile.autofillAnswers,
      custom: [
        ...(profile.autofillAnswers.custom ?? []),
        {
          label: 'Application Challenge: Link to Warp Shared Block containing the command',
          keywords: 'challenge link warp shared block command',
          answer: 'https://app.warp.dev/block/example',
        },
      ],
    },
  });
  const warpUrl = context.answerForField(
    { label: 'Application Challenge: Link to Warp Shared Block containing the command', type: 'text' },
    profileWithWarpUrl,
    job,
  );
  assert.equal(warpUrl.action, 'fill', 'real Warp shared block URL action');
  assert.equal(warpUrl.answer, 'https://app.warp.dev/block/example', 'real Warp shared block URL answer');
}

function requestedAtsRegressionMatrixTest() {
  const adapters = [
    ['Greenhouse', 'job-boards.greenhouse.io', 'https://job-boards.greenhouse.io/example/jobs/100'],
    ['iCIMS', 'careers-example.icims.com', 'https://careers-example.icims.com/jobs/100/software-engineer/job'],
    ['SmartRecruiters', 'jobs.smartrecruiters.com', 'https://jobs.smartrecruiters.com/Example/100-software-engineer'],
    ['SuccessFactors', 'career8.successfactors.com', 'https://career8.successfactors.com/careers?career_job_req_id=100&career_ns=job_application'],
    ['Oracle Recruiting Cloud', 'example.fa.us2.oraclecloud.com', 'https://example.fa.us2.oraclecloud.com/hcmUI/CandidateExperience/en/sites/CX/job/100/apply/email'],
    ['Taleo', 'example.taleo.net', 'https://example.taleo.net/careersection/ex/jobdetail.ftl?job=100'],
    ['UKG Pro Recruiting', 'recruiting.ultipro.com', 'https://recruiting.ultipro.com/ABC100/JobBoard/board/OpportunityDetail?opportunityId=100'],
    ['Dayforce', 'jobs.dayforcehcm.com', 'https://jobs.dayforcehcm.com/en-US/example/CANDIDATEPORTAL/jobs/100/apply?flowSelection=true'],
  ];
  const profile = profileFixture();
  const job = { title: 'Software Engineer', company: 'Example Company' };
  const cases = [
    ['First name', 'text', 'fill', 'Alex'],
    ['Last name', 'text', 'fill', 'Morgan'],
    ['Email address', 'email', 'fill', 'alex.morgan@example.com'],
    ['Mobile phone number', 'tel', 'fill', '(617) 555-0142'],
    ['Full legal name', 'text', 'fill', 'Alex Morgan'],
    ['Current company', 'text', 'fill', 'RoleMatch'],
    ['LinkedIn profile URL', 'text', 'fill', 'https://www.linkedin.com/in/alex-morgan-example'],
    ['GitHub URL', 'text', 'fill', 'https://github.com/alex-morgan-example'],
    ['Portfolio website', 'text', 'fill', 'https://alex-morgan.example.com'],
    ['Country', 'combobox', 'fill', 'United States'],
    ['City', 'text', 'fill', 'Boston'],
    ['State or province', 'combobox', 'fill', 'Massachusetts'],
    ['Where are you currently located?', 'text', 'fill', 'Boston, Massachusetts'],
    ['Are you legally authorized to work in the United States?', 'combobox', 'fill', 'Yes'],
    ['Will you require employment visa sponsorship?', 'combobox', 'fill', 'No'],
    ['Are you willing to work remotely?', 'combobox', 'fill', 'Yes'],
    ['Are you willing to relocate?', 'combobox', 'fill', 'Yes'],
    ['How did you hear about us?', 'combobox', 'fill', 'Company careers page'],
    ['Were you referred by an employee?', 'combobox', 'fill', 'No'],
    ['School or university', 'combobox', 'fill', 'Example Institute of Technology'],
    ['Degree', 'combobox', 'fill', 'Bachelor of Science'],
    ['Major or field of study', 'combobox', 'fill', 'Computer Science'],
    ['Resume/CV upload', 'file', 'file', 'Alex_Morgan_Resume.docx'],
    ['Cover letter upload', 'file', 'skip', ''],
    ['Date of birth', 'date', 'fill', profile.dateOfBirth],
    ['Are you at least 18 years old?', 'combobox', 'fill', 'Yes'],
    ['Are you subject to a non-compete agreement?', 'combobox', 'fill', 'No'],
    ['Have you previously worked for this company?', 'combobox', 'fill', 'No'],
    ['Are you currently an employee of the U.S. Government?', 'combobox', 'fill', 'No'],
    ['Do you have a family member who works here?', 'combobox', 'fill', 'No'],
    ['Are you willing to complete a background check?', 'combobox', 'fill', 'Yes'],
    ['Affirmation: I agree that this application is accurate.', 'combobox', 'fill', 'I agree'],
    ['Veteran status', 'combobox', 'fill', 'No military service / not a protected veteran'],
    ['Disability status', 'combobox', 'fill', 'No, I do not have a disability, or have a history/record of having a disability'],
    ['Gender', 'combobox', 'fill', 'Male'],
    ['Are you Hispanic or Latino?', 'combobox', 'fill', 'No'],
    ['Race/Ethnicity', 'combobox', 'fill', 'White'],
    ['How many years of software development experience do you have?', 'text', 'fill', '2'],
    ['What is your level of experience with AI-assisted development tools?', 'combobox', 'fill', 'Advanced'],
    ['Application Challenge: provide the requested employer-specific code', 'text', 'skip', ''],
  ];

  assert.equal(cases.length, 40);
  for (const [ats, hostname, href] of adapters) {
    const context = loadAutofillContext({ hostname, href });
    assert.equal(context.detectAts(), ats);
    cases.forEach(([label, type, action, answer], index) => {
      const actual = context.answerForField({ label, type }, profile, job);
      assert.equal(actual.action, action, `${ats} scenario ${index + 1}: ${label}`);
      if (answer) assert.equal(actual.answer, answer, `${ats} scenario ${index + 1}: ${label}`);
    });
  }

  return { adapters: adapters.length, scenariosPerAdapter: cases.length };
}

function customAnswerIntentLibraryTest() {
  const context = loadAutofillContext();
  const profile = profileFixture({
    autofillAnswers: {
      ...profileFixture().autofillAnswers,
      custom: [
        {
          intent: 'requires_sponsorship',
          label: 'Will you require employment visa sponsorship?',
          aliases: [
            'Will you now or in the future require sponsorship?',
            'Will the company need to sponsor your work authorization?',
          ],
          keywords: 'sponsorship visa work authorization',
          answer: 'No',
        },
        {
          intent: 'apac_hours_availability',
          label: 'Are you available to work APAC business hours?',
          aliases: [
            'Can you cover an Asia Pacific schedule?',
            'Are overnight APAC support hours acceptable?',
          ],
          answer: 'Yes',
        },
        {
          label: 'Application Challenge: Security Code',
          keywords: 'challenge security code format',
          answer: 'ABC-123-XYZ',
        },
        {
          label: 'Production experience',
          keywords: 'production experience',
          answer: 'Broad legacy answer',
        },
        {
          intent: 'production_sql_experience',
          label: 'How many years of production SQL experience do you have?',
          aliases: ['How much experience do you have using SQL in production?'],
          answer: 'Less than 1 year',
        },
      ],
    },
  });

  [
    'Do you require visa sponsorship?',
    'Will you now or in the future need employment sponsorship from the company?',
    'Will the company need to sponsor your work authorization?',
  ].forEach((question) => {
    assert.equal(context.customAnswer(profile, question), 'No', `intent alias: ${question}`);
  });
  assert.equal(
    context.customAnswer(profile, 'Can you cover an Asia Pacific schedule?'),
    'Yes',
    'each alias is evaluated independently instead of as one AND keyword list',
  );
  assert.equal(
    context.customAnswer(profile, 'Application Challenge: Security Code (format ABC-123-XYZ)'),
    'ABC-123-XYZ',
    'legacy labels and keywords remain supported',
  );
  assert.equal(
    context.customAnswer(profile, 'How much experience do you have using SQL in production?'),
    'Less than 1 year',
    'specific alias outranks a broad legacy keyword match',
  );

  const existingProfileEntry = profileFixture({
    autofillAnswers: {
      ...profileFixture().autofillAnswers,
      custom: [{
        label: 'Visa sponsorship',
        keywords: 'sponsor sponsorship visa require sponsorship now future',
        answer: 'No',
      }],
    },
  });
  assert.equal(
    context.customAnswer(existingProfileEntry, 'Will the company need to sponsor your work authorization?'),
    'No',
    'a recognized legacy label inherits the shared intent aliases without a profile migration',
  );

  const variantProfile = profileFixture({
    autofillAnswers: {
      ...profileFixture().autofillAnswers,
      custom: [{
        intent: 'backend_api_testing_experience',
        label: 'Do you have backend or API testing experience?',
        aliases: ['Describe your experience testing backend APIs.'],
        answer: 'Yes',
        shortAnswer: 'Yes',
        longAnswer: 'Yes. I have tested authentication, database-backed workflows, failure cases, and regressions.',
      }],
    },
  });
  assert.equal(
    context.customAnswer(
      variantProfile,
      'Do you have backend or API testing experience?',
      { label: 'Do you have backend or API testing experience?', type: 'select', options: [{ text: 'Yes' }, { text: 'No' }] },
    ),
    'Yes',
    'choice fields use the concise answer variant',
  );
  assert.equal(
    context.customAnswer(
      variantProfile,
      'Describe your experience testing backend APIs.',
      { label: 'Describe your experience testing backend APIs.', type: 'textarea' },
    ),
    'Yes. I have tested authentication, database-backed workflows, failure cases, and regressions.',
    'open-ended fields use the detailed answer variant',
  );

  const conflictingProfile = profileFixture({
    autofillAnswers: {
      ...profileFixture().autofillAnswers,
      custom: [
        { label: 'Are you willing to travel?', aliases: ['Can you travel for work?'], answer: 'Yes' },
        { label: 'Are you willing to travel?', aliases: ['Can you travel for work?'], answer: 'No' },
      ],
    },
  });
  assert.equal(
    context.customAnswer(conflictingProfile, 'Can you travel for work?'),
    '',
    'equally strong conflicting answers remain manual',
  );
}

async function pauseResumeAutofillTest() {
  const firstName = new TestInputElement({
    id: 'first_name',
    tagName: 'INPUT',
    type: 'text',
    name: 'first_name',
  });
  const context = loadAutofillContext({
    labels: { first_name: 'First Name' },
    elements: [firstName],
  });

  context.applyPauseState(true);
  const fillPromise = context.fillVisibleFields(profileFixture(), {});
  await new Promise((resolve) => setTimeout(resolve, 25));

  assert.equal(context.extensionIsPaused(), true);
  assert.equal(firstName.value, '', 'paused autofill must not change fields');

  context.applyPauseState(false);
  const result = await fillPromise;

  assert.equal(result.ok, true);
  assert.equal(context.extensionIsPaused(), false);
  assert.equal(firstName.value, 'Alex', 'autofill should continue after resume');
}

async function failedPausePersistenceTest() {
  const context = loadAutofillContext();

  context.applyPauseState(true);
  assert.equal(await context.setExtensionPaused(false), false);
  assert.equal(context.extensionIsPaused(), true, 'failed resume persistence must keep autofill paused');

  context.applyPauseState(false);
  assert.equal(await context.setExtensionPaused(true), false);
  assert.equal(context.extensionIsPaused(), false, 'failed pause persistence must restore the previous state');
}

function currentCompanyFallbackTest() {
  const context = loadAutofillContext();
  const profile = profileFixture({
    workHistory: [{ current: false, company: 'BirthdayMessaging.io', skills: ['Python'] }],
  });
  const answer = context.answerForField({ label: 'Current company', type: 'text' }, profile, {});
  assert.equal(answer.action, 'fill');
  assert.equal(answer.answer, 'N/A');
}

function federalOptionMatchingTest() {
  const context = loadAutofillContext();

  assert.equal(
    context.optionMatches('Example Institute of Technology', 'Example Institute of Technology', 'School'),
    true,
    'school option match',
  );
  assert.equal(
    context.optionMatches("Bachelor's degree", 'Bachelor of Science', 'Degree'),
    true,
    'degree option match',
  );
  assert.equal(
    context.optionMatches('Computer Science', 'Computer Science', 'Discipline'),
    true,
    'discipline option match',
  );
  assert.equal(
    context.optionMatches('None', 'No', 'Do you hold a security clearance?'),
    true,
    'security clearance none option match',
  );
  assert.equal(
    context.optionMatches('Company Website', 'Company careers page', 'How did you hear about us?'),
    true,
    'company source option match',
  );
  assert.equal(
    context.optionMatches('I Agree', 'I agree', 'Affirmation'),
    true,
    'affirmation option match',
  );
  assert.equal(
    context.optionMatches('United States of America', 'United States', 'Country'),
    true,
    'exact United States country option match',
  );
  assert.equal(
    context.optionMatches('United States Minor Outlying Islands', 'United States', 'Country'),
    false,
    'United States country must not match an outlying-islands option',
  );
  assert.equal(
    context.dropdownSearchTerm('Computer Science', 'Discipline'),
    'computer s',
    'discipline search term',
  );
  assert.equal(
    context.dropdownSearchTerm('No', 'Do you hold a security clearance?'),
    'none',
    'security clearance search term',
  );
}

function leverCustomQuestionInferenceTest() {
  const context = loadAutofillContext();
  const profile = profileFixture();
  const job = { title: 'Software Engineer, Full-Stack', company: 'Supermove' };

  const interestTextarea = new TestTextAreaElement({
    tagName: 'TEXTAREA',
    name: 'cards[a47a5e9b-364a-4c6b-9363-b2e587bd8f04][field0]',
  });
  const interestContainer = new TestHTMLElement({ tagName: 'DIV', innerText: '' });
  const interestQuestion = new TestHTMLElement({ tagName: 'DIV', innerText: 'Why Supermove / this position? *' });
  interestTextarea.parentElement = interestContainer;
  interestContainer.parentElement = interestQuestion;
  const interestLabel = context.getLabelText(interestTextarea);
  assert.equal(context.displayFieldLabel(interestLabel), 'Why Supermove / this position?');
  const interestMatch = context.answerForField({ label: interestLabel, type: 'textarea' }, profile, job);
  assert.equal(interestMatch.action, 'fill');
  assert.match(interestMatch.answer, /Software Engineer, Full-Stack/);
  assert.match(interestMatch.answer, /Supermove/);

  const mobileAiMatch = context.answerForField(
    {
      label: 'Tell us about a time in the past six months when you used AI to assist with a mobile development project.',
      type: 'textarea',
    },
    profile,
    { title: 'Android Engineer', company: 'WHOOP' },
  );
  assert.equal(mobileAiMatch.action, 'fill');
  assert.equal(mobileAiMatch.reason, 'mobile AI project answer');
  assert.notEqual(mobileAiMatch.answer, profile.phone);
  assert.match(mobileAiMatch.answer, /AI assistance/);

  const growthMatch = context.answerForField(
    { label: 'How do you hope to grow in this role?', type: 'textarea' },
    profile,
    { title: 'Android Engineer', company: 'WHOOP' },
  );
  assert.equal(growthMatch.action, 'fill');
  assert.equal(growthMatch.reason, 'growth answer');
  assert.match(growthMatch.answer, /taking on more ownership/);

  const educationSelect = new TestHTMLElement({
    tagName: 'SELECT',
    name: 'cards[a1d93a51-fdfb-40d0-88bc-10dabbf56636][field5]',
  });
  educationSelect.options = [
    { value: '', textContent: 'Please indicate your highest level of education attained:' },
    { value: 'High School Diploma', textContent: 'High School Diploma' },
    { value: "Bachelor's Degree", textContent: "Bachelor's Degree" },
    { value: "Master's Degree", textContent: "Master's Degree" },
  ];
  const educationFieldContainer = new TestHTMLElement({ tagName: 'DIV', innerText: 'Please indicate your highest level of education attained:' });
  const educationQuestion = new TestHTMLElement({
    tagName: 'LI',
    className: 'application-question custom-question',
    innerText: "Highest Education Completed? * Please indicate your highest level of education attained: High School Diploma Bachelor's Degree Master's Degree",
  });
  educationSelect.parentElement = educationFieldContainer;
  educationFieldContainer.parentElement = educationQuestion;
  const educationLabel = context.getLabelText(educationSelect);
  assert.equal(context.displayFieldLabel(educationLabel), 'Highest Education Completed?');
  const educationMatch = context.answerForField({ label: educationLabel, type: 'select' }, profile, job);
  assert.equal(educationMatch.action, 'fill');
  assert.equal(context.fillSelect(educationSelect, { label: educationLabel }, educationMatch).value, "Bachelor's Degree");

  const majorInput = new TestInputElement({
    tagName: 'INPUT',
    name: 'cards[a1d93a51-fdfb-40d0-88bc-10dabbf56636][field7]',
    placeholder: 'Type your response',
  });
  const majorFieldContainer = new TestHTMLElement({ tagName: 'DIV', innerText: '' });
  const majorQuestion = new TestHTMLElement({
    tagName: 'LI',
    className: 'application-question custom-question',
    innerText: 'What was your major field of study? *',
  });
  majorInput.parentElement = majorFieldContainer;
  majorFieldContainer.parentElement = majorQuestion;
  const majorLabel = context.getLabelText(majorInput);
  assert.equal(context.displayFieldLabel(majorLabel), 'What was your major field of study?');
  const majorMatch = context.answerForField({ label: majorLabel, type: 'text' }, profile, job);
  assert.equal(majorMatch.action, 'fill');
  assert.equal(majorMatch.answer, 'Computer Science');

  const universitySelect = new TestHTMLElement({
    tagName: 'SELECT',
    name: 'cards[a1d93a51-fdfb-40d0-88bc-10dabbf56636][field8]',
    id: 'university-picker-a1d93a51-fdfb-40d0-88bc-10dabbf56636-8',
  });
  universitySelect.options = [
    { value: '', textContent: 'Select a university or college' },
    { value: 'Auckland University of Technology', textContent: 'Auckland University of Technology' },
    { value: 'Australian National University', textContent: 'Australian National University' },
  ];
  const universityFieldContainer = new TestHTMLElement({ tagName: 'DIV', innerText: 'Select a university or college Auckland University of Technology' });
  const universityQuestion = new TestHTMLElement({
    tagName: 'LI',
    className: 'application-question custom-question',
    innerText: 'What university did you attend? * Select a university or college Auckland University of Technology',
  });
  universitySelect.parentElement = universityFieldContainer;
  universityFieldContainer.parentElement = universityQuestion;
  const universityLabel = context.getLabelText(universitySelect);
  assert.equal(context.displayFieldLabel(universityLabel), 'What university did you attend?');
  const universityMatch = context.answerForField({ label: universityLabel, type: 'select' }, profile, job);
  assert.equal(universityMatch.action, 'fill');
  assert.equal(context.fillSelect(universitySelect, { label: universityLabel }, universityMatch).filled, false);

  const ifOtherMatch = context.answerForField(
    { label: 'If other, please specify:', type: 'text' },
    profile,
    job,
  );
  assert.equal(ifOtherMatch.action, 'skip');
  assert.equal(ifOtherMatch.reason, 'conditional follow-up only applies after selecting other');

  const requiredConditionalChoice = context.answerForField(
    {
      label: 'If yes, is Babel Street considered a competitor to your most recent employer?',
      type: 'select',
      required: true,
    },
    profile,
    job,
  );
  assert.equal(requiredConditionalChoice.action, 'fill');
  assert.equal(requiredConditionalChoice.answer, 'No');
  assert.equal(requiredConditionalChoice.reason, 'required conditional choice after a negative antecedent');

  const conflictTextarea = new TestTextAreaElement({
    tagName: 'TEXTAREA',
    name: 'cards[80c2370b-9da0-4c5e-aa4d-0580fd9030f6][field0]',
  });
  const conflictContainer = new TestHTMLElement({ tagName: 'DIV', innerText: '' });
  const conflictQuestion = new TestHTMLElement({
    tagName: 'DIV',
    innerText: 'Are you related to someone who would pose a conflict of interest or potential conflict of interest if you are hired in this position? If yes, please describe.',
  });
  conflictTextarea.parentElement = conflictContainer;
  conflictContainer.parentElement = conflictQuestion;
  const conflictLabel = context.getLabelText(conflictTextarea);
  assert.match(context.displayFieldLabel(conflictLabel), /conflict of interest/);
  const conflictMatch = context.answerForField({ label: conflictLabel, type: 'textarea' }, profile, job);
  assert.equal(conflictMatch.action, 'skip');
  assert.equal(conflictMatch.reason, 'conditional follow-up only applies after a yes answer');
}

function selectedComboboxFallbackTextTest() {
  const context = loadAutofillContext();
  const control = new TestHTMLElement({
    tagName: 'DIV',
    className: 'select__control',
    textContent: 'Boston, Massachusetts, United States No location found. Try entering a different location. Loading.',
  });
  control.innerText = control.textContent;
  const input = new TestInputElement({
    id: 'candidate-location',
    tagName: 'INPUT',
    type: 'text',
    className: 'select__input',
    'aria-describedby': 'react-select-candidate-location-placeholder',
  });
  input.parentElement = control;

  assert.equal(
    context.selectedComboboxText(input),
    'Boston, Massachusetts, United States',
    'React-select fallback strips location noise',
  );

  const workdaySourceControl = new TestHTMLElement({
    tagName: 'DIV',
    textContent: '0 items selected',
  });
  const workdaySource = new TestInputElement({
    id: 'source--source',
    tagName: 'INPUT',
    type: 'text',
    placeholder: 'Search',
  });
  workdaySource.parentElement = workdaySourceControl;
  assert.equal(context.selectedComboboxText(workdaySource), '');
  workdaySourceControl.textContent = '1 item selected, Job Board';
  workdaySourceControl.innerText = workdaySourceControl.textContent;
  assert.equal(context.selectedComboboxText(workdaySource), 'Job Board');
  workdaySourceControl.textContent = 'Expanded';
  workdaySourceControl.innerText = workdaySourceControl.textContent;
  workdaySource.value = 'Job Board';
  assert.equal(context.selectedComboboxText(workdaySource), '');
  assert.equal(context.fieldValue(workdaySource), '');
  assert.equal(
    context.optionMatches('Job Board', 'RoleMatch / company careers page', 'How Did You Hear About Us?'),
    true,
  );
  assert.equal(
    context.dropdownSearchTerm('RoleMatch / company careers page', 'How Did You Hear About Us?'),
    'job',
  );
}

function extensionPanelFieldsExcludedTest() {
  const realInput = new TestInputElement({
    id: 'first_name',
    tagName: 'INPUT',
    type: 'text',
    'aria-label': 'First Name',
  });
  const panel = new TestHTMLElement({
    id: 'rolematch-autofill-panel',
    tagName: 'ASIDE',
  });
  const panelTextarea = new TestTextAreaElement({
    tagName: 'TEXTAREA',
    placeholder: 'Enter the answer to save for future autofill',
  });
  panelTextarea.parentElement = panel;
  const context = loadAutofillContext({
    elements: [realInput, panelTextarea],
  });

  const fields = context.collectFields();
  assert.equal(fields.length, 1);
  assert.equal(fields[0].element.id, 'first_name');
}

async function leverRadioAndSelectTest() {
  const sponsorParent = new TestHTMLElement({
    tagName: 'DIV',
    innerText: 'Will you now or in the future require sponsorship for employment visa status? * Yes No',
  });
  const sponsorYes = new TestInputElement({
    tagName: 'INPUT',
    type: 'radio',
    name: 'cards[abc][field0]',
    value: 'Yes',
    labels: [makeNode('Yes')],
  });
  const sponsorNo = new TestInputElement({
    tagName: 'INPUT',
    type: 'radio',
    name: 'cards[abc][field0]',
    value: 'No',
    labels: [makeNode('No')],
  });
  sponsorYes.parentElement = sponsorParent;
  sponsorNo.parentElement = sponsorParent;

  const authParent = new TestHTMLElement({
    tagName: 'DIV',
    innerText: 'Are you legally authorized to work in the United States? * Yes No',
  });
  const authYes = new TestInputElement({
    tagName: 'INPUT',
    type: 'radio',
    name: 'cards[abc][field1]',
    value: 'Yes',
    labels: [makeNode('Yes')],
  });
  const authNo = new TestInputElement({
    tagName: 'INPUT',
    type: 'radio',
    name: 'cards[abc][field1]',
    value: 'No',
    labels: [makeNode('No')],
  });
  authYes.parentElement = authParent;
  authNo.parentElement = authParent;

  const relocateParent = new TestHTMLElement({
    tagName: 'DIV',
    innerText: 'This is a hybrid position located in Minnesota - are you currently located in Minnesota or willing to relocate? * Yes No',
  });
  const relocateYes = new TestInputElement({
    tagName: 'INPUT',
    type: 'radio',
    name: 'cards[abc][field2]',
    value: 'Yes',
    labels: [makeNode('Yes')],
  });
  const relocateNo = new TestInputElement({
    tagName: 'INPUT',
    type: 'radio',
    name: 'cards[abc][field2]',
    value: 'No',
    labels: [makeNode('No')],
  });
  relocateYes.parentElement = relocateParent;
  relocateNo.parentElement = relocateParent;

  const context = loadAutofillContext({
    elements: [sponsorYes, sponsorNo, authYes, authNo, relocateYes, relocateNo],
  });
  const profile = profileFixture();

  const sponsorLabel = context.getLabelText(sponsorYes);
  assert.match(sponsorLabel, /sponsorship/i);
  const sponsorMatch = context.answerForField({ label: sponsorLabel, type: 'radio' }, profile, {});
  assert.equal(sponsorMatch.answer, 'No');
  const sponsorResult = await context.fillField({ element: sponsorYes, type: 'radio', label: sponsorLabel }, sponsorMatch);
  assert.equal(sponsorResult.filled, true);
  assert.equal(sponsorNo.checked, true);
  assert.equal(sponsorResult.value, 'No');

  const authLabel = context.getLabelText(authYes);
  assert.match(authLabel, /authorized/i);
  const authMatch = context.answerForField({ label: authLabel, type: 'radio' }, profile, {});
  assert.equal(authMatch.answer, 'Yes');
  const authResult = await context.fillField({ element: authYes, type: 'radio', label: authLabel }, authMatch);
  assert.equal(authResult.filled, true);
  assert.equal(authYes.checked, true);
  assert.equal(authResult.value, 'Yes');

  const relocateLabel = context.getLabelText(relocateYes);
  assert.match(relocateLabel, /relocate/i);
  const relocateMatch = context.answerForField({ label: relocateLabel, type: 'radio' }, profile, {});
  assert.equal(relocateMatch.answer, 'Yes');
  const relocateResult = await context.fillField({ element: relocateYes, type: 'radio', label: relocateLabel }, relocateMatch);
  assert.equal(relocateResult.filled, true);
  assert.equal(relocateYes.checked, true);

  const hybridParent = new TestHTMLElement({
    tagName: 'DIV',
    innerText: 'This is a hybrid role, working out of our Boston, MA office 4 days per week. Does this setup align to the working environment you are seeking? * Yes No',
  });
  const hybridYes = new TestInputElement({
    tagName: 'INPUT',
    type: 'radio',
    name: 'cards[whoop][field0]',
    value: 'Yes',
    labels: [makeNode('Yes')],
  });
  const hybridNo = new TestInputElement({
    tagName: 'INPUT',
    type: 'radio',
    name: 'cards[whoop][field0]',
    value: 'No',
    labels: [makeNode('No')],
  });
  hybridYes.parentElement = hybridParent;
  hybridNo.parentElement = hybridParent;
  const hybridContext = loadAutofillContext({ elements: [hybridYes, hybridNo] });
  const hybridLabel = hybridContext.getLabelText(hybridYes);
  const hybridMatch = hybridContext.answerForField({ label: hybridLabel, type: 'radio' }, profile, {});
  assert.equal(hybridMatch.action, 'fill');
  assert.equal(hybridMatch.answer, 'Yes');
  const hybridResult = await hybridContext.fillField({ element: hybridYes, type: 'radio', label: hybridLabel }, hybridMatch);
  assert.equal(hybridResult.filled, true);
  assert.equal(hybridResult.value, 'Yes');
  assert.equal(hybridYes.checked, true);

  const yearsParent = new TestHTMLElement({
    tagName: 'DIV',
    innerText: 'How many years of experience do you have? * 1-2 2-3 3+',
  });
  const yearsOneTwo = new TestInputElement({
    tagName: 'INPUT',
    type: 'radio',
    name: 'cards[years][field0]',
    value: '1-2',
    labels: [makeNode('1-2')],
  });
  const yearsTwoThree = new TestInputElement({
    tagName: 'INPUT',
    type: 'radio',
    name: 'cards[years][field0]',
    value: '2-3',
    labels: [makeNode('2-3')],
  });
  const yearsThreePlus = new TestInputElement({
    tagName: 'INPUT',
    type: 'radio',
    name: 'cards[years][field0]',
    value: '3+',
    labels: [makeNode('3+')],
  });
  yearsOneTwo.parentElement = yearsParent;
  yearsTwoThree.parentElement = yearsParent;
  yearsThreePlus.parentElement = yearsParent;
  const yearsContext = loadAutofillContext({ elements: [yearsOneTwo, yearsTwoThree, yearsThreePlus] });
  const yearsLabel = yearsContext.getLabelText(yearsOneTwo);
  const yearsProfile = profileFixture({
    autofillAnswers: {
      ...profile.autofillAnswers,
      yearsProfessionalExperience: '3+',
    },
  });
  const yearsMatch = yearsContext.answerForField({ element: yearsOneTwo, label: yearsLabel, type: 'radio' }, yearsProfile, {});
  assert.equal(yearsMatch.action, 'fill');
  assert.equal(yearsMatch.answer, '3+');
  const yearsResult = await yearsContext.fillField({ element: yearsOneTwo, type: 'radio', label: yearsLabel }, yearsMatch);
  assert.equal(yearsResult.filled, true);
  assert.equal(yearsThreePlus.checked, true);

  const locationSelect = new TestHTMLElement({
    tagName: 'SELECT',
    name: 'opportunityLocationId',
  });
  locationSelect.options = [
    { value: '', textContent: 'Select...' },
    { value: 'austin', textContent: 'Austin, TX' },
    { value: 'boston', textContent: 'Boston, MA' },
    { value: 'berlin', textContent: 'Berlin, Germany' },
  ];
  const locationQuestion = new TestHTMLElement({
    tagName: 'LI',
    className: 'application-question',
    innerText: 'Which location are you applying for? * Select... Austin, TX Boston, MA Berlin, Germany',
  });
  locationSelect.parentElement = locationQuestion;
  const locationContext = loadAutofillContext({ elements: [locationSelect] });
  const locationLabel = locationContext.getLabelText(locationSelect);
  const locationMatch = locationContext.answerForField({ element: locationSelect, label: locationLabel, type: 'select' }, profile, {});
  assert.equal(locationMatch.action, 'fill');
  const locationResult = locationContext.fillSelect(locationSelect, { label: locationLabel }, locationMatch);
  assert.equal(locationResult.filled, true);
  assert.equal(locationResult.value, 'Boston, MA');

  const bareLocationSelect = new TestHTMLElement({
    tagName: 'SELECT',
    name: 'opportunityLocationId',
  });
  bareLocationSelect.options = [
    { value: '', textContent: 'Select...' },
    { value: 'austin', textContent: 'Austin, TX' },
    { value: 'boston', textContent: 'Boston, MA' },
    { value: 'berlin', textContent: 'Berlin, Germany' },
  ];
  const bareLocationContext = loadAutofillContext({ elements: [bareLocationSelect] });
  const bareLocationLabel = bareLocationContext.getLabelText(bareLocationSelect);
  assert.match(bareLocationLabel, /Which location are you applying for/);
  const bareLocationMatch = bareLocationContext.answerForField({ element: bareLocationSelect, label: bareLocationLabel, type: 'select' }, profile, {});
  assert.equal(bareLocationMatch.action, 'fill');
  const bareLocationResult = bareLocationContext.fillSelect(bareLocationSelect, { label: bareLocationLabel }, bareLocationMatch);
  assert.equal(bareLocationResult.filled, true);
  assert.equal(bareLocationResult.value, 'Boston, MA');
}

async function leverSurveyAndCheckboxTest() {
  const profile = profileFixture({
    autofillAnswers: {
      ...profileFixture().autofillAnswers,
      custom: [
        ...(profileFixture().autofillAnswers.custom ?? []),
        { label: 'Pronouns', keywords: 'pronouns preferred pronouns', answer: 'He/him' },
      ],
    },
  });

  const makeGroupedControl = ({ type, name, value, optionTextValue, questionText }) => {
    const input = new TestInputElement({
      tagName: 'INPUT',
      type,
      name,
      value,
      labels: [makeNode(optionTextValue)],
    });
    const label = new TestHTMLElement({ tagName: 'LABEL', innerText: optionTextValue, textContent: optionTextValue });
    const li = new TestHTMLElement({ tagName: 'LI', innerText: optionTextValue, textContent: optionTextValue });
    const ul = new TestHTMLElement({ tagName: 'UL', innerText: optionTextValue, textContent: optionTextValue });
    const field = new TestHTMLElement({ tagName: 'DIV', className: 'application-field full-width', innerText: optionTextValue, textContent: optionTextValue });
    const question = new TestHTMLElement({
      tagName: 'LI',
      className: 'application-question',
      innerText: questionText,
      textContent: questionText,
    });
    input.parentElement = label;
    label.parentElement = li;
    li.parentElement = ul;
    ul.parentElement = field;
    field.parentElement = question;
    return input;
  };

  const ageOptions = ['17 or younger', '18-20', '21-29', '30-39'].map((option) => makeGroupedControl({
    type: 'radio',
    name: 'surveysResponses[age][responses][field0]',
    value: option,
    optionTextValue: option,
    questionText: 'What is your age range?17 or younger18-2021-2930-39',
  }));
  const ageContext = loadAutofillContext({ elements: ageOptions });
  const ageLabel = ageContext.getLabelText(ageOptions[0]);
  assert.match(ageLabel, /age range/i);
  const ageMatch = ageContext.answerForField({ element: ageOptions[0], label: ageLabel, type: 'radio' }, profile, {});
  assert.equal(ageMatch.action, 'fill');
  assert.equal(ageMatch.answer, '21-29');
  const ageResult = await ageContext.fillField({ element: ageOptions[0], label: ageLabel, type: 'radio' }, ageMatch);
  assert.equal(ageResult.filled, true);
  assert.equal(ageOptions[2].checked, true);

  const genderOptions = ['Female', 'Male', 'Non-binary'].map((option) => makeGroupedControl({
    type: 'radio',
    name: 'surveysResponses[gender][responses][field2]',
    value: option,
    optionTextValue: option,
    questionText: 'What gender do you identify as?FemaleMaleNon-binary',
  }));
  const genderContext = loadAutofillContext({ elements: genderOptions });
  const genderLabel = genderContext.getLabelText(genderOptions[0]);
  assert.match(genderLabel, /gender/i);
  const genderMatch = genderContext.answerForField({ element: genderOptions[0], label: genderLabel, type: 'radio' }, profile, {});
  assert.equal(genderMatch.action, 'fill');
  assert.equal(genderMatch.answer, 'Male');
  const genderResult = await genderContext.fillField({ element: genderOptions[0], label: genderLabel, type: 'radio' }, genderMatch);
  assert.equal(genderResult.filled, true);
  assert.equal(genderOptions[1].checked, true);

  const educationOptions = ['High School', 'Bachelor', 'Masters'].map((option) => makeGroupedControl({
    type: 'radio',
    name: 'surveysResponses[education][responses][field3]',
    value: option,
    optionTextValue: option,
    questionText: 'What is your highest level of education?High SchoolBachelorMasters',
  }));
  const educationContext = loadAutofillContext({ elements: educationOptions });
  const educationLabel = educationContext.getLabelText(educationOptions[0]);
  assert.match(educationLabel, /education/i);
  const educationMatch = educationContext.answerForField({ element: educationOptions[0], label: educationLabel, type: 'radio' }, profile, {});
  assert.equal(educationMatch.action, 'fill');
  assert.equal(educationMatch.answer, 'Bachelor of Science');
  const educationResult = await educationContext.fillField({ element: educationOptions[0], label: educationLabel, type: 'radio' }, educationMatch);
  assert.equal(educationResult.filled, true);
  assert.equal(educationOptions[1].checked, true);

  const heHim = makeGroupedControl({
    type: 'checkbox',
    name: 'pronouns',
    value: 'He/him',
    optionTextValue: 'He/him',
    questionText: 'PronounsHe/himShe/herThey/themUse name onlyCustomLet the employer know what pronouns you use so that they can address you correctly.',
  });
  const sheHer = makeGroupedControl({
    type: 'checkbox',
    name: 'pronouns',
    value: 'She/her',
    optionTextValue: 'She/her',
    questionText: 'PronounsHe/himShe/herThey/themUse name onlyCustomLet the employer know what pronouns you use so that they can address you correctly.',
  });
  const pronounContext = loadAutofillContext({ elements: [heHim, sheHer] });
  const heLabel = pronounContext.getLabelText(heHim);
  const sheLabel = pronounContext.getLabelText(sheHer);
  const heMatch = pronounContext.answerForField({ element: heHim, label: heLabel, type: 'checkbox' }, profile, {});
  const sheMatch = pronounContext.answerForField({ element: sheHer, label: sheLabel, type: 'checkbox' }, profile, {});
  assert.equal(heMatch.action, 'fill');
  assert.equal(sheMatch.action, 'skip');
  const heResult = await pronounContext.fillField({ element: heHim, label: heLabel, type: 'checkbox' }, heMatch);
  assert.equal(heResult.filled, true);
  assert.equal(heHim.checked, true);
  assert.equal(sheHer.checked, false);

  const white = makeGroupedControl({
    type: 'checkbox',
    name: 'surveysResponses[race][responses][field1]',
    value: 'White / Caucasian',
    optionTextValue: 'White / Caucasian',
    questionText: 'I identify my ethnicity asSelect all that applyWhite / CaucasianAsianBlack or African American',
  });
  const asian = makeGroupedControl({
    type: 'checkbox',
    name: 'surveysResponses[race][responses][field1]',
    value: 'Asian',
    optionTextValue: 'Asian',
    questionText: 'I identify my ethnicity asSelect all that applyWhite / CaucasianAsianBlack or African American',
  });
  const ethnicityContext = loadAutofillContext({ elements: [white, asian] });
  const whiteLabel = ethnicityContext.getLabelText(white);
  const asianLabel = ethnicityContext.getLabelText(asian);
  const whiteMatch = ethnicityContext.answerForField({ element: white, label: whiteLabel, type: 'checkbox' }, profile, {});
  const asianMatch = ethnicityContext.answerForField({ element: asian, label: asianLabel, type: 'checkbox' }, profile, {});
  assert.equal(whiteMatch.action, 'fill');
  assert.equal(asianMatch.action, 'skip');
  const whiteResult = await ethnicityContext.fillField({ element: white, label: whiteLabel, type: 'checkbox' }, whiteMatch);
  assert.equal(whiteResult.filled, true);
  assert.equal(white.checked, true);
  assert.equal(asian.checked, false);

  const privacyAcknowledgement = new TestInputElement({
    tagName: 'INPUT',
    type: 'checkbox',
    name: 'privacy-notice',
    optionTextValue: 'You declare that you have read and understand the privacy notice of ServiceNow.',
  });
  const privacyContext = loadAutofillContext({ elements: [privacyAcknowledgement] });
  const privacyLabel = 'You declare that you have read and understand the privacy notice of ServiceNow.';
  const privacyMatch = privacyContext.answerForField({
    element: privacyAcknowledgement,
    label: privacyLabel,
    type: 'checkbox',
  }, profile, {});
  assert.equal(privacyMatch.action, 'fill');
  assert.equal(privacyMatch.reason, 'required privacy notice acknowledgement');
  const privacyResult = await privacyContext.fillField({
    element: privacyAcknowledgement,
    label: privacyLabel,
    type: 'checkbox',
  }, privacyMatch);
  assert.equal(privacyResult.filled, true);
  assert.equal(privacyAcknowledgement.checked, true);

  const marketingConsent = new TestInputElement({
    tagName: 'INPUT',
    type: 'checkbox',
    name: 'marketing-consent',
    optionTextValue: 'Contact me about future job opportunities.',
  });
  const marketingMatch = privacyContext.answerForField({
    element: marketingConsent,
    label: 'Contact me about future job opportunities.',
    type: 'checkbox',
  }, profile, {});
  assert.equal(marketingMatch.action, 'skip');
  assert.equal(marketingMatch.reason, 'optional marketing consent is manual');

  const workdayConsent = new TestInputElement({
    tagName: 'INPUT',
    type: 'checkbox',
    name: 'cross-border-consent',
    optionTextValue: 'I consent to the above.',
  });
  const workdayConsentContext = loadAutofillContext({
    hostname: 'visa.wd5.myworkdayjobs.com',
    href: 'https://visa.wd5.myworkdayjobs.com/en-US/Visa/job/example/apply/applyManually',
    elements: [workdayConsent],
  });
  const workdayConsentMatch = workdayConsentContext.answerForField({
    element: workdayConsent,
    label: 'I consent to the above.',
    type: 'checkbox',
  }, profile, {});
  assert.equal(workdayConsentMatch.action, 'skip');
  assert.equal(workdayConsentMatch.reason, 'privacy or consent acknowledgement is manual');

  const hiddenAgeOptions = ['17 or younger', '18-20', '21-29'].map((option) => makeGroupedControl({
    type: 'radio',
    name: 'surveysResponses[hiddenAge][responses][field0]',
    value: option,
    optionTextValue: option,
    questionText: 'What is your age range?17 or younger18-2021-29',
  }));
  hiddenAgeOptions.forEach((option) => {
    option.rect = { width: 0, height: 0 };
  });
  const hiddenContext = loadAutofillContext({ elements: hiddenAgeOptions });
  const hiddenFields = hiddenContext.collectFields();
  assert.equal(hiddenFields.length, 1);
  assert.match(hiddenFields[0].label, /age range/i);
}

function leverSelectInferenceTest() {
  const context = loadAutofillContext();
  const profile = profileFixture();

  const genderSelect = new TestHTMLElement({ tagName: 'SELECT', name: 'eeo[gender]' });
  genderSelect.options = [
    { value: '', textContent: 'Select' },
    { value: 'male', textContent: 'Male' },
    { value: 'female', textContent: 'Female' },
  ];

  const raceSelect = new TestHTMLElement({ tagName: 'SELECT', name: 'eeo[race]' });
  raceSelect.options = [
    { value: '', textContent: 'Select' },
    { value: 'hispanic', textContent: 'Hispanic or Latino' },
    { value: 'white', textContent: 'White' },
    { value: 'decline', textContent: 'I do not wish to self-identify' },
  ];

  const veteranSelect = new TestHTMLElement({ tagName: 'SELECT', name: 'eeo[veteran]' });
  veteranSelect.options = [
    { value: '', textContent: 'Select' },
    { value: 'not_veteran', textContent: 'I am not a veteran' },
    { value: 'protected', textContent: 'I identify as a protected veteran' },
  ];

  const genderLabel = context.getLabelText(genderSelect);
  const genderMatch = context.answerForField({ label: genderLabel, type: 'select' }, profile, {});
  assert.equal(genderMatch.answer, 'Male');
  assert.equal(context.fillSelect(genderSelect, { label: genderLabel }, genderMatch).value, 'Male');

  const raceLabel = context.getLabelText(raceSelect);
  const raceMatch = context.answerForField({ label: raceLabel, type: 'select' }, profile, {});
  assert.equal(raceMatch.answer, 'White');
  assert.equal(context.fillSelect(raceSelect, { label: raceLabel }, raceMatch).value, 'White');

  const veteranLabel = context.getLabelText(veteranSelect);
  const veteranMatch = context.answerForField({ label: veteranLabel, type: 'select' }, profile, {});
  assert.equal(veteranMatch.answer, 'No military service / not a protected veteran');
  assert.equal(context.fillSelect(veteranSelect, { label: veteranLabel }, veteranMatch).value, 'I am not a veteran');
}

function leverMasterResumeAndRaceIdentityTest() {
  const resumeQuestion = new TestHTMLElement({
    tagName: 'LI',
    className: 'application-question',
    textContent: 'Resume/CV * ATTACH RESUME/CV',
    innerText: 'Resume/CV * ATTACH RESUME/CV',
  });
  const resume = new TestInputElement({
    id: 'resume-upload-input',
    tagName: 'INPUT',
    type: 'file',
    role: 'combobox',
    name: 'resume',
    'data-qa': 'input-resume',
  });
  resume.parentElement = resumeQuestion;

  const raceQuestion = new TestHTMLElement({
    tagName: 'LI',
    className: 'application-question',
    textContent: 'Race Select ... Hispanic or Latino White (Not Hispanic or Latino) Decline to self-identify',
    innerText: 'Race Select ... Hispanic or Latino White (Not Hispanic or Latino) Decline to self-identify',
  });
  const race = new TestHTMLElement({ tagName: 'SELECT', name: 'eeo[race]' });
  race.options = [
    { value: '', textContent: 'Select ...' },
    { value: 'hispanic', textContent: 'Hispanic or Latino' },
    { value: 'white', textContent: 'White (Not Hispanic or Latino)' },
    { value: 'decline', textContent: 'Decline to self-identify' },
  ];
  race.parentElement = raceQuestion;

  const context = loadAutofillContext({
    hostname: 'jobs.lever.co',
    href: 'https://jobs.lever.co/whoop/example/apply',
    elements: [resume, race],
  });
  const profile = profileFixture({
    documents: [
      {
        documentType: 'resume',
        label: 'Older resume',
        fileName: 'Older Resume.docx',
        fileUrl: '/uploads/profile-documents/older-resume.docx',
        uploadedAt: '2026-07-20T12:00:00.000Z',
      },
      {
        documentType: 'resume',
        label: 'Resume Master',
        fileName: 'Resume Master.docx',
        fileUrl: '/uploads/profile-documents/resume-master.docx',
        uploadedAt: '2026-07-21T20:23:32.038Z',
      },
    ],
  });
  const fields = context.collectFields();
  const resumeField = fields.find((field) => field.type === 'file');
  const raceField = fields.find((field) => field.element === race);
  const contaminatedResumeField = {
    ...resumeField,
    label: `${resumeField.label} | Are you legally authorized to work in the United States? | Will you now or in the future require visa sponsorship?`,
  };
  const providerMisclassifiedResumeField = {
    ...contaminatedResumeField,
    type: 'combobox',
  };
  const resumeMatch = context.answerForField(contaminatedResumeField, profile, {});
  const providerMisclassifiedResumeMatch = context.answerForField(providerMisclassifiedResumeField, profile, {});
  const raceMatch = context.answerForField(raceField, profile, {});

  assert.equal(context.fieldType(resume), 'file');
  assert.equal(context.displayFieldLabel(resumeField.label), 'Resume/CV');
  assert.equal(resumeMatch.action, 'file');
  assert.equal(resumeMatch.answer, 'Resume Master.docx');
  assert.equal(providerMisclassifiedResumeMatch.action, 'file');
  assert.equal(providerMisclassifiedResumeMatch.answer, 'Resume Master.docx');
  assert.equal(context.displayFieldLabel(raceField.label), 'Race');
  assert.equal(raceMatch.answer, 'White');
  assert.equal(context.fillSelect(race, raceField, raceMatch).value, 'White (Not Hispanic or Latino)');
}

function leverStandardFieldInferenceTest() {
  const context = loadAutofillContext();
  const profile = profileFixture();
  const profileWithoutCurrentEmployer = profileFixture({ workHistory: [{ current: false, company: 'BirthdayMessaging.io', skills: ['React'] }] });
  const job = { title: 'Backend Engineer', company: 'Lever Test Company' };
  const fields = [
    [new TestInputElement({ tagName: 'INPUT', name: 'name' }), /full name/i, 'Alex Morgan'],
    [new TestInputElement({ tagName: 'INPUT', name: 'org' }), /current company/i, 'RoleMatch'],
    [new TestInputElement({ tagName: 'INPUT', name: 'urls[LinkedIn]' }), /linkedin/i, 'https://www.linkedin.com/in/alex-morgan-example'],
    [new TestInputElement({ tagName: 'INPUT', name: 'urls[GitHub]' }), /github/i, 'https://github.com/alex-morgan-example'],
    [new TestInputElement({ tagName: 'INPUT', name: 'urls[Portfolio]' }), /website/i, 'https://alex-morgan.example.com'],
    [new TestInputElement({ tagName: 'INPUT', name: 'urls[Twitter]' }), /twitter/i, 'skip'],
    [new TestInputElement({ tagName: 'INPUT', name: 'urls[Other]' }), /other url/i, 'skip'],
    [new TestInputElement({ tagName: 'INPUT', name: 'source' }), /hear about/i, 'Company careers page'],
    [new TestTextAreaElement({ tagName: 'TEXTAREA', name: 'comments' }), /additional information/i, null],
  ];

  for (const [element, labelPattern, expectedAnswer] of fields) {
    const label = context.getLabelText(element);
    assert.match(label, labelPattern);
    const match = context.answerForField({ label, type: context.fieldType(element) }, profile, job);
    if (expectedAnswer === 'skip') {
      assert.equal(match.action, 'skip');
      continue;
    }
    assert.equal(match.action, 'fill');
    if (expectedAnswer) {
      assert.equal(match.answer, expectedAnswer);
    } else {
      assert.match(match.answer, /Backend Engineer/);
      assert.match(match.answer, /Lever Test Company/);
    }
  }

  const currentCompanyLabel = context.getLabelText(new TestInputElement({ tagName: 'INPUT', name: 'org' }));
  const currentCompanyMatch = context.answerForField({ label: currentCompanyLabel, type: 'text' }, profileWithoutCurrentEmployer, job);
  assert.equal(currentCompanyMatch.action, 'fill');
  assert.equal(currentCompanyMatch.answer, 'N/A');
}

function noisyLabelTest() {
  const context = loadAutofillContext({
    labels: {
      first_name: 'First Name*',
      'question-js-label': 'What is your level of experience with JavaScript?*',
    },
  });

  const noisyParent = new TestHTMLElement({
    tagName: 'DIV',
    innerText: 'First Name* Last Name* Email* Phone Country* Phone* Resume/CV* Attach Attach Dropbox',
  });
  const firstName = new TestInputElement({
    id: 'first_name',
    tagName: 'INPUT',
    type: 'text',
    autocomplete: 'given-name',
    'aria-label': 'First Name',
  });
  firstName.parentElement = noisyParent;

  const combo = new TestInputElement({
    id: 'question-js',
    tagName: 'INPUT',
    type: 'text',
    role: 'combobox',
    'aria-autocomplete': 'list',
    'aria-labelledby': 'question-js-label',
  });

  assert.equal(context.getLabelText(firstName), 'First name | First Name* | First Name | first_name | given-name');
  assert.equal(context.fieldType(combo), 'combobox');

  const anonymousHelperInput = new TestInputElement({ tagName: 'INPUT', type: 'text' });
  assert.equal(context.fieldHasIdentity(anonymousHelperInput), false);

  const locationInput = new TestInputElement({
    id: 'location-input',
    tagName: 'INPUT',
    type: 'text',
    name: 'location',
  });
  const locationParent = new TestHTMLElement({
    tagName: 'DIV',
    innerText: 'Current location No location found. Try entering a different location Loading',
  });
  locationInput.parentElement = locationParent;
  assert.equal(context.fieldType(locationInput), 'combobox');
  assert.equal(context.displayFieldLabel(context.getLabelText(locationInput)), 'Current location');

  const resumeInput = new TestInputElement({
    id: 'resume',
    tagName: 'INPUT',
    type: 'file',
    labels: [makeNode('Attach')],
  });
  const resumeLabel = context.getLabelText(resumeInput);
  assert.match(resumeLabel, /Resume\/CV/);
  assert.equal(context.fileInputAvailable(resumeInput), true);
  assert.equal(context.answerForField({ label: resumeLabel, type: 'file' }, profileFixture()).action, 'file');
}

async function fillControlsTest() {
  const selectedValue = new TestHTMLElement({
    tagName: 'DIV',
    className: 'select__single-value',
    textContent: '',
    innerText: '',
  });
  const selectControl = new TestHTMLElement({
    tagName: 'DIV',
    className: 'select__control',
  });
  selectControl.children.push(selectedValue);

  const options = ['No experience', 'Beginner', 'Intermediate', 'Advanced'].map((text) => new TestHTMLElement({
    tagName: 'DIV',
    textContent: text,
    innerText: text,
  }));
  const context = loadAutofillContext({ options });
  const combo = new TestInputElement({
    id: 'question-js',
    tagName: 'INPUT',
    type: 'text',
    role: 'combobox',
    className: 'select__input',
    'aria-autocomplete': 'list',
    'aria-describedby': 'react-select-question-js-placeholder',
  });
  combo.parentElement = selectControl;
  combo.dispatchEvent = function dispatchComboEvent(event) {
    this.events.push(`${event.type}:${event.key || ''}`);
    if (event.type === 'keydown' && event.key === 'Enter') {
      selectedValue.textContent = 'Intermediate';
      selectedValue.innerText = 'Intermediate';
      this.value = '';
    }
    return true;
  };
  options[2].dispatchEvent = function dispatchSelectedOption(event) {
    this.events.push(event.type);
    if (event.type === 'click') {
      this.clicked = true;
      combo.value = 'Intermediate';
    }
    return true;
  };
  const result = await context.fillField(
    { element: combo, type: 'combobox', label: 'What is your level of experience with JavaScript?' },
    { action: 'fill', answer: 'Intermediate', reason: 'technology experience level' },
  );

  assert.equal(result.filled, true);
  assert.equal(result.value, 'Intermediate');
  assert.equal(combo.events.includes('keydown:Enter'), true);
  assert.equal(combo.getAttribute('data-rolematch-filled'), 'true');

  const locationContext = loadAutofillContext({ options: [] });
  const locationCombo = new TestInputElement({
    id: 'location-input',
    tagName: 'INPUT',
    type: 'text',
    name: 'location',
  });
  locationCombo.parentElement = new TestHTMLElement({ tagName: 'DIV', innerText: 'Current location' });
  const locationResult = await locationContext.fillField(
    { element: locationCombo, type: 'combobox', label: 'Current location' },
    { action: 'fill', answer: 'Boston, Massachusetts', reason: 'location' },
  );
  assert.equal(locationResult.filled, true);
  assert.equal(locationResult.value, 'Boston, Massachusetts');
  assert.equal(locationCombo.getAttribute('data-rolematch-filled'), 'true');

  const delayedLocationContext = loadAutofillContext({ options: [] });
  const delayedLocationCombo = new TestInputElement({
    id: 'location-input',
    tagName: 'INPUT',
    type: 'text',
    name: 'location',
  });
  let delayedValue = '';
  Object.defineProperty(delayedLocationCombo, 'value', {
    get() {
      return delayedValue;
    },
    set(value) {
      delayedValue = '';
      setTimeout(() => {
        delayedValue = String(value || '').includes('Boston') ? 'Boston, MA, USA' : String(value || '');
      }, 200);
    },
  });
  delayedLocationCombo.parentElement = new TestHTMLElement({ tagName: 'DIV', innerText: 'Current location' });
  const delayedLocationResult = await delayedLocationContext.fillField(
    { element: delayedLocationCombo, type: 'combobox', label: 'Current location' },
    { action: 'fill', answer: 'Boston, Massachusetts', reason: 'location' },
  );
  assert.equal(delayedLocationResult.filled, true);
  assert.equal(delayedLocationResult.value, 'Boston, MA, USA');
  assert.equal(delayedLocationCombo.getAttribute('data-rolematch-filled'), 'true');

  const slowLocationContext = loadAutofillContext({ options: [] });
  const slowLocationCombo = new TestInputElement({
    id: 'location-input',
    tagName: 'INPUT',
    type: 'text',
    name: 'location',
  });
  let slowLocationValue = '';
  Object.defineProperty(slowLocationCombo, 'value', {
    get() {
      return slowLocationValue;
    },
    set(value) {
      slowLocationValue = '';
      setTimeout(() => {
        slowLocationValue = String(value || '').includes('Boston') ? 'Boston, MA, USA' : String(value || '');
      }, 2500);
    },
  });
  slowLocationCombo.parentElement = new TestHTMLElement({ tagName: 'DIV', innerText: 'Current location' });
  const slowLocationResult = await slowLocationContext.fillField(
    { element: slowLocationCombo, type: 'combobox', label: 'Current location' },
    { action: 'fill', answer: 'Boston, Massachusetts', reason: 'location' },
  );
  assert.equal(slowLocationResult.filled, true);
  assert.equal(slowLocationResult.value, 'Boston, MA, USA');
  assert.equal(slowLocationCombo.getAttribute('data-rolematch-filled'), 'true');

  const leverNamedLocationContext = loadAutofillContext({ options: [] });
  const leverNamedLocationCombo = new TestInputElement({
    tagName: 'INPUT',
    type: 'text',
    name: 'location',
  });
  leverNamedLocationCombo.parentElement = new TestHTMLElement({ tagName: 'DIV', innerText: 'Current location' });
  const leverNamedLocationLabel = leverNamedLocationContext.getLabelText(leverNamedLocationCombo);
  assert.match(leverNamedLocationLabel, /Current location/);
  const leverNamedLocationResult = await leverNamedLocationContext.fillField(
    { element: leverNamedLocationCombo, type: leverNamedLocationContext.fieldType(leverNamedLocationCombo), label: leverNamedLocationLabel },
    { action: 'fill', answer: 'Boston, Massachusetts', reason: 'location' },
  );
  assert.equal(leverNamedLocationResult.filled, true);
  assert.equal(leverNamedLocationResult.value, 'Boston, Massachusetts');
  assert.equal(leverNamedLocationCombo.getAttribute('data-rolematch-filled'), 'true');

  const advancedValue = new TestHTMLElement({
    tagName: 'DIV',
    className: 'select__single-value',
    textContent: '',
    innerText: '',
  });
  const advancedControl = new TestHTMLElement({
    tagName: 'DIV',
    className: 'select__control',
  });
  advancedControl.children.push(advancedValue);
  const advancedOption = new TestHTMLElement({
    id: 'react-select-question-ai-option-3',
    tagName: 'DIV',
    textContent: 'advance',
    innerText: 'advance',
  });
  const advancedContext = loadAutofillContext({ options: [advancedOption] });
  const advancedCombo = new TestInputElement({
    id: 'question-ai',
    tagName: 'INPUT',
    type: 'text',
    role: 'combobox',
    className: 'select__input',
    'aria-autocomplete': 'list',
    'aria-describedby': 'react-select-question-ai-placeholder',
  });
  advancedCombo.parentElement = advancedControl;
  advancedCombo.dispatchEvent = function dispatchAdvancedComboEvent(event) {
    this.events.push(`${event.type}:${event.key || ''}`);
    if (event.type === 'keydown' && event.key === 'Enter') {
      advancedValue.textContent = 'advance';
      advancedValue.innerText = 'advance';
      this.value = '';
    }
    return true;
  };
  const advancedResult = await advancedContext.fillField(
    { element: advancedCombo, type: 'combobox', label: 'What is your level of experience with AI-Assisted development tools?' },
    { action: 'fill', answer: 'Advanced', reason: 'technology experience level' },
  );
  assert.equal(advancedResult.filled, true);
  assert.equal(advancedResult.value, 'advance');

  const raceValue = new TestHTMLElement({
    tagName: 'DIV',
    className: 'select__single-value',
    textContent: '',
    innerText: '',
  });
  const raceControl = new TestHTMLElement({
    tagName: 'DIV',
    className: 'select__control',
  });
  raceControl.children.push(raceValue);
  const raceOptions = ['Asian', 'Black or African American', 'White', 'Decline to self-identify'].map((text) => new TestHTMLElement({
    tagName: 'DIV',
    textContent: text,
    innerText: text,
  }));
  const raceContext = loadAutofillContext({ options: raceOptions });
  const raceCombo = new TestInputElement({
    id: 'race',
    tagName: 'INPUT',
    type: 'text',
    role: 'combobox',
    className: 'select__input',
    'aria-autocomplete': 'list',
    'aria-describedby': 'react-select-race-placeholder',
  });
  raceCombo.parentElement = raceControl;
  raceOptions[2].dispatchEvent = function dispatchRaceOption(event) {
    this.events.push(event.type);
    if (event.type === 'click') {
      raceValue.textContent = 'White';
      raceValue.innerText = 'White';
      raceCombo.value = '';
    }
    return true;
  };
  const raceResult = await raceContext.fillField(
    { element: raceCombo, type: 'combobox', label: 'Please identify your race' },
    { action: 'fill', answer: 'White', reason: 'race/ethnicity' },
  );
  assert.equal(raceResult.filled, true);
  assert.equal(raceResult.value, 'White');
  assert.equal(raceCombo.getAttribute('data-rolematch-filled'), 'true');
}

async function fillFileTest() {
  const context = loadAutofillContext({
    fileResponse: {
      ok: true,
      file: {
        base64: Buffer.from('resume bytes').toString('base64'),
        fileName: 'Alex_Morgan_Resume.docx',
        mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      },
    },
  });
  const input = new TestInputElement({ id: 'resume', tagName: 'INPUT', type: 'file' });
  const result = await context.fillField(
    { element: input, type: 'file', label: 'Resume/CV' },
    {
      action: 'file',
      answer: 'Alex_Morgan_Resume.docx',
      file: { fileUrl: '/uploads/profile-documents/resume.docx', fileName: 'Alex_Morgan_Resume.docx' },
      reason: 'resume file',
    },
  );

  assert.equal(result.filled, true);
  assert.equal(result.value, 'Alex_Morgan_Resume.docx');
  assert.equal(input.files[0].name, 'Alex_Morgan_Resume.docx');
  assert.equal(input.getAttribute('data-rolematch-filled'), 'true');
}

async function conditionalFieldRescanTest() {
  const hispanicSelect = new TestHTMLElement({ id: 'hispanic_ethnicity', tagName: 'SELECT' });
  hispanicSelect.options = [
    { value: '', textContent: 'Select' },
    { value: 'no', textContent: 'No, I am not Hispanic or Latino' },
  ];

  let raceVisible = false;
  const raceSelect = new TestHTMLElement({ id: 'race', tagName: 'SELECT' });
  raceSelect.options = [
    { value: '', textContent: 'Select' },
    { value: 'white', textContent: 'White' },
  ];
  raceSelect.getBoundingClientRect = () => (raceVisible ? { width: 100, height: 28 } : { width: 0, height: 0 });

  hispanicSelect.dispatchEvent = function dispatchHispanicEvent(event) {
    this.events.push(event.type);
    if (event.type === 'change' && this.value === 'no') raceVisible = true;
    return true;
  };

  const context = loadAutofillContext({
    labels: {
      hispanic_ethnicity: 'Are you Hispanic/Latino?',
      race: 'Please identify your race',
    },
    elements: [hispanicSelect, raceSelect],
  });

  const response = await context.fillVisibleFields(profileFixture(), {});
  assert.equal(response.ok, true);
  assert.equal(hispanicSelect.value, 'no');
  assert.equal(raceSelect.value, 'white');
  assert.equal(raceVisible, true);
}

function repeatFillOverwritePolicyTest() {
  const context = loadAutofillContext();
  const profile = profileFixture();
  const job = { title: 'Software Engineer', company: 'Remesh' };
  const first = new TestInputElement({ id: 'first_name', tagName: 'INPUT', type: 'text', 'aria-label': 'First Name' });
  first.value = 'Manual Name';
  assert.equal(context.answerForField({ label: 'First Name', type: 'text' }, profile, job).answer, 'Alex');
  assert.notEqual(first.getAttribute('data-rolematch-filled'), 'true');
}

function atsDetectionTest() {
  const ashbyContext = loadAutofillContext({
    hostname: 'jobs.ashbyhq.com',
    href: 'https://jobs.ashbyhq.com/example/role',
  });
  assert.equal(ashbyContext.detectAts(), 'Ashby');

  const workdayContext = loadAutofillContext({
    hostname: 'example.wd1.myworkdayjobs.com',
    href: 'https://example.wd1.myworkdayjobs.com/en-US/jobs/job/software-engineer',
  });
  assert.equal(workdayContext.detectAts(), 'Workday');

  const smartRecruitersContext = loadAutofillContext({
    hostname: 'jobs.smartrecruiters.com',
    href: 'https://jobs.smartrecruiters.com/example/software-engineer',
  });
  assert.equal(smartRecruitersContext.detectAts(), 'SmartRecruiters');

  const recruiteeContext = loadAutofillContext({
    hostname: 'example.recruitee.com',
    href: 'https://example.recruitee.com/o/software-engineer',
  });
  assert.equal(recruiteeContext.detectAts(), 'Recruitee');

  const icimsContext = loadAutofillContext({
    hostname: 'careers-example.icims.com',
    href: 'https://careers-example.icims.com/jobs/123/software-engineer/login',
  });
  assert.equal(icimsContext.detectAts(), 'iCIMS');

  const workableContext = loadAutofillContext({
    hostname: 'apply.workable.com',
    href: 'https://apply.workable.com/example/j/ABC123/apply/',
  });
  assert.equal(workableContext.detectAts(), 'Workable');

  const successFactorsContext = loadAutofillContext({
    hostname: 'career8.successfactors.com',
    href: 'https://career8.successfactors.com/careers?career_job_req_id=482353&career_ns=job_application',
  });
  assert.equal(successFactorsContext.detectAts(), 'SuccessFactors');

  const successFactorsCloudContext = loadAutofillContext({
    hostname: 'example-career.hcm.ondemand.com',
    href: 'https://example-career.hcm.ondemand.com/career?company=example',
  });
  assert.equal(successFactorsCloudContext.detectAts(), 'SuccessFactors');

  const oracleContext = loadAutofillContext({
    hostname: 'jpmc.fa.oraclecloud.com',
    href: 'https://jpmc.fa.oraclecloud.com/hcmUI/CandidateExperience/en/sites/CX_1002/job/210715982',
  });
  assert.equal(oracleContext.detectAts(), 'Oracle Recruiting Cloud');

  const taleoContext = loadAutofillContext({
    hostname: 'textron.taleo.net',
    href: 'https://textron.taleo.net/careersection/textron/jobdetail.ftl?job=343405',
  });
  assert.equal(taleoContext.detectAts(), 'Taleo');

  const taleoCustomDomainContext = loadAutofillContext({
    hostname: 'careers.who.int',
    href: 'https://careers.who.int/careersection/ex/jobdetail.ftl?job=2601739',
  });
  assert.equal(taleoCustomDomainContext.detectAts(), 'Taleo');

  const ukgContext = loadAutofillContext({
    hostname: 'recruiting.ultipro.com',
    href: 'https://recruiting.ultipro.com/ABC100/JobBoard/board/OpportunityDetail?opportunityId=100',
  });
  assert.equal(ukgContext.detectAts(), 'UKG Pro Recruiting');

  const ukgSignInContext = loadAutofillContext({
    hostname: 'signin-us.ultipro.com',
    href: 'https://signin-us.ultipro.com/u/login?state=example',
  });
  assert.equal(ukgSignInContext.detectAts(), 'UKG Pro Recruiting');

  const dayforceContext = loadAutofillContext({
    hostname: 'jobs.dayforcehcm.com',
    href: 'https://jobs.dayforcehcm.com/en-US/example/CANDIDATEPORTAL/jobs/100/apply?flowSelection=true',
  });
  assert.equal(dayforceContext.detectAts(), 'Dayforce');
}

function backgroundAtsDetectionTest() {
  const source = fs.readFileSync(path.resolve(import.meta.dirname, '..', 'src', 'background.js'), 'utf8');
  const noopEvent = { addListener() {} };
  const context = {
    URL,
    console,
    fetch: async () => ({ ok: true, json: async () => ({}) }),
    chrome: {
      storage: { local: { get: async () => ({}), set: async () => {} } },
      runtime: { onInstalled: noopEvent, onMessage: noopEvent, sendMessage: async () => null },
      sidePanel: { setPanelBehavior: async () => {}, setOptions: async () => {} },
      tabs: { query: async () => [], sendMessage: async () => null },
      webNavigation: { getAllFrames: async () => [] },
    },
  };
  vm.createContext(context);
  vm.runInContext(source, context);

  const cases = [
    ['https://job-boards.greenhouse.io/example/jobs/1', 'greenhouse'],
    ['https://jobs.lever.co/example/1', 'lever'],
    ['https://jobs.ashbyhq.com/example/1', 'ashby'],
    ['https://example.wd1.myworkdayjobs.com/en-US/jobs/job/1', 'workday'],
    ['https://jobs.smartrecruiters.com/example/1', 'smartrecruiters'],
    ['https://example.recruitee.com/o/role', 'recruitee'],
    ['https://careers-example.icims.com/jobs/1/job', 'icims'],
    ['https://apply.workable.com/example/j/ABC/apply/', 'workable'],
    ['https://career2.successfactors.eu/careers?career_job_req_id=1', 'successfactors'],
    ['https://example-career.hcm.ondemand.com/career?company=example', 'successfactors'],
    ['https://example.fa.us2.oraclecloud.com/hcmUI/CandidateExperience/en/sites/CX/job/1', 'oracle'],
    ['https://textron.taleo.net/careersection/ex/jobdetail.ftl?job=1', 'taleo'],
    ['https://careers.who.int/careersection/ex/jobdetail.ftl?job=1', 'taleo'],
    ['https://recruiting.ultipro.com/ABC100/JobBoard/board/OpportunityDetail?opportunityId=100', 'ukg'],
    ['https://recruiting2.ultipro.com/ABC100/JobBoard/board/OpportunityDetail?opportunityId=100', 'ukg'],
    ['https://signin-us.ultipro.com/u/login?state=example', 'ukg'],
    ['https://jobs.dayforcehcm.com/en-US/example/CANDIDATEPORTAL/jobs/100', 'dayforce'],
    ['https://example.dayforcehcm.com/CandidatePortal/en-US/example/Posting/View/100', 'dayforce'],
  ];
  cases.forEach(([url, expected]) => assert.equal(context.detectAts(url), expected));

  const equivalentUrlPairs = [
    [
      'https://recruiting.ultipro.com/ABC100/JobBoard/board/OpportunityDetail?opportunityId=100',
      'https://recruiting.ultipro.com/ABC100/JobBoard/board/Account/Register?redirectUrl=%2FABC100%2FJobBoard%2Fboard%2FOpportunityDetail%3FopportunityId%3D100',
    ],
    [
      'https://jobs.dayforcehcm.com/en-US/example/CANDIDATEPORTAL/jobs/790',
      'https://jobs.dayforcehcm.com/en-US/example/CANDIDATEPORTAL/jobs/790/apply/manualApplication?applicationSource=Manual',
    ],
    [
      'https://example.dayforcehcm.com/CandidatePortal/en-US/example/Posting/View/100',
      'https://example.dayforcehcm.com/CandidatePortal/en-US/example/ApplicationForm?jobPostingId=100',
    ],
    [
      'https://career8.successfactors.com/career?company=Acme&career_job_req_id=482353&career_ns=job_listing',
      'https://career8.successfactors.com/careers?career_ns=job_application&career_job_req_id=482353&company=Acme',
    ],
    [
      'https://textron.taleo.net/careersection/ex/jobdetail.ftl?job=325720&lang=en',
      'https://textron.taleo.net/careersection/ex/jobapply.ftl?job=325720&source=RoleMatch',
    ],
    [
      'https://example.fa.us2.oraclecloud.com/hcmUI/CandidateExperience/en/sites/CX/job/123',
      'https://example.fa.us2.oraclecloud.com/hcmUI/CandidateExperience/en/sites/CX/job/123/apply/section/1?source=RoleMatch',
    ],
  ];
  equivalentUrlPairs.forEach(([first, second]) => {
    assert.equal(context.normalizeUrl(first), context.normalizeUrl(second));
  });
  assert.notEqual(
    context.normalizeUrl('https://career8.successfactors.com/career?company=Acme&career_job_req_id=1'),
    context.normalizeUrl('https://career8.successfactors.com/career?company=Acme&career_job_req_id=2'),
  );
}

async function backgroundApplicationSessionTest() {
  const source = fs.readFileSync(path.resolve(import.meta.dirname, '..', 'src', 'background.js'), 'utf8');
  const storage = {};
  const requests = [];
  let releaseInitialTrackerWrite;
  const initialTrackerWrite = new Promise((resolve) => {
    releaseInitialTrackerWrite = resolve;
  });
  const noopEvent = { addListener() {} };
  const context = {
    URL,
    console,
    Math,
    Date,
    fetch: async (url, options = {}) => {
      const body = options.body ? JSON.parse(options.body) : null;
      requests.push({ url: String(url), body });
      if (String(url).endsWith('/api/profile')) {
        return { ok: true, json: async () => profileFixture() };
      }
      if (body?.status === 'in_progress') await initialTrackerWrite;
      return { ok: true, json: async () => ({ application: body }) };
    },
    chrome: {
      storage: {
        local: {
          get: async (keys) => {
            const list = Array.isArray(keys) ? keys : [keys];
            return Object.fromEntries(list.map((key) => [key, storage[key]]));
          },
          set: async (values) => Object.assign(storage, values),
        },
      },
      runtime: { onInstalled: noopEvent, onMessage: noopEvent, sendMessage: async () => null },
      sidePanel: { setPanelBehavior: async () => {}, setOptions: async () => {} },
      tabs: {
        create: async ({ url }) => ({ id: 901, url }),
        query: async () => [],
        sendMessage: async () => null,
        onRemoved: noopEvent,
      },
      webNavigation: { getAllFrames: async () => [] },
    },
  };
  vm.createContext(context);
  vm.runInContext(source, context);

  await context.handleMessage({
    type: 'ROLEMATCH_CONNECT',
    payload: {
      token: 'test-token',
      apiBaseUrl: 'http://localhost:5000',
      frontendBaseUrl: 'http://localhost:5173',
    },
  }, {});
  const originalUrl = 'https://jobs.dayforcehcm.com/en-US/example/CANDIDATEPORTAL/jobs/790';
  const startedPromise = context.handleMessage({
    type: 'ROLEMATCH_START_APPLICATION',
    payload: {
      job: {
        id: 'dayforce-790',
        title: 'Head of Data Engineering',
        company: 'Tranzact',
        jobUrl: originalUrl,
      },
    },
  }, {});
  const started = await Promise.race([
    startedPromise,
    new Promise((_, reject) => setTimeout(() => reject(new Error('Application launch waited for the tracker API write.')), 250)),
  ]);
  assert.equal(started.tabId, 901);
  assert.ok(started.pending.sessionId);
  assert.equal(started.pending.job.jobUrl, originalUrl);
  releaseInitialTrackerWrite();
  await new Promise((resolve) => setTimeout(resolve, 0));

  const redirectedUrl = `${originalUrl}/apply?flowSelection=true`;
  const ready = await context.handleMessage({
    type: 'ROLEMATCH_ATS_READY',
    ats: 'Dayforce',
    url: redirectedUrl,
    fieldCount: 12,
  }, { tab: { id: 901, url: redirectedUrl } });
  assert.equal(ready.shouldAutoFill, true);
  assert.equal(ready.job.jobUrl, originalUrl);
  assert.equal(ready.sessionId, started.pending.sessionId);
  assert.equal(Object.keys(storage['rolematch.pendingApplications']).length, 1);

  const intent = await context.handleMessage({
    type: 'ROLEMATCH_APPLICATION_SUBMIT_INTENT',
    sessionId: ready.sessionId,
    url: redirectedUrl,
  }, { tab: { id: 901, url: redirectedUrl } });
  assert.equal(intent.session.state, 'submit_intent');

  const unconfirmed = await context.handleMessage({
    type: 'ROLEMATCH_APPLICATION_SUBMITTED',
    confirmed: false,
    sessionId: ready.sessionId,
    url: redirectedUrl,
  }, { tab: { id: 901, url: redirectedUrl } });
  assert.equal(unconfirmed.ok, false);
  assert.equal(requests.filter((request) => request.body?.status === 'submitted').length, 0);

  const confirmed = await context.handleMessage({
    type: 'ROLEMATCH_APPLICATION_SUBMITTED',
    confirmed: true,
    sessionId: ready.sessionId,
    url: `${originalUrl}/application-confirmation`,
  }, { tab: { id: 901, url: `${originalUrl}/application-confirmation` } });
  assert.equal(confirmed.ok, true);
  const submitted = requests.find((request) => request.body?.status === 'submitted');
  assert.equal(submitted.body.jobUrl, originalUrl);
  assert.equal(Object.keys(storage['rolematch.pendingApplications']).length, 0);

  const orphanedConfirmation = await context.handleMessage({
    type: 'ROLEMATCH_APPLICATION_SUBMITTED',
    confirmed: true,
    job: {
      id: 'orphan-job',
      title: 'Orphan confirmation',
      company: 'Example',
      jobUrl: 'https://jobs.dayforcehcm.com/en-US/example/CANDIDATEPORTAL/jobs/999',
    },
    url: 'https://jobs.dayforcehcm.com/en-US/example/CANDIDATEPORTAL/jobs/999/application-confirmation',
  }, { tab: { id: 999, url: 'https://jobs.dayforcehcm.com/en-US/example/CANDIDATEPORTAL/jobs/999/application-confirmation' } });
  assert.equal(orphanedConfirmation.ok, false);
  assert.equal(requests.filter((request) => request.body?.status === 'submitted').length, 1);

  const directUrl = 'https://jobs.ashbyhq.com/ashby/direct-role/application';
  const directReady = await context.handleMessage({
    type: 'ROLEMATCH_ATS_READY',
    ats: 'Ashby',
    url: directUrl,
    fieldCount: 14,
    isTopFrame: true,
    job: {
      title: 'Product Support Engineer - Americas',
      company: 'Ashby',
      jobUrl: directUrl,
      location: 'Remote - US',
    },
  }, { tab: { id: 902, url: directUrl } });
  assert.equal(directReady.shouldAutoFill, false);
  assert.equal(directReady.job.jobUrl, directUrl);
  assert.ok(directReady.sessionId);

  const directIntent = await context.handleMessage({
    type: 'ROLEMATCH_APPLICATION_SUBMIT_INTENT',
    sessionId: directReady.sessionId,
    job: directReady.job,
    url: directUrl,
  }, { tab: { id: 902, url: directUrl } });
  assert.equal(directIntent.session.state, 'submit_intent');

  const directConfirmed = await context.handleMessage({
    type: 'ROLEMATCH_APPLICATION_SUBMITTED',
    confirmed: true,
    sessionId: directReady.sessionId,
    job: directReady.job,
    evidence: 'Your application was successfully submitted.',
    url: directUrl,
  }, { tab: { id: 902, url: directUrl } });
  assert.equal(directConfirmed.ok, true);
  const submittedRequests = requests.filter((request) => request.body?.status === 'submitted');
  assert.equal(submittedRequests.length, 2);
  assert.equal(submittedRequests[1].body.jobUrl, directUrl);
  assert.equal(Object.keys(storage['rolematch.pendingApplications']).length, 0);
}

function oracleJetLabelAndTypeTest() {
  const host = new TestHTMLElement({
    id: 'oracle-country-host',
    tagName: 'OJ-SELECT-SINGLE',
    'label-hint': 'Country of residence',
  });
  const input = new TestInputElement({
    id: 'oracle-country-input',
    tagName: 'INPUT',
    type: 'text',
    role: 'combobox',
  });
  input.parentElement = host;
  host.children = [input];

  const context = loadAutofillContext({
    hostname: 'example.fa.oraclecloud.com',
    href: 'https://example.fa.oraclecloud.com/hcmUI/CandidateExperience/en/sites/CX/job/123',
    elements: [input],
  });

  assert.equal(context.fieldType(input), 'combobox');
  assert.match(context.getLabelText(input), /country of residence/i);
}

function legacyAtsQuestionLabelTest() {
  const row = new TestHTMLElement({
    tagName: 'TR',
    textContent: 'Are you legally authorized to work in the United States? Yes No',
    innerText: 'Are you legally authorized to work in the United States? Yes No',
  });
  const select = new TestHTMLElement({ id: 'authorized', tagName: 'SELECT' });
  select.parentElement = row;
  row.children = [select];

  const context = loadAutofillContext({
    hostname: 'career8.successfactors.com',
    href: 'https://career8.successfactors.com/careers?career_ns=job_application',
    elements: [select],
  });

  assert.match(context.getLabelText(select), /legally authorized to work/i);
}

function taleoLoginAndLanguageTest() {
  const row = new TestHTMLElement({
    tagName: 'TR',
    textContent: 'User Name Required Password Required',
    innerText: 'User Name Required Password Required',
  });
  const username = new TestInputElement({
    id: 'dialogTemplate-dialogForm-login-name1',
    tagName: 'INPUT',
    type: 'text',
  });
  const password = new TestInputElement({
    id: 'dialogTemplate-dialogForm-login-password',
    tagName: 'INPUT',
    type: 'password',
  });
  username.parentElement = row;
  password.parentElement = row;
  row.children = [username, password];

  const context = loadAutofillContext({
    hostname: 'textron.taleo.net',
    href: 'https://textron.taleo.net/careersection/iam/accessmanagement/login.jsf',
    labels: {
      'dialogTemplate-dialogForm-login-name1': 'User Name Required',
      'dialogTemplate-dialogForm-login-password': 'Password Required',
    },
    elements: [username, password],
  });

  assert.match(context.getLabelText(username), /^User Name Required/i);
  assert.match(context.getLabelText(password), /^Password Required/i);
  assert.equal(context.answerForField({ element: username, type: 'text', label: context.getLabelText(username) }, profileFixture(), {}).reason, 'saved ATS account or browser password manager handles login');
  assert.equal(context.answerForField({ element: password, type: 'password', label: context.getLabelText(password) }, profileFixture(), {}).reason, 'saved ATS account or browser password manager handles login');

  const language = new TestHTMLElement({ id: 'taleo-language', tagName: 'SELECT' });
  const languageMatch = context.answerForField({ element: language, type: 'select', label: 'Select a language' }, profileFixture(), {});
  assert.equal(languageMatch.action, 'fill');
  assert.equal(languageMatch.answer, 'English');
}

async function icimsPrivacyAcknowledgementTest() {
  const privacy = new TestInputElement({
    id: 'privacy-policy',
    tagName: 'INPUT',
    type: 'checkbox',
  });
  const context = loadAutofillContext({
    hostname: 'careers-example.icims.com',
    href: 'https://careers-example.icims.com/jobs/123/software-engineer/login',
    labels: { 'privacy-policy': 'I accept the Privacy Policy' },
    elements: [privacy],
  });
  const field = {
    element: privacy,
    type: 'checkbox',
    label: 'I accept the Privacy Policy',
  };
  const match = context.answerForField(field, profileFixture(), {});
  assert.equal(match.action, 'fill');
  assert.equal(match.reason, 'required privacy notice acknowledgement');
  const result = await context.fillField(field, match);
  assert.equal(result.filled, true);
  assert.equal(privacy.checked, true);

  const gdprPrivacy = new TestInputElement({
    id: 'accept_gdpr',
    tagName: 'INPUT',
    type: 'checkbox',
  });
  const gdprContext = loadAutofillContext({
    hostname: 'careers-iehp.icims.com',
    href: 'https://careers-iehp.icims.com/jobs/6500/example/login',
    elements: [gdprPrivacy],
  });
  const gdprMatch = gdprContext.answerForField({
    element: gdprPrivacy,
    type: 'checkbox',
    label: 'You must indicate that you have read the privacy notice and consent to the processing of your personal data before you can continue.',
  }, profileFixture(), {});
  assert.equal(gdprMatch.action, 'fill');
  assert.equal(gdprMatch.reason, 'required privacy notice acknowledgement');
  const gdprResult = await gdprContext.fillField({
    element: gdprPrivacy,
    type: 'checkbox',
    label: 'You must indicate that you have read the privacy notice and consent to the processing of your personal data before you can continue.',
  }, gdprMatch);
  assert.equal(gdprResult.filled, true);
  assert.equal(gdprPrivacy.checked, true);

  const profile = profileFixture();
  profile.autofillAnswers.custom.unshift({
    label: 'Enter Your Information Email',
    keywords: 'enter information email',
    answer: 'Alex Morgan',
  });
  const email = context.answerForField({
    element: new TestInputElement({ id: 'email', tagName: 'INPUT', type: 'email' }),
    type: 'email',
    label: 'Welcome page Enter Your Information Email Privacy Policy',
  }, profile, {});
  assert.equal(email.reason, 'email');
  assert.equal(email.answer, 'alex.morgan@example.com');
}

function workableStructuredEntryTest() {
  const context = loadAutofillContext({
    hostname: 'apply.workable.com',
    href: 'https://apply.workable.com/example/j/ABC123/apply/',
  });
  assert.equal(context.monthYearAnswer('2022-09-01'), '09/2022');
  assert.equal(context.monthYearAnswer('May 2026'), '05/2026');

  assert.deepEqual(
    JSON.parse(JSON.stringify(context.workableEntryValues('Education', {
      school: 'Example Institute of Technology',
      degree: 'Bachelor of Science',
      field: 'Computer Science with a minor in Data Science',
      startDate: '2022-09-01',
      endDate: '2026-05-01',
    }))),
    {
      school: 'Example Institute of Technology',
      field_of_study: 'Computer Science',
      degree: 'Bachelor of Science',
      start_date: '09/2022',
      end_date: '05/2026',
    },
  );

  assert.deepEqual(
    JSON.parse(JSON.stringify(context.workableEntryValues('Experience', {
      title: 'Software Engineer Intern',
      company: 'Example Co',
      highlights: ['Built an API.', 'Added integration tests.'],
      startDate: '2025-01-01',
      current: true,
    }))),
    {
      title: 'Software Engineer Intern',
      company: 'Example Co',
      industry: '',
      summary: 'Built an API.\nAdded integration tests.',
      start_date: '01/2025',
      end_date: '',
      currently_work_here: true,
    },
  );
}

async function workableCustomRadioTest() {
  const group = new TestHTMLElement({ id: 'workable-eligibility', tagName: 'DIV', role: 'radiogroup' });
  const yes = new TestHTMLElement({ id: 'workable-yes', tagName: 'DIV', role: 'radio', textContent: 'YES' });
  const no = new TestHTMLElement({ id: 'workable-no', tagName: 'DIV', role: 'radio', textContent: 'NO' });
  const yesInput = new TestInputElement({ tagName: 'INPUT', type: 'radio', name: 'eligibility', value: 'true' });
  const noInput = new TestInputElement({ tagName: 'INPUT', type: 'radio', name: 'eligibility', value: 'false' });
  yes.parentElement = group;
  no.parentElement = group;
  yesInput.parentElement = yes;
  noInput.parentElement = no;
  yes.children = [yesInput];
  no.children = [noInput];
  group.children = [yes, yesInput, no, noInput];

  const context = loadAutofillContext({
    hostname: 'apply.workable.com',
    href: 'https://apply.workable.com/example/j/ABC123/apply/',
    elements: [yes, yesInput, no, noInput],
  });
  const field = {
    element: yes,
    type: 'radio',
    label: 'Are you eligible to work in the country you are applying?',
  };
  const eligibility = context.answerForField(field, profileFixture(), {});
  assert.equal(eligibility.answer, 'Yes');
  const result = await context.fillField(field, eligibility);
  assert.equal(result.filled, true);
  assert.equal(yesInput.checked, true);

  const affirmation = context.answerForField({
    element: yes,
    type: 'radio',
    label: 'Can you confirm that everything in this application is true and your own?',
  }, profileFixture(), {});
  assert.equal(affirmation.action, 'fill');
  assert.equal(affirmation.answer, 'Yes');
}

async function workableAriaLabelledRadioTest() {
  const yesWrapper = new TestHTMLElement({
    id: 'workable-w2-yes-wrapper',
    tagName: 'DIV',
    role: 'radio',
    'aria-labelledby': 'workable-w2-question workable-w2-yes-label',
    'aria-checked': 'false',
    textContent: 'SVGs not supported by this browser.',
    innerText: '',
  });
  const noWrapper = new TestHTMLElement({
    id: 'workable-w2-no-wrapper',
    tagName: 'DIV',
    role: 'radio',
    'aria-labelledby': 'workable-w2-question workable-w2-no-label',
    'aria-checked': 'false',
    textContent: 'SVGs not supported by this browser.',
    innerText: '',
  });
  const yesInput = new TestInputElement({
    id: 'workable-w2-yes',
    tagName: 'INPUT',
    type: 'radio',
    name: 'workable-w2',
    value: 'yes-value',
    'aria-hidden': 'true',
  });
  const noInput = new TestInputElement({
    id: 'workable-w2-no',
    tagName: 'INPUT',
    type: 'radio',
    name: 'workable-w2',
    value: 'no-value',
    'aria-hidden': 'true',
  });
  yesInput.parentElement = yesWrapper;
  noInput.parentElement = noWrapper;
  yesWrapper.children = [yesInput];
  noWrapper.children = [noInput];

  const context = loadAutofillContext({
    hostname: 'apply.workable.com',
    href: 'https://apply.workable.com/example/j/ABC123/apply/',
    labels: {
      'workable-w2-question': 'Are you currently eligible and willing to work on a W-2 status in the United States without sponsorship?',
      'workable-w2-yes-label': 'Yes',
      'workable-w2-no-label': 'No',
    },
    elements: [yesWrapper, yesInput, noWrapper, noInput],
  });

  const fields = context.collectFields();
  assert.equal(fields.length, 1);
  assert.match(fields[0].label, /eligible and willing to work/i);
  const match = context.answerForField(fields[0], profileFixture(), {});
  assert.equal(match.answer, 'Yes');
  const result = await context.fillField(fields[0], match);
  assert.equal(result.filled, true);
  assert.equal(yesInput.checked, true);
  assert.equal(noInput.checked, false);

  const backgroundCheck = context.answerForField({
    element: yesWrapper,
    type: 'radio',
    label: 'Are you willing to undergo a background check, in accordance with local law and regulations?',
  }, profileFixture(), {});
  assert.equal(backgroundCheck.action, 'fill');
  assert.equal(backgroundCheck.answer, 'Yes');
}

function workableHiddenAddressMetadataTest() {
  const address = new TestInputElement({
    id: 'address',
    tagName: 'INPUT',
    type: 'text',
    name: 'address',
    'aria-label': 'Address',
  });
  const city = new TestInputElement({
    id: 'city',
    tagName: 'INPUT',
    type: 'text',
    name: 'city',
    'aria-hidden': 'true',
    tabindex: '-1',
  });
  const postcode = new TestInputElement({
    id: 'postcode',
    tagName: 'INPUT',
    type: 'text',
    name: 'postcode',
    'aria-hidden': 'true',
    tabindex: '-1',
  });
  const country = new TestInputElement({
    id: 'country',
    tagName: 'INPUT',
    type: 'text',
    name: 'country',
    'aria-hidden': 'true',
    tabindex: '-1',
  });
  const context = loadAutofillContext({
    hostname: 'apply.workable.com',
    href: 'https://apply.workable.com/example/j/ABC123/apply/',
    elements: [address, city, postcode, country],
  });

  const fields = context.collectFields();
  assert.equal(fields.length, 1);
  assert.equal(fields[0].element, address);
}

function applicationSurfaceGuardTest() {
  const listingFilter = new TestInputElement({
    id: 'keyword-filter',
    tagName: 'INPUT',
    type: 'text',
    name: 'keyword-filter',
    placeholder: 'Search jobs',
  });
  const greenhouseListing = loadAutofillContext({
    href: 'https://job-boards.greenhouse.io/example',
    elements: [listingFilter],
  });
  assert.equal(greenhouseListing.collectFields().length, 0);

  const greenhouseApplication = loadAutofillContext({
    href: 'https://job-boards.greenhouse.io/example/jobs/1234567',
    elements: [listingFilter],
  });
  assert.equal(greenhouseApplication.collectFields().length, 1);

  const ashbyListing = loadAutofillContext({
    hostname: 'jobs.ashbyhq.com',
    href: 'https://jobs.ashbyhq.com/example/role-id',
    elements: [listingFilter],
  });
  assert.equal(ashbyListing.collectFields().length, 0);

  const ashbyApplication = loadAutofillContext({
    hostname: 'jobs.ashbyhq.com',
    href: 'https://jobs.ashbyhq.com/example/role-id/application',
    elements: [listingFilter],
  });
  assert.equal(ashbyApplication.collectFields().length, 1);
}

function customCheckboxAndAddressTest() {
  const relocationQuestion = "We hire in multiple locations across the US; please select which locations you're 100% committed to working in and relocating to if offered a position?";
  const relocationGroup = new TestHTMLElement({
    tagName: 'DIV',
    textContent: `${relocationQuestion} Massachusetts Rhode Island Connecticut California`,
    innerText: `${relocationQuestion} Massachusetts Rhode Island Connecticut California`,
  });
  const states = ['Massachusetts', 'Rhode Island', 'Connecticut', 'California'].map((stateName, index) => {
    const checkbox = new TestInputElement({
      id: `state-${index}`,
      tagName: 'INPUT',
      type: 'checkbox',
      name: 'relocation-locations',
      value: stateName,
      'aria-label': stateName,
    });
    checkbox.parentElement = relocationGroup;
    return checkbox;
  });
  relocationGroup.children = states;
  const context = loadAutofillContext({ elements: states });
  const fields = context.collectFields();
  assert.equal(fields.length, 4);
  assert.equal(context.displayFieldLabel(fields[0].label), relocationQuestion);

  const profile = profileFixture({
    autofillAnswers: {
      yearsProfessionalExperience: '1',
      yearsSoftwareExperience: '2',
      sponsorshipRequired: 'No',
      willingToRelocate: 'Yes',
      custom: [{
        label: relocationQuestion,
        aliases: [relocationQuestion],
        answer: 'Massachusetts, Rhode Island, Connecticut',
        shortAnswer: 'Massachusetts, Rhode Island, Connecticut',
      }],
    },
  });
  const massachusetts = context.answerForField(fields[0], profile, {});
  const rhodeIsland = context.answerForField(fields[1], profile, {});
  const connecticut = context.answerForField(fields[2], profile, {});
  assert.equal(massachusetts.action, 'fill', JSON.stringify(massachusetts));
  assert.equal(rhodeIsland.action, 'fill', JSON.stringify(rhodeIsland));
  assert.equal(connecticut.action, 'fill', JSON.stringify(connecticut));
  const california = context.answerForField(fields[3], profile, {});
  assert.equal(california.action, 'skip');
  assert.equal(california.reason, 'custom checkbox option not selected');
  assert.equal(context.learnableReason(california.reason), false);

  const optionalAddress = context.answerForField({
    label: 'Address Line 2',
    type: 'text',
    required: false,
  }, profile, {});
  assert.equal(optionalAddress.action, 'skip');
  assert.equal(optionalAddress.reason, 'optional secondary address left blank');
  assert.equal(context.learnableReason(optionalAddress.reason), false);

  const addressProfile = profileFixture({
    autofillAnswers: {
      yearsProfessionalExperience: '1',
      yearsSoftwareExperience: '2',
      sponsorshipRequired: 'No',
      custom: [
        {
          label: 'Current Mailing Address',
          aliases: ['Street address', 'Address line 1'],
          answer: '123 Example St',
          shortAnswer: '123 Example St',
        },
        {
          label: 'Postal code',
          aliases: ['ZIP code'],
          answer: '02108',
          shortAnswer: '02108',
        },
        {
          label: 'Current clearance level',
          aliases: ['Current clearance level'],
          answer: 'Clearable',
          shortAnswer: 'Clearable',
        },
      ],
    },
  });
  assert.equal(context.answerForField({ label: 'Current Mailing Address', type: 'text' }, addressProfile, {}).answer, '123 Example St');
  assert.equal(context.answerForField({ label: 'ZIP code', type: 'text' }, addressProfile, {}).answer, '02108');
  assert.equal(context.answerForField({ label: 'Current clearance level', type: 'select' }, addressProfile, {}).answer, 'Clearable');
}

async function workableConservativeQuestionMappingTest() {
  const context = loadAutofillContext({
    hostname: 'apply.workable.com',
    href: 'https://apply.workable.com/example/j/ABC123/apply/',
  });
  const profile = profileFixture({
    salaryMinimum: '$60,000',
    autofillAnswers: {
      yearsProfessionalExperience: '1',
      yearsSoftwareExperience: '2',
      sponsorshipRequired: 'No',
      custom: [
        {
          label: 'Do you speak other languages?',
          keywords: 'speak languages',
          answer: 'No',
        },
        {
          label: 'Name',
          keywords: 'name',
          answer: 'Alex Morgan',
        },
        {
          label: 'Visa sponsorship',
          keywords: 'sponsor sponsorship visa require sponsorship now future',
          answer: 'No',
        },
        {
          label: 'Work authorization',
          keywords: 'authorized eligible legally authorized right to work united states',
          answer: 'Yes',
        },
      ],
    },
  });

  const languages = context.answerForField({
    label: 'Please list all the languages you speak and indicate your proficiency level for each.',
    type: 'textarea',
  }, profile, {});
  assert.equal(languages.action, 'skip');
  assert.equal(languages.reason, 'custom answer format does not fit this question');

  const yenSalary = context.answerForField({
    label: 'Please share your current and expected salary range in Japanese yen.',
    type: 'textarea',
  }, profile, {});
  assert.equal(yenSalary.action, 'skip');
  assert.equal(yenSalary.reason, 'requested salary currency is not in the profile');

  const monthlySalary = context.answerForField({
    label: 'What is your salary expectation for this position? (In USD per month)',
    type: 'text',
  }, profile, {});
  assert.equal(monthlySalary.action, 'skip');
  assert.equal(monthlySalary.reason, 'requested salary period is not in the profile');

  const annualSalary = context.answerForField({
    label: 'What is your desired annual salary?',
    type: 'text',
  }, profile, {});
  assert.equal(annualSalary.action, 'fill');
  assert.equal(annualSalary.answer, '$60,000');

  const optionalFacebook = context.answerForField({
    label: 'Facebook',
    type: 'text',
  }, profile, {});
  assert.equal(optionalFacebook.action, 'skip');
  assert.equal(optionalFacebook.reason, 'no Facebook profile URL in profile');
  assert.equal(context.learnableReason(optionalFacebook.reason), false);

  const combinedAuthorization = context.answerForField({
    label: 'Are you authorized to work in the US? Will you need sponsorship?',
    type: 'textarea',
  }, profile, {});
  assert.equal(combinedAuthorization.action, 'fill');
  assert.equal(
    combinedAuthorization.answer,
    'Yes, I am legally authorized to work and do not require sponsorship.',
  );

  const combinedAuthorizationLabel = 'Are you legally authorized to work in the United States without requiring current or future visa sponsorship?';
  const unresolvedCombinedAuthorization = context.answerForField({
    label: combinedAuthorizationLabel,
    type: 'radio',
  }, profile, {});
  assert.equal(unresolvedCombinedAuthorization.action, 'skip');
  assert.equal(unresolvedCombinedAuthorization.reason, 'no confident profile match');
  assert.equal(context.exactCustomAnswer(profile, combinedAuthorizationLabel, { label: combinedAuthorizationLabel, type: 'radio' }), '');
  assert.equal(context.learnableReason(unresolvedCombinedAuthorization.reason), true);
  assert.equal(context.learnableQuestion(combinedAuthorizationLabel), true);
  context.combinedAuthorizationLabel = combinedAuthorizationLabel;
  vm.runInContext(`
    state.lastFillResults = [{
      label: combinedAuthorizationLabel,
      filled: false,
      reason: 'no confident profile match',
    }];
  `, context);
  const combinedAuthorizationCandidates = context.customAnswerCandidates();
  assert.equal(combinedAuthorizationCandidates.length, 1);
  assert.equal(combinedAuthorizationCandidates[0].label, combinedAuthorizationLabel);

  const resumeProjectQuestion = 'In 2-3 sentences, describe a specific project from your resume and your exact role in it.';
  assert.equal(context.learnableQuestion(resumeProjectQuestion), true);
  assert.equal(context.learnableQuestion('Resume/CV'), false);
  assert.equal(context.learnableQuestion('Upload your resume here'), false);
  context.resumeProjectQuestion = resumeProjectQuestion;
  vm.runInContext(`
    state.lastFillResults = [{
      label: resumeProjectQuestion,
      filled: false,
      reason: 'no confident profile match',
      match: { action: 'skip', answer: '', reason: 'no confident profile match' },
    }];
  `, context);
  const resumeProjectCandidates = context.customAnswerCandidates();
  assert.equal(resumeProjectCandidates.length, 1);
  assert.equal(resumeProjectCandidates[0].label, resumeProjectQuestion);
  assert.match(context.customAnswerPanel(), /Save custom answer/);

  const commuteQuestion = 'Do you reside in the location for this job posting or within commutable distance?';
  context.noisyCommuteLabel = `${commuteQuestion} | Resume/CV`;
  vm.runInContext(`
    state.lastFillResults = [{
      label: noisyCommuteLabel,
      filled: false,
      reason: 'no matching dropdown option',
      match: { action: 'fill', answer: 'Boston, Massachusetts, United States', reason: 'custom autofill answer' },
    }];
  `, context);
  const commuteCandidates = context.customAnswerCandidates();
  assert.equal(commuteCandidates.length, 1);
  assert.equal(commuteCandidates[0].label, commuteQuestion);

  const shortCompanyQuestion = 'Why N1?';
  assert.equal(context.learnableQuestion(shortCompanyQuestion), true);
  context.shortCompanyQuestion = shortCompanyQuestion;
  vm.runInContext(`
    state.lastFillResults = [{
      label: shortCompanyQuestion,
      filled: false,
      reason: 'no confident profile match',
      match: { action: 'skip', answer: '', reason: 'no confident profile match' },
    }];
  `, context);
  const shortQuestionCandidates = context.customAnswerCandidates();
  assert.equal(shortQuestionCandidates.length, 1);
  assert.equal(shortQuestionCandidates[0].label, shortCompanyQuestion);
  assert.match(context.customAnswerPanel(), /Why N1\?/);
  assert.match(context.customAnswerPanel(), /Save custom answer/);
  context.shortQuestionKey = shortQuestionCandidates[0].key;
  vm.runInContext(`state.customAnswerDrafts[shortQuestionKey] = 'Approved draft';`, context);
  assert.match(context.customAnswerPanel(), />Approved draft<\/textarea>/);

  const learnedCombinedAuthorization = context.answerForField({
    label: combinedAuthorizationLabel,
    type: 'radio',
  }, profileFixture({
    autofillAnswers: {
      yearsProfessionalExperience: '1',
      yearsSoftwareExperience: '2',
      sponsorshipRequired: 'No',
      custom: [{
        label: combinedAuthorizationLabel,
        aliases: [combinedAuthorizationLabel],
        answer: 'Yes',
        shortAnswer: 'Yes',
      }],
    },
  }), {});
  assert.equal(learnedCombinedAuthorization.action, 'fill');
  assert.equal(learnedCombinedAuthorization.answer, 'Yes');
  assert.equal(learnedCombinedAuthorization.reason, 'custom autofill answer');

  const combinedAuthorizationYes = new TestInputElement({
    id: 'combined-authorization-yes',
    tagName: 'INPUT',
    type: 'radio',
    name: 'combined-authorization',
    value: 'Yes',
  });
  const combinedAuthorizationNo = new TestInputElement({
    id: 'combined-authorization-no',
    tagName: 'INPUT',
    type: 'radio',
    name: 'combined-authorization',
    value: 'No',
  });
  const combinedAuthorizationGroup = new TestHTMLElement({
    tagName: 'DIV',
    textContent: `${combinedAuthorizationLabel} Yes No`,
    innerText: `${combinedAuthorizationLabel} Yes No`,
  });
  combinedAuthorizationGroup.children = [combinedAuthorizationYes, combinedAuthorizationNo];
  combinedAuthorizationYes.parentElement = combinedAuthorizationGroup;
  combinedAuthorizationNo.parentElement = combinedAuthorizationGroup;
  const refreshContext = loadAutofillContext({
    elements: [combinedAuthorizationYes, combinedAuthorizationNo],
  });
  refreshContext.savedCombinedAuthorizationProfile = profileFixture({
    autofillAnswers: {
      yearsProfessionalExperience: '1',
      yearsSoftwareExperience: '2',
      sponsorshipRequired: 'No',
      custom: [{
        label: combinedAuthorizationLabel,
        aliases: [combinedAuthorizationLabel],
        answer: 'Yes',
        shortAnswer: 'Yes',
      }],
    },
  });
  refreshContext.unlearnedCombinedAuthorizationProfile = profileFixture();
  refreshContext.combinedAuthorizationLabel = combinedAuthorizationLabel;
  vm.runInContext(`
    state.profile = unlearnedCombinedAuthorizationProfile;
    state.lastFillResults = [{
      label: combinedAuthorizationLabel,
      filled: false,
      reason: 'no confident profile match',
      match: { action: 'skip', answer: '', reason: 'no confident profile match' },
    }];
  `, refreshContext);
  const refreshedScan = refreshContext.applyUpdatedProfile(refreshContext.savedCombinedAuthorizationProfile);
  assert.equal(refreshContext.lastFillRows().length, 0);
  assert.equal(refreshedScan.fields.length, 1);
  assert.equal(refreshedScan.fields[0].action, 'fill');
  assert.equal(refreshedScan.fields[0].answer, 'Yes');
  assert.equal(refreshContext.customAnswerCandidates().length, 0);
  assert.match(refreshContext.panelRows(), /<span>Yes<\/span>/);

  const freshFillContext = loadAutofillContext({
    runtimeHandler: async (message) => (
      message.type === 'ROLEMATCH_FILL_CURRENT_TAB'
        ? { ok: true }
        : { ok: false, error: 'unexpected message' }
    ),
  });
  const freshFillResult = await freshFillContext.fillCurrentTabWithLatestProfile();
  assert.equal(freshFillResult.ok, true);
  assert.equal(freshFillContext.runtimeMessages.length, 1);
  assert.equal(freshFillContext.runtimeMessages[0].type, 'ROLEMATCH_FILL_CURRENT_TAB');

  const highschool = context.answerForField({
    label: 'Highschool Name & Location',
    type: 'text',
  }, profile, {});
  assert.equal(highschool.action, 'skip');
  assert.equal(highschool.reason, 'no confident profile match');

  const threshold = context.answerForField({
    label: 'Do you have at least 7+ years of professional experience in software engineering?',
    type: 'radio',
  }, profile, {});
  assert.equal(threshold.action, 'fill');
  assert.equal(threshold.answer, 'No');

  const eligibility = context.answerForField({
    label: 'Are you legally eligible to be employed in the United States?',
    type: 'radio',
  }, profile, {});
  assert.equal(eligibility.action, 'fill');
  assert.equal(eligibility.answer, 'Yes');

  const w2 = context.answerForField({
    label: 'Are you currently eligible and willing to work on a W-2 status in the United States without sponsorship?',
    type: 'radio',
  }, profile, {});
  assert.equal(w2.action, 'fill');
  assert.equal(w2.answer, 'Yes');

  const goYears = context.answerForField({
    label: 'How many years of hands-on professional experience do you have with Go? Please do not include education or side projects.',
    type: 'text',
  }, profile, {});
  assert.equal(goYears.action, 'fill');
  assert.equal(goYears.answer, '0');

  const narrativeExperience = context.answerForField({
    label: 'Can you describe your experience with building and maintaining production data pipelines? What challenges did you face?',
    type: 'textarea',
  }, profile, {});
  assert.equal(narrativeExperience.action, 'skip');
  assert.equal(narrativeExperience.reason, 'no confident profile match');

  const medallion = context.answerForField({
    label: 'This role involves building and maintaining Medallion-style data architecture. Have you worked with a similar project?',
    type: 'textarea',
  }, profile, {});
  assert.equal(medallion.action, 'skip');
  assert.equal(medallion.reason, 'no confident profile match');

  const phpYears = context.answerForField({
    label: 'How many years of professional experience do you have with PHP development?',
    type: 'text',
  }, profile, {});
  assert.equal(phpYears.action, 'fill');
  assert.equal(phpYears.answer, '0');

  const euCitizenship = context.answerForField({
    label: 'Do you hold EU citizenship?',
    type: 'radio',
  }, profile, {});
  assert.equal(euCitizenship.action, 'skip');
  assert.equal(euCitizenship.reason, 'requested citizenship is not explicit in the profile');
}

function postedSalaryAndAdultVerificationOverrideTest() {
  const fanaticsContext = loadAutofillContext({
    pageText: 'Salary Range\n$118,000 - $156,000 USD',
  });
  const profile = profileFixture({
    salaryMinimum: '$60,000',
    autofillAnswers: {
      yearsProfessionalExperience: '1',
      yearsSoftwareExperience: '2',
      sponsorshipRequired: 'No',
      custom: [
        {
          label: 'What is your base salary compensation expectation?',
          answer: '$60,000',
        },
        {
          label: 'Are you over the age of 18?',
          answer: '22',
        },
      ],
    },
  });
  const pageJob = fanaticsContext.currentPageJobContext({});
  assert.equal(pageJob.salaryMin, 118000);
  assert.equal(pageJob.salaryMax, 156000);

  const salary = fanaticsContext.answerForField({
    label: 'What is your base salary compensation expectation?',
    type: 'text',
  }, profile, {});
  assert.equal(salary.action, 'fill');
  assert.equal(salary.answer, '$135,000');
  assert.equal(salary.reason, 'posted salary range');

  const adult = fanaticsContext.answerForField({
    label: 'Are you over the age of 18 ?',
    type: 'select',
  }, profile, {});
  assert.equal(adult.action, 'fill');
  assert.equal(adult.answer, 'Yes');
  assert.equal(adult.reason, 'age verification');

  const babelContext = loadAutofillContext({
    pageText: 'Range for this position based on qualifications and experience\n$70,000 - $80,000 USD',
  });
  const babelSalary = babelContext.answerForField({
    label: 'Desired salary',
    type: 'text',
  }, profile, {});
  assert.equal(babelSalary.answer, '$74,000');
  assert.equal(babelSalary.reason, 'posted salary range');
}

function ashbyStandardFieldInferenceTest() {
  const context = loadAutofillContext({
    hostname: 'jobs.ashbyhq.com',
    href: 'https://jobs.ashbyhq.com/example/role',
  });
  const profile = profileFixture();
  const fields = [
    [new TestInputElement({ tagName: 'INPUT', name: 'name', 'aria-label': 'Name' }), /full name|name/i, 'Alex Morgan'],
    [new TestInputElement({ tagName: 'INPUT', name: 'email', 'aria-label': 'Email' }), /email/i, 'alex.morgan@example.com'],
    [new TestInputElement({ tagName: 'INPUT', type: 'file', name: 'resume', 'aria-label': 'Resume' }), /resume/i, 'file'],
  ];

  for (const [element, labelPattern, expected] of fields) {
    const label = context.getLabelText(element);
    assert.match(label, labelPattern);
    const match = context.answerForField({ element, label, type: context.fieldType(element) }, profile, {});
    if (expected === 'file') {
      assert.equal(match.action, 'file');
    } else {
      assert.equal(match.action, 'fill');
      assert.equal(match.answer, expected);
    }
  }

  const preferredNameProfile = profileFixture({
    autofillAnswers: {
      ...profile.autofillAnswers,
      custom: [{ label: 'Preferred Name', answer: 'No' }],
    },
  });
  const preferredNameField = {
    element: new TestInputElement({ tagName: 'INPUT', name: 'preferredName', 'aria-label': 'Preferred Name' }),
    label: 'Preferred Name',
    type: 'text',
  };
  assert.equal(context.answerForField(preferredNameField, preferredNameProfile, {}).action, 'skip');

  const coverLetterField = {
    element: new TestInputElement({ tagName: 'INPUT', type: 'file', name: 'coverLetter', 'aria-label': 'Cover Letter' }),
    label: 'Cover Letter | Resume Upload',
    type: 'file',
  };
  const coverLetterMatch = context.answerForField(coverLetterField, profile, {});
  assert.equal(coverLetterMatch.action, 'skip');
  assert.equal(coverLetterMatch.reason, 'cover letter file needs manual selection');
}

function ashbyPageContextAndSensitiveFieldTest() {
  const context = loadAutofillContext({
    hostname: 'jobs.ashbyhq.com',
    href: 'https://jobs.ashbyhq.com/frontcareers/job/application',
    pageTitle: 'Senior Product Manager (Developer Platform) @ Front',
    pageHeading: 'Senior Product Manager (Developer Platform)',
  });
  const staleJob = { title: 'Software Engineer', company: 'Remesh' };
  const pageJob = context.currentPageJobContext(staleJob);
  assert.equal(pageJob.title, 'Senior Product Manager (Developer Platform)');
  assert.equal(pageJob.company, 'Front');
  assert.equal(pageJob.jobUrl, 'https://jobs.ashbyhq.com/frontcareers/job/application');

  const interest = context.answerForField(
    { label: 'Additional Information', type: 'textarea' },
    profileFixture(),
    staleJob,
  );
  assert.equal(interest.action, 'fill');
  assert.match(interest.answer, /Senior Product Manager \(Developer Platform\)/);
  assert.match(interest.answer, /Front/);
  assert.doesNotMatch(interest.answer, /Software Engineer|Remesh/);

  const genericGenderProfile = profileFixture({
    autofillAnswers: {
      custom: [{ label: 'Gender identity', keywords: 'gender identity', answer: 'Male' }],
    },
  });
  const transgender = context.answerForField(
    { label: 'Do you identify as transgender?', type: 'radio' },
    genericGenderProfile,
    {},
  );
  assert.equal(transgender.action, 'skip');
  assert.equal(transgender.reason, 'no explicit transgender answer in profile');
}

async function ashbyResumeParserPrecedenceTest() {
  const resume = new TestInputElement({
    tagName: 'INPUT',
    type: 'file',
    name: 'resume',
    'aria-label': 'Resume',
  });
  const name = new TestInputElement({
    tagName: 'INPUT',
    type: 'text',
    name: 'name',
    'aria-label': 'Name',
  });
  const email = new TestInputElement({
    tagName: 'INPUT',
    type: 'text',
    name: 'email',
    'aria-label': 'Email',
  });
  resume.dispatchEvent = function dispatchResumeEvent(event) {
    this.events.push(event.type);
    if (event.type === 'change') {
      name.value = 'Resume Parser Name';
      email.value = 'resume-parser@example.com';
    }
    return true;
  };

  const context = loadAutofillContext({
    hostname: 'jobs.ashbyhq.com',
    href: 'https://jobs.ashbyhq.com/example/role/application',
    elements: [resume, name, email],
    fileResponse: {
      ok: true,
      file: {
        base64: Buffer.from('resume').toString('base64'),
        fileName: 'Alex_Morgan_Resume.docx',
        mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      },
    },
  });

  const response = await context.fillVisibleFields(profileFixture(), {});
  assert.equal(response.ok, true);
  assert.equal(name.value, 'Alex Morgan');
  assert.equal(email.value, 'alex.morgan@example.com');
  assert.equal(context.filledResultCount([
    { key: 'resume', filled: true },
    { key: 'name', filled: true },
    { key: 'name', filled: true },
    { key: 'manual', filled: false },
  ]), 2);
}

async function ashbyYesNoCheckboxTest() {
  const sponsor = new TestInputElement({
    id: 'ashby-sponsorship',
    tagName: 'INPUT',
    type: 'checkbox',
    name: 'sponsorship',
  });
  const yesButton = new TestHTMLElement({ tagName: 'BUTTON', textContent: 'Yes', innerText: 'Yes' });
  const noButton = new TestHTMLElement({ tagName: 'BUTTON', textContent: 'No', innerText: 'No' });
  const container = new TestHTMLElement({ tagName: 'DIV', textContent: 'Yes No', innerText: 'Yes No' });
  container.children = [yesButton, noButton, sponsor];
  yesButton.parentElement = container;
  noButton.parentElement = container;
  sponsor.parentElement = container;

  const context = loadAutofillContext({
    hostname: 'jobs.ashbyhq.com',
    href: 'https://jobs.ashbyhq.com/example/role/application',
    labels: {
      'ashby-sponsorship': 'Will you now or in the future require sponsorship for employment visa status?',
    },
    elements: [sponsor],
  });
  const field = context.collectFields()[0];
  const match = context.answerForField(field, profileFixture(), {});
  assert.equal(match.action, 'fill');
  assert.equal(match.answer, 'No');
  const result = await context.fillField(field, match);
  assert.equal(result.filled, true);
  assert.equal(result.value, 'No');
  assert.equal(noButton.clicked, true);
  assert.equal(yesButton.clicked, false);
  assert.equal(sponsor.checked, false);
  assert.deepEqual(sponsor.events.slice(-2), ['input', 'change']);
  assert.equal(sponsor.getAttribute('data-rolematch-filled'), 'true');

  const authorization = new TestInputElement({
    id: 'ashby-authorization',
    tagName: 'INPUT',
    type: 'checkbox',
    name: 'authorization',
  });
  const authorizationYes = new TestHTMLElement({ tagName: 'BUTTON', textContent: 'Yes', innerText: 'Yes' });
  const authorizationNo = new TestHTMLElement({ tagName: 'BUTTON', textContent: 'No', innerText: 'No' });
  const authorizationContainer = new TestHTMLElement({ tagName: 'DIV', textContent: 'Yes No', innerText: 'Yes No' });
  authorizationContainer.children = [authorizationYes, authorizationNo, authorization];
  authorizationYes.parentElement = authorizationContainer;
  authorizationNo.parentElement = authorizationContainer;
  authorization.parentElement = authorizationContainer;

  const authorizationContext = loadAutofillContext({
    hostname: 'jobs.ashbyhq.com',
    href: 'https://jobs.ashbyhq.com/example/role/application',
    labels: {
      'ashby-authorization': 'Are you legally authorized to work in United States without sponsorship?',
    },
    elements: [authorization],
  });
  const authorizationField = authorizationContext.collectFields()[0];
  const authorizationMatch = authorizationContext.answerForField(authorizationField, profileFixture(), {});
  assert.equal(authorizationMatch.action, 'fill');
  assert.equal(authorizationMatch.answer, 'Yes');
  const authorizationResult = await authorizationContext.fillField(authorizationField, authorizationMatch);
  assert.equal(authorizationResult.filled, true);
  assert.equal(authorizationResult.value, 'Yes');
  assert.equal(authorizationYes.clicked, true);
  assert.equal(authorizationNo.clicked, false);
  assert.equal(authorization.checked, true);
  assert.deepEqual(authorization.events.slice(-2), ['input', 'change']);
  assert.equal(authorization.getAttribute('data-rolematch-filled'), 'true');

  const b2bLabel = 'Do you have prior experience supporting a B2B SaaS product?';
  const b2b = new TestInputElement({
    id: 'ashby-b2b-saas',
    tagName: 'INPUT',
    type: 'checkbox',
    name: 'b2b-saas',
  });
  const b2bYes = new TestHTMLElement({ tagName: 'BUTTON', textContent: 'Yes', innerText: 'Yes' });
  const b2bNo = new TestHTMLElement({ tagName: 'BUTTON', textContent: 'No', innerText: 'No' });
  const b2bContainer = new TestHTMLElement({ tagName: 'DIV', textContent: 'Yes No', innerText: 'Yes No' });
  b2bContainer.children = [b2bYes, b2bNo, b2b];
  b2bYes.parentElement = b2bContainer;
  b2bNo.parentElement = b2bContainer;
  b2b.parentElement = b2bContainer;

  const learningContext = loadAutofillContext({
    hostname: 'jobs.ashbyhq.com',
    href: 'https://jobs.ashbyhq.com/example/role/application',
    labels: { 'ashby-b2b-saas': b2bLabel },
    elements: [b2b],
  });
  const b2bField = learningContext.collectFields()[0];
  const unmatchedB2b = learningContext.answerForField(b2bField, profileFixture(), {});
  assert.equal(unmatchedB2b.action, 'skip');
  assert.equal(unmatchedB2b.reason, 'no confident profile match');
  learningContext.b2bLabel = b2bLabel;
  vm.runInContext(`
    state.lastFillResults = [{
      label: b2bLabel,
      filled: false,
      reason: 'no confident profile match',
      match: { action: 'skip', answer: '', reason: 'no confident profile match' },
    }];
  `, learningContext);
  const candidates = learningContext.customAnswerCandidates();
  assert.equal(candidates.length, 1);
  assert.equal(candidates[0].label, b2bLabel);

  const learnedB2b = learningContext.answerForField(b2bField, profileFixture({
    autofillAnswers: {
      yearsProfessionalExperience: '1',
      yearsSoftwareExperience: '2',
      sponsorshipRequired: 'No',
      custom: [{
        label: b2bLabel,
        aliases: [b2bLabel],
        answer: 'No',
        shortAnswer: 'No',
      }],
    },
  }), {});
  assert.equal(learnedB2b.action, 'fill');
  assert.equal(learnedB2b.answer, 'No');
  const learnedResult = await learningContext.fillField(b2bField, learnedB2b);
  assert.equal(learnedResult.filled, true);
  assert.equal(learnedResult.value, 'No');
  assert.equal(b2bNo.clicked, true);
  assert.equal(b2bYes.clicked, false);

}

function directAtsPageContextTest() {
  for (const [hostname, href] of [
    ['jobs.lever.co', 'https://jobs.lever.co/whoop/backend/apply'],
    ['job-boards.greenhouse.io', 'https://job-boards.greenhouse.io/example/jobs/123'],
  ]) {
    const context = loadAutofillContext({
      hostname,
      href,
      pageTitle: 'Software Engineer I (Backend) @ WHOOP',
      pageHeading: 'Software Engineer I (Backend)',
    });
    const pageJob = context.currentPageJobContext({});
    assert.equal(pageJob.title, 'Software Engineer I (Backend)');
    assert.equal(pageJob.company, 'WHOOP');
    assert.equal(pageJob.jobUrl, href);
  }

  const greenhouseContext = loadAutofillContext({
    hostname: 'job-boards.greenhouse.io',
    href: 'https://job-boards.greenhouse.io/fanaticsfbg/jobs/4317730009',
    pageTitle: 'Job Application for Data Engineer II - (Remote) at Fanatics Betting & Gaming',
    pageHeading: 'Data Engineer II - (Remote)',
  });
  const greenhouseJob = greenhouseContext.currentPageJobContext({});
  assert.equal(greenhouseJob.title, 'Data Engineer II - (Remote)');
  assert.equal(greenhouseJob.company, 'Fanatics Betting & Gaming');
  assert.equal(greenhouseJob.jobUrl, 'https://job-boards.greenhouse.io/fanaticsfbg/jobs/4317730009');
}

async function ashbyCheckboxGroupPresentationTest() {
  const makeUniqueNameGroup = (question, prefix, choices) => {
    const container = new TestHTMLElement({
      tagName: 'DIV',
      textContent: `${question} ${choices.join(' ')}`,
      innerText: `${question} ${choices.join(' ')}`,
    });
    const checkboxes = choices.map((choice, index) => {
      const checkbox = new TestInputElement({
        id: `${prefix}-${index}`,
        tagName: 'INPUT',
        type: 'checkbox',
        name: `${prefix}-${index}`,
        value: choice,
        'aria-label': choice,
      });
      checkbox.parentElement = container;
      return checkbox;
    });
    container.children = checkboxes;
    return checkboxes;
  };

  const ethnicityQuestion = 'Which ethnicity(ies) do you identify with? Please select all that apply.';
  const ethnicity = makeUniqueNameGroup(ethnicityQuestion, 'ethnicity', [
    'Asian or Asian American',
    'Black or African American',
    'Hispanic or Latine',
    'Indigenous or Native American',
    'Middle Eastern or North African',
    'White',
    'Another ethnicity',
    'Prefer not to answer',
  ]);
  const communitiesQuestion = 'Which of the following communities do you belong to? Please select all that apply.';
  const communities = makeUniqueNameGroup(communitiesQuestion, 'communities', [
    'Person with disability',
    'Neurodivergent',
    'Veteran',
    'Parent',
    'Refugee or immigrant',
    'None of the above',
    'Prefer not to answer',
  ]);
  const context = loadAutofillContext({
    hostname: 'jobs.ashbyhq.com',
    href: 'https://jobs.ashbyhq.com/example/role/application',
    elements: [...ethnicity, ...communities],
  });

  const ethnicityLabels = ethnicity.map((checkbox) => context.displayFieldLabel(context.getLabelText(checkbox)));
  const communitiesLabels = communities.map((checkbox) => context.displayFieldLabel(context.getLabelText(checkbox)));
  assert.equal(new Set(ethnicityLabels).size, 1);
  assert.equal(ethnicityLabels[0], ethnicityQuestion);
  assert.equal(new Set(communitiesLabels).size, 1);
  assert.equal(communitiesLabels[0], communitiesQuestion);

  const scan = context.scanFields(profileFixture(), {});
  assert.equal(scan.fields.length, 15);
  const scanPanel = context.panelRows();
  assert.match(scanPanel, /Showing all 2 scanned fields/);
  assert.equal(scanPanel.split(ethnicityQuestion).length - 1, 1);
  assert.equal(scanPanel.split(communitiesQuestion).length - 1, 1);

  const response = await context.fillVisibleFields(profileFixture(), {});
  assert.equal(response.ok, true);
  const rows = context.lastFillRows();
  assert.equal(rows.length, 2);

  const ethnicityRow = rows.find((row) => row.label === ethnicityQuestion);
  assert.equal(ethnicityRow.filled, true);
  assert.equal(ethnicityRow.value, 'White');
  const communitiesRow = rows.find((row) => row.label === communitiesQuestion);
  assert.equal(communitiesRow.filled, false);
  assert.equal(communitiesRow.reason, 'checkboxes require manual review');
  assert.equal(context.fillRunSummary(), 'Last fill run: 1/2 fields filled. 1 skipped/manual.');
  assert.equal(context.customAnswerCandidates().length, 1);
  assert.equal(context.customAnswerCandidates()[0].label, communitiesQuestion);

  const panel = context.panelRows();
  assert.equal(panel.split(ethnicityQuestion).length - 1, 1);
  assert.equal(panel.split(communitiesQuestion).length - 1, 1);
  assert.match(panel, /<span>White<\/span>/);
  assert.match(panel, /<span>checkboxes require manual review<\/span>/);
}

function ashbyCountryAndChoiceMappingTest() {
  const country = new TestInputElement({
    tagName: 'INPUT',
    type: 'text',
    role: 'combobox',
    'aria-autocomplete': 'list',
    placeholder: 'Start typing...',
  });
  const inputContainer = new TestHTMLElement({ tagName: 'DIV' });
  const fieldContainer = new TestHTMLElement({
    tagName: 'DIV',
    textContent: 'Which country do you intend to work from? Please list your city and country.',
    innerText: 'Which country do you intend to work from? Please list your city and country.',
  });
  country.parentElement = inputContainer;
  inputContainer.parentElement = fieldContainer;

  const context = loadAutofillContext({
    hostname: 'jobs.ashbyhq.com',
    href: 'https://jobs.ashbyhq.com/example/role/application',
    elements: [country],
  });
  const fields = context.collectFields();
  assert.equal(fields.length, 1);
  const label = fields[0].label;
  assert.match(label, /which country do you intend to work from/i);
  const match = context.answerForField(fields[0], profileFixture(), {});
  assert.equal(match.answer, 'Boston, Massachusetts, United States');
  assert.equal(context.dropdownSearchTerm(match.answer, label), 'Boston');
  assert.equal(context.optionMatches('Under 30', '22', 'What is your current age?'), true);
  assert.equal(context.optionMatches('Man', 'Male', 'What is your gender identity?'), true);
}

async function ashbyRadioChoiceTest() {
  const underThirty = new TestInputElement({
    id: 'ashby-age-under-30',
    tagName: 'INPUT',
    type: 'radio',
    name: 'ashby-age',
    labels: [makeNode('Under 30')],
  });
  const older = new TestInputElement({
    id: 'ashby-age-30-39',
    tagName: 'INPUT',
    type: 'radio',
    name: 'ashby-age',
    labels: [makeNode('30-39')],
  });
  const context = loadAutofillContext({
    hostname: 'jobs.ashbyhq.com',
    href: 'https://jobs.ashbyhq.com/example/role/application',
    elements: [underThirty, older],
  });
  const result = await context.fillRadio(
    underThirty,
    { element: underThirty, type: 'radio', label: 'What is your current age?' },
    { action: 'fill', answer: '22' },
  );
  assert.equal(result.filled, true);
  assert.equal(result.value, 'Under 30');
  assert.equal(underThirty.checked, true);
  assert.equal(older.checked, false);
}

function workdayFieldClassificationTest() {
  const source = new TestInputElement({
    id: 'source--source',
    tagName: 'INPUT',
    type: 'text',
    placeholder: 'Search',
  });
  const firstName = new TestInputElement({
    id: 'name--legalName--firstName',
    tagName: 'INPUT',
    type: 'text',
    name: 'legalName--firstName',
  });
  const middleName = new TestInputElement({
    id: 'name--legalName--middleName',
    tagName: 'INPUT',
    type: 'text',
    name: 'legalName--middleName',
  });
  const lastName = new TestInputElement({
    id: 'name--legalName--lastName',
    tagName: 'INPUT',
    type: 'text',
    name: 'legalName--lastName',
  });
  const preferredName = new TestInputElement({
    id: 'name--preferredCheck',
    tagName: 'INPUT',
    type: 'checkbox',
    name: 'preferredCheck',
  });
  const phoneType = new TestHTMLElement({
    id: 'phoneNumber--phoneType',
    tagName: 'BUTTON',
    type: 'button',
    name: 'phoneType',
    'aria-haspopup': 'listbox',
    'aria-label': 'Phone Device Type Select One Required',
    textContent: 'Select One',
    innerText: 'Select One',
  });
  const countryPhoneCode = new TestInputElement({
    id: 'phoneNumber--countryPhoneCode',
    tagName: 'INPUT',
    type: 'text',
    placeholder: 'Search',
  });
  const phoneNumber = new TestInputElement({
    id: 'phoneNumber--phoneNumber',
    tagName: 'INPUT',
    type: 'text',
    name: 'phoneNumber',
  });
  const phoneExtension = new TestInputElement({
    id: 'phoneNumber--extension',
    tagName: 'INPUT',
    type: 'text',
    name: 'extension',
  });

  const context = loadAutofillContext({
    hostname: 'example.wd1.myworkdayjobs.com',
    href: 'https://example.wd1.myworkdayjobs.com/en-US/jobs/job/software-engineer/apply',
    labels: {
      'source--source': 'How Did You Hear About Us?',
      'name--legalName--firstName': 'First Name',
      'name--legalName--middleName': 'Middle Name',
      'name--legalName--lastName': 'Last Name',
      'name--preferredCheck': 'I have a preferred name',
      'phoneNumber--phoneType': 'Phone Device Type',
      'phoneNumber--countryPhoneCode': 'Country Phone Code',
      'phoneNumber--phoneNumber': 'Phone Number',
      'phoneNumber--extension': 'Phone Extension',
    },
    elements: [
      source,
      firstName,
      middleName,
      lastName,
      preferredName,
      phoneType,
      countryPhoneCode,
      phoneNumber,
      phoneExtension,
    ],
  });
  const fields = context.collectFields();
  const fieldFor = (element) => fields.find((field) => field.element === element);
  const profile = profileFixture();

  assert.equal(fieldFor(countryPhoneCode), undefined);
  assert.equal(fieldFor(source).type, 'combobox');
  assert.equal(context.displayFieldLabel(fieldFor(firstName).label), 'First name');
  assert.equal(context.displayFieldLabel(fieldFor(middleName).label), 'Middle name');
  assert.equal(context.displayFieldLabel(fieldFor(lastName).label), 'Last name');
  assert.equal(context.displayFieldLabel(fieldFor(preferredName).label), 'I have a preferred name');
  assert.equal(context.displayFieldLabel(fieldFor(phoneType).label), 'Phone device type');
  assert.equal(context.displayFieldLabel(fieldFor(phoneNumber).label), 'Phone number');
  assert.equal(context.displayFieldLabel(fieldFor(phoneExtension).label), 'Phone extension');

  assert.equal(context.answerForField(fieldFor(source), profile, {}).answer, 'Company careers page');
  assert.equal(context.answerForField(fieldFor(firstName), profile, {}).answer, 'Alex');
  assert.equal(context.answerForField(fieldFor(middleName), profile, {}).action, 'skip');
  assert.equal(context.answerForField(fieldFor(lastName), profile, {}).answer, 'Morgan');
  assert.equal(context.answerForField(fieldFor(preferredName), profile, {}).action, 'skip');
  assert.equal(context.answerForField(fieldFor(phoneType), profile, {}).answer, 'Mobile');
  assert.equal(context.answerForField(fieldFor(phoneNumber), profile, {}).answer, '(617) 555-0142');
  assert.equal(context.answerForField(fieldFor(phoneExtension), profile, {}).action, 'skip');

  const previousEmployment = context.answerForField({
    label: 'Have you ever been employed by Boeing or its subsidiaries as either an employee or contractor?',
    type: 'radio',
  }, profile, {});
  assert.equal(previousEmployment.action, 'fill');
  assert.equal(previousEmployment.answer, 'No');
}

async function workdayExperienceFieldMappingTest() {
  const jobTitle = new TestInputElement({ id: 'workExperience-6--jobTitle', tagName: 'INPUT', type: 'text', name: 'jobTitle' });
  const company = new TestInputElement({ id: 'workExperience-6--companyName', tagName: 'INPUT', type: 'text', name: 'companyName' });
  const location = new TestInputElement({ id: 'workExperience-6--location', tagName: 'INPUT', type: 'text', name: 'location' });
  const current = new TestInputElement({ id: 'workExperience-6--currentlyWorkHere', tagName: 'INPUT', type: 'checkbox', name: 'currentlyWorkHere' });
  const startMonth = new TestInputElement({ id: 'workExperience-6--startDate-dateSectionMonth-input', tagName: 'INPUT', type: 'text', 'aria-label': 'Month' });
  const startYear = new TestInputElement({ id: 'workExperience-6--startDate-dateSectionYear-input', tagName: 'INPUT', type: 'text', 'aria-label': 'Year' });
  const endMonth = new TestInputElement({ id: 'workExperience-6--endDate-dateSectionMonth-input', tagName: 'INPUT', type: 'text', 'aria-label': 'Month' });
  const roleDescription = new TestTextAreaElement({ id: 'workExperience-6--roleDescription', tagName: 'TEXTAREA' });
  const school = new TestInputElement({ id: 'education-15--school', tagName: 'INPUT', type: 'text', placeholder: 'Search' });
  const degree = new TestHTMLElement({
    id: 'education-15--degree',
    tagName: 'BUTTON',
    type: 'button',
    name: 'degree',
    'aria-haspopup': 'listbox',
    'aria-label': 'Degree Select One Required',
    textContent: 'Select One',
    innerText: 'Select One',
  });
  const fieldOfStudy = new TestInputElement({ id: 'education-15--fieldOfStudy', tagName: 'INPUT', type: 'text', placeholder: 'Search' });
  const gpa = new TestInputElement({ id: 'education-15--gradeAverage', tagName: 'INPUT', type: 'text', name: 'gradeAverage' });
  const educationStart = new TestInputElement({ id: 'education-15--firstYearAttended-dateSectionYear-input', tagName: 'INPUT', type: 'text', 'aria-label': 'Year' });
  const educationEnd = new TestInputElement({ id: 'education-15--lastYearAttended-dateSectionYear-input', tagName: 'INPUT', type: 'text', 'aria-label': 'Year' });
  const skillsControl = new TestHTMLElement({ tagName: 'DIV', textContent: '0 items selected', innerText: '0 items selected' });
  const skills = new TestInputElement({ id: 'skills--skills', tagName: 'INPUT', type: 'text', placeholder: 'Search' });
  skills.parentElement = skillsControl;

  const elements = [
    jobTitle,
    company,
    location,
    current,
    startMonth,
    startYear,
    endMonth,
    roleDescription,
    school,
    degree,
    fieldOfStudy,
    gpa,
    educationStart,
    educationEnd,
    skills,
  ];
  const context = loadAutofillContext({
    hostname: 'example.wd1.myworkdayjobs.com',
    href: 'https://example.wd1.myworkdayjobs.com/en-US/jobs/job/software-engineer/apply',
    labels: {
      'workExperience-6--jobTitle': 'Job Title',
      'workExperience-6--companyName': 'Company',
      'workExperience-6--location': 'Location',
      'workExperience-6--roleDescription': 'Role Description',
      'education-15--school': 'School or University',
      'education-15--degree': 'Degree',
      'education-15--fieldOfStudy': 'Field of Study',
      'education-15--gradeAverage': 'Overall Result (GPA)',
      'skills--skills': 'Type to Add Skills',
    },
    elements,
  });
  const profile = profileFixture({
    skills: ['Python', 'Java'],
    workHistory: [{
      company: 'BirthdayMessaging.io',
      title: 'Software Engineering Intern',
      location: 'Remote',
      startDate: '2025-05-01',
      current: true,
      highlights: ['Built and tested customer-facing software.'],
    }],
    educationHistory: [{
      school: 'Example Institute of Technology',
      degree: 'Bachelor of Science',
      field: 'Computer Science; Minor in Data Science',
      startDate: '2022-09-01',
      endDate: '2026-08-01',
      gpa: '2.833 overall; approximately 3.0 in-major',
    }],
  });
  const fields = context.collectFields();
  const matchFor = (element) => context.answerForField(fields.find((field) => field.element === element), profile, {});

  assert.equal(matchFor(jobTitle).answer, 'Software Engineering Intern');
  assert.equal(matchFor(company).answer, 'BirthdayMessaging.io');
  assert.equal(matchFor(location).answer, 'Remote');
  assert.equal(matchFor(startMonth).answer, '5');
  assert.equal(matchFor(startYear).answer, '2025');
  assert.equal(matchFor(endMonth).action, 'skip');
  assert.match(matchFor(roleDescription).answer, /customer-facing software/);
  assert.equal(matchFor(school).answer, 'Example Institute of Technology');
  assert.equal(matchFor(degree).answer, 'Bachelor of Science');
  assert.equal(matchFor(fieldOfStudy).answer, 'Computer Science');
  assert.equal(matchFor(gpa).answer, '2.833');
  assert.equal(matchFor(educationStart).answer, '2022');
  assert.equal(matchFor(educationEnd).answer, '2026');
  assert.deepEqual(Array.from(matchFor(skills).answers), ['Python', 'Java']);

  const currentResult = await context.fillField(fields.find((field) => field.element === current), matchFor(current));
  assert.equal(currentResult.filled, true);
  assert.equal(current.checked, true);

  const resumeGroup = new TestHTMLElement({
    tagName: 'DIV',
    role: 'group',
    innerText: 'Resume/CV Upload a file (5MB max)',
    textContent: 'Resume/CV Upload a file (5MB max)',
  });
  const resumeHeading = new TestHTMLElement({ tagName: 'H4', textContent: 'Resume/CV', innerText: 'Resume/CV' });
  const resumeWrapper = new TestHTMLElement({ tagName: 'DIV' });
  const resume = new TestInputElement({
    tagName: 'INPUT',
    type: 'file',
    'data-automation-id': 'file-upload-input-ref',
    rect: { width: 0, height: 0 },
  });
  resumeGroup.children.push(resumeHeading, resumeWrapper);
  resumeHeading.parentElement = resumeGroup;
  resumeWrapper.parentElement = resumeGroup;
  resume.parentElement = resumeWrapper;
  const resumeContext = loadAutofillContext({
    hostname: 'example.wd1.myworkdayjobs.com',
    elements: [resume],
  });
  const resumeField = resumeContext.collectFields()[0];
  assert.equal(resumeContext.displayFieldLabel(resumeField.label), 'Resume/CV');
  assert.equal(resumeContext.answerForField(resumeField, profile, {}).action, 'file');
}

async function workdayHierarchicalSourceTest() {
  const sourceControl = new TestHTMLElement({
    tagName: 'DIV',
    textContent: '0 items selected',
    innerText: '0 items selected',
  });
  const source = new TestInputElement({
    id: 'source--source',
    tagName: 'INPUT',
    type: 'text',
    placeholder: 'Search',
  });
  source.parentElement = sourceControl;

  const jobBoard = new TestHTMLElement({
    tagName: 'DIV',
    role: 'option',
    'data-automation-id': 'menuItem',
    textContent: 'Job Board',
    innerText: 'Job Board',
  });
  const other = new TestHTMLElement({
    tagName: 'DIV',
    role: 'option',
    'data-automation-id': 'menuItem',
    textContent: 'Other',
    innerText: 'Other',
  });
  other.click = function clickOtherOption() {
    this.clicked = true;
    sourceControl.textContent = '1 item selected, Other';
    sourceControl.innerText = sourceControl.textContent;
  };

  const context = loadAutofillContext({
    hostname: 'example.wd1.myworkdayjobs.com',
    href: 'https://example.wd1.myworkdayjobs.com/en-US/jobs/job/software-engineer/apply',
    labels: { 'source--source': 'How Did You Hear About Us?' },
    elements: [source],
    options: [jobBoard, other],
  });
  const field = context.collectFields()[0];
  const match = context.answerForField(field, profileFixture(), {});
  const result = await context.fillField(field, match);

  assert.equal(result.filled, true);
  assert.equal(result.value, 'Other');
  assert.equal(jobBoard.clicked, false);
  assert.equal(other.clicked, true);
}

async function workdayWebsiteSourceHierarchyTest() {
  const sourceControl = new TestHTMLElement({
    tagName: 'DIV',
    textContent: '0 items selected',
    innerText: '0 items selected',
  });
  const source = new TestInputElement({
    id: 'source--source',
    tagName: 'INPUT',
    type: 'text',
    placeholder: 'Search',
  });
  source.parentElement = sourceControl;

  const options = [];
  const workdayCom = new TestHTMLElement({
    tagName: 'DIV',
    role: 'option',
    'data-automation-id': 'promptOption',
    textContent: 'Workday.com',
    innerText: 'Workday.com',
  });
  workdayCom.click = function clickWorkdayCom() {
    this.clicked = true;
    sourceControl.textContent = '1 item selected, Workday.com';
    sourceControl.innerText = sourceControl.textContent;
  };
  const instahyre = new TestHTMLElement({
    tagName: 'DIV',
    role: 'option',
    'data-automation-id': 'promptOption',
    textContent: 'Instahyre',
    innerText: 'Instahyre',
  });
  const website = new TestHTMLElement({
    tagName: 'DIV',
    role: 'option',
    'data-automation-id': 'menuItem',
    textContent: 'Website',
    innerText: 'Website',
  });
  website.click = function clickWebsiteCategory() {
    this.clicked = true;
    options.splice(0, options.length, instahyre, workdayCom);
  };
  options.push(website);

  const context = loadAutofillContext({
    hostname: 'workday.wd5.myworkdayjobs.com',
    href: 'https://workday.wd5.myworkdayjobs.com/en-US/Workday/job/software-engineer/apply',
    labels: { 'source--source': 'How Did You Hear About Us?' },
    elements: [source],
    options,
  });
  const field = context.collectFields()[0];
  const result = await context.fillField(field, context.answerForField(field, profileFixture(), {}));

  assert.equal(result.filled, true);
  assert.equal(result.value, 'Workday.com');
  assert.equal(website.clicked, true);
  assert.equal(instahyre.clicked, false);
  assert.equal(workdayCom.clicked, true);
}

async function workdayFlatSourcePriorityTest() {
  const source = new TestHTMLElement({
    id: 'source-button',
    tagName: 'BUTTON',
    type: 'button',
    'aria-haspopup': 'listbox',
    'aria-label': 'How Did You Hear About Us?',
    textContent: 'Select One',
    innerText: 'Select One',
  });

  const careerBuilder = new TestHTMLElement({ tagName: 'DIV', role: 'option', textContent: 'Careerbuilder', innerText: 'Careerbuilder' });
  const corporateWebsite = new TestHTMLElement({ tagName: 'DIV', role: 'option', textContent: 'Corporate WebSite', innerText: 'Corporate WebSite' });
  corporateWebsite.click = function clickCorporateWebsite() {
    this.clicked = true;
    source.textContent = 'Corporate WebSite';
    source.innerText = 'Corporate WebSite';
  };

  const context = loadAutofillContext({
    hostname: 'example.wd1.myworkdayjobs.com',
    href: 'https://example.wd1.myworkdayjobs.com/en-US/jobs/job/software-engineer/apply',
    elements: [source],
    options: [careerBuilder, corporateWebsite],
  });
  const field = context.collectFields()[0];
  const result = await context.fillField(field, context.answerForField(field, profileFixture(), {}));

  assert.equal(result.filled, true);
  assert.equal(result.value, 'Corporate WebSite');
  assert.equal(careerBuilder.clicked, false);
  assert.equal(corporateWebsite.clicked, true);
}

function dropdownOptionInputsExcludedTest() {
  const option = new TestHTMLElement({ tagName: 'DIV', role: 'option', textContent: 'HTML', innerText: 'HTML' });
  const checkbox = new TestInputElement({ tagName: 'INPUT', type: 'checkbox', name: 'skill-option' });
  checkbox.parentElement = option;
  const context = loadAutofillContext({ elements: [checkbox] });
  assert.equal(context.collectFields().length, 0);
}

function genericYesNoDropdownFallbackTest() {
  const context = loadAutofillContext();
  assert.equal(
    context.optionMatches('No', 'No, I have not been employed by a government entity.', 'Have you been employed by any government entity?'),
    true,
  );
  assert.equal(
    context.optionMatches('Yes', 'Yes', 'This is a hybrid role. Are you able to work on site?'),
    true,
  );
}

async function workdayEducationComboboxCommitTest() {
  const schoolControl = new TestHTMLElement({ className: 'workday-control' });
  const school = new TestInputElement({
    id: 'education-15--school',
    tagName: 'INPUT',
    role: 'combobox',
    'data-automation-id': 'searchBox',
    placeholder: 'Search',
  });
  school.parentElement = schoolControl;
  school.dispatchEvent = function dispatchSchoolEvent(event) {
    this.events.push(event.type);
    if (event.type === 'keydown' && event.key === 'Enter') {
      schoolControl.setAttribute('data-value', 'Example Institute of Technology');
    }
    return true;
  };

  const schoolContext = loadAutofillContext({
    hostname: 'example.wd1.myworkdayjobs.com',
    href: 'https://example.wd1.myworkdayjobs.com/en-US/jobs/job/software-engineer/apply',
    labels: { 'education-15--school': 'School or University' },
    elements: [school],
  });
  const schoolField = schoolContext.collectFields()[0];
  const schoolMatch = schoolContext.answerForField(schoolField, profileFixture({
    educationHistory: [{ school: 'Example Institute of Technology' }],
  }), {});
  const schoolResult = await schoolContext.fillField(schoolField, schoolMatch);
  assert.equal(schoolResult.filled, true);
  assert.equal(schoolResult.value, 'Example Institute of Technology');

  const fieldControl = new TestHTMLElement({ className: 'workday-control' });
  const fieldOfStudy = new TestInputElement({
    id: 'education-15--fieldOfStudy',
    tagName: 'INPUT',
    role: 'combobox',
    'data-automation-id': 'searchBox',
    placeholder: 'Search',
  });
  fieldOfStudy.parentElement = fieldControl;
  const all = new TestHTMLElement({
    tagName: 'DIV',
    role: 'option',
    textContent: 'All',
    innerText: 'All',
  });
  const computerScience = new TestHTMLElement({
    tagName: 'DIV',
    role: 'option',
    textContent: 'Computer Science',
    innerText: 'Computer Science',
  });
  const computerScienceChoice = new TestInputElement({ tagName: 'INPUT', type: 'radio' });
  computerScienceChoice.parentElement = computerScience;
  computerScience.children.push(computerScienceChoice);
  computerScienceChoice.click = function clickComputerScienceChoice() {
    this.clicked = true;
    this.checked = true;
    fieldControl.setAttribute('data-value', 'Computer Science');
  };

  const fieldContext = loadAutofillContext({
    hostname: 'example.wd1.myworkdayjobs.com',
    href: 'https://example.wd1.myworkdayjobs.com/en-US/jobs/job/software-engineer/apply',
    labels: { 'education-15--fieldOfStudy': 'Field of Study' },
    elements: [fieldOfStudy],
    options: [all, computerScience],
  });
  const field = fieldContext.collectFields()[0];
  const match = fieldContext.answerForField(field, profileFixture({
    educationHistory: [{ school: 'Example Institute of Technology', field: 'Computer Science' }],
  }), {});
  const result = await fieldContext.fillField(field, match);
  assert.equal(result.filled, true);
  assert.equal(result.value, 'Computer Science');
  assert.equal(all.clicked, true);
  assert.equal(computerScienceChoice.clicked, true);

  const qualifiedControl = new TestHTMLElement({ className: 'workday-control' });
  const qualifiedField = new TestInputElement({
    id: 'education-16--fieldOfStudy',
    tagName: 'INPUT',
    role: 'combobox',
    'data-automation-id': 'searchBox',
    placeholder: 'Search',
  });
  qualifiedField.parentElement = qualifiedControl;
  const bachelorDegree = new TestHTMLElement({
    id: 'education-16--degree',
    tagName: 'BUTTON',
    'aria-label': 'Degree 70-Bachelor Required',
    textContent: '70-Bachelor',
    innerText: '70-Bachelor',
  });
  const qualifiedOptions = ['Associate of Computer Science', 'Bachelor of Computer Science', 'Master of Computer Science']
    .map((text) => {
      const option = new TestHTMLElement({ tagName: 'DIV', role: 'option', textContent: text, innerText: text });
      const choice = new TestInputElement({ tagName: 'INPUT', type: 'radio' });
      choice.parentElement = option;
      option.children.push(choice);
      choice.click = function chooseQualifiedField() {
        this.clicked = true;
        this.checked = true;
        qualifiedControl.setAttribute('data-value', text);
      };
      return { option, choice };
    });
  const qualifiedContext = loadAutofillContext({
    hostname: 'example.wd1.myworkdayjobs.com',
    href: 'https://example.wd1.myworkdayjobs.com/en-US/jobs/job/software-engineer/apply',
    elements: [qualifiedField, bachelorDegree],
    options: qualifiedOptions.map(({ option }) => option),
  });
  const qualifiedResult = await qualifiedContext.commitWorkdayFieldOfStudyCombobox(
    qualifiedField,
    { label: 'Field of Study' },
    'Computer Science',
  );
  assert.equal(qualifiedResult, 'Bachelor of Computer Science');
  assert.equal(qualifiedOptions[0].choice.clicked, false);
  assert.equal(qualifiedOptions[1].choice.clicked, true);
}

async function workdaySkillsCheckboxSelectionTest() {
  const skillsGroup = new TestHTMLElement({ tagName: 'DIV', role: 'group' });
  const skillsControl = new TestHTMLElement({ className: 'workday-control' });
  const skills = new TestInputElement({
    id: 'skills--skills',
    tagName: 'INPUT',
    'data-automation-id': 'searchBox',
    placeholder: 'Search',
  });
  skills.parentElement = skillsControl;
  skillsControl.parentElement = skillsGroup;
  skillsGroup.children.push(skillsControl);

  const makeSkillOption = (text) => {
    const option = new TestHTMLElement({ tagName: 'DIV', role: 'option', textContent: text, innerText: text });
    const checkbox = new TestInputElement({ tagName: 'INPUT', type: 'checkbox' });
    checkbox.parentElement = option;
    option.children.push(checkbox);
    checkbox.click = function selectSkill() {
      this.clicked = true;
      this.checked = true;
      const pill = new TestHTMLElement({
        tagName: 'DIV',
        'data-automation-id': 'selectedItem',
        textContent: text,
        innerText: text,
      });
      pill.parentElement = skillsGroup;
      skillsGroup.children.push(pill);
    };
    return { option, checkbox };
  };
  const html = makeSkillOption('HTML');
  const sqlForJava = makeSkillOption('SQL for Java');
  const sql = makeSkillOption('SQL');

  const context = loadAutofillContext({
    hostname: 'example.wd1.myworkdayjobs.com',
    href: 'https://example.wd1.myworkdayjobs.com/en-US/jobs/job/software-engineer/apply',
    labels: { 'skills--skills': 'Type to Add Skills' },
    elements: [skills],
    options: [sqlForJava.option, html.option, sql.option],
  });
  const field = context.collectFields()[0];
  const match = context.answerForField(field, profileFixture({ skills: ['HTML', 'SQL'] }), {});
  const result = await context.fillField(field, match);

  assert.equal(result.filled, true);
  assert.equal(result.value, 'HTML, SQL');
  assert.equal(html.checkbox.checked, true);
  assert.equal(sql.checkbox.checked, true);
  assert.equal(sqlForJava.checkbox.checked, false);

  const existingSkillsGroup = new TestHTMLElement({ tagName: 'DIV', role: 'group' });
  const existingSkillsControl = new TestHTMLElement({ className: 'workday-control' });
  const existingSkills = new TestInputElement({
    id: 'skills--skills-existing',
    tagName: 'INPUT',
    'data-automation-id': 'searchBox',
    placeholder: 'Search',
  });
  existingSkills.parentElement = existingSkillsControl;
  existingSkillsControl.parentElement = existingSkillsGroup;
  existingSkillsGroup.children.push(existingSkillsControl);
  for (const text of ['Python', 'JavaScript', 'SQL', 'HTML', 'CSS']) {
    const pill = new TestHTMLElement({
      tagName: 'DIV',
      'data-automation-id': 'selectedItem',
      textContent: text,
      innerText: text,
    });
    pill.parentElement = existingSkillsGroup;
    existingSkillsGroup.children.push(pill);
  }
  const existingContext = loadAutofillContext({
    hostname: 'example.wd1.myworkdayjobs.com',
    href: 'https://example.wd1.myworkdayjobs.com/en-US/jobs/job/software-engineer/apply',
    labels: { 'skills--skills-existing': 'Type to Add Skills' },
    elements: [existingSkills],
  });
  const existingField = existingContext.collectFields()[0];
  const existingMatch = existingContext.answerForField(existingField, profileFixture({ skills: ['Python', 'JavaScript'] }), {});
  const existingResult = await existingContext.fillField(existingField, existingMatch);
  assert.equal(existingResult.filled, true);
  assert.equal(existingResult.value, '5 skills already selected');
  assert.equal(existingResult.reason, 'Workday already has enough selected skills');
}

async function workdayRoleDescriptionFocusTest() {
  const description = new TestTextAreaElement({
    id: 'workExperience-6--roleDescription',
    tagName: 'TEXTAREA',
  });
  const context = loadAutofillContext({
    hostname: 'example.wd1.myworkdayjobs.com',
    href: 'https://example.wd1.myworkdayjobs.com/en-US/jobs/job/software-engineer/apply',
    elements: [description],
  });
  const field = context.collectFields()[0];
  const result = await context.fillField(field, { action: 'fill', answer: 'Built and tested backend services.', reason: 'work-history description' });

  assert.equal(result.filled, true);
  assert.equal(description.focused, true);
  assert.equal(description.value, 'Built and tested backend services.');
  assert.equal(description.getAttribute('data-rolematch-filled'), 'true');
}

async function workdayDateSegmentCommitTest() {
  const month = new TestInputElement({
    id: 'workExperience-18--startDate-dateSectionMonth-input',
    tagName: 'INPUT',
    type: 'text',
    'aria-label': 'Month',
  });
  month.value = '12';
  const context = loadAutofillContext({
    hostname: 'example.wd1.myworkdayjobs.com',
    href: 'https://example.wd1.myworkdayjobs.com/en-US/jobs/job/software-engineer/apply',
    elements: [month],
  });
  const field = context.collectFields()[0];
  const result = await context.fillField(field, { action: 'fill', answer: '8', reason: 'test date' });

  assert.equal(result.filled, true);
  assert.equal(month.value, '8');
  assert.equal(month.getAttribute('data-rolematch-filled'), 'true');
  assert.ok(month.events.includes('keydown'));
  assert.ok(month.events.includes('keypress'));
  assert.ok(month.events.includes('input'));
  assert.ok(month.events.includes('keyup'));
  assert.ok(month.events.includes('change'));

  const educationYear = new TestInputElement({
    id: 'education-4--firstYearAttended-dateSectionYear-input',
    tagName: 'INPUT',
    type: 'text',
    'aria-label': 'Year',
  });
  const educationContext = loadAutofillContext({
    hostname: 'example.wd1.myworkdayjobs.com',
    href: 'https://example.wd1.myworkdayjobs.com/en-US/jobs/job/software-engineer/apply',
    elements: [educationYear],
  });
  const educationField = educationContext.collectFields()[0];
  const educationResult = await educationContext.fillField(educationField, { action: 'fill', answer: '2022', reason: 'test education year' });
  assert.equal(educationResult.filled, true);
  assert.equal(educationYear.value, '2022');
  assert.equal(educationYear.getAttribute('data-rolematch-filled'), 'true');
}

function workdaySymbolicSkillMatchingTest() {
  const option = (text) => new TestHTMLElement({ tagName: 'DIV', role: 'option', textContent: text, innerText: text });
  const c = option('C (Programming Language)');
  const cpp = option('C++ Programming Language');
  const csharp = option('C#');
  const context = loadAutofillContext({
    hostname: 'example.wd1.myworkdayjobs.com',
    href: 'https://example.wd1.myworkdayjobs.com/en-US/jobs/job/software-engineer/apply',
  });

  assert.equal(context.workdaySkillOption([c, cpp, csharp], 'C++'), cpp);
  assert.equal(context.workdaySkillOption([c, cpp, csharp], 'C#'), csharp);
  assert.equal(context.workdaySkillOption([c, cpp, csharp], 'C'), c);
}

async function workdayExistingResumeTest() {
  const upload = new TestHTMLElement({
    tagName: 'DIV',
    'data-automation-id': 'attachments-FileUpload',
    innerText: 'Software Engineering Resume.docx 18.26 KB Successfully Uploaded!',
  });
  const wrapper = new TestHTMLElement({ tagName: 'DIV' });
  wrapper.parentElement = upload;
  const input = new TestInputElement({ tagName: 'INPUT', type: 'file', 'data-automation-id': 'file-upload-input-ref' });
  input.parentElement = wrapper;
  const context = loadAutofillContext({
    hostname: 'example.wd1.myworkdayjobs.com',
    href: 'https://example.wd1.myworkdayjobs.com/en-US/jobs/job/software-engineer/apply',
    elements: [input],
  });
  const result = await context.fillFileInput(input, {
    file: {
      fileName: 'Software Engineering Resume.docx',
      fileUrl: '/profile/resume',
    },
  });

  assert.equal(result.filled, true);
  assert.equal(result.reason, 'matching Workday file already uploaded');
  assert.equal(input.files, null);
}

function workdayQuestionLabelTest() {
  const fieldset = new TestHTMLElement({
    tagName: 'FIELDSET',
    innerText: 'Are you 18 years or older?*\n\nSelect One',
  });
  let parent = fieldset;
  for (let depth = 0; depth < 4; depth += 1) {
    const child = new TestHTMLElement({ tagName: 'DIV', innerText: 'Select One' });
    child.parentElement = parent;
    parent = child;
  }
  const button = new TestHTMLElement({
    id: 'primaryQuestionnaire--age-question',
    tagName: 'BUTTON',
    type: 'button',
    'aria-haspopup': 'listbox',
    'aria-label': 'Select One Required',
    innerText: 'Select One',
  });
  button.parentElement = parent;
  const context = loadAutofillContext({
    hostname: 'example.wd1.myworkdayjobs.com',
    href: 'https://example.wd1.myworkdayjobs.com/en-US/jobs/job/software-engineer/apply',
    elements: [button],
  });

  const label = context.getLabelText(button);
  assert.match(label, /Are you 18 years or older/);
  assert.doesNotMatch(label, /^Select One Required/);
  const field = context.collectFields()[0];
  const match = context.answerForField(field, profileFixture({ dateOfBirth: '2003-09-14' }), {});
  assert.equal(match.action, 'fill');
  assert.equal(match.answer, 'Yes');

  const conflictFieldset = new TestHTMLElement({
    tagName: 'FIELDSET',
    innerText: 'The Boeing Company is a government contractor. Applicants must complete this form. 1) Do your current job duties involve Boeing under any of the following conditions? Select One',
  });
  parent = conflictFieldset;
  for (let depth = 0; depth < 4; depth += 1) {
    const child = new TestHTMLElement({ tagName: 'DIV', innerText: 'Select One' });
    child.parentElement = parent;
    parent = child;
  }
  const conflictButton = new TestHTMLElement({
    id: 'primaryQuestionnaire--boeing-conflict',
    tagName: 'BUTTON',
    type: 'button',
    'aria-haspopup': 'listbox',
    'aria-label': 'Select One Required',
    innerText: 'Select One',
  });
  conflictButton.parentElement = parent;
  const conflictContext = loadAutofillContext({
    hostname: 'example.wd1.myworkdayjobs.com',
    href: 'https://example.wd1.myworkdayjobs.com/en-US/jobs/job/software-engineer/apply',
    elements: [conflictButton],
  });
  assert.equal(
    conflictContext.getLabelText(conflictButton).split(' | ')[0],
    '1) Do your current job duties involve Boeing under any of the following conditions?',
  );
}

function workdaySensitiveAndTrapFieldsTest() {
  const languageMenu = new TestHTMLElement({
    tagName: 'BUTTON',
    'aria-haspopup': 'listbox',
    'data-automation-id': 'utilityMenuButton',
    textContent: 'English',
    innerText: 'English',
  });
  const email = new TestInputElement({
    id: 'workday-email',
    tagName: 'INPUT',
    type: 'text',
    'data-automation-id': 'email',
  });
  const password = new TestInputElement({
    id: 'workday-password',
    tagName: 'INPUT',
    type: 'password',
    'data-automation-id': 'password',
  });
  const honeypot = new TestInputElement({
    id: 'workday-beecatcher',
    tagName: 'INPUT',
    type: 'text',
    name: 'website',
    'data-automation-id': 'beecatcher',
    rect: { width: 1, height: 0.01 },
  });

  const context = loadAutofillContext({
    hostname: 'example.wd1.myworkdayjobs.com',
    href: 'https://example.wd1.myworkdayjobs.com/en-US/jobs/job/software-engineer/apply',
    labels: {
      'workday-email': 'Email Address',
      'workday-password': 'Password',
      'workday-beecatcher': "Enter website. This input is for robots only, do not enter if you're human.",
    },
    elements: [languageMenu, email, password, honeypot],
  });

  const fields = context.collectFields();
  assert.equal(fields.length, 2);
  assert.equal(fields.some((field) => field.element === languageMenu), false);
  assert.equal(fields.some((field) => field.element === honeypot), false);

  const passwordField = fields.find((field) => field.element === password);
  const passwordMatch = context.answerForField(passwordField, profileFixture(), {});
  assert.equal(passwordMatch.action, 'skip');
  assert.equal(passwordMatch.reason, 'saved ATS account or browser password manager handles login');
  assert.equal(context.learnableQuestion('Password'), false);
}

async function atsCredentialVaultFieldTest() {
  const username = new TestInputElement({
    id: 'login-email',
    tagName: 'INPUT',
    type: 'email',
    name: 'email',
    autocomplete: 'username',
    'aria-label': 'Email address',
  });
  const password = new TestInputElement({
    id: 'login-password',
    tagName: 'INPUT',
    type: 'password',
    name: 'password',
    autocomplete: 'current-password',
    'aria-label': 'Password',
  });
  const otp = new TestInputElement({
    id: 'one-time-code',
    tagName: 'INPUT',
    type: 'password',
    name: 'otp',
    autocomplete: 'one-time-code',
    'aria-label': 'One-time verification code',
  });
  const context = loadAutofillContext({ elements: [username, password, otp] });
  const credential = {
    origin: 'https://job-boards.greenhouse.io',
    username: 'applicant@example.com',
    password: 'vault-test-password',
  };
  const fields = [
    { element: username, type: 'email', label: 'Email address' },
    { element: password, type: 'password', label: 'Password' },
    { element: otp, type: 'password', label: 'One-time verification code' },
  ];

  assert.equal(context.credentialValueForField(fields[0], credential), credential.username);
  assert.equal(context.credentialValueForField(fields[1], credential), credential.password);
  assert.equal(context.credentialValueForField(fields[2], credential), '', 'one-time codes must never receive the saved password');

  const filled = await context.fillStoredCredentialFields(fields, credential);
  assert.equal(filled, 2);
  assert.equal(username.value, credential.username);
  assert.equal(password.value, credential.password);
  assert.equal(otp.value, '');

  const scan = context.scanFields(profileFixture(), {});
  const scannedPassword = scan.fields.find((field) => field.type === 'password' && /password/i.test(field.label));
  assert.ok(scannedPassword);
  assert.equal(scannedPassword.value, 'Password saved');
  assert.equal(scannedPassword.answer, '');
  assert.equal(JSON.stringify(scan).includes(credential.password), false, 'scan output must not expose saved passwords');
}

function oracleSiblingHoneypotTest() {
  const sharedForm = new TestHTMLElement({
    tagName: 'QUICK-EMAIL-VERIFICATION-FORM',
    textContent: 'Email Address honeypot I agree with the terms and conditions',
    innerText: 'Email Address honeypot I agree with the terms and conditions',
  });
  const email = new TestInputElement({
    id: 'primary-email-0',
    tagName: 'INPUT',
    type: 'email',
    name: 'primary-email',
    'aria-label': 'Email Address',
  });
  const honeypot = new TestInputElement({
    id: 'honey-pot-1',
    tagName: 'INPUT',
    type: 'text',
    name: 'honey-pot',
    'aria-label': 'honeypot',
  });
  email.parentElement = sharedForm;
  honeypot.parentElement = sharedForm;

  const context = loadAutofillContext({
    hostname: 'example.fa.us2.oraclecloud.com',
    href: 'https://example.fa.us2.oraclecloud.com/hcmUI/CandidateExperience/en/sites/CX/job/301843/apply/email',
    elements: [email, honeypot],
  });

  const fields = context.collectFields();
  assert.equal(fields.some((field) => field.element === email), true);
  assert.equal(fields.some((field) => field.element === honeypot), false);
}

async function workdayDropdownButtonTest() {
  const countryButton = new TestHTMLElement({
    tagName: 'BUTTON',
    'aria-haspopup': 'listbox',
    'aria-label': 'Country',
    'data-automation-id': 'country',
    textContent: 'Select One',
    innerText: 'Select One',
  });
  const options = ['Canada', 'United States of America', 'United Kingdom'].map((text) => new TestHTMLElement({
    tagName: 'DIV',
    textContent: text,
    innerText: text,
    'data-automation-id': 'promptOption',
  }));
  options[1].dispatchEvent = function dispatchCountryOption(event) {
    this.events.push(event.type);
    if (event.type === 'click') {
      countryButton.textContent = 'United States of America';
      countryButton.innerText = 'United States of America';
    }
    return true;
  };

  const context = loadAutofillContext({
    hostname: 'example.myworkdayjobs.com',
    href: 'https://example.myworkdayjobs.com/en-US/jobs/job/software-engineer',
    elements: [countryButton],
    options,
  });
  const fields = context.collectFields();
  assert.equal(fields.length, 1);
  assert.equal(fields[0].type, 'combobox');
  assert.equal(fields[0].value, 'Select One');

  const match = context.answerForField(fields[0], profileFixture(), {});
  assert.equal(match.action, 'fill');
  assert.equal(match.answer, 'United States');
  const result = await context.fillField(fields[0], match);
  assert.equal(result.filled, true);
  assert.equal(countryButton.innerText, 'United States of America');
  assert.equal(countryButton.getAttribute('data-rolematch-filled'), 'true');
}

function workdayAddressRegionLabelTest() {
  const stateButton = new TestHTMLElement({
    id: 'address--countryRegion',
    tagName: 'BUTTON',
    'aria-haspopup': 'listbox',
    'aria-label': 'State',
    textContent: 'Select One',
    innerText: 'Select One',
  });
  const context = loadAutofillContext({
    hostname: 'example.myworkdayjobs.com',
    href: 'https://example.myworkdayjobs.com/en-US/jobs/job/software-engineer/apply/applyManually',
    elements: [stateButton],
  });
  const field = context.collectFields()[0];
  assert.match(field.label, /^State\b/);
  const match = context.answerForField(field, profileFixture(), {});
  assert.equal(match.action, 'fill');
  assert.equal(match.answer, 'Massachusetts');
}

function smartRecruitersShadowComboboxValueTest() {
  const selectedHost = new TestHTMLElement({
    tagName: 'SPL-INPUT',
    value: 'Male',
  });
  const input = new TestInputElement({
    tagName: 'INPUT',
    role: 'combobox',
  });
  input.parentElement = selectedHost;

  const optionHost = new TestHTMLElement({
    tagName: 'SPL-SELECT-OPTION',
    textContent: 'Male',
    innerText: 'Male',
  });
  const option = new TestHTMLElement({
    tagName: 'DIV',
    role: 'option',
  });
  option.parentElement = optionHost;

  const context = loadAutofillContext({
    hostname: 'jobs.smartrecruiters.com',
    href: 'https://jobs.smartrecruiters.com/example/software-engineer',
  });
  assert.equal(context.comboboxOptionText(option), 'Male');
  assert.equal(context.selectedComboboxText(input), 'Male');
  assert.equal(context.fieldValue(input), 'Male');
}

function smartRecruitersRaceEthnicityClassificationTest() {
  const race = new TestInputElement({
    id: 'question_00e5e82a-2024-46e1-abc6-60a3f28f9284_ethnicity',
    tagName: 'INPUT',
    role: 'combobox',
    placeholder: 'Race/Ethnicity',
  });
  const context = loadAutofillContext({
    hostname: 'jobs.smartrecruiters.com',
    href: 'https://jobs.smartrecruiters.com/example/software-engineer',
    elements: [race],
  });
  const field = context.collectFields()[0];
  assert.match(field.label, /^Race\b/);
  const match = context.answerForField(field, profileFixture(), {});
  assert.equal(match.action, 'fill');
  assert.equal(match.answer, 'White');
}

async function ukgAndDayforceEntryFlowTest() {
  const ukgElements = [];
  const ukgApply = new TestHTMLElement({
    tagName: 'UKG-BUTTON',
    type: 'button',
    textContent: 'Apply now',
    innerText: 'Apply now',
    'data-automation': 'apply-now-button',
  });
  ukgApply.click = function clickUkgApply() {
    this.clicked = true;
    ukgElements.push(new TestInputElement({ id: 'firstName', tagName: 'INPUT', type: 'text' }));
  };
  ukgElements.push(ukgApply);
  const ukgContext = loadAutofillContext({
    hostname: 'recruiting.ultipro.com',
    href: 'https://recruiting.ultipro.com/ABC100/JobBoard/board/OpportunityDetail?opportunityId=100',
    elements: ukgElements,
  });
  const ukgResult = await ukgContext.openApplicationForm();
  assert.equal(ukgResult.clicked, true);
  assert.equal(ukgApply.clicked, true);

  const dayforceElements = [];
  const apply = new TestHTMLElement({
    tagName: 'BUTTON',
    type: 'button',
    textContent: 'Apply',
    innerText: 'Apply',
    'test-id': 'apply-button',
  });
  const guest = new TestHTMLElement({
    tagName: 'BUTTON',
    type: 'button',
    textContent: 'Apply without an Account',
    innerText: 'Apply without an Account',
    'test-id': 'apply-without-account',
  });
  apply.click = function clickApply() {
    this.clicked = true;
    if (!dayforceElements.includes(guest)) dayforceElements.push(guest);
  };
  guest.click = function clickGuest() {
    this.clicked = true;
    dayforceElements.push(new TestInputElement({
      id: 'jobPostingApplication_candidateInfo_firstName',
      tagName: 'INPUT',
      type: 'text',
    }));
  };
  dayforceElements.push(apply);
  const dayforceContext = loadAutofillContext({
    hostname: 'jobs.dayforcehcm.com',
    href: 'https://jobs.dayforcehcm.com/en-US/example/CANDIDATEPORTAL/jobs/100',
    elements: dayforceElements,
  });
  const dayforceResult = await dayforceContext.openApplicationForm();
  assert.equal(dayforceResult.clicked, true);
  assert.equal(apply.clicked, true);
  assert.equal(guest.clicked, true);
}

function dayforceStructuredFieldTest() {
  const antSelect = new TestHTMLElement({ tagName: 'DIV', className: 'ant-select' });
  const selectedCountry = new TestHTMLElement({
    tagName: 'SPAN',
    className: 'ant-select-selection-item',
    textContent: 'United States',
    innerText: 'United States',
  });
  antSelect.children.push(selectedCountry);
  const workCountry = new TestInputElement({
    id: 'jobPostingApplication_workHistory_0_countryCode',
    tagName: 'INPUT',
    type: 'search',
    role: 'combobox',
    'data-test-opacity': '0',
  });
  workCountry.parentElement = antSelect;
  const elements = [
    new TestInputElement({ id: 'jobPostingApplication_workHistory_0_title', tagName: 'INPUT' }),
    new TestInputElement({ id: 'jobPostingApplication_workHistory_0_companyName', tagName: 'INPUT' }),
    new TestInputElement({ id: 'jobPostingApplication_workHistory_0_isCurrent', tagName: 'INPUT', type: 'checkbox' }),
    new TestInputElement({ id: 'jobPostingApplication_workHistory_0_effectiveStart', tagName: 'INPUT', type: 'month' }),
    new TestInputElement({ id: 'jobPostingApplication_workHistory_0_city', tagName: 'INPUT' }),
    workCountry,
    new TestTextAreaElement({ id: 'jobPostingApplication_workHistory_0_description', tagName: 'TEXTAREA' }),
    new TestInputElement({ id: 'jobPostingApplication_educationHistory_0_degreeName', tagName: 'INPUT' }),
    new TestInputElement({ id: 'jobPostingApplication_educationHistory_0_majorName', tagName: 'INPUT' }),
    new TestInputElement({ id: 'jobPostingApplication_educationHistory_0_schoolName', tagName: 'INPUT' }),
    new TestInputElement({ id: 'jobPostingApplication_educationHistory_0_gpa', tagName: 'INPUT' }),
    new TestInputElement({ id: 'jobPostingApplication_files_resume', tagName: 'INPUT', type: 'file' }),
    new TestInputElement({ id: 'jobPostingApplication_candidateInfo_preferredContactMethod', tagName: 'INPUT', role: 'combobox' }),
    new TestInputElement({ id: 'jobPostingApplication_candidateInfo_confirmEmail', tagName: 'INPUT', type: 'email' }),
  ];
  const context = loadAutofillContext({
    hostname: 'jobs.dayforcehcm.com',
    href: 'https://jobs.dayforcehcm.com/en-US/example/CANDIDATEPORTAL/jobs/100/apply?flowSelection=true',
    elements,
  });
  const profile = profileFixture({
    workHistory: [{
      title: 'Software Engineering Intern',
      company: 'RoleMatch',
      current: true,
      location: 'Boston, Massachusetts, United States',
      startDate: '2025-06-01',
      highlights: ['Built ATS autofill regression tests.', 'Validated application workflows.'],
    }],
    educationHistory: [{
      school: 'Example Institute of Technology',
      degree: 'Bachelor of Science',
      field: 'Computer Science',
      location: 'Boston, Massachusetts, United States',
      startDate: '2022-09-01',
      endDate: '2026-08-01',
      gpa: '3.4',
    }],
  });
  const fields = context.collectFields();
  assert.equal(fields.some((field) => field.element === workCountry), true);
  assert.equal(context.selectedComboboxText(workCountry), 'United States');
  const expected = new Map([
    ['Job title', 'Software Engineering Intern'],
    ['Company', 'RoleMatch'],
    ['I currently work here', 'Yes'],
    ['Work start date', '2025-06'],
    ['Work city', 'Boston'],
    ['Work country', 'United States'],
    ['Role description', 'Built ATS autofill regression tests.\nValidated application workflows.'],
    ['Degree', 'Bachelor of Science'],
    ['Major or field of study', 'Computer Science'],
    ['School or university', 'Example Institute of Technology'],
    ['GPA', '3.4'],
    ['Resume/CV', 'Alex_Morgan_Resume.docx'],
    ['Preferred contact method', 'Email'],
    ['Confirm email', 'alex.morgan@example.com'],
  ]);
  fields.forEach((field) => {
    const display = context.displayFieldLabel(field.label);
    const answer = context.answerForField(field, profile, {});
    const expectedAnswer = expected.get(display);
    if (expectedAnswer) {
      assert.ok(['fill', 'file'].includes(answer.action), `Dayforce ${display} should be fillable`);
      assert.equal(answer.answer, expectedAnswer, `Dayforce ${display}`);
    }
  });
  assert.equal(fields.filter((field) => expected.has(context.displayFieldLabel(field.label))).length, expected.size);

  const sms = context.answerForField({ label: 'SMS Consent: I consent to receive text messages', type: 'radio' }, profile, {});
  assert.equal(sms.action, 'skip');
  assert.equal(sms.reason, 'optional messaging consent is manual');
}

function submissionConfirmationGuardTest() {
  const formContext = loadAutofillContext({
    pageTitle: 'Submit your application',
    pageHeading: 'Application form',
  });
  assert.equal(formContext.submissionConfirmationEvidence(), '');

  const successContext = loadAutofillContext({
    href: 'https://job-boards.greenhouse.io/example/jobs/100/thanks',
    pageTitle: 'Application submitted',
    pageHeading: 'Thank you for applying',
  });
  assert.match(successContext.submissionConfirmationEvidence(), /application submitted|thank you for applying/i);
}

function automaticSubmissionReadinessTest() {
  const context = loadAutofillContext();
  const completed = [{
    label: 'Email',
    type: 'email',
    required: true,
    hasValue: true,
    action: 'fill',
    reason: 'profile email',
  }];
  assert.equal(context.evaluateSubmissionReadiness(completed, [], 1, true).ready, true);

  const missingRequired = [{
    label: 'Application challenge',
    type: 'textarea',
    required: true,
    hasValue: false,
    action: 'skip',
    reason: 'no confident profile match',
  }];
  const missingResult = context.evaluateSubmissionReadiness(missingRequired, [], 1, true);
  assert.equal(missingResult.ready, false);
  assert.match(missingResult.blockers.join(' '), /required field is incomplete/i);
  assert.equal(
    context.readinessBlockerSummary(missingResult.blockers),
    ' Application challenge: required field is incomplete',
  );

  assert.equal(context.evaluateSubmissionReadiness(completed, ['CAPTCHA requires completion'], 1, true).ready, false);
  assert.equal(context.evaluateSubmissionReadiness(completed, [], 0, true).ready, false);
  assert.equal(context.evaluateSubmissionReadiness(completed, [], 2, true).ready, false);
  assert.equal(context.evaluateSubmissionReadiness(completed, [], 1, false).ready, false);

  const invisibleCaptcha = new TestHTMLElement({
    tagName: 'IFRAME',
    src: 'https://www.google.com/recaptcha/api2/anchor?size=invisible',
    title: 'reCAPTCHA',
  });
  const interactiveCaptcha = new TestHTMLElement({
    tagName: 'IFRAME',
    src: 'https://www.google.com/recaptcha/api2/bframe',
    title: 'recaptcha challenge',
  });
  assert.equal(context.isInteractiveCaptchaGate(invisibleCaptcha), false);
  assert.equal(context.isInteractiveCaptchaGate(interactiveCaptcha), true);

  const submit = new TestHTMLElement({ tagName: 'BUTTON', textContent: 'Submit application' });
  const continueButton = new TestHTMLElement({ tagName: 'BUTTON', textContent: 'Continue' });
  const nextButton = new TestHTMLElement({ tagName: 'BUTTON', textContent: 'Next step' });
  const saveAndContinueButton = new TestHTMLElement({ tagName: 'BUTTON', textContent: 'Save and Continue' });
  const socialLoginButton = new TestHTMLElement({ tagName: 'BUTTON', textContent: 'Continue with Google' });
  const applicationLoginButton = new TestHTMLElement({ tagName: 'BUTTON', textContent: 'Continue to application' });
  const nextJobButton = new TestHTMLElement({ tagName: 'BUTTON', textContent: 'Next job' });
  assert.equal(context.looksLikeFinalSubmitControl(submit), true);
  assert.equal(context.looksLikeFinalSubmitControl(continueButton), false);
  assert.equal(context.looksLikeStepAdvanceControl(continueButton), true);
  assert.equal(context.looksLikeStepAdvanceControl(nextButton), true);
  assert.equal(context.looksLikeStepAdvanceControl(saveAndContinueButton), true);
  assert.equal(context.looksLikeStepAdvanceControl(submit), false);
  assert.equal(context.looksLikeStepAdvanceControl(socialLoginButton), false);
  assert.equal(context.looksLikeStepAdvanceControl(applicationLoginButton), false);
  assert.equal(context.looksLikeStepAdvanceControl(nextJobButton), false);

  assert.equal(context.evaluateStepAdvanceReadiness(completed, [], 1, true).ready, true);
  assert.equal(context.evaluateStepAdvanceReadiness(missingRequired, [], 1, true).ready, false);
  assert.equal(context.evaluateStepAdvanceReadiness(completed, ['CAPTCHA requires completion'], 1, true).ready, false);
  assert.equal(context.evaluateStepAdvanceReadiness(completed, [], 0, true).ready, false);
  assert.equal(context.evaluateStepAdvanceReadiness(completed, [], 2, true).ready, false);
  assert.equal(context.evaluateStepAdvanceReadiness(completed, [], 1, false).ready, false);
  assert.equal(context.evaluateStepAdvanceReadiness([], [], 1, true).ready, false);

  const login = new TestHTMLElement({ tagName: 'BUTTON', textContent: 'Sign in' });
  const register = new TestHTMLElement({ tagName: 'BUTTON', textContent: 'Create account' });
  assert.equal(context.looksLikeLoginControl(login), true);
  assert.equal(context.looksLikeLoginControl(register), false);
}

async function automaticStepAdvanceExecutionTest() {
  const disabledNext = new TestHTMLElement({ tagName: 'BUTTON', textContent: 'Continue' });
  const disabledContext = loadAutofillContext({ elements: [disabledNext] });
  assert.equal(await disabledContext.maybeAutoAdvanceApplication('disabled test'), false);
  assert.equal(disabledNext.clicked, false);

  const blockedEmail = new TestInputElement({
    id: 'blocked-email',
    tagName: 'INPUT',
    type: 'email',
    required: true,
  });
  const blockedNext = new TestHTMLElement({ tagName: 'BUTTON', textContent: 'Next' });
  const blockedContext = loadAutofillContext({
    labels: { 'blocked-email': 'Email' },
    elements: [blockedEmail, blockedNext],
  });
  blockedContext.testProfile = profileFixture();
  vm.runInContext(`
    state.settings.autoAdvanceEnabled = true;
    state.profile = testProfile;
    state.job = { jobUrl: 'https://job-boards.greenhouse.io/example/jobs/100', title: 'Software Engineer' };
    state.sessionId = 'blocked-session';
  `, blockedContext);
  assert.equal(await blockedContext.maybeAutoAdvanceApplication('blocked test'), false);
  assert.equal(blockedNext.clicked, false);

  const completedEmail = new TestInputElement({
    id: 'completed-email',
    tagName: 'INPUT',
    type: 'email',
    required: true,
  });
  completedEmail.value = 'alex.morgan@example.com';
  const advancingNext = new TestHTMLElement({ tagName: 'BUTTON', textContent: 'Save and Continue' });
  const nextStepSubmit = new TestHTMLElement({ tagName: 'BUTTON', textContent: 'Submit application' });
  const advancingElements = [completedEmail, advancingNext];
  advancingNext.click = function clickAndRenderNextStep() {
    TestHTMLElement.prototype.click.call(this);
    advancingElements.splice(0, advancingElements.length, nextStepSubmit);
  };
  const advancingContext = loadAutofillContext({
    labels: { 'completed-email': 'Email' },
    elements: advancingElements,
  });
  advancingContext.testProfile = profileFixture();
  vm.runInContext(`
    state.settings.autoAdvanceEnabled = true;
    state.profile = testProfile;
    state.job = { jobUrl: 'https://job-boards.greenhouse.io/example/jobs/100', title: 'Software Engineer' };
    state.sessionId = 'advance-session';
  `, advancingContext);
  assert.equal(await advancingContext.maybeAutoAdvanceApplication('enabled test'), true);
  assert.equal(advancingNext.clicked, true);
  assert.equal(nextStepSubmit.clicked, false, 'auto-advance must not imply automatic final submission');

  const guardedEmail = new TestInputElement({
    id: 'guarded-email',
    tagName: 'INPUT',
    type: 'email',
    required: true,
  });
  guardedEmail.value = 'alex.morgan@example.com';
  const guardedNext = new TestHTMLElement({ tagName: 'BUTTON', textContent: 'Next' });
  const guardedSubmit = new TestHTMLElement({ tagName: 'BUTTON', textContent: 'Submit application' });
  const guardedContext = loadAutofillContext({
    labels: { 'guarded-email': 'Email' },
    elements: [guardedEmail, guardedNext, guardedSubmit],
  });
  guardedContext.testProfile = profileFixture();
  vm.runInContext(`
    state.profile = testProfile;
    state.job = { jobUrl: 'https://job-boards.greenhouse.io/example/jobs/100', title: 'Software Engineer' };
    state.sessionId = 'guarded-session';
  `, guardedContext);
  const guardedReadiness = guardedContext.currentSubmissionReadiness();
  assert.equal(guardedReadiness.ready, false);
  assert.match(guardedReadiness.blockers.join(' '), /next application step/i);
}

function greenhouseEducationDateIsolationTest() {
  const startMonth = new TestInputElement({ id: 'start-month--0', tagName: 'INPUT', role: 'combobox' });
  const startYear = new TestInputElement({ id: 'start-year--0', tagName: 'INPUT', type: 'number', 'aria-label': 'Start date year' });
  const endMonth = new TestInputElement({ id: 'end-month--0', tagName: 'INPUT', role: 'combobox' });
  const endYear = new TestInputElement({ id: 'end-year--0', tagName: 'INPUT', type: 'number', 'aria-label': 'End date year' });
  const context = loadAutofillContext({ elements: [startMonth, startYear, endMonth, endYear] });
  const profile = profileFixture({
    educationHistory: [{
      school: 'Example Institute of Technology',
      degree: 'Bachelor of Science',
      field: 'Computer Science',
      startDate: '2022-09-01',
      endDate: '2026-08-01',
    }],
    autofillAnswers: {
      ...profileFixture().autofillAnswers,
      earliestStartDate: 'After August 2026 graduation',
    },
  });
  const answers = context.collectFields().map((field) => context.answerForField(field, profile, {}));
  assert.equal(JSON.stringify(Array.from(answers, (answer) => answer.answer)), JSON.stringify(['September', '2022', 'August', '2026']));

  const noDates = profileFixture({
    autofillAnswers: {
      ...profileFixture().autofillAnswers,
      earliestStartDate: 'After August 2026 graduation',
    },
  });
  const noDateAnswer = context.answerForField(context.collectFields()[0], noDates, {});
  assert.equal(noDateAnswer.action, 'skip');
  assert.notEqual(noDateAnswer.answer, 'After August 2026 graduation');
}

function ashbyFieldEntryLabelIsolationTest() {
  const location = new TestInputElement({
    tagName: 'INPUT',
    role: 'combobox',
    placeholder: 'Start typing...',
  });
  const inputContainer = new TestHTMLElement({ tagName: 'DIV', className: '_inputContainer_test' });
  const fieldEntry = new TestHTMLElement({
    tagName: 'DIV',
    className: '_fieldEntry_test ashby-application-form-field-entry',
    textContent: 'Location',
    innerText: 'Location',
  });
  const formSection = new TestHTMLElement({
    tagName: 'DIV',
    className: 'ashby-application-form-section-container',
    textContent: 'Name Email LinkedIn URL Resume Location Are you willing to relocate? Yes No Why N1?',
    innerText: 'Name Email LinkedIn URL Resume Location Are you willing to relocate? Yes No Why N1?',
  });

  location.parentElement = inputContainer;
  inputContainer.parentElement = fieldEntry;
  fieldEntry.parentElement = formSection;
  const context = loadAutofillContext({
    hostname: 'jobs.ashbyhq.com',
    href: 'https://jobs.ashbyhq.com/example/role/application',
    elements: [location],
  });

  const field = context.collectFields()[0];
  assert.equal(context.displayFieldLabel(field.label), 'Location');
  assert.doesNotMatch(field.label, /Email|LinkedIn|Why N1/i);
  const match = context.answerForField(field, profileFixture(), {});
  assert.equal(match.action, 'fill');
  assert.equal(match.answer, 'Boston, Massachusetts, United States');
}

async function greenhouseEducationDropdownVerificationTest() {
  const incorrectSchool = new TestHTMLElement({
    tagName: 'DIV',
    role: 'option',
    textContent: 'University of 2025',
    innerText: 'University of 2025',
  });
  const school = new TestInputElement({
    id: 'school--0',
    tagName: 'INPUT',
    type: 'text',
    role: 'combobox',
  });
  const context = loadAutofillContext({
    labels: { 'school--0': 'School' },
    elements: [school],
    options: [incorrectSchool],
  });

  const field = context.collectFields()[0];
  const match = context.answerForField(field, profileFixture(), {});
  const result = await context.fillField(field, match);
  assert.equal(result.filled, false);
  assert.equal(result.reason, 'dropdown selection did not match profile answer');
  assert.equal(school.value, '');
  assert.equal(incorrectSchool.clicked, false);
}

answerMatrixTest();
customAnswerIntentLibraryTest();
const requestedMatrix = requestedAtsRegressionMatrixTest();
await pauseResumeAutofillTest();
await failedPausePersistenceTest();
currentCompanyFallbackTest();
federalOptionMatchingTest();
leverCustomQuestionInferenceTest();
selectedComboboxFallbackTextTest();
noisyLabelTest();
extensionPanelFieldsExcludedTest();
await fillControlsTest();
await fillFileTest();
await conditionalFieldRescanTest();
await leverRadioAndSelectTest();
await leverSurveyAndCheckboxTest();
leverSelectInferenceTest();
leverMasterResumeAndRaceIdentityTest();
leverStandardFieldInferenceTest();
repeatFillOverwritePolicyTest();
atsDetectionTest();
backgroundAtsDetectionTest();
await backgroundApplicationSessionTest();
oracleJetLabelAndTypeTest();
legacyAtsQuestionLabelTest();
taleoLoginAndLanguageTest();
await icimsPrivacyAcknowledgementTest();
workableStructuredEntryTest();
await workableCustomRadioTest();
await workableAriaLabelledRadioTest();
workableHiddenAddressMetadataTest();
applicationSurfaceGuardTest();
customCheckboxAndAddressTest();
await workableConservativeQuestionMappingTest();
postedSalaryAndAdultVerificationOverrideTest();
ashbyStandardFieldInferenceTest();
ashbyPageContextAndSensitiveFieldTest();
directAtsPageContextTest();
await ashbyResumeParserPrecedenceTest();
await ashbyYesNoCheckboxTest();
await ashbyCheckboxGroupPresentationTest();
ashbyCountryAndChoiceMappingTest();
await ashbyRadioChoiceTest();
ashbyFieldEntryLabelIsolationTest();
workdayFieldClassificationTest();
await workdayExperienceFieldMappingTest();
await workdayHierarchicalSourceTest();
await workdayWebsiteSourceHierarchyTest();
await workdayFlatSourcePriorityTest();
dropdownOptionInputsExcludedTest();
genericYesNoDropdownFallbackTest();
await workdayEducationComboboxCommitTest();
await workdaySkillsCheckboxSelectionTest();
await workdayRoleDescriptionFocusTest();
await workdayDateSegmentCommitTest();
workdaySymbolicSkillMatchingTest();
await workdayExistingResumeTest();
workdayQuestionLabelTest();
workdaySensitiveAndTrapFieldsTest();
await atsCredentialVaultFieldTest();
oracleSiblingHoneypotTest();
await workdayDropdownButtonTest();
workdayAddressRegionLabelTest();
smartRecruitersShadowComboboxValueTest();
smartRecruitersRaceEthnicityClassificationTest();
await ukgAndDayforceEntryFlowTest();
dayforceStructuredFieldTest();
submissionConfirmationGuardTest();
automaticSubmissionReadinessTest();
await automaticStepAdvanceExecutionTest();
greenhouseEducationDateIsolationTest();
await greenhouseEducationDropdownVerificationTest();

console.log(`Requested ATS regression matrix passed: ${requestedMatrix.adapters} adapters x ${requestedMatrix.scenariosPerAdapter} scenarios = ${requestedMatrix.adapters * requestedMatrix.scenariosPerAdapter} cases.`);
console.log('RoleMatch autofill harness passed.');
