import { describe, expect, it } from 'vitest';
import { cancelledMessage, deleteEventQuestion, formatLocalDate, removalQuestion, replaceVocabularyQuestion, successMessage } from '../../supabase/functions/_shared/replies';

describe('deterministic chat replies', () => {
  it('formats an all-day date without shifting it across time zones', () => {
    expect(formatLocalDate('2026-12-03')).toBe('December 3, 2026');
  });

  it('confirms a timed event in English with its zone', () => {
    expect(successMessage('Bank appointment Thursday 10am', {
      action: 'create_event', title: 'Bank appointment', local_date: '2026-11-12', local_time: '10:00', time_zone: 'Asia/Kolkata', all_day: false,
    })).toBe('Got it — Bank appointment is on November 12, 2026 at 10:00 India time, and I added it to the family calendar.');
  });

  it('answers a Telugu save in Telugu', () => {
    expect(successMessage('నా పాస్‌బుక్ కారులో పెట్టాను', { action: 'save_item_location', item_name: 'పాస్‌బుక్', location: 'కారు' }))
      .toBe('పాస్‌బుక్ చివరిగా కారులో ఉందని గుర్తుంచుకున్నాను.');
  });

  it('leaves English saves to the server message', () => {
    expect(successMessage('Remember the passbook is in the car', { action: 'save_memory' })).toBeUndefined();
  });

  it('asks before removing or deleting, in the user language', () => {
    expect(removalQuestion('remove rice', 'rice', 'Groceries')).toBe('Would you like me to remove “rice” from Groceries?');
    expect(deleteEventQuestion('delete the flight', 'Flight', '2026-12-03')).toBe('Should I delete “Flight” (December 3, 2026) from your calendar?');
    expect(removalQuestion('బియ్యం తీసేయ్', 'బియ్యం', 'కిరాణా')).toMatch(/తీసివేయాలా\?$/u);
    expect(cancelledMessage(false)).toBe('Okay — I left it unchanged.');
  });
  it('confirms vocabulary in Telugu and asks before replacing a meaning', () => {
    expect(successMessage('రాము అంటే రమేష్', { action: 'teach_vocabulary', canonical_term: 'రమేష్', aliases: ['రాము'], relation: 'same' })).toBe('సరే — రాము అంటే రమేష్ అని గుర్తుంచుకుంటాను.');
    expect(successMessage('Ramu is Ramesh', { action: 'teach_vocabulary', canonical_term: 'Ramesh', aliases: ['Ramu'], relation: 'same' })).toBeUndefined();
    expect(replaceVocabularyQuestion('Ramu is Ramesh', 'Ramu', 'Ramakrishna', 'Ramesh')).toBe('“Ramu” currently means Ramakrishna. Should it mean Ramesh from now on?');
  });
});
