import { describe, expect, it } from 'vitest';
import { canonicalExpansions, transcriptionHints, vocabularyInText, vocabularyPromptLines, withVocabularyAliases, type VocabularyEntry } from '../../supabase/functions/_shared/vocabulary';

const entry = (alias: string, canonical: string, type: VocabularyEntry['entity_type'], updated: string, person: string | null = null): VocabularyEntry =>
  ({ alias, canonical_term: canonical, entity_type: type, person_id: person, updated_at: updated });
const vocabulary = [
  entry('Ramu', 'Ramesh', 'person', '2026-11-01', 'p1'),
  entry('రమేష్', 'Ramesh', 'person', '2026-11-02', 'p1'),
  entry('పత్తి', 'cotton', 'crop', '2026-11-03'),
  entry('DAP', 'DAP fertilizer', 'product', '2026-10-01'),
  entry('trac', 'tractor', 'equipment', '2026-09-01'),
];

describe('household vocabulary', () => {
  it('finds whole-word aliases in Telugu and English text', () => {
    expect(vocabularyInText('Ramu ki 2000 ichanu', vocabulary).map((item) => item.alias)).toEqual(['Ramu']);
    expect(vocabularyInText('పత్తి అమ్మాం', vocabulary).map((item) => item.canonical_term)).toEqual(['cotton']);
    expect(vocabularyInText('Ramudu came', vocabulary)).toEqual([]);
  });

  it('expands a question with the canonical term, without repeating one already present', () => {
    expect(canonicalExpansions('How much did we give Ramu?', vocabulary)).toEqual(['Ramesh']);
    expect(canonicalExpansions('Did Ramesh (Ramu) come?', vocabulary)).toEqual([]);
    expect(canonicalExpansions('DAP price last time?', vocabulary)).toEqual(['DAP fertilizer']);
  });

  it('gives the model only the vocabulary used in the message', () => {
    expect(vocabularyPromptLines('పత్తి, DAP కొన్నాం', vocabulary)).toBe('పత్తి = cotton (crop)\nDAP = DAP fertilizer (product)');
    expect(vocabularyPromptLines('hello', vocabulary)).toBe('');
  });

  it('adds confirmed person aliases to the family directory for tagging', () => {
    const people = withVocabularyAliases([{ id: 'p1', displayName: 'Ramesh', aliases: [] }, { id: 'p2', displayName: 'Dad', aliases: ['Nanna'] }], vocabulary);
    expect(people[0].aliases).toEqual(['Ramu', 'రమేష్']);
    expect(people[1].aliases).toEqual(['Nanna']);
  });

  it('picks transcription hints from the chat topic first, then family names, then recent terms, within a limit', () => {
    const hints = transcriptionHints(vocabulary, 'The family discussed the tractor repair.', ['Dad', 'Nanna'], 6);
    expect(hints.slice(0, 2)).toEqual(['tractor', 'trac']);
    expect(hints.slice(2, 4)).toEqual(['Dad', 'Nanna']);
    expect(hints).toHaveLength(6);
    expect(new Set(hints.map((hint) => hint.toLowerCase())).size).toBe(hints.length);
  });
});
