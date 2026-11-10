# Template Editor Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give template authors a whole viewport per section (instructions, rubric, starting board) and a WYSIWYG editor that stores markdown, with tables and checklists rendered in the room.

**Architecture:**
- **Layout:** the template page becomes a full-height form: a header bar, then a tablist, then three always-mounted tab panels.
- **Editor:** instructions and rubric use a TipTap 3 editor with `@tiptap/markdown`. It loads markdown and reports markdown, so storage and the API are unchanged.
- **Room:** the room's `Markdown` renderer gains `remark-gfm` and shares its prose classes with the editor.

**Tech Stack:**
- React 19, react-router 7, Tailwind v4 (`dark:` variants).
- TipTap 3.33.0 (`@tiptap/react`, `@tiptap/starter-kit`, `@tiptap/markdown`, `@tiptap/extension-table`, `@tiptap/extension-list`).
- react-markdown 10 with remark-gfm 4, and Excalidraw 0.18.1 (via `@swint/web-ui-whiteboard`).
- Tests: Vitest + Testing Library (jsdom), Playwright e2e.

**Spec:** `docs/superpowers/specs/2026-11-10-template-editor-design.md`

## Global Constraints

- No API, schema or storage change. `instructionsMd` and `rubricMd` stay markdown strings, max 50 000 characters each (existing `templateInputSchema`).
- New TipTap packages are pinned **exactly** to `3.33.0`, the version every other `@tiptap/*` package in the workspace resolves to. `@tiptap/markdown` peers on `@tiptap/core` `3.33.0` exactly.
- `remark-gfm` `^4.0.1`.
- Dependencies are declared in the root `package.json` **and** in each lib's `package.json` that imports them (`@nx/dependency-checks` lint).
- TypeScript `nodenext`: relative imports end in `.js`.
- Prettier: singleQuote, printWidth 140. Run `pnpm nx format:write` before committing.
- Run tasks through Nx: `pnpm nx test <project>`, `pnpm nx lint <project>`, `pnpm nx typecheck <project>`, `pnpm nx e2e web-e2e -- <spec>`. Project names: `web-ui-session-panels`, `web-feature-template-editor`, `web-ui-whiteboard`, `web-feature-dashboard`, `web-e2e`.
- Every colour class has a `dark:` counterpart (the app supports light, dark and system).
- Links allowed in the editor: `http:`, `https:`, `mailto:` only. Raw HTML is never rendered.
- E2E runs against the user's running dev servers (web :4200, API :3000). It must not edit or reset existing data: it creates its own template and archives it at the end.
- Commits are signed. Never use `--no-gpg-sign` or disable signing. If signing fails, stop and report.
- Never commit `.superpowers/`, `.openidea/` or `.vscode/`.
- Commit message trailer: `Co-Authored-By: <implementing model name> <noreply@anthropic.com>`.

## File Structure

| File | Responsibility |
|---|---|
| `libs/web/ui-session-panels/src/lib/markdown.tsx` | Room renderer: adds `remark-gfm`; exports `MARKDOWN_PROSE`, shared with the editor |
| `libs/web/feature-template-editor/src/lib/markdown-extensions.ts` | TipTap extension set for templates, `toMarkdown`, `isAllowedLinkUrl`, `looksLikeMarkdown` |
| `libs/web/feature-template-editor/src/lib/editor-toolbar.tsx` | Formatting toolbar (state-aware buttons, link prompt, table actions) |
| `libs/web/feature-template-editor/src/lib/rich-markdown-editor.tsx` | `RichMarkdownEditor`: toolbar plus TipTap editor; markdown in and out; markdown paste |
| `libs/web/ui-whiteboard/src/lib/components/seed-board-editor.tsx` | Gains `onReady(handle)` with `refresh()`, and fills its container |
| `libs/web/feature-template-editor/src/lib/template-tabs.tsx` | Tab ids, `parseTab`, the accessible `TemplateTabs` tablist with error dots |
| `libs/web/feature-template-editor/src/lib/template-editor-page.tsx` | Full-height layout: header bar, tabs, mounted panels, tab in URL, board refresh |
| `libs/web/feature-template-editor/src/lib/markdown-field.tsx` | **Deleted** (replaced by `RichMarkdownEditor`) |
| `libs/web/feature-dashboard/src/lib/interviewer-layout.tsx` | Full-height shell so child pages can fill the viewport |
| `apps/web-e2e/src/support/sessions.ts` | `createSession` takes an optional template title |
| `apps/web-e2e/src/template-editor.spec.ts` | E2E: author with the toolbar, then see a table and checklist in the room |

---

### Task 1: GFM in the room renderer, with shared prose styles

**Files:**
- Modify: `libs/web/ui-session-panels/src/lib/markdown.tsx`
- Modify: `libs/web/ui-session-panels/src/lib/markdown.spec.tsx`
- Modify: `libs/web/ui-session-panels/package.json`, `package.json` (root), `pnpm-lock.yaml`

**Interfaces:**
- Produces: `export const MARKDOWN_PROSE: string`, the Tailwind classes for rendered template markdown, used by Task 2's editor. `Markdown({ source })` is unchanged in signature.

- [ ] **Step 1: Write the failing tests.** Append these tests inside the existing `describe('Markdown', …)` in `markdown.spec.tsx`, and add `MARKDOWN_PROSE` to the import from `./markdown.js`:

```tsx
  it('renders GFM tables, read-only task lists and strikethrough', () => {
    const { container } = render(
      <Markdown source={'| Area | Strong |\n| --- | --- |\n| Scale | shards |\n\n- [ ] open\n- [x] done\n\n~~old~~'} />,
    );
    expect(screen.getByRole('table')).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: 'Area' })).toBeInTheDocument();
    expect(screen.getByRole('cell', { name: 'shards' })).toBeInTheDocument();
    const boxes = screen.getAllByRole('checkbox') as HTMLInputElement[];
    expect(boxes).toHaveLength(2);
    expect(boxes.every((b) => b.disabled)).toBe(true);
    expect(boxes.map((b) => b.checked)).toEqual([false, true]);
    expect(container.querySelector('del')).toHaveTextContent('old');
  });

  it('exports its prose classes, including tables and task lists, for editors', () => {
    expect(MARKDOWN_PROSE).toContain('[&_table]');
    expect(MARKDOWN_PROSE).toContain('[&_ul[data-type=taskList]]');
    expect(MARKDOWN_PROSE).toContain('[&_.contains-task-list]');
  });
```

- [ ] **Step 2: Run and see them fail.**

Run: `pnpm nx test web-ui-session-panels`
Expected: FAIL. `MARKDOWN_PROSE` is not exported, and no `table` role exists.

- [ ] **Step 3: Add the dependency.**

```bash
pnpm add -w remark-gfm@^4.0.1
```

In `libs/web/ui-session-panels/package.json`, add `"remark-gfm": "^4.0.1",` to `dependencies`, right after `"react-markdown": "^10.1.0",`. Then run `pnpm install`.

- [ ] **Step 4: Implement.** Replace `libs/web/ui-session-panels/src/lib/markdown.tsx` with:

