const ENGLISH_QUESTION_WORDS = /\b(where|when|who|what|why|how|which|explain|describe|summarize|tell me about|tell me how|can you|could you|do you know)\b/iu;
// Yes/no questions start with an auxiliary verb ("do I have…", "are there…", "is the bank open…").
const LEAD_IN = String.raw`^(?:(?:hey|hi|ok|okay)\s+gurtu[,!]?\s+)?`;
const ENGLISH_YES_NO_START = new RegExp(`${LEAD_IN}(?:do|does|did|is|are|am|was|were|will|would|should|shall|can|could)\\s+(?:i|we|you|he|she|they|it|there|dad|mom|mum|amma|nanna|any|my|our|the)\\b`, 'iu');
// "Have/has" only counts with a pronoun subject, so "Have a dentist appointment on May 3" stays a request.
const ENGLISH_HAVE_START = new RegExp(`${LEAD_IN}(?:have|has|had)\\s+(?:i|we|you|he|she|they|it)\\b`, 'iu');
const TELUGU_QUESTION_WORDS = /(ఎక్కడ(?:ికి|ినుంచి)?|ఎప్పుడు|ఎవరు|ఏమిటి|ఏమి|ఏంటి|ఎలా|ఎవరి|ఎవరికి|ఎందుకు|ఎంత|ఏది|ఏవి|ఉందా|వుందా|ఉన్నాయా|వున్నాయా|తెలుసా|చెప్పగలవా|చెప్పగలరా|వివరించు|చెప్పు)(?:[.!?\s]|$)/u;

export function isQuestion(value: string): boolean {
  const text = value.trim();
  return text.includes('?')
    || ENGLISH_QUESTION_WORDS.test(text)
    || ENGLISH_YES_NO_START.test(text)
    || ENGLISH_HAVE_START.test(text)
    || TELUGU_QUESTION_WORDS.test(text);
}
