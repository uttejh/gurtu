import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { Check, Plus, Trash } from '@phosphor-icons/react';
import { PageLayout } from '../../components/PageLayout';
import { PeoplePicker } from '../shared/PeoplePicker';
import { StatusMessage } from '../../components/StatusMessage';
import { useFamilyPeople } from '../shared/useFamilyPeople';
import { useMyProfile } from '../shared/useMyProfile';
import { supabase } from '../../lib/supabase';

interface ListItem {
  id: string;
  item_text: string;
  is_completed: boolean;
  position: number;
}

interface FamilyList {
  id: string;
  title: string;
  owner_household_id: string;
  created_at: string;
  list_items?: ListItem[];
  list_people?: Array<{ people?: { display_name?: string } | null }>;
}

export function ListsPage() {
  const { profile, loading: profileLoading, failed: profileFailed } = useMyProfile();
  const { people, loading: peopleLoading } = useFamilyPeople();
  const [lists, setLists] = useState<FamilyList[]>([]);
  const [title, setTitle] = useState('');
  const [selectedPeople, setSelectedPeople] = useState<string[]>([]);
  const [itemDrafts, setItemDrafts] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(Boolean(supabase));
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const loadLists = useCallback(async () => {
    if (!supabase) {
      setLoading(false);
      return;
    }
    const { data, error } = await supabase
      .from('lists')
      .select('id,title,owner_household_id,created_at,list_items(id,item_text,is_completed,position),list_people(people(display_name))')
      .order('created_at', { ascending: false })
      .limit(100);
    setLists(error ? [] : (data ?? []) as unknown as FamilyList[]);
    setFailed(Boolean(error));
    setLoading(false);
  }, []);

  useEffect(() => { void loadLists(); }, [loadLists]);

  async function createList(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!supabase || !profile || !title.trim()) return;
    setBusy(true);
    setFailed(false);
    setNotice(null);
    const { error } = await supabase.rpc('create_gurtu_list', {
      p_title: title.trim(),
      p_person_ids: selectedPeople,
      p_items: [],
      p_request_id: crypto.randomUUID(),
    });
    setBusy(false);
    if (error) {
      setFailed(true);
      setNotice("Your list wasn't created. Please try again.");
      return;
    }
    setTitle('');
    setSelectedPeople([]);
    setNotice('List created.');
    await loadLists();
  }

  async function addItem(event: FormEvent<HTMLFormElement>, list: FamilyList) {
    event.preventDefault();
    const value = itemDrafts[list.id]?.trim();
    if (!supabase || !profile || !value) return;
    setBusy(true);
    const { error } = await supabase.rpc('change_gurtu_list_item', {
      p_action: 'add',
      p_list_id: list.id,
      p_item_text: value,
      p_request_id: crypto.randomUUID(),
    });
    setBusy(false);
    if (error) {
      setFailed(true);
      setNotice("The item wasn't added. Please try again.");
      return;
    }
    setItemDrafts((current) => ({ ...current, [list.id]: '' }));
    setNotice('Item added.');
    await loadLists();
  }

  async function setItemCompleted(item: ListItem, completed: boolean) {
    if (!supabase) return;
    setBusy(true);
    const listId = lists.find((list) => list.list_items?.some((entry) => entry.id === item.id))?.id;
    if (!listId) return;
    const { error } = await supabase.rpc('change_gurtu_list_item', {
      p_action: completed ? 'complete' : 'uncomplete',
      p_list_id: listId,
      p_item_id: item.id,
      p_request_id: crypto.randomUUID(),
    });
    setBusy(false);
    if (error) {
      setFailed(true);
      setNotice("The item wasn't updated. Please try again.");
      return;
    }
    setNotice(completed ? 'Item marked complete.' : 'Item marked incomplete.');
    await loadLists();
  }

  async function removeItem(item: ListItem) {
    if (!supabase) return;
    setBusy(true);
    const listId = lists.find((list) => list.list_items?.some((entry) => entry.id === item.id))?.id;
    if (!listId) return;
    const { error } = await supabase.rpc('change_gurtu_list_item', {
      p_action: 'remove',
      p_list_id: listId,
      p_item_id: item.id,
      p_request_id: crypto.randomUUID(),
    });
    setBusy(false);
    if (error) {
      setFailed(true);
      setNotice("The item wasn't removed. Please try again.");
      return;
    }
    setNotice('Item removed.');
    await loadLists();
  }

  return (
    <PageLayout title="Our lists" backTo="/">
      <section className="page-section">
        <p className="section-lead">Simple lists shared with the people who need them.</p>
        <form className="create-list-form" onSubmit={createList}>
          <label className="field-label" htmlFor="list-title">New list</label>
          <div className="inline-form-row">
            <input id="list-title" className="text-field" value={title} onChange={(event) => setTitle(event.target.value)} placeholder="List name" maxLength={120} required />
            <button className="button button--primary" type="submit" disabled={busy || !title.trim()}><Plus aria-hidden="true" /> Create list</button>
          </div>
          <PeoplePicker people={people} selectedIds={selectedPeople} onChange={setSelectedPeople} label={peopleLoading ? 'Loading family members…' : 'For family members (optional)'} />
          {selectedPeople.some((id) => people.find((person) => person.id === id)?.home_household_id !== profile?.household_id) ? (
            <p className="muted-copy">This list will be shared only with the selected family member's household.</p>
          ) : null}
        </form>
        {profileFailed ? <StatusMessage tone="error">Your household setup is incomplete. Please finish family setup before creating a list.</StatusMessage> : null}
        {notice ? <StatusMessage tone={failed ? 'error' : 'success'}>{notice}</StatusMessage> : null}
        {loading || profileLoading ? <p className="muted-copy">Loading lists…</p> : null}
        {failed && !notice ? <StatusMessage tone="error">We could not load your lists. Please try again.</StatusMessage> : null}
        {!loading && !profileLoading && !failed && lists.length === 0 ? <p className="empty-state">No lists yet. Create a list for your household or a family member.</p> : null}

        <div className="list-stack">
          {lists.map((list) => {
            const items = [...(list.list_items ?? [])].sort((left, right) => left.position - right.position || left.item_text.localeCompare(right.item_text));
            const taggedPeople = (list.list_people ?? []).map((entry) => entry.people?.display_name).filter((name): name is string => Boolean(name));
            return (
              <article className="list-card" key={list.id}>
                <div className="list-card__heading">
                  <h3>{list.title}</h3>
                  {taggedPeople.length ? <div className="tag-list">{taggedPeople.map((name) => <span className="person-tag" key={name}>{name}</span>)}</div> : null}
                </div>
                {items.length ? (
                  <ul className="list-items">
                    {items.map((item) => (
                      <li className={`list-item${item.is_completed ? ' is-complete' : ''}`} key={item.id}>
                        <label className="list-item__label">
                          <input type="checkbox" checked={item.is_completed} onChange={(event) => void setItemCompleted(item, event.target.checked)} disabled={busy} />
                          <span>{item.item_text}</span>
                        </label>
                        <button className="icon-button" type="button" onClick={() => void removeItem(item)} disabled={busy} aria-label={`Remove ${item.item_text}`}>
                          <Trash aria-hidden="true" />
                        </button>
                      </li>
                    ))}
                  </ul>
                ) : <p className="muted-copy list-empty-copy">This list is empty.</p>}
                <form className="add-item-form" onSubmit={(event) => void addItem(event, list)}>
                  <label className="visually-hidden" htmlFor={`item-${list.id}`}>Add to {list.title}</label>
                  <input id={`item-${list.id}`} className="text-field" value={itemDrafts[list.id] ?? ''} onChange={(event) => setItemDrafts((current) => ({ ...current, [list.id]: event.target.value }))} placeholder="Add an item" maxLength={300} />
                  <button className="button button--secondary" type="submit" disabled={busy || !itemDrafts[list.id]?.trim()}><Check aria-hidden="true" /> Add</button>
                </form>
              </article>
            );
          })}
        </div>
      </section>
    </PageLayout>
  );
}
