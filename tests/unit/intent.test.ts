import { describe, expect, it } from 'vitest';
import { isQuestion } from '../../supabase/functions/_shared/intent';

describe('question detection', () => {
  it.each([
    'do i have any events this month',
    'do i have any events this month?',
    'Are there any events next week',
    'Is Dad free tomorrow',
    'have we bought the seeds',
    'where are the car keys',
    'ఈ నెల ఈవెంట్లు ఉన్నాయా',
  ])('treats "%s" as a question', (text) => {
    expect(isQuestion(text)).toBe(true);
  });

  it.each([
    'I have a flight on December 3rd',
    'Have a dentist appointment on May 3',
    'Add milk to the groceries list',
    'The passbook is in the cupboard',
    'నా పాస్‌బుక్ కారులో పెట్టాను.',
  ])('treats "%s" as a request', (text) => {
    expect(isQuestion(text)).toBe(false);
  });
});
