// apps/backend/src/app.ts
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { rateLimit } from 'express-rate-limit';
import { google } from 'googleapis';
import { db } from './db/index.js';
import {
  applications,
  atsCredentials,
  profileDocuments,
  profiles,
  savedJobs,
  users,
  userIntegrations,
  jobPostings
} from './db/schema.js';
import { desc, eq, and } from 'drizzle-orm';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import multer from 'multer';
import fs from 'fs';
import path from 'path';
import {
  createOrUpdateApplication,
  listApplications,
  type ApplicationStatus,
  type CreateApplicationInput,
  deleteApplication,
  deleteApplicationByJobId,
  updateApplicationStatus,
} from './applications/applicationService.js';
import {
  buildPresentationEmailFixture,
  buildGmailApplicationQuery,
  classifyEmailStatus,
  inferStatusFromEmails,
  scoreEmailAgainstApplication,
  type ScannedEmail,
} from './email/emailScan.js';
import {
  GMAIL_PERMISSION_MESSAGE,
  GMAIL_READONLY_SCOPE,
  GMAIL_RECONNECT_MESSAGE,
  isExpiredGoogleAuthorization,
  isMissingGmailReadPermission,
} from './email/googleAuthError.js';
import { listSavedJobs, searchJobs, setSavedJob, streamSearchJobs, type JobSearchStreamEvent } from './jobs/jobService.js';
import { suggestLocations } from './jobs/locationService.js';
import type { JobSearchFilters } from './jobs/types.js';
import { allowedFrontendOrigins, getJwtSecret, runtimeConfig } from './config.js';
import { decryptSecret, encryptSecret, isEncryptedSecret } from './security/secrets.js';
import {
  cleanCredentialLabel,
  cleanCredentialPassword,
  cleanCredentialProvider,
  cleanCredentialUsername,
  normalizeCredentialOrigin,
} from './security/atsCredentials.js';
import { parseResumeFile, suggestRelatedSkills } from './profile/resumeParser.js';

const app = express();
const JWT_SECRET = getJwtSecret();
const frontendOrigins = allowedFrontendOrigins();

if (runtimeConfig.nodeEnv === 'production') {
  app.set('trust proxy', 1);
}

app.use(helmet({
  crossOriginResourcePolicy: { policy: 'cross-origin' },
}));
app.use(cors({
  origin(origin, callback) {
    const normalizedOrigin = origin?.replace(/\/$/, '');
    const localExtension = runtimeConfig.nodeEnv !== 'production' && /^chrome-extension:\/\/[a-p]{32}$/i.test(normalizedOrigin ?? '');
    if (!origin || frontendOrigins.includes(normalizedOrigin ?? '') || localExtension) {
      callback(null, true);
      return;
    }
    callback(new Error('Origin is not allowed by RoleMatch CORS policy.'));
  },
  credentials: true,
}));

app.use(express.json({ limit: '1mb' }));

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 30,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  message: { error: 'Too many authentication attempts. Try again later.' },
});

const credentialResolveLimiter = rateLimit({
  windowMs: 5 * 60 * 1000,
  limit: 120,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  message: { error: 'Too many ATS credential requests. Try again shortly.' },
});

function cleanCustomAnswerIntent(value: unknown) {
  return String(value ?? '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9 _-]+/g, '')
    .replace(/[\s-]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 80);
}

function cleanCustomAnswerAliases(value: unknown) {
  const aliases = Array.isArray(value)
    ? value
    : typeof value === 'string'
      ? value.split(/\r?\n/)
      : [];
  const seen = new Set<string>();

  return aliases
    .map((alias) => String(alias ?? '').replace(/\s+/g, ' ').trim().slice(0, 240))
    .filter((alias) => {
      const normalized = alias.toLowerCase();
      if (!normalized || seen.has(normalized)) return false;
      seen.add(normalized);
      return true;
    })
    .slice(0, 40);
}

function cleanCustomAutofillAnswer(value: unknown) {
  const entry = value && typeof value === 'object' ? value as Record<string, unknown> : {};

  return {
    intent: cleanCustomAnswerIntent(entry.intent),
    label: String(entry.label ?? '').replace(/\s+/g, ' ').trim().slice(0, 240),
    aliases: cleanCustomAnswerAliases(entry.aliases),
    keywords: String(entry.keywords ?? '').replace(/\s+/g, ' ').trim().slice(0, 240),
    answer: String(entry.answer ?? '').trim().slice(0, 4000),
    shortAnswer: String(entry.shortAnswer ?? '').trim().slice(0, 1000),
    longAnswer: String(entry.longAnswer ?? '').trim().slice(0, 4000),
  };
}

app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    environment: runtimeConfig.nodeEnv,
    capabilities: {
      gmail: isGoogleOAuthConfigured(),
      googleJobs: Boolean(process.env.SERPAPI_API_KEY || process.env.SERP_API_KEY),
      adzuna: Boolean(process.env.ADZUNA_APP_ID && process.env.ADZUNA_APP_KEY),
      usaJobs: Boolean(process.env.USAJOBS_API_KEY && (process.env.USAJOBS_USER_AGENT || process.env.USAJOBS_EMAIL)),
      atsBoards: true,
      resumeImport: true,
    },
  });
});

// GET /api/profile
app.get('/api/profile', async (req, res) => {
  try {
    const userId = getUserIdFromAuthHeader(req.headers.authorization);

    // 2. Fetch the specific user's profile from the database
    const userProfiles = await db.select()
        .from(profiles)
        .where(eq(profiles.userId, userId))
        .limit(1);

    if (userProfiles.length === 0) {
      return res.status(404).json({ error: "Profile not found." });
    }

    const [applicationRows, savedRows, userRows, integrationRows] = await Promise.all([
      db.select({ status: applications.status }).from(applications).where(eq(applications.userId, userId)),
      db.select({ id: savedJobs.id }).from(savedJobs).where(eq(savedJobs.userId, userId)),
      db.select({ email: users.email }).from(users).where(eq(users.id, userId)).limit(1),
      db.select().from(userIntegrations).where(and(eq(userIntegrations.userId, userId), eq(userIntegrations.provider, 'google'))),
    ]);
    const gmailIntegration = integrationRows[0] ?? null;
    let isGmailConnected = false;
    let gmailConnectionIssue: string | null = null;

    if (gmailIntegration) {
      if (!isGoogleOAuthConfigured()) {
        gmailConnectionIssue = 'Google OAuth is not configured for this RoleMatch environment.';
      } else {
        try {
          await createAuthorizedGoogleClient(gmailIntegration);
          isGmailConnected = true;
        } catch (error) {
          if (isExpiredGoogleAuthorization(error)) {
            gmailConnectionIssue = GMAIL_RECONNECT_MESSAGE;
          } else if (isMissingGmailReadPermission(error)) {
            gmailConnectionIssue = GMAIL_PERMISSION_MESSAGE;
          } else {
            isGmailConnected = true;
            gmailConnectionIssue = 'RoleMatch could not verify Gmail right now. Try Check inbox again before reconnecting.';
            console.warn('Gmail connection verification failed:', error);
          }
        }
      }
    }

    const documents = await db.select()
      .from(profileDocuments)
      .where(eq(profileDocuments.userId, userId))
      .orderBy(desc(profileDocuments.uploadedAt));

    // 3. Send the real database data
    res.json({
      ...userProfiles[0],
      email: userRows[0]?.email ?? null,
      gmailEmail: gmailIntegration?.email ?? null,
      documents,
      isGmailConnected,
      gmailConnectionIssue,
      stats: {
        applications: applicationRows.length,
        saved: savedRows.length,
        interviews: applicationRows.filter((application) => application.status === 'interview').length,
      },
    });
  } catch (error) {
    console.error("Database error:", error);
    const message = error instanceof Error ? error.message : 'Failed to fetch profile';
    const status = message.includes('jwt') || message.includes('token') || message.includes('authorization') ? 401 : 500;
    res.status(status).json({ error: status === 401 ? 'Session expired. Please log in again.' : message });
  }
});

