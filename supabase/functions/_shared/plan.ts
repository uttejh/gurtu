// Farm Kharchu and task plans: turns the model's proposed operations into
// validated, resolved operations. Numbers the model used to point at existing
// records ("task 2", "handover 1") are mapped to real IDs here, so the model
// never supplies an ID. No runtime-specific imports, so this is unit-tested.
import { formatPaise, parseAmountToPaise } from './money.ts';
import { normalizeAlias } from './people.ts';

export const NATURES = ['income', 'operating_expense', 'personal_payment', 'loan_received', 'loan_principal_repayment', 'interest_payment', 'cash_handover', 'cash_returned', 'transfer_adjustment'] as const;
export const STATUSES = ['actual', 'planned', 'estimate'] as const;
export const PRECISIONS = ['exact', 'approximate', 'unknown'] as const;
export const ALLOCATION_KINDS = ['farm_purchase', 'household_purchase', 'personal', 'wage_advance_applied', 'other'] as const;
export const PARTY_KINDS = ['worker', 'driver', 'mechanic', 'supplier', 'bank', 'landlord', 'buyer', 'family', 'other'] as const;
export const PLAN_OPS = ['create_task', 'complete_task', 'create_event', 'ledger_entry', 'allocation', 'correct_entry', 'void_entry'] as const;

export type Nature = typeof NATURES[number];
export type EntryStatus = typeof STATUSES[number];
export type Precision = typeof PRECISIONS[number];
export type AllocationKind = typeof ALLOCATION_KINDS[number];

export interface PlanContext {
  today: string;
  timeZone: string;
  allowedZones: string[];
  openTasks: Array<{ id: string; text: string; list_title: string; due_on: string | null }>;
  openHandovers: Array<{ id: string; description: string; party: string | null; amount_paise: number; remaining_paise: number }>;
  planned: Array<{ id: string; description: string; party: string | null; amount_paise: number; due_on: string | null; status: string }>;
  recentEntries: Array<{ id: string; description_en: string; party: string | null; category: string | null; amount_paise: number; occurred_on_start: string | null; nature: string; status: string }>;
}

export type ResolvedOperation =
  | { op: 'create_task'; ref: string | null; item_text: string; list_title: string | null; due_on: string | null }
  | { op: 'complete_task'; list_item_id: string; label: string }
  | { op: 'create_event'; ref: string | null; title: string; local_date: string; local_time: string | null; end_time: string | null; time_zone: string; all_day: boolean; task_ref: string | null; list_item_id: string | null }
  | { op: 'ledger_entry'; ref: string | null; nature: Nature; status: EntryStatus; amount_paise: number; description_en: string; party_name: string | null; party_kind: string | null; category_name: string | null;
      occurred_on_start: string | null; occurred_on_end: string | null; date_precision: Precision; date_expression: string | null; due_on: string | null; quantity: string | null; unit: string | null;
      task_ref: string | null; list_item_id: string | null; event_ref: string | null; handover_ref: string | null; handover_entry_id: string | null; fulfils_entry_id: string | null }
  | { op: 'allocation'; handover_ref: string | null; handover_entry_id: string | null; amount_paise: number; description_en: string; category_name: string | null; kind: AllocationKind; quantity: string | null; unit: string | null }
  | { op: 'correct_entry'; entry_id: string; label: string; changes: Record<string, string | number | null>; reason: string | null }
  | { op: 'void_entry'; entry_id: string; label: string; reason: string | null };

export type PlanResult = { ok: true; operations: ResolvedOperation[]; confirm: string | null } | { ok: false; question: string };

