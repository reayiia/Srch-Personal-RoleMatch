import {
  ArrowLeft,
  ArrowRight,
  Check,
  Link2,
  LoaderCircle,
  Plus,
  Trash2,
  Upload,
} from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { API_BASE_URL, authHeaders } from '../../api/client';
import {
  getProfile,
  parseProfileResume,
  suggestProfileSkills,
  updateProfile,
  uploadProfileDocument,
  type EducationEntry,
  type ProjectEntry,
  type ResumeParseResult,
  type UpdateProfileInput,
  type WorkHistoryEntry,
} from '../../api/profile';
import {
  blankEducation,
  blankProject,
  blankWork,
  profileToForm,
} from '../profile/profileUtils';
import { TagInput } from '../TagInput';
import './ProfileOnboarding.css';

interface ProfileOnboardingProps {
  onComplete: () => void;
}

const STEP_LABELS = ['Resume and basics', 'Experience', 'Skills and connections'];

function mergeResumeDraft(current: UpdateProfileInput, result: ResumeParseResult): UpdateProfileInput {
  const draft = result.draft;
  return {
    ...current,
    fullName: draft.fullName || current.fullName,
    phone: draft.phone || current.phone,
    location: draft.location || current.location,
    education: draft.education || current.education,
    workExperience: draft.workExperience || current.workExperience,
    linkedinUrl: draft.linkedinUrl || current.linkedinUrl,
    githubUrl: draft.githubUrl || current.githubUrl,
    portfolioUrl: draft.portfolioUrl || current.portfolioUrl,
    skills: draft.skills.length > 0 ? draft.skills : current.skills,
    relevantCourses: draft.relevantCourses.length > 0 ? draft.relevantCourses : current.relevantCourses,
    educationHistory: draft.educationHistory.length > 0 ? draft.educationHistory : current.educationHistory,
    workHistory: draft.workHistory.length > 0 ? draft.workHistory : current.workHistory,
    projectHistory: draft.projectHistory.length > 0 ? draft.projectHistory : current.projectHistory,
    certifications: draft.certifications.length > 0 ? draft.certifications : current.certifications,
    targetRoles: current.targetRoles.length > 0 ? current.targetRoles : result.targetRoleSuggestions,
  };
}

function withoutEmptyRows(form: UpdateProfileInput): UpdateProfileInput {
  return {
    ...form,
    educationHistory: form.educationHistory.filter((entry) => entry.school || entry.degree || entry.field),
    workHistory: form.workHistory.filter((entry) => entry.company || entry.title),
    projectHistory: form.projectHistory.filter((entry) => entry.name || entry.description || entry.url),
    certifications: form.certifications.filter((entry) => entry.name),
  };
}