function getUserIdFromAuthHeader(authHeader?: string) {
  if (!authHeader) {
    throw new Error('Unauthorized');
  }

  const token = authHeader.split(' ')[1];
  if (!token) {
    throw new Error('Malformed authorization token.');
  }

  const decoded = jwt.verify(token, JWT_SECRET) as jwt.JwtPayload;
  const userId = decoded.userId;

  if (typeof userId !== 'string') {
    throw new Error('Invalid authorization token.');
  }

  return userId;
}

type AtsCredentialRow = typeof atsCredentials.$inferSelect;

function publicAtsCredential(row: AtsCredentialRow) {
  return {
    id: row.id,
    label: row.label,
    provider: row.provider,
    origin: row.origin,
    username: row.username,
    hasPassword: Boolean(row.encryptedPassword),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function credentialRequestStatus(message: string) {
  if (/Unauthorized|authorization|jwt|token/i.test(message)) return 401;
  if (/not found/i.test(message)) return 404;
  if (/required|valid|must use|too long|do not include/i.test(message)) return 400;
  return 500;
}

app.get('/api/profile/ats-credentials', async (req, res) => {
  try {
    const userId = getUserIdFromAuthHeader(req.headers.authorization);
    const rows = await db.select()
      .from(atsCredentials)
      .where(eq(atsCredentials.userId, userId))
      .orderBy(desc(atsCredentials.updatedAt));
    res.setHeader('Cache-Control', 'no-store');
    res.json({ credentials: rows.map(publicAtsCredential) });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unable to load ATS accounts.';
    const status = credentialRequestStatus(message);
    res.status(status).json({ error: status === 500 ? 'Unable to load ATS accounts.' : message });
  }
});

app.post('/api/profile/ats-credentials', async (req, res) => {
  try {
    const userId = getUserIdFromAuthHeader(req.headers.authorization);
    const origin = normalizeCredentialOrigin(String(req.body.loginUrl ?? req.body.origin ?? ''));
    const provider = cleanCredentialProvider(req.body.provider, origin);
    const label = cleanCredentialLabel(req.body.label, provider);
    const username = cleanCredentialUsername(req.body.username);
    const encryptedPassword = encryptSecret(cleanCredentialPassword(req.body.password));
    if (!encryptedPassword) throw new Error('ATS password is required.');

    const existing = await db.select({ id: atsCredentials.id })
      .from(atsCredentials)
      .where(and(eq(atsCredentials.userId, userId), eq(atsCredentials.origin, origin)))
      .limit(1);
    if (existing[0]) {
      return res.status(409).json({ error: 'An ATS account already exists for this login origin. Edit that account instead.' });
    }

    const inserted = await db.insert(atsCredentials).values({
      userId,
      label,
      provider,
      origin,
      username,
      encryptedPassword,
      updatedAt: new Date(),
    }).returning();

    res.setHeader('Cache-Control', 'no-store');
    res.status(201).json({ credential: publicAtsCredential(inserted[0]!) });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unable to save ATS account.';
    const status = credentialRequestStatus(message);
    res.status(status).json({ error: status === 500 ? 'Unable to save ATS account.' : message });
  }
});

app.put('/api/profile/ats-credentials/:id', async (req, res) => {
  try {
    const userId = getUserIdFromAuthHeader(req.headers.authorization);
    const currentRows = await db.select()
      .from(atsCredentials)
      .where(and(eq(atsCredentials.id, req.params.id), eq(atsCredentials.userId, userId)))
      .limit(1);
    const current = currentRows[0];
    if (!current) return res.status(404).json({ error: 'ATS account not found.' });

    const origin = req.body.loginUrl || req.body.origin
      ? normalizeCredentialOrigin(String(req.body.loginUrl ?? req.body.origin))
      : current.origin;
    const provider = cleanCredentialProvider(req.body.provider ?? current.provider, origin);
    const label = cleanCredentialLabel(req.body.label ?? current.label, provider);
    const username = cleanCredentialUsername(req.body.username ?? current.username);
    const password = String(req.body.password ?? '');
    const encryptedPassword = password ? encryptSecret(cleanCredentialPassword(password)) : current.encryptedPassword;
    if (!encryptedPassword) throw new Error('ATS password is required.');

    if (origin !== current.origin) {
      const conflict = await db.select({ id: atsCredentials.id })
        .from(atsCredentials)
        .where(and(eq(atsCredentials.userId, userId), eq(atsCredentials.origin, origin)))
        .limit(1);
      if (conflict[0] && conflict[0].id !== current.id) {
        return res.status(409).json({ error: 'Another ATS account already uses this login origin.' });
      }
    }

    const updated = await db.update(atsCredentials)
      .set({ label, provider, origin, username, encryptedPassword, updatedAt: new Date() })
      .where(and(eq(atsCredentials.id, current.id), eq(atsCredentials.userId, userId)))
      .returning();
    res.setHeader('Cache-Control', 'no-store');
    res.json({ credential: publicAtsCredential(updated[0]!) });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unable to update ATS account.';
    const status = credentialRequestStatus(message);
    res.status(status).json({ error: status === 500 ? 'Unable to update ATS account.' : message });
  }
});

app.delete('/api/profile/ats-credentials/:id', async (req, res) => {
  try {
    const userId = getUserIdFromAuthHeader(req.headers.authorization);
    const removed = await db.delete(atsCredentials)
      .where(and(eq(atsCredentials.id, req.params.id), eq(atsCredentials.userId, userId)))
      .returning({ id: atsCredentials.id });
    if (!removed[0]) return res.status(404).json({ error: 'ATS account not found.' });
    res.status(204).send();
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unable to delete ATS account.';
    const status = credentialRequestStatus(message);
    res.status(status).json({ error: status === 500 ? 'Unable to delete ATS account.' : message });
  }
});

app.post('/api/extension/ats-credentials/resolve', credentialResolveLimiter, async (req, res) => {
  try {
    const userId = getUserIdFromAuthHeader(req.headers.authorization);
    const origin = normalizeCredentialOrigin(String(req.body.url ?? req.body.origin ?? ''));
    const rows = await db.select()
      .from(atsCredentials)
      .where(and(eq(atsCredentials.userId, userId), eq(atsCredentials.origin, origin)))
      .limit(1);
    const credential = rows[0];

    res.setHeader('Cache-Control', 'no-store, private');
    res.setHeader('Pragma', 'no-cache');
    if (!credential) return res.json({ credential: null });
    if (!isEncryptedSecret(credential.encryptedPassword)) {
      throw new Error('Stored ATS credential is not encrypted. Re-save this account before using it.');
    }
    const password = decryptSecret(credential.encryptedPassword);
    if (!password) throw new Error('Stored ATS credential is incomplete.');

    res.json({
      credential: {
        id: credential.id,
        label: credential.label,
        provider: credential.provider,
        origin: credential.origin,
        username: credential.username,
        password,
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unable to resolve ATS account.';
    const status = credentialRequestStatus(message);
    res.status(status).json({ error: status === 500 ? 'Unable to resolve ATS account.' : message });
  }
});

function parseJobFilters(query: Record<string, unknown>): JobSearchFilters {
  const rawLimit = Number(query.limit ?? 200);
  const rawMinSalary = Number(query.minSalary ?? 0);
  const rawLocationLat = Number(query.locationLat);
  const rawLocationLng = Number(query.locationLng);
  const rawLocationRadius = Number(query.locationRadiusMiles);
  const rawLocation = typeof query.location === 'string' ? query.location.trim() : '';
  const locationIncludesRemote = /\bremote\b/i.test(rawLocation);
  const location = rawLocation
    .replace(/\bremote\b/gi, '')
    .replace(/\s*,\s*/g, ', ')
    .replace(/\s+/g, ' ')
    .replace(/,\s*$/g, '')
    .trim();

  return {
    query: typeof query.query === 'string' ? query.query.trim() : undefined,
    location: location || undefined,
    locationCity: typeof query.locationCity === 'string' ? query.locationCity.trim() || undefined : undefined,
    locationRegion: typeof query.locationRegion === 'string' ? query.locationRegion.trim() || undefined : undefined,
    locationCountry: typeof query.locationCountry === 'string' ? query.locationCountry.trim() || undefined : undefined,
    locationCountryName: typeof query.locationCountryName === 'string' ? query.locationCountryName.trim() || undefined : undefined,
    locationLat: Number.isFinite(rawLocationLat) ? rawLocationLat : undefined,
    locationLng: Number.isFinite(rawLocationLng) ? rawLocationLng : undefined,
    locationRadiusMiles: Number.isFinite(rawLocationRadius) && rawLocationRadius > 0 ? Math.max(1, Math.min(rawLocationRadius, 500)) : undefined,
    includeRemote: query.includeRemote === 'true' || query.remote === 'true' || locationIncludesRemote,
    remote: query.remote === 'true' || locationIncludesRemote,
    employmentType: typeof query.employmentType === 'string' && query.employmentType !== 'Any' ? query.employmentType : undefined,
    experienceLevel: typeof query.experienceLevel === 'string' && query.experienceLevel !== 'Any' ? query.experienceLevel : undefined,
    minSalary: Number.isFinite(rawMinSalary) && rawMinSalary > 0 ? rawMinSalary : undefined,
    source: typeof query.source === 'string' ? query.source : undefined,
    includeCached: query.includeCached === 'true',
    limit: Number.isFinite(rawLimit) ? Math.max(1, Math.min(rawLimit, 500)) : 200,
  };
}

app.get('/api/locations/suggest', (req, res) => {
  const query = typeof req.query.q === 'string' ? req.query.q.trim() : '';
  const limit = Number(req.query.limit ?? 8);

  res.json({
    locations: suggestLocations(query, Number.isFinite(limit) ? limit : 8),
  });
});

function writeSse(res: express.Response, event: JobSearchStreamEvent) {
  res.write(`data: ${JSON.stringify(event)}\n\n`);
}

// POST /api/auth/register
app.post('/api/auth/register', authLimiter, async (req, res) => {
  try {
    const email = String(req.body.email ?? '').trim().toLowerCase();
    const password = String(req.body.password ?? '');
    const firstName = String(req.body.firstName ?? '').trim();
    const lastName = String(req.body.lastName ?? '').trim();
    if (!/^\S+@\S+\.\S+$/.test(email)) {
      return res.status(400).json({ error: 'Enter a valid email address.' });
    }
    if (password.length < 10) {
      return res.status(400).json({ error: 'Password must be at least 10 characters.' });
    }
    if (!firstName || !lastName) {
      return res.status(400).json({ error: 'First and last name are required.' });
    }
    const hashedPassword = await bcrypt.hash(password, 10);

    const newUserResult = await db.insert(users).values({
      email,
      passwordHash: hashedPassword,
      authProvider: 'local'
    }).returning();

    const createdUser = newUserResult[0];
    if (!createdUser) {
      return res.status(500).json({ error: "Failed to create user account." });
    }

    // 2. Create the base profile
    await db.insert(profiles).values({
      userId: createdUser.id,
      fullName: `${firstName} ${lastName}`.trim(),
    });

    // 3. Auto-generate token so they can proceed directly to onboarding
    const token = jwt.sign({ userId: createdUser.id }, JWT_SECRET, { expiresIn: '7d' });

    res.status(201).json({ message: "User registered successfully!", token });
  } catch (error) {
    console.error("Registration error:", error);
    res.status(500).json({ error: "Registration failed. Email might already exist." });
  }
});

// POST /api/auth/login
app.post('/api/auth/login', authLimiter, async (req, res) => {
  try {
    const email = String(req.body.email ?? '').trim().toLowerCase();
    const password = String(req.body.password ?? '');
    const userResult = await db.select().from(users).where(eq(users.email, email));
    const user = userResult[0];
    if (!user) return res.status(401).json({ error: "Invalid credentials" });

    const isValid = await bcrypt.compare(password, user.passwordHash);
    if (!isValid) return res.status(401).json({ error: "Invalid credentials" });

    await db.update(users).set({ lastLoginAt: new Date() }).where(eq(users.id, user.id));
    const token = jwt.sign({ userId: user.id }, JWT_SECRET, { expiresIn: '7d' });
    res.json({ token, userId: user.id, email: user.email });
  } catch (error) {
    res.status(500).json({ error: "Login failed" });
  }
});

function parseApplicationStatus(value: unknown): ApplicationStatus | undefined {
  const statuses = new Set<ApplicationStatus>(['blocked', 'in_progress', 'interview', 'offer', 'rejected', 'submitted']);
  return typeof value === 'string' && statuses.has(value as ApplicationStatus) ? value as ApplicationStatus : undefined;
}

// GET /api/applications
app.get('/api/applications', async (req, res) => {
  try {
    const userId = getUserIdFromAuthHeader(req.headers.authorization);
    const applications = await listApplications(userId, parseApplicationStatus(req.query.status));

    res.json({ applications });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to load applications.';
    const status = message.includes('Unauthorized') || message.includes('authorization') || message.includes('jwt') || message.includes('token') ? 401 : 500;

    res.status(status).json({ error: status === 401 ? 'Session expired. Please log in again.' : message });
  }
});

// POST /api/applications
app.post('/api/applications', async (req, res) => {
  try {
    const userId = getUserIdFromAuthHeader(req.headers.authorization);
    const application = await createOrUpdateApplication(userId, req.body as CreateApplicationInput);

    res.status(201).json({ application });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to create application.';
    const status = message.includes('Unauthorized') || message.includes('authorization') || message.includes('jwt') || message.includes('token')
      ? 401
      : message.includes('not found')
        ? 404
        : message.includes('need')
          ? 400
          : 500;

    res.status(status).json({ error: status === 401 ? 'Session expired. Please log in again.' : message });
  }
});

// PATCH /api/applications/:id/status
app.patch('/api/applications/:id/status', async (req, res) => {
  try {
    const userId = getUserIdFromAuthHeader(req.headers.authorization);
    const nextStatus = parseApplicationStatus(req.body?.status);
    if (!nextStatus) {
      res.status(400).json({ error: 'Invalid application status.' });
      return;
    }

    const application = await updateApplicationStatus(userId, req.params.id, {
      status: nextStatus,
    });

    if (!application) {
      res.status(404).json({ error: 'Application not found.' });
      return;
    }

    res.json({ application });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to update application status.';
    const status = message.includes('Unauthorized') || message.includes('authorization') || message.includes('jwt') || message.includes('token')
      ? 401
      : 400;

    res.status(status).json({ error: status === 401 ? 'Session expired. Please log in again.' : message });
  }
});

// GET /api/jobs/search
app.get('/api/jobs/search', async (req, res) => {
  try {
    const userId = getUserIdFromAuthHeader(req.headers.authorization);
    const result = await searchJobs(parseJobFilters(req.query), userId);

    res.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to search jobs.';
    const status = message.includes('Unauthorized') || message.includes('authorization') || message.includes('jwt') || message.includes('token') ? 401 : 500;

    res.status(status).json({ error: status === 401 ? 'Session expired. Please log in again.' : message });
  }
});

// GET /api/jobs/search/stream
app.get('/api/jobs/search/stream', async (req, res) => {
  try {
    const userId = getUserIdFromAuthHeader(req.headers.authorization);
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });

    await streamSearchJobs(parseJobFilters(req.query), userId, (event) => writeSse(res, event));
    res.end();
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to stream jobs.';
    if (!res.headersSent) {
      const status = message.includes('Unauthorized') || message.includes('authorization') || message.includes('jwt') || message.includes('token') ? 401 : 500;
      res.status(status).json({ error: status === 401 ? 'Session expired. Please log in again.' : message });
      return;
    }

    writeSse(res, { type: 'provider-result', provider: 'RoleMatch', jobs: [], providerResult: { provider: 'RoleMatch', count: 0, error: message } });
    writeSse(res, { type: 'done', total: 0 });
    res.end();
  }
});

// GET /api/jobs/saved
app.get('/api/jobs/saved', async (req, res) => {
  try {
    const userId = getUserIdFromAuthHeader(req.headers.authorization);
    const jobs = await listSavedJobs(userId, parseJobFilters(req.query));

    res.json({ jobs });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to load saved jobs.';
    const status = message.includes('Unauthorized') || message.includes('authorization') || message.includes('jwt') || message.includes('token') ? 401 : 500;

    res.status(status).json({ error: status === 401 ? 'Session expired. Please log in again.' : message });
  }
});

// PUT /api/jobs/:jobId/save
app.put('/api/jobs/:jobId/save', async (req, res) => {
  try {
    const userId = getUserIdFromAuthHeader(req.headers.authorization);
    const { jobId } = req.params;

    if (!jobId) {
      return res.status(400).json({ error: 'Missing job id.' });
    }

    const saved = await setSavedJob(userId, jobId, Boolean(req.body.saved));

    res.json({ saved });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to update saved job.';
    const status = message.includes('Unauthorized') || message.includes('authorization') || message.includes('jwt') || message.includes('token') ? 401 : message.includes('not found') ? 404 : 500;

    res.status(status).json({ error: status === 401 ? 'Session expired. Please log in again.' : message });
  }
});

// PUT /api/profile
app.put('/api/profile', async (req, res) => {
  try {
    const userId = getUserIdFromAuthHeader(req.headers.authorization);
    const toStringArray = (value: unknown) => Array.isArray(value)
      ? value.map(String).map((item) => item.trim()).filter(Boolean)
      : typeof value === 'string'
        ? value.split(',').map((item) => item.trim()).filter(Boolean)
        : [];
    const toObjectArray = (value: unknown) => Array.isArray(value) ? value : [];
    const rawAutofillAnswers = req.body.autofillAnswers && typeof req.body.autofillAnswers === 'object'
      ? req.body.autofillAnswers as Record<string, unknown>
      : {};
    const customAutofill = Array.isArray(rawAutofillAnswers.custom)
      ? rawAutofillAnswers.custom
          .map(cleanCustomAutofillAnswer)
          .filter((entry) => (
            entry.intent || entry.label || entry.aliases.length || entry.keywords
            || entry.answer || entry.shortAnswer || entry.longAnswer
          ))
      : [];
    const autofillAnswers: Record<string, unknown> = {
      ...rawAutofillAnswers,
      custom: customAutofill,
    };
    const workAuthorization = String(req.body.workAuthorization ?? req.body.autofillAnswers?.authorizedToWork ?? '').trim();
    const dateOfBirth = String(req.body.dateOfBirth ?? '').trim();

    const updated = await db.update(profiles)
      .set({
        fullName: String(req.body.fullName ?? '').trim() || 'RoleMatch User',
        dateOfBirth: dateOfBirth || null,
        phone: String(req.body.phone ?? '').trim() || null,
        location: String(req.body.location ?? '').trim() || null,
        education: String(req.body.education ?? '').trim() || null,
        workExperience: String(req.body.workExperience ?? '').trim() || null,
        linkedinUrl: String(req.body.linkedinUrl ?? '').trim() || null,
        githubUrl: String(req.body.githubUrl ?? '').trim() || null,
        portfolioUrl: String(req.body.portfolioUrl ?? '').trim() || null,
        indeedUrl: String(req.body.indeedUrl ?? '').trim() || null,
        workAuthorization: workAuthorization || null,
        veteranStatus: String(req.body.veteranStatus ?? autofillAnswers.veteranStatus ?? '').trim() || null,
        disabilityStatus: String(req.body.disabilityStatus ?? autofillAnswers.disabilityStatus ?? '').trim() || null,
        gender: String(req.body.gender ?? autofillAnswers.gender ?? '').trim() || null,
        race: String(req.body.race ?? autofillAnswers.race ?? '').trim() || null,
        salaryMinimum: String(req.body.salaryMinimum ?? autofillAnswers.desiredSalary ?? '').trim() || null,
        skills: toStringArray(req.body.skills).length > 0 ? toStringArray(req.body.skills) : null,
        targetRoles: toStringArray(req.body.targetRoles).length > 0 ? toStringArray(req.body.targetRoles) : null,
        preferredLocations: toStringArray(req.body.preferredLocations).length > 0 ? toStringArray(req.body.preferredLocations) : null,
        relevantCourses: toStringArray(req.body.relevantCourses).length > 0 ? toStringArray(req.body.relevantCourses) : null,
        portfolioLinks: toStringArray(req.body.portfolioLinks).length > 0 ? toStringArray(req.body.portfolioLinks) : null,
        educationHistory: toObjectArray(req.body.educationHistory),
        workHistory: toObjectArray(req.body.workHistory),
        projectHistory: toObjectArray(req.body.projectHistory),
        certifications: toObjectArray(req.body.certifications),
        autofillAnswers,
      })
      .where(eq(profiles.userId, userId))
      .returning();

    if (!updated[0]) {
      return res.status(404).json({ error: 'Profile not found.' });
    }

    res.json({ profile: updated[0] });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to update profile.';
    const status = message.includes('Unauthorized') || message.includes('authorization') || message.includes('jwt') || message.includes('token') ? 401 : 500;

    res.status(status).json({ error: status === 401 ? 'Session expired. Please log in again.' : message });
  }
});

app.post('/api/profile/autofill/custom', async (req, res) => {
  try {
    const userId = getUserIdFromAuthHeader(req.headers.authorization);
    const incomingAnswer = cleanCustomAutofillAnswer(req.body);

    if (
      (!incomingAnswer.answer && !incomingAnswer.shortAnswer && !incomingAnswer.longAnswer)
      || (!incomingAnswer.intent && !incomingAnswer.label && !incomingAnswer.aliases.length && !incomingAnswer.keywords)
    ) {
      return res.status(400).json({ error: 'Custom autofill answers need a topic, question wording, or legacy keywords and an answer.' });
    }

    const rows = await db.select()
      .from(profiles)
      .where(eq(profiles.userId, userId))
      .limit(1);
    const profile = rows[0];

    if (!profile) {
      return res.status(404).json({ error: 'Profile not found.' });
    }

    const currentAutofill = profile.autofillAnswers && typeof profile.autofillAnswers === 'object'
      ? profile.autofillAnswers as Record<string, unknown>
      : {};
    const currentCustom = Array.isArray(currentAutofill.custom)
      ? currentAutofill.custom
          .map(cleanCustomAutofillAnswer)
          .filter((entry) => (
            entry.intent || entry.label || entry.aliases.length || entry.keywords
            || entry.answer || entry.shortAnswer || entry.longAnswer
          ))
      : [];
    const normalizedIntent = incomingAnswer.intent.toLowerCase();
    const normalizedLabel = incomingAnswer.label.toLowerCase();
    const normalizedKeywords = incomingAnswer.keywords.toLowerCase();
    const existingIndex = currentCustom.findIndex((entry) => (
      (normalizedIntent && entry.intent.toLowerCase() === normalizedIntent)
      || (normalizedLabel && entry.label.toLowerCase() === normalizedLabel)
      || (normalizedKeywords && entry.keywords.toLowerCase() === normalizedKeywords)
    ));
    const nextCustom = [...currentCustom];
    let customAnswer = incomingAnswer;

    if (existingIndex >= 0) {
      const existing = currentCustom[existingIndex]!;
      customAnswer = {
        ...incomingAnswer,
        intent: incomingAnswer.intent || existing.intent,
        label: incomingAnswer.label || existing.label,
        aliases: cleanCustomAnswerAliases([...existing.aliases, ...incomingAnswer.aliases]),
        keywords: incomingAnswer.keywords || existing.keywords,
        answer: incomingAnswer.answer || existing.answer,
        shortAnswer: incomingAnswer.shortAnswer || existing.shortAnswer,
        longAnswer: incomingAnswer.longAnswer || existing.longAnswer,
      };
      nextCustom[existingIndex] = customAnswer;
    } else {
      nextCustom.push(customAnswer);
    }

    const autofillAnswers = {
      ...currentAutofill,
      custom: nextCustom,
    };

    const updated = await db.update(profiles)
      .set({ autofillAnswers })
      .where(eq(profiles.userId, userId))
      .returning();

    res.status(201).json({ profile: updated[0], customAnswer });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to save custom autofill answer.';
    const status = message.includes('Unauthorized') || message.includes('authorization') || message.includes('jwt') || message.includes('token') ? 401 : 500;

    res.status(status).json({ error: status === 401 ? 'Session expired. Please log in again.' : message });
  }
});

// PUT /api/profile/onboarding
const uploadDir = 'uploads/resumes';
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}
const documentsDir = 'uploads/profile-documents';
if (!fs.existsSync(documentsDir)) {
  fs.mkdirSync(documentsDir, { recursive: true });
}

// Configure how and where Multer saves the files
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, uploadDir);
  },
  filename: function (req, file, cb) {
    // Give the file a unique name to prevent overwriting
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9);
    cb(null, uniqueSuffix + path.extname(file.originalname));
  }
});

