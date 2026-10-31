import { describe, expect, it } from 'vitest';
import { buildSearchTerms, rankEvidence, type AskEvidence } from '../../supabase/functions/_shared/ask-search';

describe('multilingual family search', () => {
  it('combines Telugu words with translated English search terms', () => {
    const terms = buildSearchTerms('నా ఫ్లైట్ ఎప్పుడు?', ['flight', 'flight date']);

    expect(terms).toEqual(expect.arrayContaining(['ఫ్లైట్', 'ఎప్పుడు', 'flight', 'date']));
    expect(terms[0]).toBe('flight');
  });

  it('finds an English calendar event from a Telugu question and its translation', () => {
    const event: AskEvidence = {
      id: 'flight-event',
      kind: 'calendar event',
      created_at: '2026-10-30T12:00:00.000Z',
      content: 'Flight\nDec 3, 2026 all day (America/Toronto)',
    };
    const question = 'నా ఫ్లైట్ ఎప్పుడు?';
    const terms = buildSearchTerms(question, ['flight', 'flight date']);

    expect(rankEvidence([event], terms, question).map((record) => record.id)).toEqual(['flight-event']);
  });

  it('keeps PostgREST search terms free of query syntax characters', () => {
    expect(buildSearchTerms('Flight (Dec 3)', ['flight, %_ OR title.eq.any'])).toEqual(
      expect.arrayContaining(['flight', 'dec', 'any']),
    );
    expect(buildSearchTerms('Flight, %_ OR title.eq.any', [''])).not.toContain('%');
  });
});
