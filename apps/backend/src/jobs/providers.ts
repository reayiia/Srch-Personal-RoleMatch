import {
  extractRequirements,
  extractSalary,
  extractTags,
  inferEmploymentType,
  inferExperienceLevel,
  inferRemote,
  matchesFilters,
  stripHtml,
  truncate,
} from './normalization.js';
import {
  defaultAshbyBoards,
  defaultGreenhouseBoards,
  defaultIcimsSites,
  defaultLeverCompanies,
  defaultPersonioCompanies,
  defaultRecruiteeCompanies,
  defaultSmartRecruitersCompanies,
  defaultWorkableAccounts,
  defaultWorkdaySites,
  type IcimsSiteConfig,
  type WorkdaySiteConfig,
} from './atsRegistry.js';
import type {
  JobProvider,
  JobProviderProgressCallback,
  JobProviderResult,
  JobSearchFilters,
  NormalizedJob,
} from './types.js';

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchJson<T>(url: string, init: RequestInit = {}, timeoutMs = 9000, attempts = 3): Promise<T> {
  let lastError: unknown;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await fetch(url, {
        ...init,
        signal: controller.signal,
        headers: {
          'Accept': 'application/json',
          'User-Agent': 'RoleMatch Senior Project (local demo)',
          ...(init.headers ?? {}),
        },
      });

      if (!response.ok) {
        throw new Error(`${response.status} ${response.statusText}`);
      }

      return await response.json() as T;
    } catch (error) {
      lastError = error;
      if (attempt === attempts) break;
      await delay(400 * attempt);
    } finally {
      clearTimeout(timeout);
    }
  }

  throw lastError instanceof Error ? lastError : new Error('Fetch failed.');
}

function safeDate(value?: string | number | null) {
  if (!value) return undefined;
  const date = typeof value === 'number' ? new Date(value * 1000) : new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date;
}

function finalizeJob(job: NormalizedJob, filters: JobSearchFilters) {
  const description = stripHtml(job.description);
  const tags = extractTags(job.title, description, job.tags);
  const salary = extractSalary(description, job.salaryMin, job.salaryMax, job.currency);

  return {
    ...job,
    description: truncate(description || `${job.title} at ${job.company}`, 4000),
    requirements: job.requirements.length > 0 ? job.requirements : extractRequirements(description),
    tags,
    remote: job.remote || inferRemote(job.location),
    employmentType: job.employmentType || inferEmploymentType(job.title, description, tags),
    experienceLevel: job.experienceLevel || inferExperienceLevel(job.title, description),
    normalizedTitle: job.normalizedTitle || job.title.toLowerCase(),
    ...salary,
  };
}

function filterAndLimit(jobs: NormalizedJob[], filters: JobSearchFilters) {
  return jobs
    .map((job) => finalizeJob(job, filters))
    .filter((job) => matchesFilters(job, filters))
    .slice(0, filters.limit);
}

function museLocation(location?: string) {
  const normalized = normalizeLocationLabel(location);
  if (/^boston(,\s*ma|\s+ma)?$/i.test(normalized)) return 'Boston, MA';
  if (/^austin(,\s*tx|\s+tx)?$/i.test(normalized)) return 'Austin, TX';
  if (/^detroit(,\s*mi|\s+mi)?$/i.test(normalized)) return 'Detroit, MI';
  if (/^chicago(,\s*il|\s+il)?$/i.test(normalized)) return 'Chicago, IL';
  if (/^seattle(,\s*wa|\s+wa)?$/i.test(normalized)) return 'Seattle, WA';
  if (/^new york(,\s*ny|\s+ny)?$/i.test(normalized)) return 'New York, NY';
  if (/^san francisco(,\s*ca|\s+ca)?$/i.test(normalized)) return 'San Francisco, CA';

  return normalized;
}

function normalizeLocationLabel(location?: string) {
  return (location ?? '')
    .replace(/\s*,\s*/g, ', ')
    .replace(/\s+/g, ' ')
    .trim();
}

function selectedSourceMatches(providerName: string, source?: string) {
  if (!source || source === 'All sources') return true;
  const normalizedProvider = providerName.toLowerCase();
  const normalizedSources = source
    .split(',')
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean);

  if (normalizedSources.length === 0 || normalizedSources.includes('all sources')) return true;

  return normalizedSources.some((normalizedSource) => (
    normalizedProvider === normalizedSource || normalizedProvider.startsWith(`${normalizedSource}:`)
  ));
}

function envList(name: string) {
  return (process.env[name] ?? '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);
}

function mergeUnique<T>(first: T[], second: T[], key: (value: T) => string = String) {
  const seen = new Set<string>();
  const merged: T[] = [];

  [...first, ...second].forEach((item) => {
    const normalized = key(item).toLowerCase();
    if (seen.has(normalized)) return;

    seen.add(normalized);
    merged.push(item);
  });

  return merged;
}

function parsePositiveInt(value: string | undefined, fallback: number, min: number, max: number) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;

  return Math.max(min, Math.min(Math.floor(parsed), max));
}

async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  worker: (item: T) => Promise<R>,
) {
  const results: R[] = [];
  let index = 0;

  async function runWorker() {
    while (index < items.length) {
      const currentIndex = index;
      index += 1;
      results[currentIndex] = await worker(items[currentIndex]!);
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, runWorker));
  return results;
}

async function searchRegistry<T>(
  providerName: string,
  entries: T[],
  filters: JobSearchFilters,
  searchEntry: (entry: T) => Promise<JobProviderResult>,
  onProgress?: JobProviderProgressCallback,
): Promise<JobProviderResult> {
  if (entries.length === 0) {
    return {
      provider: providerName,
      jobs: [],
      error: `${providerName} has no configured boards. Add entries through the default registry or environment variables.`,
    };
  }

  const concurrency = parsePositiveInt(process.env.ATS_REGISTRY_CONCURRENCY, 6, 1, 12);
  let checked = 0;
  let failed = 0;
  let matched = 0;

  onProgress?.({ provider: providerName, checked, total: entries.length, matched, failed });

  const results = await mapWithConcurrency(entries, concurrency, async (entry) => {
    const current = registryEntryLabel(entry);

    try {
      const result = await searchEntry(entry);
      checked += 1;
      matched += result.jobs.length;
      if (result.error) failed += 1;
      onProgress?.({ provider: providerName, checked, total: entries.length, matched, failed, current });

      return result;
    } catch (error) {
      checked += 1;
      failed += 1;
      onProgress?.({ provider: providerName, checked, total: entries.length, matched, failed, current });

      return {
        provider: providerName,
        jobs: [],
        error: error instanceof Error ? error.message : `${providerName} board failed.`,
      };
    }
  });
  const jobs = Array.from(new Map(results.flatMap((result) => result.jobs).map((job) => [job.jobUrl, job])).values());
  const failedCount = results.filter((result) => result.error).length;
  const error = failedCount === entries.length
    ? `${providerName} registry could not reach any of its ${entries.length} configured boards.`
    : undefined;

  return {
    provider: providerName,
    jobs: filterAndLimit(jobs, filters),
    error,
  };
}