const upload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024, files: 1, fields: 30 },
});
const documentStorage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, documentsDir);
  },
  filename: function (req, file, cb) {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9);
    cb(null, uniqueSuffix + path.extname(file.originalname));
  }
});
const documentUpload = multer({
  storage: documentStorage,
  limits: { fileSize: 15 * 1024 * 1024, files: 1, fields: 10 },
  fileFilter(_req, file, callback) {
    const extension = path.extname(file.originalname).toLowerCase();
    callback(null, ['.pdf', '.doc', '.docx', '.txt', '.png', '.jpg', '.jpeg', '.webp'].includes(extension));
  },
});
const resumeParseUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024, files: 1 },
  fileFilter(_req, file, callback) {
    const extension = path.extname(file.originalname).toLowerCase();
    callback(null, ['.pdf', '.docx', '.txt'].includes(extension));
  },
});

app.post('/api/profile/resume/parse', resumeParseUpload.single('resume'), async (req, res) => {
  try {
    getUserIdFromAuthHeader(req.headers.authorization);
    if (!req.file) {
      return res.status(400).json({ error: 'Upload a PDF, DOCX, or TXT resume.' });
    }
    const result = await parseResumeFile(req.file);
    res.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Resume import failed.';
    const status = /Unauthorized|authorization|jwt|token/i.test(message) ? 401 : 400;
    res.status(status).json({ error: status === 401 ? 'Session expired. Please log in again.' : message });
  }
});

