import assert from 'node:assert/strict';
import {
  buildPresentationEmailFixture,
  buildGmailApplicationQuery,
  classifyEmailStatus,
  inferStatusFromEmails,
  PRESENTATION_EMAIL_TEST_JOB,
  scoreEmailAgainstApplication,
  type ScannedEmail,
} from '../src/email/emailScan.js';
import {
  GMAIL_PERMISSION_MESSAGE,
  GMAIL_RECONNECT_MESSAGE,
  isExpiredGoogleAuthorization,
  isMissingGmailReadPermission,
} from '../src/email/googleAuthError.js';

const leverJob = {
  company: 'AIFund',
  title: 'AI Engineer',
  jobUrl: 'https://jobs.lever.co/AIFund/273af06c-9114-4b9c-83c9-a3627f4b875f',
};

const greenhouseJob = {
  company: 'Remesh',
  title: 'Software Engineer',
  jobUrl: 'https://job-boards.greenhouse.io/remesh/jobs/8450776002',
};

const leverQuery = buildGmailApplicationQuery(leverJob);
assert.match(leverQuery, /newer_than:18m/);
assert.match(leverQuery, /"AIFund"/);
assert.match(leverQuery, /"AI Engineer"/);

const greenhouseQuery = buildGmailApplicationQuery(greenhouseJob);
assert.match(greenhouseQuery, /"Remesh"/);
assert.match(greenhouseQuery, /"Software Engineer"/);

const rejection = {
  subject: 'Update on your Remesh application',
  snippet: 'Unfortunately, we will not be moving forward.',
  bodyHtml: '',
};
assert.equal(classifyEmailStatus(rejection).statusSignal, 'rejected');

const interview = {
  subject: 'Schedule your technical screen',
  snippet: 'Please share availability for an interview with the hiring team.',
  bodyHtml: '',
};
assert.equal(classifyEmailStatus(interview).statusSignal, 'interview');

const assessment = {
  subject: 'Next step: coding assessment',
  snippet: 'Please complete this technical assessment for the Software Engineer role.',
  bodyHtml: '',
};
assert.equal(classifyEmailStatus(assessment).statusSignal, 'interview');

const confirmation = {
  subject: 'Application received',
  snippet: 'Thank you for applying. We received your application.',
  bodyHtml: '',
};
assert.equal(classifyEmailStatus(confirmation).statusSignal, 'submitted');

const confirmationWithBoilerplate = {
  subject: 'Thank you for your application to Supermove',
  snippet: 'We received your application for Software Engineer.',
  bodyHtml: 'If you are not selected for this position, keep an eye on our jobs page.',
};
assert.equal(classifyEmailStatus(confirmationWithBoilerplate).statusSignal, 'submitted');

const strongMatch: ScannedEmail = {
  id: 'message-1',
  subject: 'Remesh Software Engineer interview',
  from: 'careers@remesh.com',
  date: new Date().toUTCString(),
  snippet: 'Schedule your interview for the Software Engineer role.',
  bodyHtml: '',
  matchScore: 0,
  statusSignal: 'interview',
  statusReason: 'interview scheduling language found',
};
strongMatch.matchScore = scoreEmailAgainstApplication(strongMatch, greenhouseJob);
assert.ok(strongMatch.matchScore >= 35);
assert.equal(inferStatusFromEmails('submitted', [strongMatch]).nextStatus, 'interview');

const weakMatch: ScannedEmail = {
  ...strongMatch,
  id: 'message-2',
  subject: 'Generic newsletter',
  from: 'news@example.com',
  snippet: 'A weekly roundup unrelated to this job.',
  statusSignal: 'interview',
  statusReason: 'interview scheduling language found',
};
weakMatch.matchScore = scoreEmailAgainstApplication(weakMatch, greenhouseJob);
assert.equal(inferStatusFromEmails('submitted', [weakMatch]).nextStatus, null);

const presentationEmail = buildPresentationEmailFixture(
  PRESENTATION_EMAIL_TEST_JOB,
  new Date('2026-07-27T12:00:00Z'),
);
assert.ok(presentationEmail);
assert.equal(presentationEmail.statusSignal, 'submitted');
assert.equal(presentationEmail.matchScore, 100);
assert.equal(buildPresentationEmailFixture(greenhouseJob), null);

assert.equal(isExpiredGoogleAuthorization({
  response: {
    data: {
      error: 'invalid_grant',
      error_description: 'Token has been expired or revoked.',
    },
  },
}), true);
assert.equal(isExpiredGoogleAuthorization(new Error('Temporary network failure')), false);
assert.match(GMAIL_RECONNECT_MESSAGE, /Reconnect Gmail from Profile/);
assert.equal(isMissingGmailReadPermission({
  response: {
    data: {
      error: {
        code: 403,
        message: 'Request had insufficient authentication scopes.',
        status: 'PERMISSION_DENIED',
      },
    },
  },
}), true);
assert.equal(isMissingGmailReadPermission(new Error('Temporary network failure')), false);
assert.match(GMAIL_PERMISSION_MESSAGE, /approve the requested Gmail read access/);

console.log('Email scan harness passed.');