function registryEntryLabel(entry: unknown) {
  if (typeof entry === 'string') return entry;
  if (entry && typeof entry === 'object') {
    const record = entry as Record<string, unknown>;
    return String(record.label ?? record.host ?? record.site ?? 'board');
  }

  return 'board';
}

function normalizeEmploymentLabel(value?: string | null) {
  const normalized = (value ?? '').toLowerCase();

  if (/intern/.test(normalized)) return 'Internship';
  if (/contract|contractor|freelance/.test(normalized)) return 'Contract';
  if (/part[-\s]?time|parttime/.test(normalized)) return 'Part time';
  if (/temporary|seasonal/.test(normalized)) return 'Temporary';
  if (/full[-\s]?time|fulltime|permanent/.test(normalized)) return 'Full time';

  return value || undefined;
}

function normalizeExperienceLabel(value?: string | null) {
  const normalized = (value ?? '').toLowerCase();

  if (/intern/.test(normalized)) return 'Internship';
  if (/entry|junior|graduate|early/.test(normalized)) return 'Entry level';
  if (/senior|staff|principal|lead|mid-senior/.test(normalized)) return 'Senior';
  if (/manager|director|executive|head/.test(normalized)) return 'Leadership';
  if (/mid/.test(normalized)) return 'Mid level';

  return value || undefined;
}

function parseSalaryComponents(value: unknown) {
  const compensation = value && typeof value === 'object' ? value as Record<string, unknown> : undefined;
  const summary = compensation?.compensationTierSummary ?? compensation?.scrapeableCompensationSalarySummary;
  const components = Array.isArray(compensation?.summaryComponents)
    ? compensation.summaryComponents as Array<Record<string, unknown>>
    : [];
  const salaryComponent = components.find((component) => /salary/i.test(String(component.compensationType ?? '')));

  return {
    salaryRange: summary ? String(summary) : undefined,
    salaryMin: Number(salaryComponent?.minValue ?? 0) || undefined,
    salaryMax: Number(salaryComponent?.maxValue ?? 0) || undefined,
    currency: salaryComponent?.currencyCode ? String(salaryComponent.currencyCode) : undefined,
  };
}

function firstString(...values: unknown[]) {
  const value = values.find((entry) => typeof entry === 'string' && entry.trim().length > 0);
  return typeof value === 'string' ? value.trim() : undefined;
}

function extractXmlValue(block: string, tag: string) {
  const match = block.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'i'));
  return match?.[1] ? stripHtml(match[1]) : undefined;
}

function extractXmlValues(block: string, tag: string) {
  return Array.from(block.matchAll(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'gi')))
    .map((match) => stripHtml(match[1] ?? ''))
    .filter(Boolean);
}

function personioDescription(block: string) {
  return Array.from(block.matchAll(/<jobDescription[^>]*>[\s\S]*?<value[^>]*>([\s\S]*?)<\/value>[\s\S]*?<\/jobDescription>/gi))
    .map((match) => stripHtml(match[1] ?? ''))
    .filter(Boolean)
    .join('\n\n');
}

