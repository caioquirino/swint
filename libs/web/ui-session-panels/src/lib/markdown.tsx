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
