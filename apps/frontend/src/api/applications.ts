import { API_BASE_URL, authHeaders, buildQuery, readJson } from './client';

export type ApplicationStatus = 'blocked' | 'in_progress' | 'interview' | 'offer' | 'rejected' | 'submitted';

export interface ApiApplication {
  id: string;
  jobId: string;
  title: string;
  company: string;
  source: string;
  status: ApplicationStatus;
  matchScore: number | null;
  submittedAt: string | null;
  lastUpdate: string | null;
  nextStep: string;
  blocker: string | null;
  jobUrl: string;
}

export interface CreateApplicationInput {
  jobId?: string;
  title?: string;
  company?: string;
  source?: string;
  jobUrl?: string;
  location?: string;
  status?: ApplicationStatus;
  evidenceNotes?: string;
}

export async function getApplications(status?: ApplicationStatus | 'all'): Promise<ApiApplication[]> {
  const query = buildQuery({ status: status === 'all' ? undefined : status });
  const response = await fetch(`${API_BASE_URL}/api/applications?${query}`, {
    headers: authHeaders(),
  });
  const data = await readJson<{ applications: ApiApplication[] }>(response);

  return data.applications;
}

export async function createApplication(input: CreateApplicationInput): Promise<ApiApplication> {
  const response = await fetch(`${API_BASE_URL}/api/applications`, {
    method: 'POST',
    headers: {
      ...authHeaders(),
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(input),
  });
  const data = await readJson<{ application: ApiApplication }>(response);

  return data.application;
}

export async function updateApplicationStatus(id: string, status: ApplicationStatus): Promise<ApiApplication> {
  const response = await fetch(`${API_BASE_URL}/api/applications/${id}/status`, {
    method: 'PATCH',
    headers: {
      ...authHeaders(),
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ status }),
  });
  const data = await readJson<{ application: ApiApplication }>(response);

  return data.application;
}

export function formatApplicationDate(value: string | null) {
  if (!value) return 'Not recorded';

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Not recorded';

  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
  }).format(date);
}

export async function deleteApplication(id: string): Promise<boolean> {
  const response = await fetch(`${API_BASE_URL}/api/applications/${id}`, {
    method: 'DELETE',
    headers: authHeaders(),
  });
  if (!response.ok) {
    const data = await response.json().catch(() => null);
    throw new Error(data?.error ?? 'Failed to delete application');
  }
  return true;
}

export async function deleteApplicationByJobId(jobId: string): Promise<boolean> {
  const response = await fetch(`${API_BASE_URL}/api/applications/job/${jobId}`, {
    method: 'DELETE',
    headers: authHeaders(),
  });
  if (!response.ok) {
    const data = await response.json().catch(() => null);
    throw new Error(data?.error ?? 'Failed to delete application');
  }
  return true;
}

export interface ApiEmail {
  id: string;
  snippet: string;
  subject: string;
  from: string;
  date: string;
  bodyHtml: string;
  matchScore?: number;
  statusSignal?: ApplicationStatus | null;
  statusReason?: string | null;
}

export interface EmailScanResult {
  emails: ApiEmail[];
  search?: {
    provider: string;
    query: string;
    matchedCount: number;
  };
  statusUpdate?: {
    nextStatus: ApplicationStatus | null;
    reason: string | null;
    sourceEmailId?: string | null;
  };
  application?: ApiApplication | null;
}

export async function getApplicationEmails(id: string): Promise<ApiEmail[]> {
  const response = await fetch(`${API_BASE_URL}/api/applications/${id}/emails`, {
    headers: authHeaders(),
  });

  if (!response.ok) {
    const data = await response.json().catch(() => null);
    throw new Error(data?.error ?? 'Failed to fetch emails');
  }

  const data = await response.json();
  return data.emails;
}

export async function scanApplicationEmails(id: string): Promise<EmailScanResult> {
  const response = await fetch(`${API_BASE_URL}/api/applications/${id}/email-scan`, {
    method: 'POST',
    headers: {
      ...authHeaders(),
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ syncStatus: true }),
  });

  if (!response.ok) {
    const data = await response.json().catch(() => null);
    throw new Error(data?.error ?? 'Failed to scan emails');
  }

  return response.json();
}