function absoluteUrl(host: string, href: string) {
  if (/^https?:\/\//i.test(href)) return href;
  return `https://${host.replace(/^https?:\/\//, '').replace(/\/$/, '')}${href.startsWith('/') ? href : `/${href}`}`;
}

function museCategoriesForQuery(query?: string) {
  const normalized = (query ?? '').toLowerCase();
  const categories = new Set<string>();

  if (/software|engineer|developer|frontend|backend|full\s?stack|web|mobile|devops|cloud/.test(normalized)) {
    categories.add('Software Engineering');
  }
  if (/data|analytics|analyst|business intelligence|machine learning|ai/.test(normalized)) {
    categories.add('Data and Analytics');
  }
  if (/store|retail|merchandise|cashier|associate/.test(normalized)) {
    categories.add('Retail');
    categories.add('Customer Service');
  }
  if (/sales|account|business development/.test(normalized)) {
    categories.add('Sales');
    categories.add('Account Management');
  }
  if (/manager|management|operations|program|project|lead/.test(normalized)) {
    categories.add('Account Management');
    categories.add('Project Management');
  }
  if (/customer|support|service|help desk/.test(normalized)) {
    categories.add('Customer Service');
  }
  if (/marketing|growth|brand|content/.test(normalized)) {
    categories.add('Marketing');
  }
  if (/finance|accounting|accountant|financial/.test(normalized)) {
    categories.add('Finance');
  }
  if (/product/.test(normalized)) {
    categories.add('Product');
  }
  if (/teacher|teaching|educator|instructor|faculty|school|education/.test(normalized)) {
    categories.add('Education');
  }

  return Array.from(categories);
}

export const remotiveProvider: JobProvider = {
  name: 'Remotive',
  async search(filters) {
    const url = new URL('https://remotive.com/api/remote-jobs');
    if (filters.query) url.searchParams.set('search', filters.query);
    if (filters.limit) url.searchParams.set('limit', String(Math.min(filters.limit, 50)));

    const data = await fetchJson<{ jobs?: Array<Record<string, unknown>> }>(url.toString());
    const jobs = (data.jobs ?? []).map((item) => {
      const description = stripHtml(String(item.description ?? ''));
      const title = String(item.title ?? 'Untitled role');
      const company = String(item.company_name ?? 'Unknown company');

      return {
        source: 'Remotive',
        externalId: String(item.id ?? item.url ?? title),
        company,
        title,
        location: String(item.candidate_required_location ?? 'Remote'),
        remote: true,
        jobUrl: String(item.url ?? ''),
        description,
        requirements: extractRequirements(description),
        tags: Array.isArray(item.tags) ? item.tags.map(String) : [String(item.category ?? '')].filter(Boolean),
        postedAt: safeDate(String(item.publication_date ?? '')),
      } satisfies NormalizedJob;
    }).filter((job) => job.jobUrl);

    return { provider: this.name, jobs: filterAndLimit(jobs, filters) };
  },
};

export const museProvider: JobProvider = {
  name: 'The Muse',
  async search(filters) {
    const requestedJobs = Math.min(filters.limit, 400);
    const categories = museCategoriesForQuery(filters.query);
    const categorySearches = categories.length > 0 ? categories : [undefined];
    const pagesPerSearch = Math.max(3, Math.ceil(requestedJobs / Math.max(5, categorySearches.length * 5)));
    const buildUrl = (page: number, category?: string) => {
      const url = new URL('https://www.themuse.com/api/public/jobs');
      url.searchParams.set('page', String(page));
      url.searchParams.set('descending', 'true');
      if (filters.location) url.searchParams.set('location', museLocation(filters.location));
      if (category) url.searchParams.set('category', category);

      return url.toString();
    };

    const responses: Array<{ results?: Array<Record<string, unknown>> }> = [];
    for (const category of categorySearches) {
      const firstPage = await fetchJson<{ page_count?: number; results?: Array<Record<string, unknown>> }>(buildUrl(1, category), {}, 12000);
      responses.push(firstPage);
      const pages = Math.max(1, Math.min(firstPage.page_count ?? pagesPerSearch, pagesPerSearch, 60));

      for (let page = 2; page <= pages; page += 1) {
        try {
          responses.push(await fetchJson<{ results?: Array<Record<string, unknown>> }>(buildUrl(page, category), {}, 12000));
        } catch {
          break;
        }
      }
    }

    const rawJobs = Array.from(new Map(responses.flatMap((data) => data.results ?? []).map((item) => {
      const key = String(item.id ?? item.refs ?? item.name ?? JSON.stringify(item));
      return [key, item] as const;
    })).values());

    const jobs = rawJobs.map((item) => {
      const title = String(item.name ?? 'Untitled role');
      const company = item.company && typeof item.company === 'object'
        ? String((item.company as Record<string, unknown>).name ?? 'Unknown company')
        : 'Unknown company';
      const locations = Array.isArray(item.locations) ? item.locations as Array<Record<string, unknown>> : [];
      const levels = Array.isArray(item.levels) ? item.levels as Array<Record<string, unknown>> : [];
      const categories = Array.isArray(item.categories) ? item.categories as Array<Record<string, unknown>> : [];
      const description = stripHtml(String(item.contents ?? ''));
      const location = locations.map((entry) => String(entry.name ?? '')).filter(Boolean).join(', ') || 'Not specified';
      const categoryTags = categories.map((entry) => String(entry.name ?? '')).filter(Boolean);

      return {
        source: 'The Muse',
        externalId: String(item.id ?? item.refs ?? item.url ?? title),
        company,
        title,
        location,
        remote: inferRemote(location),
        employmentType: undefined,
        experienceLevel: levels[0]?.name ? String(levels[0].name) : undefined,
        jobUrl: String(item.refs && typeof item.refs === 'object' ? (item.refs as Record<string, unknown>).landing_page ?? '' : ''),
        description,
        requirements: extractRequirements(description),
        tags: categoryTags,
        postedAt: safeDate(String(item.publication_date ?? '')),
      } satisfies NormalizedJob;
    }).filter((job) => job.jobUrl);

    return { provider: this.name, jobs: filterAndLimit(jobs, filters) };
  },
};

export const arbeitnowProvider: JobProvider = {
  name: 'Arbeitnow',
  async search(filters) {
    const data = await fetchJson<{ data?: Array<Record<string, unknown>> }>('https://www.arbeitnow.com/api/job-board-api');
    const jobs = (data.data ?? []).map((item) => {
      const description = stripHtml(String(item.description ?? ''));
      const title = String(item.title ?? 'Untitled role');
      const tags = [
        ...(Array.isArray(item.tags) ? item.tags.map(String) : []),
        ...(Array.isArray(item.job_types) ? item.job_types.map(String) : []),
      ];

      return {
        source: 'Arbeitnow',
        externalId: String(item.slug ?? item.url ?? title),
        company: String(item.company_name ?? 'Unknown company'),
        title,
        location: String(item.location ?? 'Europe / Remote'),
        remote: inferRemote(String(item.location ?? ''), item.remote as boolean | undefined),
        employmentType: Array.isArray(item.job_types) ? String(item.job_types[0] ?? '') || undefined : undefined,
        jobUrl: String(item.url ?? ''),
        description,
        requirements: extractRequirements(description),
        tags,
        postedAt: safeDate(Number(item.created_at ?? 0)),
      } satisfies NormalizedJob;
    }).filter((job) => job.jobUrl);

    return { provider: this.name, jobs: filterAndLimit(jobs, filters) };
  },
};

export const remoteOkProvider: JobProvider = {
  name: 'RemoteOK',
  async search(filters) {
    const data = await fetchJson<Array<Record<string, unknown>>>('https://remoteok.com/api');
    const jobs = data.filter((item) => item && item.id).map((item) => {
      const description = stripHtml(String(item.description ?? ''));
      const title = String(item.position ?? 'Untitled role');
      const salaryMin = Number(item.salary_min ?? 0) || undefined;
      const salaryMax = Number(item.salary_max ?? 0) || undefined;

      return {
        source: 'RemoteOK',
        externalId: String(item.id ?? item.slug ?? item.url ?? title),
        company: String(item.company ?? 'Unknown company'),
        title,
        location: String(item.location ?? 'Remote'),
        remote: true,
        salaryMin,
        salaryMax,
        jobUrl: String(item.url ?? ''),
        description,
        requirements: extractRequirements(description),
        tags: Array.isArray(item.tags) ? item.tags.map(String) : [],
        postedAt: safeDate(String(item.date ?? '')),
      } satisfies NormalizedJob;
    }).filter((job) => job.jobUrl);

    return { provider: this.name, jobs: filterAndLimit(jobs, filters) };
  },
};

export const adzunaProvider: JobProvider = {
  name: 'Adzuna',
  async search(filters) {
    const appId = process.env.ADZUNA_APP_ID;
    const appKey = process.env.ADZUNA_APP_KEY;
    const country = process.env.ADZUNA_COUNTRY || 'us';

    if (!appId || !appKey) {
      return { provider: this.name, jobs: [], error: 'ADZUNA_APP_ID and ADZUNA_APP_KEY are not configured. Add a free Adzuna API key to enable broad job-board results.' };
    }

    const requestedJobs = Math.min(filters.limit, 400);
    const pages = Math.max(1, Math.min(Math.ceil(requestedJobs / 50), 8));
    const responses = await Promise.all(Array.from({ length: pages }, (_, index) => {
      const url = new URL(`https://api.adzuna.com/v1/api/jobs/${country}/search/${index + 1}`);
      url.searchParams.set('app_id', appId);
      url.searchParams.set('app_key', appKey);
      url.searchParams.set('content-type', 'application/json');
      url.searchParams.set('results_per_page', String(Math.min(50, requestedJobs)));
      if (filters.query) url.searchParams.set('what', filters.query);
      if (filters.location) url.searchParams.set('where', filters.location);
      if (filters.minSalary) url.searchParams.set('salary_min', String(filters.minSalary));

      return fetchJson<{ results?: Array<Record<string, unknown>> }>(url.toString(), {}, 12000);
    }));

    const jobs = responses.flatMap((data) => data.results ?? []).map((item) => {
      const title = String(item.title ?? 'Untitled role');
      const location = item.location && typeof item.location === 'object'
        ? String((item.location as Record<string, unknown>).display_name ?? 'Not specified')
        : 'Not specified';
      const category = item.category && typeof item.category === 'object'
        ? String((item.category as Record<string, unknown>).label ?? '')
        : '';
      const description = stripHtml(String(item.description ?? ''));

      return {
        source: 'Adzuna',
        externalId: String(item.id ?? item.redirect_url ?? title),
        company: String(item.company && typeof item.company === 'object' ? (item.company as Record<string, unknown>).display_name ?? 'Unknown company' : 'Unknown company'),
        title,
        location,
        remote: inferRemote(location),
        salaryMin: Number(item.salary_min ?? 0) || undefined,
        salaryMax: Number(item.salary_max ?? 0) || undefined,
        currency: country === 'us' ? 'USD' : undefined,
        jobUrl: String(item.redirect_url ?? ''),
        description,
        requirements: extractRequirements(description),
        tags: [category].filter(Boolean),
        postedAt: safeDate(String(item.created ?? '')),
      } satisfies NormalizedJob;
    }).filter((job) => job.jobUrl);

    return { provider: this.name, jobs: filterAndLimit(jobs, filters) };
  },
};

function firstExternalLink(value: unknown) {
  if (!Array.isArray(value)) return '';

  for (const entry of value) {
    if (entry && typeof entry === 'object') {
      const link = (entry as Record<string, unknown>).link ?? (entry as Record<string, unknown>).url;
      if (link) return String(link);
    }
  }

  return '';
}

export const googleJobsProvider: JobProvider = {
  name: 'Google Jobs',
  async search(filters) {
    const apiKey = process.env.SERPAPI_API_KEY || process.env.SERP_API_KEY;

    if (!apiKey) {
      return { provider: this.name, jobs: [], error: 'SERPAPI_API_KEY is not configured. Add it to enable broad Google Jobs aggregation and external apply links.' };
    }

    const requestedJobs = Math.min(filters.limit, 500);
    const maxPages = parsePositiveInt(process.env.SERPAPI_MAX_PAGES || process.env.SERP_API_MAX_PAGES, 2, 1, 10);
    const pages = Math.max(1, Math.min(Math.ceil(requestedJobs / 10), maxPages));
    const queryParts = [
      filters.query?.trim() || 'jobs',
      filters.employmentType,
      filters.experienceLevel,
      filters.location ? `in ${filters.location}` : '',
    ].filter(Boolean);
    const query = queryParts.join(' ');
    const responses: Array<{ jobs_results?: Array<Record<string, unknown>> }> = [];
    let firstPageError: string | undefined;

    for (let page = 0; page < pages; page += 1) {
      const url = new URL('https://serpapi.com/search.json');
      url.searchParams.set('engine', 'google_jobs');
      url.searchParams.set('q', query);
      url.searchParams.set('hl', 'en');
      url.searchParams.set('api_key', apiKey);
      if (page > 0) url.searchParams.set('start', String(page * 10));

      try {
        responses.push(await fetchJson<{ jobs_results?: Array<Record<string, unknown>> }>(url.toString(), {}, 16000, 2));
      } catch (error) {
        if (responses.length === 0) {
          firstPageError = error instanceof Error ? error.message : 'Google Jobs provider failed.';
        }
        break;
      }
    }

    if (responses.length === 0 && firstPageError) {
      return { provider: this.name, jobs: [], error: firstPageError };
    }

    const rawJobs = Array.from(new Map(responses.flatMap((data) => data.jobs_results ?? []).map((item) => {
      const key = String(item.job_id ?? item.title ?? JSON.stringify(item));
      return [key, item] as const;
    })).values());

    const jobs = rawJobs.map((item) => {
      const detected = item.detected_extensions && typeof item.detected_extensions === 'object'
        ? item.detected_extensions as Record<string, unknown>
        : {};
      const title = String(item.title ?? 'Untitled role');
      const company = String(item.company_name ?? 'Unknown company');
      const location = String(item.location ?? filters.location ?? 'Not specified');
      const description = stripHtml(String(item.description ?? ''));
      const scheduleType = String(detected.schedule_type ?? '');
      const salaryRange = detected.salary ? String(detected.salary) : undefined;
      const jobUrl = firstExternalLink(item.apply_options) || firstExternalLink(item.related_links) || String(item.share_link ?? item.serpapi_link ?? '');

      return {
        source: 'Google Jobs',
        externalId: String(item.job_id ?? jobUrl ?? title),
        company,
        title,
        location,
        remote: inferRemote(`${location} ${query}`),
        employmentType: scheduleType || undefined,
        experienceLevel: inferExperienceLevel(title, description),
        salaryRange,
        jobUrl,
        description,
        requirements: extractRequirements(description),
        tags: [String(item.via ?? ''), scheduleType].filter(Boolean),
        postedAt: safeDate(String(detected.posted_at ?? '')),
      } satisfies NormalizedJob;
    }).filter((job) => job.jobUrl);

    return { provider: this.name, jobs: filterAndLimit(jobs, filters) };
  },
};

export function workdayProvider(label: string, host: string, tenant: string, site: string): JobProvider {
  return {
    name: `Workday:${label}`,
    async search(filters) {
      const requestedJobs = Math.min(filters.limit, 400);
      const pageSize = Math.min(20, requestedJobs);
      const pages = Math.max(1, Math.min(Math.ceil(requestedJobs / pageSize), 20));
      const baseUrl = `https://${host.replace(/^https?:\/\//, '').replace(/\/$/, '')}`;
      const searchUrl = `${baseUrl}/wday/cxs/${encodeURIComponent(tenant)}/${encodeURIComponent(site)}/jobs`;
      const responses: Array<{ jobPostings?: Array<Record<string, unknown>> }> = [];
      for (let index = 0; index < pages; index += 1) {
        responses.push(await fetchJson<{ jobPostings?: Array<Record<string, unknown>> }>(searchUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            appliedFacets: {},
            limit: pageSize,
            offset: index * pageSize,
            searchText: filters.query ?? '',
          }),
        }, 14000));
      }

      const jobs = responses.flatMap((data) => data.jobPostings ?? []).map((item) => {
        const title = String(item.title ?? 'Untitled role');
        const externalPath = String(item.externalPath ?? '');
        const location = String(item.locationsText ?? 'Not specified');
        const bulletFields = Array.isArray(item.bulletFields) ? item.bulletFields.map(String) : [];
        const remoteType = String(item.remoteType ?? '');
        const postedOn = String(item.postedOn ?? '');

        return {
          source: 'Workday',
          externalId: bulletFields[0] ?? externalPath,
          company: label,
          title,
          location,
          remote: inferRemote(`${location} ${remoteType}`),
          employmentType: undefined,
          experienceLevel: inferExperienceLevel(title, ''),
          jobUrl: `${baseUrl}/${site}${externalPath}`,
          description: [title, label, location, remoteType, postedOn, ...bulletFields].filter(Boolean).join(' - '),
          requirements: [],
          tags: [remoteType, ...bulletFields].filter(Boolean),
          postedAt: undefined,
        } satisfies NormalizedJob;
      }).filter((job) => job.jobUrl);

      return { provider: this.name, jobs: filterAndLimit(jobs, filters) };
    },
  };
}