app.post('/api/profile/skills/suggest', async (req, res) => {
  try {
    getUserIdFromAuthHeader(req.headers.authorization);
    const skills = Array.isArray(req.body.skills)
      ? req.body.skills.map(String).map((skill: string) => skill.trim()).filter(Boolean).slice(0, 80)
      : [];
    const query = String(req.body.query ?? '').trim().slice(0, 60);
    res.json({ suggestions: suggestRelatedSkills(skills, query) });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unable to suggest skills.';
    res.status(/Unauthorized|authorization|jwt|token/i.test(message) ? 401 : 400).json({ error: message });
  }
});

app.put('/api/profile/onboarding', upload.single('resume'), async (req, res) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader) return res.status(401).json({ error: "Unauthorized" });

    const token = authHeader.split(' ')[1];
    if (!token) return res.status(401).json({ error: "Malformed authorization token." });

    const decoded = jwt.verify(token, JWT_SECRET) as jwt.JwtPayload;

    // Multer places all the text fields back into req.body
    const {
      dob, education, location, workExperience, linkedinUrl, githubUrl,
      gender, race, workAuthorization, veteranStatus, disabilityStatus
    } = req.body;

    // Multer places the file information into req.file
    // If a file was uploaded, construct the URL path to save in the DB
    const resumeUrl = req.file ? `/uploads/resumes/${req.file.filename}` : null;

    // Update the profiles table
    await db.update(profiles)
        .set({
          dateOfBirth: dob ? (new Date(dob).toISOString().split('T')[0] || null) : null,
          location: location || null,
          education: education || null,
          workExperience: workExperience || null,
          linkedinUrl: linkedinUrl || null,
          githubUrl: githubUrl || null,
          gender: gender || null,
          race: race || null,
          workAuthorization: workAuthorization || null,
          veteranStatus: veteranStatus || null,
          disabilityStatus: disabilityStatus || null,
          // Save the file path to the database
          resumeUrl: resumeUrl
        })
        .where(eq(profiles.userId, decoded.userId as string));

    res.json({ message: "Profile onboarded successfully!", resumeUrl });
  } catch (error) {
    console.error("Onboarding error:", error);
    res.status(500).json({ error: "Failed to save profile preferences." });
  }
});