```tsx
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

/**
 * Prose styles for template markdown. Shared by the room renderer (react-markdown) and the template editor (TipTap),
 * so what authors edit is what the room shows. Task-list selectors cover both: react-markdown's `.contains-task-list`
 * and TipTap's `ul[data-type=taskList]`.
 */
export const MARKDOWN_PROSE = [
  'text-sm leading-6 text-slate-800 dark:text-slate-100',
  '[&_h1]:mb-2 [&_h1]:text-xl [&_h1]:font-semibold [&_h2]:mb-2 [&_h2]:mt-4 [&_h2]:text-lg [&_h2]:font-semibold [&_h3]:mt-3 [&_h3]:font-semibold',
  '[&_p]:my-2 [&_ul]:my-2 [&_ul]:list-disc [&_ul]:pl-5 [&_ol]:my-2 [&_ol]:list-decimal [&_ol]:pl-5',
  '[&_code]:rounded [&_code]:bg-slate-100 dark:[&_code]:bg-slate-800 [&_code]:px-1',
  '[&_pre]:overflow-auto [&_pre]:rounded [&_pre]:bg-slate-100 dark:[&_pre]:bg-slate-800 [&_pre]:p-3 [&_pre_code]:bg-transparent [&_pre_code]:p-0',
  '[&_a]:text-blue-700 dark:[&_a]:text-blue-400 [&_a]:underline',
  '[&_blockquote]:my-2 [&_blockquote]:border-l-4 [&_blockquote]:border-slate-300 dark:[&_blockquote]:border-slate-600 [&_blockquote]:pl-3 [&_blockquote]:text-slate-600 dark:[&_blockquote]:text-slate-300',
  '[&_table]:my-3 [&_table]:block [&_table]:max-w-full [&_table]:overflow-x-auto [&_table]:border-collapse',
  '[&_th]:border [&_td]:border [&_th]:border-slate-300 [&_td]:border-slate-300 dark:[&_th]:border-slate-700 dark:[&_td]:border-slate-700',
  '[&_th]:bg-slate-100 dark:[&_th]:bg-slate-800 [&_th]:px-2 [&_th]:py-1 [&_th]:text-left [&_th]:font-semibold [&_td]:px-2 [&_td]:py-1 [&_th_p]:my-0 [&_td_p]:my-0',
  '[&_.contains-task-list]:list-none [&_.contains-task-list]:pl-1 [&_.task-list-item_input]:mr-2',
  '[&_ul[data-type=taskList]]:list-none [&_ul[data-type=taskList]]:pl-1 [&_ul[data-type=taskList]_li]:flex [&_ul[data-type=taskList]_li]:items-start [&_ul[data-type=taskList]_li]:gap-2',
  '[&_ul[data-type=taskList]_li>label]:mt-0.5 [&_ul[data-type=taskList]_li>div]:flex-1 [&_ul[data-type=taskList]_p]:my-0',
].join(' ');

/** Markdown from templates, with GFM (tables, task lists, strikethrough). Raw HTML is not rendered (`skipHtml`). */
export function Markdown({ source }: { source: string }) {
  return (
    <div className={MARKDOWN_PROSE}>
      <ReactMarkdown remarkPlugins={[remarkGfm]} skipHtml>
        {source}
      </ReactMarkdown>
    </div>
  );
}
```

- [ ] **Step 5: Run the tests, lint and typecheck.**

Run: `pnpm nx run-many -t test lint typecheck -p web-ui-session-panels`
Expected: PASS. The existing tests (heading, raw HTML skipped, no `javascript:` links) still pass.

- [ ] **Step 6: Commit.**

```bash
pnpm nx format:write
git add package.json pnpm-lock.yaml libs/web/ui-session-panels/package.json libs/web/ui-session-panels/src/lib/markdown.tsx libs/web/ui-session-panels/src/lib/markdown.spec.tsx
git commit -m "feat(session-panels): render GFM tables and task lists; share prose styles"
```

---

### Task 2: `RichMarkdownEditor` (TipTap, markdown in and out, toolbar)

**Files:**
- Create: `libs/web/feature-template-editor/src/lib/markdown-extensions.ts`
- Create: `libs/web/feature-template-editor/src/lib/markdown-extensions.spec.ts`
- Create: `libs/web/feature-template-editor/src/lib/editor-toolbar.tsx`
- Create: `libs/web/feature-template-editor/src/lib/rich-markdown-editor.tsx`
- Create: `libs/web/feature-template-editor/src/lib/rich-markdown-editor.spec.tsx`
- Modify: `libs/web/feature-template-editor/package.json`, `package.json` (root), `pnpm-lock.yaml`

**Interfaces:**
- Consumes: `MARKDOWN_PROSE` from `@swint/web-ui-session-panels` (Task 1).
- Produces, for Task 4:
  - `RichMarkdownEditor(props: { label: string; value: string; onChange: (markdown: string) => void; error?: string })`.
  - `value` is read on mount only; after that the editor is uncontrolled.
  - The editing surface has `role="textbox"` and `aria-label={label}`.

**Behaviour observed in a spike with these exact versions in jsdom** (the tests assert it):
- **Round-trips:** headings, marks, lists, task lists, code blocks, quotes and links serialize back unchanged.
- **Normalization:** `* a` becomes `- a`.
- **Tables:** serialize with padded cells, wrapped in blank lines (hence the `trim()` in `toMarkdown`).
- **Raw HTML:** `<b>raw</b> text <script>x</script>` becomes `**raw** text `.
- **Disallowed links:** `setLink` with a `javascript:` href is a no-op, and a loaded `javascript:` link renders with `href=""`.
- **Paste:** `@tiptap/markdown` does not handle paste, so `handlePaste` inserts markdown itself with `insertContent(text, { contentType: 'markdown' })`.

- [ ] **Step 1: Add the dependencies.**

```bash
pnpm add -w --save-exact @tiptap/markdown@3.33.0 @tiptap/extension-table@3.33.0 @tiptap/extension-list@3.33.0
```

In `libs/web/feature-template-editor/package.json` `dependencies`, add, keeping alphabetical order:

```json
    "@swint/web-ui-session-panels": "workspace:*",
    "@tiptap/core": "^3.33.0",
    "@tiptap/extension-list": "3.33.0",
    "@tiptap/extension-table": "3.33.0",
    "@tiptap/markdown": "3.33.0",
    "@tiptap/react": "^3.33.0",
    "@tiptap/starter-kit": "^3.33.0",
```

`@swint/web-ui-session-panels` is already present; keep a single entry. Then run `pnpm install`, and check that `pnpm why @tiptap/core` shows only `3.33.0`.

- [ ] **Step 2: Write the failing extension tests.** Create `markdown-extensions.spec.ts`:

