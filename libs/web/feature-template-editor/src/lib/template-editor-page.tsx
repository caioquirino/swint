import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate, useParams, useSearchParams } from 'react-router';
import { z } from 'zod';
import { templateInputSchema, type Template } from '@swint/shared-api-contract';
import type { SyncedElement } from '@swint/shared-collab-protocol';
import { apiError, useApi, useOrpc } from '@swint/web-data-access-api';
import { Button, Screen, Spinner, useTheme } from '@swint/web-ui-primitives';
import { SeedBoardEditor, type SeedBoardHandle } from '@swint/web-ui-whiteboard';
import { RichMarkdownEditor } from './rich-markdown-editor.js';
import { TEMPLATE_TABS, TemplateTabs, panelId, parseTab, tabId, type TemplateTab } from './template-tabs.js';

const signature = (elements: readonly SyncedElement[]) =>
  elements
    .map((e) => `${e.id}:${e.version}`)
    .sort()
    .join('|');

type FieldErrors = Partial<Record<'title' | 'durationMin' | 'instructionsMd' | 'rubricMd' | 'boardSeed', string>>;

interface FormState {
  title: string;
  durationMin: string;
  instructionsMd: string;
  rubricMd: string;
}

const EMPTY: FormState = { title: '', durationMin: '45', instructionsMd: '', rubricMd: '' };

export function TemplateEditorPage() {
  const { templateId } = useParams();
  const orpc = useOrpc();
  const template = useQuery({ ...orpc.templates.get.queryOptions({ input: { id: templateId ?? '' } }), enabled: !!templateId });
  const seed = useQuery({ ...orpc.templates.getSeed.queryOptions({ input: { id: templateId ?? '' } }), enabled: !!templateId });

  if (!templateId) return <TemplateForm loaded={null} initialElements={[]} />;
  if (template.isPending || seed.isPending)
    return (
      <Screen title="Loading template…">
        <Spinner />
      </Screen>
    );
  if (template.isError || seed.isError) {
    const code = apiError(template.error ?? seed.error)?.code;
    return <Screen title={code === 'NOT_FOUND' ? 'Template not found' : 'Could not load the template'} />;
  }
  return <TemplateForm key={template.data.id} loaded={template.data} initialElements={seed.data.elements as SyncedElement[]} />;
}

const TAB_OF_FIELD: Partial<Record<keyof FieldErrors, TemplateTab>> = {
  instructionsMd: 'instructions',
  rubricMd: 'rubric',
  boardSeed: 'board',
};

function tabsWithErrors(errors: FieldErrors): Set<TemplateTab> {
  const tabs = new Set<TemplateTab>();
  for (const [field, message] of Object.entries(errors) as [keyof FieldErrors, string | undefined][]) {
    const tab = TAB_OF_FIELD[field];
    if (message && tab) tabs.add(tab);
  }
  return tabs;
}

const INPUT = 'rounded-md border border-slate-300 bg-white px-2 py-1.5 dark:border-slate-700 dark:bg-slate-950';
const FIELD_ERROR = 'text-xs text-red-700 dark:text-red-400';

