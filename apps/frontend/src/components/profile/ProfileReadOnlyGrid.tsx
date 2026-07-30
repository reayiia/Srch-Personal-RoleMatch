import {
  BookMarked,
  FileText,
  GitBranch,
  GraduationCap,
  Hammer,
  Link2,
  Mail,
  MapPin,
  NotebookPen,
  NotebookTabs,
  PocketKnife,
  Target,
  User2,
} from 'lucide-react';
import { openProfileDocument, type ProfileDocument, type UserProfile } from '../../api/profile';
import { ConnectionRow, ExpandableView, ProfileTagsPanel } from './ProfileShared';

interface ProfileReadOnlyGridProps {
  profile: UserProfile;
  applicationDocuments: ProfileDocument[];
  isGmailConnected: boolean;
  isConnectingGmail: boolean;
  isHoveringGmail: boolean;
  onConnectGmail: () => void;
  onDisconnectGmail: () => void;
  onGmailHoverChange: (isHovering: boolean) => void;
}

function ageFromDate(value?: string | null) {
  if (!value) return '';
  const birthDate = new Date(value);
  if (Number.isNaN(birthDate.getTime())) return '';
  const today = new Date();
  let age = today.getFullYear() - birthDate.getFullYear();
  const monthDelta = today.getMonth() - birthDate.getMonth();
  if (monthDelta < 0 || (monthDelta === 0 && today.getDate() < birthDate.getDate())) {
    age -= 1;
  }

  return age >= 0 && age < 120 ? String(age) : '';
}

