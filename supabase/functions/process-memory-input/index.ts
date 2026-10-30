import { Temporal } from 'npm:@js-temporal/polyfill@0.5.1';
import { z } from 'npm:zod@4.6.7';
import { ActionOutputSchema, validateProposal, type ActionProposal } from '../_shared/actions.ts';
import { consumeLimit, HttpError, readJson, withRequest, type RequestContext } from '../_shared/http.ts';
import { openAIJson } from '../_shared/openai.ts';

const InputSchema = z.discriminatedUnion('mode', [
  z.object({ mode: z.literal('interpret'), original_text: z.string().trim().min(1).max(8000), request_id: z.string().uuid() }).strict(),
  z.object({ mode: z.literal('execute'), original_text: z.string().trim().min(1).max(8000), request_id: z.string().uuid(), proposal: z.unknown(), person_ids: z.array(z.string().uuid()).max(100), confirmed: z.literal(true) }).strict(),
]);

type PersonRow = { id: string; display_name: string; aliases: string[]; home_household_id: string; households?: { timezone?: string } | null };

async function loadFamilyPeople(context: RequestContext): Promise<PersonRow[]> {
  const { data, error } = await context.supabase.from('people')
    .select('id,display_name,aliases,home_household_id,households(timezone)')
    .eq('family_id', context.profile.family_id)
    .eq('is_active', true)
    .order('display_name')
    .limit(100);
  if (error) throw new HttpError(503, 'Family names are not available right now.');
  return (data ?? []) as unknown as PersonRow[];
}

async function selectedFamilyPeople(context: RequestContext, ids: string[]): Promise<PersonRow[]> {
  const unique = [...new Set(ids)];
  if (unique.length !== ids.length) throw new HttpError(400, 'Please review the family member selections.');
  if (!unique.length) return [];
  const { data, error } = await context.supabase.from('people')
    .select('id,display_name,aliases,home_household_id,households(timezone)')
    .eq('family_id', context.profile.family_id)
    .eq('is_active', true)
    .in('id', unique);
  if (error || (data ?? []).length !== unique.length) throw new HttpError(403, 'A selected family member is not available.');
  return (data ?? []) as unknown as PersonRow[];
}

function detectLanguage(text: string): string {
  const hasTelugu = /[\u0C00-\u0C7F]/u.test(text);
  const hasLatin = /[A-Za-z]/u.test(text);
  if (hasTelugu && hasLatin) return 'te-en';
  if (hasTelugu) return 'te';
  if (hasLatin) return 'en';
  return 'und';
}

function personHint(people: PersonRow[]): string {
  return people.map((person) => {
    const aliases = (person.aliases ?? []).slice(0, 20).join(', ');
    return `${person.display_name}${aliases ? ` (${aliases})` : ''}; home time zone: ${person.households?.timezone ?? 'unknown'}`;
  }).join('\n');
}

function localToUtc(date: string, time: string, timeZone: string): string {
  try {
    return Temporal.PlainDateTime.from(`${date}T${time}:00`)
      .toZonedDateTime(timeZone, { disambiguation: 'reject' })
      .toInstant()
      .toString();
  } catch {
    throw new HttpError(400, 'That local time is unclear because of a daylight-saving change. Please choose another time.');
  }
}

function allowedTimeZone(zone: string, people: PersonRow[], currentZone: string): boolean {
  try {
    new Intl.DateTimeFormat('en', { timeZone: zone }).format(new Date());
  } catch {
    return false;
  }
  const allowed = new Set([currentZone, ...people.map((person) => person.households?.timezone).filter((value): value is string => Boolean(value))]);
  return allowed.has(zone);
}

