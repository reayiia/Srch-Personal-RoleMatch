import type { JobSearchFilters, NormalizedJob } from './types.js';
import { distanceMiles, resolveLocationCoordinate } from './locationService.js';

const stopWords = new Set(['and', 'the', 'with', 'for', 'from', 'that', 'this', 'you', 'your', 'our', 'are', 'into', 'onto']);

const querySynonyms: Array<{ pattern: RegExp; variants: string[] }> = [
  { pattern: /\b(store|retail|shop)\b/, variants: ['store', 'retail', 'shop', 'merchandise'] },
  { pattern: /\b(manager|management|supervisor|lead)\b/, variants: ['manager', 'management', 'supervisor', 'lead'] },
  { pattern: /\b(software|developer|development|programmer)\b/, variants: ['software', 'developer', 'development', 'programmer'] },
  { pattern: /\b(engineer|engineering)\b/, variants: ['engineer', 'engineering', 'developer'] },
  { pattern: /\b(frontend|front-end|front end)\b/, variants: ['frontend', 'front-end', 'front end', 'react', 'ui'] },
  { pattern: /\b(backend|back-end|back end)\b/, variants: ['backend', 'back-end', 'back end', 'api', 'server'] },
  { pattern: /\b(fullstack|full-stack|full stack)\b/, variants: ['fullstack', 'full-stack', 'full stack', 'software', 'developer'] },
  { pattern: /\b(data|analytics|analyst)\b/, variants: ['data', 'analytics', 'analyst', 'business intelligence'] },
  { pattern: /\b(sales|account)\b/, variants: ['sales', 'account', 'business development'] },
  { pattern: /\b(customer|support|service)\b/, variants: ['customer', 'support', 'service', 'client'] },
  { pattern: /\b(marketing|growth)\b/, variants: ['marketing', 'growth', 'brand'] },
  { pattern: /\b(finance|accounting|accountant)\b/, variants: ['finance', 'accounting', 'accountant'] },
  { pattern: /\b(product|program|project)\b/, variants: ['product', 'program', 'project'] },
  { pattern: /\b(teacher|teaching|educator|instructor|faculty|school)\b/, variants: ['teacher', 'teaching', 'educator', 'instructor', 'faculty', 'school'] },
];