```ts
import { afterEach, describe, expect, it } from 'vitest';
import { Editor } from '@tiptap/core';
import { isAllowedLinkUrl, looksLikeMarkdown, templateExtensions, toMarkdown } from './markdown-extensions.js';

const editors: Editor[] = [];
const load = (markdown: string) => {
  const editor = new Editor({ element: document.createElement('div'), extensions: templateExtensions(), content: markdown, contentType: 'markdown' });
  editors.push(editor);
  return editor;
};
afterEach(() => editors.splice(0).forEach((e) => e.destroy()));

describe('template markdown', () => {
  it.each([
    ['headings', '# Title\n\n## Sub\n\n### Third'],
    ['marks', 'Some **bold**, *italic*, ~~strike~~ and `code`.'],
    ['lists', '- one\n- two\n\n1. first\n2. second'],
    ['nested task lists', '- [ ] open\n- [x] done\n  - [ ] nested'],
    ['code blocks', '```ts\nconst a = 1;\n```'],
    ['quotes', '> quoted'],
    ['links', '[site](https://example.com) and [mail](mailto:a@b.c)'],
  ])('round-trips %s unchanged', (_name, markdown) => {
    expect(toMarkdown(load(markdown))).toBe(markdown);
  });

  it('round-trips a table, padding its cells', () => {
    expect(toMarkdown(load('| Area | Weak | Strong |\n| --- | --- | --- |\n| Scale | one box | shards |'))).toBe(
      '| Area  | Weak    | Strong |\n| ----- | ------- | ------ |\n| Scale | one box | shards |',
    );
  });

  it('serializes an inserted 3x3 table with a header row, without surrounding blank lines', () => {
    const editor = load('');
    editor.commands.insertTable({ rows: 3, cols: 3, withHeaderRow: true });
    expect(toMarkdown(editor)).toBe('|     |     |     |\n| --- | --- | --- |\n|     |     |     |\n|     |     |     |');
  });

  it('normalizes * bullets to -', () => {
    expect(toMarkdown(load('* a\n* b'))).toBe('- a\n- b');
  });

  it('drops raw HTML tags, keeping supported formatting and text', () => {
    expect(toMarkdown(load('<b>raw</b> text <script>x</script>'))).toBe('**raw** text');
  });

  it('only allows http, https and mailto links', () => {
    for (const url of ['https://example.com', 'http://example.com/a?b=1', 'mailto:a@b.c']) expect(isAllowedLinkUrl(url)).toBe(true);
    for (const url of ['javascript:alert(1)', 'data:text/html,x', 'example.com', '', 'ftp://x.y']) expect(isAllowedLinkUrl(url)).toBe(false);
  });

  it('recognizes pasted markdown, and leaves plain text alone', () => {
    for (const text of ['# Hi', '- item', '1. first', '> quote', '```\ncode\n```', '| a | b |', 'see **this**', 'a [link](https://x.y)']) {
      expect(looksLikeMarkdown(text)).toBe(true);
    }
    for (const text of ['plain sentence.', 'a - b', 'price: 5 * 3']) expect(looksLikeMarkdown(text)).toBe(false);
  });
});
```

- [ ] **Step 3: Run and see it fail.**

Run: `pnpm nx test web-feature-template-editor -- markdown-extensions`
Expected: FAIL, because `./markdown-extensions.js` cannot be resolved.

- [ ] **Step 4: Implement `markdown-extensions.ts`.**

```ts
import type { AnyExtension, Editor } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import { Markdown } from '@tiptap/markdown';
import { TableKit } from '@tiptap/extension-table';
import { TaskItem, TaskList } from '@tiptap/extension-list';

const LINK_PROTOCOLS: readonly string[] = ['http:', 'https:', 'mailto:'];

/** Template links: absolute http(s) or mailto URLs only. */
export function isAllowedLinkUrl(url: string): boolean {
  try {
    return LINK_PROTOCOLS.includes(new URL(url).protocol);
  } catch {
    return false;
  }
}

/** The TipTap schema for template instructions and rubric (spec §4). Markdown has no underline, so it is off. */
export function templateExtensions(): AnyExtension[] {
  return [
    StarterKit.configure({
      heading: { levels: [1, 2, 3] },
      underline: false,
      link: { openOnClick: false, autolink: true, defaultProtocol: 'https', isAllowedUri: (url) => isAllowedLinkUrl(url) },
    }),
    TaskList,
    TaskItem.configure({ nested: true }),
    TableKit.configure({ table: { resizable: false } }),
    Markdown,
  ];
}

/** The editor's markdown, without the blank lines the serializer leaves around tables and at the end. */
export function toMarkdown(editor: Editor): string {
  return editor.getMarkdown().trim();
}

const MARKDOWN_HINT = /^(#{1,6}\s|[-*+]\s|\d+[.)]\s|>\s|```|\|.*\|)|\*\*[^*\n]+\*\*|`[^`\n]+`|\[[^\]\n]+\]\([^)\s]+\)/m;

/** Whether pasted plain text is worth parsing as markdown. */
export function looksLikeMarkdown(text: string): boolean {
  return MARKDOWN_HINT.test(text);
}
```

- [ ] **Step 5: Run the extension tests.**

Run: `pnpm nx test web-feature-template-editor -- markdown-extensions`
Expected: PASS. If a serializer string differs only in whitespace from the spike values above, stop and report; don't edit the expected strings to fit.

- [ ] **Step 6: Write the failing component tests.** Create `rich-markdown-editor.spec.tsx`:

