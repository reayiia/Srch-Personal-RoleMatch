import { useEffect, useMemo, useState } from 'react';
import type { ChangeEvent, FormEvent } from 'react';
import {
  Camera,
  FileText,
  Image as ImageIcon,
  Info,
  Pencil,
  Plus,
  Save,
  Trash2,
  Upload,
  X,
} from 'lucide-react';
import {API_BASE_URL, authHeaders} from '../api/client';
import {
  getProfile,
  openProfileDocument,
  updateProfile,
  uploadProfileDocument,
  type CustomAutofillAnswer,
  type EducationEntry,
  type ProjectEntry,
  type UpdateProfileInput,
  type UserProfile,
  type WorkHistoryEntry,
  uploadProfilePicture,
} from '../api/profile';
import { AutocompleteField, CommaField, EditorList } from '../components/profile/ProfileShared';
import { AtsCredentialManager } from '../components/profile/AtsCredentialManager';
import { ProfileReadOnlyGrid } from '../components/profile/ProfileReadOnlyGrid';
import {
  blankCustomAutofill,
  blankEducation,
  blankProject,
  blankWork,
  compactProfileSubtitle,
  documentUrl,
  hasContent,
  latestDocumentByType,
  profileToForm,
  type ScalarAutofillKey,
} from '../components/profile/profileUtils';
import { TagInput } from '../components/TagInput';
import { notifyRoleMatchProfileUpdated } from '../utils/rolematchExtension';
import {useSearchParams} from "react-router-dom";

