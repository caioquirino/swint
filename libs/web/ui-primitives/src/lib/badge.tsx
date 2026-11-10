import type { HTMLAttributes } from 'react';
import { cn } from './cn.js';

const tones = {
  neutral: 'bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300',
  info: 'bg-blue-100 dark:bg-blue-950 text-blue-800 dark:text-blue-200',
  success: 'bg-green-100 dark:bg-green-950 text-green-800 dark:text-green-200',
  warning: 'bg-amber-100 dark:bg-amber-950 text-amber-800 dark:text-amber-200',
  danger: 'bg-red-100 dark:bg-red-950 text-red-800 dark:text-red-200',
} as const;

export interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  tone?: keyof typeof tones;
}

export function Badge({ tone = 'neutral', className, ...props }: BadgeProps) {
  return <span className={cn('inline-flex items-center rounded px-2 py-0.5 text-xs font-medium', tones[tone], className)} {...props} />;
}
