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

export function useMyProfile() {
  const { session } = useAuth();
  const [profile, setProfile] = useState<MyProfile | null>(null);
  const [loading, setLoading] = useState(Boolean(supabase));
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!supabase || !session?.user.id) {
      setLoading(false);
      return;
    }
    let active = true;
    void (async () => {
      const { data: row, error } = await supabase
        .from('profiles')
        .select('user_id,family_id,household_id,display_name,households(timezone)')
        .eq('user_id', session.user.id)
        .maybeSingle();
      if (!active) return;
      const household = (row as unknown as { households?: { timezone?: string } | null } | null)?.households;
      if (error || !row || !household?.timezone) {
        setFailed(true);
        setProfile(null);
      } else {
        setFailed(false);
        setProfile({
          user_id: row.user_id,
          family_id: row.family_id,
          household_id: row.household_id,
          display_name: row.display_name,
          timezone: household.timezone,
        });
      }
      setLoading(false);
    })();
    return () => { active = false; };
  }, [session?.user.id]);

  return { profile, loading, failed };
}
