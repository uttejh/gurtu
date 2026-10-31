export function friendlyError(error: unknown, fallback: string): string {
  if (error instanceof Error && /network|fetch/iu.test(error.message)) {
    return 'We could not connect. Please check your internet and try again.';
  }
  return fallback;
}

export async function friendlyFunctionError(error: unknown, fallback: string): Promise<string> {
  if (error instanceof Error && /network|fetch/iu.test(error.message)) {
    return 'We could not connect. Please check your internet and try again.';
  }
  const response = (error as { context?: unknown } | null)?.context;
  if (response instanceof Response) {
    try {
      const body = await response.clone().json() as { error?: unknown };
      if (typeof body.error === 'string' && body.error.trim()) return body.error.trim();
    } catch {
      return fallback;
    }
  }
  return fallback;
}