function TemplateForm({ loaded, initialElements }: { loaded: Template | null; initialElements: SyncedElement[] }) {
  const api = useApi();
  const { resolved: theme } = useTheme();
  const orpc = useOrpc();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const create = useMutation(orpc.templates.create.mutationOptions());
  const update = useMutation(orpc.templates.update.mutationOptions());
  const [form, setForm] = useState<FormState>(
    loaded
      ? { title: loaded.title, durationMin: String(loaded.durationMin), instructionsMd: loaded.instructionsMd, rubricMd: loaded.rubricMd }
      : EMPTY,
  );
  const baseUpdatedAt = useRef(loaded?.updatedAt);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const elementsRef = useRef<SyncedElement[]>(initialElements);
  const initialSignature = useRef(signature(initialElements));
  const [boardDirty, setBoardDirty] = useState(false);
  const [params, setParams] = useSearchParams();
  const tab = parseTab(params.get('tab'));
  const boardRef = useRef<SeedBoardHandle | null>(null);
  const errorTabs = useMemo(() => tabsWithErrors(errors), [errors]);

  useEffect(() => setSaveError(null), [form]);

  // Excalidraw measured its canvas while hidden: re-measure whenever the board tab is shown.
  useEffect(() => {
    if (tab === 'board') boardRef.current?.refresh();
  }, [tab]);

  const selectTab = (next: TemplateTab) =>
    setParams(
      (current) => {
        const query = new URLSearchParams(current);
        query.set('tab', next);
        return query;
      },
      { replace: true },
    );

  const set = (key: keyof FormState) => (value: string) => setForm((f) => ({ ...f, [key]: value }));

  const onBoardChange = (elements: SyncedElement[]) => {
    elementsRef.current = elements;
    setBoardDirty(signature(elements) !== initialSignature.current);
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const elements = elementsRef.current;
    const sendBoard = loaded ? boardDirty : elements.length > 0;
    const parsed = templateInputSchema.safeParse({
      title: form.title,
      durationMin: Number(form.durationMin),
      instructionsMd: form.instructionsMd,
      rubricMd: form.rubricMd,
      boardSeed: sendBoard ? { elements } : null,
    });
    if (!parsed.success) {
      const fields = z.flattenError(parsed.error).fieldErrors as Record<string, string[] | undefined>;
      const next = Object.fromEntries(Object.entries(fields).map(([k, v]) => [k, v?.[0]])) as FieldErrors;
      setErrors(next);
      const withErrors = tabsWithErrors(next);
      const first = TEMPLATE_TABS.find((t) => withErrors.has(t.id));
      if (first) selectTab(first.id);
      return;
    }
    setErrors({});
    setSaving(true);
    try {
      if (loaded) {
        const latest = await api.templates.get({ id: loaded.id });
        if (
          latest.updatedAt !== baseUpdatedAt.current &&
          !window.confirm('This template was changed by someone else since you opened it. Overwrite their changes?')
        ) {
          return;
        }
        await update.mutateAsync({ id: loaded.id, ...parsed.data });
      } else {
        await create.mutateAsync(parsed.data);
      }
      await queryClient.invalidateQueries({ queryKey: orpc.templates.key() });
      navigate('/');
    } catch (err) {
      setSaveError(apiError(err)?.message ?? 'Could not save the template.');
    } finally {
      setSaving(false);
    }
  };

  const panel = (id: TemplateTab) => ({
    id: panelId(id),
    role: 'tabpanel' as const,
    'aria-labelledby': tabId(id),
    hidden: tab !== id,
    className: 'h-full min-h-0',
  });

  return (
    <form onSubmit={submit} noValidate className="flex h-full min-h-0 flex-col">
      <header className="flex flex-wrap items-start gap-4 border-b border-slate-200 bg-white px-4 py-3 dark:border-slate-800 dark:bg-slate-900">
        <div className="min-w-[16rem] flex-1">
          <h1 className="text-xs font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400">
            {loaded ? 'Edit template' : 'New template'}
          </h1>
          <input
            aria-label="Title"
            placeholder="Untitled template"
            value={form.title}
            onChange={(e) => set('title')(e.target.value)}
            className={`${INPUT} mt-1 block w-full text-lg font-semibold`}
          />
          {errors.title ? (
            <span role="alert" className={FIELD_ERROR}>
              {errors.title}
            </span>
          ) : null}
        </div>
        <label className="text-sm font-medium">
          Duration
          <span className="mt-1 flex items-center gap-1.5">
            <input
              aria-label="Duration (minutes)"
              type="number"
              min={5}
              max={240}
              value={form.durationMin}
              onChange={(e) => set('durationMin')(e.target.value)}
              className={`${INPUT} w-20`}
            />
            <span className="text-slate-500 dark:text-slate-400">min</span>
          </span>
          {errors.durationMin ? (
            <span role="alert" className={FIELD_ERROR}>
              {errors.durationMin}
            </span>
          ) : null}
        </label>
        <div className="ml-auto flex flex-col items-end gap-1 self-center">
          <div className="flex gap-2">
            <Button variant="secondary" onClick={() => navigate('/')}>
              Cancel
            </Button>
            <Button type="submit" disabled={saving}>
              Save template
            </Button>
          </div>
          {saveError ? (
            <p role="alert" className="text-sm text-red-700 dark:text-red-400">
              {saveError}
            </p>
          ) : null}
        </div>
      </header>
      <TemplateTabs selected={tab} onSelect={selectTab} errors={errorTabs} />
      <div className="min-h-0 flex-1 bg-white dark:bg-slate-900">
        <section {...panel('instructions')}>
          <RichMarkdownEditor
            label="Instructions"
            value={form.instructionsMd}
            onChange={set('instructionsMd')}
            error={errors.instructionsMd}
          />
        </section>
        <section {...panel('rubric')}>
          <div className="flex h-full min-h-0 flex-col">
            <p className="border-b border-slate-200 bg-amber-50 px-4 py-1.5 text-xs text-amber-900 dark:border-slate-800 dark:bg-amber-950/40 dark:text-amber-200">
              Only interviewers see the rubric.
            </p>
            <div className="min-h-0 flex-1">
              <RichMarkdownEditor label="Rubric" value={form.rubricMd} onChange={set('rubricMd')} error={errors.rubricMd} />
            </div>
          </div>
        </section>
        <section {...panel('board')}>
          <div className="flex h-full min-h-0 flex-col gap-2 p-4">
            <div className="min-h-0 flex-1">
              <SeedBoardEditor
                initialElements={initialElements}
                onChange={onBoardChange}
                theme={theme}
                onReady={(handle) => {
                  boardRef.current = handle;
                }}
              />
            </div>
            {errors.boardSeed ? (
              <p role="alert" className={FIELD_ERROR}>
                {errors.boardSeed}
              </p>
            ) : null}
          </div>
        </section>
      </div>
    </form>
  );
}
