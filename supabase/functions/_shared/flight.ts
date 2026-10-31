export interface UntimedFlightProposal {
  action: 'create_event';
  title: string;
  local_date: string;
  local_time: null;
  end_time: null;
  time_zone: string;
  all_day: true;
  people_mentions: string[];
  end_time_assumed: false;
}

export function parseUntimedFlight(text: string, today: string, timeZone: string): UntimedFlightProposal | null {
  const match = text.trim().match(/^(?:i\s+(?:have|have got|booked)|my)\s+(?:a\s+)?flight(?:\s+is)?\s+(?:on\s+)?(january|february|march|april|may|june|july|august|september|october|november|december)\s+(\d{1,2})(?:st|nd|rd|th)?(?:,?\s+(\d{4}))?[.!]?$/iu);
  const todayMatch = today.match(/^(\d{4})-(\d{2})-(\d{2})$/u);
  if (!match || !todayMatch) return null;

  const months = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];
  const month = months.indexOf(match[1].toLocaleLowerCase()) + 1;
  const day = Number(match[2]);
  const todayYear = Number(todayMatch[1]);
  const todayMonth = Number(todayMatch[2]);
  const todayDay = Number(todayMatch[3]);
  const requestedYear = match[3] ? Number(match[3]) : null;
  const isValid = (year: number) => day <= new Date(Date.UTC(year, month, 0)).getUTCDate();

  let year = requestedYear ?? todayYear;
  if (requestedYear !== null) {
    if (!isValid(year)) return null;
  } else {
    for (let attempts = 0; attempts < 8; attempts += 1) {
      if (isValid(year) && (year > todayYear || (year === todayYear && (month > todayMonth || (month === todayMonth && day >= todayDay))))) break;
      year += 1;
    }
    if (!isValid(year)) return null;
  }

  return {
    action: 'create_event',
    title: 'Flight',
    local_date: `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`,
    local_time: null,
    end_time: null,
    time_zone: timeZone,
    all_day: true,
    people_mentions: [],
    end_time_assumed: false,
  };
}

export function parseSimpleUntimedEvent(text: string, today: string, timeZone: string): UntimedFlightProposal | null {
  const match = text.trim().match(/^(?:please\s+)?(?:create|add|make|schedule)\s+(?:an?\s+)?(?:calendar\s+)?event\s+on\s+(january|february|march|april|may|june|july|august|september|october|november|december)\s+(\d{1,2})(?:st|nd|rd|th)?\s+(?:that\s+)?(.+?)[.!]?$/iu);
  const todayMatch = today.match(/^(\d{4})-(\d{2})-(\d{2})$/u);
  if (!match || !todayMatch) return null;
  const months = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];
  const month = months.indexOf(match[1].toLocaleLowerCase()) + 1;
  const day = Number(match[2]);
  let year = Number(todayMatch[1]);
  const todayMonth = Number(todayMatch[2]);
  const todayDay = Number(todayMatch[3]);
  const validDay = (candidate: number) => day <= new Date(Date.UTC(candidate, month, 0)).getUTCDate();
  if (!validDay(year) || month < todayMonth || (month === todayMonth && day < todayDay)) year += 1;
  if (!validDay(year)) return null;
  const title = match[3].trim().replace(/[.!?]+$/u, '');
  if (!title) return null;
  return {
    action: 'create_event', title,
    local_date: `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`,
    local_time: null, end_time: null, time_zone: timeZone, all_day: true,
    people_mentions: [], end_time_assumed: false,
  };
}
