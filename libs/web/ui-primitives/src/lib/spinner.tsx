export function Spinner({ label = 'Loading…' }: { label?: string }) {
  return (
    <span role="status" className="inline-flex items-center gap-2 text-slate-600 dark:text-slate-300">
      <span aria-hidden className="h-4 w-4 animate-spin rounded-full border-2 border-slate-300 dark:border-slate-700 border-t-slate-700" />
      {label}
    </span>
  );
}
