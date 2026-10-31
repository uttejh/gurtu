import { describe, expect, it } from 'vitest';
import { friendlyFunctionError } from '../../src/lib/errors';

describe('safe Edge Function errors', () => {
  it('shows the safe message returned by Gurtu instead of replacing it with a generic error', async () => {
    const error = Object.assign(new Error('Function returned a non-2xx status code'), {
      context: new Response(JSON.stringify({ error: 'Please wait a moment before trying again.' }), { status: 429 }),
    });
    await expect(friendlyFunctionError(error, 'Generic failure.')).resolves.toBe('Please wait a moment before trying again.');
  });

  it('keeps the provided fallback if the response contains no safe message', async () => {
    const error = Object.assign(new Error('Failure'), { context: new Response(JSON.stringify({ code: 'INTERNAL' })) });
    await expect(friendlyFunctionError(error, 'Generic failure.')).resolves.toBe('Generic failure.');
  });
});