export function ProfilePage() {
  const [searchParams] = useSearchParams();
  const [isConnectingGmail, setIsConnectingGmail] = useState(false);
  const [isHoveringGmail, setIsHoveringGmail] = useState(false);
  const [isDisconnectModalOpen, setIsDisconnectModalOpen] = useState(false);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [form, setForm] = useState<UpdateProfileInput | null>(null);
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [mediaUploading, setMediaUploading] = useState<'profile-photo' | 'profile-banner' | null>(null);
  const [documentType, setDocumentType] = useState('resume');
  const [documentLabel, setDocumentLabel] = useState('');
  const [documentFile, setDocumentFile] = useState<File | null>(null);
  const [fileInputKey, setFileInputKey] = useState(0);
  const [loading, setLoading] = useState(true);
  const [notice, setNotice] = useState('');
  const [uploadingAvatar, setUploadingAvatar] = useState(false);

  const isInitiallyConnected = searchParams.get('gmail') === 'connected';
  const [error, setError] = useState(
      searchParams.get('gmail') === 'error' ? 'Failed to connect Gmail. Please try again.' : ''
  );

  const [isGmailConnected, setIsGmailConnected] = useState(isInitiallyConnected);

  useEffect(() => {
    const fetchProfile = async () => {
      try {
        const loadedProfile = await getProfile();
        setProfile(loadedProfile);
        setForm(profileToForm(loadedProfile));

        // Ensure UI stays synced with the database reality!
        setIsGmailConnected(Boolean(loadedProfile.isGmailConnected));
        if (loadedProfile.gmailConnectionIssue) {
          setError(loadedProfile.gmailConnectionIssue);
        }

      } catch (err: unknown) {
        setError(err instanceof Error ? err.message : 'Unable to load profile.');
      } finally {
        setLoading(false);
      }
    };

    void fetchProfile();
  }, []);

  const documentCounts = useMemo(() => {
    const documents = profile?.documents ?? [];
    const applicationDocuments = documents.filter((document) => !['profile-photo', 'profile-banner'].includes(document.documentType));

    return {
      total: applicationDocuments.length,
      resumes: applicationDocuments.filter((document) => document.documentType === 'resume').length,
      templates: applicationDocuments.filter((document) => document.documentType === 'cover-letter-template').length,
    };
  }, [profile?.documents]);

  const avatarUrl = profile?.avatarUrl;

  const profilePhotoUrl = useMemo(() => documentUrl(latestDocumentByType(profile?.documents, 'profile-photo')), [profile?.documents]);
  const profileBannerUrl = useMemo(() => documentUrl(latestDocumentByType(profile?.documents, 'profile-banner')), [profile?.documents]);
  const profileAvatarUrl = useMemo(() => {
    if (avatarUrl) return `${API_BASE_URL}${avatarUrl}`;
    return profilePhotoUrl;
  }, [avatarUrl, profilePhotoUrl]);

  const applicationDocuments = useMemo(
      () => (profile?.documents ?? []).filter((document) => !['profile-photo', 'profile-banner'].includes(document.documentType)),
      [profile?.documents],
  );

  const profileStats = useMemo(() => {
    const courseSet = new Set([
      ...(profile?.relevantCourses ?? []),
      ...((profile?.educationHistory ?? []).flatMap((entry) => entry.courses ?? [])),
    ].filter((item) => item.trim()));
    const linkedAccounts = [
      profile?.linkedinUrl,
      profile?.githubUrl,
      profile?.portfolioUrl,
      profile?.indeedUrl,
    ].filter(hasContent).length;

    return [
      { label: 'work experiences', value: (profile?.workHistory ?? []).filter((entry) => hasContent(entry.company) || hasContent(entry.title)).length },
      { label: 'courses', value: courseSet.size },
      { label: 'target roles', value: (profile?.targetRoles ?? []).filter((item) => item.trim()).length },
      { label: 'skills', value: (profile?.skills ?? []).filter((item) => item.trim()).length },
      { label: 'linked accounts', value: linkedAccounts },
      { label: 'docs', value: documentCounts.total },
    ];
  }, [documentCounts.total, profile]);

  const updateForm = <Key extends keyof UpdateProfileInput>(key: Key, value: UpdateProfileInput[Key]) => {
    setForm((current) => current ? { ...current, [key]: value } : current);
  };

  useEffect(() => {
    if (searchParams.has('gmail')) {
      const newUrl = new URL(window.location.href);
      newUrl.searchParams.delete('gmail');
      window.history.replaceState({}, '', newUrl);
    }
  }, [searchParams]);

  const updateAutofill = (key: ScalarAutofillKey, value: string) => {
    setForm((current) => current ? {
      ...current,
      autofillAnswers: { ...current.autofillAnswers, [key]: value },
    } : current);
  };

  const updateCustomAutofill = (index: number, patch: Partial<CustomAutofillAnswer>) => {
    setForm((current) => {
      if (!current) return current;
      const custom = current.autofillAnswers.custom ?? [];

      return {
        ...current,
        autofillAnswers: {
          ...current.autofillAnswers,
          custom: custom.map((entry, itemIndex) => itemIndex === index ? { ...entry, ...patch } : entry),
        },
      };
    });
  };

  const addCustomAutofill = () => {
    setForm((current) => current ? {
      ...current,
      autofillAnswers: {
        ...current.autofillAnswers,
        custom: [...(current.autofillAnswers.custom ?? []), blankCustomAutofill()],
      },
    } : current);
  };

  const removeCustomAutofill = (index: number) => {
    setForm((current) => current ? {
      ...current,
      autofillAnswers: {
        ...current.autofillAnswers,
        custom: (current.autofillAnswers.custom ?? []).filter((_, itemIndex) => itemIndex !== index),
      },
    } : current);
  };

  const handleEdit = () => {
    if (!profile) return;
    setForm(profileToForm(profile));
    setNotice('');
    setError('');
    setEditing(true);
  };

  const handleCancel = () => {
    if (profile) setForm(profileToForm(profile));
    setEditing(false);
  };

  const handleConnectGmail = async () => {
    setIsConnectingGmail(true);
    setError('');

    try {
      const response = await fetch(`${API_BASE_URL}/api/auth/google`, {
        headers: authHeaders()
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Failed to initiate Google connection.');
      }

      if (data.url) {
        window.location.href = data.url;
      } else {
        throw new Error('No authentication URL returned.');
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to initiate Google connection.');
      setIsConnectingGmail(false);
    }
  };

  const handleDisconnectClick = () => {
    setIsDisconnectModalOpen(true);
  };

  const confirmDisconnectGmail = async () => {
    setIsDisconnectModalOpen(false);
    setError('');
    setNotice('Disconnecting Gmail...');

    try {
      const response = await fetch(`${API_BASE_URL}/api/auth/google/disconnect`, {
        method: 'DELETE',
        headers: authHeaders()
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || 'Failed to disconnect Gmail.');
      }

      setIsGmailConnected(false);
      setNotice('Gmail disconnected successfully.');
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Unable to disconnect Gmail.');
    }
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!form) return;

    setSaving(true);
    setError('');
    setNotice('');

    try {
      const sanitizedForm: UpdateProfileInput = {
        ...form,
        autofillAnswers: {
          ...form.autofillAnswers,
          custom: (form.autofillAnswers.custom ?? [])
              .map((entry) => ({
                intent: entry.intent?.trim(),
                label: entry.label.trim(),
                aliases: (entry.aliases ?? []).map((alias) => alias.trim()).filter(Boolean),
                keywords: entry.keywords?.trim(),
                answer: entry.answer.trim(),
                shortAnswer: entry.shortAnswer?.trim(),
                longAnswer: entry.longAnswer?.trim(),
              }))
              .filter((entry) => (
                entry.intent || entry.label || entry.aliases.length || entry.keywords
                || entry.answer || entry.shortAnswer || entry.longAnswer
              )),
        },
      };
      const updatedProfile = await updateProfile(sanitizedForm);
      const mergedProfile = { ...profile, ...updatedProfile, documents: profile?.documents ?? [], stats: profile?.stats } as UserProfile;
      setProfile(mergedProfile);
      setForm(profileToForm(mergedProfile));
      setEditing(false);
      setNotice('Profile updated.');
      void notifyRoleMatchProfileUpdated();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Unable to update profile.');
    } finally {
      setSaving(false);
    }
  };

  const handleDocumentUpload = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!documentFile) return;

    setUploading(true);
    setError('');
    setNotice('');

    try {
      const document = await uploadProfileDocument(documentFile, documentType, documentLabel || documentFile.name);
      setProfile((current) => current ? {
        ...current,
        resumeUrl: document.documentType === 'resume' ? document.fileUrl : current.resumeUrl,
        documents: [document, ...(current.documents ?? [])],
      } : current);
      setDocumentLabel('');
      setDocumentFile(null);
      setFileInputKey((current) => current + 1);
      setNotice('Document uploaded and saved to profile.');
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Unable to upload document.');
    } finally {
      setUploading(false);
    }
  };

  const handleBannerUpload = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    setMediaUploading('profile-banner');
    setError('');
    setNotice('');

    try {
      const document = await uploadProfileDocument(file, 'profile-banner', 'Profile banner');
      setProfile((current) => current ? {
        ...current,
        documents: [document, ...(current.documents ?? [])],
      } : current);
      setNotice('Profile banner uploaded.');
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Unable to upload profile banner.');
    } finally {
      setMediaUploading(null);
      event.target.value = '';
    }
  };

  const handleAvatarChange = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    setUploadingAvatar(true);
    setError('');
    setNotice('');

    try {
      const newAvatarUrl = await uploadProfilePicture(file);
      setProfile((current) => current ? { ...current, avatarUrl: newAvatarUrl } : null);
      setNotice('Profile picture uploaded successfully.');
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to update avatar image.');
    } finally {
      setUploadingAvatar(false);
      event.target.value = '';
    }
  };

  if (loading) return <div className="page">Loading your profile...</div>;
  if (error && !profile) return <div className="page error-banner">{error}</div>;
  if (!profile || !form) return <div className="page">No profile found. Please complete onboarding.</div>;

  const customAutofillAnswers = form.autofillAnswers.custom ?? [];
  const profileInitials = profile.fullName?.split(' ').map((part) => part[0]).filter(Boolean).slice(0, 2).join('') || 'U';
  const profileSubtitle = compactProfileSubtitle(profile);

  return (
      <div className="page profile-page">
        <header className={`profile-header profile-hero${profileBannerUrl ? ' has-profile-banner' : ''}`}>
          {profileBannerUrl && <div className="profile-banner-layer" style={{ backgroundImage: `url(${profileBannerUrl})` }} aria-hidden="true" />}
          <div className={`profile-avatar${profileAvatarUrl ? ' has-image' : ''}`}>
            {profileAvatarUrl ? <img src={profileAvatarUrl} alt="" /> : profileInitials}
            {editing && (
                <label className="profile-avatar-upload" title="Upload profile picture">
                  <Camera size={15} aria-hidden="true" />
                  <input
                      type="file"
                      accept="image/png, image/jpeg, image/webp"
                      disabled={uploadingAvatar}
                      onChange={(event) => void handleAvatarChange(event)}
                  />
                </label>
            )}
          </div>
          <div className="profile-title">
            <span className="eyebrow">Profile</span>
            <h1>{profile.fullName}</h1>
            <p>{profileSubtitle}</p>
            <div className="profile-actions">
              {!editing && (
                  <button className="button primary" type="button" onClick={handleEdit}>
                    <Pencil size={16} aria-hidden="true"/>
                    Edit profile
                  </button>
              )}
              <label className="button secondary profile-action-upload" title="Upload profile banner">
                <ImageIcon size={16} aria-hidden="true" />
                {mediaUploading === 'profile-banner' ? 'Uploading banner' : profileBannerUrl ? 'Replace banner' : 'Upload banner'}
                <input
                    type="file"
                    accept="image/*"
                    disabled={mediaUploading === 'profile-banner'}
                    onChange={(event) => void handleBannerUpload(event)}
                />
              </label>
            </div>
          </div>
          <div className="profile-signal-card profile-stat-list" aria-label="Profile completeness">
            {profileStats.map((stat) => (
                <div key={stat.label}>
                  <strong>{stat.value}</strong>
                  <span>{stat.label}</span>
                </div>
            ))}
          </div>
        </header>

        {error && <div className="error-banner">{error}</div>}
        {notice && <div className="notice-banner">{notice}</div>}

        {editing && (
            <div style={{display: 'flex', flexDirection: 'column', gap: '24px'}}>
              <form className="panel profile-edit-form profile-editor" aria-label="Edit profile" onSubmit={handleSubmit}>
                <div className="panel-header profile-editor-toolbar">
                  <div>
                    <span className="eyebrow">Edit</span>
                    <h2>Candidate profile</h2>
                  </div>
                  <div className="form-actions compact-actions">
                    <button className="button secondary" type="button" onClick={handleCancel}>
                      <X size={16} aria-hidden="true"/>
                      Cancel
                    </button>
                    <button className="button primary" type="submit" disabled={saving}>
                      <Save size={16} aria-hidden="true"/>
                      {saving ? 'Saving' : 'Save profile'}
                    </button>
                  </div>
                </div>

                <section className="editor-section">
                  <span className="eyebrow">Identity</span>
                  <div className="form-grid">
                    <label>Full name<input value={form.fullName}
                                           onChange={(event) => updateForm('fullName', event.target.value)}
                                           required/></label>
                    <label>Date of birth<input value={form.dateOfBirth}
                                               onChange={(event) => updateForm('dateOfBirth', event.target.value)}
                                               placeholder="YYYY-MM-DD"/></label>
                    <label>Phone<input value={form.phone}
                                       onChange={(event) => updateForm('phone', event.target.value)}/></label>

                    <AutocompleteField
                        label="Location"
                        type="location"
                        listId="identity-location"
                        value={form.location}
                        onChange={(val) => updateForm('location', val)}
                        placeholder="Boston, MA"
                    />

                    <label>Work authorization<input value={form.workAuthorization}
                                                    onChange={(event) => updateForm('workAuthorization', event.target.value)}/></label>
                    <label>LinkedIn<input value={form.linkedinUrl}
                                          onChange={(event) => updateForm('linkedinUrl', event.target.value)}
                                          placeholder="https://linkedin.com/in/username"/></label>
                    <label>GitHub<input value={form.githubUrl}
                                        onChange={(event) => updateForm('githubUrl', event.target.value)}
                                        placeholder="https://github.com/username"/></label>
                    <label>Portfolio<input value={form.portfolioUrl}
                                           onChange={(event) => updateForm('portfolioUrl', event.target.value)}/></label>
                    <label>Indeed<input value={form.indeedUrl}
                                        onChange={(event) => updateForm('indeedUrl', event.target.value)}/></label>
                  </div>
                </section>

                <section className="editor-section profile-media-editor">
                  <span className="eyebrow">Profile media</span>
                  <div className="media-upload-grid">
                    <label className="media-upload-card">
                      <Camera size={18} aria-hidden="true" />
                      <span>
                        <strong>Profile picture</strong>
                        <small>{profileAvatarUrl ? 'Replace current image' : 'Upload a square image'}</small>
                      </span>
                      <input
                          type="file"
                          accept="image/png, image/jpeg, image/webp"
                          disabled={uploadingAvatar}
                          onChange={(event) => void handleAvatarChange(event)}
                      />
                    </label>
                    <label className="media-upload-card">
                      <ImageIcon size={18} aria-hidden="true" />
                      <span>
                        <strong>Profile banner</strong>
                        <small>{profileBannerUrl ? 'Replace current banner' : 'Upload a wide banner'}</small>
                      </span>
                      <input
                          type="file"
                          accept="image/*"
                          disabled={mediaUploading === 'profile-banner'}
                          onChange={(event) => void handleBannerUpload(event)}
                      />
                    </label>
                  </div>
                </section>

                <section className="editor-section">
                  <span className="eyebrow">Targeting</span>
                  <div className="form-grid">
                    <TagInput
                        label="Target roles"
                        value={form.targetRoles}
                        onChange={(value) => updateForm('targetRoles', value)}
                        placeholder="Software Engineer (press Enter)"
                    />
                    <TagInput
                        label="Preferred locations"
                        value={form.preferredLocations}
                        onChange={(value) => updateForm('preferredLocations', value)}
                        placeholder="Boston, Remote"
                    />
                    <TagInput
                        label="Skills"
                        value={form.skills}
                        onChange={(value) => updateForm('skills', value)}
                        placeholder="React, PostgreSQL"
                    />
                    <TagInput
                        label="Relevant courses"
                        value={form.relevantCourses}
                        onChange={(value) => updateForm('relevantCourses', value)}
                        placeholder="Data Structures"
                    />
                    <CommaField label="Portfolio links" value={form.portfolioLinks}
                                onChange={(value) => updateForm('portfolioLinks', value)} placeholder="https://..."/>
                    <label>Minimum salary<input value={form.salaryMinimum}
                                                onChange={(event) => updateForm('salaryMinimum', event.target.value)}
                                                placeholder="$70,000"/></label>
                  </div>
                </section>

                <EditorList title="Education"
                            onAdd={() => updateForm('educationHistory', [...form.educationHistory, blankEducation()])}>
                  {form.educationHistory.map((entry, index) => (
                      <article className="nested-editor" key={`education-${index}`}>
                        <div className="nested-editor-header">
                          <strong>Education {index + 1}</strong>
                          <button className="icon-button" type="button" title="Remove education"
                                  onClick={() => updateForm('educationHistory', form.educationHistory.filter((_, itemIndex) => itemIndex !== index))}>
                            <Trash2 size={16} aria-hidden="true"/>
                          </button>
                        </div>
                        <div className="form-grid">
                          <AutocompleteField
                              label="School"
                              type="school"
                              listId={`edu-school-list-${index}`}
                              value={entry.school}
                              onChange={(val) => updateEducation(index, {school: val})}
                              placeholder="e.g., Example Institute of Technology"
                          />
                          <label>Degree<input value={entry.degree}
                                              onChange={(event) => updateEducation(index, {degree: event.target.value})}/></label>
                          <label>Field<input value={entry.field}
                                             onChange={(event) => updateEducation(index, {field: event.target.value})}/></label>

                          <AutocompleteField
                              label="Location"
                              type="location"
                              listId={`edu-loc-list-${index}`}
                              value={entry.location ?? ''}
                              onChange={(val) => updateEducation(index, {location: val})}
                              placeholder="City, State"
                          />

                          <label>Start<input value={entry.startDate ?? ''} onChange={(event) => updateEducation(index, { startDate: event.target.value })} placeholder="Sept 2022" /></label>
                          <label>End<input value={entry.endDate ?? ''} onChange={(event) => updateEducation(index, { endDate: event.target.value })} placeholder="Aug 2026" /></label>
                          <label>GPA<input value={entry.gpa ?? ''} onChange={(event) => updateEducation(index, { gpa: event.target.value })} /></label>
                          <TagInput
                              label="Courses"
                              value={entry.courses ?? []}
                              onChange={(value) => updateEducation(index, {courses: value})}
                              placeholder="e.g. Data Structures (press Enter)"
                          />
                          <label className="field-full">Notes<textarea value={entry.notes ?? ''}
                                                                       onChange={(event) => updateEducation(index, {notes: event.target.value})}/></label>
                        </div>
                      </article>
                  ))}
                </EditorList>

                <EditorList title="Work history"
                            onAdd={() => updateForm('workHistory', [...form.workHistory, blankWork()])}>
                  {form.workHistory.map((entry, index) => (
                      <article className="nested-editor" key={`work-${index}`}>
                        <div className="nested-editor-header">
                          <strong>Experience {index + 1}</strong>
                          <button className="icon-button" type="button" title="Remove experience"
                                  onClick={() => updateForm('workHistory', form.workHistory.filter((_, itemIndex) => itemIndex !== index))}>
                            <Trash2 size={16} aria-hidden="true"/>
                          </button>
                        </div>
                        <div className="form-grid">
                          <label>Company<input value={entry.company}
                                               onChange={(event) => updateWork(index, {company: event.target.value})}/></label>
                          <label>Title<input value={entry.title}
                                             onChange={(event) => updateWork(index, {title: event.target.value})}/></label>

                          <AutocompleteField
                              label="Location"
                              type="location"
                              listId={`work-loc-list-${index}`}
                              value={entry.location ?? ''}
                              onChange={(val) => updateWork(index, {location: val})}
                              placeholder="City, State"
                          />

                          <label>Start<input value={entry.startDate ?? ''} onChange={(event) => updateWork(index, { startDate: event.target.value })} placeholder="June 2024" /></label>
                          <label>End<input disabled={entry.current} value={entry.endDate ?? ''} onChange={(event) => updateWork(index, { endDate: event.target.value })} placeholder={entry.current ? 'Present' : 'Aug 2024'} /></label>

                          <label className="checkbox-control inline-check"><input type="checkbox"
                                                                                  checked={Boolean(entry.current)}
                                                                                  onChange={(event) => updateWork(index, {current: event.target.checked})}/> Current
                            role</label>
                          <CommaField label="Highlights" value={entry.highlights ?? []}
                                      onChange={(value) => updateWork(index, {highlights: value})}/>
                          <TagInput
                              label="Skills used"
                              value={entry.skills ?? []}
                              onChange={(value) => updateWork(index, {skills: value})}
                              placeholder="e.g. Agile Methodology (press Enter)"
                          />
                        </div>
                      </article>
                  ))}
                </EditorList>

                <EditorList title="Projects"
                            onAdd={() => updateForm('projectHistory', [...form.projectHistory, blankProject()])}>
                  {form.projectHistory.map((entry, index) => (
                      <article className="nested-editor" key={`project-${index}`}>
                        <div className="nested-editor-header">
                          <strong>Project {index + 1}</strong>
                          <button className="icon-button" type="button" title="Remove project"
                                  onClick={() => updateForm('projectHistory', form.projectHistory.filter((_, itemIndex) => itemIndex !== index))}>
                            <Trash2 size={16} aria-hidden="true"/>
                          </button>
                        </div>
                        <div className="form-grid">
                          <label>Name<input value={entry.name}
                                            onChange={(event) => updateProject(index, {name: event.target.value})}/></label>
                          <label>Role<input value={entry.role ?? ''}
                                            onChange={(event) => updateProject(index, {role: event.target.value})}/></label>
                          <label className="field-full">URL<input value={entry.url ?? ''}
                                                                  onChange={(event) => updateProject(index, {url: event.target.value})}/></label>
                          <TagInput
                              label="Technologies"
                              value={entry.technologies ?? []}
                              onChange={(value) => updateProject(index, {technologies: value})}
                              placeholder="e.g. React Router (press Enter)"
                          />
                          <label className="field-full">Description<textarea value={entry.description ?? ''}
                                                                             onChange={(event) => updateProject(index, {description: event.target.value})}/></label>
                        </div>
                      </article>
                  ))}
                </EditorList>

                <section className="editor-section autofill-editor-section">
                  <div className="nested-section-header">
                    <div>
                      <span className="eyebrow">Autofill answers</span>
                      <div className="section-title-with-help">
                        <h3>Reusable form answers</h3>
                        <span
                            className="info-hint"
                            title="Each answer can have one topic, alternate question wordings, and optional short and long versions. RoleMatch uses the concise version for choice controls and the detailed version for open-ended prompts."
                        >
                      <Info size={15} aria-hidden="true"/>
                    </span>
                      </div>
                    </div>
                    <button className="button secondary" type="button" onClick={addCustomAutofill}>
                      <Plus size={16} aria-hidden="true"/>
                      Add answer
                    </button>
                  </div>
                  <div className="form-grid">
                    <label>Authorized to work?<input value={form.autofillAnswers.authorizedToWork ?? ''}
                                                     onChange={(event) => updateAutofill('authorizedToWork', event.target.value)}/></label>
                    <label>Sponsorship required?<input value={form.autofillAnswers.sponsorshipRequired ?? ''}
                                                       onChange={(event) => updateAutofill('sponsorshipRequired', event.target.value)}/></label>
                    <label>Veteran status<input value={form.veteranStatus}
                                                onChange={(event) => updateForm('veteranStatus', event.target.value)}/></label>
                    <label>Disability status<input value={form.disabilityStatus}
                                                   onChange={(event) => updateForm('disabilityStatus', event.target.value)}/></label>
                    <label>Gender<input value={form.gender}
                                        onChange={(event) => updateForm('gender', event.target.value)}/></label>
                    <label>Race<input value={form.race}
                                      onChange={(event) => updateForm('race', event.target.value)}/></label>
                    <label>Years professional<input value={form.autofillAnswers.yearsProfessionalExperience ?? ''}
                                                    onChange={(event) => updateAutofill('yearsProfessionalExperience', event.target.value)}/></label>
                    <label>Desired salary<input value={form.autofillAnswers.desiredSalary ?? ''}
                                                onChange={(event) => updateAutofill('desiredSalary', event.target.value)}/></label>
                    <label>Willing to relocate?<input value={form.autofillAnswers.willingToRelocate ?? ''}
                                                      onChange={(event) => updateAutofill('willingToRelocate', event.target.value)}/></label>
                    <label>Earliest start<input value={form.autofillAnswers.earliestStartDate ?? ''}
                                                onChange={(event) => updateAutofill('earliestStartDate', event.target.value)}/></label>
                  </div>
                  <div className="custom-autofill-list">
                    {customAutofillAnswers.length > 0 ? customAutofillAnswers.map((entry, index) => (
                        <article className="nested-editor custom-autofill-card" key={`custom-autofill-${index}`}>
                          <div className="nested-editor-header">
                            <strong>Custom answer {index + 1}</strong>
                            <button className="icon-button" type="button" title="Remove custom answer"
                                    onClick={() => removeCustomAutofill(index)}>
                              <Trash2 size={16} aria-hidden="true"/>
                            </button>
                          </div>
                          <div className="form-grid">
                            <label>Answer topic (optional)<input value={entry.intent ?? ''} onChange={(event) => updateCustomAutofill(index, { intent: event.target.value })} placeholder="requires_sponsorship" /></label>
                            <label>Primary question wording<input value={entry.label} onChange={(event) => updateCustomAutofill(index, { label: event.target.value })} placeholder="Will you require employment visa sponsorship?" /></label>
                            <label className="custom-alias-field">Alternate question wording, one per line<textarea value={(entry.aliases ?? []).join('\n')} onChange={(event) => updateCustomAutofill(index, { aliases: event.target.value.split(/\r?\n/) })} placeholder={'Will you now or in the future require sponsorship?\nWill the company need to sponsor your work authorization?'} /></label>
                            <label>Legacy keywords (optional)<input value={entry.keywords ?? ''} onChange={(event) => updateCustomAutofill(index, { keywords: event.target.value })} placeholder="sponsorship visa work authorization" /></label>
                            <label className="custom-answer-field">Default answer<textarea value={entry.answer} onChange={(event) => updateCustomAutofill(index, { answer: event.target.value })} placeholder="Used when no field-specific version is supplied." /></label>
                            <label className="custom-answer-variant-field">Short answer override<input value={entry.shortAnswer ?? ''} onChange={(event) => updateCustomAutofill(index, { shortAnswer: event.target.value })} placeholder="Yes, No, 2 years, or another concise option" /></label>
                            <label className="custom-answer-variant-field">Long answer override<textarea value={entry.longAnswer ?? ''} onChange={(event) => updateCustomAutofill(index, { longAnswer: event.target.value })} placeholder="Detailed response for Describe, Explain, or Tell us questions" /></label>
                          </div>
                        </article>
                    )) : <p className="muted-copy">No custom autofill answers yet. Add one for role-specific questions
                      like years of Java, clearance, portfolio links, or tool experience.</p>}
                  </div>
                </section>
              </form>

              {/* DOCUMENT UPLOAD */}
              <section className="panel">
                <div className="panel-header">
                  <div>
                    <span className="eyebrow">Documents</span>
                    <h2>Application materials</h2>
                  </div>
                </div>
                <form className="document-upload" onSubmit={handleDocumentUpload}>
                  <select value={documentType} onChange={(event) => setDocumentType(event.target.value)}>
                    <option value="resume">Resume</option>
                    <option value="cover-letter-template">Cover letter template</option>
                    <option value="transcript">Transcript</option>
                    <option value="portfolio">Portfolio</option>
                    <option value="other">Other</option>
                  </select>
                  <input value={documentLabel} onChange={(event) => setDocumentLabel(event.target.value)}
                         placeholder="Document label"/>
                  <input key={fileInputKey} type="file"
                         onChange={(event: ChangeEvent<HTMLInputElement>) => setDocumentFile(event.target.files?.[0] ?? null)}/>
                  <button className="button primary" type="submit" disabled={uploading || !documentFile}>
                    <Upload size={16} aria-hidden="true"/>
                    {uploading ? 'Uploading' : 'Upload'}
                  </button>
                </form>

                <div className="compact-list" style={{ marginTop: '16px' }}>
                  {applicationDocuments.length > 0 ? applicationDocuments.map((document) => (
                      <article className="compact-row" key={document.id}>
                        <div>
                          <strong>{document.label}</strong>
                          <span>{document.documentType} - {document.fileName}</span>
                        </div>
                        <button type="button" className="text-link icon-link" title="Open document"
                                onClick={() => void openProfileDocument(document).catch((openError) => setError(openError instanceof Error ? openError.message : 'Unable to open document.'))}>
                          <FileText size={20} aria-hidden="true"/>
                        </button>
                      </article>
                  )) : <p className="muted-copy">No documents uploaded yet.</p>}
                </div>
              </section>
            </div>
        )}
        {!editing && (
            <ProfileReadOnlyGrid
              profile={profile}
              applicationDocuments={applicationDocuments}
              isGmailConnected={isGmailConnected}
              isConnectingGmail={isConnectingGmail}
              isHoveringGmail={isHoveringGmail}
              onConnectGmail={handleConnectGmail}
              onDisconnectGmail={handleDisconnectClick}
              onGmailHoverChange={setIsHoveringGmail}
            />
        )}

        <AtsCredentialManager onError={setError} onNotice={setNotice} />

        {/* ✅ MODAL MOVED HERE
          By placing it at the root of this component (outside the header and profile grid),
          it escapes any nested Z-Index traps and stacking context rules.
        */}
        {isDisconnectModalOpen && (
            <div style={styles.modalOverlay}>
              <div style={styles.modalContent}>
                <h3 style={{marginTop: 0, fontSize: '1.25rem', color: '#111827'}}>Disconnect Gmail</h3>
                <p style={{color: '#4B5563', marginBottom: '24px', fontSize: '0.95rem'}}>
                  Are you sure you want to disconnect your Gmail account? You will no longer be able to automatically track application emails.
                </p>

                <div style={styles.modalActions}>
                  <button
                      type="button"
                      onClick={() => setIsDisconnectModalOpen(false)}
                      style={styles.cancelButton}
                  >
                    Cancel
                  </button>
                  <button
                      type="button"
                      onClick={confirmDisconnectGmail}
                      style={styles.confirmButton}
                  >
                    Yes, Disconnect
                  </button>
                </div>
              </div>
            </div>
        )}
      </div>
  );

  function updateEducation(index: number, patch: Partial<EducationEntry>) {
    updateForm('educationHistory', form.educationHistory.map((entry, itemIndex) => itemIndex === index ? {...entry, ...patch} : entry));
  }

  function updateWork(index: number, patch: Partial<WorkHistoryEntry>) {
    updateForm('workHistory', form.workHistory.map((entry, itemIndex) => itemIndex === index ? {...entry, ...patch} : entry));
  }

  function updateProject(index: number, patch: Partial<ProjectEntry>) {
    updateForm('projectHistory', form.projectHistory.map((entry, itemIndex) => itemIndex === index ? {...entry, ...patch} : entry));
  }
}
const styles = {
  modalOverlay: {
    position: 'fixed' as const,
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    display: 'flex',
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 1000,
  },
  modalContent: {
    backgroundColor: 'white',
    padding: '24px',
    borderRadius: '12px',
    boxShadow: '0 10px 25px -5px rgba(0, 0, 0, 0.1), 0 8px 10px -6px rgba(0, 0, 0, 0.1)',
    maxWidth: '400px',
    width: '90%',
    textAlign: 'center' as const,
    fontFamily: 'inherit',
  },
  modalActions: {
    display: 'flex',
    justifyContent: 'center',
    gap: '12px',
  },
  cancelButton: {
    padding: '10px 16px',
    backgroundColor: '#f3f4f6',
    border: '1px solid #e5e7eb',
    borderRadius: '6px',
    cursor: 'pointer',
    color: '#374151',
    fontWeight: 500,
    transition: 'background-color 0.2s',
  },
  confirmButton: {
    padding: '10px 16px',
    backgroundColor: '#ef4444',
    border: 'none',
    borderRadius: '6px',
    cursor: 'pointer',
    color: 'white',
    fontWeight: 500,
    transition: 'background-color 0.2s',
  }
};