```tsx
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { Editor } from '@tiptap/core';
import { RichMarkdownEditor } from './rich-markdown-editor.js';

afterEach(() => vi.restoreAllMocks());

function setup(value = '', error?: string) {
  const onChange = vi.fn<(markdown: string) => void>();
  const view = render(<RichMarkdownEditor label="Instructions" value={value} onChange={onChange} error={error} />);
  const box = screen.getByRole('textbox', { name: 'Instructions' });
  // TipTap exposes the editor on its DOM node; tests drive content and selection through it.
  const editor = (box as HTMLElement & { editor: Editor }).editor;
  const last = () => onChange.mock.calls.at(-1)?.[0];
  return { ...view, onChange, box, editor, last };
}
const button = (name: string) => screen.getByRole('button', { name });

describe('RichMarkdownEditor', () => {
  it('loads markdown as rich content', () => {
    setup('# Task\n\n- one');
    expect(screen.getByRole('heading', { name: 'Task' })).toBeInTheDocument();
    expect(screen.getByRole('listitem')).toHaveTextContent('one');
  });

  it('reports markdown on every change', () => {
    const { editor, last } = setup();
    act(() => {
      editor.commands.insertContent('Hello');
    });
    expect(last()).toBe('Hello');
  });

  it('applies formatting from the toolbar and shows it as pressed', async () => {
    const { editor, last } = setup();
    act(() => {
      editor.commands.insertContent('Hello');
      editor.commands.selectAll();
    });
    expect(button('Bold')).toHaveAttribute('aria-pressed', 'false');
    await userEvent.click(button('Bold'));
    expect(last()).toBe('**Hello**');
    expect(button('Bold')).toHaveAttribute('aria-pressed', 'true');
    await userEvent.click(button('Heading 2'));
    expect(last()).toBe('## **Hello**');
    expect(button('Heading 2')).toHaveAttribute('aria-pressed', 'true');
  });

  it('turns a paragraph into a task list', async () => {
    const { editor, last } = setup();
    act(() => {
      editor.commands.insertContent('Hello');
    });
    await userEvent.click(button('Task list'));
    expect(last()).toBe('- [ ] Hello');
  });

  it('disables table actions outside a table, and edits a table inside one', async () => {
    const { last } = setup();
    for (const name of ['Add row', 'Delete row', 'Add column', 'Delete column', 'Delete table']) expect(button(name)).toBeDisabled();
    await userEvent.click(button('Insert table'));
    expect(last()).toBe('|     |     |     |\n| --- | --- | --- |\n|     |     |     |\n|     |     |     |');
    expect(button('Add row')).toBeEnabled();
    await userEvent.click(button('Add row'));
    expect(last()?.split('\n')).toHaveLength(6);
    await userEvent.click(button('Delete table'));
    expect(last()).toBe('');
  });

  it('rejects disallowed link protocols, sets allowed links and removes a link on an empty answer', async () => {
    const { editor, last } = setup('site');
    act(() => {
      editor.commands.selectAll();
    });
    const prompt = vi.spyOn(window, 'prompt').mockReturnValue('javascript:alert(1)');
    await userEvent.click(button('Link'));
    expect(screen.getByRole('alert')).toHaveTextContent('Links must start with http://, https:// or mailto:');
    expect(last()).toBeUndefined();
    prompt.mockReturnValue('https://example.com');
    await userEvent.click(button('Link'));
    expect(last()).toBe('[site](https://example.com)');
    expect(screen.queryByRole('alert')).toBeNull();
    prompt.mockReturnValue('');
    await userEvent.click(button('Link'));
    expect(last()).toBe('site');
  });

  it('parses pasted markdown into rich content', () => {
    const { box, last } = setup();
    const paste = new Event('paste', { bubbles: true, cancelable: true });
    Object.defineProperty(paste, 'clipboardData', {
      value: { types: ['text/plain'], getData: (type: string) => (type === 'text/plain' ? '## Pasted\n\n- [ ] item' : '') },
    });
    act(() => {
      box.dispatchEvent(paste);
    });
    expect(screen.getByRole('heading', { name: 'Pasted' })).toBeInTheDocument();
    expect(last()).toContain('## Pasted');
    expect(last()).toContain('- [ ] item');
  });

  it('marks the editing surface invalid while there is an error', () => {
    const onChange = vi.fn();
    const { rerender } = render(<RichMarkdownEditor label="Rubric" value="" onChange={onChange} error="Too long" />);
    const box = screen.getByRole('textbox', { name: 'Rubric' });
    expect(box).toHaveAttribute('aria-invalid', 'true');
    expect(box).toHaveAccessibleDescription('Too long');
    rerender(<RichMarkdownEditor label="Rubric" value="" onChange={onChange} />);
    expect(box).not.toHaveAttribute('aria-invalid');
  });
});
```

- [ ] **Step 7: Run and see it fail.**

Run: `pnpm nx test web-feature-template-editor -- rich-markdown-editor`
Expected: FAIL, because `./rich-markdown-editor.js` cannot be resolved.

- [ ] **Step 8: Implement the toolbar.** Create `editor-toolbar.tsx`:

```tsx
import { useState, type ReactNode } from 'react';
import { useEditorState, type Editor } from '@tiptap/react';
import { isAllowedLinkUrl } from './markdown-extensions.js';

const BUTTON =
  'inline-flex h-8 min-w-8 items-center justify-center rounded px-1.5 text-sm text-slate-700 hover:bg-slate-100 disabled:pointer-events-none disabled:opacity-40 ' +
  'aria-pressed:bg-blue-100 aria-pressed:text-blue-800 dark:text-slate-200 dark:hover:bg-slate-800 dark:aria-pressed:bg-blue-900/60 dark:aria-pressed:text-blue-200';
const DIVIDER = 'mx-1 h-5 w-px bg-slate-200 dark:bg-slate-700';
export const LINK_ERROR = 'Links must start with http://, https:// or mailto:';

interface ToolProps {
  label: string;
  onRun: () => void;
  pressed?: boolean;
  disabled?: boolean;
  children: ReactNode;
}

function Tool({ label, onRun, pressed, disabled, children }: ToolProps) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      aria-pressed={pressed}
      disabled={disabled}
      className={BUTTON}
      // Keep the editor's selection: the click must not move focus out of it first.
      onMouseDown={(e) => e.preventDefault()}
      onClick={onRun}
    >
      {children}
    </button>
  );
}

/** Formatting toolbar for a template editor (spec §4). */
export function EditorToolbar({ editor }: { editor: Editor | null }) {
  const [linkError, setLinkError] = useState(false);
  const s = useEditorState({
    editor,
    selector: ({ editor: e }) =>
      e
        ? {
            h1: e.isActive('heading', { level: 1 }),
            h2: e.isActive('heading', { level: 2 }),
            h3: e.isActive('heading', { level: 3 }),
            bold: e.isActive('bold'),
            italic: e.isActive('italic'),
            strike: e.isActive('strike'),
            code: e.isActive('code'),
            bulletList: e.isActive('bulletList'),
            orderedList: e.isActive('orderedList'),
            taskList: e.isActive('taskList'),
            blockquote: e.isActive('blockquote'),
            codeBlock: e.isActive('codeBlock'),
            link: e.isActive('link'),
            inTable: e.isActive('table'),
            canBold: e.can().toggleBold(),
            canItalic: e.can().toggleItalic(),
            canStrike: e.can().toggleStrike(),
            canCode: e.can().toggleCode(),
            canUndo: e.can().undo(),
            canRedo: e.can().redo(),
          }
        : null,
  });
  if (!editor || !s) return null;
  const run = (fn: (c: ReturnType<Editor['chain']>) => ReturnType<Editor['chain']>) => () => {
    setLinkError(false);
    fn(editor.chain().focus()).run();
  };

  const editLink = () => {
    const current = (editor.getAttributes('link') as { href?: string }).href;
    const answer = window.prompt('Link URL (http, https or mailto)', current ?? 'https://');
    if (answer === null) return;
    const url = answer.trim();
    if (url === '') {
      setLinkError(false);
      editor.chain().focus().extendMarkRange('link').unsetLink().run();
      return;
    }
    if (!isAllowedLinkUrl(url)) {
      setLinkError(true);
      return;
    }
    setLinkError(false);
    editor.chain().focus().extendMarkRange('link').setLink({ href: url }).run();
  };

  return (
    <div className="border-b border-slate-200 bg-slate-50 px-3 py-1.5 dark:border-slate-800 dark:bg-slate-900">
      <div role="group" aria-label="Formatting" className="flex flex-wrap items-center gap-0.5">
        <Tool label="Heading 1" pressed={s.h1} onRun={run((c) => c.toggleHeading({ level: 1 }))}>H1</Tool>
        <Tool label="Heading 2" pressed={s.h2} onRun={run((c) => c.toggleHeading({ level: 2 }))}>H2</Tool>
        <Tool label="Heading 3" pressed={s.h3} onRun={run((c) => c.toggleHeading({ level: 3 }))}>H3</Tool>
        <span className={DIVIDER} aria-hidden="true" />
        <Tool label="Bold" pressed={s.bold} disabled={!s.canBold} onRun={run((c) => c.toggleBold())}><b>B</b></Tool>
        <Tool label="Italic" pressed={s.italic} disabled={!s.canItalic} onRun={run((c) => c.toggleItalic())}><i>I</i></Tool>
        <Tool label="Strikethrough" pressed={s.strike} disabled={!s.canStrike} onRun={run((c) => c.toggleStrike())}><s>S</s></Tool>
        <Tool label="Inline code" pressed={s.code} disabled={!s.canCode} onRun={run((c) => c.toggleCode())}>{'</>'}</Tool>
        <span className={DIVIDER} aria-hidden="true" />
        <Tool label="Bullet list" pressed={s.bulletList} onRun={run((c) => c.toggleBulletList())}>•</Tool>
        <Tool label="Numbered list" pressed={s.orderedList} onRun={run((c) => c.toggleOrderedList())}>1.</Tool>
        <Tool label="Task list" pressed={s.taskList} onRun={run((c) => c.toggleTaskList())}>☑</Tool>
        <Tool label="Quote" pressed={s.blockquote} onRun={run((c) => c.toggleBlockquote())}>❝</Tool>
        <Tool label="Code block" pressed={s.codeBlock} onRun={run((c) => c.toggleCodeBlock())}>{'{ }'}</Tool>
        <Tool label="Link" pressed={s.link} onRun={editLink}>Link</Tool>
        <span className={DIVIDER} aria-hidden="true" />
        <div role="group" aria-label="Table" className="flex items-center gap-0.5">
          <Tool label="Insert table" onRun={run((c) => c.insertTable({ rows: 3, cols: 3, withHeaderRow: true }))}>⊞</Tool>
          <Tool label="Add row" disabled={!s.inTable} onRun={run((c) => c.addRowAfter())}>+row</Tool>
          <Tool label="Delete row" disabled={!s.inTable} onRun={run((c) => c.deleteRow())}>−row</Tool>
          <Tool label="Add column" disabled={!s.inTable} onRun={run((c) => c.addColumnAfter())}>+col</Tool>
          <Tool label="Delete column" disabled={!s.inTable} onRun={run((c) => c.deleteColumn())}>−col</Tool>
          <Tool label="Delete table" disabled={!s.inTable} onRun={run((c) => c.deleteTable())}>✕</Tool>
        </div>
        <span className={DIVIDER} aria-hidden="true" />
        <Tool label="Undo" disabled={!s.canUndo} onRun={run((c) => c.undo())}>↶</Tool>
        <Tool label="Redo" disabled={!s.canRedo} onRun={run((c) => c.redo())}>↷</Tool>
      </div>
      {linkError ? (
        <p role="alert" className="mt-1 text-xs text-red-700 dark:text-red-400">
          {LINK_ERROR}
        </p>
      ) : null}
    </div>
  );
}
```

