import assert from 'node:assert/strict';
import {
  cleanCredentialLabel,
  cleanCredentialPassword,
  cleanCredentialProvider,
  cleanCredentialUsername,
  inferCredentialProvider,
  normalizeCredentialOrigin,
} from '../src/security/atsCredentials.js';
import { decryptSecret, encryptSecret, isEncryptedSecret } from '../src/security/secrets.js';

const value = 'oauth-token-test-value';
const encrypted = encryptSecret(value);
assert.ok(encrypted);
assert.notEqual(encrypted, value);
assert.equal(isEncryptedSecret(encrypted), true);
assert.equal(decryptSecret(encrypted), value);
assert.equal(decryptSecret(value), value, 'legacy plaintext tokens remain readable during migration');
assert.equal(encryptSecret(null), null);
assert.equal(decryptSecret(null), null);

assert.equal(normalizeCredentialOrigin('acme.wd5.myworkdayjobs.com/en-US/jobs'), 'https://acme.wd5.myworkdayjobs.com');
assert.equal(inferCredentialProvider('https://acme.wd5.myworkdayjobs.com/login'), 'Workday');
assert.equal(cleanCredentialProvider('', 'https://jobs.lever.co'), 'Lever');
assert.equal(cleanCredentialLabel('', 'Workday'), 'Workday account');
assert.equal(cleanCredentialUsername(' applicant@example.com '), 'applicant@example.com');
assert.equal(cleanCredentialPassword('test-password'), 'test-password');
assert.throws(() => normalizeCredentialOrigin('http://example.com/login'), /must use HTTPS/);
assert.throws(() => normalizeCredentialOrigin('https://user:password@example.com/login'), /Do not include credentials/);

console.log('Secret encryption harness passed.');
