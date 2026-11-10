import { useId, useState } from 'react';
import { Markdown } from '@swint/web-ui-session-panels';

export interface MarkdownFieldProps {
  label: string;
  value: string;
  onChange: (value: string) => void;
  rows?: number;
  error?: string;
}

export function MarkdownField({ label, value, onChange, rows = 10, error }: MarkdownFieldProps) {
  const id = useId();
  const [preview, setPreview] = useState(false);
  return (
    <div>
      <div className="flex items-center justify-between">
        <label htmlFor={id} className="text-sm font-medium">
          {label}
        </label>
        <button type="button" className="text-xs text-blue-700 dark:text-blue-400 underline" onClick={() => setPreview((p) => !p)}>
          {preview ? 'Edit' : 'Preview'}
        </button>
      </div>
      {preview ? (
        <div className="mt-1 min-h-[8rem] rounded-md border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-3">
          <Markdown source={value} />
        </div>
      ) : (
        <textarea
          id={id}
          rows={rows}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="mt-1 block w-full rounded-md border border-slate-300 dark:border-slate-700 p-2 font-mono text-sm"
        />
      )}
      {error ? (
        <p role="alert" className="mt-1 text-xs text-red-700 dark:text-red-400">
          {error}
        </p>
      ) : null}
    </div>
  );
}