app.post('/api/profile/documents', documentUpload.single('document'), async (req, res) => {
  try {
    const userId = getUserIdFromAuthHeader(req.headers.authorization);
    if (!req.file) {
      return res.status(400).json({ error: 'No document uploaded.' });
    }

    const documentType = String(req.body.documentType ?? 'resume').trim() || 'resume';
    const label = String(req.body.label ?? req.file.originalname).trim() || req.file.originalname;
    const fileUrl = `/uploads/profile-documents/${req.file.filename}`;
    const inserted = await db.insert(profileDocuments).values({
      userId,
      label,
      documentType,
      fileName: req.file.originalname,
      fileUrl,
      mimeType: req.file.mimetype,
    }).returning();

    if (documentType === 'resume') {
      await db.update(profiles).set({ resumeUrl: fileUrl }).where(eq(profiles.userId, userId));
    }

    res.status(201).json({ document: inserted[0] });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to upload document.';
    const status = message.includes('Unauthorized') || message.includes('authorization') || message.includes('jwt') || message.includes('token') ? 401 : 500;

    res.status(status).json({ error: status === 401 ? 'Session expired. Please log in again.' : message });
  }
});

app.delete('/api/applications/:id', async (req, res) => {
  try {
    const userId = getUserIdFromAuthHeader(req.headers.authorization);
    const success = await deleteApplication(userId, req.params.id);
    if (!success) return res.status(404).json({ error: 'Application not found.' });
    res.json({ success: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to untrack application.';
    const status = message.includes('Unauthorized') || message.includes('authorization') || message.includes('jwt') || message.includes('token') ? 401 : 500;
    res.status(status).json({ error: status === 401 ? 'Session expired. Please log in again.' : message });
  }
});

app.delete('/api/applications/job/:jobId', async (req, res) => {
  try {
    const userId = getUserIdFromAuthHeader(req.headers.authorization);
    const success = await deleteApplicationByJobId(userId, req.params.jobId);
    if (!success) return res.status(404).json({ error: 'Application not found.' });
    res.json({ success: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to untrack application.';
    const status = message.includes('Unauthorized') || message.includes('authorization') || message.includes('jwt') || message.includes('token') ? 401 : 500;
    res.status(status).json({ error: status === 401 ? 'Session expired. Please log in again.' : message });
  }
});

const avatarsDir = 'uploads/avatars';
if (!fs.existsSync(avatarsDir)) {
  fs.mkdirSync(avatarsDir, { recursive: true });
}

// 2. Define standard disk storage configuration for profile pictures
const avatarStorage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, avatarsDir);
  },
  filename: function (req, file, cb) {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9);
    cb(null, 'avatar-' + uniqueSuffix + path.extname(file.originalname));
  }
});
const avatarUpload = multer({
  storage: avatarStorage,
  limits: { fileSize: 5 * 1024 * 1024, files: 1, fields: 2 },
  fileFilter(_req, file, callback) {
    callback(null, /^image\/(?:png|jpeg|webp)$/i.test(file.mimetype));
  },
});

