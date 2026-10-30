import { useEffect, useState } from 'react';
import { PageLayout } from '../../components/PageLayout';
import { StatusMessage } from '../../components/StatusMessage';
import { supabase } from '../../lib/supabase';

interface MemoryRecord {
  id: string;
  original_text: string;
  language: string;
  created_at: string;
  memory_people?: Array<{ people?: { display_name?: string } | null }>;
  item_location_history?: Array<{ location_text: string; items?: { canonical_name?: string } | null }>;
}

function formatDate(timestamp: string): string {
  return new Intl.DateTimeFormat('en', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(timestamp));
}

export function MemoriesPage() {
  const [memories, setMemories] = useState<MemoryRecord[]>([]);
  const [loading, setLoading] = useState(Boolean(supabase));
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!supabase) {
      setLoading(false);
      return;
    }
    let active = true;
    void supabase
      .from('memories')
      .select('id,original_text,language,created_at,memory_people(people(display_name)),item_location_history(location_text,items(canonical_name))')
      .order('created_at', { ascending: false })
      .limit(100)
      .then(({ data, error }) => {
        if (!active) return;
        setMemories(error ? [] : (data ?? []) as unknown as MemoryRecord[]);
        setFailed(Boolean(error));
        setLoading(false);
      });
    return () => { active = false; };
  }, []);

  return (
    <PageLayout title="Memories" backTo="/">
      <section className="page-section">
        <p className="section-lead">The things your family has saved, in their own words.</p>
        {loading ? <p className="muted-copy">Loading memories…</p> : null}
        {failed ? <StatusMessage tone="error">We could not load memories. Please try again.</StatusMessage> : null}
        {!loading && !failed && memories.length === 0 ? <p className="empty-state">No memories have been saved yet.</p> : null}
        <div className="record-list">
          {memories.map((memory) => {
            const people = (memory.memory_people ?? []).map((entry) => entry.people?.display_name).filter((name): name is string => Boolean(name));
            const locations = memory.item_location_history ?? [];
            return (
              <article className="record-card" key={memory.id}>
                <p className="record-card__text" lang="te">{memory.original_text}</p>
                {locations.map((location) => (
                  <p className="location-detail" key={`${memory.id}-${location.location_text}`}>
                    {location.items?.canonical_name ? `${location.items.canonical_name} · ` : ''}{location.location_text}
                  </p>
                ))}
                <div className="record-card__footer">
                  <time dateTime={memory.created_at}>{formatDate(memory.created_at)}</time>
                  {people.length ? <div className="tag-list" aria-label="People tags">{people.map((name) => <span className="person-tag" key={name}>{name}</span>)}</div> : null}
                </div>
              </article>
            );
          })}
        </div>
      </section>
    </PageLayout>
  );
}
