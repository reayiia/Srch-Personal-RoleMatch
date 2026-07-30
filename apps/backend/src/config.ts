import dotenv from 'dotenv';

dotenv.config();

function normalizeBaseUrl(value: string | undefined, fallback: string) {
  return (value?.trim() || fallback).replace(/\/$/, '');
}

function requireSecret(name: string, minimumLength = 32) {
  const value = process.env[name]?.trim();
  if (!value || value.length < minimumLength) {
    throw new Error(`${name} must be configured with at least ${minimumLength} characters.`);
  }
  return value;
}

export const runtimeConfig = {
  nodeEnv: process.env.NODE_ENV?.trim() || 'development',
  port: Number(process.env.PORT || 5000),
  frontendUrl: normalizeBaseUrl(process.env.FRONTEND_URL, 'http://localhost:5173'),
  backendPublicUrl: normalizeBaseUrl(process.env.BACKEND_PUBLIC_URL, 'http://localhost:5000'),
  databaseUrl: process.env.DATABASE_URL?.trim() || '',
};

export function getJwtSecret() {
  return requireSecret('JWT_SECRET', 32);
}

export function getEncryptionKey() {
  const encoded = process.env.APP_ENCRYPTION_KEY?.trim();
  if (!encoded) {
    throw new Error('APP_ENCRYPTION_KEY must be configured as a base64-encoded 32-byte key.');
  }

  const key = Buffer.from(encoded, 'base64');
  if (key.length !== 32) {
    throw new Error('APP_ENCRYPTION_KEY must decode to exactly 32 bytes.');
  }
  return key;
}

export function validateRuntimeConfig() {
  if (!runtimeConfig.databaseUrl) {
    throw new Error('DATABASE_URL is required. Copy apps/backend/.env.example to apps/backend/.env and run npm run setup:env.');
  }
  if (!Number.isInteger(runtimeConfig.port) || runtimeConfig.port < 1 || runtimeConfig.port > 65535) {
    throw new Error('PORT must be a valid TCP port.');
  }
  getJwtSecret();
  getEncryptionKey();
}

export function allowedFrontendOrigins() {
  const configured = process.env.CORS_ORIGINS
    ?.split(',')
    .map((origin) => origin.trim().replace(/\/$/, ''))
    .filter(Boolean) ?? [];

  return [...new Set([
    runtimeConfig.frontendUrl,
    ...configured,
    ...(runtimeConfig.nodeEnv === 'production'
      ? []
      : ['http://localhost:5173', 'http://127.0.0.1:5173', 'http://localhost:5174', 'http://127.0.0.1:5174']),
  ])];
}
