import { useEffect, useMemo, useState } from 'react';
import type { PropsWithChildren } from 'react';
import type { Session } from '@supabase/supabase-js';
import { supabase, isSupabaseConfigured } from '../lib/supabase';
import { AuthContext } from './AuthContext';

export function AuthProvider({ children }: PropsWithChildren) {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(isSupabaseConfigured);
  const [isGlobalAdmin, setIsGlobalAdmin] = useState(false);
  const [adminRoleLoading, setAdminRoleLoading] = useState(false);

  useEffect(() => {
    if (!supabase) {
      setLoading(false);
      return;
    }

    let active = true;
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      if (active) setSession(nextSession);
    });
    void supabase.auth.getSession().then(({ data }) => {
      if (active) setSession(data.session);
    }).catch(() => {
      if (active) setSession(null);
    }).finally(() => {
      if (active) setLoading(false);
    });

    return () => {
      active = false;
      subscription.unsubscribe();
    };
  }, []);

  useEffect(() => {
    if (!supabase || !session?.user.id) {
      setIsGlobalAdmin(false);
      setAdminRoleLoading(false);
      return;
    }
    let active = true;
    setAdminRoleLoading(true);
    void (async () => {
      try {
        const { data, error } = await supabase.rpc('has_gurtu_global_admin_role');
        if (active) setIsGlobalAdmin(!error && data === true);
      } catch {
        if (active) setIsGlobalAdmin(false);
      } finally {
        if (active) setAdminRoleLoading(false);
      }
    })();
    return () => { active = false; };
  }, [session?.user.id]);

  const value = useMemo(() => ({
    session, loading, configAvailable: isSupabaseConfigured, isGlobalAdmin, adminRoleLoading,
  }), [session, loading, isGlobalAdmin, adminRoleLoading]);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
