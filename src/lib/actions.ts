import { z } from 'zod';

const PersonMentions = z.array(z.string().trim().min(1).max(80)).max(20);
const OptionalSummary = z.string().trim().max(300).nullable();
const PlainText = z.string().trim().min(1).max(500);
const OriginalText = z.string().min(1).max(8000);

const SaveMemory = z.object({
  action: z.literal('save_memory'),
  original_text: OriginalText,
  people_mentions: PersonMentions,
  summary: OptionalSummary,
}).strict();

const SaveItemLocation = z.object({
  action: z.literal('save_item_location'),
  original_text: OriginalText,
  item_name: PlainText,
  location: PlainText,
  people_mentions: PersonMentions,
  summary: OptionalSummary,
}).strict();

const CreateList = z.object({
  action: z.literal('create_list'),
  title: PlainText,
  items: z.array(PlainText).max(100),
  people_mentions: PersonMentions,
}).strict();

const AddListItems = z.object({
  action: z.literal('add_list_items'),
  list_title: PlainText,
  items: z.array(PlainText).min(1).max(100),
  people_mentions: PersonMentions,
}).strict();

const UpdateListItem = z.object({
  action: z.literal('update_list_item'),
  list_title: PlainText,
  item_text: PlainText,
  completed: z.boolean(),
}).strict();

const RemoveListItem = z.object({
  action: z.literal('remove_list_item'),
  list_title: PlainText,
  item_text: PlainText,
}).strict();

const CreateEvent = z.object({
  action: z.literal('create_event'),
  title: PlainText,
  local_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/u),
  local_time: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/u).nullable(),
  end_time: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/u).nullable(),
  time_zone: z.string().min(1).max(80),
  all_day: z.boolean(),
  people_mentions: PersonMentions,
  end_time_assumed: z.boolean(),
}).strict().superRefine((event, context) => {
  if (!event.all_day && !event.local_time) {
    context.addIssue({ code: 'custom', path: ['local_time'], message: 'Timed events need a local time.' });
  }
  if (event.all_day && (event.local_time || event.end_time)) {
    context.addIssue({ code: 'custom', path: ['local_time'], message: 'All-day events cannot include a time.' });
  }
});

const UpdateEvent = z.object({
  action: z.literal('update_event'),
  event_title: PlainText,
  local_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/u),
  local_time: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/u).nullable(),
  time_zone: z.string().min(1).max(80),
  all_day: z.boolean(),
  people_mentions: PersonMentions,
}).strict();

const DeleteEvent = z.object({
  action: z.literal('delete_event'),
  event_title: PlainText,
  local_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/u).nullable(),
}).strict();

const Clarify = z.object({
  action: z.literal('clarify'),
  question: z.string().trim().min(1).max(240),
}).strict();

export const ActionProposalSchema = z.discriminatedUnion('action', [
  SaveMemory,
  SaveItemLocation,
  CreateList,
  AddListItems,
  UpdateListItem,
  RemoveListItem,
  CreateEvent,
  UpdateEvent,
  DeleteEvent,
  Clarify,
]);

export type ActionProposal = z.infer<typeof ActionProposalSchema>;

export const AskAnswerSchema = z.object({
  answer: z.string().trim().min(1).max(1200),
  found: z.boolean(),
  source_ids: z.array(z.string().uuid()).max(20),
}).strict().superRefine((value, context) => {
  if (!value.found && value.source_ids.length > 0) {
    context.addIssue({ code: 'custom', path: ['source_ids'], message: 'A not-found answer cannot cite records.' });
  }
  if (value.found && value.source_ids.length === 0) {
    context.addIssue({ code: 'custom', path: ['source_ids'], message: 'A grounded answer must cite a record.' });
  }
});
