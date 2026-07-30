export interface JobSearchFilters {
  query?: string | undefined;
  location?: string | undefined;
  locationCity?: string | undefined;
  locationRegion?: string | undefined;
  locationCountry?: string | undefined;
  locationCountryName?: string | undefined;
  locationLat?: number | undefined;
  locationLng?: number | undefined;
  locationRadiusMiles?: number | undefined;
  includeRemote?: boolean | undefined;
  remote?: boolean | undefined;
  employmentType?: string | undefined;
  experienceLevel?: string | undefined;
  minSalary?: number | undefined;
  source?: string | undefined;
  includeCached?: boolean | undefined;
  limit: number;
}

export interface NormalizedJob {
  source: string;
  externalId?: string | undefined;
  company: string;
  title: string;
  normalizedTitle?: string | undefined;
  location: string;
  remote: boolean;
  employmentType?: string | undefined;
  experienceLevel?: string | undefined;
  salaryRange?: string | undefined;
  salaryMin?: number | undefined;
  salaryMax?: number | undefined;
  currency?: string | undefined;
  jobUrl: string;
  description: string;
  requirements: string[];
  tags: string[];
  postedAt?: Date | undefined;
}

export interface JobProviderResult {
  provider: string;
  jobs: NormalizedJob[];
  error?: string | undefined;
}

export interface JobProviderProgress {
  provider: string;
  checked: number;
  total: number;
  matched: number;
  failed: number;
  current?: string | undefined;
}

export type JobProviderProgressCallback = (progress: JobProviderProgress) => void;

export interface JobProvider {
  name: string;
  search(filters: JobSearchFilters, onProgress?: JobProviderProgressCallback): Promise<JobProviderResult>;
}
