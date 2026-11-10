import { useRef, type KeyboardEvent } from 'react';

export const TEMPLATE_TABS = [
  { id: 'instructions', label: 'Instructions' },
  { id: 'rubric', label: 'Rubric' },
  { id: 'board', label: 'Starting board' },
] as const;

export type TemplateTab = (typeof TEMPLATE_TABS)[number]['id'];
export const DEFAULT_TAB: TemplateTab = 'instructions';

/** The `?tab=` value, or the default for a missing or unknown one. */
export function parseTab(raw: string | null): TemplateTab {
  return TEMPLATE_TABS.find((t) => t.id === raw)?.id ?? DEFAULT_TAB;
}

export const tabId = (tab: TemplateTab) => `template-tab-${tab}`;
export const panelId = (tab: TemplateTab) => `template-panel-${tab}`;

export interface TemplateTabsProps {
  selected: TemplateTab;
  onSelect: (tab: TemplateTab) => void;
  /** Tabs whose section has a validation error. */
  errors: ReadonlySet<TemplateTab>;
}

/** Accessible tablist (arrow keys, Home, End; roving tabindex) with an error dot per section. */
export function TemplateTabs({ selected, onSelect, errors }: TemplateTabsProps) {
  const refs = useRef(new Map<TemplateTab, HTMLButtonElement>());
  const onKeyDown = (event: KeyboardEvent, index: number) => {
    const last = TEMPLATE_TABS.length - 1;
    const keys: Record<string, number> = {
      ArrowRight: index === last ? 0 : index + 1,
      ArrowLeft: index === 0 ? last : index - 1,
      Home: 0,
      End: last,
    };
    const next = TEMPLATE_TABS[keys[event.key] ?? -1]?.id;
    if (!next) return;
    event.preventDefault();
    onSelect(next);
    refs.current.get(next)?.focus();
  };
  return (
    <div
      role="tablist"
      aria-label="Template sections"
      className="flex gap-1 border-b border-slate-200 bg-white px-4 dark:border-slate-800 dark:bg-slate-900"
    >
      {TEMPLATE_TABS.map((t, index) => {
        const active = t.id === selected;
        const hasError = errors.has(t.id);
        return (
          <button
            key={t.id}
            ref={(el) => {
              if (el) refs.current.set(t.id, el);
              else refs.current.delete(t.id);
            }}
            id={tabId(t.id)}
            role="tab"
            type="button"
            aria-selected={active}
            aria-controls={panelId(t.id)}
            aria-describedby={hasError ? `${tabId(t.id)}-error` : undefined}
            tabIndex={active ? 0 : -1}
            onClick={() => onSelect(t.id)}
            onKeyDown={(e) => onKeyDown(e, index)}
            className={
              active
                ? 'flex items-center border-b-2 border-blue-600 px-4 py-2 text-sm font-medium text-slate-900 dark:text-slate-100'
                : 'flex items-center border-b-2 border-transparent px-4 py-2 text-sm text-slate-600 hover:text-slate-900 dark:text-slate-300 dark:hover:text-slate-100'
            }
          >
            {t.label}
            {hasError ? (
              <>
                <span aria-hidden="true" className="ml-1.5 inline-block h-2 w-2 rounded-full bg-red-600 dark:bg-red-400" />
                {/* Hidden, so it stays out of the tab's name but can still serve as its description. */}
                <span id={`${tabId(t.id)}-error`} hidden>
                  has an error
                </span>
              </>
            ) : null}
          </button>
        );
      })}
    </div>
  );
}
