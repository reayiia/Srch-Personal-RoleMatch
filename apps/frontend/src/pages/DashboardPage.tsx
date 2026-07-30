import { Bookmark, CheckCircle2, Clock3, FileWarning, Search } from 'lucide-react';
import { Link } from 'react-router-dom';
import { useEffect, useMemo, useState } from 'react';
import { getApplications, type ApiApplication } from '../api/applications';
import { getSavedJobs, type ApiJob } from '../api/jobs';
import { getProfile, type UserProfile } from '../api/profile';
import { JobCard } from '../components/JobCard';
import { StatCard } from '../components/StatCard';
import { StatusBadge } from '../components/StatusBadge';

export function DashboardPage() {
  const [applications, setApplications] = useState<ApiApplication[]>([]);
  const [savedJobs, setSavedJobs] = useState<ApiJob[]>([]);
  const [topMatches, setTopMatches] = useState<ApiJob[]>([]);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [dataError, setDataError] = useState('');

  const submittedApplications = useMemo(() => applications.filter((application) => application.status === 'submitted'), [applications]);
  const inProgressApplications = useMemo(() => applications.filter((application) => application.status === 'in_progress'), [applications]);
  const interviews = useMemo(() => applications.filter((application) => application.status === 'interview'), [applications]);
  const blockedApplications = useMemo(() => applications.filter((application) => application.status === 'blocked'), [applications]);
  const recentApplications = applications.slice(0, 4);

  useEffect(() => {
    const loadDashboardData = async () => {
      setDataError('');

      try {
        const [applicationRows, saved, loadedProfile] = await Promise.all([
          getApplications(),
          getSavedJobs(),
          getProfile(),
        ]);

        setApplications(applicationRows);
        setSavedJobs(saved);
        setTopMatches(saved.slice(0, 3));
        setProfile(loadedProfile);
      } catch (err: unknown) {
        setDataError(err instanceof Error ? err.message : 'Unable to load dashboard data.');
      }
    };

    void loadDashboardData();
  }, []);

  const fittingJobsPath = useMemo(() => {
    const targetRole = profile?.targetRoles?.find((role) => role.trim())
      || profile?.workHistory?.find((work) => work.title?.trim())?.title
      || profile?.skills?.find((skill) => skill.trim())
      || '';
    const targetLocation = profile?.preferredLocations?.find((location) => location.trim())
      || profile?.location
      || '';
    const params = new URLSearchParams({ profileSearch: '1' });

    if (targetRole) params.set('query', targetRole);
    if (targetLocation) params.set('location', targetLocation);

    return `/jobs?${params.toString()}`;
  }, [profile]);

  return (
    <div className="page">
      <header className="page-header">
        <div>
          <span className="eyebrow">Home</span>
          <h1>Job search workspace</h1>
          <p>Search roles, save targets, and track submitted applications from one workspace.</p>
        </div>
        <div className="button-row">
          <Link className="button secondary" to={fittingJobsPath}>
            <Search size={16} aria-hidden="true" />
            View fitting jobs
          </Link>
          <Link className="button primary" to="/jobs">
            <Search size={16} aria-hidden="true" />
            Search jobs
          </Link>
        </div>
      </header>

      <section className="stat-grid" aria-label="Application summary">
        <Link className="stat-link" to="/applications?status=submitted">
          <StatCard icon={CheckCircle2} label="Submitted applications" value={String(submittedApplications.length)} detail="Applications already sent" />
        </Link>
        <Link className="stat-link" to="/applications?status=in_progress">
          <StatCard icon={Clock3} label="In progress" value={String(inProgressApplications.length)} detail="Opened application forms" />
        </Link>
        <Link className="stat-link" to="/applications?status=interview">
          <StatCard icon={Clock3} label="Interviews" value={String(interviews.length)} detail="Submitted roles with interview activity" />
        </Link>
        <Link className="stat-link" to="/applications?status=blocked">
          <StatCard icon={FileWarning} label="Blocked items" value={String(blockedApplications.length)} detail="Need manual attention" />
        </Link>
        <Link className="stat-link" to="/saved">
          <StatCard icon={Bookmark} label="Saved jobs" value={String(savedJobs.length)} detail="Bookmarked roles not yet applied" />
        </Link>
      </section>

      {dataError && <div className="notice-banner">{dataError}</div>}

      <div className="dashboard-grid">
        <section className="panel">
          <div className="panel-header">
            <div>
              <span className="eyebrow">Saved</span>
              <h2>Saved job targets</h2>
            </div>
            <Link className="text-link" to="/saved">View all</Link>
          </div>
          <div className="stack">
            {topMatches.map((job) => (
              <JobCard key={job.id} job={job} compact />
            ))}
            {!dataError && topMatches.length === 0 && (
              <p className="muted-copy">Saved jobs will appear here after you bookmark roles from search results.</p>
            )}
          </div>
        </section>

        <section className="panel">
          <div className="panel-header">
            <div>
              <span className="eyebrow">Tracker</span>
              <h2>Recent applications</h2>
            </div>
            <Link className="text-link" to="/applications">Open tracker</Link>
          </div>
          <div className="compact-list">
            {recentApplications.map((application) => (
              <article className="compact-row" key={application.id}>
                <div>
                  <strong>{application.title}</strong>
                  <span>{application.company} - {application.source}</span>
                </div>
                <StatusBadge status={application.status} />
              </article>
            ))}
            {recentApplications.length === 0 && (
              <p className="muted-copy">No applications have been created yet.</p>
            )}
          </div>
        </section>
      </div>
    </div>
  );
}
