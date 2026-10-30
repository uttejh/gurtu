export function friendlyError(error: unknown, fallback: string): string {
  if (error instanceof Error && /network|fetch/iu.test(error.message)) {
    return 'We could not connect. Please check your internet and try again.';
  }
  return fallback;
}
