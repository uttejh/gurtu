-- Facts taken from a chat are removed with that chat (or with the login that
-- owns it). Previously the reference was set to null, which the table's own
-- check forbids, so deleting such a chat failed. Saved-memory rows are unaffected.
alter table public.family_memories drop constraint family_memories_conversation_id_fkey;
alter table public.family_memories add constraint family_memories_conversation_id_fkey
  foreign key (conversation_id) references public.conversations(id) on delete cascade;
