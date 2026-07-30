import { ChevronDown, Filter, MapPin, Search } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { useSearchParams } from 'react-router-dom';
import { JobCard } from '../components/JobCard';
import { SelectMenu, type SelectMenuOption } from '../components/SelectMenu';
import { createApplication, deleteApplicationByJobId } from '../api/applications';
import { setJobSaved, streamJobs, type ApiJob, type JobSearchParams, type ProviderStatus } from '../api/jobs';
import { fetchLocationSuggestions, type LocationSuggestion } from '../api/locations';
import { applyWithRoleMatch, openJobWithRoleMatchPanel } from '../utils/rolematchExtension';

const sourceOptions = ['Google Jobs', 'The Muse', 'Adzuna', 'Greenhouse', 'Ashby', 'SmartRecruiters', 'Lever', 'Workday', 'Workable', 'Recruitee', 'Personio', 'iCIMS', 'Remotive', 'Arbeitnow', 'RemoteOK', 'USAJOBS'];
const employmentOptions = ['Full time', 'Part time', 'Internship', 'Contract', 'Temporary'];
const experienceOptions = ['Internship', 'Entry level', 'Mid level', 'Senior', 'Leadership'];
const limitOptions = [100, 200, 300, 400, 500];
const radiusOptions = [10, 25, 50, 100, 250, 500];
const limitSelectOptions: Array<SelectMenuOption<number>> = limitOptions.map((option) => ({ value: option, label: String(option) }));
const radiusSelectOptions: Array<SelectMenuOption<number>> = radiusOptions.map((option) => ({ value: option, label: `${option} miles` }));

interface MultiSelectControlProps {
  label: string;
  allLabel: string;
  options: string[];
  selected: string[];
  onChange: (next: string[]) => void;
}

function filterValue(values: string[]) {
  return values.length > 0 ? values.join(',') : undefined;
}

function selectedSummary(values: string[], allLabel: string) {
  if (values.length === 0) return allLabel;
  if (values.length <= 2) return values.join(', ');

  return `${values.length} selected`;
}

function providerStatusText(result: ProviderStatus) {
  if (result.status === 'pending') {
    if (result.totalBoards) {
      return `${result.checked ?? 0}/${result.totalBoards} boards`;
    }

    return 'searching';
  }

  if (result.error) {
    if (result.totalBoards) {
      return `${result.count} roles, ${result.failed ?? 0} failed`;
    }

    return 'unavailable';
  }

  if (result.totalBoards) {
    const failedText = result.failed ? `, ${result.failed} failed` : '';
    return `${result.count} roles from ${result.checked ?? result.totalBoards}/${result.totalBoards}${failedText}`;
  }

  return `${result.count} roles`;
}

function providerStatusTitle(result: ProviderStatus) {
  if (result.error) return result.error;
  if (result.current) return `Last checked: ${result.current}`;
  return undefined;
}

function MultiSelectControl({ label, allLabel, options, selected, onChange }: MultiSelectControlProps) {
  const detailsRef = useRef<HTMLDetailsElement>(null);

  useEffect(() => {
    const handlePointerDown = (event: PointerEvent) => {
      if (!detailsRef.current || !(event.target instanceof Node)) return;
      if (!detailsRef.current.contains(event.target)) {
        detailsRef.current.open = false;
      }
    };

    document.addEventListener('pointerdown', handlePointerDown);
    return () => document.removeEventListener('pointerdown', handlePointerDown);
  }, []);

  const toggleOption = (option: string) => {
    onChange(
      selected.includes(option)
        ? selected.filter((value) => value !== option)
        : [...selected, option],
    );
  };

  return (
    <details className="filter-menu" ref={detailsRef}>
      <summary>
        <span>{label}</span>
        <strong>{selectedSummary(selected, allLabel)}</strong>
        <ChevronDown size={15} aria-hidden="true" />
      </summary>
      <div className="filter-menu-panel">
        <label className="filter-check">
          <input type="checkbox" checked={selected.length === 0} onChange={() => onChange([])} />
          {allLabel}
        </label>
        {options.map((option) => (
          <label className="filter-check" key={option}>
            <input
              type="checkbox"
              checked={selected.includes(option)}
              onChange={() => toggleOption(option)}
            />
            {option}
          </label>
        ))}
      </div>
    </details>
  );
}