const nullable = (type: string) => ({ type: [type, 'null'] });
const PLAN_OPERATION_PROPERTIES = {
  op: { type: 'string', enum: [...PLAN_OPS] },
  ref: nullable('string'),
    task_text: nullable('string'), list_title: nullable('string'), due_on: nullable('string'), task_number: nullable('integer'), task_ref: nullable('string'),
    event_title: nullable('string'), event_date: nullable('string'), event_time: nullable('string'), event_end_time: nullable('string'), event_time_zone: nullable('string'),
    nature: { type: ['string', 'null'], enum: [...NATURES, null] },
    status: { type: ['string', 'null'], enum: [...STATUSES, null] },
    amount: nullable('string'), description_en: nullable('string'),
    party_name: nullable('string'), party_kind: { type: ['string', 'null'], enum: [...PARTY_KINDS, null] }, category_name: nullable('string'),
    occurred_on_start: nullable('string'), occurred_on_end: nullable('string'),
    date_precision: { type: ['string', 'null'], enum: [...PRECISIONS, null] }, date_expression: nullable('string'),
    quantity: nullable('string'), unit: nullable('string'),
    event_ref: nullable('string'), handover_ref: nullable('string'), handover_number: nullable('integer'), fulfils_number: nullable('integer'),
    allocation_kind: { type: ['string', 'null'], enum: [...ALLOCATION_KINDS, null] },
    entry_number: nullable('integer'), new_amount: nullable('string'), new_occurred_on_start: nullable('string'), new_occurred_on_end: nullable('string'),
    new_date_precision: { type: ['string', 'null'], enum: [...PRECISIONS, null] }, new_category_name: nullable('string'), new_party_name: nullable('string'),
    new_description_en: nullable('string'), reason: nullable('string'),
};
/** One flat object per operation; strict structured output needs every field. */
export const PLAN_OPERATION_SCHEMA = {
  type: 'object',
  properties: PLAN_OPERATION_PROPERTIES,
  required: Object.keys(PLAN_OPERATION_PROPERTIES),
  additionalProperties: false,
};

const DATE = /^\d{4}-\d{2}-\d{2}$/u;
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/u;
const MAX_OPERATIONS = 20;
const DUPLICATE_WINDOW_DAYS = 3;

function str(value: unknown, max: number): string | null {
  if (typeof value !== 'string') return null;
  const text = value.replace(/\s+/gu, ' ').trim();
  return text && text.length <= max ? text : null;
}

export function validDate(value: unknown): string | null {
  if (typeof value !== 'string' || !DATE.test(value)) return null;
  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day ? value : null;
}

function dayDifference(left: string, right: string): number {
  return Math.round((Date.parse(`${left}T00:00:00Z`) - Date.parse(`${right}T00:00:00Z`)) / 86_400_000);
}

function pick<T>(list: T[], number: unknown): T | null {
  return Number.isInteger(number) && (number as number) >= 1 && (number as number) <= list.length ? list[(number as number) - 1] : null;
}

function say(telugu: boolean, english: string, teluguText: string): string {
  return telugu ? teluguText : english;
}

function quantityText(value: unknown): string | null {
  if (typeof value !== 'string' && typeof value !== 'number') return null;
  const text = String(value).replaceAll(',', '').trim();
  return /^\d{1,9}(?:\.\d{1,3})?$/u.test(text) && Number(text) > 0 ? text : null;
}

