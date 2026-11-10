import { afterEach, describe, expect, it } from 'vitest';
import { Editor } from '@tiptap/core';
// Load the extensions' type augmentations (Editor `contentType`, `insertTable`) into this project.
import '@tiptap/markdown';
import '@tiptap/extension-table';
import { isAllowedLinkUrl, looksLikeMarkdown, templateExtensions, toMarkdown } from './markdown-extensions.js';

const editors: Editor[] = [];
const load = (markdown: string) => {
  const editor = new Editor({
    element: document.createElement('div'),
    extensions: templateExtensions(),
    content: markdown,
    contentType: 'markdown',
  });
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
    // eslint-disable-next-line no-script-url -- the test needs a disallowed protocol
    for (const url of ['javascript:alert(1)', 'data:text/html,x', 'example.com', '', 'ftp://x.y'])
      expect(isAllowedLinkUrl(url)).toBe(false);
  });

  it('recognizes pasted markdown, and leaves plain text alone', () => {
    for (const text of ['# Hi', '- item', '1. first', '> quote', '```\ncode\n```', '| a | b |', 'see **this**', 'a [link](https://x.y)']) {
      expect(looksLikeMarkdown(text)).toBe(true);
    }
    for (const text of ['plain sentence.', 'a - b', 'price: 5 * 3']) expect(looksLikeMarkdown(text)).toBe(false);
  });
});
