import { BookmarkCheck, Cable, CheckCircle2, SlidersHorizontal } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { createApplication, deleteApplicationByJobId } from '../api/applications';
import { getSavedJobs, setJobSaved, type ApiJob } from '../api/jobs';
import { JobCard } from '../components/JobCard';
import { SelectMenu, type SelectMenuOption } from '../components/SelectMenu';
import { applyWithRoleMatch, checkRoleMatchExtension, connectRoleMatchExtension, openJobWithRoleMatchPanel } from '../utils/rolematchExtension';

type SortKey = 'match' | 'salary' | 'location' | 'position';

const sortOptions: Array<SelectMenuOption<SortKey>> = [
  { value: 'match', label: 'Match score' },
  { value: 'salary', label: 'Salary' },
  { value: 'location', label: 'Location' },
  { value: 'position', label: 'Position' },
];

function salaryValue(job: ApiJob) {
  return job.salaryMax ?? job.salaryMin ?? 0;
}

export function SavedJobsPage() {
  const [savedJobs, setSavedJobs] = useState<ApiJob[]>([]);
  const [sortKey, setSortKey] = useState<SortKey>('match');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [extensionConnected, setExtensionConnected] = useState(false);
  const [pendingJobId, setPendingJobId] = useState<string | null>(null);
  const [trackingJobId, setTrackingJobId] = useState<string | null>(null);

  useEffect(() => {
    const loadSavedJobs = async () => {
      setLoading(true);
      setError('');

      try {
        const jobs = await getSavedJobs();
        setSavedJobs(jobs);
      } catch (err: unknown) {
        setError(err instanceof Error ? err.message : 'Unable to load saved jobs.');
      } finally {
        setLoading(false);
      }
    };

    void loadSavedJobs();
  }, []);

  useEffect(() => {
    let cancelled = false;

    checkRoleMatchExtension()
      .then((result) => {
        if (!cancelled && result.ok && result.connection) {
          setExtensionConnected(true);
        }
      })
      .catch(() => {
        if (!cancelled) setExtensionConnected(false);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  const sortedJobs = useMemo(() => {
    return [...savedJobs].sort((first, second) => {
      if (sortKey === 'salary') return salaryValue(second) - salaryValue(first);
      if (sortKey === 'location') return first.location.localeCompare(second.location);
      if (sortKey === 'position') return first.title.localeCompare(second.title);

      return second.matchScore - first.matchScore;
    });
  }, [savedJobs, sortKey]);

  const handleToggleSaved = async (job: ApiJob) => {
    setPendingJobId(job.id);
    setError('');
    setNotice('');

    try {
      await setJobSaved(job.id, false);
      setSavedJobs((currentJobs) => currentJobs.filter((currentJob) => currentJob.id !== job.id));
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

      setSavedJobs((currentJobs) => currentJobs.map((currentJob) => (
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
        setSavedJobs((currentJobs) => currentJobs.map((currentJob) => (
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
        setSavedJobs((currentJobs) => currentJobs.map((currentJob) => (
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

  const handleConnectExtension = async () => {
    setError('');
    setNotice('Connecting the local RoleMatch extension...');
    try {
      const result = await connectRoleMatchExtension();
      if (result.ok) {
        setExtensionConnected(true);
        setNotice('RoleMatch extension connected. You can now apply with RoleMatch from saved jobs.');
      } else {
        setError(result.error ?? 'Unable to connect the RoleMatch extension.');
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Unable to connect the RoleMatch extension.');
    }
  };

  return (
    <div className="page">
      <header className="page-header">
        <div>
          <span className="eyebrow">Saved jobs</span>
          <h1>Saved jobs</h1>
          <p>{loading ? 'Loading saved roles...' : `${savedJobs.length} roles queued for review`}</p>
        </div>
        <div className="button-row">
          <button className="button secondary" type="button" onClick={handleConnectExtension}>
            {extensionConnected ? <CheckCircle2 size={16} aria-hidden="true" /> : <Cable size={16} aria-hidden="true" />}
            {extensionConnected ? 'Extension connected' : 'Connect extension'}
          </button>
          <div className="sort-control">
            <SlidersHorizontal size={16} aria-hidden="true" />
            <SelectMenu label="Sort" value={sortKey} options={sortOptions} onChange={setSortKey} />
          </div>
        </div>
      </header>

      <section className="summary-strip" aria-label="Saved job summary">
        <div>
          <BookmarkCheck size={18} aria-hidden="true" />
          <span>{savedJobs.length} saved roles</span>
        </div>
        <div>
          <SlidersHorizontal size={18} aria-hidden="true" />
          <span>Per-job match scores</span>
        </div>
      </section>

      {error && <div className="error-banner">{error}</div>}
      {notice && <div className="notice-banner">{notice}</div>}

      <section className="job-grid" aria-label="Saved job list">
        {sortedJobs.map((job) => (
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

      {!loading && !error && sortedJobs.length === 0 && (
        <section className="empty-state">
          <h2>No saved jobs yet</h2>
          <p>Bookmark roles from job search and they will appear here for later review.</p>
        </section>
      )}
    </div>
  );
}
