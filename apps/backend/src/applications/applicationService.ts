import { and, desc, eq, type SQL } from 'drizzle-orm';
import { db } from '../db/index.js';
import { applications, jobPostings, profiles } from '../db/schema.js';
import { calculateProfileMatchScore, type ProfileMatchProfile } from '../jobs/profileMatch.js';
import type { JobSearchFilters, NormalizedJob } from '../jobs/types.js';

export type ApplicationStatus = 'blocked' | 'in_progress' | 'interview' | 'offer' | 'rejected' | 'submitted';
type JobPostingRow = typeof jobPostings.$inferSelect;

export interface ApiApplication {
  id: string;
  jobId: string;
  title: string;
  company: string;
  source: string;
  status: ApplicationStatus;
  matchScore: number | null;
  submittedAt: Date | null;
  lastUpdate: Date | null;
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

export interface UpdateApplicationStatusInput {
  status: ApplicationStatus;
  evidenceNotes?: string;
}

const statuses = new Set<ApplicationStatus>(['blocked', 'in_progress', 'interview', 'offer', 'rejected', 'submitted']);
const statusesAfterSubmission = new Set<ApplicationStatus>(['interview', 'offer', 'rejected', 'submitted']);

function rowToNormalizedJob(row: JobPostingRow): NormalizedJob {
  return {
    source: row.source,
    externalId: row.externalId ?? undefined,
    company: row.company,
    title: row.title,
    normalizedTitle: row.normalizedTitle ?? undefined,
    location: row.location,
    remote: row.remote,
    employmentType: row.employmentType ?? undefined,
    experienceLevel: row.experienceLevel ?? undefined,
    salaryRange: row.salaryRange ?? undefined,
    salaryMin: row.salaryMin ?? undefined,
    salaryMax: row.salaryMax ?? undefined,
    currency: row.currency ?? undefined,
    jobUrl: row.jobUrl,
    description: row.description,
    requirements: row.requirements ?? [],
    tags: row.tags ?? [],
    postedAt: row.postedAt ?? undefined,
  };
}

function applicationMatchScore(job: JobPostingRow, profile: ProfileMatchProfile | null) {
  const neutralFilters: JobSearchFilters = { limit: 200 };
  return calculateProfileMatchScore(rowToNormalizedJob(job), neutralFilters, profile);
}

async function getUserProfile(userId: string): Promise<ProfileMatchProfile | null> {
  const rows = await db.select().from(profiles).where(eq(profiles.userId, userId)).limit(1);
  return rows[0] ?? null;
}

function toApiApplication(
  application: typeof applications.$inferSelect,
  job: JobPostingRow,
  profile: ProfileMatchProfile | null,
): ApiApplication {
  return {
    id: application.id,
    jobId: application.jobId,
    title: job.title,
    company: job.company,
    source: job.source,
    status: application.status as ApplicationStatus,
    matchScore: applicationMatchScore(job, profile),
    submittedAt: application.submittedAt,
    lastUpdate: application.updatedAt,
    nextStep: application.status === 'blocked'
      ? 'Needs manual completion'
      : application.status === 'in_progress'
        ? 'Application opened'
        : 'Watch for email updates',
    blocker: application.status === 'blocked' ? application.evidenceNotes : null,
    jobUrl: job.jobUrl,
  };
}

function parseStatus(value?: ApplicationStatus) {
  return value && statuses.has(value) ? value : 'in_progress';
}

async function resolveJob(input: CreateApplicationInput): Promise<JobPostingRow> {
  if (input.jobId) {
    const existingJob = await db.select().from(jobPostings).where(eq(jobPostings.id, input.jobId)).limit(1);
    if (!existingJob[0]) {
      throw new Error('Job not found.');
    }

    return existingJob[0];
  }

  const title = input.title?.trim();
  const company = input.company?.trim();
  const jobUrl = input.jobUrl?.trim();

  if (!title || !company || !jobUrl) {
    throw new Error('Manual application records need a title, company, and job URL.');
  }

  const existingByUrl = await db.select().from(jobPostings).where(eq(jobPostings.jobUrl, jobUrl)).limit(1);
  if (existingByUrl[0]) {
    return existingByUrl[0];
  }

  const inserted = await db.insert(jobPostings).values({
    source: input.source?.trim() || 'Manual',
    externalId: jobUrl,
    company,
    title,
    normalizedTitle: title.toLowerCase(),
    location: input.location?.trim() || 'Not specified',
    remote: /\bremote\b/i.test(input.location ?? ''),
    employmentType: null,
    experienceLevel: null,
    salaryRange: null,
    salaryMin: null,
    salaryMax: null,
    currency: null,
    jobUrl,
    description: 'Manual application record created from RoleMatch tracker.',
    requirements: null,
    tags: null,
    status: 'active',
    lastSeenAt: new Date(),
  }).returning();

  if (!inserted[0]) {
    throw new Error('Failed to create manual job record.');
  }

  return inserted[0];
}

export async function listApplications(userId: string, status?: ApplicationStatus | undefined): Promise<ApiApplication[]> {
  const conditions: SQL[] = [eq(applications.userId, userId)];

  if (status) {
    conditions.push(eq(applications.status, status));
  }

  const [rows, profile] = await Promise.all([
    db.select({ application: applications, job: jobPostings })
      .from(applications)
      .innerJoin(jobPostings, eq(applications.jobId, jobPostings.id))
      .where(and(...conditions))
      .orderBy(desc(applications.updatedAt)),
    getUserProfile(userId),
  ]);

  return rows.map(({ application, job }) => toApiApplication(application, job, profile));
}

export async function createOrUpdateApplication(userId: string, input: CreateApplicationInput): Promise<ApiApplication> {
  const job = await resolveJob(input);
  const status = parseStatus(input.status);
  const profile = await getUserProfile(userId);
  const existing = await db.select()
    .from(applications)
    .where(and(eq(applications.userId, userId), eq(applications.jobId, job.id)))
    .limit(1);

  if (existing[0]) {
    const currentStatus = existing[0].status as ApplicationStatus;
    const nextStatus = status === 'in_progress' && statusesAfterSubmission.has(currentStatus)
      ? currentStatus
      : status;
    const updated = await db.update(applications)
      .set({
        status: nextStatus,
        submittedAt: statusesAfterSubmission.has(nextStatus) ? existing[0].submittedAt ?? new Date() : existing[0].submittedAt,
        updatedAt: new Date(),
        evidenceNotes: input.evidenceNotes?.trim() || existing[0].evidenceNotes,
      })
      .where(eq(applications.id, existing[0].id))
      .returning();

    return toApiApplication(updated[0] ?? existing[0], job, profile);
  }

  const inserted = await db.insert(applications).values({
    userId,
    jobId: job.id,
    status,
    submittedAt: statusesAfterSubmission.has(status) ? new Date() : null,
    updatedAt: new Date(),
    evidenceNotes: input.evidenceNotes?.trim() || null,
  }).returning();

  if (!inserted[0]) {
    throw new Error('Failed to create application record.');
  }

  return toApiApplication(inserted[0], job, profile);
}

export async function updateApplicationStatus(
  userId: string,
  applicationId: string,
  input: UpdateApplicationStatusInput,
): Promise<ApiApplication | null> {
  const status = parseStatus(input.status);
  const existing = await db.select({ application: applications, job: jobPostings })
    .from(applications)
    .innerJoin(jobPostings, eq(applications.jobId, jobPostings.id))
    .where(and(eq(applications.userId, userId), eq(applications.id, applicationId)))
    .limit(1);

  if (!existing[0]) return null;

  const profile = await getUserProfile(userId);
  const updated = await db.update(applications)
    .set({
      status,
      submittedAt: statusesAfterSubmission.has(status) ? existing[0].application.submittedAt ?? new Date() : existing[0].application.submittedAt,
      updatedAt: new Date(),
      evidenceNotes: input.evidenceNotes?.trim() || existing[0].application.evidenceNotes,
    })
    .where(eq(applications.id, applicationId))
    .returning();

  return toApiApplication(updated[0] ?? existing[0].application, existing[0].job, profile);
}

export async function deleteApplication(userId: string, applicationId: string): Promise<boolean> {
  const deleted = await db.delete(applications)
      .where(and(eq(applications.userId, userId), eq(applications.id, applicationId)))
      .returning();
  return deleted.length > 0;
}

export async function deleteApplicationByJobId(userId: string, jobId: string): Promise<boolean> {
  const deleted = await db.delete(applications)
      .where(and(eq(applications.userId, userId), eq(applications.jobId, jobId)))
      .returning();
  return deleted.length > 0;
}
