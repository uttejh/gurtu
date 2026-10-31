export interface AskEvidence {
  id: string;
  kind: 'memory' | 'item location' | 'list' | 'calendar event';
  created_at: string;
  content: string;
}

const TELUGU_SEARCH_ALIASES: Array<{ pattern: RegExp; terms: string[] }> = [
  { pattern: /(?:ఫ్లైట్|విమానం|విమానము|విమాన ప్రయాణం)/u, terms: ['flight', 'plane'] },
  { pattern: /(?:ట్రిప్|ప్రయాణం|పర్యటన)/u, terms: ['trip', 'travel'] },
  { pattern: /(?:పుట్టినరోజు|జన్మదినం|బర్త్‌డే|బర్త్డే)/u, terms: ['birthday', 'bday'] },
  { pattern: /(?:బ్యాంక్|బ్యాంకు|అపాయింట్‌మెంట్|అపాయింట్మెంట్)/u, terms: ['bank', 'appointment'] },
];

function bilingualAliases(value: string): string[] {
  return TELUGU_SEARCH_ALIASES.flatMap(({ pattern, terms }) => pattern.test(value) ? terms : []);
}

export function buildSearchTerms(question: string, expansions: string[] = []): string[] {
  const tokensFor = (value: string) =>
    value.normalize('NFKC').toLocaleLowerCase().match(/[\p{L}\p{M}\p{N}]+/gu) ?? []
  const aliases = [...bilingualAliases(question), ...expansions.flatMap(bilingualAliases)];
  const tokens = expansions.length
    ? [...aliases, ...expansions.flatMap(tokensFor), ...tokensFor(question)]
    : [...aliases, ...tokensFor(question)];
  return [...new Set(tokens.map((term) => term.normalize('NFKC').toLocaleLowerCase()).filter((term) => [...term].length >= 2))].slice(0, 16);
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
