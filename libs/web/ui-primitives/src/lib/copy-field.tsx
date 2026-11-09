import { useId, useRef, useState } from 'react';
import { Button } from './button.js';

export function CopyField({ label, value }: { label: string; value: string }) {
  const id = useId();
  const [copied, setCopied] = useState<'idle' | 'copied' | 'manual'>('idle');
  const input = useRef<HTMLInputElement>(null);
  return (
    <div>
      <label htmlFor={id} className="text-sm font-medium text-slate-700">
        {label}
      </label>
      <div className="mt-1 flex gap-2">
        <input
          ref={input}
          id={id}
          readOnly
          value={value}
          className="min-w-0 flex-1 rounded-md border border-slate-300 bg-slate-50 px-3 text-sm"
          onFocus={(e) => e.currentTarget.select()}
        />
        <Button
          variant="secondary"
          size="sm"
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(value);
              setCopied('copied');
            } catch {
              // No clipboard (insecure origin) or permission denied: let the user copy by hand.
              input.current?.select();
              setCopied('manual');
            }
          }}
        >
          {copied === 'copied' ? 'Copied' : copied === 'manual' ? 'Press Ctrl+C' : 'Copy'}
        </Button>
      </div>
    </div>
  );
}
