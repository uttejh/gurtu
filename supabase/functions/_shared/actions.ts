import { z } from 'npm:zod@4.6.7';

const Text = z.string().trim().min(1).max(500);
const Mentions = z.array(z.string().trim().min(1).max(80)).max(20);
const DateString = z.string().regex(/^\d{4}-\d{2}-\d{2}$/u);
const TimeString = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/u);

const Proposal = z.discriminatedUnion('action', [
  z.object({ action: z.literal('save_memory'), original_text: z.string().min(1).max(8000), people_mentions: Mentions, summary: z.string().max(300).nullable() }).strict(),
  z.object({ action: z.literal('save_item_location'), original_text: z.string().min(1).max(8000), item_name: Text.max(200), location: Text.max(500), people_mentions: Mentions, summary: z.string().max(300).nullable() }).strict(),
  z.object({ action: z.literal('create_list'), title: Text.max(120), items: z.array(Text.max(300)).max(100), people_mentions: Mentions }).strict(),
  z.object({ action: z.literal('add_list_items'), list_title: Text.max(120), items: z.array(Text.max(300)).min(1).max(100), people_mentions: Mentions }).strict(),
  z.object({ action: z.literal('update_list_item'), list_title: Text.max(120), item_text: Text.max(300), completed: z.boolean(), people_mentions: Mentions }).strict(),
  z.object({ action: z.literal('remove_list_item'), list_title: Text.max(120), item_text: Text.max(300), people_mentions: Mentions }).strict(),
  z.object({ action: z.literal('create_event'), title: Text.max(160), local_date: DateString, local_time: TimeString.nullable(), end_time: TimeString.nullable(), time_zone: z.string().min(1).max(80), all_day: z.boolean(), people_mentions: Mentions, end_time_assumed: z.boolean() }).strict().superRefine((event, context) => {
    if (!event.all_day && !event.local_time) context.addIssue({ code: 'custom', path: ['local_time'], message: 'Timed events need a local time.' });
    if (event.all_day && (event.local_time || event.end_time)) context.addIssue({ code: 'custom', path: ['local_time'], message: 'All-day events cannot include times.' });
  }),
  z.object({ action: z.literal('update_event'), event_title: Text.max(160), local_date: DateString, local_time: TimeString.nullable(), time_zone: z.string().min(1).max(80), all_day: z.boolean(), people_mentions: Mentions }).strict(),
  z.object({ action: z.literal('delete_event'), event_title: Text.max(160), local_date: DateString.nullable() }).strict(),
  z.object({ action: z.literal('teach_vocabulary'), canonical_term: Text.max(80), aliases: z.array(Text.max(80)).min(1).max(10), entity_type: z.enum(['person', 'crop', 'product', 'equipment', 'supplier', 'location', 'expression', 'abbreviation']), relation: z.enum(['same', 'not_same']) }).strict(),
  z.object({ action: z.literal('clarify'), question: z.string().trim().min(1).max(240) }).strict(),
]);

const properties = {
  action: { type: 'string', enum: ['save_memory', 'save_item_location', 'create_list', 'add_list_items', 'update_list_item', 'remove_list_item', 'create_event', 'update_event', 'delete_event', 'teach_vocabulary', 'clarify'] },
  original_text: { type: ['string', 'null'] },
  summary: { type: ['string', 'null'] },
  item_name: { type: ['string', 'null'] },
  location: { type: ['string', 'null'] },
  title: { type: ['string', 'null'] },
  items: { type: 'array', items: { type: 'string' } },
  list_title: { type: ['string', 'null'] },
  item_text: { type: ['string', 'null'] },
  completed: { type: ['boolean', 'null'] },
  event_title: { type: ['string', 'null'] },
  local_date: { type: ['string', 'null'] },
  local_time: { type: ['string', 'null'] },
  end_time: { type: ['string', 'null'] },
  time_zone: { type: ['string', 'null'] },
  all_day: { type: ['boolean', 'null'] },
  end_time_assumed: { type: ['boolean', 'null'] },
  people_mentions: { type: 'array', items: { type: 'string' } },
  question: { type: ['string', 'null'] },
  canonical_term: { type: ['string', 'null'] },
  aliases: { type: 'array', items: { type: 'string' } },
  entity_type: { type: ['string', 'null'], enum: ['person', 'crop', 'product', 'equipment', 'supplier', 'location', 'expression', 'abbreviation', null] },
  relation: { type: ['string', 'null'], enum: ['same', 'not_same', null] },
};

export const ActionOutputSchema = {
  type: 'object',
  properties,
  required: Object.keys(properties),
  additionalProperties: false,
};

type ActionOutput = {
  action: string;
  original_text: string | null;
  summary: string | null;
  item_name: string | null;
  location: string | null;
  title: string | null;
  items: string[];
  list_title: string | null;
  item_text: string | null;
  completed: boolean | null;
  event_title: string | null;
  local_date: string | null;
  local_time: string | null;
  end_time: string | null;
  time_zone: string | null;
  all_day: boolean | null;
  end_time_assumed: boolean | null;
  people_mentions: string[];
  question: string | null;
  canonical_term: string | null;
  aliases: string[];
  entity_type: string | null;
  relation: string | null;
};

export type ActionProposal = z.infer<typeof Proposal>;

export function validateProposal(value: unknown): ActionProposal {
  if (!value || typeof value !== 'object') throw new Error('Invalid AI proposal.');
  const output = value as ActionOutput;
  const fields: Record<string, unknown> = { action: output.action };
  const keys: Record<string, string[]> = {
    save_memory: ['original_text', 'people_mentions', 'summary'],
    save_item_location: ['original_text', 'item_name', 'location', 'people_mentions', 'summary'],
    create_list: ['title', 'items', 'people_mentions'],
    add_list_items: ['list_title', 'items', 'people_mentions'],
    update_list_item: ['list_title', 'item_text', 'completed', 'people_mentions'],
    remove_list_item: ['list_title', 'item_text', 'people_mentions'],
    create_event: ['title', 'local_date', 'local_time', 'end_time', 'time_zone', 'all_day', 'people_mentions', 'end_time_assumed'],
    update_event: ['event_title', 'local_date', 'local_time', 'time_zone', 'all_day', 'people_mentions'],
    delete_event: ['event_title', 'local_date'],
    teach_vocabulary: ['canonical_term', 'aliases', 'entity_type', 'relation'],
    clarify: ['question'],
  };
  for (const key of keys[output.action] ?? []) fields[key] = output[key as keyof ActionOutput];
  return Proposal.parse(fields);
}

export const AskOutputSchema = {
  type: 'object',
  properties: {
    answer: { type: 'string' },
    found: { type: 'boolean' },
    source_ids: { type: 'array', items: { type: 'string', format: 'uuid' } },
  },
  required: ['answer', 'found', 'source_ids'],
  additionalProperties: false,
};

export const AskOutput = z.object({
  answer: z.string().trim().min(1).max(1200),
  found: z.boolean(),
  source_ids: z.array(z.string().uuid()).max(20),
}).strict().superRefine((value, context) => {
  if (!value.found && value.source_ids.length) context.addIssue({ code: 'custom', path: ['source_ids'], message: 'Not-found answers cannot cite records.' });
  if (value.found && !value.source_ids.length) context.addIssue({ code: 'custom', path: ['source_ids'], message: 'Grounded answers need at least one source.' });
});
