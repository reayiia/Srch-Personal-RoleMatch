import { and, desc, eq, gte, type SQL } from 'drizzle-orm';
import { db } from '../db/index.js';
import { jobPostings, savedJobs, applications, profiles } from '../db/schema.js';
import { matchesFilters, truncate } from './normalization.js';
import { calculateProfileMatchScore, type ProfileMatchProfile } from './profileMatch.js';
import { getSearchProviders } from './providers.js';
import type { JobProviderProgress, JobProviderResult, JobSearchFilters, NormalizedJob } from './types.js';

type JobPostingRow = typeof jobPostings.$inferSelect;
type ProfileRow = typeof profiles.$inferSelect;

export interface ApiJob {
  id: string;
  source: string;
  company: string;
  title: string;
  location: string;
  remote: boolean;
  employmentType: string | null;
  experienceLevel: string | null;
  salaryRange: string | null;
  salaryMin: number | null;
  salaryMax: number | null;
  currency: string | null;
  jobUrl: string;
  description: string;
  requirements: string[];
  tags: string[];
  postedAt: Date | null;
  matchScore: number;
  saved: boolean;
  isTracked?: boolean;
}

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

function toApiJob(
  row: JobPostingRow,
  filters: JobSearchFilters,
  savedJobIds: Set<string>,
  trackedJobIds: Set<string>,
  profile?: ProfileMatchProfile | null,
): ApiJob {
  return {
    id: row.id,
    source: row.source,
    company: row.company,
    title: row.title,
    location: row.location,
    remote: row.remote,
    employmentType: row.employmentType,
    experienceLevel: row.experienceLevel,
    salaryRange: row.salaryRange,
    salaryMin: row.salaryMin,
    salaryMax: row.salaryMax,
    currency: row.currency,
    jobUrl: row.jobUrl,
    description: row.description,
    requirements: row.requirements ?? [],
    tags: row.tags ?? [],
    postedAt: row.postedAt,
    matchScore: calculateProfileMatchScore(rowToNormalizedJob(row), filters, profile),
    saved: savedJobIds.has(row.id),
    isTracked: trackedJobIds.has(row.id),
  };
}

async function saveNormalizedJob(job: NormalizedJob) {
  const existing = await db.select().from(jobPostings).where(eq(jobPostings.jobUrl, job.jobUrl)).limit(1);
  const values: typeof jobPostings.$inferInsert = {
    source: truncate(job.source, 100),
    externalId: job.externalId ? truncate(job.externalId, 255) : null,
    company: truncate(job.company, 255),
    title: truncate(job.title, 255),
    normalizedTitle: job.normalizedTitle ? truncate(job.normalizedTitle, 255) : null,
    location: truncate(job.location, 255),
    remote: job.remote,
    employmentType: job.employmentType ? truncate(job.employmentType, 100) : null,
    experienceLevel: job.experienceLevel ? truncate(job.experienceLevel, 100) : null,
    salaryRange: job.salaryRange ? truncate(job.salaryRange, 100) : null,
    salaryMin: nullableInteger(job.salaryMin),
    salaryMax: nullableInteger(job.salaryMax),
    currency: job.currency ? truncate(job.currency, 10) : null,
    jobUrl: job.jobUrl,
    description: job.description,
    requirements: job.requirements.length > 0 ? job.requirements : null,
    tags: job.tags.length > 0 ? job.tags : null,
    postedAt: job.postedAt ?? null,
    status: 'active',
    lastSeenAt: new Date(),
  };

  if (existing[0]) {
    const updated = await db.update(jobPostings)
      .set(values)
      .where(eq(jobPostings.id, existing[0].id))
      .returning();

    return updated[0] ?? existing[0];
  }

  const inserted = await db.insert(jobPostings).values(values).returning();
  if (!inserted[0]) {
    throw new Error('Failed to save normalized job.');
  }

  return inserted[0];
}

async function getSavedJobIds(userId: string) {
  const rows = await db.select({ jobId: savedJobs.jobId }).from(savedJobs).where(eq(savedJobs.userId, userId));
  return new Set(rows.map((row) => row.jobId));
}

async function getTrackedJobIds(userId: string) {
  const rows = await db.select({ jobId: applications.jobId }).from(applications).where(eq(applications.userId, userId));
  return new Set(rows.map((row) => row.jobId));
}

async function getUserProfile(userId: string): Promise<ProfileRow | null> {
  const rows = await db.select().from(profiles).where(eq(profiles.userId, userId)).limit(1);
  return rows[0] ?? null;
}

function nullableInteger(value?: number | null) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;

  return Math.round(value);
}

async function persistProviderJobs(
  result: JobProviderResult,
  filters: JobSearchFilters,
  userId: string,
  profile: ProfileMatchProfile | null,
  seenJobIds?: Set<string>,
) {
  const savedRows = (await Promise.all(result.jobs.map(saveNormalizedJob)))
    .filter((row): row is JobPostingRow => Boolean(row));
  const savedJobIds = await getSavedJobIds(userId);
  const trackedJobIds = await getTrackedJobIds(userId);
  const dedupedRows = Array.from(new Map(savedRows.filter(Boolean).map((row) => [row.id, row])).values())
    .filter((row) => {
      if (!seenJobIds) return true;
      if (seenJobIds.has(row.id)) return false;
      seenJobIds.add(row.id);
      return true;
    });

  return dedupedRows
    .map((row) => toApiJob(row, filters, savedJobIds, trackedJobIds, profile))
    .sort((first, second) => second.matchScore - first.matchScore);
}