app.use('/uploads/avatars', express.static(avatarsDir, {
  fallthrough: false,
  maxAge: runtimeConfig.nodeEnv === 'production' ? '1d' : 0,
}));

app.get('/uploads/profile-documents/:fileName', async (req, res) => {
  try {
    const fileName = path.basename(req.params.fileName);
    const fileUrl = `/uploads/profile-documents/${fileName}`;
    const [document] = await db.select({
      id: profileDocuments.id,
      userId: profileDocuments.userId,
      documentType: profileDocuments.documentType,
    })
      .from(profileDocuments)
      .where(eq(profileDocuments.fileUrl, fileUrl))
      .limit(1);
    if (!document) return res.status(404).json({ error: 'Document not found.' });
    const isPublicProfileImage = ['profile-photo', 'profile-banner'].includes(document.documentType);
    if (!isPublicProfileImage) {
      const userId = getUserIdFromAuthHeader(req.headers.authorization);
      if (document.userId !== userId) return res.status(404).json({ error: 'Document not found.' });
    }
    res.sendFile(path.resolve(documentsDir, fileName));
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unable to open document.';
    res.status(/Unauthorized|authorization|jwt|token/i.test(message) ? 401 : 500).json({ error: message });
  }
});

app.get('/uploads/resumes/:fileName', async (req, res) => {
  try {
    const userId = getUserIdFromAuthHeader(req.headers.authorization);
    const fileName = path.basename(req.params.fileName);
    const fileUrl = `/uploads/resumes/${fileName}`;
    const [profile] = await db.select({ id: profiles.id })
      .from(profiles)
      .where(and(eq(profiles.userId, userId), eq(profiles.resumeUrl, fileUrl)))
      .limit(1);
    if (!profile) return res.status(404).json({ error: 'Resume not found.' });
    res.sendFile(path.resolve(uploadDir, fileName));
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unable to open resume.';
    res.status(/Unauthorized|authorization|jwt|token/i.test(message) ? 401 : 500).json({ error: message });
  }
});

app.post('/api/profile/avatar', avatarUpload.single('avatar'), async (req, res) => {
  try {
    const userId = getUserIdFromAuthHeader(req.headers.authorization);
    if (!req.file) {
      return res.status(400).json({ error: 'No image file provided.' });
    }

    const fileUrl = `/uploads/avatars/${req.file.filename}`;

    // Update the record in the database
    await db.update(profiles)
        .set({ avatarUrl: fileUrl })
        .where(eq(profiles.userId, userId));

    res.json({ avatarUrl: fileUrl });
  } catch (error) {
    console.error("Avatar upload failure:", error);
    res.status(500).json({ error: 'Failed to save profile picture asset.' });
  }
});

const GOOGLE_REDIRECT_URI = `${runtimeConfig.backendPublicUrl}/api/auth/google/callback`;

function isGoogleOAuthConfigured() {
  return Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET);
}

