import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const envPath = path.join(packageRoot, '.env');
const examplePath = path.join(packageRoot, '.env.example');

if (!fs.existsSync(envPath)) {
  fs.copyFileSync(examplePath, envPath);
}

let contents = fs.readFileSync(envPath, 'utf8');

function hasConfiguredValue(name: string) {
  const match = contents.match(new RegExp(`^${name}=(.*)$`, 'm'));
  return Boolean(match?.[1]?.trim());
}

function setValue(name: string, value: string) {
  const line = `${name}=${value}`;
  const pattern = new RegExp(`^${name}=.*$`, 'm');
  contents = pattern.test(contents)
    ? contents.replace(pattern, line)
    : `${contents.trimEnd()}\n${line}\n`;
}

const generated: string[] = [];
if (!hasConfiguredValue('JWT_SECRET')) {
  setValue('JWT_SECRET', crypto.randomBytes(48).toString('base64url'));
  generated.push('JWT_SECRET');
}
if (!hasConfiguredValue('APP_ENCRYPTION_KEY')) {
  setValue('APP_ENCRYPTION_KEY', crypto.randomBytes(32).toString('base64'));
  generated.push('APP_ENCRYPTION_KEY');
}

fs.writeFileSync(envPath, contents, { encoding: 'utf8', mode: 0o600 });

if (generated.length > 0) {
  console.log(`Configured ${generated.join(' and ')} in apps/backend/.env.`);
} else {
  console.log('Backend security secrets are already configured.');
}
console.log('Secret values were not printed. Keep apps/backend/.env out of Git.');
