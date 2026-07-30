export const GMAIL_RECONNECT_MESSAGE = 'Gmail authorization expired or was revoked. Reconnect Gmail from Profile, then run Check inbox again.';
export const GMAIL_PERMISSION_MESSAGE = 'Gmail read permission was not granted. Reconnect Gmail from Profile and approve the requested Gmail read access, then run Check inbox again.';
export const GMAIL_READONLY_SCOPE = 'https://www.googleapis.com/auth/gmail.readonly';

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' ? value as Record<string, unknown> : null;
}

export function isExpiredGoogleAuthorization(error: unknown) {
  const errorRecord = asRecord(error);
  const response = asRecord(errorRecord?.response);
  const responseData = asRecord(response?.data);
  const errorCode = String(responseData?.error ?? errorRecord?.code ?? '').toLowerCase();
  const description = [
    errorRecord?.message,
    responseData?.error_description,
  ]
    .map((value) => String(value ?? '').toLowerCase())
    .join(' ');

  return errorCode === 'invalid_grant'
    || description.includes('invalid_grant')
    || description.includes('token has been expired or revoked')
    || description.includes('no refresh token is set');
}

export function isMissingGmailReadPermission(error: unknown) {
  const errorRecord = asRecord(error);
  const response = asRecord(errorRecord?.response);
  const responseData = asRecord(response?.data);
  const responseError = asRecord(responseData?.error);
  const details = JSON.stringify(responseData ?? {}).toLowerCase();
  const description = [
    errorRecord?.code,
    errorRecord?.message,
    responseError?.message,
    responseError?.status,
    details,
  ]
    .map((value) => String(value ?? '').toLowerCase())
    .join(' ');

  return description.includes('gmail_scope_missing')
    || description.includes('insufficient authentication scopes')
    || description.includes('insufficient permission')
    || description.includes('access_token_scope_insufficient');
}