`aria-pressed` is set only on toggles; Undo, Redo and the table actions omit it, because `pressed` is `undefined` there. Prettier will reflow the JSX; that's expected.

- [ ] **Step 9: Implement the editor.** Create `rich-markdown-editor.tsx`:

```tsx
import { useEffect, useId, useRef } from 'react';
import { EditorContent, useEditor, type Editor } from '@tiptap/react';
import { MARKDOWN_PROSE } from '@swint/web-ui-session-panels';
import { EditorToolbar } from './editor-toolbar.js';
import { looksLikeMarkdown, templateExtensions, toMarkdown } from './markdown-extensions.js';

export interface RichMarkdownEditorProps {
  /** Accessible name of the editing surface. */
  label: string;
  /** Markdown, read on mount only (the editor is uncontrolled after that). */
  value: string;
  onChange: (markdown: string) => void;
  error?: string;
}

/** WYSIWYG editor that loads and reports markdown (spec §4). */
export function RichMarkdownEditor({ label, value, onChange, error }: RichMarkdownEditorProps) {
  const errorId = useId();
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const errorRef = useRef(error);
  errorRef.current = error;
  const editorRef = useRef<Editor | null>(null);

  const editor = useEditor(
    {
      extensions: templateExtensions(),
      content: value,
      contentType: 'markdown',
      onUpdate: ({ editor: e }) => onChangeRef.current(toMarkdown(e)),
      editorProps: {
        // A function, so ProseMirror re-reads it on every view update (see the error effect below).
        attributes: () => ({
          'aria-label': label,
          'aria-multiline': 'true',
          class: `${MARKDOWN_PROSE} min-h-full px-6 py-4 outline-none`,
          ...(errorRef.current ? { 'aria-invalid': 'true', 'aria-describedby': errorId } : {}),
        }),
        handlePaste: (_view, event) => {
          const data = event.clipboardData;
          const current = editorRef.current;
          if (!data || !current || data.types.includes('text/html')) return false;
          const text = data.getData('text/plain');
          if (!looksLikeMarkdown(text)) return false;
          current.commands.insertContent(text, { contentType: 'markdown' });
          return true;
        },
      },
    },
    [],
  );
  editorRef.current = editor;

  // Re-apply the editing surface's attributes when the error appears or clears.
  useEffect(() => {
    if (editor && !editor.isDestroyed) editor.view.updateState(editor.view.state);
  }, [editor, error]);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <EditorToolbar editor={editor} />
      {error ? (
        <p id={errorId} className="border-b border-red-200 bg-red-50 px-4 py-2 text-sm text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-300">
          {error}
        </p>
      ) : null}
      <EditorContent editor={editor} className="min-h-0 flex-1 overflow-auto [&>div]:min-h-full" />
    </div>
  );
}
```

The error paragraph has no `role="alert"`; the page's error dots and the description carry it. That way the only `alert` in the editor is the toolbar's link message, which the test relies on. If `editor.view` isn't mounted yet when the effect first runs (TipTap throws "view is not available"), guard the call with `editor.isInitialized`.

- [ ] **Step 10: Run the editor's tests, lint and typecheck.**

Run: `pnpm nx run-many -t test lint typecheck -p web-feature-template-editor`
Expected: PASS for the new specs. `template-editor-page.spec.tsx` is still green at this point, because the page still uses `MarkdownField`.

- [ ] **Step 11: Commit.**

```bash
pnpm nx format:write
git add package.json pnpm-lock.yaml libs/web/feature-template-editor/package.json libs/web/feature-template-editor/src/lib/markdown-extensions.ts libs/web/feature-template-editor/src/lib/markdown-extensions.spec.ts libs/web/feature-template-editor/src/lib/editor-toolbar.tsx libs/web/feature-template-editor/src/lib/rich-markdown-editor.tsx libs/web/feature-template-editor/src/lib/rich-markdown-editor.spec.tsx
git commit -m "feat(template-editor): WYSIWYG markdown editor (TipTap + @tiptap/markdown) with tables and task lists"
```

