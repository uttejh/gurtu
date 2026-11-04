import { describe, expect, it } from 'vitest';
import { findPeopleMentioned, normalizeAlias } from '../../supabase/functions/_shared/people';

const people = [
  { id: 'mom', displayName: 'Mom', aliases: ['Mom', 'Amma', 'అమ్మ'] },
  { id: 'dad', displayName: 'Dad', aliases: ['Dad', 'నాన్న'] },
  { id: 'chinna', displayName: 'Chinna', aliases: ['Chinna', 'చిన్న'] },
];

describe('family name matching', () => {
  it('matches English and Telugu aliases without rewriting the source text', () => {
    const source = 'అమ్మ బంగారం bank locker లో ఉంది';
    expect(findPeopleMentioned(source, people).map((person) => person.id)).toEqual(['mom']);
    expect(source).toBe('అమ్మ బంగారం bank locker లో ఉంది');
  });

  it('does not match partial English words', () => {
    expect(findPeopleMentioned('My dadada said hello', people)).toEqual([]);
  });

  it('normalizes Unicode aliases consistently', () => {
    expect(normalizeAlias('  అమ్మ  ')).toBe(normalizeAlias('అమ్మ'));
  });

  it('reports ambiguous aliases rather than selecting a person', () => {
    const overlapping = [...people, { id: 'other', displayName: 'Other', aliases: ['Amma'] }];
    const match = findPeopleMentioned('Amma is here', overlapping);
    expect(match.map((person) => person.id)).toEqual(['mom', 'other']);
  });
});