async function stableItemRequestId(requestId: string, index: number): Promise<string> {
  const namespace = new Uint8Array(requestId.replaceAll('-', '').match(/.{2}/gu)!.map((part) => Number.parseInt(part, 16)));
  const name = new TextEncoder().encode(`gurtu-list-item:${index}`);
  const payload = new Uint8Array(namespace.length + name.length);
  payload.set(namespace);
  payload.set(name, namespace.length);
  const hash = new Uint8Array(await crypto.subtle.digest('SHA-1', payload));
  const uuid = hash.slice(0, 16);
  uuid[6] = (uuid[6] & 0x0f) | 0x50;
  uuid[8] = (uuid[8] & 0x3f) | 0x80;
  const hex = [...uuid].map((byte) => byte.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function requireRpcSuccess(error: { message?: string } | null) {
  if (error) throw new HttpError(400, 'The action could not be saved. Please check it and try again.');
}

async function findUniqueList(context: RequestContext, title: string): Promise<string> {
  const { data, error } = await context.supabase.from('lists').select('id').eq('title', title).limit(2);
  if (error || !data?.length) throw new HttpError(404, 'That list could not be found in your family lists.');
  if (data.length > 1) throw new HttpError(409, 'There is more than one list with that name. Please make the list name clearer.');
  return data[0].id as string;
}

async function executeProposal(context: RequestContext, proposal: ActionProposal, text: string, requestId: string, personIds: string[]) {
  const people = await selectedFamilyPeople(context, personIds);
  const supabase = context.supabase;
  switch (proposal.action) {
    case 'save_memory': {
      const { error } = await supabase.rpc('save_gurtu_memory', {
        p_original_text: text,
        p_language: detectLanguage(text),
        p_summary: proposal.summary,
        p_person_ids: personIds,
        p_request_id: requestId,
      });
      requireRpcSuccess(error);
      return { ok: true, message: 'Saved to your family memories.' };
    }
    case 'save_item_location': {
      const { error } = await supabase.rpc('save_gurtu_item_location', {
        p_original_text: text,
        p_item_name: proposal.item_name,
        p_location: proposal.location,
        p_person_ids: personIds,
        p_request_id: requestId,
      });
      requireRpcSuccess(error);
      return { ok: true, message: `Remembered where ${proposal.item_name} was last reported.` };
    }
    case 'create_list': {
      const { error } = await supabase.rpc('create_gurtu_list', {
        p_title: proposal.title,
        p_person_ids: personIds,
        p_items: proposal.items,
        p_request_id: requestId,
      });
      requireRpcSuccess(error);
      return { ok: true, message: `${proposal.title} was added to your lists.` };
    }
    case 'add_list_items': {
      const listId = await findUniqueList(context, proposal.list_title);
      for (const [index, itemText] of proposal.items.entries()) {
        const itemRequestId = await stableItemRequestId(requestId, index + 1);
        const { error } = await supabase.rpc('change_gurtu_list_item', {
          p_action: 'add', p_list_id: listId, p_item_text: itemText, p_request_id: itemRequestId,
        });
        requireRpcSuccess(error);
      }
      return { ok: true, message: `Added to ${proposal.list_title}.` };
    }
    case 'update_list_item':
    case 'remove_list_item': {
      const listId = await findUniqueList(context, proposal.list_title);
      const { data: matches, error } = await supabase.from('list_items').select('id')
        .eq('list_id', listId).eq('item_text', proposal.item_text).limit(2);
      if (error || !matches?.length) throw new HttpError(404, 'That item could not be found in the list.');
      if (matches.length > 1) throw new HttpError(409, 'That list has more than one matching item. Please make the item name clearer.');
      const { error: changeError } = await supabase.rpc('change_gurtu_list_item', {
        p_action: proposal.action === 'remove_list_item' ? 'remove' : proposal.completed ? 'complete' : 'uncomplete',
        p_list_id: listId,
        p_item_id: matches[0].id,
        p_request_id: requestId,
      });
      requireRpcSuccess(changeError);
      return { ok: true, message: proposal.action === 'remove_list_item' ? `Removed ${proposal.item_text}.` : 'Your list was updated.' };
    }
    case 'create_event': {
      if (!allowedTimeZone(proposal.time_zone, people, context.profile.timezone)) {
        throw new HttpError(400, 'Choose the time zone for this family event.');
      }
      const startsAt = proposal.all_day ? localToUtc(proposal.local_date, '00:00', proposal.time_zone) : localToUtc(proposal.local_date, proposal.local_time!, proposal.time_zone);
      const endsAt = proposal.all_day
        ? localToUtc(Temporal.PlainDate.from(proposal.local_date).add({ days: 1 }).toString(), '00:00', proposal.time_zone)
        : proposal.end_time
          ? localToUtc(proposal.end_time <= proposal.local_time! ? Temporal.PlainDate.from(proposal.local_date).add({ days: 1 }).toString() : proposal.local_date, proposal.end_time, proposal.time_zone)
          : Temporal.Instant.from(startsAt).add({ minutes: 60 }).toString();
      if (Temporal.Instant.compare(Temporal.Instant.from(endsAt), Temporal.Instant.from(startsAt)) <= 0) throw new HttpError(400, 'The event end must be after its start.');
      const { error } = await supabase.rpc('create_gurtu_event', {
        p_title: proposal.title,
        p_description: null,
        p_starts_at: startsAt,
        p_ends_at: endsAt,
        p_timezone: proposal.time_zone,
        p_is_all_day: proposal.all_day,
        p_person_ids: personIds,
        p_request_id: requestId,
      });
      requireRpcSuccess(error);
      return { ok: true, message: `${proposal.title} was added to your calendar.` };
    }
    case 'update_event': {
      if (!allowedTimeZone(proposal.time_zone, people, context.profile.timezone)) throw new HttpError(400, 'Choose the time zone for this family event.');
      const { data: events, error } = await supabase.from('events').select('id,owner_household_id')
        .eq('owner_household_id', context.profile.household_id).eq('title', proposal.event_title).limit(2);
      if (error || !events?.length) throw new HttpError(404, 'That event could not be found in your household calendar.');
      if (events.length > 1) throw new HttpError(409, 'There is more than one matching event. Please make the event name clearer.');
      const startsAt = proposal.all_day ? localToUtc(proposal.local_date, '00:00', proposal.time_zone) : localToUtc(proposal.local_date, proposal.local_time!, proposal.time_zone);
      const endsAt = proposal.all_day
        ? localToUtc(Temporal.PlainDate.from(proposal.local_date).add({ days: 1 }).toString(), '00:00', proposal.time_zone)
        : Temporal.Instant.from(startsAt).add({ minutes: 60 }).toString();
      const { error: updateError } = await supabase.rpc('update_gurtu_event', {
        p_event_id: events[0].id,
        p_title: proposal.event_title,
        p_starts_at: startsAt,
        p_ends_at: endsAt,
        p_timezone: proposal.time_zone,
        p_is_all_day: proposal.all_day,
        p_request_id: requestId,
      });
      requireRpcSuccess(updateError);
      return { ok: true, message: `${proposal.event_title} was updated.` };
    }
    case 'clarify':
      throw new HttpError(400, 'Please add the missing details before saving.');
  }
}

async function handler(context: RequestContext, request: Request) {
  const parsed = InputSchema.safeParse(await readJson(request, 12_000));
  if (!parsed.success) throw new HttpError(400, 'Please check the details and try again.');
  const input = parsed.data;

  if (input.mode === 'interpret') {
    await consumeLimit(context, 'ai_interpret');
    const people = await loadFamilyPeople(context);
    const currentTime = new Intl.DateTimeFormat('en', { dateStyle: 'full', timeStyle: 'short', timeZone: context.profile.timezone }).format(new Date());
    const raw = await openAIJson<unknown>({
      name: 'gurtu_memory_action',
      schema: ActionOutputSchema,
      instructions: `You help a family preserve information in Telugu, English, or mixed Telugu-English. Read the user's exact words and choose one supported action. Never invent dates, people, list names, event titles, or facts. Preserve the user's original words verbatim in original_text. If an event lacks a reliable date or time, return clarify. For a person-specific event, use that person's listed home time zone; otherwise use the current household time zone. If the input is a question rather than a clear request to save or change something, return clarify. Do not create reminders or notifications. Always include all schema fields; use null for unused strings/booleans and [] for unused arrays. People mentions must be names or aliases from the supplied directory. Current local time: ${currentTime}. Current household time zone: ${context.profile.timezone}. Family people (identity only):\n${personHint(people)}`,
      userContent: input.original_text,
      maxOutputTokens: 1600,
    });
    try {
      return { proposal: validateProposal(raw), request_id: input.request_id };
    } catch {
      throw new HttpError(502, 'Gurtu could not prepare a safe action. Please try saying it another way.');
    }
  }

  if (!input.confirmed) throw new HttpError(400, 'Confirm the action before saving it.');
  let proposal: ActionProposal;
  try {
    proposal = validateProposal(input.proposal);
  } catch {
    throw new HttpError(400, 'Please review the action and try again.');
  }
  if (proposal.action === 'clarify') throw new HttpError(400, 'Please add the missing details before saving.');
  return executeProposal(context, proposal, input.original_text, input.request_id, input.person_ids);
}

Deno.serve((request) => withRequest(request, handler));
