import type { ApplicationStatus } from '../applications/applicationService.js';

export interface EmailScanJob {
  company: string;
  title: string;
  jobUrl: string;
}

export interface ScannedEmail {
  id?: string | null;
  snippet?: string | null;
  subject: string;
  from: string;
  date: string;
  bodyHtml: string;
  matchScore: number;
  statusSignal: ApplicationStatus | null;
  statusReason: string | null;
}

export interface StatusInference {
  nextStatus: ApplicationStatus | null;
  reason: string | null;
  sourceEmailId: string | null;
}

export const PRESENTATION_EMAIL_TEST_JOB = {
  company: 'RoleMatch Email Test Company',
  title: 'Software Engineer Presentation Test',
  jobUrl: 'https://jobs.lever.co/rolematch-email-test/role-confirmation-demo',
} as const;

const terminalStatuses = new Set<ApplicationStatus>(['offer']);
const statusRank: Record<ApplicationStatus, number> = {
  blocked: 0,
  in_progress: 1,
  submitted: 2,
  interview: 3,
  rejected: 4,
  offer: 5,
};

function normalize(value: string) {
  return value
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function escapeGmailQuoted(value: string) {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"').trim();
}

function stripCompanySuffixes(company: string) {
  return company
    .replace(/\b(incorporated|inc|llc|l\.l\.c|ltd|limited|corp|corporation|company|co)\b\.?/gi, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function importantTitleTerms(title: string) {
  return normalize(title)
    .split(' ')
    .filter((term) => term.length >= 4)
    .filter((term) => !['engineer', 'software', 'developer', 'manager', 'senior', 'staff', 'lead', 'role'].includes(term))
    .slice(0, 4);
}

function companyDomainHint(jobUrl: string) {
  try {
    const hostname = new URL(jobUrl).hostname.toLowerCase().replace(/^www\./, '');
    const parts = hostname.split('.');
    if (parts.includes('greenhouse') || parts.includes('lever') || parts.includes('workable')) return '';
    return parts.length > 2 ? parts.slice(-2).join('.') : hostname;
  } catch {
    return '';
  }
}

function quotedOrGroup(values: string[]) {
  const terms = values
    .map((value) => value.trim())
    .filter((value, index, list) => value.length >= 3 && list.indexOf(value) === index)
    .map((value) => `"${escapeGmailQuoted(value)}"`);

  if (terms.length === 0) return '';
  return terms.length === 1 ? terms[0] : `(${terms.join(' OR ')})`;
}

export function buildGmailApplicationQuery(job: EmailScanJob) {
  const company = job.company.trim();
  const companyCore = stripCompanySuffixes(company);
  const title = job.title.trim();
  const titleTerms = importantTitleTerms(title);
  const domain = companyDomainHint(job.jobUrl);

  const companyGroup = quotedOrGroup([company, companyCore]);
  const contextTerms = new Set<string>([
    'application',
    'applied',
    'candidate',
    'careers',
    'recruit',
    'interview',
    'offer',
  ]);
  if (title.length >= 3) contextTerms.add(`"${escapeGmailQuoted(title)}"`);
  titleTerms.forEach((term) => contextTerms.add(term));

  const queryParts = ['newer_than:18m'];
  if (companyGroup) queryParts.push(companyGroup);
  if (domain) queryParts.push(`from:${domain}`);
  queryParts.push(`(${Array.from(contextTerms).join(' OR ')})`);

  return queryParts.join(' ');
}

function plainTextFromHtml(html: string) {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim();
}

export function scoreEmailAgainstApplication(email: Pick<ScannedEmail, 'subject' | 'from' | 'snippet' | 'bodyHtml'>, job: EmailScanJob) {
  const searchable = normalize([
    email.subject,
    email.from,
    email.snippet ?? '',
    plainTextFromHtml(email.bodyHtml).slice(0, 4000),
  ].join(' '));
  const company = normalize(job.company);
  const companyCore = normalize(stripCompanySuffixes(job.company));
  const title = normalize(job.title);
  const titleTerms = importantTitleTerms(job.title);

  let score = 0;
  if (company && searchable.includes(company)) score += 60;
  if (companyCore && companyCore !== company && searchable.includes(companyCore)) score += 45;
  if (title && searchable.includes(title)) score += 25;
  score += titleTerms.filter((term) => searchable.includes(term)).length * 8;

  const domain = companyDomainHint(job.jobUrl);
  if (domain && normalize(email.from).includes(normalize(domain))) score += 20;
  if (/application|applied|candidate|careers|recruit|talent|interview|offer/.test(searchable)) score += 10;

  const hasCompanyEvidence = Boolean(
    (company && searchable.includes(company))
    || (companyCore && searchable.includes(companyCore))
    || (domain && normalize(email.from).includes(normalize(domain)))
  );

  return hasCompanyEvidence ? Math.min(score, 100) : Math.min(score, 30);
}

export function classifyEmailStatus(email: Pick<ScannedEmail, 'subject' | 'snippet' | 'bodyHtml'>): Pick<ScannedEmail, 'statusSignal' | 'statusReason'> {
  const text = normalize([
    email.subject,
    email.snippet ?? '',
    plainTextFromHtml(email.bodyHtml).slice(0, 5000),
  ].join(' '));

  if (/\boffer of employment\b|extend an offer|employment offer|offer letter|congratulations[^.]{0,120}\boffer\b/.test(text)) {
    return { statusSignal: 'offer', statusReason: 'offer language found' };
  }

  if (
    /schedule.{0,60}interview|interview.{0,60}schedule|next round|next step.{0,80}interview|technical screen|phone screen|recruiter screen|availability.{0,80}(interview|call)|calendly|meet with.{0,80}(team|hiring|manager)|coding assessment|technical assessment|take home|take-home|hackerrank|codility/.test(text)
  ) {
    return { statusSignal: 'interview', statusReason: 'interview scheduling language found' };
  }

  const hasConfirmationSignal = /thank you for applying|thanks for applying|application received|received your application|application has been received|application submitted|your application was submitted|we have your application|we received your application/.test(text);
  const hasRejectionSignal = /unfortunately|not moving forward|not move forward|unable to move forward|will not be moving forward|decided to pursue other candidates|pursue candidates whose|not proceed|will not proceed|no longer under consideration|position has been filled|regret to inform|we will not continue|we won'?t continue|we are unable to offer|we cannot offer/.test(text)
    || /\b(your application|your candidacy)\s+(were|was|are|is|have been|has been)\s+not\s+(selected|chosen)/.test(text)
    || /\b(you|your application|your candidacy)\s+(were|was|are|is|have been|has been)\s+rejected\b/.test(text);

  if (hasRejectionSignal) {
    return { statusSignal: 'rejected', statusReason: 'rejection language found' };
  }

  if (hasConfirmationSignal) {
    return { statusSignal: 'submitted', statusReason: 'application confirmation language found' };
  }

  return { statusSignal: null, statusReason: null };
}

export function buildPresentationEmailFixture(job: EmailScanJob, now = new Date()): ScannedEmail | null {
  if (
    job.company !== PRESENTATION_EMAIL_TEST_JOB.company
    || job.title !== PRESENTATION_EMAIL_TEST_JOB.title
    || job.jobUrl !== PRESENTATION_EMAIL_TEST_JOB.jobUrl
  ) {
    return null;
  }

  const email = {
    id: 'rolematch-presentation-test-confirmation',
    subject: `Application received - ${PRESENTATION_EMAIL_TEST_JOB.title} | ${PRESENTATION_EMAIL_TEST_JOB.company}`,
    from: 'RoleMatch Demo Recruiting <recruiting@rolematch.test>',
    date: now.toUTCString(),
    snippet: `Thank you for applying to ${PRESENTATION_EMAIL_TEST_JOB.company}. We received your application for the ${PRESENTATION_EMAIL_TEST_JOB.title} position.`,
    bodyHtml: [
      '<div style="font-family:Arial,sans-serif;line-height:1.6;color:#172033;max-width:640px;padding:24px">',
      '<h2 style="margin:0 0 16px">Application received</h2>',
      '<p>Hello Alex,</p>',
      `<p>Thank you for applying to <strong>${PRESENTATION_EMAIL_TEST_JOB.company}</strong> for the <strong>${PRESENTATION_EMAIL_TEST_JOB.title}</strong> position. We received your application and it is now under review.</p>`,
      '<p style="color:#5f6b7a">This is presentation-only test data and does not represent a real job application.</p>',
      '<p>Best,<br>RoleMatch Demo Recruiting</p>',
      '</div>',
    ].join(''),
  };

  return {
    ...email,
    matchScore: scoreEmailAgainstApplication(email, job),
    ...classifyEmailStatus(email),
  };
}

function parsedDate(email: Pick<ScannedEmail, 'date'>) {
  const value = Date.parse(email.date || '');
  return Number.isNaN(value) ? 0 : value;
}

function isAllowedTransition(currentStatus: ApplicationStatus, nextStatus: ApplicationStatus) {
  if (currentStatus === nextStatus) return false;
  if (terminalStatuses.has(currentStatus)) return false;
  if (nextStatus === 'submitted' && !['in_progress', 'blocked'].includes(currentStatus)) return false;
  if (currentStatus === 'rejected' && nextStatus !== 'offer') return false;
  return statusRank[nextStatus] >= statusRank[currentStatus] || nextStatus === 'rejected';
}

export function inferStatusFromEmails(currentStatus: ApplicationStatus, emails: ScannedEmail[]): StatusInference {
  const candidates = emails
    .filter((email) => email.matchScore >= 45 && email.statusSignal)
    .sort((left, right) => {
      const rankDiff = statusRank[right.statusSignal as ApplicationStatus] - statusRank[left.statusSignal as ApplicationStatus];
      if (rankDiff !== 0 && (left.statusSignal === 'offer' || right.statusSignal === 'offer')) return rankDiff;
      return parsedDate(right) - parsedDate(left);
    });

  for (const email of candidates) {
    const nextStatus = email.statusSignal;
    if (nextStatus && isAllowedTransition(currentStatus, nextStatus)) {
      return {
        nextStatus,
        reason: email.statusReason,
        sourceEmailId: email.id ?? null,
      };
    }
  }

  return { nextStatus: null, reason: null, sourceEmailId: null };
}