export function JobSearchPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [query, setQuery] = useState('');
  const [locationInput, setLocationInput] = useState('');
  const [selectedLocation, setSelectedLocation] = useState<LocationSuggestion | null>(null);
  const [locationSuggestions, setLocationSuggestions] = useState<LocationSuggestion[]>([]);
  const [locationLoading, setLocationLoading] = useState(false);
  const [locationOpen, setLocationOpen] = useState(false);
  const [radiusMiles, setRadiusMiles] = useState(50);
  const [selectedSources, setSelectedSources] = useState<string[]>([]);
  const [selectedEmploymentTypes, setSelectedEmploymentTypes] = useState<string[]>([]);
  const [selectedExperienceLevels, setSelectedExperienceLevels] = useState<string[]>([]);
  const [minSalary, setMinSalary] = useState(0);
  const [limit, setLimit] = useState(200);
  const [includeRemote, setIncludeRemote] = useState(true);
  const [jobs, setJobs] = useState<ApiJob[]>([]);
  const [providerResults, setProviderResults] = useState<ProviderStatus[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [hasSearched, setHasSearched] = useState(false);
  const [pendingJobId, setPendingJobId] = useState<string | null>(null);
  const [trackingJobId, setTrackingJobId] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const profileSearchRunRef = useRef('');

  const runSearch = useCallback(async (filters: JobSearchParams) => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setLoading(true);
    setError('');
    setNotice('');
    setJobs([]);
    setProviderResults([]);
    setHasSearched(true);

    try {
      await streamJobs(filters, (event) => {
        if (event.type === 'provider-start' && event.provider) {
          setProviderResults((current) => {
            const nextStatus: ProviderStatus = { provider: event.provider!, count: 0, status: 'pending' };
            const exists = current.some((result) => result.provider === event.provider);
            return exists
              ? current.map((result) => result.provider === event.provider ? nextStatus : result)
              : [...current, nextStatus];
          });
        }

        if (event.type === 'provider-progress' && event.providerProgress) {
          setProviderResults((current) => {
            const progress = event.providerProgress!;
            const exists = current.some((result) => result.provider === progress.provider);
            const mergeProgress = (result: ProviderStatus): ProviderStatus => ({
              ...result,
              provider: progress.provider,
              status: 'pending',
              checked: progress.checked,
              totalBoards: progress.total,
              matched: progress.matched,
              failed: progress.failed,
              current: progress.current,
            });

            return exists
              ? current.map((result) => result.provider === progress.provider ? mergeProgress(result) : result)
              : [...current, mergeProgress({ provider: progress.provider, count: 0 })];
          });
        }

        if ((event.type === 'provider-result' || event.type === 'local-cache') && event.providerResult) {
          setProviderResults((current) => {
            const previous = current.find((result) => result.provider === event.providerResult!.provider);
            const nextStatus: ProviderStatus = {
              ...previous,
              ...event.providerResult!,
              status: event.providerResult!.error ? 'error' : 'complete',
            };
            const exists = current.some((result) => result.provider === nextStatus.provider);
            return exists
              ? current.map((result) => result.provider === nextStatus.provider ? nextStatus : result)
              : [...current, nextStatus];
          });
        }

        if (event.jobs && event.jobs.length > 0) {
          setJobs((currentJobs) => {
            const jobMap = new Map(currentJobs.map((job) => [job.id, job]));
            event.jobs?.forEach((job) => jobMap.set(job.id, job));

            return Array.from(jobMap.values())
              .sort((first, second) => second.matchScore - first.matchScore)
              .slice(0, filters.limit ?? 500);
          });
        }
      }, controller.signal);
    } catch (err: unknown) {
      if (!(err instanceof DOMException && err.name === 'AbortError')) {
        setError(err instanceof Error ? err.message : 'Unable to search jobs.');
        setJobs([]);
        setProviderResults([]);
      }
    } finally {
      if (abortRef.current === controller) {
        setLoading(false);
        abortRef.current = null;
      }
    }
  }, []);

  useEffect(() => {
    const queryText = locationInput.trim();
    if (selectedLocation?.label === queryText || queryText.length < 2) {
      return undefined;
    }

    let active = true;
    const timeout = window.setTimeout(() => {
      setLocationLoading(true);
      fetchLocationSuggestions(queryText)
        .then((locations) => {
          if (!active) return;
          setLocationSuggestions(locations);
          setLocationOpen(locations.length > 0);
        })
        .catch(() => {
          if (!active) return;
          setLocationSuggestions([]);
          setLocationOpen(false);
        })
        .finally(() => {
          if (active) setLocationLoading(false);
        });
    }, 220);

    return () => {
      active = false;
      window.clearTimeout(timeout);
    };
  }, [locationInput, selectedLocation]);

  useEffect(() => {
    return () => {
      abortRef.current?.abort();
    };
  }, []);

  useEffect(() => {
    if (searchParams.get('profileSearch') !== '1') return;
    const runKey = searchParams.toString();
    if (profileSearchRunRef.current === runKey) return;
    profileSearchRunRef.current = runKey;
    let cancelled = false;

    const profileQuery = searchParams.get('query')?.trim() ?? '';
    const profileLocation = searchParams.get('location')?.trim() ?? '';

    const startProfileSearch = async () => {
      const suggestions = profileLocation
        ? await fetchLocationSuggestions(profileLocation).catch(() => [])
        : [];
      const resolvedLocation = suggestions[0] ?? null;

      if (cancelled) return;

      setQuery(profileQuery);
      setLocationInput(resolvedLocation?.label ?? profileLocation);
      setSelectedLocation(resolvedLocation);
      setLocationSuggestions([]);
      setLocationOpen(false);
      setIncludeRemote(true);
      setLimit(200);

      void runSearch({
        query: profileQuery || undefined,
        location: (resolvedLocation?.label ?? profileLocation) || undefined,
        locationCity: resolvedLocation?.city,
        locationRegion: resolvedLocation?.region,
        locationCountry: resolvedLocation?.countryCode,
        locationCountryName: resolvedLocation?.countryName,
        locationLat: resolvedLocation?.latitude,
        locationLng: resolvedLocation?.longitude,
        locationRadiusMiles: resolvedLocation ? radiusMiles : undefined,
        includeRemote: true,
        includeCached: true,
        limit: 200,
      });

      const nextParams = new URLSearchParams(searchParams);
      nextParams.delete('profileSearch');
      setSearchParams(nextParams, { replace: true });
    };

    void startProfileSearch();

    return () => {
      cancelled = true;
    };
  }, [radiusMiles, runSearch, searchParams, setSearchParams]);

  const handleLocationInput = (value: string) => {
    setLocationInput(value);
    if (selectedLocation && selectedLocation.label !== value) {
      setSelectedLocation(null);
    }
    if (value.trim().length < 2) {
      setLocationSuggestions([]);
      setLocationOpen(false);
      setLocationLoading(false);
    }
    setLocationOpen(value.trim().length >= 2);
  };

  const handleSelectLocation = (suggestion: LocationSuggestion) => {
    setSelectedLocation(suggestion);
    setLocationInput(suggestion.label);
    setLocationSuggestions([]);
    setLocationOpen(false);
    setError('');
  };

  const handleSearch = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const typedLocation = locationInput.trim();
    if (typedLocation && !selectedLocation) {
      setError('Select a location from the dropdown before searching, or clear the location field.');
      setLocationOpen(locationSuggestions.length > 0);
      return;
    }

    void runSearch({
      query: query.trim(),
      location: selectedLocation?.label,
      locationCity: selectedLocation?.city,
      locationRegion: selectedLocation?.region,
      locationCountry: selectedLocation?.countryCode,
      locationCountryName: selectedLocation?.countryName,
      locationLat: selectedLocation?.latitude,
      locationLng: selectedLocation?.longitude,
      locationRadiusMiles: selectedLocation ? radiusMiles : undefined,
      includeRemote,
      source: filterValue(selectedSources),
      employmentType: filterValue(selectedEmploymentTypes),
      experienceLevel: filterValue(selectedExperienceLevels),
      minSalary: minSalary || undefined,
      includeCached: true,
      limit,
    });
  };

  const handleToggleSaved = async (job: ApiJob) => {
    const nextSaved = !job.saved;
    setPendingJobId(job.id);
    setError('');

    try {
      await setJobSaved(job.id, nextSaved);
      setJobs((currentJobs) => currentJobs.map((currentJob) => (
        currentJob.id === job.id ? { ...currentJob, saved: nextSaved } : currentJob
      )));
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Unable to update saved job.');
    } finally {
      setPendingJobId(null);
    }
  };

  const handleTrackApplication = async (job: ApiJob) => {
    setTrackingJobId(job.id);
    setError('');
    setNotice('');
    try {
      if (job.isTracked) {
        await deleteApplicationByJobId(job.id);
        setNotice(`${job.title} at ${job.company} was removed from the tracker.`);
      } else {
        await createApplication({
          jobId: job.id,
          status: 'submitted',
          evidenceNotes: 'Tracked from RoleMatch after opening or completing the external job application.',
        });
        setNotice(`${job.title} at ${job.company} was added to the application tracker.`);
      }

      setJobs((currentJobs) => currentJobs.map((currentJob) => (
          currentJob.id === job.id ? { ...currentJob, isTracked: !job.isTracked } : currentJob
      )));
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Unable to update tracking status.');
    } finally {
      setTrackingJobId(null);
    }
  };

  const handleApplyWithRoleMatch = async (job: ApiJob) => {
    setError('');
    setNotice(`Opening ${job.title} at ${job.company} with RoleMatch autofill...`);
    await createApplication({
      jobId: job.id,
      status: 'in_progress',
      evidenceNotes: 'Opened from RoleMatch and started in the external application flow.',
    })
      .then(() => {
        setJobs((currentJobs) => currentJobs.map((currentJob) => (
          currentJob.id === job.id ? { ...currentJob, isTracked: true } : currentJob
        )));
      })
      .catch(() => null);
    const result = await applyWithRoleMatch(job);
    if (result.ok) {
      setNotice(`Opened ${job.title} at ${job.company}. Review the filled application before submitting.`);
    } else {
      setError(result.error ?? 'Unable to start RoleMatch autofill.');
    }
  };

  const handleOpenJob = async (job: ApiJob) => {
    setError('');
    setNotice(`Opening ${job.title} at ${job.company} with the RoleMatch panel...`);
    await createApplication({
      jobId: job.id,
      status: 'in_progress',
      evidenceNotes: 'Opened from RoleMatch and started in the external application flow.',
    })
      .then(() => {
        setJobs((currentJobs) => currentJobs.map((currentJob) => (
          currentJob.id === job.id ? { ...currentJob, isTracked: true } : currentJob
        )));
      })
      .catch(() => null);
    const result = await openJobWithRoleMatchPanel(job);
    if (result.ok) {
      setNotice(`Opened ${job.title} at ${job.company}. Use Fill visible fields when you are ready.`);
    } else {
      setError(result.error ?? 'Opened the job normally because RoleMatch could not attach the panel.');
    }
  };

  const completedProviders = providerResults.filter((result) => result.status === 'complete' || result.status === 'error').length;
  const activeProviders = providerResults.filter((result) => result.status === 'pending').length;
  const boardProgress = providerResults.reduce((progress, result) => ({
    checked: progress.checked + (result.checked ?? 0),
    total: progress.total + (result.totalBoards ?? 0),
    failed: progress.failed + (result.failed ?? 0),
  }), { checked: 0, total: 0, failed: 0 });
  const progressLine = boardProgress.total > 0
    ? `Searching ${activeProviders} sources... ${jobs.length} roles found so far, ${boardProgress.checked}/${boardProgress.total} ATS boards checked`
    : `Searching ${activeProviders || providerResults.length || 'selected'} sources... ${jobs.length} roles found so far`;

  return (
    <div className="page">
      <header className="page-header">
        <div>
          <h1>Job search</h1>
          <p>{loading ? progressLine : hasSearched ? `${jobs.length} matching roles found` : 'Enter filters and press Search to start a live search.'}</p>
        </div>
      </header>

      <form className="search-toolbar search-toolbar-expanded" aria-label="Job filters" onSubmit={handleSearch}>
        <div className="search-toolbar-primary">
          <label className="input-with-icon">
            <span>Keyword</span>
            <Search size={18} aria-hidden="true" />
            <input
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search title, company, skill, or keyword"
            />
          </label>

          <label className="location-picker">
            Location
            <div className="location-input-shell">
              <MapPin size={17} aria-hidden="true" />
              <input
                type="search"
                value={locationInput}
                onBlur={() => window.setTimeout(() => setLocationOpen(false), 140)}
                onChange={(event) => handleLocationInput(event.target.value)}
                onFocus={() => setLocationOpen(locationSuggestions.length > 0)}
                placeholder="Type a city and select it"
              />
            </div>
            {selectedLocation && (
              <span className="selected-location-chip">{selectedLocation.label}</span>
            )}
            {locationOpen && (
              <div className="location-suggestion-panel">
                {locationLoading && <span className="location-suggestion-muted">Finding locations...</span>}
                {!locationLoading && locationSuggestions.map((suggestion) => (
                  <button key={suggestion.id} type="button" onMouseDown={() => handleSelectLocation(suggestion)}>
                    <strong>{suggestion.city}</strong>
                    <span>{[suggestion.region, suggestion.countryName].filter(Boolean).join(', ')}</span>
                  </button>
                ))}
                {!locationLoading && locationSuggestions.length === 0 && (
                  <span className="location-suggestion-muted">No matching locations found</span>
                )}
              </div>
            )}
          </label>

          <MultiSelectControl label="Source" allLabel="All sources" options={sourceOptions} selected={selectedSources} onChange={setSelectedSources} />
          <MultiSelectControl label="Type" allLabel="Any type" options={employmentOptions} selected={selectedEmploymentTypes} onChange={setSelectedEmploymentTypes} />
          <MultiSelectControl label="Experience" allLabel="Any level" options={experienceOptions} selected={selectedExperienceLevels} onChange={setSelectedExperienceLevels} />
        </div>

        <div className="search-toolbar-actions">
          <label>
            Salary
            <div className="money-input">
              <span aria-hidden="true">$</span>
              <input
                type="number"
                min="0"
                step="5000"
                value={minSalary || ''}
                onChange={(event) => setMinSalary(Number(event.target.value) || 0)}
                placeholder="Minimum"
              />
            </div>
          </label>

          <SelectMenu label="Results" value={limit} options={limitSelectOptions} onChange={setLimit} />

          <SelectMenu
            className="proximity-control"
            label="Distance"
            value={radiusMiles}
            options={radiusSelectOptions}
            onChange={setRadiusMiles}
            disabled={!selectedLocation}
          />

          <label className="checkbox-control">
            <input type="checkbox" checked={includeRemote} onChange={(event) => setIncludeRemote(event.target.checked)} />
            Include remote jobs
          </label>

          <button className="button primary search-submit" type="submit" disabled={loading}>
            <Filter size={16} aria-hidden="true" />
            {loading ? 'Searching' : 'Search'}
          </button>
        </div>
      </form>

      {providerResults.length > 0 && (
        <section className="provider-progress" aria-label="Provider status">
          <div className="provider-progress-summary">
            <strong>{loading ? 'Live search progress' : 'Source results'}</strong>
            <span>
              {completedProviders}/{providerResults.length} sources complete
              {boardProgress.total > 0 ? `, ${boardProgress.checked}/${boardProgress.total} ATS boards checked` : ''}
              {boardProgress.failed > 0 ? `, ${boardProgress.failed} failed` : ''}
            </span>
          </div>
          <div className="provider-strip">
            {providerResults.map((result) => (
              <span className={`provider-pill ${result.status ?? ''}${result.error ? ' warning' : ''}`} key={result.provider} title={providerStatusTitle(result)}>
                {result.provider}: {providerStatusText(result)}
              </span>
            ))}
          </div>
        </section>
      )}

      {error && <div className="error-banner">{error}</div>}
      {notice && <div className="notice-banner">{notice}</div>}

      <section className="job-grid" aria-label="Job results">
        {jobs.map((job) => (
          <JobCard
            key={job.id}
            job={job}
            pending={pendingJobId === job.id}
            tracking={trackingJobId === job.id}
            onToggleSaved={handleToggleSaved}
            onTrackApplication={handleTrackApplication}
            onOpenJob={handleOpenJob}
            onApplyWithRoleMatch={handleApplyWithRoleMatch}
          />
        ))}
      </section>

      {!loading && !error && hasSearched && jobs.length === 0 && (
        <section className="empty-state">
          <h2>No live matching jobs yet</h2>
          <p>Try a broader keyword, remove narrow filters, select more sources, or widen the distance.</p>
        </section>
      )}

      {!loading && !error && !hasSearched && (
        <section className="empty-state">
          <h2>Ready for a live search</h2>
          <p>Choose only the sources you want to test, then press Search. This page does not run a search automatically.</p>
        </section>
      )}
    </div>
  );
}
