import { Eye, EyeOff, KeyRound, Pencil, Plus, Save, Trash2, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import {
  createAtsCredential,
  deleteAtsCredential,
  getAtsCredentials,
  updateAtsCredential,
  type AtsCredentialInput,
  type AtsCredentialMetadata,
} from '../../api/profile';
import './AtsCredentialManager.css';

interface AtsCredentialManagerProps {
  onError: (message: string) => void;
  onNotice: (message: string) => void;
}

const PROVIDERS = [
  'Workday',
  'Greenhouse',
  'Lever',
  'Ashby',
  'SmartRecruiters',
  'Recruitee',
  'iCIMS',
  'Workable',
  'SAP SuccessFactors',
  'Oracle Recruiting',
  'Taleo',
  'UKG Pro Recruiting',
  'Dayforce',
  'Other ATS',
];

const EMPTY_FORM: AtsCredentialInput = {
  label: '',
  provider: 'Workday',
  loginUrl: '',
  username: '',
  password: '',
};

export function AtsCredentialManager({ onError, onNotice }: AtsCredentialManagerProps) {
  const [credentials, setCredentials] = useState<AtsCredentialMetadata[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [form, setForm] = useState<AtsCredentialInput>(EMPTY_FORM);

  useEffect(() => {
    void getAtsCredentials()
      .then(setCredentials)
      .catch((error) => onError(error instanceof Error ? error.message : 'Unable to load ATS accounts.'))
      .finally(() => setLoading(false));
  }, [onError]);

  const resetForm = () => {
    setForm(EMPTY_FORM);
    setEditingId(null);
    setFormOpen(false);
    setShowPassword(false);
  };

  const startAdd = () => {
    setForm(EMPTY_FORM);
    setEditingId(null);
    setFormOpen(true);
    setShowPassword(false);
    onError('');
  };

  const startEdit = (credential: AtsCredentialMetadata) => {
    setForm({
      label: credential.label,
      provider: credential.provider,
      loginUrl: credential.origin,
      username: credential.username,
      password: '',
    });
    setEditingId(credential.id);
    setFormOpen(true);
    setShowPassword(false);
    onError('');
  };

  const saveCredential = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSaving(true);
    onError('');
    onNotice('');
    try {
      const saved = editingId
        ? await updateAtsCredential(editingId, form)
        : await createAtsCredential(form);
      setCredentials((current) => editingId
        ? current.map((credential) => credential.id === saved.id ? saved : credential)
        : [saved, ...current]);
      onNotice(editingId ? 'ATS account updated.' : 'ATS account saved.');
      resetForm();
    } catch (error) {
      onError(error instanceof Error ? error.message : 'Unable to save ATS account.');
    } finally {
      setSaving(false);
    }
  };

  const removeCredential = async (credential: AtsCredentialMetadata) => {
    if (!window.confirm(`Remove ${credential.label}?`)) return;
    onError('');
    onNotice('');
    try {
      await deleteAtsCredential(credential.id);
      setCredentials((current) => current.filter((entry) => entry.id !== credential.id));
      if (editingId === credential.id) resetForm();
      onNotice('ATS account removed.');
    } catch (error) {
      onError(error instanceof Error ? error.message : 'Unable to remove ATS account.');
    }
  };

  return (
    <section className="panel ats-credential-panel" aria-labelledby="ats-accounts-title">
      <div className="panel-header">
        <div>
          <span className="eyebrow">Autofill</span>
          <h2 id="ats-accounts-title">ATS accounts</h2>
        </div>
        <button className="button secondary" type="button" onClick={startAdd}>
          <Plus size={16} aria-hidden="true" />
          Add account
        </button>
      </div>

      {formOpen && (
        <form className="ats-credential-form" onSubmit={(event) => void saveCredential(event)}>
          <label>
            Account label
            <input
              value={form.label}
              onChange={(event) => setForm((current) => ({ ...current, label: event.target.value }))}
              placeholder="Workday - Example Company"
              required
            />
          </label>
          <label>
            ATS
            <select
              value={form.provider}
              onChange={(event) => setForm((current) => ({ ...current, provider: event.target.value }))}
            >
              {PROVIDERS.map((provider) => <option value={provider} key={provider}>{provider}</option>)}
            </select>
          </label>
          <label className="ats-origin-field">
            ATS login URL
            <input
              value={form.loginUrl}
              onChange={(event) => setForm((current) => ({ ...current, loginUrl: event.target.value }))}
              placeholder="https://company.wd5.myworkdayjobs.com"
              inputMode="url"
              required
            />
          </label>
          <label>
            Username or email
            <input
              value={form.username}
              onChange={(event) => setForm((current) => ({ ...current, username: event.target.value }))}
              autoComplete="off"
              required
            />
          </label>
          <label>
            {editingId ? 'New password' : 'Password'}
            <span className="password-input-wrap">
              <input
                type={showPassword ? 'text' : 'password'}
                value={form.password}
                onChange={(event) => setForm((current) => ({ ...current, password: event.target.value }))}
                autoComplete="new-password"
                placeholder={editingId ? 'Leave blank to keep saved password' : ''}
                required={!editingId}
              />
              <button
                className="password-visibility-button"
                type="button"
                title={showPassword ? 'Hide password' : 'Show password'}
                onClick={() => setShowPassword((current) => !current)}
              >
                {showPassword ? <EyeOff size={17} aria-hidden="true" /> : <Eye size={17} aria-hidden="true" />}
              </button>
            </span>
          </label>
          <div className="form-actions compact-actions ats-credential-actions">
            <button className="button secondary" type="button" onClick={resetForm}>
              <X size={16} aria-hidden="true" /> Cancel
            </button>
            <button className="button primary" type="submit" disabled={saving}>
              <Save size={16} aria-hidden="true" /> {saving ? 'Saving' : 'Save account'}
            </button>
          </div>
        </form>
      )}

      <div className="ats-credential-list">
        {loading ? <p className="muted-copy">Loading ATS accounts...</p> : credentials.length === 0 ? (
          <p className="muted-copy">No ATS accounts saved.</p>
        ) : credentials.map((credential) => (
          <article className="ats-credential-row" key={credential.id}>
            <span className="ats-credential-icon"><KeyRound size={18} aria-hidden="true" /></span>
            <div className="ats-credential-identity">
              <strong>{credential.label}</strong>
              <span>{credential.username}</span>
            </div>
            <div className="ats-credential-origin">
              <span>{credential.provider}</span>
              <small>{credential.origin}</small>
            </div>
            <span className="credential-saved-state">Password saved</span>
            <div className="ats-credential-row-actions">
              <button className="icon-button" type="button" title="Edit ATS account" onClick={() => startEdit(credential)}>
                <Pencil size={16} aria-hidden="true" />
              </button>
              <button className="icon-button danger" type="button" title="Remove ATS account" onClick={() => void removeCredential(credential)}>
                <Trash2 size={16} aria-hidden="true" />
              </button>
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}
