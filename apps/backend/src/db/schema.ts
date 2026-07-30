import { boolean, integer, jsonb, pgTable, uniqueIndex, uuid, varchar, text, timestamp, date } from 'drizzle-orm/pg-core';

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

// 1. Users Identity Table (Matches Auth Design)
export const users = pgTable('users', {
  id: uuid('id').defaultRandom().primaryKey(),
  email: varchar('email', { length: 255 }).notNull().unique(),
  passwordHash: varchar('password_hash', { length: 255 }).notNull(),
  authProvider: varchar('auth_provider', { length: 50 }).notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  lastLoginAt: timestamp('last_login_at'),
});

// 2. Job Postings Table (Normalized Data gathered from Scrapers)
export const jobPostings = pgTable('job_postings', {
  id: uuid('id').defaultRandom().primaryKey(),
  source: varchar('source', { length: 100 }).notNull(), // Greenhouse, Lever, etc.
  externalId: varchar('external_id', { length: 255 }),
  company: varchar('company', { length: 255 }).notNull(),
  title: varchar('title', { length: 255 }).notNull(),
  normalizedTitle: varchar('normalized_title', { length: 255 }),
  location: varchar('location', { length: 255 }).notNull(),
  remote: boolean('remote').default(false).notNull(),
  employmentType: varchar('employment_type', { length: 100 }),
  experienceLevel: varchar('experience_level', { length: 100 }),
  salaryRange: varchar('salary_range', { length: 100 }),
  salaryMin: integer('salary_min'),
  salaryMax: integer('salary_max'),
  currency: varchar('currency', { length: 10 }),
  jobUrl: text('job_url').notNull(),
  description: text('description').notNull(),
  requirements: text('requirements').array(),
  tags: text('tags').array(),
  status: varchar('status', { length: 50 }).default('active').notNull(),
  postedAt: timestamp('posted_at'),
  lastSeenAt: timestamp('last_seen_at').defaultNow().notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (table) => ({
  jobUrlUnique: uniqueIndex('job_postings_job_url_unique').on(table.jobUrl),
}));

// 3. Applications Tracker Table (The center of RoleMatch)
export const applications = pgTable('applications', {
  id: uuid('id').defaultRandom().primaryKey(),
  userId: uuid('user_id').references(() => users.id, { onDelete: 'cascade' }).notNull(),
  jobId: uuid('job_id').references(() => jobPostings.id).notNull(),
  status: varchar('status', { length: 50 }).default('in_progress').notNull(),
  submittedAt: timestamp('submitted_at'),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
  evidenceNotes: text('evidence_notes'),
});

// 4. Per-user saved jobs. A saved job is not an application until the user chooses to apply.
export const savedJobs = pgTable('saved_jobs', {
  id: uuid('id').defaultRandom().primaryKey(),
  userId: uuid('user_id').references(() => users.id, { onDelete: 'cascade' }).notNull(),
  jobId: uuid('job_id').references(() => jobPostings.id, { onDelete: 'cascade' }).notNull(),
  savedAt: timestamp('saved_at').defaultNow().notNull(),
}, (table) => ({
  userJobUnique: uniqueIndex('saved_jobs_user_id_job_id_unique').on(table.userId, table.jobId),
}));

// 5. User Profiles Table
export const profiles = pgTable('profiles', {
  id: uuid('id').defaultRandom().primaryKey(),
  userId: uuid('user_id').references(() => users.id, { onDelete: 'cascade' }).notNull(),
  fullName: varchar('full_name', { length: 255 }).notNull(),
  dateOfBirth: date('date_of_birth'),
  phone: varchar('phone', { length: 100 }),
  location: varchar('location', { length: 255 }),
  education: text('education'),
  workExperience: text('work_experience'),
  linkedinUrl: text('linkedin_url'),
  githubUrl: text('github_url'),
  portfolioUrl: text('portfolio_url'),
  indeedUrl: text('indeed_url'),
  gender: varchar('gender', { length: 50 }),
  race: varchar('race', { length: 100 }),
  veteranStatus: varchar('veteran_status', { length: 100 }),
  disabilityStatus: varchar('disability_status', { length: 100 }),
  workAuthorization: text('work_authorization'),
  resumeUrl: text('resume_url'),
  avatarUrl: text('avatar_url'),

  // Existing system fields
  major: varchar('major', { length: 255 }),
  bio: text('bio'),
  skills: text('skills').array(),
  targetRoles: text('target_roles').array(),
  relevantCourses: text('relevant_courses').array(),
  preferredLocations: text('preferred_locations').array(),
  salaryMinimum: varchar('salary_minimum', { length: 50 }),
  portfolioLinks: text('portfolio_links').array(),
  educationHistory: jsonb('education_history').$type<EducationEntry[]>(),
  workHistory: jsonb('work_history').$type<WorkHistoryEntry[]>(),
  projectHistory: jsonb('project_history').$type<ProjectEntry[]>(),
  certifications: jsonb('certifications').$type<CertificationEntry[]>(),
  autofillAnswers: jsonb('autofill_answers').$type<AutofillAnswers>(),
});

export const profileDocuments = pgTable('profile_documents', {
  id: uuid('id').defaultRandom().primaryKey(),
  userId: uuid('user_id').references(() => users.id, { onDelete: 'cascade' }).notNull(),
  label: varchar('label', { length: 255 }).notNull(),
  documentType: varchar('document_type', { length: 80 }).notNull(),
  fileName: varchar('file_name', { length: 255 }).notNull(),
  fileUrl: text('file_url').notNull(),
  mimeType: varchar('mime_type', { length: 150 }),
  uploadedAt: timestamp('uploaded_at').defaultNow().notNull(),
});

export const atsCredentials = pgTable('ats_credentials', {
  id: uuid('id').defaultRandom().primaryKey(),
  userId: uuid('user_id').references(() => users.id, { onDelete: 'cascade' }).notNull(),
  label: varchar('label', { length: 255 }).notNull(),
  provider: varchar('provider', { length: 80 }).notNull(),
  origin: text('origin').notNull(),
  username: varchar('username', { length: 255 }).notNull(),
  encryptedPassword: text('encrypted_password').notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (table) => ({
  userOriginUnique: uniqueIndex('ats_credentials_user_origin_unique').on(table.userId, table.origin),
}));

export const userIntegrations = pgTable('user_integrations', {
  id: uuid('id').defaultRandom().primaryKey(),
  userId: uuid('user_id').references(() => users.id, { onDelete: 'cascade' }).notNull(),
  provider: varchar('provider', { length: 50 }).notNull(), // e.g., 'google'
  accessToken: text('access_token').notNull(),
  refreshToken: text('refresh_token'),
  expiresAt: timestamp('expires_at'),
  email: varchar('email', { length: 255 }), // The connected gmail address
}, (table) => ({
  userProviderUnique: uniqueIndex('user_integrations_provider_unique').on(table.userId, table.provider),
}));
