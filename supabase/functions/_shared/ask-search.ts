export interface AskEvidence {
  id: string;
  kind: 'memory' | 'item location' | 'list' | 'calendar event';
  created_at: string;
  content: string;
}

export function buildSearchTerms(question: string, expansions: string[] = []): string[] {
  const tokensFor = (value: string) =>
    value.normalize('NFKC').toLocaleLowerCase().match(/[\p{L}\p{M}\p{N}]+/gu) ?? []
  const tokens = expansions.length
    ? [...expansions.flatMap(tokensFor), ...tokensFor(question)]
    : tokensFor(question);
  return [...new Set(tokens.filter((term) => [...term].length >= 2))].slice(0, 16);
}

function score(text: string, terms: string[], question: string): number {
  const normalized = text.normalize('NFKC').toLocaleLowerCase();
  const tokenScore = terms.reduce((count, term) => count + (normalized.includes(term) ? 1 : 0), 0);
  const phraseScore = normalized.includes(question.normalize('NFKC').toLocaleLowerCase()) ? 4 : 0;
  return tokenScore + phraseScore;
}

export function rankEvidence(records: AskEvidence[], terms: string[], question: string): AskEvidence[] {
  const grouped = new Map<string, AskEvidence>();
  for (const record of records) {
    const key = `${record.kind}:${record.id}`;
    const current = grouped.get(key);
    if (current) {
      const content = new Set([current.content, ...record.content.split('\n')]);
      current.content = [...content].join('\n');
      if (Date.parse(record.created_at) > Date.parse(current.created_at)) current.created_at = record.created_at;
    } else grouped.set(key, { ...record });
  }
  return [...grouped.values()].map((record) => ({ record, score: score(record.content, terms, question) }))
    .filter((entry) => entry.score > 0)
    .sort((left, right) => right.score - left.score || Date.parse(right.record.created_at) - Date.parse(left.record.created_at))
    .slice(0, 12)
    .map((entry) => entry.record);
}
