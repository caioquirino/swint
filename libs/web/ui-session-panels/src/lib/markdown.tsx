import ReactMarkdown from 'react-markdown';

const prose =
  'text-sm leading-6 text-slate-800 dark:text-slate-100 [&_h1]:mb-2 [&_h1]:text-xl [&_h1]:font-semibold [&_h2]:mb-2 [&_h2]:mt-4 [&_h2]:text-lg [&_h2]:font-semibold ' +
  '[&_h3]:mt-3 [&_h3]:font-semibold [&_p]:my-2 [&_ul]:my-2 [&_ul]:list-disc [&_ul]:pl-5 [&_ol]:my-2 [&_ol]:list-decimal [&_ol]:pl-5 ' +
  '[&_code]:rounded [&_code]:bg-slate-100 dark:[&_code]:bg-slate-800 [&_code]:px-1 [&_pre]:overflow-auto [&_pre]:rounded [&_pre]:bg-slate-100 dark:[&_pre]:bg-slate-800 [&_pre]:p-3 [&_a]:text-blue-700 dark:[&_a]:text-blue-400 [&_a]:underline';

/** Markdown from templates. Raw HTML is not rendered (react-markdown's default without rehype-raw). */
export function Markdown({ source }: { source: string }) {
  return (
    <div className={prose}>
      <ReactMarkdown skipHtml>{source}</ReactMarkdown>
    </div>
  );
}
