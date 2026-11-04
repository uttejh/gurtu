export interface PersonIdentity {
  id: string;
  displayName: string;
  aliases: string[];
}

export function normalizeAlias(alias: string): string {
  return alias.normalize('NFKC').trim().replace(/\s+/gu, ' ').toLocaleLowerCase();
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
}

export function containsWholeAlias(text: string, alias: string): boolean {
  const normalizedAlias = normalizeAlias(alias);
  if (!normalizedAlias) return false;
  const normalizedText = normalizeAlias(text);
  const pattern = new RegExp(
    `(?<![\\p{L}\\p{N}])${escapeRegExp(normalizedAlias)}(?![\\p{L}\\p{N}])`,
    'iu',
  );
  return pattern.test(normalizedText);
}

export function findPeopleMentioned(text: string, people: PersonIdentity[]): PersonIdentity[] {
  const matches = new Map<string, PersonIdentity>();

  for (const person of people) {
    const names = [person.displayName, ...person.aliases];
    if (names.some((name) => containsWholeAlias(text, name))) {
      matches.set(person.id, person);
    }
  }

  return [...matches.values()];
}
