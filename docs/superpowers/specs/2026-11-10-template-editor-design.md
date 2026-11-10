# Swint — Template Editor Redesign

- **Date:** 2026-11-10
- **Status:** Approved (design), pending spec review
- **Scope:** The template create/edit page (`/templates/new`, `/templates/:templateId`) and the markdown renderer used in the session room. Builds on the foundation spec (`2026-11-08-swint-foundation-design.md`, goal 6: templates authored in the app).

## 1. Goals and non-goals

### Goals
1. Each of the three template sections (instructions, rubric, starting board) gets **a whole viewport** to work in.
2. Instructions and rubric are edited **WYSIWYG**; nobody needs to know markdown.
3. Templates **stay markdown** in storage, so the API, data and existing templates are unchanged.
4. The room renders everything the editor can produce, including **tables and checklists**.

### Non-goals
- An unsaved-changes guard when leaving the page.
- A raw-markdown editing or source view.
- Images or embeds in instructions or rubric.
- Collaborative (multi-user) template editing.
- Any API, schema or storage change.

## 2. Key decisions

| Decision | Choice | Why |
|---|---|---|
| Layout | Full-page tabs: header bar plus **Instructions · Rubric · Starting board** | The most room per section (user's choice over a room-style split and taller stacked sections). |
| Editor | **TipTap 3** with the official **`@tiptap/markdown`** | TipTap is already in the repo (the Notes panel); its markdown extension parses and serializes markdown. Lexical would add a second rich-text stack. |
| Formatting | **Rich**: standard formatting plus GFM tables and task lists | Rubrics benefit from tables (criterion · weak · strong) and checklists (user's choice). |
| Storage | Unchanged: `instructionsMd` / `rubricMd` strings, max 50 000 characters each | No migration; the room keeps rendering markdown. |
| Room renderer | `react-markdown` gains **`remark-gfm`** | Tables, task lists and strikethrough written in the editor must render in the room. |

## 3. Page layout

The page fills the viewport (`h-dvh`, flex column) and the page itself never scrolls; only the active panel's content does.

```
┌ ← Templates   [Title ......................]  [45] min   [Cancel] [Save template] ┐
├ [Instructions •] [Rubric] [Starting board] ───────────────────────────────────────┤
│ toolbar: H1 H2 H3 | B I S code | • 1. ☑ | ❝ {} | link | table ▾ | ↶ ↷            │
│                                                                                   │
│   editor content (scrolls inside the panel)                                       │
│                                                                                   │
└───────────────────────────────────────────────────────────────────────────────────┘
```

- **Header bar:** a large Title input, Duration (minutes) input, **Cancel** and **Save template**. Field errors for title and duration show under their inputs. The save error (network failure or conflict) shows in the header. The conflict check (`updatedAt` changed since the page was opened, then confirm overwrite) is kept as it is today.
- **Tabs:** an accessible tablist (`role="tablist"`, arrow keys move between tabs). A tab whose field has a validation error shows a red dot and has an accessible description ("has an error"). A failed Save selects the first tab with an error.
- **Panels stay mounted.** Inactive panels are hidden (`hidden`), not unmounted, so the editors' content and undo history and the board's scene survive tab switches.
- **Board refresh.** Excalidraw measures its container while hidden as 0×0. When the Starting board tab is shown, the page calls the board's `refresh()` after layout. `SeedBoardEditor` gains an `onReady(handle)` prop exposing `refresh()`, mirroring `CollaborativeBoard`'s `BoardHandle`.
- **Tab in the URL:** the selected tab is the `tab` search parameter (`instructions` | `rubric` | `board`, default `instructions`), set with `replace` so tab switches don't fill the history. An unknown value falls back to the default.
- Theme follows the global theme (light, dark or system), as everywhere else.

## 4. Rich-text editor

A `RichMarkdownEditor` component in `libs/web/feature-template-editor`, its only consumer. If another feature needs it later, it moves to a UI lib.

```ts
interface RichMarkdownEditorProps {
  label: string;          // accessible name of the editing surface
  value: string;          // markdown, read on mount only (uncontrolled after that)
  onChange: (markdown: string) => void;
  error?: string;
}
```

- **Extensions:**
  - StarterKit (headings levels 1–6 are accepted so existing text is kept, and the toolbar offers 1–3; underline disabled because markdown has none).
  - Link (`openOnClick: false`; protocols limited to `http`, `https` and `mailto`).
  - TaskList and TaskItem (nested items allowed).
  - TableKit (header row on insert).
  - Markdown.
- **Packages:** `@tiptap/markdown`, `@tiptap/extension-table` and `@tiptap/extension-list`, pinned to the workspace TipTap version (3.33.0).
- **Markdown I/O:** the initial content loads as markdown (`contentType: 'markdown'`). Every update calls `onChange(editor.getMarkdown())`. Inline HTML is parsed only into what the schema supports (for example `<b>` becomes bold); everything else, such as `<script>`, is dropped.
- **Normalization:** loading an existing template may change its markup (for example `*` bullets become `-`) without changing the content. An unchanged section keeps its original text exactly; only an edited section is re-serialized. Nothing is saved until the user clicks Save.
- **Paste:** pasted markdown text is parsed into rich content. Pasted HTML keeps only what the schema supports.
- **Toolbar:** one row, wrapping on narrow screens.
  - Buttons: headings 1–3; bold, italic, strike, inline code; bullet, numbered and task list; quote; code block; link; table menu; undo and redo.
  - Table menu: insert a 3×3 table; add or delete a row or column; delete the table.
  - Each button has an accessible name and `aria-pressed` for marks and blocks that are active at the cursor. Buttons that can't apply are disabled; for example, the row and column actions are disabled outside a table.
  - Standard TipTap shortcuts work (Ctrl/Cmd+B, I, Z, Shift+Z, and so on).
- **Link:** the button prompts for a URL. An empty answer removes the link; a URL whose protocol isn't allowed is rejected with an inline message.
- **Styling:** the editor uses the same prose styles as the room renderer (§5), so what you edit is what the room shows, in both themes.
- **Limits:** the 50 000-character limit applies to the serialized markdown, validated on Save with the existing schema. Its error shows on the field and as the tab's red dot.

## 5. Room rendering

- `Markdown` in `libs/web/ui-session-panels` adds `remarkPlugins={[remarkGfm]}` and keeps `skipHtml`. A bare `<br>` inside markdown (for example in table cells) renders as a line break; all other HTML is still skipped.
- **Prose styles** are shared by the renderer and the editor. They gain tables (borders, header row, horizontal scroll when wide), task lists (no bullet, checkbox aligned) and strikethrough, in light and dark themes.
- **Room checklists** render read-only (disabled checkboxes, the react-markdown default).
- **Scope:** everywhere `Markdown` is used, for both roles: the room's Instructions and Rubric tabs.

## 6. Error handling

| Case | Behaviour |
|---|---|
| Validation fails on Save | Field errors on their inputs, red dots on the affected tabs, the first errored tab selected. |
| Save fails (network or server) | Message in the header; the form keeps its content. |
| Template changed elsewhere | Confirm overwrite, as today. |
| Template not found or load error | As today (`Screen` with a message). |
| Disallowed link protocol | Inline message in the toolbar; the link is not applied. |

## 7. Testing (all via Nx targets)

- **Unit (editor):**
  - Markdown round-trip of headings, emphasis, lists, a nested task list, a table, a code block and a link.
  - Toolbar buttons apply and report state (`aria-pressed`).
  - Table actions are disabled outside a table; a disallowed link protocol is rejected.
- **Unit (page):**
  - Panels stay mounted across tab switches; the tab is read from and written to `?tab=`, with an unknown value falling back.
  - Error dots appear and Save selects the first errored tab.
  - The board's `refresh()` is called when its tab is shown.
  - Existing save, conflict and board-dirty behaviour is unchanged.
- **Unit (renderer):** a GFM table and a task list render, with checkboxes disabled; raw HTML is still skipped.
- **E2E (new spec):**
  - Create a template using the toolbar (a heading, a task list, a table) and draw on the starting board; save.
  - Start an interview from it; the table and checklist render in the room's Instructions.
  - The test creates its own template and never edits existing ones, so the user's dev data stays untouched.
  - Positive control: the same assertions fail without `remark-gfm`.

## 8. Open risks

- **`@tiptap/markdown` fidelity:** some markdown constructs may not round-trip exactly, for example HTML blocks, footnotes and reference-style links. They aren't produced by the editor; on load they may be normalized or dropped. An edited section is normalized: `1)` becomes `1.`; loose lists become tight; footnotes and reference-style links are inlined or dropped; images are removed, with a notice shown; a literal paragraph starting with a block marker (`1. `, `# `) is written unescaped (an upstream @tiptap/markdown quirk). Mitigation: unchanged sections are never rewritten, and the round-trip unit tests cover everything the toolbar can produce.
- **Hidden Excalidraw:** mounting while hidden relies on `refresh()` when the tab is shown. Covered by a unit test and the e2e drawing step.
