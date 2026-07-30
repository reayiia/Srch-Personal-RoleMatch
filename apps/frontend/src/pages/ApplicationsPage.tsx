import { Cable, CheckCircle2, ChevronDown, Plus, Search, Trash2, WandSparkles } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import type { FormEvent, MouseEvent } from 'react';
import { useSearchParams } from 'react-router-dom';
import { createApplication, formatApplicationDate, getApplications, type ApiApplication, type ApplicationStatus, deleteApplication, scanApplicationEmails, type ApiEmail, updateApplicationStatus as updateApplicationStatusRequest } from '../api/applications';
import { applyWithRoleMatch, checkRoleMatchExtension, connectRoleMatchExtension, openJobWithRoleMatchPanel } from '../utils/rolematchExtension';

const statusFilters: Array<ApplicationStatus | 'all'> = ['all', 'in_progress', 'submitted', 'interview', 'blocked', 'rejected', 'offer'];
const applicationStatuses: ApplicationStatus[] = ['in_progress', 'submitted', 'interview', 'blocked', 'rejected', 'offer'];

function parseStatus(value: string | null): ApplicationStatus | 'all' {
  return statusFilters.includes(value as ApplicationStatus | 'all') ? value as ApplicationStatus | 'all' : 'all';
}

function statusLabel(value: ApplicationStatus | 'all') {
  if (value === 'all') return 'All';
  return value.split('_').map((part) => part[0].toUpperCase() + part.slice(1)).join(' ');
}

