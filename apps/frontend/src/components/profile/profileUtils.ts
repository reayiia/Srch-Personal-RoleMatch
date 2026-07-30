import { API_BASE_URL } from '../../api/client';
import type {
  AutofillAnswers,
  CertificationEntry,
  CustomAutofillAnswer,
  EducationEntry,
  ProfileDocument,
  ProjectEntry,
  UpdateProfileInput,
  UserProfile,
  WorkHistoryEntry,
} from '../../api/profile';

export function textToList(value: string) {
  return value.split(',').map((item) => item.trim()).filter(Boolean);
}

export function listToText(value?: string[] | null) {
  return (value ?? []).join(', ');
}

export function blankEducation(): EducationEntry {
  return { school: '', degree: '', field: '', location: '', startDate: '', endDate: '', gpa: '', notes: '', courses: [] };
}

export function blankWork(): WorkHistoryEntry {
  return { company: '', title: '', location: '', startDate: '', endDate: '', current: false, highlights: [], skills: [] };
}

export function blankProject(): ProjectEntry {
  return { name: '', role: '', url: '', description: '', technologies: [] };
}

export function blankCertification(): CertificationEntry {
  return { name: '', issuer: '', issuedAt: '', expiresAt: '' };
}

export function blankCustomAutofill(): CustomAutofillAnswer {
  return {
    intent: '',
    label: '',
    aliases: [],
    keywords: '',
    answer: '',
    shortAnswer: '',
    longAnswer: '',
  };
}

export function latestDocumentByType(documents: ProfileDocument[] | undefined, type: string) {
  return [...(documents ?? [])]
    .filter((document) => document.documentType === type)
    .sort((first, second) => Date.parse(second.uploadedAt) - Date.parse(first.uploadedAt))[0];
}

export function documentUrl(document?: ProfileDocument) {
  return document ? `${API_BASE_URL}${document.fileUrl}` : '';
}

export function hasContent(value?: string | null) {
  return Boolean(value?.trim());
}

export function compactProfileSubtitle(profile: UserProfile) {
  const role = profile.targetRoles?.find((item) => item.trim())?.trim();
  const location = profile.location?.trim();

  if (role && location) return `${role} - ${location}`;
  if (role) return role;
  if (location) return location;

  return 'Add target role and location';
}

export function profileToForm(profile: UserProfile): UpdateProfileInput {
  return {
    fullName: profile.fullName ?? '',
    dateOfBirth: profile.dateOfBirth ?? '',
    phone: profile.phone ?? '',
    location: profile.location ?? '',
    education: profile.education ?? '',
    workExperience: profile.workExperience ?? '',
    linkedinUrl: profile.linkedinUrl ?? '',
    githubUrl: profile.githubUrl ?? '',
    portfolioUrl: profile.portfolioUrl ?? '',
    indeedUrl: profile.indeedUrl ?? '',
    workAuthorization: profile.workAuthorization ?? '',
    veteranStatus: profile.veteranStatus ?? '',
    disabilityStatus: profile.disabilityStatus ?? '',
    gender: profile.gender ?? '',
    race: profile.race ?? '',
    salaryMinimum: profile.salaryMinimum ?? '',
    skills: profile.skills ?? [],
    targetRoles: profile.targetRoles ?? [],
    preferredLocations: profile.preferredLocations ?? [],
    relevantCourses: profile.relevantCourses ?? [],
    portfolioLinks: profile.portfolioLinks ?? [],
    educationHistory: profile.educationHistory?.length ? profile.educationHistory : [blankEducation()],
    workHistory: profile.workHistory?.length ? profile.workHistory : [blankWork()],
    projectHistory: profile.projectHistory?.length ? profile.projectHistory : [blankProject()],
    certifications: profile.certifications?.length ? profile.certifications : [blankCertification()],
    autofillAnswers: {
      ...(profile.autofillAnswers ?? {}),
      custom: profile.autofillAnswers?.custom ?? [],
    },
  };
}

export type ScalarAutofillKey = Exclude<keyof AutofillAnswers, 'custom'>;
