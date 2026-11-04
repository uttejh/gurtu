import { useEffect, useState } from 'react';
import { useAuth } from '../../app/useAuth';
import { supabase } from '../../lib/supabase';
import type { ConversationSummary } from '../../lib/talk';

/** The signed-in login's chats, most recent first. */
export function useRecentConversations(limit: number, enabled = true) {
  const { session } = useAuth();
  const userId = session?.user.id ?? null;
  const [conversations, setConversations] = useState<ConversationSummary[]>([]);
  const [loading, setLoading] = useState(Boolean(supabase && enabled));
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!supabase || !userId || !enabled) {
      setConversations([]);
      setLoading(false);
      return;
    }
    let active = true;
    setLoading(true);
    void supabase.from('conversations').select('id,title,last_activity_at')
      .order('last_activity_at', { ascending: false }).limit(limit)
      .then(({ data, error }) => {
        if (!active) return;
        setConversations(error ? [] : (data ?? []) as ConversationSummary[]);
        setFailed(Boolean(error));
        setLoading(false);
      });
    return () => { active = false; };
  }, [userId, limit, enabled]);

  return { conversations, loading, failed };
}
