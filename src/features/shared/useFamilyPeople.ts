import { useEffect, useState } from 'react';
import { useAuth } from '../../app/useAuth';
import { supabase } from '../../lib/supabase';

export interface FamilyPerson {
  id: string;
  display_name: string;
  aliases: string[];
  home_household_id: string;
  timezone: string;
}

interface FamilyPeopleResult {
  people: FamilyPerson[];
  failed: boolean;
}

interface FamilyPeopleCacheEntry {
  value?: FamilyPeopleResult;
  pending?: Promise<FamilyPeopleResult>;
}

const familyPeopleCache = new Map<string, FamilyPeopleCacheEntry>();

export function useFamilyPeople() {
  const { session } = useAuth();
  const userId = session?.user.id ?? null;
  const [result, setResult] = useState<FamilyPeopleResult>({ people: [], failed: false });
  const [loading, setLoading] = useState(Boolean(supabase));

  useEffect(() => {
    if (!supabase || !userId) {
      setResult({ people: [], failed: false });
      setLoading(false);
      return;
    }
    let active = true;
    setResult({ people: [], failed: false });
    setLoading(true);
    const cached = familyPeopleCache.get(userId);
    if (cached?.value) {
      setResult(cached.value);
      setLoading(false);
      return () => { active = false; };
    }

    const entry = cached ?? {};
    familyPeopleCache.set(userId, entry);
    const pending = entry.pending ?? (entry.pending = (async () => {
      const client = supabase;
      const { data, error } = await client
        .from('people')
        .select('id,display_name,aliases,home_household_id,households(timezone)')
        .eq('is_active', true)
        .order('display_name');
      const rows = (data ?? []) as unknown as Array<Omit<FamilyPerson, 'timezone'> & { households?: { timezone?: string } | null }>;
      return {
        people: error ? [] : rows.map(({ households, ...person }) => ({ ...person, timezone: households?.timezone ?? '' })),
        failed: Boolean(error),
      };
    })());

    void pending.then((nextResult) => {
      if (!active) return;
      if (nextResult.failed) familyPeopleCache.delete(userId);
      else entry.value = nextResult;
      setResult(nextResult);
      setLoading(false);
    }).catch(() => {
      if (!active) return;
      familyPeopleCache.delete(userId);
      setResult({ people: [], failed: true });
      setLoading(false);
    });
    return () => { active = false; };
  }, [userId]);

  return { people: result.people, loading, failed: result.failed };
}