export function leverProvider(companySlug: string): JobProvider {
  return {
    name: `Lever:${companySlug}`,
    async search(filters) {
      const data = await fetchJson<Array<Record<string, unknown>>>(`https://api.lever.co/v0/postings/${companySlug}?mode=json`);
      const jobs = data.map((item) => {
        const description = stripHtml(String(item.descriptionPlain ?? item.description ?? ''));
        const categories = item.categories as Record<string, unknown> | undefined;
        const title = String(item.text ?? 'Untitled role');

        return {
          source: 'Lever',
          externalId: String(item.id ?? item.hostedUrl ?? title),
          company: companySlug,
          title,
          location: String(categories?.location ?? 'Not specified'),
          remote: inferRemote(String(categories?.location ?? '')),
          employmentType: normalizeEmploymentLabel(categories?.commitment ? String(categories.commitment) : undefined),
          jobUrl: String(item.hostedUrl ?? item.applyUrl ?? ''),
          description,
          requirements: extractRequirements(description),
          tags: [String(categories?.team ?? ''), String(categories?.department ?? '')].filter(Boolean),
          postedAt: safeDate(Number(item.createdAt ?? 0) / 1000),
        } satisfies NormalizedJob;
      }).filter((job) => job.jobUrl);

      return { provider: this.name, jobs: filterAndLimit(jobs, filters) };
    },
  };
}