export function ProfileReadOnlyGrid({
  profile,
  applicationDocuments,
  isGmailConnected,
  isConnectingGmail,
  isHoveringGmail,
  onConnectGmail,
  onDisconnectGmail,
  onGmailHoverChange,
}: ProfileReadOnlyGridProps) {
  const age = ageFromDate(profile.dateOfBirth);

  return (
    <div className="profile-grid">
      <div style={{ display: 'flex', flexDirection: 'column', gap: '18px' }}>
        <ExpandableView title="Education" icon={<GraduationCap size={18} />}>
          <div className="stack">
            {profile.educationHistory && profile.educationHistory.length > 0 && profile.educationHistory[0].school !== '' ? (
              profile.educationHistory.map((edu, index) => (
                <div
                  key={index}
                  style={{
                    padding: '12px 0',
                    borderBottom: index !== profile.educationHistory!.length - 1 ? '1px solid var(--border)' : 'none',
                  }}
                >
                  <strong>{edu.school}</strong>
                  <div style={{ fontSize: '0.9rem' }}>{edu.degree} {edu.field && `in ${edu.field}`}</div>
                  <div className="muted-copy" style={{ fontSize: '0.85rem', marginTop: '4px' }}>
                    {edu.startDate || 'Unknown'} - {edu.endDate || 'Unknown'} {edu.location && `| ${edu.location}`} {edu.gpa && `| GPA: ${edu.gpa}`}
                  </div>
                  {edu.courses && edu.courses.length > 0 && (
                    <div className="tag-row" style={{ marginTop: '8px' }}>
                      {edu.courses.map((course) => <span className="tag" key={course}>{course}</span>)}
                    </div>
                  )}
                </div>
              ))
            ) : <p className="muted-copy">No education added.</p>}
          </div>
        </ExpandableView>

        <ProfileTagsPanel title="Relevant courses" icon={<NotebookPen size={18} />} tags={profile.relevantCourses ?? []} fallback="No courses added yet." />

        <ProfileTagsPanel title="Target roles" icon={<Target size={18} />} tags={profile.targetRoles ?? []} fallback="No target roles added yet." />

        <ExpandableView title="Location" icon={<MapPin size={18} />}>
          <dl className="detail-list">
            <p className="muted-copy">{profile.location || 'Location not provided'}</p>
          </dl>
        </ExpandableView>

        <ExpandableView title="Demographic" icon={<User2 size={18} />}>
          <dl className="detail-list">
            <div>
              <dt>Date of Birth</dt>
              <dd>{profile.dateOfBirth || 'Not provided'}</dd>
            </div>
            <div>
              <dt>Age</dt>
              <dd>{age || 'Not provided'}</dd>
            </div>
            <div>
              <dt>Gender</dt>
              <dd>{profile.gender || 'Not provided'}</dd>
            </div>
            <div>
              <dt>Race/Ethnicity</dt>
              <dd>{profile.race || 'Not provided'}</dd>
            </div>
            <div>
              <dt>Veteran Status</dt>
              <dd>{profile.veteranStatus || 'Not provided'}</dd>
            </div>
            <div>
              <dt>Disability Status</dt>
              <dd>{profile.disabilityStatus || 'Not provided'}</dd>
            </div>
            <div>
              <dt>Years Professional Exp.</dt>
              <dd>{profile.autofillAnswers?.yearsProfessionalExperience || 'Not provided'}</dd>
            </div>
            <div>
              <dt>Willing to Relocate</dt>
              <dd>{profile.autofillAnswers?.willingToRelocate || 'Not provided'}</dd>
            </div>
            <div>
              <dt>Earliest Start Date</dt>
              <dd>{profile.autofillAnswers?.earliestStartDate || 'Not provided'}</dd>
            </div>
          </dl>
          {profile.autofillAnswers?.custom && profile.autofillAnswers.custom.length > 0 && (
            <div style={{ marginTop: '16px' }}>
              <h3 style={{ fontSize: '0.9rem', marginBottom: '8px' }}>Custom Answers</h3>
              {profile.autofillAnswers.custom.map((answer, index) => (
                <div
                  key={index}
                  style={{
                    padding: '8px',
                    background: 'var(--surface-muted)',
                    borderRadius: '6px',
                    marginBottom: '8px',
                  }}
                >
                  <strong style={{ fontSize: '0.85rem', display: 'block', color: 'var(--text)' }}>Q: {answer.label}</strong>
                  <span style={{ fontSize: '0.85rem', color: 'var(--muted)' }}>A: {answer.answer}</span>
                </div>
              ))}
            </div>
          )}
        </ExpandableView>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: '18px' }}>
        <ExpandableView title="Work Experience" icon={<Hammer size={18} />}>
          <div className="stack">
            {profile.workHistory && profile.workHistory.length > 0 && profile.workHistory[0].company !== '' ? (
              profile.workHistory.map((work, index) => (
                <div
                  key={index}
                  style={{
                    padding: '12px 0',
                    borderBottom: index !== profile.workHistory!.length - 1 ? '1px solid var(--border)' : 'none',
                  }}
                >
                  <strong>{work.title}</strong> at <strong>{work.company}</strong>
                  <div className="muted-copy" style={{ fontSize: '0.85rem', marginTop: '4px' }}>
                    {work.startDate || 'Unknown'} - {work.current ? 'Present' : (work.endDate || 'Unknown')} {work.location && `| ${work.location}`}
                  </div>
                  {work.highlights && work.highlights.length > 0 && (
                    <ul style={{ margin: '8px 0', paddingLeft: '20px', fontSize: '0.9rem' }}>
                      {work.highlights.map((highlight, highlightIndex) => <li key={highlightIndex}>{highlight}</li>)}
                    </ul>
                  )}
                  {work.skills && work.skills.length > 0 && (
                    <div className="tag-row" style={{ marginTop: '8px' }}>
                      {work.skills.map((skill) => <span className="tag" key={skill}>{skill}</span>)}
                    </div>
                  )}
                </div>
              ))
            ) : <p className="muted-copy">No work history added.</p>}
          </div>
        </ExpandableView>

        <ProfileTagsPanel title="Skills" icon={<PocketKnife size={18} />} tags={profile.skills ?? []} fallback="No skills added yet." />

        <ExpandableView title="Linked Accounts" icon={<Link2 size={18} />}>
          <div className="connection-list">
            <ConnectionRow icon={<GitBranch size={18} />} label="GitHub" url={profile.githubUrl ?? ''} />
            <ConnectionRow icon={<Link2 size={18} />} label="LinkedIn" url={profile.linkedinUrl ?? ''} />
            <ConnectionRow icon={<Link2 size={18} />} label="Portfolio" url={profile.portfolioUrl ?? ''} />
            <ConnectionRow icon={<Link2 size={18} />} label="Indeed" url={profile.indeedUrl ?? ''} />
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                <Mail size={18} aria-hidden="true" />
                <span>Email tracking</span>
              </div>

              {isGmailConnected ? (
                <button
                  type="button"
                  onMouseEnter={() => onGmailHoverChange(true)}
                  onMouseLeave={() => onGmailHoverChange(false)}
                  onClick={onDisconnectGmail}
                  style={{
                    minHeight: '32px',
                    padding: '4px 12px',
                    fontSize: '0.85rem',
                    border: '1px solid',
                    borderRadius: '8px',
                    cursor: 'pointer',
                    fontWeight: 700,
                    transition: 'all 0.2s ease',
                    color: isHoveringGmail ? 'var(--danger)' : 'var(--success)',
                    backgroundColor: isHoveringGmail ? 'var(--danger-soft)' : 'var(--success-soft)',
                    borderColor: isHoveringGmail ? 'var(--danger-soft)' : 'var(--success-soft)',
                  }}
                >
                  {isHoveringGmail ? 'Disconnect' : 'Gmail connected'}
                </button>
              ) : (
                <button
                  className="button secondary"
                  type="button"
                  onClick={onConnectGmail}
                  disabled={isConnectingGmail}
                  style={{ minHeight: '32px', padding: '4px 12px', fontSize: '0.85rem' }}
                >
                  {isConnectingGmail ? 'Connecting...' : 'Connect Gmail'}
                </button>
              )}
            </div>
          </div>
        </ExpandableView>

        <ExpandableView title="Projects" icon={<NotebookTabs size={18} />}>
          <div className="stack">
            {profile.projectHistory && profile.projectHistory.length > 0 && profile.projectHistory[0].name !== '' ? (
              profile.projectHistory.map((project, index) => (
                <div
                  key={index}
                  style={{
                    padding: '12px 0',
                    borderBottom: index !== profile.projectHistory!.length - 1 ? '1px solid var(--border)' : 'none',
                  }}
                >
                  <strong>{project.name}</strong> {project.role && <span className="muted-copy"> - {project.role}</span>}
                  {project.url && (
                    <div>
                      <a href={project.url} target="_blank" rel="noreferrer" className="text-link" style={{ fontSize: '0.85rem' }}>{project.url}</a>
                    </div>
                  )}
                  {project.description && <p style={{ fontSize: '0.9rem', marginTop: '6px' }}>{project.description}</p>}
                  {project.technologies && project.technologies.length > 0 && (
                    <div className="tag-row" style={{ marginTop: '8px' }}>
                      {project.technologies.map((technology) => <span className="tag" key={technology}>{technology}</span>)}
                    </div>
                  )}
                </div>
              ))
            ) : <p className="muted-copy">No projects added.</p>}
          </div>
        </ExpandableView>

        <ExpandableView title="Application material" icon={<BookMarked size={18} />}>
          <div className="compact-list">
            {applicationDocuments.length > 0 ? applicationDocuments.map((document) => (
              <article className="compact-row" key={document.id}>
                <div>
                  <strong>{document.label}</strong>
                  <span>{document.documentType} - {document.fileName}</span>
                </div>
                <button
                  type="button"
                  className="text-link icon-link"
                  title="Open document"
                  onClick={() => void openProfileDocument(document).catch((error) => window.alert(error instanceof Error ? error.message : 'Unable to open document.'))}
                >
                  <FileText size={20} aria-hidden="true" />
                </button>
              </article>
            )) : <p className="muted-copy">No documents uploaded yet.</p>}
          </div>
        </ExpandableView>
      </div>
    </div>
  );
}
