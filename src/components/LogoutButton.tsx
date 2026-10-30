import { SignOut } from '@phosphor-icons/react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';

export function LogoutButton() {
  const navigate = useNavigate();
  async function logout() {
    if (supabase) await supabase.auth.signOut();
    navigate('/login', { replace: true });
  }
  return <button className="quiet-button logout-button" type="button" onClick={logout}><SignOut aria-hidden="true" /><span>Log out</span></button>;
}
