const PROVIDER_PATTERNS: Array<[string, RegExp]> = [
  ['Greenhouse', /greenhouse\.io$/i],
  ['Lever', /lever\.co$/i],
  ['Ashby', /ashbyhq\.com$/i],
  ['Workday', /(?:myworkdayjobs|workdayjobs)\.com$/i],
  ['SmartRecruiters', /smartrecruiters\.com$/i],
  ['Recruitee', /recruitee\.com$/i],
  ['iCIMS', /icims\.com$/i],
  ['Workable', /workable\.com$/i],
  ['SAP SuccessFactors', /(?:successfactors\.(?:com|eu|cn)|hcm\.ondemand\.com)$/i],
  ['Oracle Recruiting', /oraclecloud\.com$/i],
  ['Taleo', /taleo\.net$/i],
  ['UKG Pro Recruiting', /ultipro\.com$/i],
  ['Dayforce', /dayforcehcm\.com$/i],
];

function parsedCredentialUrl(value: string) {
  const trimmed = value.trim();
  if (!trimmed) throw new Error('ATS login URL is required.');

  const withProtocol = /^[a-z][a-z\d+.-]*:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  let url: URL;
  try {
    url = new URL(withProtocol);
  } catch {
    throw new Error('Enter a valid ATS login URL.');
  }

  if (url.username || url.password) {
    throw new Error('Do not include credentials inside the ATS login URL.');
  }
  const localDevelopment = ['localhost', '127.0.0.1', '::1'].includes(url.hostname);
  if (url.protocol !== 'https:' && !(localDevelopment && url.protocol === 'http:')) {
    throw new Error('ATS login URLs must use HTTPS.');
  }

  return url;
}

export function normalizeCredentialOrigin(value: string) {
  return parsedCredentialUrl(value).origin.toLowerCase();
}

export function inferCredentialProvider(value: string) {
  const hostname = parsedCredentialUrl(value).hostname.toLowerCase();
  return PROVIDER_PATTERNS.find(([, pattern]) => pattern.test(hostname))?.[0] ?? 'Other ATS';
}

export function cleanCredentialProvider(value: unknown, origin: string) {
  const provider = String(value ?? '').replace(/\s+/g, ' ').trim();
  return (provider || inferCredentialProvider(origin)).slice(0, 80);
}

export function cleanCredentialLabel(value: unknown, provider: string) {
  const label = String(value ?? '').replace(/\s+/g, ' ').trim();
  return (label || `${provider} account`).slice(0, 255);
}

export function cleanCredentialUsername(value: unknown) {
  const username = String(value ?? '').trim();
  if (!username) throw new Error('ATS username or email is required.');
  if (username.length > 255) throw new Error('ATS username must be 255 characters or fewer.');
  return username;
}

export function cleanCredentialPassword(value: unknown) {
  const password = String(value ?? '');
  if (!password) throw new Error('ATS password is required.');
  if (password.length > 1024) throw new Error('ATS password is too long.');
  return password;
}
