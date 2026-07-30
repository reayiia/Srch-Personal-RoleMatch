# RoleMatch

RoleMatch is a full-stack job search, profile, application tracking, email matching, and ATS autofill tool. The monorepo contains a React/Vite frontend, an Express/PostgreSQL backend, and a Chrome extension.

RoleMatch began as a collaborative senior project. This repository is Abraham Reay II's maintained portfolio edition and contains continued work beyond the shared course version. See [CONTRIBUTORS.md](CONTRIBUTORS.md) for project attribution.

## Documentation

- [Final design](docs/FINAL_DESIGN.md)
- [Backend and database](docs/BACKEND.md)
- [Frontend and extension](docs/FRONTEND.md)
- [Project outcomes and limitations](docs/PROJECT_OUTCOMES.md)
- [Production setup](docs/PRODUCTION_SETUP.md)

## Local setup

Prerequisites:

- Node.js 20.19 or newer
- PostgreSQL 15 or newer
- Chrome for extension testing

From the repository root:

```powershell
npm install
npm run setup:env
```

Open `apps/backend/.env` and set `DATABASE_URL`. Optional search and Gmail provider variables are listed in `apps/backend/.env.example`. Then validate and migrate:

```powershell
npm run check:env
npm run db:migrate
```

Run the backend and frontend together:

```powershell
npm run dev
```

Open [http://localhost:5173](http://localhost:5173). Press `Ctrl+C` in that terminal once to stop both servers. The separate `npm run dev:backend` and `npm run dev:frontend` commands remain available for debugging.

## Environment model

`apps/backend/.env` is local and must never be committed. `npm run setup:env` creates missing JWT and encryption secrets without printing them.

| Category | Variables | Who configures it |
| --- | --- | --- |
| Infrastructure | `DATABASE_URL`, `FRONTEND_URL`, `BACKEND_PUBLIC_URL`, `CORS_ORIGINS` | Each local developer, or once on the deployed backend |
| Security | `JWT_SECRET`, `APP_ENCRYPTION_KEY` | Each local developer, or once on the deployed backend |
| Gmail OAuth client | `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | Once per deployed backend; users authorize their own Gmail accounts |
| Search providers | SerpAPI, Adzuna, USAJobs variables | Once per deployed backend; all users consume that deployment's quota |
| ATS board adapters | Greenhouse, Lever, Ashby, Workday, and other board registries | No API key for public board endpoints |

Never place backend secrets in `VITE_*` variables or extension source. Frontend variables and extension files are visible to users.

## Resume onboarding

New accounts can import PDF, DOCX, or TXT resumes. RoleMatch extracts contact details, education, work history, projects, courses, and skills into an editable review flow. Related skills are suggestions only. The importer does not infer age, protected characteristics, or credentials that are not explicitly present.

Scanned image-only PDFs require OCR before import.

## Chrome extension

1. Open `chrome://extensions`.
2. Enable Developer mode.
3. Select **Load unpacked** and choose `apps/extension`.
4. Log in to RoleMatch and select **Connect extension** from Saved jobs or Application tracker.

The side panel controls pause/resume, completion confirmations, automatic multi-step advancement, ATS-login continuation, and automatic final submission. Login continuation, step advancement, and automatic submission are off by default. Step advancement only selects one unambiguous Next, Continue, or Save and Continue control after the visible step is complete. Automatic submission additionally requires RoleMatch job context and one final submit control. Both stop for incomplete required fields, CAPTCHA, one-time codes, login, or explicit consent gates.

For ATS logins, users can either rely on Chrome Password Manager or save an account under **Profile > ATS accounts**. RoleMatch encrypts saved passwords on the backend and resolves one only when the extension is on that account's exact login origin. Enable **Use saved ATS account and continue login** in the extension side panel to use this behavior. Passwords are not returned by the normal profile API or persisted in Chrome extension storage.

## Deployed end-user setup

An ordinary user of a hosted RoleMatch installation does not create SerpAPI, Adzuna, USAJobs, or Google developer credentials. The deployment owner configures those shared services once. A user only needs to:

1. Create a RoleMatch account and import or complete a profile.
2. Select **Connect Gmail** and approve Google's consent screen if email tracking is wanted.
3. Install the RoleMatch extension and select **Connect extension** while signed into the same RoleMatch account.
4. Optionally save ATS accounts in the profile and opt into login continuation or automatic submission in the extension side panel.

Autofill itself does not use a third-party API key. Public ATS board searches also do not require a key from each user.

## Verification

```powershell
npm run check:public
npm run check:env
npm run test:email-scan --workspace=apps/backend
npm run test:jobs --workspace=apps/backend
npm run test:resume-parser --workspace=apps/backend
npm run test:security --workspace=apps/backend
npm run build --workspace=apps/frontend
node apps/extension/scripts/autofill-harness.mjs
```

See [docs/PRODUCTION_SETUP.md](docs/PRODUCTION_SETUP.md) before deploying or publishing the extension.
