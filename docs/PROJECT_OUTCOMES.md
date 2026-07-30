# Project outcomes, notes, and limitations

## Goal results

| Final goal | Result | Evidence |
| --- | --- | --- |
| Create and edit a reusable job-seeker profile | Met | Registration, resume import/review, profile sections, documents, custom answers, and ATS accounts |
| Normalize live postings into one searchable list | Met | Keyed providers plus nine committed public ATS registry families, SSE progress, deduplication, and global location filters |
| Save, rank, and track selected jobs | Met | Per-user saved jobs, profile match scoring, original URLs, manual status control, and application records |
| Demonstrate selected application autofill | Exceeded course target | Extension support for 13 ATS families, custom-answer learning, pause/resume, and guarded optional multi-step/submission controls |
| Link employer email evidence to applications | Met for Gmail | OAuth connection, on-demand inbox scan, message classification, and application email display |
| Provide repeatable source, configuration, and tests | Met locally | Workspace scripts, `.env.example`, migrations, component documentation, and deterministic harnesses |
| Generate AI-tailored resumes, cover letters, and replies | Not implemented | Profile materials and autofill exist, but generative drafting was deferred beyond the final course build |
| Deploy a public production service | Not implemented | Local demonstration is repeatable; production and Chrome Web Store requirements are documented but not deployed |

## Interesting and unexpected findings

- **Public job access is fragmented.** Aggregators, government APIs, and ATS boards expose different fields and quotas. The adapter boundary and normalized job model were necessary to combine them without pretending every source is identical.
- **Location text is ambiguous.** City names can exist in multiple countries. RoleMatch resolves a selected global location to coordinates and applies proximity only to non-remote jobs.
- **Missing salary is not evidence of low salary.** A minimum-salary filter rejects only verified salaries below the threshold; unknown salaries remain visible.
- **ATS pages vary by employer even on the same platform.** Workday and other tenant-driven systems required platform rules plus employer-specific regression cases rather than one rigid selector map.
- **Application state can be lost across redirects.** The extension retains the original job URL/context through same-tab navigation and avoids duplicate tracker records.
- **Question wording varies more than intent.** Custom-answer aliases and short/long variants reduce duplicate answers while leaving equal-strength conflicts manual.
- **Gmail access has a deployment cost beyond code.** Public use of the restricted read-only scope requires Google verification and may require an external security assessment.

## Known limitations

- Live result quantity and latency depend on provider uptime, public board behavior, credentials, and quota.
- LinkedIn, Indeed, and Glassdoor are not scraped directly; Google Jobs and company ATS pages provide safer discovery paths.
- Gmail is the only implemented email provider. Outlook, iCloud, and Yahoo remain future work.
- Resume import supports text-bearing PDF, DOCX, and TXT. Image-only PDFs require OCR before upload.
- CAPTCHA, one-time codes, unfamiliar verification, explicit consent, and unresolved required questions remain manual.
- Automatic step advancement and submission rely on one unambiguous eligible control and are disabled by default.
- ATS credentials and Gmail tokens depend on a stable deployment encryption key; losing it makes encrypted values unreadable.
- The application has course-project testing and security controls, but public launch still requires hosted monitoring, backups, privacy disclosures, OAuth review, and Chrome Web Store review.

## Configuration and submission notes

- Commit `.env.example`; never commit `.env`, uploads, database files, API keys, OAuth secrets, or user documents.
- Keep migrations with the code so the database layout can be recreated.
- The final archive should include this repository plus the approved final design document, presentation/poster assets, progress reports, and other course records in clearly labeled folders.
- Validate the exact demo environment before presentation because live sources can change after a successful test run.
