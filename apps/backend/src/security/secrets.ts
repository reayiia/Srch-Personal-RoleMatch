import crypto from 'node:crypto';
import { getEncryptionKey } from '../config.js';

const ENCRYPTED_PREFIX = 'enc:v1:';

export function encryptSecret(value: string | null | undefined) {
  if (!value) return null;
  if (value.startsWith(ENCRYPTED_PREFIX)) return value;

  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', getEncryptionKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();

  return [
    ENCRYPTED_PREFIX.slice(0, -1),
    iv.toString('base64url'),
    tag.toString('base64url'),
    ciphertext.toString('base64url'),
  ].join(':');
}

export function decryptSecret(value: string | null | undefined) {
  if (!value) return null;

  // Existing local databases may contain pre-encryption OAuth tokens. Reading
  // them keeps upgrades usable; the next OAuth connection rewrites them safely.
  if (!value.startsWith(ENCRYPTED_PREFIX)) return value;

  const parts = value.split(':');
  if (parts.length !== 5) {
    throw new Error('Stored integration secret is malformed. Reconnect the provider.');
  }

  const iv = Buffer.from(parts[2]!, 'base64url');
  const tag = Buffer.from(parts[3]!, 'base64url');
  const ciphertext = Buffer.from(parts[4]!, 'base64url');
  const decipher = crypto.createDecipheriv('aes-256-gcm', getEncryptionKey(), iv);
  decipher.setAuthTag(tag);

  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
}

export function isEncryptedSecret(value: string | null | undefined) {
  return Boolean(value?.startsWith(ENCRYPTED_PREFIX));
}
