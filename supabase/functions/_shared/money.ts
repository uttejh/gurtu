// Exact INR handling. Amounts are integer paise end to end; no floating point.

const MAX_PAISE = 100_000_000_000; // ₹1,00,00,00,000

/**
 * Parses an amount the model wrote in rupees ("12000", "12,000", "1,20,000.50",
 * "₹5,000") into integer paise. Returns null for anything else.
 */
export function parseAmountToPaise(value: unknown): number | null {
  if (typeof value !== 'string' && typeof value !== 'number') return null;
  const text = String(value).trim().replace(/^₹\s*|^rs\.?\s*|^inr\s*/iu, '').replace(/\s*(rupees?|rs\.?|\/-)$/iu, '').trim();
  const match = text.match(/^(\d{1,3}(?:,\d{2,3})*|\d+)(?:\.(\d{1,2}))?$/u);
  if (!match) return null;
  const rupees = match[1].replaceAll(',', '');
  if (!/^\d+$/u.test(rupees) || rupees.length > 10) return null;
  const paise = Number(rupees) * 100 + Number((match[2] ?? '').padEnd(2, '0') || '0');
  return Number.isSafeInteger(paise) && paise > 0 && paise <= MAX_PAISE ? paise : null;
}

/** ₹12,000 or ₹1,20,000.50 in Indian digit grouping. */
export function formatPaise(paise: number): string {
  const negative = paise < 0;
  const absolute = Math.abs(Math.trunc(paise));
  const rupees = Math.floor(absolute / 100);
  const rest = absolute % 100;
  const digits = String(rupees);
  const lastThree = digits.slice(-3);
  const leading = digits.slice(0, -3).replace(/\B(?=(\d{2})+(?!\d))/gu, ',');
  const grouped = leading ? `${leading},${lastThree}` : lastThree;
  return `${negative ? '−' : ''}₹${grouped}${rest ? `.${String(rest).padStart(2, '0')}` : ''}`;
}

/** Rupee rate per unit, exact to the paisa, only when a quantity is known. */
export function unitRatePaise(amountPaise: number, quantity: number | null): number | null {
  if (!quantity || quantity <= 0) return null;
  return Math.round(amountPaise / quantity);
}