function createGoogleOAuthClient() {
  return new google.auth.OAuth2(
      process.env.GOOGLE_CLIENT_ID,
      process.env.GOOGLE_CLIENT_SECRET,
      GOOGLE_REDIRECT_URI
  );
}

async function createAuthorizedGoogleClient(integration: typeof userIntegrations.$inferSelect) {
  const oauth2Client = createGoogleOAuthClient();
  const accessToken = decryptSecret(integration.accessToken);
  const refreshToken = decryptSecret(integration.refreshToken);

  if (!isEncryptedSecret(integration.accessToken) || (integration.refreshToken && !isEncryptedSecret(integration.refreshToken))) {
    await db.update(userIntegrations)
      .set({
        accessToken: encryptSecret(accessToken)!,
        refreshToken: encryptSecret(refreshToken),
      })
      .where(eq(userIntegrations.id, integration.id));
  }

  oauth2Client.setCredentials({
    access_token: accessToken,
    refresh_token: refreshToken,
    expiry_date: integration.expiresAt ? integration.expiresAt.getTime() : null,
  });
  oauth2Client.on('tokens', async (tokens) => {
    const update: Partial<typeof userIntegrations.$inferInsert> = {};
    if (tokens.access_token) update.accessToken = encryptSecret(tokens.access_token)!;
    if (tokens.refresh_token) update.refreshToken = encryptSecret(tokens.refresh_token);
    if (tokens.expiry_date) update.expiresAt = new Date(tokens.expiry_date);
    if (Object.keys(update).length > 0) {
      await db.update(userIntegrations)
        .set(update)
        .where(eq(userIntegrations.id, integration.id));
    }
  });

  const accessTokenResult = await oauth2Client.getAccessToken();
  if (!accessTokenResult.token) {
    throw new Error(GMAIL_RECONNECT_MESSAGE);
  }

  const tokenInfo = await oauth2Client.getTokenInfo(accessTokenResult.token);
  if (!tokenInfo.scopes.includes(GMAIL_READONLY_SCOPE)) {
    const scopeError = new Error(GMAIL_PERMISSION_MESSAGE) as Error & { code?: string };
    scopeError.code = 'gmail_scope_missing';
    throw scopeError;
  }

  return oauth2Client;
}

// 1. Generate Auth URL
app.get('/api/auth/google', authLimiter, (req, res) => {
  try {
    const userId = getUserIdFromAuthHeader(req.headers.authorization);

    if (!isGoogleOAuthConfigured()) {
      return res.status(503).json({
        error: `Google OAuth is not configured. Add GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET to the backend environment and authorize ${GOOGLE_REDIRECT_URI} as a redirect URI.`
      });
    }

    const oauth2Client = createGoogleOAuthClient();
    const url = oauth2Client.generateAuthUrl({
      access_type: 'offline',
      prompt: 'consent', // Forces getting a refresh token
      include_granted_scopes: true,
      scope: [GMAIL_READONLY_SCOPE, 'email'],
      state: jwt.sign({ userId, purpose: 'google-oauth' }, JWT_SECRET, { expiresIn: '10m' }),
    });

    res.json({ url });
  } catch (error) {
    console.error("Google auth URL error:", error);
    res.status(500).json({ error: 'Failed to start Gmail connection.' });
  }
});

// 2. Handle Callback
app.get('/api/auth/google/callback', async (req, res) => {
  const { code, state: oauthState } = req.query;

  try {
    if (!isGoogleOAuthConfigured()) {
      throw new Error('Google OAuth is not configured.');
    }
    if (typeof code !== 'string' || typeof oauthState !== 'string') {
      throw new Error('Google OAuth callback is missing required parameters.');
    }

    const verifiedState = jwt.verify(oauthState, JWT_SECRET) as jwt.JwtPayload;
    if (verifiedState.purpose !== 'google-oauth' || typeof verifiedState.userId !== 'string') {
      throw new Error('Google OAuth state is invalid.');
    }
    const userId = verifiedState.userId;

    const oauth2Client = createGoogleOAuthClient();
    const { tokens } = await oauth2Client.getToken(code);
    oauth2Client.setCredentials(tokens);
    if (!tokens.access_token) {
      throw new Error('Google did not return an access token.');
    }

    // Get user's Google email
    const oauth2 = google.oauth2({ version: 'v2', auth: oauth2Client });
    const userInfo = await oauth2.userinfo.get();

    const updateData = {
      accessToken: encryptSecret(tokens.access_token)!,
      expiresAt: tokens.expiry_date ? new Date(tokens.expiry_date) : null,
      email: userInfo.data.email ?? null,
    };

    // Upsert the tokens into the userIntegrations table using Drizzle ORM
    await db.insert(userIntegrations)
        .values({
          userId,
          provider: 'google',
          accessToken: encryptSecret(tokens.access_token)!,
          refreshToken: encryptSecret(tokens.refresh_token),
          expiresAt: tokens.expiry_date ? new Date(tokens.expiry_date) : null,
          email: userInfo.data.email ?? null, // Use ?? null to prevent undefined
        })
        .onConflictDoUpdate({
          target: [userIntegrations.userId, userIntegrations.provider],
          set: tokens.refresh_token ? {
            ...updateData,
            refreshToken: encryptSecret(tokens.refresh_token)
          } : updateData
        });

    res.redirect(`${runtimeConfig.frontendUrl}/profile?gmail=connected`);
  } catch (error) {
    console.error("Callback error:", error);
    res.redirect(`${runtimeConfig.frontendUrl}/profile?gmail=error`);
  }
});

