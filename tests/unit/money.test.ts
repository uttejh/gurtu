import { describe, expect, it } from 'vitest';
import { formatPaise, parseAmountToPaise, unitRatePaise } from '../../supabase/functions/_shared/money';

describe('exact INR amounts', () => {
  it('parses rupee amounts into integer paise', () => {
    expect(parseAmountToPaise('12000')).toBe(1_200_000);
    expect(parseAmountToPaise('12,000')).toBe(1_200_000);
    expect(parseAmountToPaise('1,20,000.50')).toBe(12_000_050);
    expect(parseAmountToPaise('₹5,000')).toBe(500_000);
    expect(parseAmountToPaise('0.05')).toBe(5);
  });

  it('refuses anything that is not a clear positive amount', () => {
    for (const value of ['', 'five thousand', '-500', '0', '12.345', '1e5', '5000 approx', null, undefined, {}]) {
      expect(parseAmountToPaise(value)).toBeNull();
    }
  });

  it('formats paise in Indian digit grouping without rounding', () => {
    expect(formatPaise(1_200_000)).toBe('₹12,000');
    expect(formatPaise(12_000_050)).toBe('₹1,20,000.50');
    expect(formatPaise(99_999_999_999)).toBe('₹99,99,99,999.99');
    expect(formatPaise(-400_000)).toBe('−₹4,000');
  });

  it('sums many amounts exactly', () => {
    const total = Array.from({ length: 1000 }, () => parseAmountToPaise('0.10')!).reduce((sum, value) => sum + value, 0);
    expect(total).toBe(10_000);
    expect(formatPaise(total)).toBe('₹100');
  });

  it('gives a unit rate only when a quantity is known', () => {
    expect(unitRatePaise(240_000, 2)).toBe(120_000);
    expect(unitRatePaise(240_000, null)).toBeNull();
  });
});
