import { useEffect, useState } from 'react';
import { useAuth } from '../../app/useAuth';
import { supabase } from '../../lib/supabase';

export interface MyProfile {
  user_id: string;
  family_id: string;
  household_id: string;
  display_name: string;
  timezone: string;
}

interface ProfileResult {
  profile: MyProfile | null;
  failed: boolean;
}

const profileCache = new Map<string, Promise<ProfileResult>>();

export function useMyProfile() {
  const { session } = useAuth();
  const [profile, setProfile] = useState<MyProfile | null>(null);
  const [loading, setLoading] = useState(Boolean(supabase));
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!supabase || !session?.user.id) {
      setProfile(null);
      setFailed(false);
      setLoading(false);
      return;
    }
    let active = true;
    setProfile(null);
    setLoading(true);
    setFailed(false);
    const userId = session.user.id;
    let pending = profileCache.get(userId);
    if (!pending) {
      const client = supabase;
      pending = (async (): Promise<ProfileResult> => {
        const { data: row, error } = await client
          .from('profiles')
          .select('user_id,family_id,household_id,display_name,households(timezone)')
          .eq('user_id', userId)
          .maybeSingle();
        const household = (row as unknown as { households?: { timezone?: string } | null } | null)?.households;
        if (error || !row || !household?.timezone) return { failed: true, profile: null };
        return {
          failed: false,
          profile: {
            user_id: row.user_id,
            family_id: row.family_id,
            household_id: row.household_id,
            display_name: row.display_name,
            timezone: household.timezone,
          },
        };
      })();
      profileCache.set(userId, pending);
    }
    void pending.then((result) => {
      if (!active) return;
      if (result.failed) profileCache.delete(userId);
      setFailed(result.failed);
      setProfile(result.profile);
      setLoading(false);
    }).catch(() => {
      if (!active) return;
      profileCache.delete(userId);
      setFailed(true);
      setProfile(null);
      setLoading(false);
    });
    return () => { active = false; };
  }, [session?.user.id]);

  return { profile, loading, failed };
}
