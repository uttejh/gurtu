// Rules for turning conversation turns into household recall. No runtime-specific
// imports, so validation can be unit-tested.
import { isQuestion } from './intent.ts';
import { containsWholeAlias, findPeopleMentioned, normalizeAlias, type PersonIdentity } from './people.ts';

export interface TurnMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  created_at: string;
  metadata?: { kind?: unknown } | null;
}

export interface CandidateMemory {
  id: string;
  english_text: string;
  status: string;
  memory_type: string;
  created_at: string;
}

export type MemoryType = 'fact' | 'plan' | 'decision' | 'completed_action' | 'preference' | 'other';
export type MemoryStatus = 'current' | 'completed' | 'uncertain';
export type DatePrecision = 'exact' | 'approximate' | 'unknown';

export interface ExtractedMemory {
  english_text: string;
  memory_type: MemoryType;
  status: MemoryStatus;
  people: string[];
  occurred_on_start: string | null;
  occurred_on_end: string | null;
  date_precision: DatePrecision | null;
  source_message_numbers: number[];
}

export interface MemoryUpdate {
  memory_id: string;
  status: 'superseded' | 'completed';
  replaced_by_index: number | null;
}

export type VocabularyKind = 'person' | 'crop' | 'product' | 'equipment' | 'supplier' | 'location' | 'expression' | 'abbreviation';

export interface VocabularySighting {
  canonical_term: string;
  alias: string;
  entity_type: VocabularyKind;
  source_message_number: number;
}

export interface ExtractionResult {
  summary_en: string;
  memories: ExtractedMemory[];
  updates: MemoryUpdate[];
  vocabulary: VocabularySighting[];
}

const VOCABULARY_KINDS: VocabularyKind[] = ['person', 'crop', 'product', 'equipment', 'supplier', 'location', 'expression', 'abbreviation'];
const MAX_VOCABULARY = 8;

const MEMORY_TYPES: MemoryType[] = ['fact', 'plan', 'decision', 'completed_action', 'preference', 'other'];
const STATUSES: MemoryStatus[] = ['current', 'completed', 'uncertain'];
const PRECISIONS: DatePrecision[] = ['exact', 'approximate', 'unknown'];
const MAX_MEMORIES = 12;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const DATE = /^\d{4}-\d{2}-\d{2}$/u;

export const EXTRACTION_SCHEMA = {
  type: 'object',
  properties: {
    summary_en: { type: 'string' },
    memories: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          english_text: { type: 'string' },
          memory_type: { type: 'string', enum: MEMORY_TYPES },
          status: { type: 'string', enum: STATUSES },
          people: { type: 'array', items: { type: 'string' } },
          occurred_on_start: { type: ['string', 'null'] },
          occurred_on_end: { type: ['string', 'null'] },
          date_precision: { type: ['string', 'null'], enum: [...PRECISIONS, null] },
          source_message_numbers: { type: 'array', items: { type: 'integer' } },
        },
        required: ['english_text', 'memory_type', 'status', 'people', 'occurred_on_start', 'occurred_on_end', 'date_precision', 'source_message_numbers'],
        additionalProperties: false,
      },
    },
    updates: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          memory_id: { type: 'string' },
          status: { type: 'string', enum: ['superseded', 'completed'] },
          replaced_by_index: { type: ['integer', 'null'] },
        },
        required: ['memory_id', 'status', 'replaced_by_index'],
        additionalProperties: false,
      },
    },
    vocabulary: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          canonical_term: { type: 'string' },
          alias: { type: 'string' },
          entity_type: { type: 'string', enum: VOCABULARY_KINDS },
          source_message_number: { type: 'integer' },
        },
        required: ['canonical_term', 'alias', 'entity_type', 'source_message_number'],
        additionalProperties: false,
      },
    },
  },
  required: ['summary_en', 'memories', 'updates', 'vocabulary'],
  additionalProperties: false,
} as const;

export function hasTelugu(text: string): boolean {
  return /[ఀ-౿]/u.test(text);
}

function validDate(value: unknown): string | null {
  if (typeof value !== 'string' || !DATE.test(value)) return null;
  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day ? value : null;
}

/** Numbered transcript lines for the model. Assistant lines are context, not evidence. */
export function formatTurns(messages: TurnMessage[], speaker: string): string {
  return messages.map((message, index) => {
    const date = message.created_at.slice(0, 10);
    if (message.role === 'user') return `[${index + 1}] ${date} ${speaker}: ${message.content}`;
    const kind = message.metadata?.kind;
    const note = kind === 'saved' ? ' (this was saved as a family record; it is indexed separately)'
      : kind === 'answer' ? ' (an answer from existing records)' : '';
    return `[${index + 1}] ${date} Gurtu${note}: ${message.content}`;
  }).join('\n');
}

/**
 * Checks a model extraction against the turns it was given. Invalid memories are
 * dropped rather than trusted; an unusable result returns null so the job retries.
 */