function buildLocalWhere() {
  const conditions: SQL[] = [
    eq(jobPostings.status, 'active'),
    gte(jobPostings.lastSeenAt, new Date(Date.now() - (24 * 60 * 60 * 1000))),
  ];

  return and(...conditions);
}

async function loadCachedRows(filters: JobSearchFilters) {
  const candidateLimit = Math.min(5000, Math.max(1000, filters.limit * 10));
  const rows = await db.select()
    .from(jobPostings)
    .where(buildLocalWhere())
    .orderBy(desc(jobPostings.lastSeenAt))
    .limit(candidateLimit);

  return rows
    .filter((row) => matchesFilters(rowToNormalizedJob(row), filters))
    .slice(0, filters.limit);
}

export async function searchJobs(filters: JobSearchFilters, userId: string) {
  const providerResults: JobProviderResult[] = await Promise.all(
    getSearchProviders(filters).map(async (provider) => {
      try {
        return await provider.search(filters);
      } catch (error) {
        return {
          provider: provider.name,
          jobs: [],
          error: error instanceof Error ? error.message : 'Provider failed.',
        };
      }
    }),
  );

  const savedRows = (await Promise.all(providerResults.flatMap((result) => result.jobs).map(saveNormalizedJob)))
    .filter((row): row is JobPostingRow => Boolean(row));
  const savedJobIds = await getSavedJobIds(userId);
  const trackedJobIds = await getTrackedJobIds(userId);
  const profile = await getUserProfile(userId);

  const localRows = savedRows.length > 0 || !filters.includeCached
    ? savedRows
    : await loadCachedRows(filters);

  const dedupedRows = Array.from(new Map(localRows.filter(Boolean).map((row) => [row.id, row])).values());
  const jobs = dedupedRows
    .map((row) => toApiJob(row, filters, savedJobIds, trackedJobIds, profile))
    .sort((first, second) => second.matchScore - first.matchScore)
    .slice(0, filters.limit);

  return {
    jobs,
    providerResults: providerResults.map((result) => ({
      provider: result.provider,
      count: result.jobs.length,
      error: result.error,
    })),
  };
}

export interface JobSearchStreamEvent {
  type: 'provider-start' | 'provider-progress' | 'provider-result' | 'local-cache' | 'done';
  provider?: string;
  jobs?: ApiJob[];
  providerProgress?: JobProviderProgress;
  providerResult?: {
    provider: string;
    count: number;
    error?: string;
  };
  total?: number;
}

export async function streamSearchJobs(
  filters: JobSearchFilters,
  userId: string,
  emit: (event: JobSearchStreamEvent) => void,
) {
  const providers = getSearchProviders(filters);
  const seenJobIds = new Set<string>();
  const profile = await getUserProfile(userId);
  let total = 0;

  await Promise.all(providers.map(async (provider) => {
    emit({ type: 'provider-start', provider: provider.name, total });

    try {
      const result = await provider.search(filters, (progress) => {
        emit({ type: 'provider-progress', provider: progress.provider, providerProgress: progress, total });
      });
      const jobs = await persistProviderJobs(result, filters, userId, profile, seenJobIds);
      total += jobs.length;
      emit({
        type: 'provider-result',
        provider: result.provider,
        jobs,
        providerResult: result.error
          ? { provider: result.provider, count: result.jobs.length, error: result.error }
          : { provider: result.provider, count: result.jobs.length },
        total,
      });
    } catch (error) {
      emit({
        type: 'provider-result',
        provider: provider.name,
        jobs: [],
        providerResult: {
          provider: provider.name,
          count: 0,
          error: error instanceof Error ? error.message : 'Provider failed.',
        },
        total,
      });
    }
  }));

  if (total === 0 && filters.includeCached) {
    const savedJobIds = await getSavedJobIds(userId);
    const trackedJobIds = await getTrackedJobIds(userId);
    const localRows = await loadCachedRows(filters);
    const jobs = localRows
      .map((row) => toApiJob(row, filters, savedJobIds, trackedJobIds, profile))
      .sort((first, second) => second.matchScore - first.matchScore);
    total += jobs.length;
    emit({ type: 'local-cache', provider: 'Local cache', jobs, providerResult: { provider: 'Local cache', count: jobs.length }, total });
  }

  emit({ type: 'done', total });
}

export async function listSavedJobs(userId: string, filters: JobSearchFilters) {
  const savedRows = await db.select({ job: jobPostings })
    .from(savedJobs)
    .innerJoin(jobPostings, eq(savedJobs.jobId, jobPostings.id))
    .where(eq(savedJobs.userId, userId))
    .orderBy(desc(savedJobs.savedAt));
  const trackedJobIds = await getTrackedJobIds(userId);
  const savedJobIds = new Set(savedRows.map((row) => row.job.id));
  const profile = await getUserProfile(userId);
  return savedRows.map((row) => toApiJob(row.job, filters, savedJobIds, trackedJobIds, profile));
}

export async function setSavedJob(userId: string, jobId: string, saved: boolean) {
  const job = await db.select().from(jobPostings).where(eq(jobPostings.id, jobId)).limit(1);

  if (!job[0]) {
    throw new Error('Job not found.');
  }

  if (!saved) {
    await db.delete(savedJobs).where(and(eq(savedJobs.userId, userId), eq(savedJobs.jobId, jobId)));
    return false;
  }

  const existing = await db.select().from(savedJobs).where(and(eq(savedJobs.userId, userId), eq(savedJobs.jobId, jobId))).limit(1);
  if (!existing[0]) {
    await db.insert(savedJobs).values({ userId, jobId });
  }

  return true;
}
