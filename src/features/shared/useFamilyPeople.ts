import { useEffect, useState } from 'react';
import { supabase } from '../../lib/supabase';

export interface FamilyPerson {
  id: string;
  display_name: string;
  aliases: string[];
  home_household_id: string;
  timezone: string;
}

export function useFamilyPeople() {
  const [people, setPeople] = useState<FamilyPerson[]>([]);
  const [loading, setLoading] = useState(Boolean(supabase));
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!supabase) {
      setLoading(false);
      return;
    }
    let active = true;
    void supabase
      .from('people')
      .select('id,display_name,aliases,home_household_id,households(timezone)')
      .eq('is_active', true)
      .order('display_name')
      .then(({ data, error }) => {
        if (!active) return;
        const rows = (data ?? []) as unknown as Array<Omit<FamilyPerson, 'timezone'> & { households?: { timezone?: string } | null }>;
        setPeople(error ? [] : rows.map(({ households, ...person }) => ({ ...person, timezone: households?.timezone ?? '' })));
        setFailed(Boolean(error));
        setLoading(false);
      });
    return () => { active = false; };
  }, []);

  return { people, loading, failed };
}
