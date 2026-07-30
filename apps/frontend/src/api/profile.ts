import { API_BASE_URL, authHeaders, readJson } from './client';

export interface EducationEntry {
  school: string;
  degree: string;
  field: string;
  location?: string;
  startDate?: string;
  endDate?: string;
  gpa?: string;
  notes?: string;
  courses?: string[];
}

export interface WorkHistoryEntry {
  company: string;
  title: string;
  location?: string;
  startDate?: string;
  endDate?: string;
  current?: boolean;
  highlights?: string[];
  skills?: string[];
}

export interface ProjectEntry {
  name: string;
  role?: string;
  url?: string;
  description?: string;
  technologies?: string[];
}

export interface CertificationEntry {
  name: string;
  issuer?: string;
  issuedAt?: string;
  expiresAt?: string;
}

export interface CustomAutofillAnswer {
  intent?: string;
  label: string;
  aliases?: string[];
  keywords?: string;
  answer: string;
  shortAnswer?: string;
  longAnswer?: string;
}

export interface AutofillAnswers {
  authorizedToWork?: string;
  sponsorshipRequired?: string;
  veteranStatus?: string;
  disabilityStatus?: string;
  gender?: string;
  race?: string;
  yearsProfessionalExperience?: string;
  yearsSoftwareExperience?: string;
  yearsReactExperience?: string;
  yearsNodeExperience?: string;
  yearsPythonExperience?: string;
  willingToRelocate?: string;
  desiredSalary?: string;
  earliestStartDate?: string;
  custom?: CustomAutofillAnswer[];
}

export interface ProfileDocument {
  id: string;
  label: string;
  documentType: string;
  fileName: string;
  fileUrl: string;
  mimeType: string | null;
  uploadedAt: string;
}

export interface UserProfile {
  email?: string | null;
  fullName: string;
  dateOfBirth: string | null;
  phone: string | null;
  location: string | null;
  education: string | null;
  workExperience: string | null;
  linkedinUrl: string | null;
  githubUrl: string | null;
  portfolioUrl: string | null;
  indeedUrl: string | null;
  gender: string | null;
  race: string | null;
  veteranStatus: string | null;
  disabilityStatus: string | null;
  workAuthorization: string | null;
  skills: string[] | null;
  targetRoles: string[] | null;
  relevantCourses: string[] | null;
  preferredLocations: string[] | null;
  salaryMinimum: string | null;
  portfolioLinks: string[] | null;
  educationHistory: EducationEntry[] | null;
  workHistory: WorkHistoryEntry[] | null;
  projectHistory: ProjectEntry[] | null;
  certifications: CertificationEntry[] | null;
  autofillAnswers: AutofillAnswers | null;
  documents: ProfileDocument[];
  resumeUrl: string | null;
  avatarUrl: string | null;
  gmailEmail?: string | null;
  isGmailConnected?: boolean;
  gmailConnectionIssue?: string | null;
  stats?: {
    applications: number;
    saved: number;
    interviews: number;
  };
}

export interface UpdateProfileInput {
  fullName: string;
  dateOfBirth: string;
  phone: string;
  location: string;
  education: string;
  workExperience: string;
  linkedinUrl: string;
  githubUrl: string;
  portfolioUrl: string;
  indeedUrl: string;
  workAuthorization: string;
  veteranStatus: string;
  disabilityStatus: string;
  gender: string;
  race: string;
  salaryMinimum: string;
  skills: string[];
  targetRoles: string[];
  preferredLocations: string[];
  relevantCourses: string[];
  portfolioLinks: string[];
  educationHistory: EducationEntry[];
  workHistory: WorkHistoryEntry[];
  projectHistory: ProjectEntry[];
  certifications: CertificationEntry[];
  autofillAnswers: AutofillAnswers;
}

export interface ResumeProfileDraft {
  fullName?: string;
  email?: string;
  phone?: string;
  location?: string;
  linkedinUrl?: string;
  githubUrl?: string;
  portfolioUrl?: string;
  education?: string;
  workExperience?: string;
  skills: string[];
  relevantCourses: string[];
  educationHistory: EducationEntry[];
  workHistory: WorkHistoryEntry[];
  projectHistory: ProjectEntry[];
  certifications: CertificationEntry[];
}

export interface ResumeParseResult {
  draft: ResumeProfileDraft;
  suggestedSkills: string[];
  targetRoleSuggestions: string[];
  warnings: string[];
  source: {
    fileName: string;
    mimeType: string;
    characterCount: number;
  };
}

