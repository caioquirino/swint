import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate, useParams } from 'react-router';
import { z } from 'zod';
import { templateInputSchema, type Template } from '@swint/shared-api-contract';
import type { SyncedElement } from '@swint/shared-collab-protocol';
import { apiError, useApi, useOrpc } from '@swint/web-data-access-api';
import { Button, Screen, Spinner } from '@swint/web-ui-primitives';
import { SeedBoardEditor } from '@swint/web-ui-whiteboard';
import { MarkdownField } from './markdown-field.js';

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

function TemplateForm({ loaded, initialElements }: { loaded: Template | null; initialElements: SyncedElement[] }) {
  const api = useApi();
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

  useEffect(() => setSaveError(null), [form]);

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
      setErrors(Object.fromEntries(Object.entries(fields).map(([k, v]) => [k, v?.[0]])) as FieldErrors);
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

  return (
    <main className="mx-auto max-w-5xl p-6">
      <h1 className="mb-6 text-2xl font-semibold">{loaded ? 'Edit template' : 'New template'}</h1>
      <form onSubmit={submit} className="space-y-6" noValidate>
        <div className="grid grid-cols-[1fr_12rem] gap-4">
          <label className="text-sm font-medium">
            Title
            <input
              aria-label="Title"
              value={form.title}
              onChange={(e) => set('title')(e.target.value)}
              className="mt-1 block w-full rounded-md border border-slate-300 px-2 py-1.5"
            />
            {errors.title ? (
              <span role="alert" className="text-xs text-red-700">
                {errors.title}
              </span>
            ) : null}
          </label>
          <label className="text-sm font-medium">
            Duration (minutes)
            <input
              aria-label="Duration (minutes)"
              type="number"
              min={5}
              max={240}
              value={form.durationMin}
              onChange={(e) => set('durationMin')(e.target.value)}
              className="mt-1 block w-full rounded-md border border-slate-300 px-2 py-1.5"
            />
            {errors.durationMin ? (
              <span role="alert" className="text-xs text-red-700">
                {errors.durationMin}
              </span>
            ) : null}
          </label>
        </div>
        <MarkdownField label="Instructions" value={form.instructionsMd} onChange={set('instructionsMd')} error={errors.instructionsMd} />
        <MarkdownField
          label="Rubric (interviewers only)"
          value={form.rubricMd}
          onChange={set('rubricMd')}
          rows={6}
          error={errors.rubricMd}
        />
        <div>
          <p className="mb-1 text-sm font-medium">Starting board</p>
          <SeedBoardEditor initialElements={initialElements} onChange={onBoardChange} />
          {errors.boardSeed ? (
            <p role="alert" className="text-xs text-red-700">
              {errors.boardSeed}
            </p>
          ) : null}
        </div>
        {saveError ? (
          <p role="alert" className="text-sm text-red-700">
            {saveError}
          </p>
        ) : null}
        <div className="flex gap-3">
          <Button type="submit" disabled={saving}>
            Save template
          </Button>
          <Button variant="secondary" onClick={() => navigate('/')}>
            Cancel
          </Button>
        </div>
      </form>
    </main>
  );
}