---

### Task 3: `SeedBoardEditor` refresh handle, filling its container

**Files:**
- Modify: `libs/web/ui-whiteboard/src/lib/components/seed-board-editor.tsx`
- Modify: `libs/web/ui-whiteboard/src/lib/components/seed-board-editor.spec.tsx`

**Interfaces:**
- Produces, for Task 4:
  - `export interface SeedBoardHandle { refresh(): void }`.
  - `SeedBoardEditorProps` gains `onReady?: (handle: SeedBoardHandle) => void`, called once Excalidraw's API is available.
  - The root `[data-testid=seed-board]` element fills its parent (`h-full`) instead of a fixed `h-[420px]`.

- [ ] **Step 1: Write the failing tests.** In `seed-board-editor.spec.tsx`:
  - Add `import { useEffect } from 'react';` and `waitFor` to the testing-library import.
  - Add a `boardApi` const above the mocks.
  - Change the Excalidraw mock to hand out the API.
  - Append the new tests.

```tsx
import { useEffect } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';

const boardApi = { refresh: vi.fn(), updateLibrary: vi.fn() };

vi.mock('@excalidraw/excalidraw/index.css', () => ({}));
vi.mock('./collaborative-board.css', () => ({}));
vi.mock('./collaborative-board.js', () => ({ excalidrawFns: {} }));
vi.mock('@excalidraw/excalidraw', () => ({
  MainMenu: Object.assign(() => null, { DefaultItems: { Export: () => null, SaveAsImage: () => null } }),
  Excalidraw: ({ excalidrawAPI }: { excalidrawAPI?: (api: unknown) => void }) => {
    useEffect(() => excalidrawAPI?.(boardApi), [excalidrawAPI]);
    return <div data-testid="excalidraw" />;
  },
}));
```

```tsx
  it('hands out a refresh handle once Excalidraw is ready', async () => {
    const onReady = vi.fn();
    render(<SeedBoardEditor initialElements={[]} onChange={() => undefined} onReady={onReady} />);
    await waitFor(() => expect(onReady).toHaveBeenCalledTimes(1));
    onReady.mock.calls[0][0].refresh();
    expect(boardApi.refresh).toHaveBeenCalledTimes(1);
  });

  it('fills its container', () => {
    render(<SeedBoardEditor initialElements={[]} onChange={() => undefined} />);
    expect(screen.getByTestId('seed-board')).toHaveClass('h-full');
    expect(screen.getByTestId('seed-board')).not.toHaveClass('h-[420px]');
  });
```

Keep the two existing tests (file drops, find blocked) unchanged.

- [ ] **Step 2: Run and see them fail.**

Run: `pnpm nx test web-ui-whiteboard -- seed-board-editor`
Expected: FAIL. `onReady` is never called, and the class is `h-[420px]`.

- [ ] **Step 3: Implement.** In `seed-board-editor.tsx`:

```tsx
import { useEffect, useRef, useState } from 'react';
```

Add to the props, and export the handle type:

```tsx
/** Lets the host re-measure the board after its container was hidden or resized. */
export interface SeedBoardHandle {
  refresh(): void;
}

export interface SeedBoardEditorProps {
  initialElements: readonly SyncedElement[];
  /** Live (non-deleted, non-image) elements after every scene change. */
  onChange: (elements: SyncedElement[]) => void;
  theme?: 'light' | 'dark';
  /** Called once Excalidraw is ready. */
  onReady?: (handle: SeedBoardHandle) => void;
}
```

In the component, take `onReady`, then add this after `useBlockedShortcuts('export', containerRef);`:

```tsx
  const onReadyRef = useRef(onReady);
  onReadyRef.current = onReady;
  useEffect(() => {
    if (api) onReadyRef.current?.({ refresh: () => api.refresh() });
  }, [api]);
```

Change the root `className` from `"swint-board h-[420px] w-full overflow-hidden rounded-md border border-slate-300 dark:border-slate-700"` to `"swint-board h-full min-h-[320px] w-full overflow-hidden rounded-md border border-slate-300 dark:border-slate-700"`.

- [ ] **Step 4: Run the whiteboard tests, lint and typecheck.**

Run: `pnpm nx run-many -t test lint typecheck -p web-ui-whiteboard`
Expected: PASS.

- [ ] **Step 5: Commit.**

```bash
pnpm nx format:write
git add libs/web/ui-whiteboard/src/lib/components/seed-board-editor.tsx libs/web/ui-whiteboard/src/lib/components/seed-board-editor.spec.tsx
git commit -m "feat(whiteboard): seed board fills its container and hands out a refresh handle"
```

---

### Task 4: Full-page tabbed template editor

**Files:**
- Create: `libs/web/feature-template-editor/src/lib/template-tabs.tsx`
- Modify: `libs/web/feature-template-editor/src/lib/template-editor-page.tsx`
- Modify: `libs/web/feature-template-editor/src/lib/template-editor-page.spec.tsx`
- Delete: `libs/web/feature-template-editor/src/lib/markdown-field.tsx`
- Modify: `libs/web/feature-dashboard/src/lib/interviewer-layout.tsx`

**Interfaces:**
- Consumes:
  - `RichMarkdownEditor` (Task 2).
  - `SeedBoardEditor` and `SeedBoardHandle` from `@swint/web-ui-whiteboard` (Task 3).
- Produces:
  - `TemplateTab = 'instructions' | 'rubric' | 'board'`.
  - `parseTab(raw: string | null): TemplateTab`.
  - The `?tab=` search parameter.

- [ ] **Step 1: Update and extend the page tests.** In `template-editor-page.spec.tsx`:

(a) Replace the imports and the `@swint/web-ui-whiteboard` mock with the block below, and add a mock for the rich editor; the page tests are about the page, not TipTap. The Instructions textbox is now found by role, because the tab panel is also labelled "Instructions".

```tsx
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useEffect } from 'react';
import { act, fireEvent, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { fakeApi, renderWithApi } from '@swint/web-data-access-api/testing';

const drawn = { id: 'e1', type: 'rectangle', version: 2, versionNonce: 3, index: 'a0', isDeleted: false, x: 0, y: 0, width: 5, height: 5 };
const refresh = vi.fn();

vi.mock('@swint/web-ui-whiteboard', () => ({
  SeedBoardEditor: ({
    initialElements,
    onChange,
    onReady,
  }: {
    initialElements: unknown[];
    onChange: (e: unknown[]) => void;
    onReady?: (h: { refresh(): void }) => void;
  }) => {
    useEffect(() => onReady?.({ refresh }), []);
    return (
      <div>
        <span data-testid="seed-count">{initialElements.length}</span>
        <button type="button" onClick={() => onChange(initialElements)}>
          noop-change
        </button>
        <button type="button" onClick={() => onChange([...initialElements, drawn])}>
          draw
        </button>
      </div>
    );
  },
}));

vi.mock('./rich-markdown-editor.js', () => ({
  RichMarkdownEditor: ({ label, value, onChange, error }: { label: string; value: string; onChange: (v: string) => void; error?: string }) => (
    <>
      <textarea aria-label={label} defaultValue={value} onChange={(e) => onChange(e.target.value)} />
      {error ? <p role="alert">{error}</p> : null}
    </>
  ),
}));
```