export function greenhouseProvider(boardToken: string, includeContent = true): JobProvider {
  return {
    name: `Greenhouse:${boardToken}`,
    async search(filters) {
      const data = await fetchJson<{ jobs?: Array<Record<string, unknown>> }>(`https://boards-api.greenhouse.io/v1/boards/${boardToken}/jobs?content=${includeContent ? 'true' : 'false'}`);
      const jobs = (data.jobs ?? []).map((item) => {
        const description = stripHtml(String(item.content ?? ''));
        const offices = Array.isArray(item.offices) ? item.offices as Array<Record<string, unknown>> : [];
        const departments = Array.isArray(item.departments) ? item.departments as Array<Record<string, unknown>> : [];
        const title = String(item.title ?? 'Untitled role');

        return {
          source: 'Greenhouse',
          externalId: String(item.id ?? item.absolute_url ?? title),
          company: boardToken,
          title,
          location: String(item.location && typeof item.location === 'object' ? (item.location as Record<string, unknown>).name ?? 'Not specified' : 'Not specified'),
          remote: inferRemote(JSON.stringify(item.location ?? '')),
          jobUrl: String(item.absolute_url ?? ''),
          description,
          requirements: extractRequirements(description),
          tags: [...offices.map((office) => String(office.name ?? '')), ...departments.map((department) => String(department.name ?? ''))].filter(Boolean),
          postedAt: safeDate(String(item.updated_at ?? '')),
        } satisfies NormalizedJob;
      }).filter((job) => job.jobUrl);

      return { provider: this.name, jobs: filterAndLimit(jobs, filters) };
    },
  };
}

export function ashbyProvider(boardName: string): JobProvider {
  return {
    name: `Ashby:${boardName}`,
    async search(filters) {
      const url = new URL(`https://api.ashbyhq.com/posting-api/job-board/${encodeURIComponent(boardName)}`);
      url.searchParams.set('includeCompensation', 'true');

      const data = await fetchJson<{ jobs?: Array<Record<string, unknown>> }>(url.toString(), {}, 14000, 2);
      const jobs = (data.jobs ?? [])
        .filter((item) => item.isListed !== false)
        .map((item) => {
          const description = stripHtml(String(item.descriptionPlain ?? item.descriptionHtml ?? ''));
          const title = String(item.title ?? 'Untitled role');
          const secondaryLocations = Array.isArray(item.secondaryLocations)
            ? item.secondaryLocations.map((location) => String((location as Record<string, unknown>).location ?? '')).filter(Boolean)
            : [];
          const location = [String(item.location ?? 'Not specified'), ...secondaryLocations.slice(0, 3)]
            .filter(Boolean)
            .join(', ');
          const salary = parseSalaryComponents(item.compensation);

          return {
            source: 'Ashby',
            externalId: String(item.id ?? item.jobUrl ?? title),
            company: boardName,
            title,
            location,
            remote: inferRemote(location, item.isRemote as boolean | undefined),
            employmentType: normalizeEmploymentLabel(String(item.employmentType ?? '')),
            experienceLevel: inferExperienceLevel(title, description),
            ...salary,
            jobUrl: String(item.jobUrl ?? item.applyUrl ?? ''),
            description,
            requirements: extractRequirements(description),
            tags: [String(item.department ?? ''), String(item.team ?? ''), String(item.workplaceType ?? '')].filter(Boolean),
            postedAt: safeDate(String(item.publishedAt ?? '')),
          } satisfies NormalizedJob;
        })
        .filter((job) => job.jobUrl);

      return { provider: this.name, jobs: filterAndLimit(jobs, filters) };
    },
  };
}

