import { useState, type FormEvent } from 'react';
import { Navigate } from 'react-router-dom';
import { Brand } from '../../components/Brand';
import { StatusMessage } from '../../components/StatusMessage';
import { useAuth } from '../../app/useAuth';
import { supabase } from '../../lib/supabase';

export function LoginPage() {
  const { session } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [isRecovery, setIsRecovery] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ text: string; tone: 'error' | 'success' } | null>(null);

  if (session) return <Navigate to="/" replace />;

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage(null);
    if (!supabase) {
      setMessage({ text: 'Gurtu is not connected yet. Please finish the Supabase setup first.', tone: 'error' });
      return;
    }

    setBusy(true);
    try {
      if (isRecovery) {
        const { error } = await supabase.auth.resetPasswordForEmail(email, {
          redirectTo: `${window.location.origin}/reset-password`,
        });
        if (error) throw error;
        setMessage({ text: 'If this email belongs to a Gurtu account, a reset link is on its way.', tone: 'success' });
      } else {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
      }
    } catch {
      setMessage({ text: isRecovery ? 'We could not send a reset link. Please check the email and try again.' : 'Email or password did not match. Please try again.', tone: 'error' });
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="app-frame login-frame">
      <Brand />
      <section className="login-content" aria-labelledby="login-title">
        <h2 id="login-title">{isRecovery ? 'Reset your password' : 'Welcome back'}</h2>
        <form className="login-form" onSubmit={submit}>
          <label className="field-label" htmlFor="email">Email</label>
          <input
            id="email"
            className="text-field"
            type="email"
            autoComplete="email"
            placeholder="Enter your email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            required
          />
          {!isRecovery ? (
            <>
              <label className="field-label" htmlFor="password">Password</label>
              <input
                id="password"
                className="text-field"
                type="password"
                autoComplete="current-password"
                placeholder="Enter your password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                required
              />
            </>
          ) : null}
          <button className="button button--primary login-submit" type="submit" disabled={busy}>
            {busy ? 'Please wait…' : isRecovery ? 'Send reset link' : 'Log in'}
          </button>
          {message ? <StatusMessage tone={message.tone}>{message.text}</StatusMessage> : null}
          {!supabase ? <StatusMessage tone="neutral">Sign in will be available after Supabase is connected.</StatusMessage> : null}
        </form>
        <button className="text-button forgot-link" type="button" onClick={() => { setIsRecovery((current) => !current); setMessage(null); }}>
          {isRecovery ? 'Back to log in' : 'Forgot password?'}
        </button>
      </section>
    </main>
  );
}