/** Resolves and validates a proposed plan. Anything unclear becomes one short question. */
export function resolvePlan(raw: unknown, context: PlanContext, telugu: boolean): PlanResult {
  const items = Array.isArray(raw) ? raw : [];
  if (!items.length) return { ok: false, question: say(telugu, 'What would you like me to record?', 'ఏమి నమోదు చేయాలి?') };
  if (items.length > MAX_OPERATIONS) return { ok: false, question: say(telugu, 'That is a lot at once. Please tell me a few things at a time.', 'ఒకేసారి చాలా ఉన్నాయి. కొన్ని కొన్నిగా చెప్పండి.') };
  const operations: ResolvedOperation[] = [];
  const refs = new Map<string, ResolvedOperation['op']>();
  const confirmations: string[] = [];
  const handoverUse = new Map<string, { limit: number; used: number; label: string }>();

  const useRef = (ref: unknown, kind: ResolvedOperation['op']): string | null => {
    const name = str(ref, 40);
    return name && refs.get(name) === kind ? name : null;
  };

  for (const item of items) {
    if (!item || typeof item !== 'object') continue;
    const op = item as Record<string, unknown>;
    const ref = str(op.ref, 40);
    switch (op.op) {
      case 'create_task': {
        const text = str(op.task_text, 300);
        if (!text) return { ok: false, question: say(telugu, 'What is the task?', 'ఏ పని?') };
        const due = op.due_on == null ? null : validDate(op.due_on);
        if (op.due_on != null && !due) return { ok: false, question: say(telugu, `When is “${text}” due?`, `“${text}” ఎప్పటికి చేయాలి?`) };
        operations.push({ op: 'create_task', ref, item_text: text, list_title: str(op.list_title, 120), due_on: due });
        break;
      }
      case 'complete_task': {
        const task = pick(context.openTasks, op.task_number);
        if (!task) return { ok: false, question: say(telugu, 'Which task did you finish?', 'ఏ పని పూర్తయింది?') };
        operations.push({ op: 'complete_task', list_item_id: task.id, label: task.text });
        break;
      }
      case 'create_event': {
        const title = str(op.event_title, 160);
        const date = validDate(op.event_date);
        if (!title || !date) return { ok: false, question: say(telugu, 'Which day is it on?', 'ఏ రోజు?') };
        const time = typeof op.event_time === 'string' && TIME.test(op.event_time) ? op.event_time : null;
        const end = time && typeof op.event_end_time === 'string' && TIME.test(op.event_end_time) ? op.event_end_time : null;
        const zone = typeof op.event_time_zone === 'string' && context.allowedZones.includes(op.event_time_zone) ? op.event_time_zone : context.timeZone;
        const taskRef = useRef(op.task_ref, 'create_task');
        const task = taskRef ? null : pick(context.openTasks, op.task_number);
        operations.push({ op: 'create_event', ref, title, local_date: date, local_time: time, end_time: end, time_zone: zone, all_day: !time, task_ref: taskRef, list_item_id: task?.id ?? null });
        break;
      }
      case 'ledger_entry': {
        const nature = NATURES.includes(op.nature as Nature) ? op.nature as Nature : null;
        const status = STATUSES.includes(op.status as EntryStatus) ? op.status as EntryStatus : 'actual';
        const amount = parseAmountToPaise(op.amount);
        const description = str(op.description_en, 300);
        if (!nature || !description) return { ok: false, question: say(telugu, 'What was this money for?', 'ఈ డబ్బు దేనికి?') };
        if (!amount) return { ok: false, question: say(telugu, `How much was it for “${description}”?`, `“${description}”కి ఎంత?`) };
        let precision: Precision = PRECISIONS.includes(op.date_precision as Precision) ? op.date_precision as Precision : 'exact';
        let start = validDate(op.occurred_on_start);
        let end = validDate(op.occurred_on_end);
        if (precision === 'approximate' && (!start || !end || end < start)) { precision = start ? 'approximate' : 'unknown'; end = start && end && end >= start ? end : start; }
        if (precision === 'exact') {
          // No date stated: the household-local day the message was received.
          if (!start && status === 'actual') start = context.today;
          end = null;
        }
        if (precision === 'unknown') { start = null; end = null; }
        // A planned payment or estimate has a due date, not a date it happened.
        let due = validDate(op.due_on);
        if (status !== 'actual') { due = due ?? start; start = null; end = null; precision = 'unknown'; }
        if (status === 'actual' && start && start > context.today) {
          return { ok: false, question: say(telugu, `${formatPaise(amount)} for “${description}” is dated in the future. Has it been paid already, or is it planned?`, `“${description}” ${formatPaise(amount)} తేదీ ముందు రోజుల్లో ఉంది. ఇప్పటికే చెల్లించారా, లేక చెల్లించాలా?`) };
        }
        const handoverRef = useRef(op.handover_ref, 'ledger_entry');
        const handover = handoverRef ? null : pick(context.openHandovers, op.handover_number);
        if (nature === 'cash_returned' && !handoverRef && !handover) {
          return { ok: false, question: say(telugu, 'Which cash handover was this money returned from?', 'ఈ డబ్బు ఏ అడ్వాన్స్/ఇచ్చిన డబ్బులో నుంచి తిరిగి వచ్చింది?') };
        }
        const fulfils = status === 'actual' ? pick(context.planned, op.fulfils_number) : null;
        const taskRef = useRef(op.task_ref, 'create_task');
        const task = taskRef ? null : pick(context.openTasks, op.task_number);
        const resolved: Extract<ResolvedOperation, { op: 'ledger_entry' }> = {
          op: 'ledger_entry', ref, nature, status, amount_paise: amount, description_en: description,
          party_name: str(op.party_name, 80), party_kind: typeof op.party_kind === 'string' ? op.party_kind : null, category_name: str(op.category_name, 80),
          occurred_on_start: start, occurred_on_end: end, date_precision: precision, date_expression: str(op.date_expression, 80),
          due_on: status === 'actual' ? null : due, quantity: quantityText(op.quantity), unit: str(op.unit, 30),
          task_ref: taskRef, list_item_id: task?.id ?? null, event_ref: useRef(op.event_ref, 'create_event'),
          handover_ref: nature === 'cash_returned' ? handoverRef : null, handover_entry_id: nature === 'cash_returned' ? handover?.id ?? null : null,
          fulfils_entry_id: fulfils?.id ?? null,
        };
        operations.push(resolved);
        if (nature === 'cash_handover' && status === 'actual' && ref) handoverUse.set(`ref:${ref}`, { limit: amount, used: 0, label: description });
        if (nature === 'cash_returned') {
          const key = handoverRef ? `ref:${handoverRef}` : `id:${handover!.id}`;
          if (!handoverRef && !handoverUse.has(key)) handoverUse.set(key, { limit: handover!.remaining_paise, used: 0, label: handover!.description });
          handoverUse.get(key)!.used += amount;
        }
        if (status === 'actual' && !['cash_returned'].includes(nature)) {
          const duplicate = context.recentEntries.find((entry) => entry.status === 'actual' && entry.amount_paise === amount && entry.nature === nature
            && normalizeAlias(entry.party ?? '') === normalizeAlias(resolved.party_name ?? '')
            && entry.occurred_on_start && start && Math.abs(dayDifference(entry.occurred_on_start, start)) <= DUPLICATE_WINDOW_DAYS);
          if (duplicate) {
            confirmations.push(say(telugu,
              `There is already ${formatPaise(amount)}${duplicate.party ? ` to ${duplicate.party}` : ''} on ${duplicate.occurred_on_start} (${duplicate.description_en}). Is this a separate payment?`,
              `${duplicate.occurred_on_start}న ${formatPaise(amount)}${duplicate.party ? ` ${duplicate.party}కి` : ''} ఇప్పటికే నమోదైంది (${duplicate.description_en}). ఇది వేరే చెల్లింపా?`));
          }
        }
        break;
      }
      case 'allocation': {
        const amount = parseAmountToPaise(op.amount);
        const description = str(op.description_en, 300);
        const handoverRef = useRef(op.handover_ref, 'ledger_entry');
        const handover = handoverRef ? null : pick(context.openHandovers, op.handover_number);
        if (!handoverRef && !handover) return { ok: false, question: say(telugu, 'Which money given earlier was this spent from?', 'ఇది ముందు ఇచ్చిన ఏ డబ్బులో నుంచి ఖర్చు చేశారు?') };
        if (!amount || !description) return { ok: false, question: say(telugu, 'How much was spent, and on what?', 'ఎంత, దేనికి ఖర్చు చేశారు?') };
        const kind = ALLOCATION_KINDS.includes(op.allocation_kind as AllocationKind) ? op.allocation_kind as AllocationKind : 'other';
        operations.push({ op: 'allocation', handover_ref: handoverRef, handover_entry_id: handover?.id ?? null, amount_paise: amount, description_en: description, category_name: str(op.category_name, 80), kind, quantity: quantityText(op.quantity), unit: str(op.unit, 30) });
        const key = handoverRef ? `ref:${handoverRef}` : `id:${handover!.id}`;
        if (!handoverRef && !handoverUse.has(key)) handoverUse.set(key, { limit: handover!.remaining_paise, used: 0, label: handover!.description });
        handoverUse.get(key)!.used += amount;
        break;
      }
      case 'correct_entry': {
        const entry = pick(context.recentEntries, op.entry_number);
        if (!entry) return { ok: false, question: say(telugu, 'Which entry should I correct?', 'ఏ నమోదును సరిచేయాలి?') };
        const changes: Record<string, string | number | null> = {};
        const newAmount = op.new_amount == null ? null : parseAmountToPaise(op.new_amount);
        if (op.new_amount != null && !newAmount) return { ok: false, question: say(telugu, 'What is the correct amount?', 'సరైన మొత్తం ఎంత?') };
        if (newAmount) changes.amount_paise = newAmount;
        const newStart = validDate(op.new_occurred_on_start);
        if (newStart) {
          if (entry.status === 'actual' && newStart > context.today) return { ok: false, question: say(telugu, 'That date is in the future. Which day did it happen?', 'ఆ తేదీ ముందు రోజుల్లో ఉంది. ఏ రోజు జరిగింది?') };
          const precision = PRECISIONS.includes(op.new_date_precision as Precision) ? op.new_date_precision as Precision : 'exact';
          const newEnd = precision === 'approximate' ? validDate(op.new_occurred_on_end) : null;
          changes.occurred_on_start = newStart;
          changes.occurred_on_end = newEnd && newEnd >= newStart ? newEnd : null;
          changes.date_precision = changes.occurred_on_end ? 'approximate' : 'exact';
        }
        const category = str(op.new_category_name, 80); if (category) changes.category_name = category;
        const party = str(op.new_party_name, 80); if (party) changes.party_name = party;
        const description = str(op.new_description_en, 300); if (description) changes.description_en = description;
        if (!Object.keys(changes).length) return { ok: false, question: say(telugu, 'What should I change in that entry?', 'ఆ నమోదులో ఏమి మార్చాలి?') };
        operations.push({ op: 'correct_entry', entry_id: entry.id, label: `${entry.description_en} (${formatPaise(entry.amount_paise)})`, changes, reason: str(op.reason, 300) });
        break;
      }
      case 'void_entry': {
        const entry = pick(context.recentEntries, op.entry_number);
        if (!entry) return { ok: false, question: say(telugu, 'Which entry should I undo?', 'ఏ నమోదును తీసివేయాలి?') };
        const label = `${entry.description_en} (${formatPaise(entry.amount_paise)}${entry.occurred_on_start ? `, ${entry.occurred_on_start}` : ''})`;
        operations.push({ op: 'void_entry', entry_id: entry.id, label, reason: str(op.reason, 300) });
        confirmations.push(say(telugu, `Should I undo “${label}”?`, `“${label}” నమోదును తీసివేయాలా?`));
        break;
      }
      default:
        return { ok: false, question: say(telugu, 'Could you say that another way?', 'ఇంకోలా చెప్పగలరా?') };
    }
    if (ref) refs.set(ref, operations.at(-1)!.op);
  }

  // Allocations plus returned cash must fit the money handed over; ask instead of guessing.
  for (const use of handoverUse.values()) {
    if (use.used > use.limit) {
      return { ok: false, question: say(telugu,
        `Those amounts add up to ${formatPaise(use.used)}, which is more than the ${formatPaise(use.limit)} available from “${use.label}”. Could you check the numbers?`,
        `ఆ మొత్తాలు కలిపి ${formatPaise(use.used)}, కానీ “${use.label}”లో ${formatPaise(use.limit)} మాత్రమే ఉంది. లెక్కలు ఒకసారి చూడగలరా?`) };
    }
  }
  if (!operations.length) return { ok: false, question: say(telugu, 'What would you like me to record?', 'ఏమి నమోదు చేయాలి?') };
  // "We bought the seeds for ₹12,000" completes one task and pays for it: link them.
  const completed = operations.filter((operation) => operation.op === 'complete_task');
  if (completed.length === 1) {
    const taskId = (completed[0] as Extract<ResolvedOperation, { op: 'complete_task' }>).list_item_id;
    for (const operation of operations) {
      if (operation.op === 'ledger_entry' && operation.status === 'actual' && operation.nature !== 'cash_returned' && !operation.task_ref && !operation.list_item_id) operation.list_item_id = taskId;
    }
  }
  return { ok: true, operations, confirm: confirmations.length ? confirmations.join(' ') : null };
}

