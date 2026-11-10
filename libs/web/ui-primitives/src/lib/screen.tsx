import type { ReactNode } from 'react';
import { ThemeToggle } from './theme.js';

export interface ScreenProps {
  title: string;
  children?: ReactNode;
  actions?: ReactNode;
}

/** Full-page centred message: loading, errors, ended, waiting room. */
export function Screen({ title, children, actions }: ScreenProps) {
  return (
    <main className="relative flex min-h-full items-center justify-center p-8">
      <div className="absolute right-4 top-4">
        <ThemeToggle />
      </div>
      <div className="max-w-md text-center">
        <h1 className="text-2xl font-semibold">{title}</h1>
        {children ? <div className="mt-3 text-slate-600 dark:text-slate-300">{children}</div> : null}
        {actions ? <div className="mt-6 flex justify-center gap-3">{actions}</div> : null}
      </div>
    </main>
  );
}
