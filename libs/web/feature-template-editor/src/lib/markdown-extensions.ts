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