export function ApplicationsPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [applications, setApplications] = useState<ApiApplication[]>([]);
  const [query, setQuery] = useState('');
  const [showManualForm, setShowManualForm] = useState(false);
  const [savingManual, setSavingManual] = useState(false);
  const [notice, setNotice] = useState('');
  const [extensionConnected, setExtensionConnected] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [manualApplication, setManualApplication] = useState({
    title: '',
    company: '',
    source: 'Manual',
    jobUrl: '',
    location: '',
    status: 'submitted' as ApplicationStatus,
    evidenceNotes: '',
  });
  const status = parseStatus(searchParams.get('status'));
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [updatingStatusId, setUpdatingStatusId] = useState<string | null>(null);

  const [expandedAppId, setExpandedAppId] = useState<string | null>(null);
  const [emailsLoading, setEmailsLoading] = useState(false);
  const [emailsData, setEmailsData] = useState<ApiEmail[]>([]);
  const [emailsError, setEmailsError] = useState('');
  const [activeEmailId, setActiveEmailId] = useState<string | null>(null);

  const handleToggleEmails = async (appId: string) => {
    // If clicking the same row, close it
    if (expandedAppId === appId) {
      setExpandedAppId(null);
      setActiveEmailId(null);
      return;
    }

    // Otherwise open it and fetch
    setExpandedAppId(appId);
    setActiveEmailId(null);
    setEmailsLoading(true);
    setEmailsError('');
    setEmailsData([]);

    try {
      const result = await scanApplicationEmails(appId);
      setEmailsData(result.emails);
      if (result.application) {
        const updatedApplication = result.application;
        setApplications((currentApplications) => currentApplications.map((application) => (
          application.id === updatedApplication.id ? updatedApplication : application
        )));
        if (result.statusUpdate?.nextStatus) {
          setNotice(`Tracker updated to ${statusLabel(result.statusUpdate.nextStatus)} from inbox evidence.`);
        }
      }
    } catch (err: unknown) {
      setEmailsError(err instanceof Error ? err.message : 'Failed to load emails.');
    } finally {
      setEmailsLoading(false);
    }
  };

  useEffect(() => {
    const loadApplications = async () => {
      setLoading(true);
      setError('');

      try {
        const rows = await getApplications(status);
        setApplications(rows);
      } catch (err: unknown) {
        setError(err instanceof Error ? err.message : 'Unable to load applications.');
      } finally {
        setLoading(false);
      }
    };

    void loadApplications();
  }, [status]);

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

  const filteredApplications = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();

    return applications.filter((application) => {
      const matchesQuery = !normalizedQuery
        || [application.title, application.company, application.source, application.nextStep].some((value) => value.toLowerCase().includes(normalizedQuery));

      return matchesQuery;
    });
  }, [applications, query]);

  const updateStatus = (nextStatus: ApplicationStatus | 'all') => {
    setSearchParams(nextStatus === 'all' ? {} : { status: nextStatus });
  };

  const handleUntrack = async (id: string) => {
    if (!confirm('Are you sure you want to untrack this application?')) return;
    setDeletingId(id);
    try {
      await deleteApplication(id);
      setApplications(current => current.filter(app => app.id !== id));
      setNotice('Application untracked.');
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to untrack application.');
    } finally {
      setDeletingId(null);
    }
  };

  const handleApplicationStatusChange = async (application: ApiApplication, nextStatus: ApplicationStatus) => {
    if (nextStatus === application.status) return;

    setUpdatingStatusId(application.id);
    setError('');
    setNotice('');

    try {
      const updatedApplication = await updateApplicationStatusRequest(application.id, nextStatus);
      setApplications((currentApplications) => {
        const updatedApplications = currentApplications.map((currentApplication) => (
          currentApplication.id === updatedApplication.id ? updatedApplication : currentApplication
        ));
        return status === 'all'
          ? updatedApplications
          : updatedApplications.filter((currentApplication) => currentApplication.status === status);
      });
      setNotice(`${application.title} moved to ${statusLabel(updatedApplication.status)}.`);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Unable to update application status.');
    } finally {
      setUpdatingStatusId(null);
    }
  };

  const handleManualSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSavingManual(true);
    setError('');
    setNotice('');

    try {
      const createdApplication = await createApplication(manualApplication);
      setApplications((currentApplications) => {
        const withoutDuplicate = currentApplications.filter((application) => application.id !== createdApplication.id);
        return status === 'all' || status === createdApplication.status
          ? [createdApplication, ...withoutDuplicate]
          : withoutDuplicate;
      });
      setManualApplication({
        title: '',
        company: '',
        source: 'Manual',
        jobUrl: '',
        location: '',
        status: 'submitted',
        evidenceNotes: '',
      });
      setShowManualForm(false);
      setNotice('Application record saved.');
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Unable to save application record.');
    } finally {
      setSavingManual(false);
    }
  };

  const handleConnectExtension = async () => {
    setError('');
    setNotice('Connecting the local RoleMatch extension...');
    try {
      const result = await connectRoleMatchExtension();
      if (result.ok) {
        setExtensionConnected(true);
        setNotice('RoleMatch extension connected. You can now apply with RoleMatch from job cards.');
      } else {
        setError(result.error ?? 'Unable to connect the RoleMatch extension.');
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Unable to connect the RoleMatch extension.');
    }
  };

  const handleApplyWithRoleMatch = async (application: ApiApplication) => {
    setError('');
    setNotice(`Opening ${application.title} at ${application.company} with RoleMatch autofill...`);
    await createApplication({
      jobId: application.jobId,
      status: 'in_progress',
      evidenceNotes: 'Opened from RoleMatch and started in the external application flow.',
    })
      .then((updatedApplication) => {
        setApplications((currentApplications) => currentApplications.map((currentApplication) => (
          currentApplication.id === updatedApplication.id ? updatedApplication : currentApplication
        )));
      })
      .catch(() => null);
    const result = await applyWithRoleMatch({
      jobId: application.jobId,
      title: application.title,
      company: application.company,
      source: application.source,
      jobUrl: application.jobUrl,
      matchScore: application.matchScore,
    });

    if (result.ok) {
      setNotice(`Opened ${application.title} at ${application.company}. Review the filled application before submitting.`);
    } else {
      setError(result.error ?? 'Unable to start RoleMatch autofill.');
    }
  };

  const handleOpenWithRoleMatchPanel = async (event: MouseEvent<HTMLAnchorElement>, application: ApiApplication) => {
    event.preventDefault();
    setError('');
    setNotice(`Opening ${application.title} at ${application.company} with the RoleMatch panel...`);
    await createApplication({
      jobId: application.jobId,
      status: 'in_progress',
      evidenceNotes: 'Opened from RoleMatch and started in the external application flow.',
    })
      .then((updatedApplication) => {
        setApplications((currentApplications) => currentApplications.map((currentApplication) => (
          currentApplication.id === updatedApplication.id ? updatedApplication : currentApplication
        )));
      })
      .catch(() => null);
    const result = await openJobWithRoleMatchPanel({
      jobId: application.jobId,
      title: application.title,
      company: application.company,
      source: application.source,
      jobUrl: application.jobUrl,
      matchScore: application.matchScore,
    });

    if (result.ok) {
      setNotice(`Opened ${application.title} at ${application.company}. Use Fill visible fields when you are ready.`);
    } else {
      setError(result.error ?? 'Opened the job normally because RoleMatch could not attach the panel.');
    }
  };

  return (
    <div className="page">
      <header className="page-header">
        <div>
          <span className="eyebrow">Tracker</span>
          <h1>Application tracker</h1>
          <p>{loading ? 'Loading application records...' : `${filteredApplications.length} application records in the current workspace`}</p>
        </div>
        <div className="button-row">
          <button className="button secondary" type="button" onClick={handleConnectExtension}>
            {extensionConnected ? <CheckCircle2 size={16} aria-hidden="true" /> : <Cable size={16} aria-hidden="true" />}
            {extensionConnected ? 'Connected' : 'Connect extension'}
          </button>
          <button className="button primary" type="button" onClick={() => setShowManualForm((value) => !value)}>
            <Plus size={16} aria-hidden="true" />
            Add record
          </button>
        </div>
      </header>

      <section className="tracker-toolbar" aria-label="Application filters">
        <label className="input-with-icon">
          <Search size={18} aria-hidden="true" />
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search applications"
          />
        </label>
        <div className="segmented-control" role="group" aria-label="Filter by status">
          {statusFilters.map((filter) => (
            <button
              className={status === filter ? 'active' : ''}
              key={filter}
              type="button"
              onClick={() => updateStatus(filter)}
            >
              {statusLabel(filter)}
            </button>
          ))}
        </div>
      </section>

      {error && <div className="error-banner">{error}</div>}
      {notice && <div className="notice-banner">{notice}</div>}

      {showManualForm && (
        <form className="panel manual-application-form" aria-label="Manual application record" onSubmit={handleManualSubmit}>
          <div className="panel-header">
            <div>
              <span className="eyebrow">Manual entry</span>
              <h2>Add an application record</h2>
            </div>
          </div>
          <div className="form-grid">
            <label>
              Role title
              <input
                value={manualApplication.title}
                onChange={(event) => setManualApplication((current) => ({ ...current, title: event.target.value }))}
                required
              />
            </label>
            <label>
              Company
              <input
                value={manualApplication.company}
                onChange={(event) => setManualApplication((current) => ({ ...current, company: event.target.value }))}
                required
              />
            </label>
            <label>
              Source
              <input
                value={manualApplication.source}
                onChange={(event) => setManualApplication((current) => ({ ...current, source: event.target.value }))}
              />
            </label>
            <label>
              Status
              <select
                value={manualApplication.status}
                onChange={(event) => setManualApplication((current) => ({ ...current, status: event.target.value as ApplicationStatus }))}
              >
                {applicationStatuses.map((option) => (
                  <option key={option} value={option}>{statusLabel(option)}</option>
                ))}
              </select>
            </label>
            <label className="field-full">
              Job URL
              <input
                type="url"
                value={manualApplication.jobUrl}
                onChange={(event) => setManualApplication((current) => ({ ...current, jobUrl: event.target.value }))}
                required
              />
            </label>
            <label>
              Location
              <input
                value={manualApplication.location}
                onChange={(event) => setManualApplication((current) => ({ ...current, location: event.target.value }))}
                placeholder="Boston, Remote, United States"
              />
            </label>
            <label className="field-full">
              Notes
              <textarea
                value={manualApplication.evidenceNotes}
                onChange={(event) => setManualApplication((current) => ({ ...current, evidenceNotes: event.target.value }))}
                placeholder="Confirmation email, blocker, interview date, or next step"
              />
            </label>
          </div>
          <div className="form-actions">
            <button className="button secondary" type="button" onClick={() => setShowManualForm(false)}>
              Cancel
            </button>
            <button className="button primary" type="submit" disabled={savingManual}>
              {savingManual ? 'Saving' : 'Save record'}
            </button>
          </div>
        </form>
      )}

      <section className="panel table-panel" aria-label="Application tracker">
        <div className="application-table">
          <div className="table-row table-head">
            <span>Role</span>
            <span>Source</span>
            <span>Status</span>
            <span>Match</span>
            <span>Last updated</span>
            <span>Next step</span>
            <span>Actions</span>
          </div>
          {filteredApplications.map((application) => (
              <article className="table-row application-row" key={application.id}>
                <div className="application-role-cell">
                  <a
                    className="application-title-link"
                    href={application.jobUrl}
                    target="_blank"
                    rel="noreferrer"
                    onClick={(event) => handleOpenWithRoleMatchPanel(event, application)}
                  >
                    {application.title}
                  </a>
                  <span>{application.company}</span>
                </div>
                <span>{application.source}</span>
                <div className={`application-status-control status-${application.status}${updatingStatusId === application.id ? ' is-updating' : ''}`}>
                  <select
                    aria-label={`Change status for ${application.title}`}
                    value={application.status}
                    disabled={updatingStatusId === application.id}
                    onChange={(event) => void handleApplicationStatusChange(application, event.target.value as ApplicationStatus)}
                  >
                    {applicationStatuses.map((option) => (
                      <option key={option} value={option}>{statusLabel(option)}</option>
                    ))}
                  </select>
                  <ChevronDown size={13} aria-hidden="true" />
                </div>
                <span>{application.matchScore === null ? 'Not scored' : `${application.matchScore}%`}</span>
                <span>{formatApplicationDate(application.lastUpdate)}</span>
                <div>
                  <span>{application.nextStep}</span>
                  <button
                      type="button"
                      className="text-link"
                      onClick={() => handleToggleEmails(application.id)}
                      disabled={emailsLoading && expandedAppId === application.id}
                      style={{
                        background: 'none',
                        border: 'none',
                        padding: '4px 0 0',
                        cursor: emailsLoading && expandedAppId === application.id ? 'wait' : 'pointer',
                        textAlign: 'left',
                        display: 'block'
                      }}
                  >
                    {expandedAppId === application.id
                        ? emailsLoading ? 'Checking inbox...' : 'Close inbox'
                        : 'Check inbox'}
                  </button>
                  {application.blocker && <small>{application.blocker}</small>}
                </div>

                {/* Column 7: Actions (Now a direct child, using Flexbox internally) */}
                <div className="application-row-actions" style={{display: 'flex', alignItems: 'center', gap: '8px'}}>
                  <button
                      type="button"
                      className="button primary"
                      onClick={() => handleApplyWithRoleMatch(application)}
                  >
                    <WandSparkles size={15} aria-hidden="true"/>
                    Apply with RoleMatch
                  </button>
                  <button
                      className="icon-button"
                      style={{border: 'none', color: 'var(--danger)', flexShrink: 0}}
                      onClick={() => handleUntrack(application.id)}
                      disabled={deletingId === application.id}
                      title="Untrack application"
                  >
                    <Trash2 size={16}/>
                  </button>
                </div>

                {/* THE EXPANDED EMAIL DRAWER */}
                {expandedAppId === application.id && (
                    <div style={{
                      gridColumn: '1 / -1', /* Spans the entire table row */
                      padding: '16px',
                      backgroundColor: 'var(--surface-muted)',
                      borderRadius: '8px',
                      marginTop: '8px',
                      border: '1px solid var(--border)'
                    }}>
                      <h4 style={{margin: '0 0 12px 0', fontSize: '0.9rem', color: 'var(--text)'}}>
                        Recent correspondence with {application.company}
                      </h4>

                      {emailsLoading ? (
                          <p className="muted-copy">Searching your Gmail inbox...</p>
                      ) : emailsError ? (
                          <p style={{color: 'var(--danger)', fontSize: '0.85rem', margin: 0}}>{emailsError}</p>
                      ) : emailsData.length > 0 ? (
                          <div style={{display: 'flex', flexDirection: 'column', gap: '8px'}}>
                            {emailsData.map(email => {
                              const isSelected = activeEmailId === email.id;
                              // Clean up formatting like "John Doe <johndoe@company.com>" -> "John Doe"
                              const displayFrom = email.from.replace(/<.*>/, '').replace(/"/g, '').trim();
                              const displayDate = new Date(email.date).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });

                              return (
                                  <div key={email.id} style={{
                                    backgroundColor: 'var(--surface)',
                                    borderRadius: '8px',
                                    border: isSelected ? '1px solid var(--accent)' : '1px solid var(--border)',
                                    overflow: 'hidden'
                                  }}>
                                    {/* Email Card Header */}
                                    <div
                                        onClick={() => setActiveEmailId(isSelected ? null : email.id)}
                                        style={{
                                          padding: '12px 16px',
                                          cursor: 'pointer',
                                          display: 'flex',
                                          flexDirection: 'column',
                                          gap: '4px',
                                          backgroundColor: isSelected ? 'var(--accent-soft)' : 'transparent'
                                        }}
                                    >
                                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
                                        <strong style={{ fontSize: '0.9rem', color: 'var(--text)' }}>{displayFrom}</strong>
                                        <small style={{ fontSize: '0.75rem', color: 'var(--muted)' }}>{displayDate}</small>
                                      </div>
                                      <div style={{ fontSize: '0.85rem', fontWeight: isSelected ? 700 : 600, color: 'var(--text)' }}>
                                        {email.subject || '(No Subject)'}
                                      </div>
                                      {(email.statusSignal || typeof email.matchScore === 'number') && (
                                        <small style={{ color: 'var(--muted)', fontWeight: 700 }}>
                                          {email.statusSignal ? `${statusLabel(email.statusSignal)} signal` : 'Matched email'}
                                          {typeof email.matchScore === 'number' ? ` • ${email.matchScore}% match` : ''}
                                        </small>
                                      )}
                                      {!isSelected && (
                                          <div
                                              style={{ fontSize: '0.8rem', color: 'var(--muted)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}
                                              dangerouslySetInnerHTML={{ __html: email.snippet }}
                                          />
                                      )}
                                    </div>

                                    {/* Sandboxed Email Body */}
                                    {isSelected && (
                                        <div style={{ borderTop: '1px solid var(--border)', height: '400px', backgroundColor: '#ffffff' }}>
                                          <iframe
                                              srcDoc={email.bodyHtml || '<p>No content available</p>'}
                                              style={{ width: '100%', height: '100%', border: 'none' }}
                                              sandbox="allow-popups allow-popups-to-escape-sandbox allow-same-origin"
                                              title={`Email from ${displayFrom}`}
                                          />
                                        </div>
                                    )}
                                  </div>
                              );
                            })}
                          </div>
                      ) : (
                          <p className="muted-copy">No recent emails found matching this company.</p>
                      )}
                    </div>
                )}
              </article>
          ))}
        </div>
      </section>

      {!loading && !error && filteredApplications.length === 0 && (
        <section className="empty-state">
          <h2>No applications yet</h2>
          <p>Saved jobs are not counted here. Application records will appear after an apply flow creates them.</p>
        </section>
      )}
    </div>
  );
}