export function smartRecruitersProvider(companyIdentifier: string): JobProvider {
  return {
    name: `SmartRecruiters:${companyIdentifier}`,
    async search(filters) {
      const requestedJobs = Math.min(filters.limit, 100);
      const url = new URL(`https://api.smartrecruiters.com/v1/companies/${encodeURIComponent(companyIdentifier)}/postings`);
      url.searchParams.set('limit', String(requestedJobs));
      url.searchParams.set('offset', '0');
      if (filters.query) url.searchParams.set('q', filters.query);
      if (filters.location) url.searchParams.set('location', filters.location);

      const data = await fetchJson<{ content?: Array<Record<string, unknown>> }>(url.toString(), {}, 14000, 2);
      const jobs = (data.content ?? []).map((item) => {
        const title = String(item.name ?? 'Untitled role');
        const company = item.company && typeof item.company === 'object' ? item.company as Record<string, unknown> : {};
        const location = item.location && typeof item.location === 'object' ? item.location as Record<string, unknown> : {};
        const department = item.department && typeof item.department === 'object' ? item.department as Record<string, unknown> : {};
        const jobFunction = item.function && typeof item.function === 'object' ? item.function as Record<string, unknown> : {};
        const industry = item.industry && typeof item.industry === 'object' ? item.industry as Record<string, unknown> : {};
        const employment = item.typeOfEmployment && typeof item.typeOfEmployment === 'object' ? item.typeOfEmployment as Record<string, unknown> : {};
        const experience = item.experienceLevel && typeof item.experienceLevel === 'object' ? item.experienceLevel as Record<string, unknown> : {};
        const companySlug = String(company.identifier ?? companyIdentifier).toLowerCase();
        const postingId = String(item.id ?? item.uuid ?? '');
        const fallbackLocation = [location.city, location.region, location.country].filter(Boolean).join(', ') || 'Not specified';
        const fullLocation = String(location.fullLocation ?? fallbackLocation);
        const description = stripHtml([
          title,
          String(company.name ?? companyIdentifier),
          fullLocation,
          String(department.label ?? ''),
          String(jobFunction.label ?? ''),
          String(industry.label ?? ''),
          String(experience.label ?? ''),
        ].filter(Boolean).join(' - '));

        return {
          source: 'SmartRecruiters',
          externalId: postingId || String(item.uuid ?? title),
          company: String(company.name ?? companyIdentifier),
          title,
          location: fullLocation,
          remote: inferRemote(fullLocation, location.remote as boolean | undefined),
          employmentType: normalizeEmploymentLabel(String(employment.label ?? '')),
          experienceLevel: normalizeExperienceLabel(String(experience.label ?? '')),
          jobUrl: postingId ? `https://jobs.smartrecruiters.com/${companySlug}/${postingId}` : String(item.ref ?? ''),
          description,
          requirements: extractRequirements(description),
          tags: [String(department.label ?? ''), String(jobFunction.label ?? ''), String(industry.label ?? '')].filter(Boolean),
          postedAt: safeDate(String(item.releasedDate ?? '')),
        } satisfies NormalizedJob;
      }).filter((job) => job.jobUrl);

      return { provider: this.name, jobs: filterAndLimit(jobs, filters) };
    },
  };
}

export function workableProvider(accountSlug: string): JobProvider {
  return {
    name: `Workable:${accountSlug}`,
    async search(filters) {
      const data = await fetchJson<{ name?: string; jobs?: Array<Record<string, unknown>> }>(
        `https://apply.workable.com/api/v1/widget/accounts/${encodeURIComponent(accountSlug)}`,
        {},
        12000,
        2,
      );
      const companyName = data.name ?? accountSlug;
      const jobs = (data.jobs ?? []).map((item) => {
        const title = String(item.title ?? 'Untitled role');
        const locationEntries = Array.isArray(item.locations) ? item.locations as Array<Record<string, unknown>> : [];
        const primaryLocation = [
          firstString(item.city),
          firstString(item.state),
          firstString(item.country),
        ].filter(Boolean).join(', ');
        const location = primaryLocation || locationEntries
          .map((entry) => [entry.city, entry.state, entry.country].filter(Boolean).join(', '))
          .filter(Boolean)
          .join('; ') || 'Not specified';
        const description = stripHtml([
          item.description,
          item.requirements,
          item.benefits,
          item.function,
          item.industry,
        ].filter(Boolean).map(String).join('\n\n'));

        return {
          source: 'Workable',
          externalId: String(item.shortcode ?? item.code ?? item.url ?? title),
          company: companyName,
          title,
          location,
          remote: inferRemote(location, item.telecommuting as boolean | undefined),
          employmentType: normalizeEmploymentLabel(String(item.employment_type ?? '')),
          experienceLevel: normalizeExperienceLabel(String(item.experience ?? '')),
          jobUrl: String(item.url ?? item.application_url ?? item.shortlink ?? ''),
          description: description || [title, companyName, location].join(' - '),
          requirements: extractRequirements(description),
          tags: [String(item.department ?? ''), String(item.function ?? ''), String(item.industry ?? '')].filter(Boolean),
          postedAt: safeDate(String(item.published_on ?? item.created_at ?? '')),
        } satisfies NormalizedJob;
      }).filter((job) => job.jobUrl);

      return { provider: this.name, jobs: filterAndLimit(jobs, filters) };
    },
  };
}

export function recruiteeProvider(companySlug: string): JobProvider {
  return {
    name: `Recruitee:${companySlug}`,
    async search(filters) {
      const data = await fetchJson<{ offers?: Array<Record<string, unknown>> }>(
        `https://${companySlug}.recruitee.com/api/offers`,
        {},
        12000,
        2,
      );
      const jobs = (data.offers ?? []).map((item) => {
        const locations = Array.isArray(item.locations) ? item.locations as Array<Record<string, unknown>> : [];
        const remoteValue = typeof item.remote === 'boolean' ? item.remote : item.on_site === false;
        const location = locations
          .map((entry) => [entry.city, entry.state, entry.country].filter(Boolean).join(', '))
          .filter(Boolean)
          .join('; ')
          || [item.city, item.state_name, item.country].filter(Boolean).join(', ')
          || String(item.location ?? 'Not specified');
        const description = stripHtml([
          item.description,
          item.requirements,
          item.sharing_description,
        ].filter(Boolean).map(String).join('\n\n'));
        const salary = item.salary && typeof item.salary === 'object'
          ? item.salary as Record<string, unknown>
          : {};

        return {
          source: 'Recruitee',
          externalId: String(item.id ?? item.slug ?? item.careers_url ?? item.title),
          company: String(item.company_name ?? companySlug),
          title: String(item.title ?? 'Untitled role'),
          location,
          remote: inferRemote(location, remoteValue),
          employmentType: normalizeEmploymentLabel(String(item.kind ?? item.employment_type ?? '')),
          experienceLevel: normalizeExperienceLabel(String(item.experience_code ?? '')),
          salaryMin: Number(salary.min ?? 0) || undefined,
          salaryMax: Number(salary.max ?? 0) || undefined,
          currency: salary.currency ? String(salary.currency) : undefined,
          jobUrl: String(item.careers_url ?? item.careers_apply_url ?? ''),
          description: description || String(item.sharing_description ?? ''),
          requirements: extractRequirements(description),
          tags: [String(item.department ?? ''), String(item.education_code ?? '')].filter(Boolean),
          postedAt: safeDate(String(item.updated_at ?? '')),
        } satisfies NormalizedJob;
      }).filter((job) => job.jobUrl);

      return { provider: this.name, jobs: filterAndLimit(jobs, filters) };
    },
  };
}