(b) In `'creates a template without a board when nothing was drawn'`, replace `screen.getByLabelText('Instructions')` with `screen.getByRole('textbox', { name: 'Instructions' })`.

(c) Change `afterEach(() => vi.restoreAllMocks());` to `afterEach(() => { vi.restoreAllMocks(); refresh.mockClear(); });`.

(d) Append this `describe`:

```tsx
describe('TemplateEditorPage (layout)', () => {
  const renderNew = (path = '/templates/new', templates: Record<string, (...a: never[]) => unknown> = {}) =>
    renderWithApi(<TemplateEditorPage />, { api: fakeApi({ templates }), path, routePath: '/templates/new' });
  const tab = (name: string) => screen.getByRole('tab', { name });

  it('shows one section at a time and keeps the others mounted', async () => {
    renderNew();
    expect(tab('Instructions')).toHaveAttribute('aria-selected', 'true');
    const instructions = screen.getByRole('textbox', { name: 'Instructions' });
    expect(instructions).toBeVisible();
    await userEvent.type(instructions, 'abc');
    expect(screen.getByRole('textbox', { name: 'Rubric', hidden: true })).not.toBeVisible();
    await userEvent.click(tab('Rubric'));
    expect(screen.getByRole('textbox', { name: 'Rubric' })).toBeVisible();
    expect(screen.getByRole('textbox', { name: 'Instructions', hidden: true })).not.toBeVisible();
    await userEvent.click(tab('Instructions'));
    expect(screen.getByRole('textbox', { name: 'Instructions' })).toHaveValue('abc');
  });

  it('reads the tab from the URL, falls back on unknown values, and writes it back', async () => {
    renderNew('/templates/new?tab=rubric');
    expect(tab('Rubric')).toHaveAttribute('aria-selected', 'true');
    await userEvent.click(tab('Starting board'));
    expect(screen.getByTestId('location')).toHaveTextContent('/templates/new?tab=board');
  });

  it('falls back to Instructions for an unknown tab', () => {
    renderNew('/templates/new?tab=nope');
    expect(tab('Instructions')).toHaveAttribute('aria-selected', 'true');
  });

  it('moves between tabs with the arrow, Home and End keys', async () => {
    renderNew();
    tab('Instructions').focus();
    await userEvent.keyboard('{ArrowRight}');
    expect(tab('Rubric')).toHaveAttribute('aria-selected', 'true');
    expect(tab('Rubric')).toHaveFocus();
    await userEvent.keyboard('{End}');
    expect(tab('Starting board')).toHaveFocus();
    await userEvent.keyboard('{ArrowRight}');
    expect(tab('Instructions')).toHaveFocus();
    await userEvent.keyboard('{ArrowLeft}');
    expect(tab('Starting board')).toHaveAttribute('aria-selected', 'true');
    await userEvent.keyboard('{Home}');
    expect(tab('Instructions')).toHaveAttribute('aria-selected', 'true');
    expect(tab('Rubric')).toHaveAttribute('tabindex', '-1');
  });

  it('re-measures the board when its tab is shown', async () => {
    renderNew();
    await waitFor(() => expect(screen.getByTestId('seed-count')).toBeInTheDocument());
    refresh.mockClear();
    await userEvent.click(tab('Starting board'));
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it('marks tabs with errors and opens the first one on save', async () => {
    const create = vi.fn();
    renderNew('/templates/new?tab=board', { create });
    await userEvent.type(screen.getByLabelText('Title'), 'Too long rubric');
    fireEvent.change(screen.getByRole('textbox', { name: 'Rubric', hidden: true }), { target: { value: 'x'.repeat(50_001) } });
    await userEvent.click(screen.getByRole('button', { name: 'Save template' }));
    expect(tab('Rubric')).toHaveAttribute('aria-selected', 'true');
    expect(tab('Rubric')).toHaveAccessibleDescription('has an error');
    expect(tab('Instructions')).not.toHaveAccessibleDescription('has an error');
    expect(create).not.toHaveBeenCalled();
  });
});
```

`act` stays imported, because the existing edit tests use it.

- [ ] **Step 2: Run and see the new tests fail.**

Run: `pnpm nx test web-feature-template-editor -- template-editor-page`
Expected: FAIL. No `tab` roles exist, and the Rubric textbox has no "Rubric" name.

- [ ] **Step 3: Create `template-tabs.tsx`.**

```tsx
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
    <div role="tablist" aria-label="Template sections" className="flex gap-1 border-b border-slate-200 bg-white px-4 dark:border-slate-800 dark:bg-slate-900">
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
```

- [ ] **Step 4: Rewrite the page's form.** In `template-editor-page.tsx`, keep `signature`, `FieldErrors`, `FormState`, `EMPTY` and `TemplateEditorPage` as they are. Replace the imports and `TemplateForm` with:

```tsx
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
```

```tsx
const TAB_OF_FIELD: Partial<Record<keyof FieldErrors, TemplateTab>> = { instructionsMd: 'instructions', rubricMd: 'rubric', boardSeed: 'board' };

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
          <RichMarkdownEditor label="Instructions" value={form.instructionsMd} onChange={set('instructionsMd')} error={errors.instructionsMd} />
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
```

Tailwind v4's preflight makes `[hidden]` `display: none !important`, so hidden panels collapse even with `h-full`.

- [ ] **Step 5: Delete the old field.**

```bash
git rm libs/web/feature-template-editor/src/lib/markdown-field.tsx
```

- [ ] **Step 6: Let pages fill the viewport under the app header.** Replace the body of `InterviewerLayout` in `libs/web/feature-dashboard/src/lib/interviewer-layout.tsx` with:

```tsx
    <RequireInterviewer>
      <div className="flex h-full flex-col">
        <AppHeader />
        {/* Pages scroll inside this area; the template editor fills it. */}
        <div className="min-h-0 flex-1 overflow-auto">
          <Outlet />
        </div>
      </div>
    </RequireInterviewer>
```

- [ ] **Step 7: Run every affected project.**

Run: `pnpm nx run-many -t test lint typecheck -p web-feature-template-editor web-feature-dashboard web-ui-whiteboard`
Expected: PASS: all page tests, old and new, and the dashboard tests.

- [ ] **Step 8: Check the page in the browser.** With the dev servers running, open `http://localhost:4200/templates/new` as an interviewer. Check:
  - The page fills the window below the app header, with no page-level scrollbar.
  - Each tab fills the area, and typing in Instructions survives switching to Rubric and back.
  - The board tab shows a full-size Excalidraw that responds to drawing at the cursor position, in both light and dark themes.

  Report what you saw; don't edit any existing template.

- [ ] **Step 9: Commit.**

