# Frontend and extension overview

## Web client

`apps/frontend` is a React 19 and TypeScript single-page application built with Vite. `App.tsx` defines authenticated routes and `AppShell.tsx` owns the persistent navigation, theme controls, and logout confirmation.

| Area | Main files | Behavior |
| --- | --- | --- |
| Authentication and onboarding | `Auth.tsx`, `components/onboarding/*` | Registration, login, resume import, editable parsed profile review, and related-skill suggestions |
| Dashboard | `pages/DashboardPage.tsx` | Application summaries and explicit profile-based job-search launch |
| Job search | `pages/JobSearchPage.tsx`, `api/jobs.ts` | Multi-source filters, global location selection, proximity, live SSE progress, result cards, saving, tracking, and match explanations |
| Saved jobs | `pages/SavedJobsPage.tsx` | User-owned bookmarks, sorting, extension connection, and application launch |
| Application tracker | `pages/ApplicationsPage.tsx` | Compact tracked-job rows, manual status changes, source URL retention, Gmail checks, and extension launch |
| Profile | `pages/ProfilePage.tsx`, `components/profile/*` | Profile sections, documents, custom answers, linked accounts, and encrypted ATS-account metadata |

API requests are centralized under `src/api`. The bearer token is attached by `api/client.ts`; domain modules handle jobs, applications, locations, and profiles. The selected light/dark theme is retained in local storage, while user-owned records live in PostgreSQL.

## Browser extension

`apps/extension` is an unpacked/publishable Manifest V3 Chrome extension. Its service worker preserves application context, communicates with RoleMatch, and coordinates content scripts. The injected side panel previews detected fields and their intended answers before or after a fill run.

The extension supports visible-field autofill for:

- Greenhouse, Lever, Ashby, and Workday
- SmartRecruiters, Recruitee, iCIMS, and Workable
- SAP SuccessFactors, Oracle Recruiting Cloud, and Taleo
- UKG Pro Recruiting and Dayforce

Important controls are exposed in the extension side panel:

- Pause or resume all extension activity.
- Fill visible fields.
- Show or hide completion confirmation.
- Optionally continue an exact-origin saved ATS login.
- Optionally advance one unambiguous completed step.
- Optionally select one unambiguous final submit control.

Login continuation, automatic advancement, and automatic submission are off by default. Each stops when required data is unresolved or a manual security/consent gate is present.

## Custom-answer matching

Profile answers use a stable intent, a primary label, alternate wordings, and optional short/long responses. The matcher evaluates aliases independently and favors the most specific unambiguous result. Choice controls use concise variants; open text fields use longer variants. Conflicting answers remain manual instead of guessing.

## Build and validation

```powershell
npm run lint --workspace=apps/frontend
npm run build --workspace=apps/frontend
npm run validate --workspace=apps/extension
npm run test:autofill --workspace=apps/extension
```

The extension harness uses non-submitting fixtures to validate provider detection, field matching, multi-step guards, status context, and sensitive-field exclusions without creating real applications.