const NATURE_WORDS: Record<Nature, [string, string]> = {
  income: ['received', 'వచ్చింది'],
  operating_expense: ['spent', 'ఖర్చు'],
  personal_payment: ['paid (personal)', 'వ్యక్తిగతంగా ఇచ్చారు'],
  loan_received: ['loan received', 'అప్పు వచ్చింది'],
  loan_principal_repayment: ['loan repaid', 'అప్పు తీర్చారు'],
  interest_payment: ['interest paid', 'వడ్డీ కట్టారు'],
  cash_handover: ['given', 'ఇచ్చారు'],
  cash_returned: ['returned', 'తిరిగి వచ్చింది'],
  transfer_adjustment: ['moved', 'బదిలీ'],
};

/** A short, deterministic confirmation of what a plan changed. */
export function planSummary(operations: ResolvedOperation[], context: Pick<PlanContext, 'openHandovers'>, telugu: boolean): string {
  const lines: string[] = [];
  const handovers = new Map<string, { amount: number; used: number; party: string | null }>();
  operations.forEach((operation) => {
    switch (operation.op) {
      case 'create_task':
        lines.push(say(telugu, `Added task “${operation.item_text}”${operation.due_on ? ` (due ${operation.due_on})` : ''}.`, `“${operation.item_text}” పని చేర్చాను${operation.due_on ? ` (${operation.due_on}కి)` : ''}.`));
        break;
      case 'complete_task':
        lines.push(say(telugu, `Marked “${operation.label}” done.`, `“${operation.label}” పూర్తయినట్లు గుర్తించాను.`));
        break;
      case 'create_event':
        lines.push(say(telugu, `Added “${operation.title}” to the calendar on ${operation.local_date}${operation.local_time ? ` at ${operation.local_time}` : ''}.`, `${operation.local_date}న “${operation.title}” క్యాలెండర్‌లో చేర్చాను.`));
        break;
      case 'ledger_entry': {
        const money = formatPaise(operation.amount_paise);
        const who = operation.party_name ? (telugu ? ` ${operation.party_name}కి` : ` to ${operation.party_name}`) : '';
        if (operation.status === 'planned') lines.push(say(telugu, `Noted ${money} due for “${operation.description_en}”${operation.due_on ? ` (${operation.due_on})` : ''}. It is not counted as spent until it is paid.`, `“${operation.description_en}”కి ${money} చెల్లించాల్సి ఉంది అని గుర్తుంచుకున్నాను. చెల్లించే వరకు ఖర్చుగా లెక్కించను.`));
        else if (operation.status === 'estimate') lines.push(say(telugu, `Noted an estimate of ${money} for “${operation.description_en}”. It is not counted as spent.`, `“${operation.description_en}”కి ${money} అంచనా గుర్తుంచుకున్నాను. ఇది ఖర్చుగా లెక్కించను.`));
        else if (operation.nature === 'cash_handover') lines.push(say(telugu, `Recorded ${money} given${who}: ${operation.description_en}.`, `${money}${who} ఇచ్చినట్లు నమోదు చేశాను: ${operation.description_en}.`));
        else if (operation.nature === 'cash_returned') lines.push(say(telugu, `Recorded ${money} returned.`, `${money} తిరిగి వచ్చినట్లు నమోదు చేశాను.`));
        else lines.push(say(telugu, `Recorded ${money} ${NATURE_WORDS[operation.nature][0]}: ${operation.description_en}.`, `${money} ${NATURE_WORDS[operation.nature][1]} నమోదు చేశాను: ${operation.description_en}.`));
        if (operation.nature === 'cash_handover' && operation.status === 'actual' && operation.ref) handovers.set(`ref:${operation.ref}`, { amount: operation.amount_paise, used: 0, party: operation.party_name });
        if (operation.nature === 'cash_returned') {
          const key = operation.handover_ref ? `ref:${operation.handover_ref}` : `id:${operation.handover_entry_id}`;
          const existing = context.openHandovers.find((item) => item.id === operation.handover_entry_id);
          if (!handovers.has(key) && existing) handovers.set(key, { amount: existing.remaining_paise, used: 0, party: existing.party });
          if (handovers.has(key)) handovers.get(key)!.used += operation.amount_paise;
        }
        break;
      }
      case 'allocation': {
        lines.push(say(telugu, `Of that, ${formatPaise(operation.amount_paise)} for ${operation.description_en}.`, `అందులో ${formatPaise(operation.amount_paise)} ${operation.description_en}కి.`));
        const key = operation.handover_ref ? `ref:${operation.handover_ref}` : `id:${operation.handover_entry_id}`;
        const existing = context.openHandovers.find((item) => item.id === operation.handover_entry_id);
        if (!handovers.has(key) && existing) handovers.set(key, { amount: existing.remaining_paise, used: 0, party: existing.party });
        if (handovers.has(key)) handovers.get(key)!.used += operation.amount_paise;
        break;
      }
      case 'correct_entry':
        lines.push(say(telugu, `Corrected “${operation.label}”${operation.changes.amount_paise ? ` to ${formatPaise(Number(operation.changes.amount_paise))}` : ''}${operation.changes.occurred_on_start ? `, date ${operation.changes.occurred_on_start}` : ''}. The earlier value is kept in its history.`, `“${operation.label}” సరిచేశాను. పాత వివరాలు చరిత్రలో ఉంటాయి.`));
        break;
      case 'void_entry':
        lines.push(say(telugu, `Undid “${operation.label}”. It stays in the history but no longer counts.`, `“${operation.label}” తీసివేశాను. చరిత్రలో ఉంటుంది, కానీ లెక్కలో ఉండదు.`));
        break;
    }
  });
  for (const handover of handovers.values()) {
    if (!handover.used) continue;
    const remaining = handover.amount - handover.used;
    lines.push(remaining === 0
      ? say(telugu, 'That money is fully accounted for.', 'ఆ డబ్బు లెక్క పూర్తయింది.')
      : say(telugu, `${formatPaise(remaining)} is not yet accounted for.`, `ఇంకా ${formatPaise(remaining)} లెక్క తేలాలి.`));
  }
  return lines.join(' ');
}