```bash
pnpm nx format:write
git add libs/web/feature-template-editor/src/lib/template-tabs.tsx libs/web/feature-template-editor/src/lib/template-editor-page.tsx libs/web/feature-template-editor/src/lib/template-editor-page.spec.tsx libs/web/feature-dashboard/src/lib/interviewer-layout.tsx
git commit -m "feat(template-editor): full-page tabs for instructions, rubric and starting board"
```

(The `git rm` from Step 5 is already staged.)

---

### Task 5: E2E: author a template, see tables and checklists in the room

**Files:**
- Modify: `apps/web-e2e/src/support/sessions.ts`
- Create: `apps/web-e2e/src/template-editor.spec.ts`

**Interfaces:**
- Consumes:
  - Toolbar button names from Task 2: `Heading 1`, `Task list`, `Insert table`.
  - Tab names from Task 4: `Instructions`, `Starting board`.
  - The `seed-board` test id (Task 3).
  - The room's `board` test id and its `data-element-count` attribute (existing).
- Produces: `createSession(page, candidateName, template?)`.

- [ ] **Step 1: Let `createSession` pick a template.** In `apps/web-e2e/src/support/sessions.ts`, change the signature and the select:

```ts
/** Creates a session from the dashboard dialog and reads both links from it. */
export async function createSession(page: Page, candidateName: string, template: string = SEED_TEMPLATE): Promise<CreatedSession> {
  await page.getByRole('button', { name: 'New session' }).click();
  const dialog = page.getByRole('dialog', { name: 'New session' });
  await dialog.getByLabel('Template').selectOption({ label: template });
```

The rest of the function is unchanged.

- [ ] **Step 2: Write the spec.** Create `apps/web-e2e/src/template-editor.spec.ts`:

```ts
import { expect, test } from '@playwright/test';
import { signInAsInterviewer } from './support/auth.js';
import { createSession, uniqueCandidate } from './support/sessions.js';

test('a template authored with the WYSIWYG editor shows its table and checklist in the room', async ({ page }) => {
  await signInAsInterviewer(page);
  const title = `E2E template ${Date.now().toString(36)}`;
  try {
    await page.getByRole('link', { name: 'New template' }).click();
    await page.getByLabel('Title').fill(title);

    // Instructions: a heading, a checklist and a table, all from the toolbar.
    await page.getByRole('textbox', { name: 'Instructions' }).click();
    await page.getByRole('button', { name: 'Heading 1' }).click();
    await page.keyboard.type('Design a cache');
    await page.keyboard.press('Enter');
    await page.getByRole('button', { name: 'Task list' }).click();
    await page.keyboard.type('Ask about eviction');
    await page.keyboard.press('Enter');
    await page.keyboard.press('Enter'); // an empty item leaves the list
    await page.getByRole('button', { name: 'Insert table' }).click();
    for (const cell of ['Area', 'Weak', 'Strong', 'Scale']) {
      await page.keyboard.type(cell);
      await page.keyboard.press('Tab');
    }

    // Starting board: one rectangle.
    await page.getByRole('tab', { name: 'Starting board' }).click();
    const seed = page.getByTestId('seed-board');
    await expect(seed).toBeVisible();
    await seed.getByTestId('toolbar-rectangle').click({ force: true });
    const box = await seed.boundingBox();
    if (!box) throw new Error('seed board is not visible');
    await page.mouse.move(box.x + box.width / 2 - 60, box.y + box.height / 2 - 40);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width / 2 + 60, box.y + box.height / 2 + 40, { steps: 5 });
    await page.mouse.up();

    await page.getByRole('button', { name: 'Save template' }).click();
    await expect(page.getByRole('heading', { name: 'Interviews' })).toBeVisible();

    // The room renders the markdown with GFM, and the board starts from the seed.
    const session = await createSession(page, uniqueCandidate(), title);
    await page.goto(session.roomPath);
    await page.getByRole('button', { name: 'Start interview' }).click();
    await expect(page.getByRole('heading', { name: 'Design a cache' })).toBeVisible();
    await expect(page.getByRole('columnheader', { name: 'Area' })).toBeVisible();
    await expect(page.getByRole('cell', { name: 'Scale' })).toBeVisible();
    const checkbox = page.getByRole('checkbox', { name: /Ask about eviction/ }).or(page.locator('.task-list-item input[type=checkbox]'));
    await expect(checkbox.first()).toBeDisabled();
    await expect(page.getByTestId('board')).toHaveAttribute('data-element-count', '1');
  } finally {
    // Leave the user's dev data as it was: archive the template this test created.
    await page.goto('/');
    const archive = page.getByRole('button', { name: `Archive ${title}` });
    if (await archive.count()) {
      page.once('dialog', (dialog) => void dialog.accept());
      await archive.click();
      await expect(archive).toHaveCount(0);
    }
  }
});
```

- [ ] **Step 3: Run it.**

Run: `pnpm nx e2e web-e2e -- template-editor`
Expected: PASS. If a selector doesn't match the real DOM, fix the selector, not the product. For example, if react-markdown's checkbox has no accessible name, the `.task-list-item` fallback covers it.

- [ ] **Step 4: Show the room check can fail.**
  - Temporarily remove `remarkPlugins={[remarkGfm]}` from `libs/web/ui-session-panels/src/lib/markdown.tsx` and rerun `pnpm nx e2e web-e2e -- template-editor`.
  - Expected: FAIL at the `columnheader` assertion.
  - Restore the file, check `git diff --stat libs/web/ui-session-panels` is empty, and rerun to PASS.
  - Note both results in your report.

- [ ] **Step 5: Run the whole e2e suite.**

Run: `pnpm nx e2e web-e2e`
Expected: every spec passes, including the existing 10.

- [ ] **Step 6: Commit.**

```bash
pnpm nx format:write
git add apps/web-e2e/src/support/sessions.ts apps/web-e2e/src/template-editor.spec.ts
git commit -m "test(e2e): author a template with the WYSIWYG editor and see GFM in the room"
```

---

## Self-review

- **Spec coverage:**

  | Spec section | Task |
  |---|---|
  | §3 layout | 4 |
  | §3 board refresh | 3 + 4 |
  | §3 tab in URL | 4 |
  | §3 error dots and first errored tab | 4 |
  | §4 extensions, toolbar, link rules | 2 |
  | §4 markdown I/O and normalization | 2 |
  | §4 paste | 2 |
  | §4 prose shared | 1 + 2 |
  | §4 limits | 4 (existing schema), error dot |
  | §5 room GFM and read-only checklists | 1 |
  | §6 error handling (save error in header, conflict confirm kept, not-found kept) | 4 |
  | §7 tests | each task |
  | §7 positive control | 5, step 4 |

- **Placeholders:** none. Every code step has the code to write.
- **Type consistency:**
  - `SeedBoardHandle` and `onReady` (Task 3) are used by Task 4.
  - `RichMarkdownEditor` props (Task 2) match Task 4's usage and Task 4's test mock.
  - `TemplateTab`, `parseTab`, `tabId` and `panelId` are defined in Task 4, step 3, and used in step 4.
  - `MARKDOWN_PROSE` (Task 1) is used in Task 2.
