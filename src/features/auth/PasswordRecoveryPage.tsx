import { useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { Brand } from '../../components/Brand';
import { LoadingState } from '../../components/LoadingState';
import { StatusMessage } from '../../components/StatusMessage';
import { useAuth } from '../../app/useAuth';
import { supabase } from '../../lib/supabase';

export function PasswordRecoveryPage() {
  const { session, loading } = useAuth();
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (loading) return <LoadingState label="Opening your password reset…" />;

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage(null);
    if (!supabase) {
      setMessage('Gurtu is not connected yet. Please finish the Supabase setup first.');
      return;
    }
    if (password !== confirmPassword) {
      setMessage('The passwords do not match. Please check them and try again.');
      return;
    }
    setBusy(true);
    const { error } = await supabase.auth.updateUser({ password });
    setBusy(false);
    if (error) {
      setMessage('We could not update your password. Please request a new reset link and try again.');
      return;
    }
    setMessage('Your password has been updated. You can now log in.');
    setPassword('');
    setConfirmPassword('');
  }

  return (
    <main className="app-frame login-frame">
      <Brand />
      <section className="login-content" aria-labelledby="reset-title">
        <h2 id="reset-title">Choose a new password</h2>
        {!session ? (
          <>
            <StatusMessage tone="error">This password reset link is invalid or has expired. Request a new link to continue.</StatusMessage>
            <Link className="button button--primary" to="/login">Back to log in</Link>
          </>
        ) : (
        <form className="login-form" onSubmit={submit}>
          <label className="field-label" htmlFor="new-password">New password</label>
          <input id="new-password" className="text-field" type="password" autoComplete="new-password" value={password} onChange={(event) => setPassword(event.target.value)} minLength={8} required />
          <label className="field-label" htmlFor="confirm-password">Confirm password</label>
          <input id="confirm-password" className="text-field" type="password" autoComplete="new-password" value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} minLength={8} required />
          <button className="button button--primary login-submit" type="submit" disabled={busy}>{busy ? 'Please wait…' : 'Update password'}</button>
          {message ? <StatusMessage tone={message.startsWith('Your password') ? 'success' : 'error'}>{message}</StatusMessage> : null}
          {message?.startsWith('Your password') ? <Link className="button button--secondary" to="/">Continue to Gurtu</Link> : null}
        </form>
        )}
      </section>
    </main>
  );
}
