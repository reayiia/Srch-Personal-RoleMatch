import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const trackedFiles = execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard', '-z'], {
  cwd: root,
  encoding: 'utf8',
}).split('\0').filter(Boolean);

const findings = [];
const secretPatterns = [
  ['private key', /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/],
  ['OpenAI API key', /\bsk-[A-Za-z0-9_-]{16,}\b/],
  ['GitHub token', /\bgh[pousr]_[A-Za-z0-9]{20,}\b/],
  ['Google API key', /\bAIza[0-9A-Za-z_-]{30,}\b/],
  ['AWS access key', /\bAKIA[0-9A-Z]{16}\b/],
];

for (const relativePath of trackedFiles) {
  const normalizedPath = relativePath.replaceAll('\\', '/');
  const fileName = normalizedPath.split('/').at(-1) ?? '';

  if (normalizedPath.startsWith('apps/backend/uploads/')) {
    findings.push(`${normalizedPath}: uploaded user document is tracked`);
    continue;
  }

  if (fileName.startsWith('.env') && fileName !== '.env.example') {
    findings.push(`${normalizedPath}: local environment file is tracked`);
    continue;
  }

  const buffer = readFileSync(resolve(root, relativePath));
  if (buffer.includes(0)) continue;
  const text = buffer.toString('utf8');

  for (const [label, pattern] of secretPatterns) {
    if (pattern.test(text)) findings.push(`${normalizedPath}: possible ${label}`);
  }

  if (/@(?:icloud|wit)\.edu\b|@icloud\.com\b/i.test(text)) {
    findings.push(`${normalizedPath}: personal-use email domain found`);
  }

  const phoneNumbers = text.match(/(?:\+?1[\s.-]*)?\(?\d{3}\)?[\s.-]\d{3}[\s.-]\d{4}/g) ?? [];
  if (phoneNumbers.some((phone) => !phone.includes('555'))) {
    findings.push(`${normalizedPath}: non-fictional phone number found`);
  }
}

if (findings.length > 0) {
  console.error('Public-safety check failed:');
  findings.forEach((finding) => console.error(`- ${finding}`));
  process.exit(1);
}

console.log(`Public-safety check passed for ${trackedFiles.length} repository files.`);