export function personioProvider(companySlug: string): JobProvider {
  return {
    name: `Personio:${companySlug}`,
    async search(filters) {
      const xml = await fetch(`https://${companySlug}.jobs.personio.de/xml?language=en`, {
        headers: {
          Accept: 'application/xml, text/xml, */*',
          'User-Agent': 'RoleMatch Senior Project (local demo)',
        },
      }).then(async (response) => {
        if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
        return response.text();
      });

      const jobs = Array.from(xml.matchAll(/<position>[\s\S]*?<\/position>/gi)).map((match) => {
        const block = match[0];
        const id = extractXmlValue(block, 'id');
        const title = extractXmlValue(block, 'name') ?? 'Untitled role';
        const additionalOfficesBlock = block.match(/<additionalOffices[^>]*>([\s\S]*?)<\/additionalOffices>/i)?.[1] ?? '';
        const offices = [
          extractXmlValue(block, 'office'),
          ...extractXmlValues(additionalOfficesBlock, 'office'),
        ].filter(Boolean);
        const location = offices.join('; ') || 'Not specified';
        const description = personioDescription(block);

        return {
          source: 'Personio',
          externalId: String(id ?? title),
          company: extractXmlValue(block, 'subcompany') ?? companySlug,
          title,
          location,
          remote: inferRemote(location),
          employmentType: normalizeEmploymentLabel(extractXmlValue(block, 'employmentType')),
          experienceLevel: normalizeExperienceLabel(extractXmlValue(block, 'seniority')),
          jobUrl: id ? `https://${companySlug}.jobs.personio.de/job/${id}?language=en` : `https://${companySlug}.jobs.personio.de/`,
          description: description || [title, location].join(' - '),
          requirements: extractRequirements(description),
          tags: [
            extractXmlValue(block, 'department'),
            extractXmlValue(block, 'office'),
            extractXmlValue(block, 'schedule'),
          ].filter(Boolean) as string[],
          postedAt: undefined,
        } satisfies NormalizedJob;
      });

      return { provider: this.name, jobs: filterAndLimit(jobs, filters) };
    },
  };
}