export function validateExtraction(raw: unknown, messages: TurnMessage[], candidates: CandidateMemory[]): ExtractionResult | null {
  if (!raw || typeof raw !== 'object') return null;
  const value = raw as Record<string, unknown>;
  if (typeof value.summary_en !== 'string' || !value.summary_en.trim()) return null;
  // A memory must come from something the family member stated. Questions are not
  // facts, so a fact Gurtu gave in answer to a question is never re-saved as theirs.
  const userNumbers = new Set(messages.map((message, index) => (message.role === 'user' && !isQuestion(message.content) ? index + 1 : 0)).filter(Boolean));
  const memories: ExtractedMemory[] = [];
  for (const item of Array.isArray(value.memories) ? value.memories : []) {
    if (!item || typeof item !== 'object' || memories.length >= MAX_MEMORIES) continue;
    const memory = item as Record<string, unknown>;
    const text = typeof memory.english_text === 'string' ? memory.english_text.trim() : '';
    const sources = (Array.isArray(memory.source_message_numbers) ? memory.source_message_numbers : [])
      .filter((n): n is number => Number.isInteger(n) && userNumbers.has(n as number));
    if (!text || text.length > 1000 || !sources.length) continue;
    if (!MEMORY_TYPES.includes(memory.memory_type as MemoryType) || !STATUSES.includes(memory.status as MemoryStatus)) continue;
    const start = validDate(memory.occurred_on_start);
    const end = validDate(memory.occurred_on_end);
    memories.push({
      english_text: text,
      memory_type: memory.memory_type as MemoryType,
      status: memory.status as MemoryStatus,
      people: (Array.isArray(memory.people) ? memory.people : []).filter((name): name is string => typeof name === 'string' && name.trim().length > 0).slice(0, 20),
      occurred_on_start: start,
      occurred_on_end: start && end && end >= start ? end : null,
      date_precision: PRECISIONS.includes(memory.date_precision as DatePrecision) && start ? memory.date_precision as DatePrecision : null,
      source_message_numbers: [...new Set(sources)],
    });
  }
  const candidateIds = new Set(candidates.map((candidate) => candidate.id));
  const updates: MemoryUpdate[] = [];
  for (const item of Array.isArray(value.updates) ? value.updates : []) {
    if (!item || typeof item !== 'object' || updates.length >= MAX_MEMORIES) continue;
    const update = item as Record<string, unknown>;
    if (typeof update.memory_id !== 'string' || !UUID.test(update.memory_id) || !candidateIds.has(update.memory_id)) continue;
    if (update.status !== 'superseded' && update.status !== 'completed') continue;
    const index = Number.isInteger(update.replaced_by_index) && (update.replaced_by_index as number) >= 0 && (update.replaced_by_index as number) < memories.length
      ? update.replaced_by_index as number : null;
    updates.push({ memory_id: update.memory_id, status: update.status, replaced_by_index: index });
  }
  // A spelling counts only if it appears word for word in the family member's own message.
  const vocabulary: VocabularySighting[] = [];
  for (const item of Array.isArray(value.vocabulary) ? value.vocabulary : []) {
    if (!item || typeof item !== 'object' || vocabulary.length >= MAX_VOCABULARY) continue;
    const entry = item as Record<string, unknown>;
    const alias = typeof entry.alias === 'string' ? entry.alias.trim() : '';
    const canonical = typeof entry.canonical_term === 'string' ? entry.canonical_term.trim() : '';
    const number = entry.source_message_number;
    if (!alias || !canonical || alias.length > 80 || canonical.length > 80 || normalizeAlias(alias) === normalizeAlias(canonical)) continue;
    if (!VOCABULARY_KINDS.includes(entry.entity_type as VocabularyKind) || !Number.isInteger(number)) continue;
    const message = messages[(number as number) - 1];
    if (!message || message.role !== 'user' || !containsWholeAlias(message.content, alias)) continue;
    vocabulary.push({ canonical_term: canonical, alias, entity_type: entry.entity_type as VocabularyKind, source_message_number: number as number });
  }
  return { summary_en: value.summary_en.trim().slice(0, 6000), memories, updates, vocabulary };
}

/** Resolves model-reported names to family people, accepting only exact name or alias matches. */
export function resolvePeopleIds(names: string[], people: PersonIdentity[]): string[] {
  const ids = new Set<string>();
  for (const name of names) {
    const wanted = normalizeAlias(name);
    const matches = people.filter((person) => [person.displayName, ...person.aliases].some((alias) => normalizeAlias(alias) === wanted));
    if (matches.length === 1) ids.add(matches[0].id);
  }
  return [...ids];
}

/** People named in a text, so a tag never depends on the model alone. */
export function peopleInText(text: string, people: PersonIdentity[]): string[] {
  return findPeopleMentioned(text, people).map((person) => person.id);
}
