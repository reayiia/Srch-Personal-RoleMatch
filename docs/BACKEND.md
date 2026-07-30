# Backend, database, and configuration overview

## Runtime

`apps/backend` is an Express 5 and TypeScript service. `src/server.ts` validates configuration, initializes the application, and listens on the configured port. `src/app.ts` defines HTTP routes and middleware. Drizzle ORM provides typed PostgreSQL access and versioned SQL migrations under `src/db/migrations`.

Core responsibilities:

- Account registration/login and JWT authentication
- Profile, resume/document, and ATS-account management
- Live job-provider orchestration, normalization, deduplication, filtering, and SSE progress
- Profile-based job match scoring
- Saved-job and application-status persistence
- Gmail OAuth, message matching, and application evidence
- Exact-origin decryption service for extension login continuation

## API surface

| Route group | Purpose |
| --- | --- |
| `/api/auth/register`, `/api/auth/login` | Local account identity |
| `/api/profile`, `/api/profile/onboarding` | Profile read/update and onboarding |
| `/api/profile/resume/parse`, `/api/profile/documents` | Resume parsing and application-material uploads |
| `/api/profile/autofill/custom` | Save learned custom answers |
| `/api/profile/ats-credentials` | Create, update, list metadata, or delete encrypted ATS accounts |
| `/api/extension/ats-credentials/resolve` | Resolve one exact-origin credential for an authenticated extension request |
| `/api/jobs/search`, `/api/jobs/search/stream` | Aggregate normalized jobs, synchronously or progressively |
| `/api/jobs/saved`, `/api/jobs/:jobId/save` | User-owned saved jobs |
| `/api/applications` and status/delete routes | Tracker records and state changes |
| `/api/auth/google`, `/api/auth/google/callback` | Gmail OAuth connection |
| `/api/applications/:id/email-scan`, `/emails` | On-demand message matching and evidence retrieval |

## Database layout

| Table | Ownership and purpose |
| --- | --- |
| `users` | Account identity, password hash, provider, and timestamps |
| `profiles` | Reusable contact, education, experience, project, skill, preference, and autofill data |
| `profile_documents` | User-owned resume, cover-letter, and supporting-document metadata |
| `job_postings` | Normalized provider results keyed by unique job URL |
| `saved_jobs` | Per-user bookmark relation; intentionally separate from applications |
| `applications` | User/job tracker relation, status, submission time, and evidence notes |
| `user_integrations` | Encrypted Gmail access/refresh tokens and provider metadata |
| `ats_credentials` | Exact-origin username and AES-256-GCM encrypted password |

Migrations are the authoritative layout history. Run `npm run db:migrate` after configuring the database. `npm run db:reset --workspace=apps/backend` is destructive and is intended only for an explicitly disposable local database.

## Configuration

`apps/backend/.env.example` documents every supported variable. Required local values are:

| Variable | Use |
| --- | --- |
| `DATABASE_URL` | PostgreSQL connection |
| `JWT_SECRET` | Token signing, at least 32 characters |
| `APP_ENCRYPTION_KEY` | Base64-encoded 32-byte key for OAuth tokens and ATS passwords |
| `FRONTEND_URL`, `BACKEND_PUBLIC_URL`, `CORS_ORIGINS` | Browser, callback, and extension boundaries |

`npm run setup:env` creates missing development secrets without printing them. Optional `SERPAPI_*`, `ADZUNA_*`, and `USAJOBS_*` values enable keyed job providers. `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` enable Gmail. Public ATS board adapters use the committed registry by default and do not require per-user keys.

Other relevant configuration files:

- `drizzle.config.ts`: migration and schema paths
- `src/config.ts`: validated runtime values and CORS origins
- `src/jobs/atsRegistry.ts`: default public ATS board registry
- `apps/frontend/vite.config.ts`: frontend build/dev settings
- `apps/extension/manifest.json`: Chrome permissions, scripts, and supported URL patterns

## Verification harnesses

```powershell
npm run check:env
npm run test:email-scan --workspace=apps/backend
npm run test:jobs --workspace=apps/backend
npm run test:resume-parser --workspace=apps/backend
npm run test:security --workspace=apps/backend
```

These deterministic harnesses cover message classification, job normalization/filtering/matching, resume extraction, secret encryption/decryption, and credential origin/ownership rules. Live provider availability remains external and can change independently of a passing local harness.
