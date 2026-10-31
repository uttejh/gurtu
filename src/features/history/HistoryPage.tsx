import { useEffect, useState } from 'react';
import { PageLayout } from '../../components/PageLayout';
import { StatusMessage } from '../../components/StatusMessage';
import { supabase } from '../../lib/supabase';

interface HistoryRecord {
  id: string;
  action: string;
  record_type: string;
  created_at: string;
}

const ACTION_LABELS: Record<string, string> = {
  memory_saved: 'Memory saved',
  item_location_changed: 'Item location updated',
  list_created: 'List created',
  event_created: 'Calendar event added',
  event_updated: 'Calendar event updated',
};

function formatDate(timestamp: string): string {
  return new Intl.DateTimeFormat('en', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(timestamp));
}

export function HistoryPage() {
  const [records, setRecords] = useState<HistoryRecord[]>([]);
  const [loading, setLoading] = useState(Boolean(supabase));
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!supabase) {
      setLoading(false);
      return;
    }
    let active = true;
    void supabase
      .from('activity_log')
      .select('id,action,record_type,created_at')
      .neq('record_type', 'list_item')
      .order('created_at', { ascending: false })
      .limit(100)
      .then(({ data, error }) => {
        if (!active) return;
        setRecords(error ? [] : (data ?? []) as unknown as HistoryRecord[]);
        setFailed(Boolean(error));
        setLoading(false);
      });
    return () => { active = false; };
  }, []);

  return (
    <PageLayout title="History" backTo="/">
      <section className="page-section">
        <p className="section-lead">A simple record of changes your household made.</p>
        {loading ? <p className="muted-copy">Loading history…</p> : null}
        {failed ? <StatusMessage tone="error">We could not load history. Please try again.</StatusMessage> : null}
        {!loading && !failed && records.length === 0 ? <p className="empty-state">Changes will appear here as your family saves memories, lists and events.</p> : null}
        <ol className="history-list">
          {records.map((record) => (
            <li className="history-item" key={record.id}>
              <span className="history-item__dot" aria-hidden="true" />
              <div>
                <strong>{ACTION_LABELS[record.action] ?? 'Family memory updated'}</strong>
                <time dateTime={record.created_at}>{formatDate(record.created_at)}</time>
              </div>
            </li>
          ))}
        </ol>
      </section>
    </PageLayout>
  );
}