export function icimsProvider(site: IcimsSiteConfig): JobProvider {
  return {
    name: `iCIMS:${site.label}`,
    async search(filters) {
      const url = new URL(`https://${site.host.replace(/^https?:\/\//, '').replace(/\/$/, '')}/jobs/search`);
      url.searchParams.set('ss', '1');
      url.searchParams.set('in_iframe', '1');
      url.searchParams.set('searchRelation', 'keyword_all');
      if (filters.query) url.searchParams.set('searchKeyword', filters.query);
      if (filters.locationCity ?? filters.location) url.searchParams.set('searchLocation', filters.locationCity ?? filters.location ?? '');

      const html = await fetch(url.toString(), {
        headers: {
          Accept: 'text/html,application/xhtml+xml',
          'User-Agent': 'RoleMatch Senior Project (local demo)',
        },
      }).then(async (response) => {
        if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
        return response.text();
      });
      const links = Array.from(html.matchAll(/<a[^>]+href=["']([^"']*\/jobs\/(\d+)\/[^"']*\/job[^"']*)["'][^>]*>([\s\S]*?)<\/a>/gi));
      const jobs = links.map((match, index) => {
        const nextMatch = links[index + 1];
        const block = html.slice(match.index ?? 0, nextMatch?.index ?? html.length);
        const locationValues = Array.from(block.matchAll(/<div class="iCIMS_JobHeaderTag">([\s\S]*?)<\/div>/gi))
          .map((entry) => entry[1] ?? '')
          .filter((entry) => entry.includes('glyphicons-map-marker'))
          .map((entry) => entry.match(/<dd[^>]*>([\s\S]*?)<\/dd>/i)?.[1] ?? '')
          .map((entry) => stripHtml(entry))
          .filter(Boolean);
        const rawType = block.match(/Position Type[\s\S]{0,500}<dd[^>]*>([\s\S]*?)<\/dd>/i)?.[1];
        const title = stripHtml(match[3]?.match(/<h3[^>]*>([\s\S]*?)<\/h3>/i)?.[1] ?? match[3] ?? 'Untitled role');
        const location = locationValues.join(', ') || 'Not specified';

        return {
          source: 'iCIMS',
          externalId: match[2] ?? match[1] ?? title,
          company: site.label,
          title,
          location,
          remote: inferRemote(location),
          employmentType: normalizeEmploymentLabel(rawType ? stripHtml(rawType) : undefined),
          experienceLevel: inferExperienceLevel(title, ''),
          jobUrl: absoluteUrl(site.host, match[1] ?? ''),
          description: stripHtml(block) || [title, site.label, location].join(' - '),
          requirements: [],
          tags: [],
          postedAt: undefined,
        } satisfies NormalizedJob;
      });

      return { provider: this.name, jobs: filterAndLimit(jobs, filters) };
    },
  };
}

export function leverRegistryProvider(companySlugs: string[]): JobProvider {
  return {
    name: 'Lever',
    search(filters, onProgress) {
      return searchRegistry(this.name, companySlugs, filters, (slug) => leverProvider(slug).search(filters), onProgress);
    },
  };
}

export function greenhouseRegistryProvider(boardTokens: string[]): JobProvider {
  return {
    name: 'Greenhouse',
    search(filters, onProgress) {
      return searchRegistry(this.name, boardTokens, filters, (token) => greenhouseProvider(token, false).search(filters), onProgress);
    },
  };
}

export function ashbyRegistryProvider(boardNames: string[]): JobProvider {
  return {
    name: 'Ashby',
    search(filters, onProgress) {
      return searchRegistry(this.name, boardNames, filters, (board) => ashbyProvider(board).search(filters), onProgress);
    },
  };
}

export function smartRecruitersRegistryProvider(companyIdentifiers: string[]): JobProvider {
  return {
    name: 'SmartRecruiters',
    search(filters, onProgress) {
      return searchRegistry(this.name, companyIdentifiers, filters, (company) => smartRecruitersProvider(company).search(filters), onProgress);
    },
  };
}

export function workableRegistryProvider(accountSlugs: string[]): JobProvider {
  return {
    name: 'Workable',
    search(filters, onProgress) {
      return searchRegistry(this.name, accountSlugs, filters, (account) => workableProvider(account).search(filters), onProgress);
    },
  };
}

export function recruiteeRegistryProvider(companySlugs: string[]): JobProvider {
  return {
    name: 'Recruitee',
    search(filters, onProgress) {
      return searchRegistry(this.name, companySlugs, filters, (company) => recruiteeProvider(company).search(filters), onProgress);
    },
  };
}

export function personioRegistryProvider(companySlugs: string[]): JobProvider {
  return {
    name: 'Personio',
    search(filters, onProgress) {
      return searchRegistry(this.name, companySlugs, filters, (company) => personioProvider(company).search(filters), onProgress);
    },
  };
}

export function icimsRegistryProvider(sites: IcimsSiteConfig[]): JobProvider {
  return {
    name: 'iCIMS',
    search(filters, onProgress) {
      return searchRegistry(this.name, sites, filters, (site) => icimsProvider(site).search(filters), onProgress);
    },
  };
}

export function workdayRegistryProvider(sites: WorkdaySiteConfig[]): JobProvider {
  return {
    name: 'Workday',
    search(filters, onProgress) {
      return searchRegistry(
        this.name,
        sites,
        filters,
        (site) => workdayProvider(site.label, site.host, site.tenant, site.site).search(filters),
        onProgress,
      );
    },
  };
}

export const usaJobsProvider: JobProvider = {
  name: 'USAJOBS',
  async search(filters) {
    const apiKey = process.env.USAJOBS_API_KEY;
    const userAgent = process.env.USAJOBS_USER_AGENT || process.env.USAJOBS_EMAIL;

    if (!apiKey || !userAgent) {
      return { provider: this.name, jobs: [], error: 'USAJOBS_API_KEY and USAJOBS_USER_AGENT are not configured. Add them to enable federal job search.' };
    }

    const url = new URL('https://data.usajobs.gov/api/search');
    if (filters.query) url.searchParams.set('Keyword', filters.query);
    if (filters.location) url.searchParams.set('LocationName', filters.location);
    url.searchParams.set('ResultsPerPage', String(Math.min(filters.limit, 500)));

    const data = await fetchJson<{ SearchResult?: { SearchResultItems?: Array<Record<string, unknown>> } }>(url.toString(), {
      headers: {
        'Host': 'data.usajobs.gov',
        'User-Agent': userAgent,
        'Authorization-Key': apiKey,
      },
    });

    const jobs = (data.SearchResult?.SearchResultItems ?? []).map((wrapper) => {
      const item = wrapper.MatchedObjectDescriptor as Record<string, unknown> | undefined;
      const userArea = item?.UserArea as Record<string, unknown> | undefined;
      const details = userArea?.Details as Record<string, unknown> | undefined;
      const description = stripHtml(String(item?.QualificationSummary ?? item?.UserArea ?? ''));
      const positionLocation = Array.isArray(item?.PositionLocation) ? item.PositionLocation[0] as Record<string, unknown> : undefined;
      const salary = item?.PositionRemuneration && Array.isArray(item.PositionRemuneration)
        ? item.PositionRemuneration[0] as Record<string, unknown>
        : undefined;
      const jobCategories = Array.isArray(item?.JobCategory) ? item.JobCategory as Array<Record<string, unknown>> : [];

      return {
        source: 'USAJOBS',
        externalId: String(item?.PositionID ?? item?.PositionURI ?? item?.PositionTitle),
        company: String(item?.OrganizationName ?? 'Federal agency'),
        title: String(item?.PositionTitle ?? 'Untitled role'),
        location: String(positionLocation?.LocationName ?? 'United States'),
        remote: inferRemote(String(details?.TeleworkEligible ?? ''), details?.RemoteIndicator as boolean | undefined),
        employmentType: Array.isArray(item?.PositionSchedule) ? String((item.PositionSchedule[0] as Record<string, unknown>).Name ?? '') : undefined,
        salaryMin: salary?.MinimumRange ? Number(salary.MinimumRange) : undefined,
        salaryMax: salary?.MaximumRange ? Number(salary.MaximumRange) : undefined,
        currency: 'USD',
        jobUrl: String(item?.PositionURI ?? ''),
        description,
        requirements: extractRequirements(description),
        tags: ['Federal', String(jobCategories[0]?.Name ?? '')].filter(Boolean),
        postedAt: safeDate(String(item?.PublicationStartDate ?? '')),
      } satisfies NormalizedJob;
    }).filter((job) => job.jobUrl);

    return { provider: this.name, jobs: filterAndLimit(jobs, filters) };
  },
};

function parseWorkdaySites(value?: string) {
  return (value ?? '')
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => entry.split('|').map((part) => part.trim()))
    .filter((parts): parts is [string, string, string, string] => parts.length === 4 && parts.every(Boolean))
    .map(([label, host, tenant, site]) => ({ label, host, tenant, site }));
}

function parseIcimsSites(value?: string) {
  return (value ?? '')
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => entry.split('|').map((part) => part.trim()))
    .filter((parts): parts is [string, string] => parts.length === 2 && parts.every(Boolean))
    .map(([label, host]) => ({ label, host }));
}

function useDefaultAtsRegistry() {
  return !['false', '0', 'off'].includes((process.env.ROLEMATCH_DEFAULT_ATS_REGISTRY ?? 'true').toLowerCase());
}

export function getConfiguredProviders(): JobProvider[] {
  const providers: JobProvider[] = [googleJobsProvider, museProvider, adzunaProvider, remotiveProvider, arbeitnowProvider, remoteOkProvider];
  const defaultsEnabled = useDefaultAtsRegistry();
  const leverCompanies = mergeUnique(defaultsEnabled ? defaultLeverCompanies : [], envList('LEVER_COMPANIES'));
  const greenhouseBoards = mergeUnique(defaultsEnabled ? defaultGreenhouseBoards : [], envList('GREENHOUSE_BOARDS'));
  const ashbyBoards = mergeUnique(defaultsEnabled ? defaultAshbyBoards : [], envList('ASHBY_BOARDS'));
  const smartRecruitersCompanies = mergeUnique(defaultsEnabled ? defaultSmartRecruitersCompanies : [], envList('SMARTRECRUITERS_COMPANIES'));
  const workableAccounts = mergeUnique(defaultsEnabled ? defaultWorkableAccounts : [], envList('WORKABLE_ACCOUNTS'));
  const recruiteeCompanies = mergeUnique(defaultsEnabled ? defaultRecruiteeCompanies : [], envList('RECRUITEE_COMPANIES'));
  const personioCompanies = mergeUnique(defaultsEnabled ? defaultPersonioCompanies : [], envList('PERSONIO_COMPANIES'));
  const icimsSites = mergeUnique(
    defaultsEnabled ? defaultIcimsSites : [],
    parseIcimsSites(process.env.ICIMS_SITES),
    (site) => `${site.label}|${site.host}`,
  );
  const workdaySites = mergeUnique(
    defaultsEnabled ? defaultWorkdaySites : [],
    parseWorkdaySites(process.env.WORKDAY_SITES),
    (site) => `${site.label}|${site.host}|${site.tenant}|${site.site}`,
  );

  providers.push(leverRegistryProvider(leverCompanies));
  providers.push(greenhouseRegistryProvider(greenhouseBoards));
  providers.push(ashbyRegistryProvider(ashbyBoards));
  providers.push(smartRecruitersRegistryProvider(smartRecruitersCompanies));
  providers.push(workableRegistryProvider(workableAccounts));
  providers.push(recruiteeRegistryProvider(recruiteeCompanies));
  providers.push(personioRegistryProvider(personioCompanies));
  providers.push(icimsRegistryProvider(icimsSites));
  providers.push(workdayRegistryProvider(workdaySites));
  providers.push(usaJobsProvider);

  return providers.filter((provider) => selectedSourceMatches(provider.name, process.env.ROLEMATCH_SOURCE_FILTER));
}

export function getSearchProviders(filters: JobSearchFilters): JobProvider[] {
  return getConfiguredProviders().filter((provider) => selectedSourceMatches(provider.name, filters.source));
}
