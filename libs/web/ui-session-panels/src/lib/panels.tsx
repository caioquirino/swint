import { Markdown } from './markdown.js';

export function InstructionsPanel({ markdown }: { markdown: string }) {
  return (
    <section aria-label="Instructions" className="p-4">
      <Markdown source={markdown} />
    </section>
  );
}

export function RubricPanel({ markdown }: { markdown: string }) {
  return (
    <section aria-label="Rubric" className="p-4">
      <p className="mb-3 rounded bg-amber-50 px-2 py-1 text-xs text-amber-800">Only interviewers can see this.</p>
      <Markdown source={markdown} />
    </section>
  );
}