async function scanApplicationGmail(applicationId: string, userId: string, shouldSyncStatus: boolean) {
  // Join applications with job postings so the Gmail scan can match both company and role context.
  const appRecords = await db.select({
    applicationId: applications.id,
    currentStatus: applications.status,
    evidenceNotes: applications.evidenceNotes,
    submittedAt: applications.submittedAt,
    company: jobPostings.company,
    title: jobPostings.title,
    jobUrl: jobPostings.jobUrl,
  })
    .from(applications)
    .innerJoin(jobPostings, eq(applications.jobId, jobPostings.id))
    .where(and(eq(applications.id, applicationId), eq(applications.userId, userId)))
    .limit(1);

  const targetApp = appRecords[0];
  if (!targetApp) {
    return { status: 404, body: { error: 'Application not found' } };
  }

  const jobContext = {
    company: targetApp.company,
    title: targetApp.title,
    jobUrl: targetApp.jobUrl,
  };
  const presentationEmail = buildPresentationEmailFixture(jobContext);
  if (presentationEmail) {
    const rankedMessages = [presentationEmail];
    const statusInference = inferStatusFromEmails(targetApp.currentStatus as ApplicationStatus, rankedMessages);
    const statusUpdate = shouldSyncStatus && statusInference.nextStatus
      ? await updateApplicationStatus(userId, applicationId, {
        status: statusInference.nextStatus,
        evidenceNotes: `Presentation email scan: ${statusInference.reason ?? 'status signal found'}`,
      })
      : null;

    return {
      status: 200,
      body: {
        emails: rankedMessages,
        search: {
          provider: 'presentation-fixture',
          query: 'Exact RoleMatch presentation test record',
          matchedCount: rankedMessages.length,
        },
        statusUpdate: statusInference,
        application: statusUpdate,
      },
    };
  }

  const integrationRecords = await db.select()
    .from(userIntegrations)
    .where(and(eq(userIntegrations.userId, userId), eq(userIntegrations.provider, 'google')))
    .limit(1);

  const integration = integrationRecords[0];
  if (!integration) {
    return { status: 403, body: { error: 'Gmail is not connected for this local account. Connect Gmail from Profile, then run Check inbox again.' } };
  }

  if (!isGoogleOAuthConfigured()) {
    return {
      status: 503,
      body: {
        error: `Google OAuth is not configured. Add GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET to the backend environment and authorize ${GOOGLE_REDIRECT_URI} as a redirect URI.`
      },
    };
  }

  const oauth2Client = await createAuthorizedGoogleClient(integration);

  const gmail = google.gmail({ version: 'v1', auth: oauth2Client });
  const searchQuery = buildGmailApplicationQuery(jobContext);

  const response = await gmail.users.messages.list({
    userId: 'me',
    q: searchQuery,
    maxResults: 10,
    includeSpamTrash: false,
  });

  const decodeBase64Url = (data: string) => {
    return Buffer.from(data.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf-8');
  };

  const getEmailBody = (payload: any): string => {
    if (!payload) return '';
    if (payload.body && payload.body.data) {
      return decodeBase64Url(payload.body.data);
    }
    if (payload.parts && payload.parts.length > 0) {
      const htmlPart = payload.parts.find((part: any) => part.mimeType === 'text/html');
      if (htmlPart?.body?.data) return decodeBase64Url(htmlPart.body.data);

      const textPart = payload.parts.find((part: any) => part.mimeType === 'text/plain');
      if (textPart?.body?.data) return decodeBase64Url(textPart.body.data);

      for (const part of payload.parts) {
        if (part.parts) {
          const nested = getEmailBody(part);
          if (nested) return nested;
        }
      }
    }
    return '';
  };

  type GmailMessageReference = { id?: string | null };
  type GmailHeader = { name?: string | null; value?: string | null };

  const messageReferences = (response.data.messages || []) as GmailMessageReference[];
  const messages = await Promise.all(
    messageReferences.map(async (msg) => {
      const msgData = await gmail.users.messages.get({ userId: 'me', id: msg.id!, format: 'full' });
      const headers = (msgData.data.payload?.headers || []) as GmailHeader[];
      const getHeader = (name: string) => headers.find((header) => header.name?.toLowerCase() === name.toLowerCase())?.value || '';

      const email = {
        id: msg.id ?? null,
        snippet: msgData.data.snippet ?? null,
        subject: getHeader('subject'),
        from: getHeader('from'),
        date: getHeader('date'),
        bodyHtml: getEmailBody(msgData.data.payload),
      };
      const status = classifyEmailStatus(email);

      return {
        ...email,
        matchScore: scoreEmailAgainstApplication(email, jobContext),
        ...status,
      } satisfies ScannedEmail;
    })
  );

  const rankedMessages = messages
    .filter((message) => message.matchScore >= 45)
    .sort((left, right) => {
      const rightTime = Date.parse(right.date || '');
      const leftTime = Date.parse(left.date || '');
      return (Number.isNaN(rightTime) ? 0 : rightTime) - (Number.isNaN(leftTime) ? 0 : leftTime);
    });

  const statusInference = inferStatusFromEmails(targetApp.currentStatus as ApplicationStatus, rankedMessages);
  const statusUpdate = shouldSyncStatus && statusInference.nextStatus
    ? await updateApplicationStatus(userId, applicationId, {
      status: statusInference.nextStatus,
      evidenceNotes: `Email scan: ${statusInference.reason ?? 'status signal found'}`,
    })
    : null;

  return {
    status: 200,
    body: {
      emails: rankedMessages,
      search: {
        provider: 'gmail',
        query: searchQuery,
        matchedCount: rankedMessages.length,
      },
      statusUpdate: statusInference,
      application: statusUpdate,
    },
  };
}

// POST /api/applications/:id/email-scan
app.post('/api/applications/:id/email-scan', async (req, res) => {
  const applicationId = req.params.id;
  const userId = getUserIdFromAuthHeader(req.headers.authorization);

  try {
    const result = await scanApplicationGmail(applicationId, userId, req.body?.syncStatus !== false);
    res.status(result.status).json(result.body);
  } catch (error) {
    console.error("Gmail fetch error:", error);
    if (isExpiredGoogleAuthorization(error)) {
      res.status(401).json({ error: GMAIL_RECONNECT_MESSAGE, code: 'gmail_reauthorization_required' });
      return;
    }
    if (isMissingGmailReadPermission(error)) {
      res.status(403).json({ error: GMAIL_PERMISSION_MESSAGE, code: 'gmail_permission_required' });
      return;
    }
    res.status(500).json({ error: 'RoleMatch could not fetch Gmail messages. Try again, then reconnect Gmail from Profile if the problem continues.' });
  }
});

// GET /api/applications/:id/emails
app.get('/api/applications/:id/emails', async (req, res) => {
  const applicationId = req.params.id;
  const userId = getUserIdFromAuthHeader(req.headers.authorization);

  try {
    const result = await scanApplicationGmail(applicationId, userId, false);
    res.status(result.status).json(result.body);
  } catch (error) {
    console.error("Gmail fetch error:", error);
    if (isExpiredGoogleAuthorization(error)) {
      res.status(401).json({ error: GMAIL_RECONNECT_MESSAGE, code: 'gmail_reauthorization_required' });
      return;
    }
    if (isMissingGmailReadPermission(error)) {
      res.status(403).json({ error: GMAIL_PERMISSION_MESSAGE, code: 'gmail_permission_required' });
      return;
    }
    res.status(500).json({ error: 'RoleMatch could not fetch Gmail messages. Try again, then reconnect Gmail from Profile if the problem continues.' });
  }
});

// DELETE /api/auth/google/disconnect
app.delete('/api/auth/google/disconnect', async (req, res) => {
  try {
    const userId = getUserIdFromAuthHeader(req.headers.authorization);

    // Delete the google provider row for this user
    await db.delete(userIntegrations)
        .where(
            and(
                eq(userIntegrations.userId, userId),
                eq(userIntegrations.provider, 'google')
            )
        );

    res.json({ message: "Gmail disconnected successfully" });
  } catch (error) {
    console.error("Disconnect error:", error);
    res.status(500).json({ error: "Failed to disconnect Gmail." });
  }
});

app.use((error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  if (error instanceof multer.MulterError) {
    res.status(400).json({ error: error.code === 'LIMIT_FILE_SIZE' ? 'Uploaded file is too large.' : error.message });
    return;
  }
  const message = error instanceof Error ? error.message : 'Unexpected server error.';
  console.error('Unhandled API error:', error);
  res.status(500).json({ error: runtimeConfig.nodeEnv === 'production' ? 'Unexpected server error.' : message });
});

export default app;
