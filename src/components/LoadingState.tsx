export function LoadingState({ label }: { label: string }) {
  return (
    <main className="app-frame app-frame--centered" aria-live="polite">
      <p className="loading-copy">{label}</p>
    </main>
  );
}