export interface AtsCredentialMetadata {
  id: string;
  label: string;
  provider: string;
  origin: string;
  username: string;
  hasPassword: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface AtsCredentialInput {
  label: string;
  provider: string;
  loginUrl: string;
  username: string;
  password: string;
}

export async function getProfile(): Promise<UserProfile> {
  const response = await fetch(`${API_BASE_URL}/api/profile`, {
    headers: authHeaders(),
  });

  return readJson<UserProfile>(response);
}

export async function updateProfile(input: UpdateProfileInput): Promise<UserProfile> {
  const response = await fetch(`${API_BASE_URL}/api/profile`, {
    method: 'PUT',
    headers: {
      ...authHeaders(),
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(input),
  });
  const data = await readJson<{ profile: UserProfile }>(response);

  return data.profile;
}

export async function uploadProfileDocument(file: File, documentType: string, label: string): Promise<ProfileDocument> {
  const body = new FormData();
  body.append('document', file);
  body.append('documentType', documentType);
  body.append('label', label || file.name);

  const response = await fetch(`${API_BASE_URL}/api/profile/documents`, {
    method: 'POST',
    headers: authHeaders(),
    body,
  });
  const data = await readJson<{ document: ProfileDocument }>(response);

  return data.document;
}

export async function uploadProfilePicture(file: File): Promise<string> {
  const body = new FormData();
  body.append('avatar', file);

  const response = await fetch(`${API_BASE_URL}/api/profile/avatar`, {
    method: 'POST',
    headers: authHeaders(),
    body,
  });

  const data = await readJson<{ avatarUrl: string }>(response);
  return data.avatarUrl;
}

export async function parseProfileResume(file: File): Promise<ResumeParseResult> {
  const body = new FormData();
  body.append('resume', file);

  const response = await fetch(`${API_BASE_URL}/api/profile/resume/parse`, {
    method: 'POST',
    headers: authHeaders(),
    body,
  });

  return readJson<ResumeParseResult>(response);
}

export async function suggestProfileSkills(skills: string[], query = ''): Promise<string[]> {
  const response = await fetch(`${API_BASE_URL}/api/profile/skills/suggest`, {
    method: 'POST',
    headers: {
      ...authHeaders(),
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ skills, query }),
  });
  const data = await readJson<{ suggestions: string[] }>(response);
  return data.suggestions;
}

export async function getAtsCredentials(): Promise<AtsCredentialMetadata[]> {
  const response = await fetch(`${API_BASE_URL}/api/profile/ats-credentials`, {
    headers: authHeaders(),
    cache: 'no-store',
  });
  const data = await readJson<{ credentials: AtsCredentialMetadata[] }>(response);
  return data.credentials;
}

export async function createAtsCredential(input: AtsCredentialInput): Promise<AtsCredentialMetadata> {
  const response = await fetch(`${API_BASE_URL}/api/profile/ats-credentials`, {
    method: 'POST',
    headers: {
      ...authHeaders(),
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(input),
  });
  const data = await readJson<{ credential: AtsCredentialMetadata }>(response);
  return data.credential;
}

export async function updateAtsCredential(id: string, input: AtsCredentialInput): Promise<AtsCredentialMetadata> {
  const response = await fetch(`${API_BASE_URL}/api/profile/ats-credentials/${encodeURIComponent(id)}`, {
    method: 'PUT',
    headers: {
      ...authHeaders(),
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(input),
  });
  const data = await readJson<{ credential: AtsCredentialMetadata }>(response);
  return data.credential;
}

export async function deleteAtsCredential(id: string): Promise<void> {
  const response = await fetch(`${API_BASE_URL}/api/profile/ats-credentials/${encodeURIComponent(id)}`, {
    method: 'DELETE',
    headers: authHeaders(),
  });
  if (!response.ok) await readJson<never>(response);
}

export async function openProfileDocument(document: ProfileDocument): Promise<void> {
  const opened = window.open('', '_blank');
  if (!opened) {
    throw new Error('Allow pop-ups to open this document.');
  }
  opened.opener = null;

  try {
    const response = await fetch(`${API_BASE_URL}${document.fileUrl}`, {
      headers: authHeaders(),
    });
    if (!response.ok) {
      await readJson<never>(response);
      return;
    }

    const objectUrl = URL.createObjectURL(await response.blob());
    opened.location.href = objectUrl;
    window.setTimeout(() => URL.revokeObjectURL(objectUrl), 60_000);
  } catch (error) {
    opened.close();
    throw error;
  }
}
