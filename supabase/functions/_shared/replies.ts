// Deterministic chat replies for saved actions. Kept free of runtime-specific
// imports so the wording can be unit-tested.

export function isTeluguText(value: string): boolean {
  return /[ఀ-౿]/u.test(value);
}

/** Formats a YYYY-MM-DD local date without shifting it through a time zone. */
export function formatLocalDate(value: string, locale: 'en' | 'te-IN' = 'en'): string {
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})$/u);
  if (!match) return value;
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  return new Intl.DateTimeFormat(locale, { dateStyle: 'long', timeZone: 'UTC' }).format(date);
}

export function eventZoneLabel(zone: string): string {
  if (zone === 'Asia/Kolkata') return 'India time';
  if (zone === 'America/Toronto') return 'Toronto time';
  try {
    return new Intl.DateTimeFormat('en', { timeZone: zone, timeZoneName: 'shortGeneric' })
      .formatToParts(new Date()).find((part) => part.type === 'timeZoneName')?.value ?? zone;
  } catch {
    return zone;
  }
}

/** The subset of an action proposal that the reply wording needs. */
export type ReplyProposal =
  | { action: 'create_event'; title: string; local_date: string; local_time: string | null; time_zone: string; all_day: boolean }
  | { action: 'save_memory' }
  | { action: 'save_item_location'; item_name: string; location: string }
  | { action: 'create_list'; title: string }
  | { action: 'add_list_items'; list_title: string }
  | { action: 'update_list_item'; list_title: string }
  | { action: 'remove_list_item'; list_title: string; item_text: string }
  | { action: 'update_event'; event_title: string }
  | { action: 'delete_event'; event_title: string; local_date: string | null }
  | { action: 'teach_vocabulary'; canonical_term: string; aliases: string[]; relation: 'same' | 'not_same' }
  | { action: 'clarify'; question: string };

/** A friendly confirmation after a save. Undefined means use the server's own message. */
export function successMessage(input: string, proposal: ReplyProposal): string | undefined {
  const telugu = isTeluguText(input);
  if (proposal.action === 'create_event') {
    const date = formatLocalDate(proposal.local_date, telugu ? 'te-IN' : 'en');
    if (telugu) {
      const time = proposal.all_day ? '' : `, ${proposal.local_time}`;
      return `సరే — ${date}న ${proposal.title} ఈవెంట్‌ను కుటుంబ క్యాలెండర్‌లో చేర్చాను${time}.`;
    }
    const time = proposal.all_day ? '' : ` at ${proposal.local_time} ${eventZoneLabel(proposal.time_zone)}`;
    return `Got it — ${proposal.title} is on ${date}${time}, and I added it to the family calendar.`;
  }
  if (!telugu) return undefined;
  switch (proposal.action) {
    case 'save_memory': return 'సరే — దీన్ని మీ కుటుంబ జ్ఞాపకాల్లో భద్రపరిచాను.';
    case 'save_item_location': return `${proposal.item_name} చివరిగా ${proposal.location}లో ఉందని గుర్తుంచుకున్నాను.`;
    case 'create_list': return `సరే — “${proposal.title}” జాబితాను సృష్టించాను.`;
    case 'add_list_items': return `సరే — ${proposal.list_title} జాబితాకు చేర్చాను.`;
    case 'update_list_item': return `సరే — ${proposal.list_title} జాబితాను నవీకరించాను.`;
    case 'update_event': return `సరే — ${proposal.event_title} ఈవెంట్‌ను నవీకరించాను.`;
    case 'teach_vocabulary': return proposal.relation === 'same'
      ? `సరే — ${proposal.aliases.join(', ')} అంటే ${proposal.canonical_term} అని గుర్తుంచుకుంటాను.`
      : `సరే — ${proposal.aliases.join(', ')}, ${proposal.canonical_term} వేర్వేరు అని గుర్తుంచుకుంటాను.`;
    default: return undefined;
  }
}

export function removalQuestion(input: string, item: string, list: string): string {
  return isTeluguText(input)
    ? `“${item}”ను ${list} జాబితా నుంచి తీసివేయాలా?`
    : `Would you like me to remove “${item}” from ${list}?`;
}

export function deleteEventQuestion(input: string, title: string, date: string | null): string {
  const when = date ? ` (${formatLocalDate(date)})` : '';
  return isTeluguText(input)
    ? `“${title}”${when} ఈవెంట్‌ను క్యాలెండర్ నుంచి తొలగించాలా?`
    : `Should I delete “${title}”${when} from your calendar?`;
}

/** Asked before an alias that already means something else is given a new meaning. */
export function replaceVocabularyQuestion(input: string, alias: string, currentMeaning: string, newMeaning: string): string {
  return isTeluguText(input)
    ? `ఇప్పటివరకు “${alias}” అంటే ${currentMeaning}. ఇకపై ${newMeaning} అని గుర్తుంచుకోవాలా?`
    : `“${alias}” currently means ${currentMeaning}. Should it mean ${newMeaning} from now on?`;
}

export function confirmedMessage(telugu: boolean, target: 'event' | 'list' | 'vocabulary', serverMessage: string | undefined): string {
  if (target === 'vocabulary') return telugu ? 'సరే — గుర్తుంచుకుంటాను.' : serverMessage || 'I will remember that.';
  if (target === 'event') return telugu ? 'సరే — ఈవెంట్‌ను క్యాలెండర్ నుంచి తొలగించాను.' : serverMessage || 'The event was deleted from your calendar.';
  return telugu ? 'సరే — ఆ అంశాన్ని జాబితా నుంచి తీసివేశాను.' : serverMessage || 'The list was updated.';
}

export function cancelledMessage(telugu: boolean): string {
  return telugu ? 'సరే — దేనినీ మార్చలేదు.' : 'Okay — I left it unchanged.';
}

/**
 * The reply language, decided in code from the family member's own words so that
 * records in another language cannot pull the answer into the wrong language.
 */
export function replyLanguage(question: string): string {
  const telugu = isTeluguText(question);
  const latin = /[A-Za-z]/u.test(question);
  if (telugu && latin) return 'the same mix of Telugu script and English that the question uses';
  if (telugu) return 'Telugu, written in Telugu script';
  return 'the language of the question: English, or Romanised Telugu (Telugu words in Latin letters) if the question is written that way';
}