export function ProfileOnboarding({ onComplete }: ProfileOnboardingProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [step, setStep] = useState(0);
  const [form, setForm] = useState<UpdateProfileInput | null>(null);
  const [accountEmail, setAccountEmail] = useState('');
  const [resumeFile, setResumeFile] = useState<File | null>(null);
  const [parseResult, setParseResult] = useState<ResumeParseResult | null>(null);
  const [skillSuggestions, setSkillSuggestions] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [parsing, setParsing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const resumeUploaded = useRef(false);
  const currentSkills = form?.skills;

  useEffect(() => {
    void getProfile()
      .then((profile) => {
        setForm(profileToForm(profile));
        setAccountEmail(profile.email ?? '');
      })
      .catch((loadError) => setError(loadError instanceof Error ? loadError.message : 'Unable to load your profile.'))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    if (!currentSkills || step !== 2) return;
    const timeout = window.setTimeout(() => {
      void suggestProfileSkills(currentSkills)
        .then(setSkillSuggestions)
        .catch(() => setSkillSuggestions(parseResult?.suggestedSkills ?? []));
    }, 250);
    return () => window.clearTimeout(timeout);
  }, [currentSkills, parseResult?.suggestedSkills, step]);

  const progress = useMemo(() => ((step + 1) / STEP_LABELS.length) * 100, [step]);

  const update = <K extends keyof UpdateProfileInput>(key: K, value: UpdateProfileInput[K]) => {
    setForm((current) => current ? { ...current, [key]: value } : current);
  };

  const handleResume = async (file: File | null) => {
    if (!file) return;
    setResumeFile(file);
    setParsing(true);
    setError('');
    setNotice('Reading your resume...');
    try {
      const result = await parseProfileResume(file);
      setParseResult(result);
      setSkillSuggestions(result.suggestedSkills);
      setForm((current) => current ? mergeResumeDraft(current, result) : current);
      setNotice(`Imported ${result.draft.skills.length} skills, ${result.draft.workHistory.length} jobs, ${result.draft.educationHistory.length} education entries, and ${result.draft.projectHistory.length} projects. Review before saving.`);
    } catch (parseError) {
      setError(parseError instanceof Error ? parseError.message : 'Resume import failed.');
      setNotice('');
    } finally {
      setParsing(false);
    }
  };

  const persist = async () => {
    if (!form) return;
    setSaving(true);
    setError('');
    try {
      await updateProfile(withoutEmptyRows(form));
      if (resumeFile && !resumeUploaded.current) {
        await uploadProfileDocument(resumeFile, 'resume', 'Primary resume');
        resumeUploaded.current = true;
      }
    } finally {
      setSaving(false);
    }
  };

  const finish = async () => {
    try {
      await persist();
      onComplete();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'Unable to save profile setup.');
    }
  };

  const connectGmail = async () => {
    try {
      await persist();
      const response = await fetch(`${API_BASE_URL}/api/auth/google`, { headers: authHeaders() });
      const data = await response.json() as { url?: string; error?: string };
      if (!response.ok || !data.url) throw new Error(data.error || 'Unable to start Gmail connection.');
      window.location.assign(data.url);
    } catch (connectionError) {
      setError(connectionError instanceof Error ? connectionError.message : 'Unable to connect Gmail.');
    }
  };

  if (loading || !form) {
    return <div className="onboarding-loading"><LoaderCircle className="spin" /> Loading profile setup...</div>;
  }

  return (
    <section className="onboarding-tool" aria-label="Profile setup">
      <header className="onboarding-header">
        <div>
          <span className="onboarding-step">Step {step + 1} of {STEP_LABELS.length}</span>
          <h2>{STEP_LABELS[step]}</h2>
        </div>
        <button type="button" className="text-command" onClick={finish} disabled={saving}>Finish later</button>
      </header>
      <div className="onboarding-progress" aria-hidden="true"><span style={{ width: `${progress}%` }} /></div>

      {step === 0 && (
        <div className="onboarding-content">
          <button type="button" className="resume-import" onClick={() => fileInputRef.current?.click()} disabled={parsing}>
            {parsing ? <LoaderCircle className="spin" /> : resumeFile ? <Check /> : <Upload />}
            <span>
              <strong>{resumeFile ? resumeFile.name : 'Import a resume'}</strong>
              <small>PDF, DOCX, or TXT, up to 10 MB</small>
            </span>
          </button>
          <input ref={fileInputRef} className="visually-hidden" type="file" accept=".pdf,.docx,.txt" onChange={(event) => void handleResume(event.target.files?.[0] ?? null)} />

          {notice && <p className="onboarding-notice">{notice}</p>}
          {parseResult?.warnings.map((warning) => <p className="onboarding-warning" key={warning}>{warning}</p>)}

          <div className="onboarding-form-grid">
            <label>Full name<input value={form.fullName} onChange={(event) => update('fullName', event.target.value)} autoComplete="name" /></label>
            <label>Account email<input value={accountEmail} readOnly aria-readonly="true" /></label>
            <label>Phone<input value={form.phone} onChange={(event) => update('phone', event.target.value)} autoComplete="tel" /></label>
            <label>Location<input value={form.location} onChange={(event) => update('location', event.target.value)} autoComplete="address-level2" /></label>
            <label>Date of birth<input type="date" value={form.dateOfBirth} onChange={(event) => update('dateOfBirth', event.target.value)} /></label>
            <label>Portfolio<input value={form.portfolioUrl} onChange={(event) => update('portfolioUrl', event.target.value)} placeholder="https://" /></label>
          </div>
        </div>
      )}

      {step === 1 && (
        <div className="onboarding-content history-sections">
          <HistoryEditor<WorkHistoryEntry>
            title="Work history"
            entries={form.workHistory}
            blank={blankWork}
            onChange={(entries) => update('workHistory', entries)}
            render={(entry, change) => (
              <>
                <label>Job title<input value={entry.title} onChange={(event) => change({ ...entry, title: event.target.value })} /></label>
                <label>Company<input value={entry.company} onChange={(event) => change({ ...entry, company: event.target.value })} /></label>
                <label>Start<input value={entry.startDate ?? ''} onChange={(event) => change({ ...entry, startDate: event.target.value })} placeholder="Month YYYY" /></label>
                <label>End<input value={entry.endDate ?? ''} onChange={(event) => change({ ...entry, endDate: event.target.value })} placeholder="Present" /></label>
                <label className="wide-field">Highlights<textarea value={(entry.highlights ?? []).join('\n')} onChange={(event) => change({ ...entry, highlights: event.target.value.split('\n').filter(Boolean) })} rows={3} /></label>
              </>
            )}
          />
          <HistoryEditor<EducationEntry>
            title="Education"
            entries={form.educationHistory}
            blank={blankEducation}
            onChange={(entries) => update('educationHistory', entries)}
            render={(entry, change) => (
              <>
                <label>School<input value={entry.school} onChange={(event) => change({ ...entry, school: event.target.value })} /></label>
                <label>Degree<input value={entry.degree} onChange={(event) => change({ ...entry, degree: event.target.value })} /></label>
                <label>Field<input value={entry.field} onChange={(event) => change({ ...entry, field: event.target.value })} /></label>
                <label>End date<input value={entry.endDate ?? ''} onChange={(event) => change({ ...entry, endDate: event.target.value })} placeholder="Month YYYY" /></label>
              </>
            )}
          />
          <HistoryEditor<ProjectEntry>
            title="Projects"
            entries={form.projectHistory}
            blank={blankProject}
            onChange={(entries) => update('projectHistory', entries)}
            render={(entry, change) => (
              <>
                <label>Project name<input value={entry.name} onChange={(event) => change({ ...entry, name: event.target.value })} /></label>
                <label>Link<input value={entry.url ?? ''} onChange={(event) => change({ ...entry, url: event.target.value })} placeholder="https://" /></label>
                <label className="wide-field">Description<textarea value={entry.description ?? ''} onChange={(event) => change({ ...entry, description: event.target.value })} rows={3} /></label>
              </>
            )}
          />
        </div>
      )}

      {step === 2 && (
        <div className="onboarding-content onboarding-final">
          <TagInput label="Skills" value={form.skills} onChange={(value) => update('skills', value)} placeholder="Type a skill and press Enter" />
          {skillSuggestions.length > 0 && (
            <div className="skill-suggestions">
              <span>Suggested from your profile</span>
              <div>{skillSuggestions.map((skill) => (
                <button type="button" key={skill} onClick={() => update('skills', [...form.skills, skill])}><Plus size={14} />{skill}</button>
              ))}</div>
            </div>
          )}
          <TagInput label="Target roles" value={form.targetRoles} onChange={(value) => update('targetRoles', value)} placeholder="Type a role and press Enter" />
          <TagInput label="Relevant courses" value={form.relevantCourses} onChange={(value) => update('relevantCourses', value)} placeholder="Type a course and press Enter" />

          <div className="onboarding-form-grid">
            <label>LinkedIn<input value={form.linkedinUrl} onChange={(event) => update('linkedinUrl', event.target.value)} placeholder="https://linkedin.com/in/..." /></label>
            <label>GitHub<input value={form.githubUrl} onChange={(event) => update('githubUrl', event.target.value)} placeholder="https://github.com/..." /></label>
            <label>Work authorization<input value={form.workAuthorization} onChange={(event) => update('workAuthorization', event.target.value)} /></label>
            <label>Preferred locations<input value={form.preferredLocations.join(', ')} onChange={(event) => update('preferredLocations', event.target.value.split(',').map((value) => value.trim()).filter(Boolean))} placeholder="Boston, MA; Remote" /></label>
          </div>

          <div className="connection-row">
            <div><Link2 /><span><strong>Gmail</strong><small>Match application updates after you choose Check inbox.</small></span></div>
            <button type="button" onClick={() => void connectGmail()} disabled={saving}>Connect Gmail</button>
          </div>
          <p className="privacy-note">RoleMatch saves profile data to your backend. ATS passwords stay in your browser password manager and are not stored in RoleMatch.</p>
        </div>
      )}

      {error && <p className="onboarding-error">{error}</p>}

      <footer className="onboarding-footer">
        <button type="button" className="secondary-command" onClick={() => setStep((value) => Math.max(0, value - 1))} disabled={step === 0 || saving}>
          <ArrowLeft /> Back
        </button>
        {step < STEP_LABELS.length - 1 ? (
          <button type="button" className="primary-command" onClick={() => setStep((value) => Math.min(STEP_LABELS.length - 1, value + 1))} disabled={parsing}>
            Continue <ArrowRight />
          </button>
        ) : (
          <button type="button" className="primary-command" onClick={() => void finish()} disabled={saving}>
            {saving ? <LoaderCircle className="spin" /> : <Check />} Complete setup
          </button>
        )}
      </footer>
    </section>
  );
}

interface HistoryEditorProps<T> {
  title: string;
  entries: T[];
  blank: () => T;
  onChange: (entries: T[]) => void;
  render: (entry: T, change: (entry: T) => void) => React.ReactNode;
}

function HistoryEditor<T>({ title, entries, blank, onChange, render }: HistoryEditorProps<T>) {
  const rows = entries.length > 0 ? entries : [blank()];
  return (
    <section className="history-editor">
      <div className="history-heading">
        <h3>{title}</h3>
        <button type="button" title={`Add ${title.toLowerCase()} entry`} onClick={() => onChange([...rows, blank()])}><Plus /><span>Add</span></button>
      </div>
      {rows.map((entry, index) => (
        <div className="history-row" key={index}>
          <div className="history-grid">
            {render(entry, (nextEntry) => onChange(rows.map((item, itemIndex) => itemIndex === index ? nextEntry : item)))}
          </div>
          <button type="button" className="delete-row" title="Remove entry" aria-label={`Remove ${title.toLowerCase()} entry ${index + 1}`} onClick={() => onChange(rows.filter((_, itemIndex) => itemIndex !== index))}><Trash2 /></button>
        </div>
      ))}
    </section>
  );
}