export function stripHtml(value?: string | null) {
  if (!value) return '';

  return value
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

export function truncate(value: string, maxLength: number) {
  return value.length > maxLength ? `${value.slice(0, maxLength - 3).trim()}...` : value;
}

export function normalizeText(value?: string | null) {
  return (value ?? '').toLowerCase().trim();
}

function normalizedLocation(value?: string | null) {
  return normalizeText(value)
    .replace(/\bu\.s\.a?\b/g, 'united states')
    .replace(/\busa\b/g, 'united states')
    .replace(/\bu\.s\.\b/g, 'united states')
    .replace(/\s+/g, ' ');
}

function isBroadRemoteLocation(value: string) {
  const location = normalizedLocation(value);

  if (!location) return true;
  if (/^(remote|anywhere|worldwide|global)$/.test(location)) return true;
  if (/remote.*(united states|us only|usa|north america|americas)/.test(location)) return true;
  if (/(united states|north america|americas)/.test(location) && !/(brazil|germany|europe|india|portugal|spain|france|poland|romania|canada|mexico|argentina|colombia|chile|peru)/.test(location)) return true;

  return false;
}

function aliasPattern(alias: string) {
  return new RegExp(`\\b${alias.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i');
}

function selectedLocationParts(filters: JobSearchFilters) {
  return [
    filters.locationCity,
    filters.locationRegion,
    filters.locationCountryName,
    filters.locationCountry,
    filters.location,
  ]
    .map((value) => normalizedLocation(value))
    .filter(Boolean);
}

function hasSelectedCoordinate(filters: JobSearchFilters) {
  return typeof filters.locationLat === 'number' && typeof filters.locationLng === 'number';
}

function matchesRadius(job: NormalizedJob, filters: JobSearchFilters) {
  if (!hasSelectedCoordinate(filters) || !filters.locationRadiusMiles || job.remote) return true;

  const jobCoordinate = resolveLocationCoordinate(job.location, {
    countryCode: filters.locationCountry,
    region: filters.locationRegion,
  });
  if (!jobCoordinate) return false;

  return distanceMiles(
    { latitude: filters.locationLat!, longitude: filters.locationLng! },
    jobCoordinate,
  ) <= filters.locationRadiusMiles;
}

function tokenizeQuery(value?: string | null) {
  return normalizeText(value)
    .split(/\s+/)
    .map((term) => term.trim())
    .filter((term) => term.length > 2 && !stopWords.has(term));
}

function queryTermGroups(value?: string | null) {
  const query = normalizeText(value);
  const used = new Set<string>();
  const groups: string[][] = [];

  querySynonyms.forEach(({ pattern, variants }) => {
    if (pattern.test(query)) {
      variants.forEach((variant) => used.add(variant));
      groups.push(variants);
    }
  });

  tokenizeQuery(query).forEach((term) => {
    if (!Array.from(used).some((variant) => variant.includes(term) || term.includes(variant))) {
      groups.push([term]);
    }
  });

  return groups;
}

function matchingGroupCount(haystack: string, groups: string[][]) {
  return groups.filter((group) => group.some((term) => haystack.includes(term))).length;
}

function isSoftwareIntent(query: string) {
  return /\b(software|developer|development|programmer|frontend|front-end|backend|back-end|fullstack|full-stack|full stack|web|mobile|devops|cloud)\b/.test(query);
}

function isNonSoftwareEngineeringTitle(title: string) {
  return /\b(electrical|civil|structural|mechanical|manufacturing|facility|facilities|hardware|construction|industrial|quality|chemical|curriculum|instructional|teacher|teaching|education|training)\b/.test(title)
    && !/\b(software|frontend|front-end|backend|back-end|fullstack|full-stack|full stack|web|mobile|platform|cloud|devops|data|machine learning|ml|ai)\b/.test(title);
}

function isManagerRoleQuery(query: string) {
  return /\b(manager|management|supervisor|lead)\b/.test(query);
}

function hasRoleIntent(query: string) {
  return /\b(store|retail|manager|management|supervisor|lead|software|developer|development|programmer|engineer|engineering|frontend|front-end|backend|back-end|fullstack|full-stack|full stack|analyst|sales|support|service|marketing|finance|accounting|accountant|product|program|project|teacher|teaching|educator|instructor|faculty)\b/.test(query);
}

function normalizedFilterLabel(value?: string | null) {
  const normalized = normalizeText(value)
    .replace(/[-_/]+/g, ' ')
    .replace(/\s+/g, ' ');

  if (/^full\s*time$|^permanent$/.test(normalized)) return 'full time';
  if (/^part\s*time$/.test(normalized)) return 'part time';
  if (/^contract(or)?$|^freelance$/.test(normalized)) return 'contract';
  if (/^temp(orary)?$|^seasonal$/.test(normalized)) return 'temporary';

  return normalized;
}

function selectedFilterValues(value?: string) {
  return (value ?? '')
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean)
    .filter((entry) => entry !== 'Any' && entry !== 'All sources');
}

function filterIncludes(value: string | null | undefined, selected?: string) {
  const selectedValues = selectedFilterValues(selected);
  if (selectedValues.length === 0) return true;

  return selectedValues.some((entry) => normalizedFilterLabel(entry) === normalizedFilterLabel(value));
}

function roleMatchesQuery(job: NormalizedJob, filters: JobSearchFilters) {
  const query = normalizeText(filters.query);
  if (!query) return true;

  const groups = queryTermGroups(query);
  if (groups.length === 0) return true;

  const titleHaystack = `${job.title} ${job.normalizedTitle ?? ''}`.toLowerCase();
  const fullHaystack = `${job.title} ${job.company} ${job.description} ${job.tags.join(' ')}`.toLowerCase();
  const titleMatches = matchingGroupCount(titleHaystack, groups);
  const fullMatches = matchingGroupCount(fullHaystack, groups);

  if (titleHaystack.includes(query)) return true;
  if (isSoftwareIntent(query) && isNonSoftwareEngineeringTitle(titleHaystack)) return false;

  if (!hasRoleIntent(query)) {
    return fullMatches === groups.length;
  }

  if (groups.length === 1) {
    return titleMatches >= 1;
  }

  if (isManagerRoleQuery(query)) {
    return titleMatches >= Math.min(2, groups.length);
  }

  return titleMatches >= Math.ceil(groups.length * 0.75)
    && fullMatches >= Math.ceil(groups.length * 0.8);
}

export function matchesLocation(job: NormalizedJob, filters: JobSearchFilters) {
  if (!filters.location) {
    return true;
  }

  const queryLocation = normalizedLocation(filters.location);
  const jobLocation = normalizedLocation(job.location);

  if (filters.includeRemote && job.remote && isBroadRemoteLocation(jobLocation)) return true;
  if (hasSelectedCoordinate(filters) && filters.locationRadiusMiles && !job.remote) {
    return matchesRadius(job, filters);
  }

  if (jobLocation.includes(queryLocation)) return true;

  const selectedParts = selectedLocationParts(filters);
  const city = normalizedLocation(filters.locationCity);
  const region = normalizedLocation(filters.locationRegion);
  const country = normalizedLocation(filters.locationCountryName ?? filters.locationCountry);

  if (city && aliasPattern(city).test(jobLocation)) {
    if (!region && !country) return true;
    if (region && aliasPattern(region).test(jobLocation)) return true;
    if (country && aliasPattern(country).test(jobLocation)) return true;
    if (hasSelectedCoordinate(filters) && filters.locationRadiusMiles) return true;
  }

  if (selectedParts.some((part) => part.length > 1 && aliasPattern(part).test(jobLocation))) {
    return true;
  }

  return false;
}

export function inferRemote(location?: string | null, remoteValue?: boolean | string | number | null) {
  if (typeof remoteValue === 'boolean') return remoteValue;
  if (typeof remoteValue === 'string' && ['1', 'true', 'yes', 'remote'].includes(remoteValue.toLowerCase())) return true;
  return /remote|anywhere|work from home|worldwide/i.test(location ?? '');
}

export function inferEmploymentType(title: string, description: string, tags: string[] = []) {
  const haystack = `${title} ${description} ${tags.join(' ')}`.toLowerCase();

  if (/internship|intern\b/.test(haystack)) return 'Internship';
  if (/contract|contractor|freelance/.test(haystack)) return 'Contract';
  if (/part[-\s]?time/.test(haystack)) return 'Part time';
  if (/temporary|seasonal/.test(haystack)) return 'Temporary';
  return 'Full time';
}

export function inferExperienceLevel(title: string, description: string) {
  const haystack = `${title} ${description}`.toLowerCase();

  if (/internship|intern\b/.test(haystack)) return 'Internship';
  if (/entry[-\s]?level|junior|jr\.?|new grad|graduate/.test(haystack)) return 'Entry level';
  if (/senior|sr\.?|staff|principal|lead/.test(haystack)) return 'Senior';
  if (/manager|director|head of/.test(haystack)) return 'Leadership';
  return 'Mid level';
}

export function extractTags(title: string, description: string, providedTags: string[] = []) {
  const knownSkills = [
    'TypeScript', 'JavaScript', 'React', 'Node.js', 'Express', 'Python', 'Java', 'C++', 'C#',
    'SQL', 'PostgreSQL', 'MySQL', 'AWS', 'Azure', 'GCP', 'Docker', 'Kubernetes', 'REST',
    'GraphQL', 'Data', 'Machine Learning', 'AI', 'Excel', 'Tableau', 'Power BI',
  ];

  const haystack = `${title} ${description}`.toLowerCase();
  const inferred = knownSkills.filter((skill) => haystack.includes(skill.toLowerCase()));
  const normalizedProvided = providedTags.map((tag) => tag.trim()).filter(Boolean);

  return Array.from(new Set([...normalizedProvided, ...inferred])).slice(0, 10);
}

export function extractRequirements(description: string) {
  const sentences = description
    .split(/(?<=[.!?])\s+|\n+/)
    .map((sentence) => sentence.trim())
    .filter(Boolean);

  return sentences
    .filter((sentence) => /require|qualification|experience|degree|bachelor|years|must|proficient/i.test(sentence))
    .map((sentence) => truncate(sentence, 220))
    .slice(0, 5);
}

function currencySymbol(currency?: string | null) {
  if (currency?.toUpperCase() === 'EUR') return '\u20ac';
  if (currency?.toUpperCase() === 'GBP') return '\u00a3';
  return '$';
}

function formatSalaryAmount(value: number, currency?: string | null) {
  const code = currency?.toUpperCase();
  const prefix = code && !['USD', 'EUR', 'GBP'].includes(code) ? `${code} ` : currencySymbol(code);
  return `${prefix}${Math.round(value).toLocaleString()}`;
}

export function extractSalary(
  description: string,
  explicitMin?: number | null,
  explicitMax?: number | null,
  explicitCurrency?: string | null,
) {
  if (explicitMin || explicitMax) {
    const salaryMin = typeof explicitMin === 'number' ? Math.round(explicitMin) : undefined;
    const salaryMax = typeof explicitMax === 'number' ? Math.round(explicitMax) : salaryMin;
    const salaryRange = salaryMin && salaryMax
      ? salaryMin === salaryMax
        ? formatSalaryAmount(salaryMin, explicitCurrency)
        : `${formatSalaryAmount(salaryMin, explicitCurrency)} - ${formatSalaryAmount(salaryMax, explicitCurrency)}`
      : undefined;

    return { salaryMin, salaryMax, salaryRange, currency: explicitCurrency?.toUpperCase() ?? 'USD' };
  }

  const matches = Array.from(description.matchAll(/([$\u20ac\u00a3])?\s*(\d{2,3}(?:,\d{3})+|\d{4,6}|\d{2,3}(?:\.\d+)?\s*[kK])\b/g))
    .map((match) => {
      const index = match.index ?? 0;
      const context = description.slice(Math.max(0, index - 70), index + match[0].length + 70).toLowerCase();
      const hasSalaryContext = /\b(salary|compensation|base pay|pay range|annual|annually|per year|yearly|wage)\b/.test(context);
      const isNonSalaryPayment = /\b(bonus|equity|stock|stipend|reimbursement|relocation|sign[- ]?on|signing)\b/.test(context)
        && !/\b(base salary|salary range|base pay|pay range|compensation range)\b/.test(context);
      if (!hasSalaryContext || isNonSalaryPayment) return undefined;

      const rawValue = match[2]?.replace(/\s+/g, '') ?? '';
      const usesThousandsSuffix = /k$/i.test(rawValue);
      const base = Number(rawValue.replace(/[,k]/gi, ''));
      if (!Number.isFinite(base)) return undefined;
      const value = usesThousandsSuffix ? base * 1000 : base;
      const currency = match[1] === '\u20ac' ? 'EUR' : match[1] === '\u00a3' ? 'GBP' : match[1] === '$' ? 'USD' : undefined;
      return { value, currency };
    })
    .filter((entry): entry is { value: number; currency: string | undefined } => (
      Boolean(entry && entry.value >= 30000 && entry.value <= 500000)
    ));

  if (matches.length === 0) {
    return {};
  }

  const salaryMin = Math.min(...matches.map((match) => match.value));
  const salaryMax = Math.max(...matches.map((match) => match.value));
  const currencies = Array.from(new Set(matches.map((match) => match.currency).filter(Boolean)));
  const currency = currencies.length === 1 ? currencies[0] : undefined;

  return {
    salaryMin,
    salaryMax,
    salaryRange: salaryMin === salaryMax
      ? formatSalaryAmount(salaryMin, currency)
      : `${formatSalaryAmount(salaryMin, currency)} - ${formatSalaryAmount(salaryMax, currency)}`,
    currency: currency ?? 'USD',
  };
}

function salaryIsComparable(job: NormalizedJob) {
  return !job.currency || job.currency.toUpperCase() === 'USD';
}

export function calculateMatchScore(job: NormalizedJob, filters: JobSearchFilters) {
  let score = 40;
  const queryGroups = queryTermGroups(filters.query);
  const query = normalizeText(filters.query);
  const titleHaystack = `${job.title} ${job.normalizedTitle ?? ''}`.toLowerCase();
  const fullHaystack = `${job.title} ${job.company} ${job.description} ${job.tags.join(' ')}`.toLowerCase();

  if (queryGroups.length > 0) {
    const matchedTitleGroups = matchingGroupCount(titleHaystack, queryGroups);
    const matchedFullGroups = matchingGroupCount(fullHaystack, queryGroups);
    if (query && titleHaystack.includes(query)) score += 35;
    else if (query && fullHaystack.includes(query)) score += 10;
    score += Math.round((matchedTitleGroups / queryGroups.length) * 30);
    score += Math.round((matchedFullGroups / queryGroups.length) * 15);
  }

  if (filters.location && matchesLocation(job, filters)) score += 8;
  if (filters.includeRemote && job.remote) score += 10;
  if (filters.employmentType && filterIncludes(job.employmentType, filters.employmentType)) score += 7;
  if (filters.experienceLevel && filterIncludes(job.experienceLevel, filters.experienceLevel)) score += 7;
  if (filters.minSalary && salaryIsComparable(job) && job.salaryMax && job.salaryMax >= filters.minSalary) score += 6;

  return Math.max(0, Math.min(score, 99));
}

export function matchesFilters(job: NormalizedJob, filters: JobSearchFilters) {
  if (!roleMatchesQuery(job, filters)) return false;

  if (!matchesLocation(job, filters)) return false;
  if (filters.source && !filterIncludes(job.source, filters.source)) return false;
  if (filters.employmentType && !filterIncludes(job.employmentType, filters.employmentType)) return false;
  if (filters.experienceLevel && !filterIncludes(job.experienceLevel, filters.experienceLevel)) return false;
  if (filters.minSalary && salaryIsComparable(job) && job.salaryMax && job.salaryMax < filters.minSalary) return false;

  return true;
}
