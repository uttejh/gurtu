// Household vocabulary helpers. No runtime-specific imports, so the matching
// and hint-selection rules can be unit-tested.
import { containsWholeAlias, normalizeAlias, type PersonIdentity } from './people.ts';

export type VocabularyType = 'person' | 'crop' | 'product' | 'equipment' | 'supplier' | 'location' | 'expression' | 'abbreviation';

export interface VocabularyEntry {
  canonical_term: string;
  alias: string;
  entity_type: VocabularyType;
  person_id: string | null;
  updated_at: string;
}

const MAX_HINT_TERMS = 30;
const MAX_PROMPT_LINES = 20;

/** Confirmed entries whose alias or canonical term appears in the text as a whole word. */
export function vocabularyInText(text: string, entries: VocabularyEntry[]): VocabularyEntry[] {
  if (!text.trim()) return [];
  return entries.filter((entry) => containsWholeAlias(text, entry.alias) || containsWholeAlias(text, entry.canonical_term));
}

/** Short "alias = meaning (type)" lines for a model prompt, only for terms in the text. */
export function vocabularyPromptLines(text: string, entries: VocabularyEntry[]): string {
  const lines = [...new Set(vocabularyInText(text, entries).map((entry) => `${entry.alias} = ${entry.canonical_term} (${entry.entity_type})`))];
  return lines.slice(0, MAX_PROMPT_LINES).join('\n');
}

/** Canonical terms for aliases used in a question, to widen search without guessing. */
export function canonicalExpansions(text: string, entries: VocabularyEntry[]): string[] {
  const used = entries.filter((entry) => containsWholeAlias(text, entry.alias));
  const terms = used.map((entry) => entry.canonical_term).filter((term) => !containsWholeAlias(text, term));
  return [...new Set(terms)];
}

/** Family people with their confirmed person aliases added, for tagging. */
export function withVocabularyAliases(people: PersonIdentity[], entries: VocabularyEntry[]): PersonIdentity[] {
  return people.map((person) => {
    const extra = entries.filter((entry) => entry.entity_type === 'person' && entry.person_id === person.id).map((entry) => entry.alias);
    return extra.length ? { ...person, aliases: [...new Set([...person.aliases, ...extra])] } : person;
  });
}

/**
 * A small, relevant set of spellings for speech transcription: terms that appear
 * in the current conversation summary first, then the most recently confirmed,
 * then family names. Never the whole dictionary.
 */
export function transcriptionHints(entries: VocabularyEntry[], conversationSummary: string | null, familyNames: string[], limit = MAX_HINT_TERMS): string[] {
  const relevant = conversationSummary ? vocabularyInText(conversationSummary, entries) : [];
  const recent = [...entries].sort((left, right) => right.updated_at.localeCompare(left.updated_at));
  const ordered: string[] = [];
  const seen = new Set<string>();
  const add = (term: string) => {
    const key = normalizeAlias(term);
    if (!key || seen.has(key)) return;
    seen.add(key);
    ordered.push(term.trim());
  };
  for (const entry of relevant) { add(entry.canonical_term); add(entry.alias); }
  for (const name of familyNames) add(name);
  for (const entry of recent) { add(entry.canonical_term); add(entry.alias); }
  return ordered.slice(0, limit);
}
