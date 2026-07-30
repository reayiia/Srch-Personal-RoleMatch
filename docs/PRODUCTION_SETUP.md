# Production setup

## 1. Deploy the application

RoleMatch needs three production services:

1. A managed PostgreSQL database.
2. A Node.js host for `apps/backend`.
3. A static host for the built `apps/frontend` application.

Set these backend variables on the host, not in source control:

```env
NODE_ENV=production
DATABASE_URL=postgresql://...
PORT=5000
FRONTEND_URL=https://app.example.com
BACKEND_PUBLIC_URL=https://api.example.com
CORS_ORIGINS=https://app.example.com,chrome-extension://your-published-extension-id
JWT_SECRET=<at least 32 random characters>
APP_ENCRYPTION_KEY=<base64 encoded 32-byte key>
```

Keep `APP_ENCRYPTION_KEY` stable. Losing or rotating it without a migration makes stored OAuth tokens and ATS passwords unreadable. Gmail users would need to reconnect, and saved ATS accounts would need to be re-entered.

Set `VITE_API_BASE_URL=https://api.example.com` when building the frontend. Run database migrations during release before starting the API.

## 2. Configure shared search providers

SerpAPI, Adzuna, and USAJobs keys belong on the backend deployment. End users do not create these keys. Provider quota and billing apply to the shared backend account, so add server-side usage monitoring before public launch.

Public ATS board adapters are separate from these providers and generally do not use your API keys.

## 3. Configure Gmail

In one Google Cloud project:

1. Enable the Gmail API.
2. Configure the OAuth consent screen.
3. Create a Web application OAuth client.
4. Add `https://api.example.com/api/auth/google/callback` as an exact authorized redirect URI.
5. Set the resulting client ID and secret as `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` on the backend.

The application requests `gmail.readonly` so it can match message content to applications. This is a restricted Gmail scope. A public launch requires Google's OAuth verification and can require a security assessment when restricted-scope data is transmitted to or stored by the backend. Testing mode is suitable only for explicitly allowlisted test users.

RoleMatch encrypts access and refresh tokens with AES-256-GCM before database storage. OAuth state is signed and expires after ten minutes.

End users do not create a Google Cloud project or paste Google API credentials into RoleMatch. They select **Connect Gmail**, sign into Google, and grant access to the deployment owner's verified OAuth application.

## 4. LinkedIn boundary

LinkedIn OpenID Connect can provide a lite identity profile: name, profile picture, and sometimes email. It does not provide a user's complete work history, projects, courses, or resume through the standard self-service sign-in product. RoleMatch therefore imports those fields from the user's resume and treats the LinkedIn URL as a profile link unless separate approved LinkedIn partner access is obtained.

## 5. Publish the Chrome extension

1. Add the production frontend and backend origins to `host_permissions` and the RoleMatch bridge match list in `apps/extension/manifest.json`.
2. Increase the manifest version.
3. Test the unpacked production build against non-submitting test forms.
4. Register a Chrome Web Store developer account, prepare store assets and privacy disclosures, upload a ZIP of `apps/extension`, and submit it for review.

The extension must disclose its site access, profile-data use, and automatic-submission option. Keep automatic final submission off by default.

End users install the extension, sign into the hosted RoleMatch site, and select **Connect extension** once. Autofill does not require a user-supplied API key. Build the published manifest with the deployed frontend/backend origins, and include the published `chrome-extension://` ID in backend `CORS_ORIGINS`.

## 6. ATS account vault

Users may optionally save an ATS username and password under **Profile > ATS accounts**. Passwords are AES-256-GCM encrypted with `APP_ENCRYPTION_KEY`; the profile API returns metadata only. The extension requests a password only from an ATS login page with the same exact HTTPS origin, uses it for that page, and does not write it to Chrome extension storage.

Use HTTPS for both the frontend and backend in production. Restrict database and encryption-key access, redact request bodies from logs and observability tools, and include the credential behavior in privacy and data-handling disclosures. Chrome Password Manager remains available as a fallback for users who do not want RoleMatch to store ATS credentials.

## 7. Verification gates

RoleMatch does not bypass CAPTCHA. OTP means one-time password, usually a temporary code sent by email, text, or an authenticator. A saved ATS account or Chrome Password Manager can fill a normal login. CAPTCHA, OTP, unfamiliar verification, and explicit consent remain user-controlled gates; the extension observes the updated page and can resume afterward.
