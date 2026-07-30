import { BriefcaseBusiness, LoaderCircle, Moon, Sun } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { API_BASE_URL } from './api/client';
import { ProfileOnboarding } from './components/onboarding/ProfileOnboarding';
import { useTheme } from './hooks/useTheme';
import './Auth.css';

export default function Auth() {
  const [isLogin, setIsLogin] = useState(true);
  const [onboarding, setOnboarding] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const navigate = useNavigate();
  const { theme, toggleTheme } = useTheme();

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError('');
    if (!isLogin && password !== confirmPassword) {
      setError('Passwords do not match.');
      return;
    }

    setSubmitting(true);
    try {
      const endpoint = isLogin ? '/api/auth/login' : '/api/auth/register';
      const payload = isLogin
        ? { email, password }
        : { email, password, firstName, lastName };
      const response = await fetch(`${API_BASE_URL}${endpoint}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await response.json() as { token?: string; error?: string };
      if (!response.ok || !data.token) throw new Error(data.error || 'Unable to complete request.');

      localStorage.setItem('rolematch_token', data.token);
      if (isLogin) navigate('/');
      else setOnboarding(true);
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : 'Unable to complete request.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <main className={`auth-page${onboarding ? ' onboarding-mode' : ''}`}>
      <button type="button" className="auth-theme" onClick={toggleTheme} title={`Use ${theme === 'dark' ? 'light' : 'dark'} mode`} aria-label={`Use ${theme === 'dark' ? 'light' : 'dark'} mode`}>
        {theme === 'dark' ? <Sun /> : <Moon />}
      </button>

      {onboarding ? (
        <ProfileOnboarding onComplete={() => navigate('/')} />
      ) : (
        <section className="auth-tool" aria-label={isLogin ? 'Log in' : 'Create account'}>
          <header className="auth-brand">
            <span><BriefcaseBusiness /></span>
            <div><h1>RoleMatch</h1><p>{isLogin ? 'Continue your job search.' : 'Create your unified job profile.'}</p></div>
          </header>

          <div className="auth-tabs" role="tablist" aria-label="Authentication mode">
            <button type="button" role="tab" aria-selected={isLogin} onClick={() => { setIsLogin(true); setError(''); }}>Log in</button>
            <button type="button" role="tab" aria-selected={!isLogin} onClick={() => { setIsLogin(false); setError(''); }}>Sign up</button>
          </div>

          <form onSubmit={handleSubmit} className="auth-form">
            {!isLogin && (
              <div className="auth-name-row">
                <label>First name<input value={firstName} onChange={(event) => setFirstName(event.target.value)} autoComplete="given-name" required /></label>
                <label>Last name<input value={lastName} onChange={(event) => setLastName(event.target.value)} autoComplete="family-name" required /></label>
              </div>
            )}
            <label>Email<input type="email" value={email} onChange={(event) => setEmail(event.target.value)} autoComplete="email" required /></label>
            <label>Password<input type="password" value={password} onChange={(event) => setPassword(event.target.value)} autoComplete={isLogin ? 'current-password' : 'new-password'} minLength={isLogin ? undefined : 10} required /></label>
            {!isLogin && <label>Confirm password<input type="password" value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} autoComplete="new-password" minLength={10} required /></label>}
            {error && <p className="auth-error">{error}</p>}
            <button type="submit" className="auth-submit" disabled={submitting}>
              {submitting && <LoaderCircle className="spin" />}{isLogin ? 'Log in' : 'Create account'}
            </button>
          </form>
        </section>
      )}
    </main>
  );
}
